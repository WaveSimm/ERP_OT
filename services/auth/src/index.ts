import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import { PrismaClient } from "@prisma/client";

import { UserPrismaRepository } from "./infrastructure/repositories/user.prisma.repository";
import { AuthService } from "./application/auth.service";
import { UserService } from "./application/user.service";
import { authRoutes } from "./api/routes/auth.routes";
import { userRoutes } from "./api/routes/user.routes";
import { departmentRoutes } from "./api/routes/department.routes";
import { approvalLineRoutes } from "./api/routes/approval-line.routes";
import { internalRoutes } from "./api/routes/internal.routes";
import { DepartmentService } from "./application/department.service";
import { ApprovalLineService } from "./application/approval-line.service";

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

// ─── Dependencies ──────────────────────────────────────────────────────────────
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "dev_access_secret_change_in_prod_32chars";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "dev_refresh_secret_change_in_prod_32chars";

const userRepo = new UserPrismaRepository(prisma);
const authService = new AuthService(userRepo, prisma, ACCESS_SECRET, REFRESH_SECRET);
const userService = new UserService(userRepo);
const deptService = new DepartmentService(prisma);
const approvalLineService = new ApprovalLineService(prisma);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", async () => {
  return { status: "ok", service: "auth-service", timestamp: new Date().toISOString() };
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.register(authRoutes, { prefix: "/api/v1/auth", authService, userRepo });
app.register(userRoutes, { prefix: "/api/v1/users", userService, authService });
app.register(departmentRoutes, { prefix: "/api/v1/departments", deptService });
app.register(approvalLineRoutes, { prefix: "/api/v1/approval-lines", approvalLineService, authService });
app.register(internalRoutes, { prefix: "/internal", approvalLineService, deptService, prisma });

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3001", 10);

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`auth-service running on port ${PORT}`);
});
