import { FastifyInstance } from "fastify";
import { z } from "zod";
import { CollabService } from "../../application/collab.service.js";
import { requireRole } from "../middleware/auth.middleware.js";

const createCommentSchema = z.object({
  content: z.string().min(1).max(5000),
  mentionedUserIds: z.array(z.string()).optional(),
});

const updateCommentSchema = z.object({
  content: z.string().min(1).max(5000),
  mentionedUserIds: z.array(z.string()).optional(),
});

const activityQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).optional(),
  pageSize: z.string().regex(/^\d+$/).optional(),
});

export async function collabRoutes(fastify: FastifyInstance) {
  const service: CollabService = fastify.collabService;

  // ─── Comments ─────────────────────────────────────────────────────────────

  // GET /api/v1/tasks/:taskId/comments
  fastify.get("/tasks/:taskId/comments", async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    return reply.send(await service.listComments(taskId));
  });

  // POST /api/v1/tasks/:taskId/comments
  fastify.post("/tasks/:taskId/comments", async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const dto = createCommentSchema.parse(req.body);
    const comment = await service.createComment(taskId, dto as any, req.userId);
    return reply.status(201).send(comment);
  });

  // PATCH /api/v1/tasks/:taskId/comments/:commentId
  fastify.patch("/tasks/:taskId/comments/:commentId", async (req, reply) => {
    const { commentId } = req.params as { taskId: string; commentId: string };
    const dto = updateCommentSchema.parse(req.body);
    return reply.send(await service.updateComment(commentId, dto as any, req.userId));
  });

  // DELETE /api/v1/tasks/:taskId/comments/:commentId
  fastify.delete("/tasks/:taskId/comments/:commentId", async (req, reply) => {
    const { commentId } = req.params as { taskId: string; commentId: string };
    await service.deleteComment(commentId, req.userId, req.userRole);
    return reply.status(204).send();
  });

  // ─── Attachments ───────────────────────────────────────────────────────────

  // GET /api/v1/tasks/:taskId/attachments
  fastify.get("/tasks/:taskId/attachments", async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    return reply.send(await service.listAttachments(taskId));
  });

  // POST /api/v1/tasks/:taskId/attachments — multipart/form-data
  fastify.post("/tasks/:taskId/attachments", async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const data = await req.file();
    if (!data) {
      return reply.status(400).send({ code: "NO_FILE", message: "파일이 없습니다." });
    }
    const attachment = await service.uploadAttachment(taskId, req.userId, {
      filename: data.filename,
      mimetype: data.mimetype,
      file: data.file,
    });
    return reply.status(201).send(attachment);
  });

  // GET /api/v1/attachments/:attachmentId/download
  fastify.get("/attachments/:attachmentId/download", async (req, reply) => {
    const { attachmentId } = req.params as { attachmentId: string };
    const { attachment, stream } = await service.getAttachmentForDownload(attachmentId);
    return reply
      .header("Content-Type", attachment.mimeType)
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(attachment.fileName)}"`)
      .header("Content-Length", attachment.fileSize)
      .send(stream);
  });

  // DELETE /api/v1/attachments/:attachmentId
  fastify.delete("/attachments/:attachmentId", async (req, reply) => {
    const { attachmentId } = req.params as { attachmentId: string };
    await service.deleteAttachment(attachmentId, req.userId, req.userRole);
    return reply.status(204).send();
  });

  // ─── Activity Feed ────────────────────────────────────────────────────────

  // GET /api/v1/projects/:projectId/activities
  fastify.get("/projects/:projectId/activities", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const q = activityQuerySchema.parse(req.query);
    const page = q.page ? parseInt(q.page, 10) : 1;
    const pageSize = q.pageSize ? Math.min(parseInt(q.pageSize, 10), 100) : 20;
    return reply.send(await service.listActivities(projectId, page, pageSize));
  });
}
