import { FastifyInstance } from "fastify";

export async function shipmentRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const { repairOrderId } = request.query as any;
    if (!repairOrderId) throw new Error("repairOrderId는 필수입니다.");
    return fastify.shipmentService.listByRepairOrder(repairOrderId);
  });

  fastify.get("/:id", async (request) => {
    const { id } = request.params as any;
    return fastify.shipmentService.getById(id);
  });

  fastify.post("/", async (request, reply) => {
    const result = await fastify.shipmentService.create(request.body as any);
    return reply.status(201).send(result);
  });

  fastify.patch("/:id", async (request) => {
    const { id } = request.params as any;
    return fastify.shipmentService.update(id, request.body as any);
  });

  fastify.patch("/:id/status", async (request) => {
    const { id } = request.params as any;
    const { status } = request.body as any;
    return fastify.shipmentService.changeStatus(id, status);
  });
}
