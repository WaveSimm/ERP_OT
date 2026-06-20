import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ReceiptService } from "../../application/receipt.service";
import { validateReceipt } from "../../infrastructure/storage";
import type { LocalFsStorage } from "../../infrastructure/storage";

export async function receiptRoutes(
  app: FastifyInstance,
  opts: { service: ReceiptService; storage: LocalFsStorage; maxSize: number },
) {
  const { service, storage, maxSize } = opts;

  app.get("/", async (req) => {
    const q = req.query as { page?: string; limit?: string; ocrStatus?: string };
    return service.list(req.userId, {
      ...(q.page && { page: parseInt(q.page, 10) }),
      ...(q.limit && { limit: parseInt(q.limit, 10) }),
      ...(q.ocrStatus && { ocrStatus: q.ocrStatus }),
    });
  });

  app.get("/:id", async (req) => {
    const { id } = req.params as { id: string };
    return service.get(req.userId, id);
  });

  // multipart 업로드
  app.post("/", async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: { code: "NO_FILE", message: "파일이 필요합니다." } });

    const buf = await data.toBuffer();
    const fileName = data.filename || "receipt.jpg";
    const mimeType = data.mimetype || "application/octet-stream";

    const validation = validateReceipt({ fileName, fileSize: buf.length, mimeType, maxSize: maxSize });
    if (!validation.ok) {
      return reply.code(400).send({ error: { code: validation.code, message: validation.message } });
    }

    const receipt = await service.upload({ userId: req.userId, fileBuf: buf, fileName, mimeType });
    return reply.code(201).send(receipt);
  });

  // OCR 결과 수동 수정 (가맹점/금액/거래일)
  const PatchBody = z.object({
    extractedAmount: z.number().nullable().optional(),
    extractedMerchant: z.string().nullable().optional(),
    extractedDate: z.string().nullable().optional(), // ISO string
  });
  app.patch("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parse = PatchBody.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({ error: { code: "INVALID_BODY", message: parse.error.message } });
    }
    const body = parse.data;
    const data: Parameters<typeof service.update>[2] = {};
    if (body.extractedAmount !== undefined) data.extractedAmount = body.extractedAmount;
    if (body.extractedMerchant !== undefined) data.extractedMerchant = body.extractedMerchant;
    if (body.extractedDate !== undefined) {
      data.extractedDate = body.extractedDate ? new Date(body.extractedDate) : null;
    }
    return service.update(req.userId, id, data);
  });

  // 영수증 파일 다운로드 (storageKey 기반)
  app.get("/:id/download", async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await service.get(req.userId, id);
    // 보안(V-16): nosniff + 안전 타입만 inline, 그 외 attachment(저장형 XSS 방지)
    const INLINE_SAFE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);
    const disposition = INLINE_SAFE.has(r.fileType) ? "inline" : "attachment";
    reply.header("Content-Type", r.fileType);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(r.originalFileName)}`);
    return reply.send(storage.read(r.storageKey));
  });

  // 사용자가 그린 영역대로 분할 (이미지만 가능)
  const SplitBody = z.object({
    regions: z
      .array(
        z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          width: z.number().min(0).max(1),
          height: z.number().min(0).max(1),
        }),
      )
      .min(1)
      .max(20),
  });
  app.post("/:id/split", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parse = SplitBody.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({ error: { code: "INVALID_BODY", message: parse.error.message } });
    }
    try {
      const created = await service.splitByRegions(req.userId, id, parse.data.regions);
      return reply.code(201).send({ created });
    } catch (e) {
      return reply.code(400).send({ error: { code: "SPLIT_FAILED", message: String((e as Error).message ?? e) } });
    }
  });

  // 재OCR 트리거
  app.post("/:id/reprocess", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await service.reprocess(req.userId, id);
      return reply.code(202).send(result);
    } catch (e) {
      return reply.code(400).send({ error: { code: "REPROCESS_FAILED", message: String((e as Error).message ?? e) } });
    }
  });

  app.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.delete(req.userId, id);
    return reply.code(204).send();
  });
}
