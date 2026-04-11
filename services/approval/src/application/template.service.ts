import { PrismaClient, TemplateCategory } from "@prisma/client";

export class TemplateService {
  constructor(private prisma: PrismaClient) {}

  async list(params: { category?: TemplateCategory; activeOnly?: boolean } = {}) {
    const where: any = {};
    if (params.category) where.category = params.category;
    if (params.activeOnly !== false) where.isActive = true;
    return this.prisma.approvalTemplate.findMany({
      where,
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    });
  }

  async getById(id: string) {
    const t = await this.prisma.approvalTemplate.findUnique({ where: { id } });
    if (!t) throw new Error("양식을 찾을 수 없습니다.");
    return t;
  }

  async getByCode(code: string) {
    const t = await this.prisma.approvalTemplate.findUnique({ where: { code } });
    if (!t) throw new Error(`양식 코드 "${code}"를 찾을 수 없습니다.`);
    return t;
  }

  async create(data: {
    code: string; name: string; category: TemplateCategory;
    description?: string; fields: any; itemsTableConfig?: any;
    defaultBody?: string; footer?: string;
    defaultApprovalLineRule?: string; postApprovalAction?: string;
    relatedService?: string; sortOrder?: number;
  }) {
    return this.prisma.approvalTemplate.create({ data: data as any });
  }

  async update(id: string, data: any) {
    await this.getById(id);
    return this.prisma.approvalTemplate.update({ where: { id }, data });
  }

  async remove(id: string) {
    const t = await this.prisma.approvalTemplate.findUnique({
      where: { id },
      include: { _count: { select: { documents: true } } },
    });
    if (!t) throw new Error("양식을 찾을 수 없습니다.");
    if (t._count.documents > 0) throw new Error("문서가 있어 삭제할 수 없습니다. 비활성화를 사용해주세요.");
    return this.prisma.approvalTemplate.delete({ where: { id } });
  }
}
