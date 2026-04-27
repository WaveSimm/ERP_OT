import type { FastifyInstance } from "fastify";
import type { CommentService } from "../../application/comment.service";
import { CommentError } from "../../application/comment.service";
import type { AuthService } from "../../application/auth.service";
import { createAuthHook } from "../middleware/auth.middleware";
import { createCommentSchema, updateCommentSchema } from "../dtos/board.dto";

function handleError(reply: any, err: any) {
  if (err instanceof CommentError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  if (err?.name === "ZodError") {
    return reply.code(400).send({ error: { code: "INVALID_INPUT", message: err.issues?.[0]?.message } });
  }
  throw err;
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
      const user = { id: (req as any).userId, role: (req as any).userRole };
      const created = await commentService.create(id, dto, user);
      return reply.code(201).send(created);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // PATCH /api/v1/comments/:id
  app.patch("/comments/:id", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const dto = updateCommentSchema.parse(req.body);
      const user = { id: (req as any).userId, role: (req as any).userRole };
      const updated = await commentService.update(id, dto.content, user);
      return reply.send(updated);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // DELETE /api/v1/comments/:id
  app.delete("/comments/:id", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const user = { id: (req as any).userId, role: (req as any).userRole };
      await commentService.softDelete(id, user);
      return reply.code(204).send();
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
