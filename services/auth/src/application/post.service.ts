import { PrismaClient, Prisma } from "@prisma/client";
import type { AuthUserContext } from "../domain/board.types";
import { canRead, canEdit, canDelete, canPin } from "./board-permissions";
import type { EmbeddingService } from "./embedding.service";
import type { FastifyBaseLogger } from "fastify";

export class PostError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "PostError";
  }
}

export class PostService {
  private embeddingService?: EmbeddingService;
  private logger?: FastifyBaseLogger;

  constructor(private readonly prisma: PrismaClient) {}

  // 선택적 의존성 주입 (없으면 임베딩 비활성)
  setEmbedding(embeddingService: EmbeddingService, logger: FastifyBaseLogger) {
    this.embeddingService = embeddingService;
    this.logger = logger;
  }

  /**
   * 글 임베딩 후 DB에 저장 (fire-and-forget).
   * 실패는 logger.error만, 글 작성에 영향 없음.
   */
  private embedAndStorePost(postId: string, title: string, content: string): void {
    if (!this.embeddingService) return;
    const text = `${title}\n\n${content}`;
    void this.embeddingService.embedText(text)
      .then(async (vec) => {
        const literal = this.embeddingService!.toSqlLiteral(vec);
        // $executeRawUnsafe는 cast(::vector) 처리에 이슈 — Prisma.sql + $executeRaw 사용
        await this.prisma.$executeRaw`
          UPDATE public.board_posts
          SET embedding = ${literal}::vector,
              embedded_at = NOW()
          WHERE id = ${postId}
        `;
        this.logger?.info({ postId, dim: vec.length }, "[embed-post] indexed");
      })
      .catch((err) => {
        this.logger?.error({ err: String(err), postId }, "[embed-post] failed");
      });
  }

  async list(boardCode: string, params: {
    page?: number | undefined;
    pageSize?: number | undefined;
    search?: string | undefined;
    publishingDeptId?: string | undefined;
    priority?: number | undefined;
  }, user: AuthUserContext) {
    const board = await this.prisma.board.findUnique({ where: { code: boardCode } });
    if (!board) throw new PostError("BOARD_NOT_FOUND", "보드를 찾을 수 없습니다.", 404);

    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(50, params.pageSize ?? 20);

    const where: Prisma.PostWhereInput = {
      boardId: board.id,
      isDeleted: false,
    };
    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: "insensitive" } },
        { content: { contains: params.search, mode: "insensitive" } },
      ];
    }
    if (params.publishingDeptId) where.publishingDepartmentId = params.publishingDeptId;
    if (typeof params.priority === "number") where.priority = params.priority;

    const [items, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          author: { select: { id: true, name: true } },
          _count: { select: { comments: true, attachments: true, reads: true } },
          reads: { where: { userId: user.id }, select: { postId: true } },
        },
      }),
      this.prisma.post.count({ where }),
    ]);

    const result = items.map((p) => ({
      id: p.id,
      title: p.title,
      summary: this.summarize(p.content, 200),
      isPinned: p.isPinned,
      priority: p.priority,
      publishedAt: p.publishedAt,
      expiresAt: p.expiresAt,
      viewCount: p.viewCount,
      commentCount: p._count.comments,
      attachmentCount: p._count.attachments,
      isRead: p.reads.length > 0,
      author: p.author,
      publishingDepartment: p.publishingDepartmentId
        ? { id: p.publishingDepartmentId, name: p.publishingDepartmentName ?? "" }
        : null,
      targetDepartment: p.targetDepartmentId
        ? { id: p.targetDepartmentId, name: p.targetDepartmentName ?? "" }
        : null,
      board: { code: board.code, name: board.name },
      // 게시판 design v2.0 (2026-05-22): 기능 요구 카테고리 필드
      requestStatus: p.requestStatus ?? null,
      requestType: p.requestType ?? null,
      moduleArea: p.moduleArea ?? null,
      assigneeId: p.assigneeId ?? null,
    }));

    return { items: result, total, page, pageSize };
  }

  async getDetail(postId: string, user: AuthUserContext) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        board: true,
        author: { select: { id: true, name: true } },
        attachments: { orderBy: { uploadedAt: "asc" } },
        _count: { select: { comments: true } },
        assignee: { select: { id: true, name: true } },
      },
    });
    if (!post) throw new PostError("POST_NOT_FOUND", "글을 찾을 수 없습니다.", 404);
    if (!canRead(post.board, post, user)) {
      throw new PostError("FORBIDDEN_READ", "읽기 권한이 없습니다.", 403);
    }

    // 조회 카운트 + 읽음 기록 (작성자 본인은 viewCount 증가 시키지 않음)
    if (post.authorId !== user.id) {
      await this.prisma.$transaction([
        this.prisma.post.update({ where: { id: postId }, data: { viewCount: { increment: 1 } } }),
        this.prisma.postRead.upsert({
          where: { postId_userId: { postId, userId: user.id } },
          create: { postId, userId: user.id },
          update: { readAt: new Date() },
        }),
      ]);
    } else {
      await this.prisma.postRead.upsert({
        where: { postId_userId: { postId, userId: user.id } },
        create: { postId, userId: user.id },
        update: { readAt: new Date() },
      });
    }

    return {
      id: post.id,
      title: post.title,
      content: post.content,
      isPinned: post.isPinned,
      priority: post.priority,
      publishedAt: post.publishedAt,
      expiresAt: post.expiresAt,
      viewCount: post.viewCount + (post.authorId !== user.id ? 1 : 0),
      commentCount: post._count.comments,
      attachmentCount: post.attachments.length,
      isRead: true,
      author: post.author,
      publishingDepartment: post.publishingDepartmentId
        ? { id: post.publishingDepartmentId, name: post.publishingDepartmentName ?? "" }
        : null,
      targetDepartment: post.targetDepartmentId
        ? { id: post.targetDepartmentId, name: post.targetDepartmentName ?? "" }
        : null,
      board: { code: post.board.code, name: post.board.name },
      attachments: post.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
        isInline: a.isInline,
        url: `/api/v1/attachments/${a.id}`,
        uploadedAt: a.uploadedAt,
      })),
      // 게시판 design v2.0 (2026-05-22): 기능 요구 카테고리 필드
      requestStatus: post.requestStatus ?? null,
      requestType: post.requestType ?? null,
      moduleArea: post.moduleArea ?? null,
      releaseVersion: post.releaseVersion ?? null,
      resolvedAt: post.resolvedAt ?? null,
      assigneeId: post.assigneeId ?? null,
      assignee: post.assignee ?? null,
    };
  }

  async create(boardCode: string, data: {
    title: string;
    content: string;
    priority?: number | undefined;
    expiresAt?: string | null | undefined;
    attachmentIds?: string[] | undefined;
    targetDepartmentId?: string | null | undefined;
    // 게시판 design v2.0 (2026-05-22): 기능 요구 필드
    requestType?: "BUG" | "NEW_FEATURE" | "IMPROVEMENT" | "UI_UX" | "DOCS" | "OTHER" | undefined;
    moduleArea?: string | undefined;
  }, user: AuthUserContext): Promise<string> {
    const board = await this.prisma.board.findUnique({
      where: { code: boardCode },
      include: { category: { select: { code: true } } },
    });
    if (!board) throw new PostError("BOARD_NOT_FOUND", "보드를 찾을 수 없습니다.", 404);

    // 발행 부서 스냅샷
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId: user.id },
      select: { departmentId: true, departmentName: true },
    });

    // 대상 부서 스냅샷 (지정 시)
    let targetDeptName: string | null = null;
    if (data.targetDepartmentId) {
      const target = await this.prisma.department.findUnique({
        where: { id: data.targetDepartmentId },
        select: { name: true, isActive: true, hiddenFromMenus: true },
      });
      if (!target || !target.isActive || target.hiddenFromMenus)
        throw new PostError("DEPARTMENT_NOT_FOUND", "선택한 부서를 찾을 수 없습니다.", 404);
      targetDeptName = target.name;
    }

    // 기능 요구 카테고리: 자동으로 SUBMITTED 상태로 시작
    const isFeatureRequest = board.category.code === "feature-request";

    const post = await this.prisma.$transaction(async (tx) => {
      const created = await tx.post.create({
        data: {
          boardId: board.id,
          authorId: user.id,
          title: data.title,
          content: data.content,
          priority: data.priority ?? 0,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          publishingDepartmentId: profile?.departmentId ?? null,
          publishingDepartmentName: profile?.departmentName ?? null,
          targetDepartmentId: data.targetDepartmentId ?? null,
          targetDepartmentName: targetDeptName,
          // 기능 요구 카테고리만 적용
          ...(isFeatureRequest && {
            requestStatus: "SUBMITTED",
            requestType: data.requestType ?? "NEW_FEATURE",
            moduleArea: data.moduleArea ?? null,
          }),
        },
      });
      if (data.attachmentIds && data.attachmentIds.length > 0) {
        await tx.attachment.updateMany({
          where: { id: { in: data.attachmentIds }, postId: null, uploadedBy: user.id },
          data: { postId: created.id },
        });
      }
      return created;
    });

    // 임베딩 (fire-and-forget)
    this.embedAndStorePost(post.id, data.title, data.content);

    return post.id;
  }

  async update(postId: string, data: {
    title?: string | undefined;
    content?: string | undefined;
    priority?: number | undefined;
    expiresAt?: string | null | undefined;
    targetDepartmentId?: string | null | undefined;
  }, user: AuthUserContext) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new PostError("POST_NOT_FOUND", "글을 찾을 수 없습니다.", 404);
    if (!canEdit(post, user)) throw new PostError("FORBIDDEN_EDIT", "수정 권한이 없습니다.", 403);

    const updateData: Prisma.PostUpdateInput = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.content !== undefined) updateData.content = data.content;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    if (data.targetDepartmentId !== undefined) {
      if (data.targetDepartmentId) {
        const target = await this.prisma.department.findUnique({
          where: { id: data.targetDepartmentId },
          select: { name: true, isActive: true, hiddenFromMenus: true },
        });
        if (!target || !target.isActive || target.hiddenFromMenus)
          throw new PostError("DEPARTMENT_NOT_FOUND", "선택한 부서를 찾을 수 없습니다.", 404);
        updateData.targetDepartmentId = data.targetDepartmentId;
        updateData.targetDepartmentName = target.name;
      } else {
        updateData.targetDepartmentId = null;
        updateData.targetDepartmentName = null;
      }
    }

    const updated = await this.prisma.post.update({ where: { id: postId }, data: updateData });

    // 본문/제목 변경 시 재임베딩
    if (data.title !== undefined || data.content !== undefined) {
      this.embedAndStorePost(updated.id, updated.title, updated.content);
    }

    return updated;
  }

  async softDelete(postId: string, user: AuthUserContext) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new PostError("POST_NOT_FOUND", "글을 찾을 수 없습니다.", 404);
    if (!canDelete(post, user)) throw new PostError("FORBIDDEN_EDIT", "삭제 권한이 없습니다.", 403);

    await this.prisma.post.update({ where: { id: postId }, data: { isDeleted: true } });
  }

  async togglePin(postId: string, isPinned: boolean, user: AuthUserContext) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new PostError("POST_NOT_FOUND", "글을 찾을 수 없습니다.", 404);
    if (!canPin(post, user)) throw new PostError("FORBIDDEN_PIN", "핀 권한이 없습니다.", 403);

    return this.prisma.post.update({
      where: { id: postId },
      data: { isPinned },
      select: { id: true, isPinned: true },
    });
  }

  // ─────────────────────────────────────────────────────
  // 게시판 design v2.0 (2026-05-22): 기능 요구 카테고리 전용
  // ─────────────────────────────────────────────────────

  /**
   * 기능 요구 글의 status 변경. ADMIN 또는 담당자(assignee).
   * COMPLETED 전이 시 resolvedAt 자동 설정. releaseVersion 함께 입력 가능.
   */
  async updateFeatureStatus(postId: string, data: {
    requestStatus: "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "ON_HOLD";
    releaseVersion?: string | null;
  }, user: AuthUserContext) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { board: { include: { category: { select: { code: true } } } } },
    });
    if (!post) throw new PostError("POST_NOT_FOUND", "글을 찾을 수 없습니다.", 404);
    if (post.board.category.code !== "feature-request") {
      throw new PostError("NOT_FEATURE_REQUEST", "기능 요구 글이 아닙니다.", 400);
    }
    // 권한: ADMIN 또는 담당자
    const isAdmin = user.role === "ADMIN";
    const isAssignee = post.assigneeId === user.id;
    if (!isAdmin && !isAssignee) {
      throw new PostError("FORBIDDEN_STATUS", "상태 변경 권한이 없습니다 (ADMIN 또는 담당자).", 403);
    }

    const updateData: Prisma.PostUpdateInput = {
      requestStatus: data.requestStatus,
    };
    if (data.releaseVersion !== undefined) {
      updateData.releaseVersion = data.releaseVersion;
    }
    if (data.requestStatus === "COMPLETED" && !post.resolvedAt) {
      updateData.resolvedAt = new Date();
    } else if (data.requestStatus !== "COMPLETED" && post.resolvedAt) {
      // 완료 후 다른 상태로 복귀 시 resolvedAt 해제
      updateData.resolvedAt = null;
    }

    return this.prisma.post.update({
      where: { id: postId },
      data: updateData,
      select: {
        id: true, requestStatus: true, releaseVersion: true, resolvedAt: true,
        assigneeId: true,
      },
    });
  }

  /**
   * 기능 요구 글의 담당자(assignee) 지정. ADMIN만.
   */
  async assignFeature(postId: string, data: { assigneeId: string | null }, user: AuthUserContext) {
    if (user.role !== "ADMIN") {
      throw new PostError("FORBIDDEN_ASSIGN", "담당자 지정은 ADMIN만 가능합니다.", 403);
    }
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { board: { include: { category: { select: { code: true } } } } },
    });
    if (!post) throw new PostError("POST_NOT_FOUND", "글을 찾을 수 없습니다.", 404);
    if (post.board.category.code !== "feature-request") {
      throw new PostError("NOT_FEATURE_REQUEST", "기능 요구 글이 아닙니다.", 400);
    }
    if (data.assigneeId) {
      const assignee = await this.prisma.user.findUnique({ where: { id: data.assigneeId } });
      if (!assignee) throw new PostError("ASSIGNEE_NOT_FOUND", "담당자를 찾을 수 없습니다.", 404);
    }
    return this.prisma.post.update({
      where: { id: postId },
      data: { assigneeId: data.assigneeId },
      select: { id: true, assigneeId: true },
    });
  }

  /**
   * 관리자 대시보드용 통계 (status·type별 카운트).
   */
  async getFeatureRequestStats() {
    const board = await this.prisma.board.findFirst({
      where: { category: { code: "feature-request" } },
      select: { id: true },
    });
    if (!board) return { total: 0, byStatus: {}, byType: {}, byModule: {} };

    const posts = await this.prisma.post.findMany({
      where: { boardId: board.id, isDeleted: false },
      select: { requestStatus: true, requestType: true, moduleArea: true },
    });

    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byModule: Record<string, number> = {};
    for (const p of posts) {
      if (p.requestStatus) byStatus[p.requestStatus] = (byStatus[p.requestStatus] ?? 0) + 1;
      if (p.requestType) byType[p.requestType] = (byType[p.requestType] ?? 0) + 1;
      if (p.moduleArea) byModule[p.moduleArea] = (byModule[p.moduleArea] ?? 0) + 1;
    }
    return { total: posts.length, byStatus, byType, byModule };
  }

  async getFeed(params: { categoryCode?: string | undefined; limit?: number | undefined }, user: AuthUserContext) {
    const limit = Math.min(20, params.limit ?? 5);

    const boardWhere: Prisma.BoardWhereInput = { isActive: true };
    if (params.categoryCode) {
      const cat = await this.prisma.boardCategory.findUnique({ where: { code: params.categoryCode } });
      if (!cat) return { items: [] };
      boardWhere.categoryId = cat.id;
    }
    const boards = await this.prisma.board.findMany({ where: boardWhere, select: { id: true, code: true, name: true } });
    const boardIds = boards.map((b) => b.id);
    const boardMap = new Map(boards.map((b) => [b.id, b]));

    if (boardIds.length === 0) return { items: [] };

    const posts = await this.prisma.post.findMany({
      where: { boardId: { in: boardIds }, isDeleted: false },
      orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }],
      take: limit,
      include: {
        author: { select: { name: true } },
        reads: { where: { userId: user.id }, select: { postId: true } },
      },
    });

    return {
      items: posts.map((p) => {
        const b = boardMap.get(p.boardId)!;
        return {
          id: p.id,
          title: p.title,
          summary: this.summarize(p.content, 100),
          isPinned: p.isPinned,
          priority: p.priority,
          publishedAt: p.publishedAt,
          isRead: p.reads.length > 0,
          boardCode: b.code,
          boardName: b.name,
          authorName: p.author.name,
        };
      }),
    };
  }

  async getMyUnreadCount(user: AuthUserContext, categoryCode?: string) {
    const boardWhere: Prisma.BoardWhereInput = { isActive: true };
    if (categoryCode) {
      const cat = await this.prisma.boardCategory.findUnique({ where: { code: categoryCode } });
      if (!cat) return { total: 0, byCategory: {} };
      boardWhere.categoryId = cat.id;
    }
    const boards = await this.prisma.board.findMany({ where: boardWhere, select: { id: true, categoryId: true } });
    const boardIds = boards.map((b) => b.id);
    if (boardIds.length === 0) return { total: 0, byCategory: {} };

    // 발행된 글 ID
    const posts = await this.prisma.post.findMany({
      where: { boardId: { in: boardIds }, isDeleted: false },
      select: { id: true, boardId: true },
    });
    const reads = await this.prisma.postRead.findMany({
      where: { userId: user.id, postId: { in: posts.map((p) => p.id) } },
      select: { postId: true },
    });
    const readSet = new Set(reads.map((r) => r.postId));

    const total = posts.filter((p) => !readSet.has(p.id)).length;

    const byCategory: Record<string, number> = {};
    if (!categoryCode) {
      const boardCatMap = new Map(boards.map((b) => [b.id, b.categoryId]));
      const cats = await this.prisma.boardCategory.findMany({ select: { id: true, code: true } });
      const codeMap = new Map(cats.map((c) => [c.id, c.code]));
      for (const p of posts) {
        if (readSet.has(p.id)) continue;
        const catId = boardCatMap.get(p.boardId);
        if (!catId) continue;
        const code = codeMap.get(catId);
        if (!code) continue;
        byCategory[code] = (byCategory[code] ?? 0) + 1;
      }
    }

    return { total, byCategory };
  }

  private summarize(markdown: string, maxLen: number): string {
    const text = markdown
      .replace(/```[\s\S]*?```/g, "")        // code blocks
      .replace(/!\[.*?\]\(.*?\)/g, "")        // images
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")     // links → text
      .replace(/[#>*_`~-]/g, "")              // markdown chars
      .replace(/\s+/g, " ")
      .trim();
    return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
  }
}
