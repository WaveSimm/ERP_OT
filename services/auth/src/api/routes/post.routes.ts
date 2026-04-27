import type { FastifyInstance } from "fastify";
import type { PostService } from "../../application/post.service";
import type { BoardService } from "../../application/board.service";
import type { AuthService } from "../../application/auth.service";
import type { NoticeNotifyHook } from "../../application/notice-notify.hook";
import { PostError } from "../../application/post.service";
import { createAuthHook } from "../middleware/auth.middleware";
import { canWrite } from "../../application/board-permissions";
import {
  createPostSchema,
  updatePostSchema,
  togglePinSchema,
  listPostsQuerySchema,
  feedQuerySchema,
} from "../dtos/board.dto";
import type { AuthUserContext } from "../../domain/board.types";

function extractUser(req: any): AuthUserContext {
  return { id: req.userId, role: req.userRole };
}

async function extractUserWithDept(req: any, prisma: any): Promise<AuthUserContext> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId: req.userId },
    select: { departmentId: true },
  });
  return { id: req.userId, role: req.userRole, departmentId: profile?.departmentId ?? null };
}

function handleError(reply: any, err: any) {
  if (err instanceof PostError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  throw err;
}

export async function postRoutes(
  app: FastifyInstance,
  opts: {
    postService: PostService;
    boardService: BoardService;
    authService: AuthService;
    noticeNotifyHook: NoticeNotifyHook;
    prisma: any;
  },
) {
  const { postService, boardService, authService, noticeNotifyHook, prisma } = opts;
  const authenticate = createAuthHook(authService);

  // GET /api/v1/boards/:code/posts
  app.get("/boards/:code/posts", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const { code } = req.params as { code: string };
      const q = listPostsQuerySchema.parse(req.query);
      const user = await extractUserWithDept(req, prisma);
      const result = await postService.list(code, q, user);
      return reply.send(result);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // GET /api/v1/posts/feed
  app.get("/posts/feed", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const q = feedQuerySchema.parse(req.query);
      const user = extractUser(req);
      const result = await postService.getFeed(q, user);
      return reply.send(result);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // GET /api/v1/posts/me/unread-count
  app.get("/posts/me/unread-count", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const q = req.query as { categoryCode?: string };
      const user = extractUser(req);
      const result = await postService.getMyUnreadCount(user, q.categoryCode);
      return reply.send(result);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // GET /api/v1/posts/:id
  app.get("/posts/:id", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const user = await extractUserWithDept(req, prisma);
      const result = await postService.getDetail(id, user);
      return reply.send(result);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // POST /api/v1/boards/:code/posts
  app.post("/boards/:code/posts", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const { code } = req.params as { code: string };
      const dto = createPostSchema.parse(req.body);

      const board = await boardService.getBoardByCode(code);
      if (!board) {
        return reply.code(404).send({ error: { code: "BOARD_NOT_FOUND", message: "보드를 찾을 수 없습니다." } });
      }
      const user = extractUser(req);
      if (!canWrite(board, user)) {
        return reply.code(403).send({ error: { code: "FORBIDDEN_WRITE", message: "작성 권한이 없습니다." } });
      }

      const postId = await postService.create(code, dto, user);
      const created = await postService.getDetail(postId, await extractUserWithDept(req, prisma));

      // 공지 카테고리면 알림 발송 (fire-and-forget)
      if (board.category.code === "notice") {
        // 본문 첫 100자
        const summary = dto.content.replace(/[#*`>_~\-\[\]\(\)!]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
        void noticeNotifyHook.fire({
          postId,
          boardCode: board.code,
          boardName: board.name,
          title: dto.title,
          contentSummary: summary,
          priority: dto.priority ?? 0,
          publishingDepartmentId: created.publishingDepartment?.id ?? null,
          readAudience: board.readAudience as any,
          audienceTargetId: board.audienceTargetId,
        });
      }

      return reply.code(201).send(created);
    } catch (err: any) {
      if (err?.name === "ZodError") {
        return reply.code(400).send({ error: { code: "INVALID_INPUT", message: err.issues?.[0]?.message ?? "입력 오류" } });
      }
      return handleError(reply, err);
    }
  });

  // PATCH /api/v1/posts/:id
  app.patch("/posts/:id", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const dto = updatePostSchema.parse(req.body);
      const user = extractUser(req);
      const updated = await postService.update(id, dto, user);
      return reply.send(updated);
    } catch (err: any) {
      if (err?.name === "ZodError") {
        return reply.code(400).send({ error: { code: "INVALID_INPUT", message: err.issues?.[0]?.message } });
      }
      return handleError(reply, err);
    }
  });

  // DELETE /api/v1/posts/:id
  app.delete("/posts/:id", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const user = extractUser(req);
      await postService.softDelete(id, user);
      return reply.code(204).send();
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // POST /api/v1/posts/:id/pin
  app.post("/posts/:id/pin", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const dto = togglePinSchema.parse(req.body);
      const user = extractUser(req);
      const result = await postService.togglePin(id, dto.isPinned, user);
      return reply.send(result);
    } catch (err: any) {
      if (err?.name === "ZodError") {
        return reply.code(400).send({ error: { code: "INVALID_INPUT", message: err.issues?.[0]?.message } });
      }
      return handleError(reply, err);
    }
  });
}
