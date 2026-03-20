import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import { PrismaClient } from "@prisma/client";

import { UserPrismaRepository } from "./infrastructure/repositories/user.prisma.repository";
import { AuthService } from "./application/auth.service";
import { UserService } from "./application/user.service";
import { authRoutes } from "./api/routes/auth.routes";
import { userRoutes } from "./api/routes/user.routes";

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

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", async () => {
  return { status: "ok", service: "auth-service", timestamp: new Date().toISOString() };
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.register(authRoutes, { prefix: "/api/v1/auth", authService, userRepo });
app.register(userRoutes, { prefix: "/api/v1/users", userService, authService });

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3001", 10);

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`auth-service running on port ${PORT}`);
});
