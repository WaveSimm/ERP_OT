import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCors from "@fastify/cors";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
  },
});

// ─── Plugins ──────────────────────────────────────────────────────────────────
app.register(fastifyCors, {
  origin: process.env.CORS_ORIGIN || "http://localhost:3000",
  credentials: true,
});

app.register(fastifyJwt, {
  secret: process.env.JWT_ACCESS_SECRET || "dev_secret_change_in_production",
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", async () => {
  return { status: "ok", service: "user-service", timestamp: new Date().toISOString() };
});

// ─── Routes ───────────────────────────────────────────────────────────────────
// TODO: Register user routes
// app.register(userRoutes, { prefix: "/api/v1/users" });

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3002", 10);

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`user-service running on port ${PORT}`);
});
