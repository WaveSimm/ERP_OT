import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SourceService } from "../../application/source.service";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().max(100).optional(),
  type: z.enum(["CARD_SHINHAN", "CARD_HYUNDAI", "CARD_KB", "CARD_OTHER", "CASH"]),
  cardNumber: z.string().max(50).optional(),
  ownership: z.enum(["PERSONAL", "CORPORATE"]).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  displayName: z.string().max(100).nullable().optional(),
  type: z.enum(["CARD_SHINHAN", "CARD_HYUNDAI", "CARD_KB", "CARD_OTHER", "CASH"]).optional(),
  cardNumber: z.string().max(50).nullable().optional(),
  ownership: z.enum(["PERSONAL", "CORPORATE"]).optional(),
  active: z.boolean().optional(),
});

export async function sourceRoutes(app: FastifyInstance, opts: { service: SourceService }) {
  const { service } = opts;

  app.get("/", async (req) => {
    const q = req.query as { includeInactive?: string };
    return service.list(req.userId, q.includeInactive === "true");
  });

  app.get("/:id", async (req) => {
    const { id } = req.params as { id: string };
    return service.get(req.userId, id);
  });

  app.post("/", async (req, reply) => {
    const body = createSchema.parse(req.body);
    const created = await service.create({ userId: req.userId, ...body });
    return reply.code(201).send(created);
  });

  app.patch("/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    return service.update(req.userId, id, body);
  });

  app.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.deactivate(req.userId, id);
    return reply.code(204).send();
  });
}
