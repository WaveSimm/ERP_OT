import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { AttachmentService } from "../../application/attachment.service";
import { AttachmentError } from "../../application/attachment.service";
import type { AuthService } from "../../application/auth.service";
import { createAuthHook } from "../middleware/auth.middleware";

function handleError(reply: FastifyReply, err: unknown) {
  if (err instanceof AttachmentError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  throw err;
}

export async function attachmentRoutes(
  app: FastifyInstance,
  opts: { attachmentService: AttachmentService; authService: AuthService; prisma: PrismaClient },
) {
  const { attachmentService, authService, prisma } = opts;
  const authenticate = createAuthHook(authService);

  // POST /api/v1/attachments/upload (multipart)
  app.post("/attachments/upload", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const data = await req.file();
      if (!data) {
        return reply.code(400).send({ error: { code: "INVALID_INPUT", message: "파일이 없습니다." } });
      }
      const buffer = await data.toBuffer();
      const isInline = ((req.query as { isInline?: string })?.isInline ?? "false") === "true";
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
  app.get("/attachments/:id", { preHandler: [authenticate] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      // 권한 검증을 위해 사용자 부서까지 조회
      const profile = await prisma.userProfile.findUnique({
        where: { userId: req.userId },
        select: { departmentId: true },
      });
      const user = { id: req.userId, role: req.userRole, departmentId: profile?.departmentId ?? null };
      const { stream, fileName, mimeType, fileSize } = await attachmentService.getDownload(id, user);
      // 보안(V-16): nosniff + 안전 타입만 inline, 그 외 attachment(저장형 XSS 방지)
      const INLINE_SAFE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);
      const disposition = INLINE_SAFE.has(mimeType) ? "inline" : "attachment";
      reply.header("Content-Type", mimeType);
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Content-Length", String(fileSize));
      reply.header("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      return reply.send(stream);
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
