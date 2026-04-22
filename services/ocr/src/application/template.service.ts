import { PrismaClient } from "@prisma/client";

export class TemplateService {
  constructor(private prisma: PrismaClient) {}

  async list() {
    return this.prisma.documentTemplate.findMany({
      where: { isActive: true },
      include: { fields: { orderBy: { sortOrder: "asc" } } },
      orderBy: { name: "asc" },
    });
  }

  async getByCode(code: string) {
    return this.prisma.documentTemplate.findUniqueOrThrow({
      where: { code },
      include: { fields: { orderBy: { sortOrder: "asc" } } },
    });
  }

  async create(data: {
    code: string;
    name: string;
    description?: string;
    targetService: string;
    targetEndpoint: string;
    fields: Array<{
      key: string;
      label: string;
      aliases?: string[];
      type?: string;
      required?: boolean;
      sortOrder?: number;
      erpFieldName?: string;
      validation?: string;
    }>;
  }) {
    return this.prisma.documentTemplate.create({
      data: {
        code: data.code,
        name: data.name,
        description: data.description ?? null,
        targetService: data.targetService,
        targetEndpoint: data.targetEndpoint,
        fields: {
          createMany: {
            data: data.fields.map((f, i) => ({
              key: f.key,
              label: f.label,
              aliases: f.aliases || [],
              type: (f.type as any) || "STRING",
              required: f.required ?? false,
              sortOrder: f.sortOrder ?? i,
              erpFieldName: f.erpFieldName ?? null,
              validation: f.validation ?? null,
            })),
          },
        },
      },
      include: { fields: { orderBy: { sortOrder: "asc" } } },
    });
  }

  async update(code: string, data: {
    name?: string;
    description?: string;
    targetService?: string;
    targetEndpoint?: string;
    isActive?: boolean;
    fields?: Array<{
      key: string;
      label: string;
      aliases?: string[];
      type?: string;
      required?: boolean;
      sortOrder?: number;
      erpFieldName?: string;
      validation?: string;
    }>;
  }) {
    const template = await this.prisma.documentTemplate.findUniqueOrThrow({ where: { code } });

    // 필드가 있으면 전체 교체 (기존 삭제 후 재생성)
    if (data.fields) {
      await this.prisma.templateField.deleteMany({ where: { templateId: template.id } });
    }

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.targetService !== undefined) updateData.targetService = data.targetService;
    if (data.targetEndpoint !== undefined) updateData.targetEndpoint = data.targetEndpoint;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.fields) {
      updateData.fields = {
        createMany: {
          data: data.fields.map((f, i) => ({
            key: f.key,
            label: f.label,
            aliases: f.aliases || [],
            type: (f.type as any) || "STRING",
            required: f.required ?? false,
            sortOrder: f.sortOrder ?? i,
            erpFieldName: f.erpFieldName ?? null,
            validation: f.validation ?? null,
          })),
        },
      };
    }

    return this.prisma.documentTemplate.update({
      where: { code },
      data: updateData as any,
      include: { fields: { orderBy: { sortOrder: "asc" } } },
    });
  }

  async getStats() {
    const templates = await this.prisma.documentTemplate.findMany({ select: { code: true, name: true } });
    const stats = await Promise.all(
      templates.map(async (t) => {
        const totalScans = await this.prisma.ocrResult.count({ where: { templateCode: t.code } });
        const corrections = await this.prisma.ocrCorrection.count({ where: { templateCode: t.code } });
        const applied = await this.prisma.ocrResult.count({ where: { templateCode: t.code, status: "APPLIED" } });
        return { code: t.code, name: t.name, totalScans, corrections, applied };
      }),
    );
    return stats;
  }
}
