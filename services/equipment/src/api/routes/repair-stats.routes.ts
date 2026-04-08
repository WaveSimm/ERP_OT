import { FastifyInstance } from "fastify";

export async function repairStatsRoutes(fastify: FastifyInstance) {
  fastify.get("/summary", async () => {
    return fastify.repairStatsService.summary();
  });

  fastify.get("/by-equipment", async () => {
    return fastify.repairStatsService.byEquipment();
  });

  fastify.get("/monthly", async (request) => {
    const { months } = request.query as any;
    return fastify.repairStatsService.monthly(months ? Number(months) : 12);
  });

  fastify.get("/costs", async () => {
    return fastify.repairStatsService.costs();
  });

  fastify.get("/parts-usage", async () => {
    return fastify.repairStatsService.partsUsage();
  });
}
