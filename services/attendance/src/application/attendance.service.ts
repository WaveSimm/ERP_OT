import { PrismaClient } from "@prisma/client";
import { transition, CheckState } from "../domain/state-machine/attendance.fsm.js";

export class AttendanceService {
  constructor(private readonly prisma: PrismaClient) {}

  // 오늘 출퇴근 현황 조회 (없으면 생성)
  async getToday(userId: string) {
    const today = this.todayDate();
    let record = await this.prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId, date: today } },
      include: { breakRecords: { orderBy: { breakOut: "desc" }, take: 1 } },
    });
    if (!record) {
      // 공휴일·휴가 여부 확인
      const status = await this.resolveTodayStatus(userId, today);
      record = await this.prisma.attendanceRecord.create({
        data: { userId, date: today, status, checkState: "NOT_STARTED" },
        include: { breakRecords: { orderBy: { breakOut: "desc" }, take: 1 } },
      });
    }
    return this.formatTodayResponse(record);
  }

  async checkIn(userId: string, workType: string, note?: string) {
    const today = this.todayDate();
    const record = await this.getOrCreateRecord(userId, today);
    const newState = transition(record.checkState as CheckState, "CHECK_IN");

    const policy = await this.getPolicy();
    const now = new Date();
    const [startH, startM] = policy.workStartTime.split(":").map(Number);
    const workStart = new Date(now);
    workStart.setHours(startH!, startM!, 0, 0);
    const toleranceMs = policy.lateToleranceMinutes * 60 * 1000;
    const isLate = now.getTime() > workStart.getTime() + toleranceMs;
    const lateMinutes = isLate ? Math.floor((now.getTime() - workStart.getTime()) / 60000) : 0;

    const updated = await this.prisma.attendanceRecord.update({
      where: { userId_date: { userId, date: today } },
      data: {
        checkIn: now,
        checkState: newState,
        workType: workType as any,
        isLate,
        lateMinutes,
        status: isLate ? "LATE" : "NORMAL",
        note: note ?? null,
      },
      include: { breakRecords: { orderBy: { breakOut: "desc" }, take: 1 } },
    });
    return this.formatTodayResponse(updated);
  }

  async checkOut(userId: string) {
    const today = this.todayDate();
    const record = await this.getOrCreateRecord(userId, today);
    const newState = transition(record.checkState as CheckState, "CHECK_OUT");
    const now = new Date();

    // 실근무 시간 계산
    const netWorkMinutes = record.checkIn
      ? Math.floor((now.getTime() - new Date(record.checkIn).getTime()) / 60000) - record.breakMinutes
      : 0;

    const updated = await this.prisma.attendanceRecord.update({
      where: { userId_date: { userId, date: today } },
      data: { checkOut: now, checkState: newState, netWorkMinutes: Math.max(0, netWorkMinutes) },
      include: { breakRecords: { orderBy: { breakOut: "desc" }, take: 1 } },
    });
    return this.formatTodayResponse(updated);
  }

  async breakOut(userId: string) {
    const today = this.todayDate();
    const record = await this.getOrCreateRecord(userId, today);
    transition(record.checkState as CheckState, "BREAK_OUT"); // 유효성 검증

    const breakRecord = await this.prisma.breakRecord.create({
      data: { attendanceId: record.id, breakOut: new Date() },
    });

    await this.prisma.attendanceRecord.update({
      where: { userId_date: { userId, date: today } },
      data: { checkState: "ON_BREAK" },
    });

    return { breakId: breakRecord.id, breakOut: breakRecord.breakOut };
  }

  async breakIn(userId: string) {
    const today = this.todayDate();
    const record = await this.getOrCreateRecord(userId, today);
    transition(record.checkState as CheckState, "BREAK_IN"); // 유효성 검증

    // 가장 최근 미완료 외출 기록 종료
    const activeBreak = await this.prisma.breakRecord.findFirst({
      where: { attendanceId: record.id, breakIn: null },
      orderBy: { breakOut: "desc" },
    });
    if (!activeBreak) throw new Error("진행 중인 외출 기록이 없습니다.");

    const now = new Date();
    const durationMinutes = Math.floor(
      (now.getTime() - new Date(activeBreak.breakOut).getTime()) / 60000,
    );

    await this.prisma.breakRecord.update({
      where: { id: activeBreak.id },
      data: { breakIn: now, durationMinutes },
    });

    const newBreakMinutes = record.breakMinutes + durationMinutes;
    const updated = await this.prisma.attendanceRecord.update({
      where: { userId_date: { userId, date: today } },
      data: { checkState: "CHECKED_IN", breakMinutes: newBreakMinutes },
      include: { breakRecords: { orderBy: { breakOut: "desc" }, take: 1 } },
    });
    return this.formatTodayResponse(updated);
  }

  // 월간 근태 달력
  async getCalendar(userId: string, year: number, month: number) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);

    const [records, holidays] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { userId, date: { gte: start, lte: end } },
        orderBy: { date: "asc" },
      }),
      this.prisma.publicHoliday.findMany({
        where: { year, date: { gte: start, lte: end } },
      }),
    ]);

    const holidayMap = new Map(holidays.map((h) => [this.formatDate(h.date), h.name]));
    const recordMap = new Map(records.map((r) => [this.formatDate(r.date), r]));

    const days = [];
    let workDays = 0, presentDays = 0, absentDays = 0, leaveDays = 0, lateDays = 0;
    let totalOtHours = 0, totalNetWorkHours = 0;

    const cur = new Date(start);
    while (cur <= end) {
      const dateStr = this.formatDate(cur);
      const dow = cur.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const holidayName = holidayMap.get(dateStr);
      const rec = recordMap.get(dateStr);

      if (!isWeekend && !holidayName) workDays++;

      const day: any = { date: dateStr };
      if (isWeekend) {
        day.status = "WEEKEND";
      } else if (holidayName) {
        day.status = "HOLIDAY";
        day.holidayName = holidayName;
      } else if (rec) {
        day.status = rec.status;
        day.checkIn = rec.checkIn?.toISOString();
        day.checkOut = rec.checkOut?.toISOString();
        day.netWorkHours = +(rec.netWorkMinutes / 60).toFixed(2);
        day.isLate = rec.isLate;

        if (rec.status === "NORMAL" || rec.status === "LATE") presentDays++;
        if (rec.status === "ABSENT") absentDays++;
        if (rec.status === "LEAVE") leaveDays++;
        if (rec.isLate) lateDays++;
        totalNetWorkHours += rec.netWorkMinutes / 60;
      } else {
        day.status = "NORMAL";
      }

      days.push(day);
      cur.setDate(cur.getDate() + 1);
    }

    return {
      year, month, days,
      summary: { workDays, presentDays, absentDays, leaveDays, lateDays, totalOtHours, totalNetWorkHours: +totalNetWorkHours.toFixed(2) },
    };
  }

  // 미출근 자동처리 (Cron용)
  async processAbsentRecords() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    // 어제 날짜 기준 출퇴근 기록이 없거나 NOT_STARTED인 것 → ABSENT
    // (실제로는 user-service에서 전체 userId 목록이 필요하지만, 기존 레코드 기준으로 처리)
    await this.prisma.attendanceRecord.updateMany({
      where: {
        date: yesterday,
        checkState: "NOT_STARTED",
        status: { notIn: ["LEAVE", "HOLIDAY"] },
      },
      data: { status: "ABSENT" },
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async getOrCreateRecord(userId: string, date: Date) {
    const existing = await this.prisma.attendanceRecord.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (existing) return existing;
    const status = await this.resolveTodayStatus(userId, date);
    return this.prisma.attendanceRecord.create({
      data: { userId, date, status, checkState: "NOT_STARTED" },
    });
  }

  private async resolveTodayStatus(userId: string, date: Date) {
    const holiday = await this.prisma.publicHoliday.findUnique({ where: { date } });
    if (holiday) return "HOLIDAY" as const;
    const leave = await this.prisma.leaveRequest.findFirst({
      where: { userId, status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } },
    });
    if (leave) return "LEAVE" as const;
    return "NORMAL" as const;
  }

  private async getPolicy() {
    const p = await this.prisma.attendancePolicy.findFirst();
    return p ?? {
      workStartTime: "09:00", workEndTime: "18:00",
      dailyWorkHours: 8, lateToleranceMinutes: 0,
      leavePolicy: "HIRE_DATE", annualLeaveBase: 15,
    };
  }

  private formatTodayResponse(record: any) {
    const activeBreak = record.breakRecords?.find((b: any) => !b.breakIn);
    return {
      date: this.formatDate(record.date),
      checkState: record.checkState,
      checkIn: record.checkIn?.toISOString(),
      checkOut: record.checkOut?.toISOString(),
      workType: record.workType,
      status: record.status,
      isLate: record.isLate,
      lateMinutes: record.lateMinutes,
      netWorkMinutes: record.netWorkMinutes,
      breakMinutes: record.breakMinutes,
      activeBreak: activeBreak
        ? {
            breakOut: activeBreak.breakOut.toISOString(),
            elapsedMinutes: Math.floor((Date.now() - new Date(activeBreak.breakOut).getTime()) / 60000),
          }
        : undefined,
    };
  }

  private todayDate() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private formatDate(d: Date) {
    return new Date(d).toISOString().slice(0, 10);
  }
}
