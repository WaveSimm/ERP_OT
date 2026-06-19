import { PrismaClient, ApprovalStatus } from "@prisma/client";
import type { AuthClient } from "../infrastructure/auth-client.js";

export class HolidayWorkError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "HolidayWorkError";
  }
}

interface CreateInput {
  date: string;                 // ISO date "YYYY-MM-DD"
  reason: string;
  projectId?: string;
  taskId?: string;
  approverId?: string;
  secondApproverId?: string;
  thirdApproverId?: string;
}

export class HolidayWorkService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly authClient: AuthClient,
  ) {}

  // 주말(토/일) 또는 회사달력 휴일 여부 검증
  private async assertIsHoliday(date: string): Promise<void> {
    const d = new Date(date + "T00:00:00.000Z");
    const dow = d.getUTCDay(); // 0=일, 6=토
    if (dow === 0 || dow === 6) return; // 주말 OK

    // 회사달력 조회 (단일 날짜)
    const holidays = await this.authClient.getHolidays(date, date);
    if (holidays.length > 0) return; // 공휴일/회사휴일 OK

    throw new HolidayWorkError(
      "NOT_A_HOLIDAY",
      "휴일근무는 주말 또는 회사달력의 휴일만 신청할 수 있습니다.",
      400,
    );
  }

  async createRequest(userId: string, data: CreateInput) {
    await this.assertIsHoliday(data.date);

    return this.prisma.holidayWorkRequest.create({
      data: {
        userId,
        date: new Date(data.date),
        reason: data.reason,
        projectId: data.projectId ?? null,
        taskId: data.taskId ?? null,
        approverId: data.approverId ?? null,
        secondApproverId: data.secondApproverId ?? null,
        thirdApproverId: data.thirdApproverId ?? null,
      },
    });
  }

  // 전자결재 승인 완료 시 호출 — APPROVED 상태로 직접 생성 + WorkScheduleEntry 자동 반영
  async createFromApproval(input: {
    userId: string;
    date: string;
    reason: string;
    projectId?: string | undefined;
    taskId?: string | undefined;
    approvalDocumentId: string;  // sourceId 추적용
  }) {
    await this.assertIsHoliday(input.date);

    // 중복 검증: 같은 사용자 + 같은 날짜 + 같은 task (taskId 미선택 시 NULL 비교)
    // 결정 정책 (Q5): 다른 task는 OK. 같은 task + 같은 날짜만 거부
    const dup = await this.prisma.holidayWorkRequest.findFirst({
      where: {
        userId: input.userId,
        date: new Date(input.date),
        taskId: input.taskId ?? null,
        status: { in: ["PENDING", "PENDING_2ND", "PENDING_3RD", "APPROVED"] as ApprovalStatus[] },
      },
    });
    if (dup) {
      throw new HolidayWorkError(
        "DUPLICATE_REQUEST",
        `${input.date}에 이미 같은 task의 휴일근무 신청이 있습니다.`,
        409,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.holidayWorkRequest.create({
        data: {
          userId: input.userId,
          date: new Date(input.date),
          reason: input.reason,
          projectId: input.projectId ?? null,
          taskId: input.taskId ?? null,
          status: "APPROVED",
          approvedAt: new Date(),
        },
      });

      // 근태현황 캘린더 자동 반영 (entryType=OT 호환 유지)
      await tx.workScheduleEntry.upsert({
        where: {
          userId_date_entryType_sourceId: {
            userId: input.userId,
            date: new Date(input.date),
            entryType: "OT",
            sourceId: created.id,
          },
        },
        create: {
          userId: input.userId,
          date: new Date(input.date),
          entryType: "OT",
          sourceType: "OT_APPROVED",
          sourceId: created.id,
          label: "휴일근무",
        },
        update: {},
      });

      return created;
    });
  }

  async getRequests(userId: string, status?: string) {
    return this.prisma.holidayWorkRequest.findMany({
      where: { userId, ...(status ? { status: status as ApprovalStatus } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  async cancel(id: string, userId: string) {
    const req = await this.prisma.holidayWorkRequest.findFirst({
      where: { id, userId, status: { in: ["PENDING", "PENDING_2ND", "PENDING_3RD", "APPROVED"] as ApprovalStatus[] } },
    });
    if (!req) throw new HolidayWorkError("CANNOT_CANCEL", "취소할 수 없는 신청입니다.", 400);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.holidayWorkRequest.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
      // 근태현황 엔트리 삭제 (자동 동기화로 만든 항목)
      await tx.workScheduleEntry.deleteMany({ where: { sourceId: id } });
      return updated;
    });
  }

  async getPending(approverId: string) {
    return this.prisma.holidayWorkRequest.findMany({
      where: {
        OR: [
          { approverId, status: "PENDING" },
          { secondApproverId: approverId, status: "PENDING_2ND" as ApprovalStatus },
          { thirdApproverId: approverId, status: "PENDING_3RD" as ApprovalStatus },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async approve(id: string, _approverId: string) {
    const req = await this.prisma.holidayWorkRequest.findFirst({
      where: { id, status: { in: ["PENDING", "PENDING_2ND", "PENDING_3RD"] as ApprovalStatus[] } },
    });
    if (!req) throw new HolidayWorkError("CANNOT_APPROVE", "승인할 수 없는 신청입니다.", 400);

    let nextStatus: ApprovalStatus;
    if (req.status === "PENDING") {
      nextStatus = req.secondApproverId ? "PENDING_2ND" : (req.thirdApproverId ? "PENDING_3RD" : "APPROVED");
    } else if (req.status === "PENDING_2ND") {
      nextStatus = req.thirdApproverId ? "PENDING_3RD" : "APPROVED";
    } else {
      nextStatus = "APPROVED";
    }

    if (nextStatus === "APPROVED") {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.holidayWorkRequest.update({
          where: { id },
          data: { status: "APPROVED" as ApprovalStatus, approvedAt: new Date() },
        });
        // 근태현황 캘린더 자동 반영 (entryType=OT 의미 재해석으로 호환 유지)
        await tx.workScheduleEntry.upsert({
          where: { userId_date_entryType_sourceId: { userId: req.userId, date: req.date, entryType: "OT", sourceId: id } },
          create: { userId: req.userId, date: req.date, entryType: "OT", sourceType: "OT_APPROVED", sourceId: id, label: "휴일근무" },
          update: {},
        });
        return updated;
      });
    }

    return this.prisma.holidayWorkRequest.update({
      where: { id },
      data: { status: nextStatus },
    });
  }

  async reject(id: string, approverId: string, rejectReason: string) {
    const req = await this.prisma.holidayWorkRequest.findFirst({
      where: { id, status: { in: ["PENDING", "PENDING_2ND", "PENDING_3RD"] as ApprovalStatus[] } },
    });
    if (!req) throw new HolidayWorkError("CANNOT_REJECT", "반려할 수 없는 신청입니다.", 400);
    return this.prisma.holidayWorkRequest.update({
      where: { id },
      data: { status: "REJECTED", approverId, rejectReason },
    });
  }
}
