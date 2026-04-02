import { PrismaClient } from "@prisma/client";

export class DepartmentService {
  constructor(private readonly prisma: PrismaClient) {}

  async getTree() {
    const all = await this.prisma.department.findMany({
      where: { isActive: true },
      include: {
        members: {
          select: { userId: true },
        },
      },
      orderBy: [{ level: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });

    // 부서장 + 대표이사 이름 조회
    const relatedUserIds = [
      ...all.map((d) => d.headUserId),
      ...all.map((d) => (d as any).soukwalUserId),
      ...all.map((d) => (d as any).daepyoUserId),
    ].filter(Boolean) as string[];
    const relatedUsers =
      relatedUserIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: relatedUserIds } },
            select: { id: true, name: true },
          })
        : [];
    const nameMap = new Map(relatedUsers.map((u) => [u.id, u.name]));

    // flat → tree
    const nodeMap = new Map(
      all.map((d) => ({
        ...d,
        memberCount: d.members.length,
        headName: d.headUserId ? (nameMap.get(d.headUserId) ?? null) : null,
        soukwalName: (d as any).soukwalUserId ? (nameMap.get((d as any).soukwalUserId) ?? null) : null,
        daepyoName: (d as any).daepyoUserId ? (nameMap.get((d as any).daepyoUserId) ?? null) : null,
        children: [] as any[],
        members: undefined,
      })).map((n) => [n.id, n]),
    );

    const roots: any[] = [];
    for (const [, node] of nodeMap) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  async findById(id: string) {
    return this.prisma.department.findUnique({
      where: { id },
      include: {
        members: {
          select: {
            userId: true,
            departmentName: true,
            user: { select: { id: true, name: true, email: true, role: true } },
          },
        },
        children: { where: { isActive: true }, select: { id: true, name: true } },
      },
    });
  }

  async create(data: {
    name: string;
    code: string;
    parentId?: string;
    headUserId?: string;
    sortOrder?: number;
  }) {
    const level = data.parentId ? await this.calcLevel(data.parentId) : 1;
    return this.prisma.department.create({
      data: { ...data, level },
    });
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      code: string;
      parentId: string | null;
      headUserId: string | null;
      soukwalUserId: string | null;
      daepyoUserId: string | null;
      sortOrder: number;
      isActive: boolean;
    }>,
  ) {
    return this.prisma.department.update({ where: { id }, data });
  }

  async delete(id: string) {
    const count = await this.prisma.userProfile.count({ where: { departmentId: id } });
    if (count > 0) throw new Error(`소속 인원이 ${count}명 있어 삭제할 수 없습니다.`);
    const childCount = await this.prisma.department.count({ where: { parentId: id, isActive: true } });
    if (childCount > 0) throw new Error(`하위 부서가 ${childCount}개 있어 삭제할 수 없습니다.`);
    return this.prisma.department.update({ where: { id }, data: { isActive: false } });
  }

  async assignUser(userId: string, departmentId: string | null) {
    const dept = departmentId
      ? await this.prisma.department.findUnique({ where: { id: departmentId } })
      : null;
    await this.prisma.userProfile.upsert({
      where: { userId },
      create: { userId, departmentId, departmentName: dept?.name ?? null },
      update: { departmentId, departmentName: dept?.name ?? null },
    });
  }

  async getMembers(departmentId: string) {
    const profiles = await this.prisma.userProfile.findMany({
      where: { departmentId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return profiles.map((p) => ({
      userId: p.user.id,
      name: p.user.name,
      email: p.user.email,
    }));
  }

  private async calcLevel(parentId: string): Promise<number> {
    const parent = await this.prisma.department.findUnique({ where: { id: parentId } });
    return parent ? parent.level + 1 : 1;
  }
}
