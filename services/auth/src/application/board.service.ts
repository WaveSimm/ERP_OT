import { PrismaClient, Prisma } from "@prisma/client";

export class BoardService {
  constructor(private readonly prisma: PrismaClient) {}

  async listCategories() {
    return this.prisma.boardCategory.findMany({
      where: { isActive: true, isVisible: true },
      orderBy: { sortOrder: "asc" },
      include: {
        boards: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
  }

  async listBoards(filter?: { categoryCode?: string | undefined }) {
    const where: Prisma.BoardWhereInput = { isActive: true };
    if (filter?.categoryCode) {
      const cat = await this.prisma.boardCategory.findUnique({ where: { code: filter.categoryCode } });
      if (!cat) return [];
      where.categoryId = cat.id;
    }
    return this.prisma.board.findMany({
      where,
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      include: { category: true },
    });
  }

  async getBoardByCode(code: string) {
    return this.prisma.board.findUnique({
      where: { code },
      include: { category: true },
    });
  }
}
