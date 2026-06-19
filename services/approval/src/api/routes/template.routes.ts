import { FastifyInstance } from "fastify";
import { Prisma, TemplateCategory } from "@prisma/client";
import { TemplateService } from "../../application/template.service";
import { requireRole } from "../middleware/auth.middleware";

export async function templateRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { category?: string; activeOnly?: string } }>("/", async (request) => {
    const { category, activeOnly } = request.query;
    return fastify.templateService.list({
      category: category ? (category as TemplateCategory) : undefined,
      activeOnly: activeOnly !== "false",
    });
  });

  fastify.get<{ Params: { id: string } }>("/:id", async (request) => {
    return fastify.templateService.getById(request.params.id);
  });

  fastify.post<{ Body: Parameters<TemplateService["create"]>[0] }>("/", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const result = await fastify.templateService.create(request.body);
    return reply.status(201).send(result);
  });

  fastify.put<{ Params: { id: string }; Body: Prisma.ApprovalTemplateUncheckedUpdateInput }>("/:id", { preHandler: [requireRole("ADMIN")] }, async (request) => {
    const { id } = request.params;
    return fastify.templateService.update(id, request.body);
  });

  fastify.delete<{ Params: { id: string } }>("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.templateService.remove(request.params.id);
    return reply.status(204).send();
  });
}
