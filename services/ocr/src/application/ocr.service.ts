import { PrismaClient } from "@prisma/client";
import { OcrEngine, OcrRawResult } from "../infrastructure/engines/engine.interface.js";
import { MappingService, MappedField } from "./mapping.service.js";
import path from "path";
import fs from "fs/promises";

export class OcrService {
  constructor(
    private prisma: PrismaClient,
    private ocrEngine: OcrEngine,
    private mappingService: MappingService,
    private uploadDir: string,
  ) {}

  async scan(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    userId: string,
    templateCode?: string,
    engineId?: string,
    forceOcr?: boolean,
  ) {
    // 1. 파일 저장
    const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(fileName)}`;
    const storedPath = path.join(this.uploadDir, storedName);
    await fs.mkdir(this.uploadDir, { recursive: true });
    await fs.writeFile(storedPath, fileBuffer);

    // 2. OcrResult 레코드 생성 (PROCESSING)
    const result = await this.prisma.ocrResult.create({
      data: {
        originalFileName: fileName,
        storedFilePath: storedPath,
        fileSize: fileBuffer.length,
        mimeType,
        status: "PROCESSING",
        createdBy: userId,
      },
    });

    try {
      // 3. OCR 엔진 호출
      const ocrRaw = await this.ocrEngine.scan(fileBuffer, engineId, forceOcr);

      // 4. 문서 유형 판별 (미지정 시 자동 판별)
      const detectedCode = templateCode || this.mappingService.detectDocumentType(ocrRaw.texts);
      if (!detectedCode) {
        await this.prisma.ocrResult.update({
          where: { id: result.id },
          data: { status: "PENDING_REVIEW", rawOcrOutput: ocrRaw as any, processingTimeMs: ocrRaw.processingTimeMs },
        });
        return this.getResultDetail(result.id);
      }

      // 5. 템플릿 조회
      const template = await this.prisma.documentTemplate.findUnique({
        where: { code: detectedCode },
        include: { fields: { orderBy: { sortOrder: "asc" } } },
      });

      // 6. 필드 매핑
      const mappedFields: MappedField[] = template
        ? this.mappingService.mapFields(ocrRaw.texts, template.fields)
        : [];

      const avgConfidence = mappedFields.length > 0
        ? mappedFields.reduce((sum, f) => sum + f.confidence, 0) / mappedFields.length
        : 0;

      // 7. 결과 업데이트 + 필드 저장
      await this.prisma.ocrResult.update({
        where: { id: result.id },
        data: {
          templateId: template?.id ?? null,
          templateCode: detectedCode,
          status: "PENDING_REVIEW",
          overallConfidence: avgConfidence,
          processingTimeMs: ocrRaw.processingTimeMs,
          rawOcrOutput: ocrRaw as any,
          fields: {
            createMany: {
              data: mappedFields.map((f) => ({
                fieldKey: f.fieldKey,
                ocrValue: f.ocrValue ?? null,
                parsedValue: f.parsedValue ?? null,
                confidence: f.confidence,
                boundingBox: f.boundingBox ? (f.boundingBox as any) : null,
              })),
            },
          },
        },
      });

      return this.getResultDetail(result.id);
    } catch (error) {
      await this.prisma.ocrResult.update({
        where: { id: result.id },
        data: { status: "FAILED" },
      });
      throw error;
    }
  }

  async getResultDetail(id: string) {
    const result = await this.prisma.ocrResult.findUniqueOrThrow({
      where: { id },
      include: {
        fields: true,
        template: { include: { fields: { orderBy: { sortOrder: "asc" } } } },
      },
    });
    return result;
  }

  async listResults(params: {
    status?: string;
    templateCode?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.templateCode) where.templateCode = params.templateCode;

    const [items, total] = await Promise.all([
      this.prisma.ocrResult.findMany({
        where,
        include: { template: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.ocrResult.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async updateFields(
    id: string,
    fields: Array<{ fieldKey: string; confirmedValue: string }>,
    userId: string,
  ) {
    const result = await this.prisma.ocrResult.findUniqueOrThrow({
      where: { id },
      include: { fields: true },
    });

    for (const update of fields) {
      const existing = result.fields.find((f) => f.fieldKey === update.fieldKey);
      if (!existing) continue;

      const isModified = existing.ocrValue !== update.confirmedValue;

      await this.prisma.ocrFieldResult.update({
        where: { id: existing.id },
        data: {
          confirmedValue: update.confirmedValue,
          isModified,
        },
      });

      // 수정된 경우 학습 데이터 저장
      if (isModified && existing.ocrValue && result.templateCode) {
        await this.prisma.ocrCorrection.create({
          data: {
            resultId: id,
            fieldKey: update.fieldKey,
            templateCode: result.templateCode,
            originalValue: existing.ocrValue,
            correctedValue: update.confirmedValue,
            confidence: existing.confidence,
            boundingBox: existing.boundingBox !== null ? existing.boundingBox : { set: null },
            createdBy: userId,
          },
        });
      }
    }

    return this.getResultDetail(id);
  }

  async confirmResult(id: string) {
    const result = await this.prisma.ocrResult.findUniqueOrThrow({
      where: { id },
      include: { fields: true },
    });

    // 미확인 필드에 ocrValue를 confirmedValue로 설정
    for (const field of result.fields) {
      if (!field.confirmedValue) {
        await this.prisma.ocrFieldResult.update({
          where: { id: field.id },
          data: { confirmedValue: field.parsedValue || field.ocrValue },
        });
      }
    }

    await this.prisma.ocrResult.update({
      where: { id },
      data: { status: "CONFIRMED" },
    });

    return this.getResultDetail(id);
  }

  async deleteResult(id: string) {
    const result = await this.prisma.ocrResult.findUniqueOrThrow({ where: { id } });
    // 파일 삭제
    try { await fs.unlink(result.storedFilePath); } catch {}
    await this.prisma.ocrResult.delete({ where: { id } });
  }

  async getImage(id: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const result = await this.prisma.ocrResult.findUniqueOrThrow({ where: { id } });
    const buffer = await fs.readFile(result.storedFilePath);
    return { buffer, mimeType: result.mimeType };
  }
}
