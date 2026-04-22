import { FastifyInstance } from "fastify";
import { requireRole } from "../middleware/auth.middleware.js";

export async function ocrRoutes(fastify: FastifyInstance) {
  // GET /engines — 사용 가능한 OCR 엔진 목록
  fastify.get("/engines", async () => {
    return fastify.ocrEngine.listEngines();
  });

  // POST /scan — 이미지 업로드 + OCR 처리
  fastify.post("/scan", async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ code: "INVALID_FILE", message: "파일을 업로드해주세요." });
    }

    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];
    if (!allowedTypes.includes(data.mimetype)) {
      return reply.status(400).send({ code: "INVALID_FILE_TYPE", message: "PNG, JPG, PDF만 지원합니다." });
    }

    const buffer = await data.toBuffer();
    const maxSize = parseInt(process.env.MAX_FILE_SIZE_MB || "10") * 1024 * 1024;
    if (buffer.length > maxSize) {
      return reply.status(400).send({ code: "FILE_TOO_LARGE", message: `최대 ${process.env.MAX_FILE_SIZE_MB || 10}MB까지 업로드 가능합니다.` });
    }

    const body = data.fields as any;
    const templateCode = body?.templateCode?.value;
    const engineId = body?.engineId?.value;
    const forceOcr = body?.forceOcr?.value === "true";

    const result = await fastify.ocrService.scan(
      buffer,
      data.filename,
      data.mimetype,
      request.userId,
      templateCode,
      engineId,
      forceOcr,
    );

    return reply.status(201).send(result);

  });

  // POST /scan/diagnostic — 자동 KV 추출 (개발 진단 전용, DB 저장 없음)
  // 템플릿 없이 이미지에서 인식된 모든 라벨-값 쌍을 반환. 인식률 평가용.
  fastify.post("/scan/diagnostic", async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ code: "INVALID_FILE", message: "파일을 업로드해주세요." });
    }

    const buffer = await data.toBuffer();
    const body = data.fields as any;
    const engineId = body?.engineId?.value || "paddle-ko";
    const forceOcr = body?.forceOcr?.value === "true";
    const useLLM = body?.useLLM?.value === "true";

    // 1. OCR 엔진 호출 (DB 미저장)
    const ocrRaw = await fastify.ocrEngine.scan(buffer, engineId, forceOcr);

    // 2. 규칙 기반 KV 추출
    let extracted = fastify.autoExtractService.extractByRules(ocrRaw);

    // 3. 옵션: LLM 보완 (ANTHROPIC_API_KEY 있을 때만)
    if (useLLM) {
      extracted = await fastify.autoExtractService.enhanceWithLLM(extracted);
    }

    return reply.send({
      engineId,
      extractionMethod: ocrRaw.extractionMethod ?? "ocr", // "text-extract" (PDF 텍스트 레이어) | "ocr" (실제 OCR 엔진)
      forceOcr,
      ocrProcessingMs: ocrRaw.processingTimeMs,
      extraction: extracted,
      rawTextBlocks: ocrRaw.texts?.length ?? 0,
    });
  });

  // POST /scan/raw — 엔진 직접 호출 (DB 저장 없이 raw OCR 결과만 반환)
  fastify.post("/scan/raw", async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ code: "INVALID_FILE", message: "파일을 업로드해주세요." });
    }

    const buffer = await data.toBuffer();
    const body = data.fields as any;
    const engineId = body?.engineId?.value || "paddle-ko";
    const forceOcr = (request.query as any).forceOcr === "true";

    const result = await fastify.ocrEngine.scan(buffer, engineId, forceOcr);
    return reply.send({ engineId, ...result });
  });

  // GET /results — 처리 이력 목록
  fastify.get("/results", async (request) => {
    const query = request.query as Record<string, string>;
    const page = query.page ? parseInt(query.page) : 1;
    const limit = query.limit ? parseInt(query.limit) : 20;
    const params: { status?: string; templateCode?: string; page: number; limit: number } = { page, limit };
    if (query.status) params.status = query.status;
    if (query.templateCode) params.templateCode = query.templateCode;
    return fastify.ocrService.listResults(params);
  });

  // GET /results/:id — 처리 결과 상세
  fastify.get("/results/:id", async (request) => {
    const { id } = request.params as { id: string };
    return fastify.ocrService.getResultDetail(id);
  });

  // GET /results/:id/image — 원본 이미지 서빙
  fastify.get("/results/:id/image", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { buffer, mimeType } = await fastify.ocrService.getImage(id);
    return reply.type(mimeType).send(buffer);
  });

  // PATCH /results/:id/fields — 필드 수정
  fastify.patch("/results/:id/fields", async (request) => {
    const { id } = request.params as { id: string };
    const { fields } = request.body as { fields: Array<{ fieldKey: string; confirmedValue: string }> };
    return fastify.ocrService.updateFields(id, fields, request.userId);
  });

  // POST /results/:id/confirm — 확인 완료
  fastify.post("/results/:id/confirm", async (request) => {
    const { id } = request.params as { id: string };
    return fastify.ocrService.confirmResult(id);
  });

  // DELETE /results/:id — 결과 삭제
  fastify.delete("/results/:id", { preHandler: [requireRole("ADMIN")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await fastify.ocrService.deleteResult(id);
    return reply.status(204).send();
  });

  // GET /stats — 통계
  fastify.get("/stats", { preHandler: [requireRole("ADMIN", "MANAGER")] }, async () => {
    return fastify.templateService.getStats();
  });

  // GET /corrections/export — 학습 데이터 내보내기
  fastify.get("/corrections/export", { preHandler: [requireRole("ADMIN")] }, async (request) => {
    const { templateCode } = request.query as { templateCode?: string };
    return fastify.correctionService.exportForTraining(templateCode);
  });
}
