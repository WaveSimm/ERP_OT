import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

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

// ─── Env 검증 (보안 일괄패치 PDCA Layer 1: C2 fallback 제거) ─────────────────
// 시크릿 누락 시 startup-time에 즉시 실패. 공개 fallback 문자열로 토큰 위조 방지.
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be >= 32 chars"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be >= 32 chars"),
  INTERNAL_API_TOKEN: z.string().min(16, "INTERNAL_API_TOKEN must be >= 16 chars"),
  PORT: z.string().default("3001"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  CORS_ORIGIN: z
    .string()
    .min(1, "CORS_ORIGIN required")
    .refine((v) => v !== "*", "CORS_ORIGIN cannot be '*' with credentials")
    .default("http://localhost:3000"),
  // Optional infra
  RABBITMQ_URL: z.string().optional(),
  ATTENDANCE_SERVICE_URL: z.string().default("http://attendance-service:3004"),
  PROJECT_SERVICE_URL: z.string().default("http://project-service:3003"),
  // Admin bootstrap
  ADMIN_EMAIL: z.string().email().default("admin@erp-ot.local"),
  ADMIN_INITIAL_PASSWORD: z.string().min(8, "ADMIN_INITIAL_PASSWORD must be >= 8 chars"),
  // Embedding/search (optional)
  OLLAMA_URL: z.string().default("http://ollama:11434"),
  EMBEDDING_MODEL: z.string().default("bge-m3"),
  EMBEDDING_TIMEOUT_MS: z.string().default("30000"),
  // Load test isolation
  HIDE_LOAD_TEST: z.string().default("true"),
  LOAD_TEST_DOMAIN: z.string().default("@erp-ot.load"),
  // Node env
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const env = envSchema.parse(process.env);

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
  },
});

const prisma = new PrismaClient();

// ─── Plugins ──────────────────────────────────────────────────────────────────
app.register(fastifyCors, {
  origin: env.CORS_ORIGIN,
  credentials: true,
});

app.register(fastifyCookie);

app.register(fastifyMultipart, {
  limits: { fileSize: ATTACHMENT_MAX_SIZE },
});

// ─── Dependencies ──────────────────────────────────────────────────────────────
const ACCESS_SECRET = env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = env.JWT_REFRESH_SECRET;

const userRepo = new UserPrismaRepository(prisma);
// 보안 일괄패치 PDCA Layer 3: logger 전달 (reuse detection alert용)
const authService = new AuthService(userRepo, prisma, ACCESS_SECRET, REFRESH_SECRET, app.log);
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
const PORT = parseInt(env.PORT, 10);

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
