import { FastifyInstance } from "fastify";
import { ProjectStatus } from "@prisma/client";
import { createMentions } from "../../application/mention.util.js";

export async function internalRoutes(fastify: FastifyInstance) {
  // POST /internal/mentions — 타 서비스(auth 게시판 등)가 멘션 알림을 적재 (X-Internal-Token)
  //   게시판 본문은 auth DB에 있으므로 preview/linkUrl을 함께 받아 저장(저장형).
  fastify.post("/mentions", async (req, reply) => {
    const body = req.body as {
      sourceType?: string;
      sourceId?: string;
      userIds?: string[];
      actorId?: string;
      preview?: string;
      linkUrl?: string;
    };
    if (!body.sourceType || !body.sourceId || !Array.isArray(body.userIds)) {
      return reply.code(400).send({ code: "INVALID_BODY", message: "sourceType, sourceId, userIds 필요" });
    }
    const created = await createMentions(fastify.prisma, {
      sourceType: body.sourceType,
      sourceId: body.sourceId,
      userIds: body.userIds,
      actorId: body.actorId,
      preview: body.preview ?? null,
      linkUrl: body.linkUrl ?? null,
    });
    return reply.send({ created: created.length });
  });
  // 보안 일괄패치 iterate-1: inline hook 제거 — shared requireInternal이 글로벌 onRequest로 처리
  // (services/shared/src/middleware/require-internal.ts 참고)

  // GET /internal/projects — 외부 사내서비스(photo-album 등)용 경량 프로젝트 목록
  // X-Internal-Token 으로 인증(글로벌 requireInternal). id/name/status 만 반환.
  fastify.get<{ Querystring: { status?: string; search?: string; limit?: string } }>("/projects", async (req, reply) => {
    const q = req.query;
    const result = await fastify.projectService.listProjects({
      status: q.status as ProjectStatus | undefined,
      search: q.search,
      page: 1,
      limit: q.limit ? Math.min(500, parseInt(q.limit, 10)) : 300,
    });
    return reply.send({
      items: (result.items ?? []).map((p) => ({ id: p.id, name: p.name, status: p.status })),
      total: result.total,
    });
  });

  // POST /internal/work-logs/semantic-search — auth-service에서 호출 (하이브리드 검색)
  fastify.post("/work-logs/semantic-search", async (req, reply) => {
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
