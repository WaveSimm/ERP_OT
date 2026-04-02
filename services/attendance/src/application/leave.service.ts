import { PrismaClient } from "@prisma/client";

export class LeaveService {
  constructor(private readonly prisma: PrismaClient) {}

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
    return this.prisma.leaveRequest.findMany({
      where: { userId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  async cancelRequest(id: string, userId: string) {
    const req = await this.prisma.leaveRequest.findFirst({
      where: { id, userId, status: { in: ["PENDING", "PENDING_2ND", "PENDING_3RD"] as any[] } },
    });
    if (!req) throw new Error("취소할 수 없는 신청입니다.");
    const year = req.startDate.getFullYear();
    const [updated] = await this.prisma.$transaction([
      this.prisma.leaveRequest.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() } }),
      this.prisma.leaveBalance.update({
        where: { userId_year: { userId, year } },
        data: { pendingDays: { decrement: req.days } },
      }),
    ]);
    return updated;
  }

  async getPending(approverId: string) {
    return this.prisma.leaveRequest.findMany({
      where: {
        OR: [
          { approverId, status: "PENDING" },
          { secondApproverId: approverId, status: "PENDING_2ND" as any },
          { thirdApproverId: approverId, status: "PENDING_3RD" as any },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
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
      const [updated] = await this.prisma.$transaction([
        this.prisma.leaveRequest.update({
          where: { id },
          data: { status: "APPROVED" as any, approvedAt: new Date() },
        }),
        this.prisma.leaveBalance.update({
          where: { userId_year: { userId: req.userId, year } },
          data: { usedDays: { increment: req.days }, pendingDays: { decrement: req.days } },
        }),
      ]);
      return updated;
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
}
