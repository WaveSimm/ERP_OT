import { PrismaClient } from "@prisma/client";

export class LeaveService {
  constructor(private readonly prisma: PrismaClient) {}

  // user/approver ID → name 일괄 lookup (auth-service /internal/users/bulk)
  private async attachNames<T extends { userId: string; approverId: string | null; secondApproverId: string | null; thirdApproverId: string | null }>(
    rows: T[],
  ): Promise<Array<T & { userName: string | null; approverName: string | null; secondApproverName: string | null; thirdApproverName: string | null }>> {
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.userId) ids.add(r.userId);
      if (r.approverId) ids.add(r.approverId);
      if (r.secondApproverId) ids.add(r.secondApproverId);
      if (r.thirdApproverId) ids.add(r.thirdApproverId);
    }
    const nameMap = new Map<string, string>();
    if (ids.size > 0) {
      try {
        const authUrl = process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001";
        const res = await fetch(
          `${authUrl}/internal/users/bulk?ids=${[...ids].join(",")}`,
          // 보안 일괄패치 PDCA Layer 1 (C3): startup-time Zod env 검증으로 보장
          { headers: { "X-Internal-Token": process.env.INTERNAL_API_TOKEN as string } },
        );
        if (res.ok) {
          const data = (await res.json()) as Record<string, { name: string }>;
          Object.entries(data).forEach(([id, u]) => nameMap.set(id, u.name));
        }
      } catch { /* ignore */ }
    }
    return rows.map((r) => ({
      ...r,
      userName: nameMap.get(r.userId) ?? null,
      approverName: r.approverId ? (nameMap.get(r.approverId) ?? null) : null,
      secondApproverName: r.secondApproverId ? (nameMap.get(r.secondApproverId) ?? null) : null,
      thirdApproverName: r.thirdApproverId ? (nameMap.get(r.thirdApproverId) ?? null) : null,
    }));
  }

  async getBalance(userId: string, year: number) {
    let balance = await this.prisma.leaveBalance.findUnique({
      where: { userId_year: { userId, year } },
    });
    if (!balance) {
      const totalDays = await this.calculateAnnualLeave(userId, year);
      balance = await this.prisma.leaveBalance.create({
        data: { userId, year, totalDays },
      });
    }
    const remaining = balance.totalDays + balance.adjustedDays - balance.usedDays - balance.pendingDays;
    return { ...balance, remainingDays: Math.max(0, remaining) };
  }

  async createRequest(userId: string, data: {
    type: string; startDate: string; endDate: string; reason: string;
    approverId?: string; secondApproverId?: string; thirdApproverId?: string;
  }) {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    const days = this.calcDays(data.type, start, end);
    const year = start.getFullYear();

    const balance = await this.getBalance(userId, year);
    if (days > balance.remainingDays) {
      throw new Error(`신청 일수(${days}일)가 잔여 연차(${balance.remainingDays}일)를 초과합니다.`);
    }

    const [request] = await this.prisma.$transaction([
      this.prisma.leaveRequest.create({
        data: {
          userId,
          type: data.type as any,
          startDate: start,
          endDate: end,
          days,
          reason: data.reason,
          approverId: data.approverId ?? null,
          secondApproverId: data.secondApproverId ?? null,
          thirdApproverId: data.thirdApproverId ?? null,
        },
      }),
      this.prisma.leaveBalance.update({
        where: { userId_year: { userId, year } },
        data: { pendingDays: { increment: days } },
      }),
    ]);
    return request;
  }

  async getRequests(userId: string, status?: string) {
    const rows = await this.prisma.leaveRequest.findMany({
      where: { userId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return this.attachNames(rows);
  }

  async cancelRequest(id: string, userId: string) {
    const req = await this.prisma.leaveRequest.findFirst({
      where: { id, userId, status: { in: ["PENDING", "PENDING_2ND", "PENDING_3RD"] as any[] } },
    });
    if (!req) throw new Error("취소할 수 없는 신청입니다.");
    const year = req.startDate.getFullYear();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.leaveRequest.update({
        where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await tx.leaveBalance.update({
        where: { userId_year: { userId, year } },
        data: { pendingDays: { decrement: req.days } },
      });
      // 근태현황 엔트리 삭제
      await tx.workScheduleEntry.deleteMany({ where: { sourceId: id } });
      return updated;
    });
  }

  async getPending(approverId: string) {
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        OR: [
          { approverId, status: "PENDING" },
          { secondApproverId: approverId, status: "PENDING_2ND" as any },
          { thirdApproverId: approverId, status: "PENDING_3RD" as any },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    return this.attachNames(rows);
  }

  async approve(id: string, approverId: string) {
    const req = await this.prisma.leaveRequest.findFirst({
      where: { id, status: { in: ["PENDING", "PENDING_2ND", "PENDING_3RD"] as any[] } },
    });
    if (!req) throw new Error("승인할 수 없는 신청입니다.");

    // 현재 단계에 따라 다음 단계로 전진
    let nextStatus: string;
    if (req.status === "PENDING") {
      nextStatus = req.secondApproverId ? "PENDING_2ND" : (req.thirdApproverId ? "PENDING_3RD" : "APPROVED");
    } else if (req.status === "PENDING_2ND") {
      nextStatus = req.thirdApproverId ? "PENDING_3RD" : "APPROVED";
    } else {
      nextStatus = "APPROVED";
    }

    const isFinalApproval = nextStatus === "APPROVED";
    const year = req.startDate.getFullYear();

    if (isFinalApproval) {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.leaveRequest.update({
          where: { id },
          data: { status: "APPROVED" as any, approvedAt: new Date() },
        });
        await tx.leaveBalance.update({
          where: { userId_year: { userId: req.userId, year } },
          data: { usedDays: { increment: req.days }, pendingDays: { decrement: req.days } },
        });
        // 근태현황 캘린더에 자동 반영
        const entryType = this.mapLeaveToEntryType(req.type);
        const dates = this.getDateRange(req.startDate, req.endDate);
        for (const date of dates) {
          await tx.workScheduleEntry.upsert({
            where: { userId_date_entryType_sourceId: { userId: req.userId, date, entryType, sourceId: id } },
            create: { userId: req.userId, date, entryType, sourceType: "LEAVE_APPROVED", sourceId: id },
            update: {},
          });
        }
        return updated;
      });
    }

    return this.prisma.leaveRequest.update({
      where: { id },
      data: { status: nextStatus as any },
    });
  }

  async reject(id: string, approverId: string, rejectReason: string) {
    const req = await this.prisma.leaveRequest.findFirst({
      where: { id, status: { in: ["PENDING", "PENDING_2ND", "PENDING_3RD"] as any[] } },
    });
    if (!req) throw new Error("반려할 수 없는 신청입니다.");
    const year = req.startDate.getFullYear();
    const [updated] = await this.prisma.$transaction([
      this.prisma.leaveRequest.update({
        where: { id },
        data: { status: "REJECTED", approverId, rejectReason },
      }),
      this.prisma.leaveBalance.update({
        where: { userId_year: { userId: req.userId, year } },
        data: { pendingDays: { decrement: req.days } },
      }),
    ]);
    return updated;
  }

  async adjustBalance(userId: string, year: number, adjustedDays: number, updatedBy: string) {
    await this.getBalance(userId, year); // ensure exists
    return this.prisma.leaveBalance.update({
      where: { userId_year: { userId, year } },
      data: { adjustedDays: { increment: adjustedDays } },
    });
  }

  // 연간 연차 자동 부여 (FISCAL_YEAR Cron용)
  async grantAnnualLeaveAll(year: number) {
    // user-service 없이 기존 balances 가진 userId 목록으로 부여
    const existing = await this.prisma.leaveBalance.findMany({ where: { year } });
    const existingSet = new Set(existing.map((b) => b.userId));

    const prevYear = await this.prisma.leaveBalance.findMany({ where: { year: year - 1 } });
    const toCreate = prevYear.filter((b) => !existingSet.has(b.userId));

    for (const prev of toCreate) {
      const totalDays = await this.calculateAnnualLeave(prev.userId, year);
      await this.prisma.leaveBalance.create({
        data: { userId: prev.userId, year, totalDays },
      });
    }
  }

  private calcDays(type: string, start: Date, end: Date): number {
    if (type === "HALF_AM" || type === "HALF_PM") return 0.5;
    if (type === "QUARTER") return 0.25;
    if (type === "FAMILY") return 0.125;
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  private async calculateAnnualLeave(userId: string, year: number): Promise<number> {
    // 기본 15일 (user-service 연동 없이 기본값)
    return 15;
  }

  private mapLeaveToEntryType(leaveType: string) {
    const map: Record<string, any> = {
      ANNUAL: "ANNUAL", HALF_AM: "HALF_AM", HALF_PM: "HALF_PM",
      QUARTER: "QUARTER", FAMILY: "FAMILY",
      SICK: "SICK", SPECIAL: "SPECIAL",
    };
    return map[leaveType] ?? "ANNUAL";
  }

  private getDateRange(start: Date, end: Date): Date[] {
    const dates: Date[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      dates.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  }
}
