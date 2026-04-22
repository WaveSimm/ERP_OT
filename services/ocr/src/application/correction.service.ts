import { PrismaClient } from "@prisma/client";

export class CorrectionService {
  constructor(private prisma: PrismaClient) {}

  async exportForTraining(templateCode?: string) {
    const where: any = {};
    if (templateCode) where.templateCode = templateCode;

    const corrections = await this.prisma.ocrCorrection.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });

    // PaddleOCR fine-tuning 형식으로 변환
    return corrections.map((c) => ({
      image_region: c.boundingBox,
      original_text: c.originalValue,
      corrected_text: c.correctedValue,
      confidence: c.confidence,
      template_code: c.templateCode,
      field_key: c.fieldKey,
    }));
  }

  async getStats(templateCode?: string) {
    const where: any = {};
    if (templateCode) where.templateCode = templateCode;

    const total = await this.prisma.ocrCorrection.count({ where });

    // 필드별 수정 빈도
    const byField = await this.prisma.ocrCorrection.groupBy({
      by: ["fieldKey"],
      where,
      _count: true,
      orderBy: { _count: { fieldKey: "desc" } },
    });

    return { totalCorrections: total, byField };
  }
}
