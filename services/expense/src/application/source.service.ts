import type { PrismaClient, SourceType } from "@prisma/client";

export interface CreateSourceInput {
  userId: string;
  name: string;
  displayName?: string | undefined;
  type: SourceType;
  cardNumber?: string | undefined;
}

export class SourceService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(userId: string, includeInactive = false) {
    return this.prisma.expenseSource.findMany({
      where: {
        userId,
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    });
  }

  async get(userId: string, id: string) {
    const source = await this.prisma.expenseSource.findFirst({
      where: { id, userId },
    });
    if (!source) throw new Error("자원을 찾을 수 없습니다.");
    return source;
  }

  async create(input: CreateSourceInput) {
    return this.prisma.expenseSource.create({
      data: {
        userId: input.userId,
        name: input.name,
        displayName: input.displayName ?? null,
        type: input.type,
        cardNumber: input.cardNumber ?? null,
      },
    });
  }

  async update(
    userId: string,
    id: string,
    data: {
      name?: string | undefined;
      displayName?: string | null | undefined;
      type?: SourceType | undefined;
      cardNumber?: string | null | undefined;
      active?: boolean | undefined;
    },
  ) {
    await this.get(userId, id);
    return this.prisma.expenseSource.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.displayName !== undefined && { displayName: data.displayName }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.cardNumber !== undefined && { cardNumber: data.cardNumber }),
        ...(data.active !== undefined && { active: data.active }),
      },
    });
  }

  async deactivate(userId: string, id: string) {
    await this.get(userId, id);
    return this.prisma.expenseSource.update({ where: { id }, data: { active: false } });
  }
}
