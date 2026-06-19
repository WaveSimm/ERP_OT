import { FastifyInstance } from "fastify";
import { createReadStream } from "fs";
import { requireRole } from "../middleware/auth.middleware";

export async function fileRoutes(fastify: FastifyInstance) {
  // 파일 업로드 (documentId 또는 referenceType+referenceId)
  fastify.post<{ Querystring: { documentId?: string; referenceType?: string; referenceId?: string } }>("/upload", { preHandler: [requireRole("ADMIN", "MANAGER", "OPERATOR")] }, async (request, reply) => {
    const data = await request.file();
    if (!data) throw new Error("파일이 필요합니다.");

    const { documentId, referenceType, referenceId } = request.query;
    const buffer = await data.toBuffer();

    const result = await fastify.fileService.upload({
      documentId: documentId || undefined,
      referenceType: referenceType || undefined,
      referenceId: referenceId || undefined,
      fileName: data.filename,
      fileBuffer: buffer,
      mimeType: data.mimetype,
      uploadedBy: request.userId,
    });

    return reply.status(201).send(result);
  });

  // 문서별 첨부 목록
  fastify.get<{ Params: { documentId: string } }>("/document/:documentId", async (request) => {
    return fastify.fileService.listByDocument(request.params.documentId);
  });

  // referenceType/referenceId 기반 첨부 목록
  fastify.get<{ Params: { referenceType: string; referenceId: string } }>("/reference/:referenceType/:referenceId", async (request) => {
    const { referenceType, referenceId } = request.params;
    return fastify.fileService.listByReference(referenceType, referenceId);
  });

  // 파일 다운로드
  fastify.get<{ Params: { id: string } }>("/:id/download", async (request, reply) => {
    const att = await fastify.prisma.attachment.findUnique({
      where: { id: request.params.id },
    });
    if (!att) throw new Error("파일을 찾을 수 없습니다.");

    const filePath = fastify.fileService.getFilePath(att.storagePath);
    const stream = createReadStream(filePath);
    return reply
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(att.fileName)}"`)
      .header("Content-Type", att.mimeType)
      .send(stream);
  });

  // 파일 삭제
  fastify.delete<{ Params: { id: string } }>("/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    await fastify.fileService.remove(request.params.id);
    return reply.status(204).send();
  });
}
