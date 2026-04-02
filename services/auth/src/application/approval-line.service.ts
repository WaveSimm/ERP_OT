import { PrismaClient } from "@prisma/client";

export class ApprovalLineService {
  constructor(private readonly prisma: PrismaClient) {}

  async getAll() {
    const lines = await this.prisma.approvalLine.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    });

    // 관련 사용자 이름 일괄 조회
    const ids = new Set<string>();
    for (const l of lines) {
      ids.add(l.userId);
      ids.add(l.approverId);
      if (l.secondApproverId) ids.add(l.secondApproverId);
      if (l.thirdApproverId) ids.add(l.thirdApproverId);
      if (l.delegateId) ids.add(l.delegateId);
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: Array.from(ids) } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(users.map((u) => [u.id, u.name]));

    return lines.map((l) => ({
      ...l,
      userName: nameMap.get(l.userId) ?? l.userId,
      approverName: nameMap.get(l.approverId) ?? l.approverId,
      secondApproverName: l.secondApproverId ? (nameMap.get(l.secondApproverId) ?? null) : null,
      thirdApproverName: l.thirdApproverId ? (nameMap.get(l.thirdApproverId) ?? null) : null,
      delegateName: l.delegateId ? (nameMap.get(l.delegateId) ?? null) : null,
    }));
  }

  async getByUser(userId: string) {
    return this.prisma.approvalLine.findUnique({ where: { userId } });
  }

  async upsert(data: {
    userId: string;
    approverId: string;
    secondApproverId?: string | null;
    thirdApproverId?: string | null;
    delegateId?: string | null;
    delegateUntil?: Date | null;
  }) {
    return this.prisma.approvalLine.upsert({
      where: { userId: data.userId },
      create: { ...data, isActive: true },
      update: { ...data },
    });
  }

  async remove(userId: string) {
    return this.prisma.approvalLine.updateMany({
      where: { userId },
      data: { isActive: false },
    });
  }

  // internal API용: 결재자 조회 (위임 기간 고려)
  async getApprover(userId: string) {
    const line = await this.prisma.approvalLine.findUnique({
      where: { userId, isActive: true },
    });
    if (!line) return null;

    // 위임자 유효 여부 확인
    const now = new Date();
    const delegateActive =
      line.delegateId &&
      line.delegateUntil &&
      line.delegateUntil > now;

    const effectiveApproverId = delegateActive ? line.delegateId! : line.approverId;

    const [approver, secondApprover, thirdApprover, delegate] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: effectiveApproverId }, select: { id: true, name: true, email: true } }),
      line.secondApproverId
        ? this.prisma.user.findUnique({ where: { id: line.secondApproverId }, select: { id: true, name: true, email: true } })
        : null,
      line.thirdApproverId
        ? this.prisma.user.findUnique({ where: { id: line.thirdApproverId }, select: { id: true, name: true, email: true } })
        : null,
      delegateActive && line.delegateId
        ? this.prisma.user.findUnique({ where: { id: line.delegateId }, select: { id: true, name: true } })
        : null,
    ]);

    return {
      userId,
      approverId: effectiveApproverId,
      approverName: approver?.name ?? null,
      approverEmail: approver?.email ?? null,
      secondApproverId: line.secondApproverId ?? null,
      secondApproverName: secondApprover?.name ?? null,
      thirdApproverId: line.thirdApproverId ?? null,
      thirdApproverName: thirdApprover?.name ?? null,
      delegateId: line.delegateId ?? null,
      delegateUntil: line.delegateUntil ?? null,
      isDelegated: !!delegateActive,
    };
  }

  // internal API용: 내가 결재자인 사람들 (어느 단계든)
  async getSubordinates(approverId: string): Promise<string[]> {
    const lines = await this.prisma.approvalLine.findMany({
      where: {
        isActive: true,
        OR: [
          { approverId },
          { secondApproverId: approverId },
          { thirdApproverId: approverId },
        ],
      },
      select: { userId: true },
    });
    return lines.map((l) => l.userId);
  }

  // 부서 일괄 설정
  // - 팀원: 1차=팀장, 2차=총괄이사(상위부서장), 3차=대표이사(그위부서장)
  // - 팀장: 1차=총괄이사(상위부서장), 2차=대표이사(그위부서장) / 직속팀이면 1차=대표이사
  // - 총괄이사: 1차=대표이사
  // - 대표이사: 결재자 없음 (상위부서장 없으면 설정 안 함)
  async bulkSetByDepartment(departmentId: string) {
    const dept = await this.prisma.department.findUnique({
      where: { id: departmentId },
      include: { parent: { include: { parent: true } } },
    });
    if (!dept) throw new Error("부서를 찾을 수 없습니다.");

    const headUserId = dept.headUserId;
    if (!headUserId) throw new Error("부서장이 지정되지 않았습니다.");

    const parentHead = dept.parent?.headUserId ?? null;
    const grandParentHead = (dept.parent as any)?.parent?.headUserId ?? null;
    // soukwalUserId/daepyoUserId 우선, 없으면 계층 기반
    const soukwalHead = (dept as any).soukwalUserId ?? parentHead;
    const daepyoHead = (dept as any).daepyoUserId ?? grandParentHead;

    // 팀장 본인 결재라인: 1차=총괄이사, 2차=대표이사
    if (soukwalHead) {
      await this.upsert({
        userId: headUserId,
        approverId: soukwalHead,
        secondApproverId: daepyoHead ?? null,
        thirdApproverId: null,
      });
    }

    // 일반 팀원 결재라인: 1차=팀장, 2차=총괄이사, 3차=대표이사
    const members = await this.prisma.userProfile.findMany({ where: { departmentId } });
    for (const m of members) {
      if (m.userId === headUserId) continue;
      await this.upsert({
        userId: m.userId,
        approverId: headUserId,
        secondApproverId: soukwalHead ?? null,
        thirdApproverId: daepyoHead ?? null,
      });
    }
  }

  // 전사 일괄 설정
  async bulkSetAll() {
    const depts = await this.prisma.department.findMany({
      where: { isActive: true },
      include: { parent: { include: { parent: true } } },
    });

    for (const dept of depts) {
      if (!dept.headUserId) continue;

      const parentHead = dept.parent?.headUserId ?? null;
      const grandParentHead = (dept.parent as any)?.parent?.headUserId ?? null;
      const soukwalHead = (dept as any).soukwalUserId ?? parentHead;
      const daepyoHead = (dept as any).daepyoUserId ?? grandParentHead;

      // 부서장 본인 결재라인: 1차=총괄이사, 2차=대표이사
      if (soukwalHead) {
        await this.upsert({
          userId: dept.headUserId,
          approverId: soukwalHead,
          secondApproverId: daepyoHead ?? null,
          thirdApproverId: null,
        });
      }

      // 일반 부서원 결재라인: 1차=팀장, 2차=총괄이사, 3차=대표이사
      const members = await this.prisma.userProfile.findMany({ where: { departmentId: dept.id } });
      for (const m of members) {
        if (m.userId === dept.headUserId) continue;
        await this.upsert({
          userId: m.userId,
          approverId: dept.headUserId,
          secondApproverId: soukwalHead ?? null,
          thirdApproverId: daepyoHead ?? null,
        });
      }
    }
  }
}
