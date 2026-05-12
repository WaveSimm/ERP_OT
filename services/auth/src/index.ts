import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
// 보안 일괄패치 PDCA Layer 5 (H1)
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
// 보안 일괄패치 PDCA Layer 5 — rate-limit 정책 SSOT
import { rateLimitPolicies, rateLimitErrorResponseBuilder } from "@erp-ot/shared";

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
import { HolidaySyncService } from "./application/holiday-sync.service";
import { KasiClient } from "./infrastructure/clients/kasi-client";
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
  // 회사달력 v1.2 — 한국 공휴일 자동 갱신 (KASI 특일 정보 API)
  // 미설정 허용 — sync 호출 시에만 명시적 에러
  KASI_API_KEY: z.string().optional(),
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
// 보안 일괄패치 PDCA Layer 5 (H1): Helmet 보안 헤더 + Rate-limit
app.register(fastifyHelmet, {
  contentSecurityPolicy: false, // Next.js apps/web에서 처리
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
});
app.register(fastifyRateLimit, {
  ...rateLimitPolicies.default,
  errorResponseBuilder: rateLimitErrorResponseBuilder,
  // /internal/* — 서비스 간 호출(x-internal-token으로 인증)은 rate-limit 제외
  // 기본 정책은 IP 단위라 project-service 컨테이너에서 발생하는 다수 호출이 사용자 limit를 잠식하지 않도록 분리
  skipOnError: false,
  allowList: (req) => req.url.startsWith("/internal/"),
});

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

// v1.2 — KASI 한국 공휴일 자동 갱신 (KASI_API_KEY 미설정 시 null로 두고 sync 라우트는 503 응답)
const kasiClient = env.KASI_API_KEY ? new KasiClient(env.KASI_API_KEY) : null;
const holidaySyncService = kasiClient ? new HolidaySyncService(prisma, kasiClient) : null;

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
app.register(calendarRoutes, {
  prefix: "/api/v1/calendar",
  calendarService,
  authService,
  holidaySyncService,
});

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

  // v1.2 — 부팅 후 한국 공휴일 자동 갱신 (fire-and-forget)
  // 실패해도 서비스 부팅에 영향 없음. KASI_API_KEY 미설정 시 스킵.
  if (holidaySyncService) {
    setImmediate(async () => {
      const currentYear = new Date().getFullYear();
      const years = [currentYear, currentYear + 1];
      for (const year of years) {
        try {
          const result = await holidaySyncService.syncYear(year);
          app.log.info(
            { result },
            `[holiday-sync] ${year}: fetched=${result.fetched} created=${result.created} updated=${result.updated} deleted=${result.deleted} (${result.durationMs}ms)`,
          );
        } catch (err) {
          app.log.warn(
            { err, year },
            `[holiday-sync] ${year} 자동 갱신 실패 (서비스 정상 동작에 영향 없음)`,
          );
        }
      }
    });
  } else {
    app.log.info("[holiday-sync] KASI_API_KEY 미설정 — 한국 공휴일 자동 갱신 비활성");
  }
});

// Graceful shutdown
const shutdown = async () => {
  await closePublisher();
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
