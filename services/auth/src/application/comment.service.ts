import { PrismaClient } from "@prisma/client";
import type { AuthUserContext, CommentDto } from "../domain/board.types";
import { canComment } from "./board-permissions";
import { notifyMentions } from "./mention-notify.js";

export class CommentError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "CommentError";
  }
}

export class CommentService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(postId: string): Promise<CommentDto[]> {
    const comments = await this.prisma.comment.findMany({
      where: { postId },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, name: true } } },
    });
    const map = new Map<string, CommentDto>();
    const roots: CommentDto[] = [];

    for (const c of comments) {
      const dto: CommentDto = {
        id: c.id,
        postId: c.postId,
        authorId: c.authorId,
        authorName: c.author.name,
        parentId: c.parentId,
        content: c.isDeleted ? "(삭제된 댓글)" : c.content,
        isDeleted: c.isDeleted,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        children: [],
      };
      map.set(c.id, dto);
    }
    for (const c of comments) {
      const dto = map.get(c.id)!;
      if (c.parentId && map.has(c.parentId)) {
        map.get(c.parentId)!.children!.push(dto);
      } else {
        roots.push(dto);
      }
    }
    return roots;
  }

  async create(postId: string, data: { content: string; parentId?: string | undefined; mentionedUserIds?: string[] | undefined }, user: AuthUserContext) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { board: { include: { category: { select: { code: true } } } } },
    });
    if (!post) throw new CommentError("POST_NOT_FOUND", "글을 찾을 수 없습니다.", 404);
    if (post.isDeleted) throw new CommentError("POST_NOT_FOUND", "삭제된 글입니다.", 404);
    if (!canComment(post.board, user)) {
      throw new CommentError("FORBIDDEN_WRITE", "댓글 작성 권한이 없습니다.", 403);
    }

    if (data.parentId) {
      const parent = await this.prisma.comment.findUnique({ where: { id: data.parentId } });
      if (!parent || parent.postId !== postId) {
        throw new CommentError("COMMENT_NOT_FOUND", "부모 댓글을 찾을 수 없습니다.", 404);
      }
      // 1단계 대댓글만 허용 (parent의 parentId가 null이어야)
      if (parent.parentId) {
        throw new CommentError("INVALID_INPUT", "대댓글에는 댓글을 달 수 없습니다.", 400);
      }
    }

    const created = await this.prisma.comment.create({
      data: {
        postId,
        authorId: user.id,
        parentId: data.parentId ?? null,
        content: data.content,
      },
    });

    // @멘션 알림 (project 벨) — best-effort
    void notifyMentions({
      sourceType: "BOARD_COMMENT",
      sourceId: created.id,
      userIds: data.mentionedUserIds ?? [],
      actorId: user.id,
      preview: data.content,
      linkUrl: `/board/${post.board.category.code}/${post.board.code}/${postId}`,
    });

    return created;
  }

  // 보안 일괄패치 iterate-1 (G6): 라우트 단계 사전 검증용 — authorId만 반환
  async findRaw(commentId: string): Promise<{ id: string; authorId: string } | null> {
    return this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, authorId: true },
    });
  }

  async update(commentId: string, content: string, user: AuthUserContext, mentionedUserIds?: string[]) {
    const c = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: { post: { include: { board: { include: { category: { select: { code: true } } } } } } },
    });
    if (!c) throw new CommentError("COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.", 404);
    if (user.role !== "ADMIN" && c.authorId !== user.id) {
      throw new CommentError("FORBIDDEN_EDIT", "수정 권한이 없습니다.", 403);
    }
    const updated = await this.prisma.comment.update({ where: { id: commentId }, data: { content } });

    if (mentionedUserIds?.length) {
      void notifyMentions({
        sourceType: "BOARD_COMMENT",
        sourceId: commentId,
        userIds: mentionedUserIds,
        actorId: user.id,
        preview: content,
        linkUrl: `/board/${c.post.board.category.code}/${c.post.board.code}/${c.postId}`,
      });
    }

    return updated;
  }

  async softDelete(commentId: string, user: AuthUserContext) {
    const c = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!c) throw new CommentError("COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.", 404);
    if (user.role !== "ADMIN" && c.authorId !== user.id) {
      throw new CommentError("FORBIDDEN_EDIT", "삭제 권한이 없습니다.", 403);
    }
    await this.prisma.comment.update({ where: { id: commentId }, data: { isDeleted: true } });
  }
}
