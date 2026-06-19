import { PrismaClient, Prisma, LeaveType, ApprovalStatus } from "@prisma/client";

export class LeaveError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "LeaveError";
  }
}

// 전자결재 select 옵션 (한국어) → LeaveType enum 매핑
const KOR_TO_LEAVE_TYPE: Record<string, string> = {
  // 현행 라벨 (v1.7)
  "연차(1일)": "ANNUAL",
  "반차(4H)": "HALF",
  "1/4연차(2H)": "QUARTER",
  "가정의날(1H)": "FAMILY_DAY",
  "가정의날(2H)": "FAMILY_DAY_2H",
  "경조사": "BEREAVEMENT",
  "병가": "SICK",
  "공가": "SPECIAL",
  // legacy 라벨 호환
  "연차": "ANNUAL",
  "반차": "HALF",
  "반차(오전)": "HALF",
  "반차(오후)": "HALF",
  "1/4연차": "QUARTER",
  "1/4차": "QUARTER",
  "가정의날": "FAMILY_DAY",
  "특별휴가": "SPECIAL",
};

const VALID_ENUM = ["ANNUAL", "HALF", "QUARTER", "FAMILY_DAY", "FAMILY_DAY_2H", "BEREAVEMENT", "SICK", "SPECIAL"];

function normalizeLeaveType(input: string): string {
  if (!input) return "ANNUAL";
  if (VALID_ENUM.includes(input)) return input;
  return KOR_TO_LEAVE_TYPE[input] ?? "ANNUAL";
}

// 시간 단위 휴가 (startTime 입력만 받고 endTime은 type별 자동)
const TIME_BASED_TYPES = ["HALF", "QUARTER", "FAMILY_DAY", "FAMILY_DAY_2H"];

// type별 고정 시간 (분). 모든 시간 단위 휴가는 startTime + duration 자동.
const TYPE_DEFAULT_MINUTES: Record<string, number> = {
  HALF: 240,           // 반차 4시간
  QUARTER: 120,        // 1/4연차 2시간
  FAMILY_DAY: 60,      // 가정의날 1시간
  FAMILY_DAY_2H: 120,  // 가정의날 2시간
};

// "HH:mm" + 분 → "HH:mm" (자정 넘어가는 케이스는 24시간 클램프)
function addMinutes(startTime: string, minutes: number): string {
  const [h, m] = startTime.split(":").map(Number);
  if ([h, m].some((n) => Number.isNaN(n))) return startTime;
  const total = (h! * 60 + m!) + minutes;
  const clamped = Math.min(total, 24 * 60 - 1); // 23:59 까지
  const hh = String(Math.floor(clamped / 60)).padStart(2, "0");
  const mm = String(clamped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// startTime/endTime "HH:mm" 차이를 분 단위로
function diffMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 0;
  return (eh! * 60 + em!) - (sh! * 60 + sm!);
}

// 분 → 일 (1h = 0.125일)
function minutesToDays(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.round((minutes / 60) * 0.125 * 1000) / 1000;
}

// type 기준 + 시작시간 → 종료시간 자동 계산 (v1.6: 모든 시간 단위 휴가가 type 고정 duration)
function resolveTimeRange(type: string, startTime?: string, _endTime?: string): { startTime?: string; endTime?: string; minutes: number } {
  if (!TIME_BASED_TYPES.includes(type)) return { minutes: 0 };
  const def = TYPE_DEFAULT_MINUTES[type] ?? 0;
  if (!startTime) return { minutes: def };
  return { startTime, endTime: addMinutes(startTime, def), minutes: def };
}

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
    // 잔여 = 기본 + 장기근속 + 임시조정 - 사용 - 대기 (장기근속은 수동 이월)
    const remaining = balance.totalDays + balance.longServiceDays + balance.adjustedDays
                    - balance.usedDays - balance.pendingDays;
    return { ...balance, remainingDays: Math.max(0, remaining) };
  }

  /** Admin only — 사용자별 연차 잔여 항목 직접 설정 */
  async adminSetBalance(
    userId: string,
    year: number,
    input: { totalDays?: number | undefined; longServiceDays?: number | undefined; adjustedDays?: number | undefined },
  ) {
    // 행이 없으면 default 생성 후 update
    await this.getBalance(userId, year);
    const data: Prisma.LeaveBalanceUncheckedUpdateInput = {};
    if (input.totalDays !== undefined) data.totalDays = input.totalDays;
    if (input.longServiceDays !== undefined) data.longServiceDays = input.longServiceDays;
    if (input.adjustedDays !== undefined) data.adjustedDays = input.adjustedDays;
    if (Object.keys(data).length === 0) return this.getBalance(userId, year);
    await this.prisma.leaveBalance.update({
      where: { userId_year: { userId, year } },
      data,
    });
    return this.getBalance(userId, year);
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
          type: data.type as LeaveType,
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
      where: { userId, ...(status ? { status: status as ApprovalStatus } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return this.attachNames(rows);
  }

  async cancelRequest(id: string, userId: string) {
    const req = await this.prisma.leaveRequest.findFirst({
      where: { id, userId, status: { in: ["PENDING", "PENDING_2ND", "PENDING_3RD"] as ApprovalStatus[] } },
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
          { secondApproverId: approverId, status: "PENDING_2ND" as ApprovalStatus },
          { thirdApproverId: approverId, status: "PENDING_3RD" as ApprovalStatus },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    return this.attachNames(rows);
  }

  async approve(id: string, approverId: string) {
    const req = await this.prisma.leaveRequest.findFirst({
      where: { id, status: { in: ["PENDING", "PENDING_2ND", "PENDING_3RD"] as ApprovalStatus[] } },
    });
    if (!req) throw new Error("승인할 수 없는 신청입니다.");

    // 현재 단계에 따라 다음 단계로 전진
    let nextStatus: ApprovalStatus;
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
          data: { status: "APPROVED" as ApprovalStatus, approvedAt: new Date() },
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
      data: { status: nextStatus },
    });
  }

  async reject(id: string, approverId: string, rejectReason: string) {
    const req = await this.prisma.leaveRequest.findFirst({
      where: { id, status: { in: ["PENDING", "PENDING_2ND", "PENDING_3RD"] as ApprovalStatus[] } },
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
    if (type === "HALF") return 0.5;
    if (type === "QUARTER") return 0.25;
    if (type === "FAMILY_DAY") return 0.125;
    if (type === "FAMILY_DAY_2H") return 0.25;
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
      ANNUAL: "ANNUAL",
      HALF: "HALF",
      QUARTER: "QUARTER",
      FAMILY_DAY: "FAMILY_DAY",
      FAMILY_DAY_2H: "FAMILY_DAY_2H",
      BEREAVEMENT: "BEREAVEMENT",
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

  // 전자결재 승인 완료 시 호출 — APPROVED 상태로 직접 생성 + balance 차감 + WorkScheduleEntry 자동 반영
  // 시간 단위 휴가(HALF/QUARTER/FAMILY_DAY/FAMILY_DAY_2H): startTime만 받고 type별 자동 endTime + days
  async createFromApproval(input: {
    userId: string;
    type: string;       // 한국어 또는 enum
    startDate: string;
    endDate: string;
    reason: string;
    startTime?: string | undefined;  // 시간 단위 휴가일 때만 의미 있음
    endTime?: string | undefined;    // v1.6: 사용 안 함 (type별 자동) — 호환 유지
    approvalDocumentId: string;
  }) {
    const type = normalizeLeaveType(input.type);
    const start = new Date(input.startDate);
    // 시간 단위 휴가(반차/1/4연차/가정의날)는 endDate=startDate 강제
    const isTimeBased = TIME_BASED_TYPES.includes(type);
    const end = isTimeBased ? start : new Date(input.endDate);

    // 시간 처리 (시간 단위 휴가만)
    const timeRange = resolveTimeRange(type, input.startTime, input.endTime);
    const startTime = timeRange.startTime ?? null;
    const endTime = timeRange.endTime ?? null;

    // days 계산: 시간 단위면 시간으로, 일 단위면 평일 카운트
    let days: number;
    if (isTimeBased) {
      days = minutesToDays(timeRange.minutes);
    } else {
      days = this.calcDays(type, start, end);
    }
    const year = start.getFullYear();

    // balance 사전 검증
    const balance = await this.getBalance(input.userId, year);
    if (days > balance.remainingDays) {
      throw new LeaveError(
        "INSUFFICIENT_BALANCE",
        `잔여 휴가(${balance.remainingDays}일)가 부족합니다. 신청: ${days}일.`,
        400,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.leaveRequest.create({
        data: {
          userId: input.userId,
          type: type as LeaveType,
          startDate: start,
          endDate: end,
          days,
          reason: input.reason,
          status: "APPROVED",
          approvedAt: new Date(),
        },
      });

      // balance 즉시 차감 (pendingDays 거치지 않고 usedDays 직접 증가)
      await tx.leaveBalance.update({
        where: { userId_year: { userId: input.userId, year } },
        data: { usedDays: { increment: days } },
      });

      // WorkScheduleEntry 자동 반영 (시간 단위 휴가는 startTime/endTime 같이 저장)
      const entryType = this.mapLeaveToEntryType(type);
      const dates = this.getDateRange(start, end);
      for (const date of dates) {
        await tx.workScheduleEntry.upsert({
          where: { userId_date_entryType_sourceId: { userId: input.userId, date, entryType, sourceId: created.id } },
          create: {
            userId: input.userId,
            date,
            entryType,
            sourceType: "LEAVE_APPROVED",
            sourceId: created.id,
            ...(startTime ? { startTime } : {}),
            ...(endTime ? { endTime } : {}),
          },
          update: {},
        });
      }

      return created;
    });
  }
}
