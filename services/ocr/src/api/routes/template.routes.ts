import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function templateRoutes(fastify: FastifyInstance) {
  // GET / — 템플릿 목록
  fastify.get("/", async () => {
    return fastify.templateService.list();
  });

  // GET /:code — 템플릿 상세
  fastify.get("/:code", async (request) => {
    const { code } = request.params as { code: string };
    return fastify.templateService.getByCode(code);
  });

  // POST / — 템플릿 생성
  fastify.post("/", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const body = request.body as {
      code: string;
      name: string;
      description?: string;
      targetService: string;
      targetEndpoint: string;
      fields: Array<{
        key: string;
        label: string;
        aliases?: string[];
        type?: string;
        required?: boolean;
        sortOrder?: number;
        erpFieldName?: string;
        validation?: string;
      }>;
    };
    const template = await fastify.templateService.create(body);
    return reply.status(201).send(template);
  });

  // PUT /:code — 템플릿 수정
  fastify.put("/:code", { preHandler: [requireRole("ADMIN")] }, async (request) => {
    const { code } = request.params as { code: string };
    const body = request.body as any;
    return fastify.templateService.update(code, body);
  });
}
