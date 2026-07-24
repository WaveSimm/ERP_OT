import { PrismaClient, Prisma, WorkLog } from "@prisma/client";
import { createMentions, syncMentions } from "./mention.util.js";
import { notifyMentionBell } from "./mention-bell.util.js";
import type { FastifyBaseLogger } from "fastify";
import {
  AuthUser,
  canCreateWorkLog,
  canEditWorkLog,
  canDeleteWorkLog,
} from "./work-log-permissions";
import type { EmbeddingService } from "./embedding.service";
import { searchConfig } from "./search-config";

// 부하테스트 — 일반 검색에서 부하 사용자 작성 비고 자동 제외
const HIDE_LOAD_TEST = process.env.HIDE_LOAD_TEST !== "false";

export class WorkLogError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "WorkLogError";
  }
}

// 자연어 검색 raw SQL row (semanticSearch) — DB 컬럼 별칭과 1:1
interface WorkLogSearchRawRow {
  id: string;
  taskId: string;
  segmentId: string | null;
  authorId: string;
  authorName: string | null;
  content: string;
  workedAt: string;
  taskName: string;
  projectId: string;
  projectName: string;
  segmentName: string | null;
  embed_score: number;
  exact_bonus: number;
  trgm_score: number;
  score: number | string; // numeric → 드라이버에 따라 string 가능
}

export interface WorkLogSearchResult extends Omit<WorkLogSearchRawRow, "score"> {
  score: number;
}

// toDto 입력: WorkLog 스칼라 + (선택) segment 관계
type WorkLogWithOptionalSegment = WorkLog & { segment?: { name: string | null } | null };

export class WorkLogService {
  private embeddingService?: EmbeddingService;
  private logger?: FastifyBaseLogger;

  constructor(private readonly prisma: PrismaClient) {}

  setEmbedding(embeddingService: EmbeddingService, logger: FastifyBaseLogger) {
    this.embeddingService = embeddingService;
    this.logger = logger;
  }

  /**
   * 비고 임베딩 fire-and-forget. 실패는 logger.error만.
   */
  private embedAndStoreWorkLog(logId: string, taskName: string, segmentName: string | null, content: string): void {
    if (!this.embeddingService) return;
    const segPart = segmentName ? `${segmentName} ` : "";
    const text = `[${taskName}] ${segPart}: ${content}`;
    void this.embeddingService.embedText(text)
      .then(async (vec) => {
        const literal = this.embeddingService!.toSqlLiteral(vec);
        await this.prisma.$executeRaw`
          UPDATE project.work_logs
          SET embedding = ${literal}::vector,
              embedded_at = NOW()
          WHERE id = ${logId}
        `;
        this.logger?.info({ logId, dim: vec.length }, "[embed-worklog] indexed");
      })
      .catch((err) => {
        this.logger?.error({ err: String(err), logId }, "[embed-worklog] failed");
      });
  }

  async listByTask(taskId: string, params: { segmentId?: string | undefined; limit?: number | undefined }, user: AuthUser) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
    if (!task) throw new WorkLogError("TASK_NOT_FOUND", "작업을 찾을 수 없습니다.", 404);

    const limit = Math.min(200, params.limit ?? 100);
    const where: Prisma.WorkLogWhereInput = { taskId };
    if (user.role !== "ADMIN") where.isDeleted = false;
    if (params.segmentId) where.segmentId = params.segmentId;

    const items = await this.prisma.workLog.findMany({
      where,
      orderBy: [{ workedAt: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: {
        segment: { select: { id: true, name: true } },
      },
    });
    return items.map((w) => ({
      id: w.id,
      taskId: w.taskId,
      segmentId: w.segmentId,
      segmentName: w.segment?.name ?? null,
      authorId: w.authorId,
      authorName: w.authorName,
      content: w.content,
      workedAt: w.workedAt.toISOString().slice(0, 10),
      isDeleted: w.isDeleted,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    }));
  }

  async create(
    taskId: string,
    data: { content: string; workedAt: string; segmentId?: string | undefined; mentionedUserIds?: string[] | undefined },
    user: AuthUser & { name: string },
  ) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
    if (!task) throw new WorkLogError("TASK_NOT_FOUND", "작업을 찾을 수 없습니다.", 404);

    if (data.segmentId) {
      const seg = await this.prisma.taskSegment.findUnique({
        where: { id: data.segmentId },
        select: { taskId: true },
      });
      if (!seg || seg.taskId !== taskId) {
        throw new WorkLogError("SEGMENT_NOT_FOUND", "세그먼트를 찾을 수 없습니다.", 404);
      }
    }

    const allowed = await canCreateWorkLog(this.prisma, taskId, user);
    if (!allowed) {
      throw new WorkLogError("FORBIDDEN_WORK_LOG_CREATE", "이 작업에 비고를 작성할 권한이 없습니다.", 403);
    }

    const created = await this.prisma.workLog.create({
      data: {
        taskId,
        segmentId: data.segmentId ?? null,
        authorId: user.id,
        authorName: user.name,
        content: data.content,
        workedAt: new Date(data.workedAt),
      },
      include: { segment: { select: { id: true, name: true } }, task: { select: { name: true } } },
    });

    // 임베딩 (fire-and-forget)
    this.embedAndStoreWorkLog(created.id, created.task?.name ?? "", created.segment?.name ?? null, created.content);

    await createMentions(this.prisma, {
      sourceType: "WORKLOG",
      sourceId: created.id,
      taskId,
      userIds: data.mentionedUserIds ?? [],
      actorId: user.id,
    });
    void notifyMentionBell(this.prisma, {
      sourceType: "WORKLOG",
      userIds: data.mentionedUserIds ?? [],
      actorId: user.id,
      preview: data.content,
      taskId,
    });

    return this.toDto(created);
  }

  async update(
    id: string,
    data: { content?: string | undefined; workedAt?: string | undefined; mentionedUserIds?: string[] | undefined },
    user: AuthUser,
  ) {
    const log = await this.prisma.workLog.findUnique({ where: { id } });
    if (!log) throw new WorkLogError("WORK_LOG_NOT_FOUND", "비고를 찾을 수 없습니다.", 404);
    if (!canEditWorkLog(log, user)) {
      throw new WorkLogError("FORBIDDEN_WORK_LOG_EDIT", "비고를 수정할 권한이 없습니다.", 403);
    }
    const updateData: Prisma.WorkLogUpdateInput = {};
    if (data.content !== undefined) updateData.content = data.content;
    if (data.workedAt !== undefined) updateData.workedAt = new Date(data.workedAt);

    const updated = await this.prisma.workLog.update({
      where: { id },
      data: updateData,
      include: { segment: { select: { id: true, name: true } }, task: { select: { name: true } } },
    });

    // 본문 변경 시 재임베딩
    if (data.content !== undefined) {
      this.embedAndStoreWorkLog(updated.id, updated.task?.name ?? "", updated.segment?.name ?? null, updated.content);
    }

    if (data.mentionedUserIds !== undefined) {
      await syncMentions(this.prisma, {
        sourceType: "WORKLOG",
        sourceId: id,
        taskId: log.taskId,
        userIds: data.mentionedUserIds,
        actorId: user.id,
      });
      void notifyMentionBell(this.prisma, {
        sourceType: "WORKLOG",
        userIds: data.mentionedUserIds,
        actorId: user.id,
        preview: updated.content,
        taskId: log.taskId,
      });
    }

    return this.toDto(updated);
  }

  async softDelete(id: string, user: AuthUser) {
    const log = await this.prisma.workLog.findUnique({ where: { id } });
    if (!log) throw new WorkLogError("WORK_LOG_NOT_FOUND", "비고를 찾을 수 없습니다.", 404);
    if (!canDeleteWorkLog(log, user)) {
      throw new WorkLogError("FORBIDDEN_WORK_LOG_EDIT", "비고를 삭제할 권한이 없습니다.", 403);
    }
    await this.prisma.workLog.update({ where: { id }, data: { isDeleted: true } });
  }

  async listByProject(
    projectId: string,
    params: { from?: string; to?: string; authorId?: string; taskId?: string; limit?: number; cursor?: string },
    _user: AuthUser & { email: string },
  ) {
    // 전사 공유 (2026-07-04): 프로젝트 비고 읽기는 전 직원 허용 (쓰기/수정 권한은 별도 유지)
    const limit = Math.min(500, params.limit ?? 200);
    const where: Prisma.WorkLogWhereInput = {
      isDeleted: false,
      task: { projectId },
    };
    if (params.from) where.workedAt = { ...((where.workedAt as object) ?? {}), gte: new Date(params.from) };
    if (params.to) where.workedAt = { ...((where.workedAt as object) ?? {}), lte: new Date(params.to) };
    if (params.authorId) where.authorId = params.authorId;
    if (params.taskId) where.taskId = params.taskId;

    if (params.cursor) {
      const [cWorkedAt, cId] = params.cursor.split(":");
      if (cWorkedAt && cId) {
        where.OR = [
          { workedAt: { lt: new Date(cWorkedAt) } },
          { workedAt: new Date(cWorkedAt), id: { lt: cId } },
        ];
      }
    }

    const items = await this.prisma.workLog.findMany({
      where,
      orderBy: [{ workedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        task: { select: { id: true, name: true, projectId: true } },
        segment: { select: { id: true, name: true } },
      },
    });

    let nextCursor: string | null = null;
    if (items.length > limit) {
      const last = items[limit - 1]!;
      nextCursor = `${last.workedAt.toISOString().slice(0, 10)}:${last.id}`;
      items.length = limit;
    }

    return {
      items: items.map((w) => ({
        ...this.toDto(w),
        taskName: w.task.name,
      })),
      nextCursor,
    };
  }

  async listMine(
    user: AuthUser,
    params: { from?: string; to?: string; projectId?: string; limit?: number },
  ) {
    const limit = Math.min(500, params.limit ?? 200);
    const where: Prisma.WorkLogWhereInput = {
      authorId: user.id,
      isDeleted: false,
    };
    if (params.from) where.workedAt = { ...((where.workedAt as object) ?? {}), gte: new Date(params.from) };
    if (params.to) where.workedAt = { ...((where.workedAt as object) ?? {}), lte: new Date(params.to) };
    if (params.projectId) where.task = { projectId: params.projectId };

    const items = await this.prisma.workLog.findMany({
      where,
      orderBy: [{ workedAt: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: {
        task: { select: { id: true, name: true, projectId: true, project: { select: { name: true } } } },
        segment: { select: { id: true, name: true } },
      },
    });
    return items.map((w) => ({
      ...this.toDto(w),
      taskName: w.task.name,
      projectId: w.task.projectId,
      projectName: w.task.project?.name ?? "",
    }));
  }

  // 자연어 검색 (auth-service에서 internal HTTP로 호출)
  async semanticSearch(
    queryVec: number[],
    q: string,
    user: { id: string; email: string; role: string },
    limit: number,
  ): Promise<WorkLogSearchResult[]> {
    if (!queryVec || queryVec.length === 0) return [];

    // 권한 범위 결정: ADMIN/MANAGER는 전체, 일반은 본인 참여 프로젝트만
    let projectIds: string[] | null;
    if (user.role === "ADMIN" || user.role === "MANAGER") {
      projectIds = null; // null = 제한 없음
    } else {
      // Phase 4 (2026-05-13): legacy resource → auth_user id 직접 사용
      const resource = { id: user.id };
      if (!resource) return [];
      const assignments = await this.prisma.segmentAssignment.findMany({
        where: { resourceId: resource.id },
        select: { segment: { select: { task: { select: { projectId: true } } } } },
      });
      const set = new Set<string>();
      for (const a of assignments) set.add(a.segment.task.projectId);
      // 본인이 작성한 비고가 있는 프로젝트도 추가
      const myLogs = await this.prisma.workLog.findMany({
        where: { authorId: user.id, isDeleted: false },
        select: { task: { select: { projectId: true } } },
      });
      for (const l of myLogs) set.add(l.task.projectId);
      projectIds = Array.from(set);
      if (projectIds.length === 0) return [];
    }

    const literal = `[${queryVec.join(",")}]`;
    const cfg = searchConfig;
    const k3 = limit * 3;
    // 하이브리드 점수: embed_score * W_e + max(exact_bonus, trgm_score) * W_k
    // WorkLog는 title 없음 → content만 사용
    let rows: WorkLogSearchRawRow[];
    if (projectIds === null) {
      rows = await this.prisma.$queryRaw<WorkLogSearchRawRow[]>`
        WITH scored AS (
          SELECT w.id, w.task_id AS "taskId", w.segment_id AS "segmentId",
                 w.author_id AS "authorId", w.author_name AS "authorName",
                 w.content, TO_CHAR(w.worked_at, 'YYYY-MM-DD') AS "workedAt",
                 t.name AS "taskName", t."projectId" AS "projectId",
                 p.name AS "projectName",
                 s.name AS "segmentName",
                 (1 - (w.embedding <=> ${literal}::vector)) AS embed_score,
                 (CASE WHEN w.content ILIKE '%' || ${q} || '%' THEN ${cfg.contentExactBonus}::float ELSE 0 END) AS exact_bonus,
                 COALESCE(similarity(w.content, ${q}), 0) * ${cfg.contentTrgmWeight}::float AS trgm_score
          FROM project.work_logs w
          JOIN project.tasks t ON t.id = w.task_id
          JOIN project.projects p ON p.id = t."projectId"
          LEFT JOIN project.task_segments s ON s.id = w.segment_id
          WHERE w.embedding IS NOT NULL AND w.is_deleted = false
            ${HIDE_LOAD_TEST ? Prisma.sql`AND w.author_id NOT LIKE 'loadtest-%'` : Prisma.empty}
          ORDER BY w.embedding <=> ${literal}::vector
          LIMIT ${k3}
        ),
        final AS (
          SELECT *,
            embed_score * ${cfg.embedWeight}::float
            + GREATEST(exact_bonus, trgm_score) * ${cfg.keywordWeight}::float
            + CASE WHEN exact_bonus > 0 THEN ${cfg.keywordMatchBonus}::float ELSE 0 END
              AS score
          FROM scored
        )
        SELECT * FROM final
        WHERE score >= ${cfg.minScore}::float
        ORDER BY score DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await this.prisma.$queryRaw<WorkLogSearchRawRow[]>`
        WITH scored AS (
          SELECT w.id, w.task_id AS "taskId", w.segment_id AS "segmentId",
                 w.author_id AS "authorId", w.author_name AS "authorName",
                 w.content, TO_CHAR(w.worked_at, 'YYYY-MM-DD') AS "workedAt",
                 t.name AS "taskName", t."projectId" AS "projectId",
                 p.name AS "projectName",
                 s.name AS "segmentName",
                 (1 - (w.embedding <=> ${literal}::vector)) AS embed_score,
                 (CASE WHEN w.content ILIKE '%' || ${q} || '%' THEN ${cfg.contentExactBonus}::float ELSE 0 END) AS exact_bonus,
                 COALESCE(similarity(w.content, ${q}), 0) * ${cfg.contentTrgmWeight}::float AS trgm_score
          FROM project.work_logs w
          JOIN project.tasks t ON t.id = w.task_id
          JOIN project.projects p ON p.id = t."projectId"
          LEFT JOIN project.task_segments s ON s.id = w.segment_id
          WHERE w.embedding IS NOT NULL AND w.is_deleted = false
            AND t."projectId" = ANY(${projectIds})
            ${HIDE_LOAD_TEST ? Prisma.sql`AND w.author_id NOT LIKE 'loadtest-%'` : Prisma.empty}
          ORDER BY w.embedding <=> ${literal}::vector
          LIMIT ${k3}
        ),
        final AS (
          SELECT *,
            embed_score * ${cfg.embedWeight}::float
            + GREATEST(exact_bonus, trgm_score) * ${cfg.keywordWeight}::float
            + CASE WHEN exact_bonus > 0 THEN ${cfg.keywordMatchBonus}::float ELSE 0 END
              AS score
          FROM scored
        )
        SELECT * FROM final
        WHERE score >= ${cfg.minScore}::float
        ORDER BY score DESC
        LIMIT ${limit}
      `;
    }

    return rows.map((r) => ({
      ...r,
      score: typeof r.score === "string" ? parseFloat(r.score) : Number(r.score),
    }));
  }

  // 최근 비고 피드 (게시판 랜딩·통합 목록용)
  // 전사 공유 (2026-07-04): 프로젝트 비고는 전 직원 공개, 작성일(createdAt) 최신순
  // 페이지네이션 (2026-07-04): offset/limit + 서버 필터(기간=작성일 KST·작성자·프로젝트·검색어), total 반환
  async listFeed(
    _user: AuthUser & { email: string },
    params: {
      limit?: number | undefined;
      offset?: number | undefined;
      from?: string | undefined;
      to?: string | undefined;
      authorId?: string | undefined;
      projectId?: string | undefined;
      q?: string | undefined;
    },
  ) {
    const limit = Math.min(200, params.limit ?? 10);
    const offset = Math.max(0, params.offset ?? 0);

    const where: Prisma.WorkLogWhereInput = { isDeleted: false };
    if (params.from) {
      where.createdAt = { ...((where.createdAt as object) ?? {}), gte: new Date(`${params.from}T00:00:00+09:00`) };
    }
    if (params.to) {
      where.createdAt = { ...((where.createdAt as object) ?? {}), lte: new Date(`${params.to}T23:59:59.999+09:00`) };
    }
    if (params.authorId) where.authorId = params.authorId;
    if (params.projectId) where.task = { projectId: params.projectId };
    if (params.q) {
      where.OR = [
        { content: { contains: params.q, mode: "insensitive" } },
        { task: { name: { contains: params.q, mode: "insensitive" } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.workLog.count({ where }),
      this.prisma.workLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: offset,
        take: limit,
        include: {
          task: {
            select: {
              id: true,
              name: true,
              projectId: true,
              project: { select: { name: true } },
            },
          },
          segment: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      total,
      items: items.map((w) => ({
        ...this.toDto(w),
        taskName: w.task.name,
        projectId: w.task.projectId,
        projectName: w.task.project?.name ?? "",
      })),
    };
  }

  // 프로젝트 게시판 사이드바용 프로젝트 + WorkLog 통계
  // 전사 공유 (2026-07-04): 역할 무관 전체 프로젝트 노출
  async listMyProjects(_user: AuthUser & { email: string }) {
    const projects = await this.prisma.project.findMany({
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    });
    const projectIds = projects.map((p) => p.id);

    // 통계
    const stats = await this.prisma.workLog.groupBy({
      by: ["taskId"],
      where: { isDeleted: false, task: { projectId: { in: projectIds } } },
      _count: { id: true },
      _max: { workedAt: true },
    });
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: stats.map((s) => s.taskId) } },
      select: { id: true, projectId: true },
    });
    const taskToProject = new Map(tasks.map((t) => [t.id, t.projectId]));
    const acc = new Map<string, { logCount: number; lastLogAt: Date | null }>();
    for (const s of stats) {
      const pid = taskToProject.get(s.taskId);
      if (!pid) continue;
      const cur = acc.get(pid) ?? { logCount: 0, lastLogAt: null };
      cur.logCount += s._count.id;
      if (s._max.workedAt && (!cur.lastLogAt || s._max.workedAt > cur.lastLogAt)) {
        cur.lastLogAt = s._max.workedAt;
      }
      acc.set(pid, cur);
    }

    return projects.map((p) => ({
      projectId: p.id,
      projectName: p.name,
      status: p.status,
      logCount: acc.get(p.id)?.logCount ?? 0,
      lastLogAt: acc.get(p.id)?.lastLogAt?.toISOString().slice(0, 10) ?? null,
    }));
  }

  private toDto(w: WorkLogWithOptionalSegment) {
    return {
      id: w.id,
      taskId: w.taskId,
      segmentId: w.segmentId,
      segmentName: w.segment?.name ?? null,
      authorId: w.authorId,
      authorName: w.authorName,
      content: w.content,
      workedAt: w.workedAt.toISOString().slice(0, 10),
      isDeleted: w.isDeleted,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    };
  }
}
