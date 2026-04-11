import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

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

  fastify.get("/yearly", async () => {
    return fastify.repairStatsService.yearly();
  });

  fastify.get("/by-customer", async () => {
    return fastify.repairStatsService.byCustomer();
  });

  fastify.get("/by-handler", async () => {
    return fastify.repairStatsService.byHandler();
  });
}
