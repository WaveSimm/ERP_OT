import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import { PrismaClient } from "@prisma/client";

import { UserPrismaRepository } from "./infrastructure/repositories/user.prisma.repository";
import { AuthService } from "./application/auth.service";
import { UserService } from "./application/user.service";
import { authRoutes } from "./api/routes/auth.routes";
import { userRoutes } from "./api/routes/user.routes";
import { departmentRoutes } from "./api/routes/department.routes";
import { approvalLineRoutes } from "./api/routes/approval-line.routes";
import { internalRoutes } from "./api/routes/internal.routes";
import { boardRoutes } from "./api/routes/board.routes";
import { postRoutes } from "./api/routes/post.routes";
import { commentRoutes } from "./api/routes/comment.routes";
import { attachmentRoutes } from "./api/routes/attachment.routes";
import { calendarRoutes } from "./api/routes/calendar.routes";
import { searchRoutes } from "./api/routes/search.routes";
import { DepartmentService } from "./application/department.service";
import { ApprovalLineService } from "./application/approval-line.service";
import { BoardService } from "./application/board.service";
import { PostService } from "./application/post.service";
import { CommentService } from "./application/comment.service";
import { AttachmentService } from "./application/attachment.service";
import { NoticeNotifyHook } from "./application/notice-notify.hook";
import { CalendarService } from "./application/calendar.service";
import { EmbeddingService } from "./application/embedding.service";
import { SearchService } from "./application/search.service";
import { LocalFsStorage, ATTACHMENT_MAX_SIZE } from "./infrastructure/attachment-storage";
import { closePublisher } from "./infrastructure/event-publisher";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
  },
});

const prisma = new PrismaClient();

// ─── Plugins ──────────────────────────────────────────────────────────────────
app.register(fastifyCors, {
  origin: process.env.CORS_ORIGIN || "http://localhost:3000",
  credentials: true,
});

app.register(fastifyCookie);

app.register(fastifyMultipart, {
  limits: { fileSize: ATTACHMENT_MAX_SIZE },
});

// ─── Dependencies ──────────────────────────────────────────────────────────────
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "dev_access_secret_change_in_prod_32chars";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "dev_refresh_secret_change_in_prod_32chars";

const userRepo = new UserPrismaRepository(prisma);
const authService = new AuthService(userRepo, prisma, ACCESS_SECRET, REFRESH_SECRET);
const userService = new UserService(userRepo);
const deptService = new DepartmentService(prisma);
const approvalLineService = new ApprovalLineService(prisma);

// ─── 게시판 서비스 ─────────────────────────────────────────────────────────────
const boardService = new BoardService(prisma);
const postService = new PostService(prisma);
const commentService = new CommentService(prisma);
const attachmentStorage = new LocalFsStorage();
const attachmentService = new AttachmentService(prisma, attachmentStorage);
const noticeNotifyHook = new NoticeNotifyHook(prisma, app.log);
const calendarService = new CalendarService(prisma);
const embeddingService = new EmbeddingService(app.log);
const searchService = new SearchService(prisma, embeddingService, app.log);

// PostService에 임베딩 주입 (fire-and-forget hook 활성)
postService.setEmbedding(embeddingService, app.log);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", async () => {
  return { status: "ok", service: "auth-service", timestamp: new Date().toISOString() };
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.register(authRoutes, { prefix: "/api/v1/auth", authService, userRepo });
app.register(userRoutes, { prefix: "/api/v1/users", userService, authService });
app.register(departmentRoutes, { prefix: "/api/v1/departments", deptService, authService });
app.register(approvalLineRoutes, { prefix: "/api/v1/approval-lines", approvalLineService, authService });
app.register(internalRoutes, { prefix: "/internal", approvalLineService, deptService, calendarService, prisma });

// 게시판 라우트 (prefix: /api/v1)
app.register(boardRoutes, { prefix: "/api/v1", boardService, authService });
app.register(postRoutes, { prefix: "/api/v1", postService, boardService, authService, noticeNotifyHook, prisma });
app.register(commentRoutes, { prefix: "/api/v1", commentService, authService });
app.register(attachmentRoutes, { prefix: "/api/v1", attachmentService, authService, prisma });

// 회사 달력 라우트
app.register(calendarRoutes, { prefix: "/api/v1/calendar", calendarService, authService });

// 자연어 검색 라우트
app.register(searchRoutes, { prefix: "/api/v1", searchService, authService, prisma });

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3001", 10);

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`auth-service running on port ${PORT}`);
});

// Graceful shutdown
const shutdown = async () => {
  await closePublisher();
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
