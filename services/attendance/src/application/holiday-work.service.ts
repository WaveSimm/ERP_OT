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

  // 연차대체 잔액 증감 (휴일근무 보상). 발생연도(date 기준) LeaveBalance.substituteDays.
  private async grantSubstitute(tx: any, userId: string, dateStr: string | Date, delta: number) {
    const year = new Date(dateStr).getFullYear();
    await tx.leaveBalance.upsert({
      where: { userId_year: { userId, year } },
      create: { userId, year, totalDays: 15, substituteDays: Math.max(0, delta) },
      update: { substituteDays: { increment: delta } },
    });
  }

  async createRequest(userId: string, data: CreateInput, direct = false) {
    await this.assertIsHoliday(data.date);

    // 중간 릴리즈(2026-06-29): 근태 직접 추가 — 승인 없이 즉시 APPROVED + 캘린더 반영
    if (direct) {
      const dup = await this.prisma.holidayWorkRequest.findFirst({
        where: {
          userId,
          date: new Date(data.date),
          taskId: data.taskId ?? null,
          status: { in: ["PENDING", "PENDING_2ND", "PENDING_3RD", "APPROVED"] as ApprovalStatus[] },
        },
      });
      if (dup) {
        throw new HolidayWorkError("DUPLICATE_REQUEST", `${data.date}에 이미 휴일근무 기록이 있습니다.`, 409);
      }
      return this.prisma.$transaction(async (tx) => {
        const created = await tx.holidayWorkRequest.create({
          data: {
            userId,
            date: new Date(data.date),
            reason: data.reason,
            projectId: data.projectId ?? null,
            taskId: data.taskId ?? null,
            status: "APPROVED" as ApprovalStatus,
            approvedAt: new Date(),
          },
        });
        await tx.workScheduleEntry.upsert({
          where: { userId_date_entryType_sourceId: { userId, date: new Date(data.date), entryType: "OT", sourceId: created.id } },
          create: { userId, date: new Date(data.date), entryType: "OT", sourceType: "OT_APPROVED", sourceId: created.id, label: "휴일근무" },
          update: {},
        });
        // 내규: 휴일근무 1건 → 연차대체 +1일 (발생연도 기준)
        await this.grantSubstitute(tx, userId, data.date, 1);
        return created;
      });
    }

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
      // 내규: 휴일근무 승인 → 연차대체 +1일
      await this.grantSubstitute(tx, input.userId, input.date, 1);

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
      // APPROVED였던 건 취소 시 연차대체 회수 (-1)
      if (req.status === "APPROVED") await this.grantSubstitute(tx, userId, req.date, -1);
      return updated;
    });
  }

  // 중간 릴리즈(2026-06-29): 휴일근무 삭제(상태 무관) — 캘린더 엔트리 제거 후 레코드 삭제
  // 본인 소유만 삭제. 단 운영자(OPERATOR) 이상은 타인 휴일근무도 삭제 가능(전사근태 잘못 입력 정리용).
  async deleteRequest(id: string, userId: string, role?: string) {
    const privileged = role === "ADMIN" || role === "MANAGER" || role === "OPERATOR";
    const req = await this.prisma.holidayWorkRequest.findFirst({
      where: privileged ? { id } : { id, userId },
    });
    if (!req) throw new HolidayWorkError("NOT_FOUND", "삭제할 수 없는 휴일근무입니다.", 404);
    return this.prisma.$transaction(async (tx) => {
      await tx.workScheduleEntry.deleteMany({ where: { sourceId: id } });
      // APPROVED였던 건이면 연차대체 회수 (-1) — 신청 소유자 기준
      if (req.status === "APPROVED") await this.grantSubstitute(tx, req.userId, req.date, -1);
      await tx.holidayWorkRequest.delete({ where: { id } });
      return { ok: true };
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
        // 내규: 휴일근무 승인 → 연차대체 +1일
        await this.grantSubstitute(tx, req.userId, req.date, 1);
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
