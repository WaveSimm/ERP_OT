import { FastifyInstance } from "fastify";

export async function internalRoutes(fastify: FastifyInstance) {
  // 보안 일괄패치 iterate-1: inline hook 제거 — shared requireInternal이 글로벌 onRequest로 처리
  // (services/shared/src/middleware/require-internal.ts 참고)

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
