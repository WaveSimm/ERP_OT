import { PrismaClient } from "@prisma/client";

export class OvertimeService {
  constructor(private readonly prisma: PrismaClient) {}

  async createRequest(userId: string, data: {
    date: string; plannedHours: number; reason: string; projectId?: string; segmentId?: string;
    approverId?: string; secondApproverId?: string; thirdApproverId?: string;
  }) {
    return this.prisma.overtimeRequest.create({
      data: {
        userId,
        date: new Date(data.date),
        plannedHours: data.plannedHours,
        reason: data.reason,
        projectId: data.projectId ?? null,
        segmentId: data.segmentId ?? null,
        approverId: data.approverId ?? null,
        secondApproverId: data.secondApproverId ?? null,
        thirdApproverId: data.thirdApproverId ?? null,
      },
    });
  }

  async getRequests(userId: string, status?: string) {
    return this.prisma.overtimeRequest.findMany({
      where: { userId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  async complete(id: string, userId: string, actualHours: number) {
    const req = await this.prisma.overtimeRequest.findFirst({ where: { id, userId, status: "APPROVED" } });
    if (!req) throw new Error("실적 입력할 수 없는 신청입니다.");
    return this.prisma.overtimeRequest.update({
      where: { id },
      data: { status: "COMPLETED", actualHours, completedAt: new Date() },
    });
  }

  async cancel(id: string, userId: string) {
    const req = await this.prisma.overtimeRequest.findFirst({
      where: { id, userId, status: { in: ["PENDING", "PENDING_2ND", "PENDING_3RD", "APPROVED"] as any[] } },
    });
    if (!req) throw new Error("취소할 수 없는 신청입니다.");
    return this.prisma.overtimeRequest.update({ where: { id }, data: { status: "CANCELLED" } });
  }

  async getPending(approverId: string) {
    return this.prisma.overtimeRequest.findMany({
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
    const req = await this.prisma.overtimeRequest.findFirst({
      where: { id, status: { in: ["PENDING", "PENDING_2ND", "PENDING_3RD"] as any[] } },
    });
    if (!req) throw new Error("승인할 수 없는 신청입니다.");

    let nextStatus: string;
    if (req.status === "PENDING") {
      nextStatus = req.secondApproverId ? "PENDING_2ND" : (req.thirdApproverId ? "PENDING_3RD" : "APPROVED");
    } else if (req.status === "PENDING_2ND") {
      nextStatus = req.thirdApproverId ? "PENDING_3RD" : "APPROVED";
    } else {
      nextStatus = "APPROVED";
    }

    return this.prisma.overtimeRequest.update({
      where: { id },
      data: {
        status: nextStatus as any,
        ...(nextStatus === "APPROVED" ? { approvedAt: new Date() } : {}),
      },
    });
  }

  async reject(id: string, approverId: string, rejectReason: string) {
    const req = await this.prisma.overtimeRequest.findFirst({
      where: { id, status: { in: ["PENDING", "PENDING_2ND", "PENDING_3RD"] as any[] } },
    });
    if (!req) throw new Error("반려할 수 없는 신청입니다.");
    return this.prisma.overtimeRequest.update({
      where: { id },
      data: { status: "REJECTED", approverId, rejectReason },
    });
  }
}
