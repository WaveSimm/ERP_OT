import type { PrismaClient } from "@prisma/client";

export class CategoryService {
  constructor(private readonly prisma: PrismaClient) {}

  // 표준 카테고리 + 본인 개인 카테고리
  async listForUser(userId: string) {
    return this.prisma.expenseCategory.findMany({
      where: {
        active: true,
        OR: [{ scope: "STANDARD" }, { scope: "PERSONAL", ownerUserId: userId }],
      },
      orderBy: [{ scope: "asc" }, { displayOrder: "asc" }, { name: "asc" }],
    });
  }

  // 표준만 (admin용)
  async listStandard() {
    return this.prisma.expenseCategory.findMany({
      where: { scope: "STANDARD" },
      orderBy: { displayOrder: "asc" },
    });
  }

  async createPersonal(userId: string, data: { code: string; name: string; sheetName?: string | undefined; displayOrder?: number | undefined }) {
    return this.prisma.expenseCategory.create({
      data: {
        scope: "PERSONAL",
        ownerUserId: userId,
        code: data.code,
        name: data.name,
        sheetName: data.sheetName ?? data.name,
        displayOrder: data.displayOrder ?? 50,
        active: true,
      },
    });
  }

  async createStandard(data: { code: string; name: string; sheetName?: string | undefined; displayOrder?: number | undefined; description?: string | undefined }) {
    return this.prisma.expenseCategory.create({
      data: {
        scope: "STANDARD",
        ownerUserId: null,
        code: data.code,
        name: data.name,
        sheetName: data.sheetName ?? data.name,
        displayOrder: data.displayOrder ?? 50,
        description: data.description ?? null,
        active: true,
      },
    });
  }

  async updatePersonal(userId: string, id: string, data: { name?: string | undefined; sheetName?: string | undefined; displayOrder?: number | undefined; active?: boolean | undefined }) {
    const cat = await this.prisma.expenseCategory.findUnique({ where: { id } });
    if (!cat || cat.scope !== "PERSONAL" || cat.ownerUserId !== userId) {
      throw new Error("개인 카테고리만 수정할 수 있습니다.");
    }
    return this.prisma.expenseCategory.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.sheetName !== undefined && { sheetName: data.sheetName }),
        ...(data.displayOrder !== undefined && { displayOrder: data.displayOrder }),
        ...(data.active !== undefined && { active: data.active }),
      },
    });
  }

  async updateStandard(id: string, data: { name?: string | undefined; sheetName?: string | undefined; displayOrder?: number | undefined; description?: string | undefined; active?: boolean | undefined }) {
    const cat = await this.prisma.expenseCategory.findUnique({ where: { id } });
    if (!cat || cat.scope !== "STANDARD") throw new Error("표준 카테고리만 수정할 수 있습니다.");
    return this.prisma.expenseCategory.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.sheetName !== undefined && { sheetName: data.sheetName }),
        ...(data.displayOrder !== undefined && { displayOrder: data.displayOrder }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.active !== undefined && { active: data.active }),
      },
    });
  }

  async deletePersonal(userId: string, id: string) {
    const cat = await this.prisma.expenseCategory.findUnique({ where: { id } });
    if (!cat || cat.scope !== "PERSONAL" || cat.ownerUserId !== userId) {
      throw new Error("개인 카테고리만 삭제할 수 있습니다.");
    }
    // 사용 중인지 확인
    const used = await this.prisma.expenseTransaction.count({ where: { categoryId: id } });
    if (used > 0) throw new Error(`사용 중인 카테고리는 삭제할 수 없습니다 (${used}건). 비활성화하세요.`);
    return this.prisma.expenseCategory.delete({ where: { id } });
  }
}
