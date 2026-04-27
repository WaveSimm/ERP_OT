import type { FastifyInstance } from "fastify";
import type { AttachmentService } from "../../application/attachment.service";
import { AttachmentError } from "../../application/attachment.service";
import type { AuthService } from "../../application/auth.service";
import { createAuthHook } from "../middleware/auth.middleware";

function handleError(reply: any, err: any) {
  if (err instanceof AttachmentError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  throw err;
}

export async function attachmentRoutes(
  app: FastifyInstance,
  opts: { attachmentService: AttachmentService; authService: AuthService; prisma: any },
) {
  const { attachmentService, authService, prisma } = opts;
  const authenticate = createAuthHook(authService);

  // POST /api/v1/attachments/upload (multipart)
  app.post("/attachments/upload", { preHandler: [authenticate] }, async (req: any, reply) => {
    try {
      const data = await req.file();
      if (!data) {
        return reply.code(400).send({ error: { code: "INVALID_INPUT", message: "파일이 없습니다." } });
      }
      const buffer = await data.toBuffer();
      const isInline = ((req.query as any)?.isInline ?? "false") === "true";
      const user = { id: req.userId, role: req.userRole };
      const att = await attachmentService.upload({
        buffer,
        fileName: data.filename,
        fileSize: buffer.length,
        mimeType: data.mimetype,
        isInline,
      }, user);
      return reply.code(201).send({
        id: att.id,
        fileName: att.fileName,
        fileSize: att.fileSize,
        mimeType: att.mimeType,
        isInline: att.isInline,
        url: `/api/v1/attachments/${att.id}`,
        uploadedAt: att.uploadedAt,
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // GET /api/v1/attachments/:id
  app.get("/attachments/:id", { preHandler: [authenticate] }, async (req: any, reply) => {
    try {
      const { id } = req.params as { id: string };
      // 권한 검증을 위해 사용자 부서까지 조회
      const profile = await prisma.userProfile.findUnique({
        where: { userId: req.userId },
        select: { departmentId: true },
      });
      const user = { id: req.userId, role: req.userRole, departmentId: profile?.departmentId ?? null };
      const { stream, fileName, mimeType, fileSize } = await attachmentService.getDownload(id, user);
      reply.header("Content-Type", mimeType);
      reply.header("Content-Length", String(fileSize));
      reply.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      return reply.send(stream);
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
