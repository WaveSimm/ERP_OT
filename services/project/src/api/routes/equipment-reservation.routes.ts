import { FastifyInstance } from "fastify";
import { z } from "zod";
import { EquipmentReservationService, ReservationContext } from "../../application/equipment-reservation.service.js";
import { AppError } from "@erp-ot/shared";
import {
  createReservationSchema,
  updateReservationSchema,
  listReservationQuerySchema,
  myReservationsQuerySchema,
  scopeQuerySchema,
  cancelReservationBodySchema,
} from "../dtos/equipment-reservation.dto.js";

// 공용자산예약 (2026-05-05)
// /api/v1/equipment-reservations

export async function equipmentReservationRoutes(app: FastifyInstance) {
  const svc = new EquipmentReservationService(app.prisma, process.env.STORAGE_PATH ?? "/app/storage");

  function requireOperatorOrAbove(role: string) {
    if (role !== "ADMIN" && role !== "MANAGER" && role !== "OPERATOR") {
      throw new AppError(403, "RESERVATION_FORBIDDEN", "예약 권한이 없습니다.");
    }
  }

  // GET /api/v1/equipment-reservations?from&to&resourceId&userId
  app.get("/", async (req, reply) => {
    const q = listReservationQuerySchema.parse(req.query);
    const items = await svc.listExpanded(q);
    return reply.send(items);
  });

  // GET /api/v1/equipment-reservations/mine?upcoming=true&limit=50
  app.get("/mine", async (req, reply) => {
    const q = myReservationsQuerySchema.parse(req.query);
    const items = await svc.listMine(req.userId, q);
    return reply.send(items);
  });

  // GET /api/v1/equipment-reservations/:id
  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await svc.getById(id);
    return reply.send(item);
  });

  // POST /api/v1/equipment-reservations (OPERATOR↑)
  app.post("/", async (req, reply) => {
    requireOperatorOrAbove(req.userRole);
    const body = createReservationSchema.parse(req.body);
    const created = await svc.create(body, { userId: req.userId, role: req.userRole as ReservationContext["role"] });
    return reply.status(201).send(created);
  });

  // PATCH /api/v1/equipment-reservations/:id?scope=instance|series
  app.patch("/:id", async (req, reply) => {
    requireOperatorOrAbove(req.userRole);
    const { id } = req.params as { id: string };
    const body = updateReservationSchema.parse(req.body);
    const { scope } = scopeQuerySchema.parse(req.query);
    const updated = await svc.update(
      id,
      body,
      { userId: req.userId, role: req.userRole as ReservationContext["role"] },
      scope ?? "series",
    );
    return reply.send(updated);
  });

  // DELETE /api/v1/equipment-reservations/:id?scope=instance|series&instanceStartAt=...
  app.delete("/:id", async (req, reply) => {
    requireOperatorOrAbove(req.userRole);
    const { id } = req.params as { id: string };
    const { scope } = scopeQuerySchema.parse(req.query);
    const q = req.query as { instanceStartAt?: string };
    const body = req.body ? cancelReservationBodySchema.parse(req.body) : { cancelReason: undefined };
    const result = await svc.cancel(
      id,
      { userId: req.userId, role: req.userRole as ReservationContext["role"] },
      scope ?? "series",
      body.cancelReason,
      q.instanceStartAt,
    );
    return reply.send(result);
  });

  // ─── 첨부 (차량정비 영수증·사진 등) ──────────────────────────────────────────────
  // GET /api/v1/equipment-reservations/:id/attachments
  app.get("/:id/attachments", async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(await svc.listAttachments(id));
  });

  // POST /api/v1/equipment-reservations/:id/attachments?category=FILE|IMAGE (multipart)
  app.post("/:id/attachments", async (req, reply) => {
    requireOperatorOrAbove(req.userRole);
    const { id } = req.params as { id: string };
    const { category: categoryRaw } = req.query as { category?: string };
    const category = categoryRaw === "IMAGE" ? "IMAGE" : "FILE";
    const data = await req.file();
    if (!data) {
      return reply.status(400).send({ code: "NO_FILE", message: "파일이 없습니다." });
    }
    const attachment = await svc.uploadAttachment(
      id,
      req.userId,
      { filename: data.filename, mimetype: data.mimetype, file: data.file },
      category,
    );
    return reply.status(201).send(attachment);
  });

  // GET /api/v1/equipment-reservations/:id/attachments/:attachmentId/download
  app.get("/:id/attachments/:attachmentId/download", async (req, reply) => {
    const { attachmentId } = req.params as { attachmentId: string };
    const { attachment, stream } = await svc.getAttachmentForDownload(attachmentId);
    return reply
      .header("Content-Type", attachment.mimeType)
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(attachment.fileName)}"`)
      .header("Content-Length", attachment.fileSize)
      .send(stream);
  });

  // DELETE /api/v1/equipment-reservations/:id/attachments/:attachmentId
  app.delete("/:id/attachments/:attachmentId", async (req, reply) => {
    requireOperatorOrAbove(req.userRole);
    const { attachmentId } = req.params as { attachmentId: string };
    await svc.deleteAttachment(attachmentId, req.userId, req.userRole);
    return reply.status(204).send();
  });
}
