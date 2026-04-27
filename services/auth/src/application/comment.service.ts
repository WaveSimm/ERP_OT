import { PrismaClient } from "@prisma/client";
import type { AuthUserContext, CommentDto } from "../domain/board.types";
import { canComment } from "./board-permissions";

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

  async create(postId: string, data: { content: string; parentId?: string | undefined }, user: AuthUserContext) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { board: true },
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

    return this.prisma.comment.create({
      data: {
        postId,
        authorId: user.id,
        parentId: data.parentId ?? null,
        content: data.content,
      },
    });
  }

  async update(commentId: string, content: string, user: AuthUserContext) {
    const c = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!c) throw new CommentError("COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.", 404);
    if (user.role !== "ADMIN" && c.authorId !== user.id) {
      throw new CommentError("FORBIDDEN_EDIT", "수정 권한이 없습니다.", 403);
    }
    return this.prisma.comment.update({ where: { id: commentId }, data: { content } });
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
