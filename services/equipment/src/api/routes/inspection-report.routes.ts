import { FastifyInstance } from "fastify";

export async function inspectionReportRoutes(fastify: FastifyInstance) {
  // 조회
  fastify.get("/", async (request) => {
    const { repairOrderId } = request.query as any;
    if (!repairOrderId) throw new Error("repairOrderId는 필수입니다.");
    return fastify.inspectionReportService.getByRepairOrder(repairOrderId);
  });

  // 생성
  fastify.post("/", async (request, reply) => {
    const result = await fastify.inspectionReportService.create(request.body as any);
    return reply.status(201).send(result);
  });

  // 수정
  fastify.patch("/:id", async (request) => {
    const { id } = request.params as any;
    return fastify.inspectionReportService.update(id, request.body as any);
  });
}
