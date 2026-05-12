import type { FastifyInstance } from "fastify";
import type { StatementService } from "../../application/statement.service";

export async function statementRoutes(app: FastifyInstance, opts: { service: StatementService }) {
  const { service } = opts;

  app.get("/", async (req) => {
    const q = req.query as { page?: string; limit?: string };
    return service.list(req.userId, {
      ...(q.page && { page: parseInt(q.page, 10) }),
      ...(q.limit && { limit: parseInt(q.limit, 10) }),
    });
  });

  app.get("/:id", async (req) => {
    const { id } = req.params as { id: string };
    return service.get(req.userId, id);
  });

  // multipart 업로드 — file (필수), sourceId (선택)
  app.post("/import", async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: { code: "NO_FILE", message: "파일이 필요합니다." } });

    const buf = await data.toBuffer();
    const fileName = data.filename || "unknown.xls";

    // multipart fields에서 sourceId 추출 (있으면)
    const sourceIdField = data.fields?.sourceId as { value?: string } | undefined;
    const sourceId = sourceIdField?.value;

    try {
      const result = await service.import({
        userId: req.userId,
        fileBuf: buf,
        fileName,
        ...(sourceId && { sourceId }),
      });
      return reply.code(200).send(result);
    } catch (err: any) {
      return reply.code(400).send({ error: { code: "IMPORT_FAILED", message: err.message } });
    }
  });
}
