import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { CommentService } from "../../application/comment.service";
import { CommentError } from "../../application/comment.service";
import type { AuthService } from "../../application/auth.service";
import { createAuthHook } from "../middleware/auth.middleware";
import { createCommentSchema, updateCommentSchema } from "../dtos/board.dto";
import { errorResponse, ErrorCode } from "@erp-ot/shared";
import { ZodError } from "zod";

function handleError(reply: FastifyReply, err: unknown) {
  if (err instanceof CommentError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: { code: "INVALID_INPUT", message: err.issues[0]?.message } });
  }
  throw err;
}

// 보안 일괄패치 iterate-1 (G6/FR-19): 라우트 단계 comment owner 사전 검증
// service 계층 검증(line 85,94)에 더해 라우트 단계에서도 명시적으로 차단 (defense-in-depth)
async function requireCommentOwnerOrAdmin(
  commentService: CommentService,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const { id } = req.params as { id: string };
  const userId = req.userId as string;
  const userRole = req.userRole as string;

  // ADMIN은 무조건 통과
  if (userRole === "ADMIN") return true;

  const comment = await commentService.findRaw(id);
  if (!comment) {
    reply.code(404).send(errorResponse(ErrorCode.NOT_FOUND, "댓글을 찾을 수 없습니다."));
    return false;
  }
  if (comment.authorId !== userId) {
    reply.code(403).send(errorResponse(ErrorCode.FORBIDDEN, "권한이 없습니다."));
    return false;
  }
  return true;
}

export async function commentRoutes(
  app: FastifyInstance,
  opts: { commentService: CommentService; authService: AuthService },
) {
  const { commentService, authService } = opts;
  const authenticate = createAuthHook(authService);

  // GET /api/v1/posts/:id/comments
  app.get("/posts/:id/comments", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const result = await commentService.list(id);
      return reply.send(result);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // POST /api/v1/posts/:id/comments
  app.post("/posts/:id/comments", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const dto = createCommentSchema.parse(req.body);
      const user = { id: req.userId, role: req.userRole };
      const created = await commentService.create(id, dto, user);
      return reply.code(201).send(created);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // PATCH /api/v1/comments/:id
  app.patch("/comments/:id", { preHandler: [authenticate] }, async (req, reply) => {
    // G6: 라우트 단계 owner 사전 검증
    const allowed = await requireCommentOwnerOrAdmin(commentService, req, reply);
    if (!allowed) return;
    try {
      const { id } = req.params as { id: string };
      const dto = updateCommentSchema.parse(req.body);
      const user = { id: req.userId, role: req.userRole };
      const updated = await commentService.update(id, dto.content, user);
      return reply.send(updated);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // DELETE /api/v1/comments/:id
  app.delete("/comments/:id", { preHandler: [authenticate] }, async (req, reply) => {
    // G6: 라우트 단계 owner 사전 검증
    const allowed = await requireCommentOwnerOrAdmin(commentService, req, reply);
    if (!allowed) return;
    try {
      const { id } = req.params as { id: string };
      const user = { id: req.userId, role: req.userRole };
      await commentService.softDelete(id, user);
      return reply.code(204).send();
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
