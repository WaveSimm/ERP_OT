import { FastifyInstance } from "fastify";
import { z } from "zod";

export async function internalRoutes(fastify: FastifyInstance) {
  const leaveSvc = fastify.leaveService;
  const otSvc = fastify.overtimeService;

  // Internal API 인증
  fastify.addHook("onRequest", async (req, reply) => {
    const token = req.headers["x-internal-token"];
    if (token !== process.env.INTERNAL_API_TOKEN) {
      return reply.status(403).send({ code: "FORBIDDEN", message: "Invalid internal token" });
    }
  });

  // POST /internal/leave/:id/framework-approve — 전자결재에서 휴가 승인
  fastify.post("/leave/:id/framework-approve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      approverId: z.string(),
      action: z.enum(["APPROVE", "REJECT"]),
      rejectReason: z.string().optional(),
    }).parse(req.body);

    if (body.action === "APPROVE") {
      const updated = await leaveSvc.approve(id, body.approverId);
      return reply.send(updated);
    } else {
      const updated = await leaveSvc.reject(id, body.approverId, body.rejectReason || "전자결재 반려");
      return reply.send(updated);
    }
  });

  // POST /internal/overtime/:id/framework-approve — 전자결재에서 OT 승인
  fastify.post("/overtime/:id/framework-approve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      approverId: z.string(),
      action: z.enum(["APPROVE", "REJECT"]),
      rejectReason: z.string().optional(),
    }).parse(req.body);

    if (body.action === "APPROVE") {
      const updated = await otSvc.approve(id, body.approverId);
      return reply.send(updated);
    } else {
      const updated = await otSvc.reject(id, body.approverId, body.rejectReason || "전자결재 반려");
      return reply.send(updated);
    }
  });

  // GET /internal/leave/pending — 결재 대기 휴가 목록 (approval-service 연동용)
  fastify.get("/leave/pending", async (req, reply) => {
    const q = req.query as { approverId?: string };
    if (!q.approverId) return reply.status(400).send({ code: "BAD_REQUEST", message: "approverId required" });
    return reply.send(await leaveSvc.getPending(q.approverId));
  });

  // GET /internal/overtime/pending — 결재 대기 OT 목록
  fastify.get("/overtime/pending", async (req, reply) => {
    const q = req.query as { approverId?: string };
    if (!q.approverId) return reply.status(400).send({ code: "BAD_REQUEST", message: "approverId required" });
    return reply.send(await otSvc.getPending(q.approverId));
  });
}
