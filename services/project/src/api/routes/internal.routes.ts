import { FastifyInstance } from "fastify";

export async function internalRoutes(fastify: FastifyInstance) {
  // 내부 API 인증 훅
  fastify.addHook("onRequest", async (req, reply) => {
    const token = req.headers["x-internal-token"];
    if (token !== process.env.INTERNAL_API_TOKEN) {
      return reply.status(401).send({ code: "UNAUTHORIZED", message: "내부 API 인증 실패" });
    }
  });

  // POST /internal/work-logs/semantic-search — auth-service에서 호출 (하이브리드 검색)
  fastify.post("/work-logs/semantic-search", async (req: any, reply) => {
    const body = req.body as {
      queryVec?: number[];
      q?: string;
      userId?: string;
      userEmail?: string;
      userRole?: string;
      limit?: number;
    };
    if (
      !Array.isArray(body.queryVec) ||
      typeof body.q !== "string" ||
      !body.userId ||
      !body.userEmail ||
      !body.userRole
    ) {
      return reply.status(400).send({ code: "BAD_REQUEST", message: "invalid params" });
    }
    const items = await fastify.workLogService.semanticSearch(
      body.queryVec,
      body.q,
      { id: body.userId, email: body.userEmail, role: body.userRole },
      Math.min(50, body.limit ?? 40),
    );
    return reply.send(items);
  });
}
