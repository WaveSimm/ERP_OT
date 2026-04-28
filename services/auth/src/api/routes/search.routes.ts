import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SearchService } from "../../application/search.service";
import { SearchError } from "../../application/search.service";
import type { AuthService } from "../../application/auth.service";
import { createAuthHook } from "../middleware/auth.middleware";

const querySchema = z.object({
  q: z.string().min(1),
  scope: z.enum(["all", "posts", "worklogs"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export async function searchRoutes(
  app: FastifyInstance,
  opts: { searchService: SearchService; authService: AuthService; prisma: any },
) {
  const { searchService, authService, prisma } = opts;
  const authenticate = createAuthHook(authService);

  app.get("/search", { preHandler: [authenticate] }, async (req: any, reply) => {
    try {
      const q = querySchema.parse(req.query);
      const profile = await prisma.userProfile.findUnique({
        where: { userId: req.userId },
        select: { departmentId: true },
      });
      const user = {
        id: req.userId,
        email: req.userEmail,
        role: req.userRole,
        departmentId: profile?.departmentId ?? null,
      };
      const result = await searchService.search(
        q.q,
        q.scope ?? "all",
        q.limit ?? 20,
        user,
      );
      return reply.send({ query: q.q, ...result });
    } catch (err: any) {
      if (err instanceof SearchError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      if (err?.name === "ZodError") {
        return reply.code(400).send({ error: { code: "INVALID_INPUT", message: err.issues?.[0]?.message } });
      }
      throw err;
    }
  });
}
