import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
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
import { ZodError } from "zod";

function extractUser(req: FastifyRequest): AuthUserContext {
  return { id: req.userId, role: req.userRole };
}

async function extractUserWithDept(req: FastifyRequest, prisma: PrismaClient): Promise<AuthUserContext> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId: req.userId },
    select: { departmentId: true },
  });
  return { id: req.userId, role: req.userRole, departmentId: profile?.departmentId ?? null };
}

function handleError(reply: FastifyReply, err: unknown) {
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
    prisma: PrismaClient;
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
          readAudience: board.readAudience,
          audienceTargetId: board.audienceTargetId,
          targetDepartmentId: dto.targetDepartmentId ?? null,
        });
      }

      return reply.code(201).send(created);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({ error: { code: "INVALID_INPUT", message: err.issues[0]?.message ?? "입력 오류" } });
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
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({ error: { code: "INVALID_INPUT", message: err.issues[0]?.message } });
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
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({ error: { code: "INVALID_INPUT", message: err.issues[0]?.message } });
      }
      return handleError(reply, err);
    }
  });

  // ─────────────────────────────────────────────────────
  // 게시판 design v2.0 (2026-05-22): 기능 요구 카테고리 전용
  // ─────────────────────────────────────────────────────

  // PATCH /api/v1/posts/:id/feature-status
  app.patch("/posts/:id/feature-status", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const dto = req.body as {
        requestStatus: "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "ON_HOLD";
        releaseVersion?: string | null;
      };
      const validStatuses = ["SUBMITTED","UNDER_REVIEW","APPROVED","IN_PROGRESS","COMPLETED","REJECTED","ON_HOLD"];
      if (!dto?.requestStatus || !validStatuses.includes(dto.requestStatus)) {
        return reply.code(400).send({ error: { code: "INVALID_INPUT", message: "requestStatus가 올바르지 않습니다." } });
      }
      const user = extractUser(req);
      const result = await postService.updateFeatureStatus(id, dto, user);
      return reply.send(result);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // PATCH /api/v1/posts/:id/feature-assign
  app.patch("/posts/:id/feature-assign", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const dto = req.body as { assigneeId: string | null };
      if (dto?.assigneeId !== null && typeof dto?.assigneeId !== "string") {
        return reply.code(400).send({ error: { code: "INVALID_INPUT", message: "assigneeId는 문자열 또는 null이어야 합니다." } });
      }
      const user = extractUser(req);
      const result = await postService.assignFeature(id, dto, user);
      return reply.send(result);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // GET /api/v1/feature-requests/stats (관리자 대시보드)
  app.get("/feature-requests/stats", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const user = extractUser(req);
      if (user.role !== "ADMIN") {
        return reply.code(403).send({ error: { code: "FORBIDDEN", message: "관리자만 접근 가능합니다." } });
      }
      const result = await postService.getFeatureRequestStats();
      return reply.send(result);
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
