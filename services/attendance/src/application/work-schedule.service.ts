import { PrismaClient, Prisma, EntryType, EntrySource } from "@prisma/client";
import { AuthClient } from "../infrastructure/auth-client.js";

interface UserWithDept {
  id: string;
  name: string;
  email: string;
  departmentId: string | null;
  departmentName: string | null;
  departmentSortOrder: number;
}

export class WorkScheduleService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly authClient: AuthClient,
  ) {}

  async getWeeklyOverview(start: string, end: string) {
    const startDate = new Date(start);
    const endDate = new Date(end);

    // 1. 전체 사용자 + 부서 목록 조회
    const allUsers = await this.authClient.getAllUsersWithDepartments();

    // 2. 해당 기간 엔트리 조회 (외근/교육/출장/휴가 등)
    const entries = await this.prisma.workScheduleEntry.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: "asc" },
    });

    // 2-1. 출근(WORK) 바는 attendance_records(출퇴근 시각)에서 합성 — 단일 출처.
    //      work_schedule의 WORK 엔트리는 무시(이중표시 방지).
    const records = await this.prisma.attendanceRecord.findMany({
      where: { date: { gte: startDate, lte: endDate }, OR: [{ checkIn: { not: null } }, { checkOut: { not: null } }] },
    });
    const toKstHHMM = (d: Date) => {
      const k = new Date(d.getTime() + 9 * 3600 * 1000);
      return String(k.getUTCHours()).padStart(2, "0") + ":" + String(k.getUTCMinutes()).padStart(2, "0");
    };
    const synthWork = records.map((r) => ({
      id: "att-" + r.id,
      userId: r.userId,
      date: r.date,
      entryType: "WORK" as any,
      startTime: r.checkIn ? toKstHHMM(r.checkIn) : null,
      endTime: r.checkOut ? toKstHHMM(r.checkOut) : null,
      label: null as string | null,
      groupId: null as string | null,
      sourceType: "AUTO" as any,
      sourceId: null as string | null,
    }));

    // 3. userId → entries 매핑 (work_schedule의 WORK 제외 + 합성 WORK 추가)
    const entryMap = new Map<string, any[]>();
    const pushEntry = (e: any) => {
      if (!entryMap.has(e.userId)) entryMap.set(e.userId, []);
      entryMap.get(e.userId)!.push(e);
    };
    for (const e of entries) { if (e.entryType === "WORK") continue; pushEntry(e); }
    for (const e of synthWork) pushEntry(e);

    // 3-1. 개인 근무시간(유연근무) 맵 — 전사근태 바를 본인 근무시간 축에 그리기 위함. 없으면 회사 기본.
    const schedules = await this.prisma.userWorkSchedule.findMany();
    const schedMap = new Map(schedules.map((s) => [s.userId, { workStartTime: s.workStartTime, workEndTime: s.workEndTime }]));
    const sched = (uid: string) => schedMap.get(uid) ?? { workStartTime: "09:30", workEndTime: "18:30" };

    // 4. 부서별 그룹핑
    const deptMap = new Map<string, { id: string; name: string; sortOrder: number; members: UserWithDept[] }>();
    const unassigned: UserWithDept[] = [];

    for (const u of allUsers) {
      if (u.departmentId && u.departmentName) {
        if (!deptMap.has(u.departmentId)) {
          deptMap.set(u.departmentId, {
            id: u.departmentId,
            name: u.departmentName,
            sortOrder: u.departmentSortOrder,
            members: [],
          });
        }
        deptMap.get(u.departmentId)!.members.push(u);
      } else {
        unassigned.push(u);
      }
    }

    // 5. 정렬 + 응답 구성
    const departments = Array.from(deptMap.values())
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((dept) => ({
        id: dept.id,
        name: dept.name,
        sortOrder: dept.sortOrder,
        members: dept.members
          .sort((a, b) => a.name.localeCompare(b.name, "ko"))
          .map((m) => ({
            userId: m.id,
            name: m.name,
            ...sched(m.id),
            entries: (entryMap.get(m.id) ?? []).map((e) => ({
              id: e.id,
              date: e.date.toISOString().slice(0, 10),
              entryType: e.entryType,
              startTime: e.startTime,
              endTime: e.endTime,
              label: e.label,
              groupId: e.groupId,
              sourceType: e.sourceType,
              sourceId: e.sourceId,
            })),
          })),
      }));

    return {
      weekStart: start,
      weekEnd: end,
      departments,
      unassigned: unassigned.map((m) => ({
        userId: m.id,
        name: m.name,
        ...sched(m.id),
        entries: (entryMap.get(m.id) ?? []).map((e) => ({
          id: e.id,
          date: e.date.toISOString().slice(0, 10),
          entryType: e.entryType,
          startTime: e.startTime,
          endTime: e.endTime,
          label: e.label,
          groupId: e.groupId,
          sourceType: e.sourceType,
          sourceId: e.sourceId,
        })),
      })),
    };
  }

  async createEntry(userId: string, data: { date: string; entryType: string; startTime?: string; endTime?: string; label?: string; groupId?: string }) {
    const validManualTypes: string[] = ["WORK", "FIELD", "TRAINING", "BUSINESS_TRIP"];
    if (!validManualTypes.includes(data.entryType)) {
      throw new Error(`수동 추가 불가: ${data.entryType}은(는) 결재를 통해서만 반영됩니다.`);
    }

    return this.prisma.workScheduleEntry.create({
      data: {
        userId,
        date: new Date(data.date),
        entryType: data.entryType as EntryType,
        startTime: data.startTime ?? null,
        endTime: data.endTime ?? null,
        label: data.label ?? null,
        groupId: data.groupId ?? null,
        sourceType: "MANUAL",
      },
    });
  }

  async updateEntry(id: string, userId: string, data: { entryType?: string; startTime?: string; endTime?: string; label?: string }) {
    const entry = await this.prisma.workScheduleEntry.findUnique({ where: { id } });
    if (!entry) throw new Error("항목을 찾을 수 없습니다.");
    if (entry.userId !== userId) throw new Error("본인의 항목만 수정할 수 있습니다.");
    if (entry.sourceType !== "MANUAL") {
      throw new Error("자동 생성된 항목은 수정할 수 없습니다.");
    }

    return this.prisma.workScheduleEntry.update({
      where: { id },
      data: {
        ...(data.entryType != null ? { entryType: data.entryType as EntryType } : {}),
        ...(data.startTime !== undefined ? { startTime: data.startTime } : {}),
        ...(data.endTime !== undefined ? { endTime: data.endTime } : {}),
        ...(data.label !== undefined ? { label: data.label || null } : {}),
      },
    });
  }

  async updateGroup(groupId: string, userId: string, data: { entryType?: string; startTime?: string; endTime?: string; label?: string }) {
    const entries = await this.prisma.workScheduleEntry.findMany({ where: { groupId, userId, sourceType: "MANUAL" } });
    if (entries.length === 0) throw new Error("그룹을 찾을 수 없습니다.");

    const updateData: Prisma.WorkScheduleEntryUncheckedUpdateInput = {};
    if (data.entryType != null) updateData.entryType = data.entryType as EntryType;
    if (data.startTime !== undefined) updateData.startTime = data.startTime;
    if (data.endTime !== undefined) updateData.endTime = data.endTime;
    if (data.label !== undefined) updateData.label = data.label || null;

    await this.prisma.workScheduleEntry.updateMany({
      where: { groupId, userId, sourceType: "MANUAL" },
      data: updateData,
    });

    return { updated: entries.length };
  }

  async deleteGroup(groupId: string, userId: string) {
    const result = await this.prisma.workScheduleEntry.deleteMany({
      where: { groupId, userId, sourceType: "MANUAL" },
    });
    if (result.count === 0) throw new Error("삭제할 항목이 없습니다.");
    return { deleted: result.count };
  }

  async deleteEntry(id: string, userId: string) {
    const entry = await this.prisma.workScheduleEntry.findUnique({ where: { id } });
    if (!entry) throw new Error("항목을 찾을 수 없습니다.");
    if (entry.userId !== userId) throw new Error("본인의 항목만 삭제할 수 있습니다.");
    if (entry.sourceType !== "MANUAL") {
      throw new Error("자동 생성된 항목은 삭제할 수 없습니다. 해당 결재를 취소해 주세요.");
    }

    await this.prisma.workScheduleEntry.delete({ where: { id } });
  }

  // 휴가 승인 시 호출
  async syncLeaveApproval(leaveRequest: {
    id: string; userId: string; type: string;
    startDate: Date; endDate: Date;
  }, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const entryType = this.mapLeaveTypeToEntryType(leaveRequest.type);
    const dates = this.getDateRange(leaveRequest.startDate, leaveRequest.endDate);

    for (const date of dates) {
      await db.workScheduleEntry.upsert({
        where: {
          userId_date_entryType_sourceId: {
            userId: leaveRequest.userId,
            date,
            entryType,
            sourceId: leaveRequest.id,
          },
        },
        create: {
          userId: leaveRequest.userId,
          date,
          entryType,
          sourceType: "LEAVE_APPROVED" as EntrySource,
          sourceId: leaveRequest.id,
        },
        update: {},
      });
    }
  }

  // 취소 시 호출
  async removeSyncedEntries(sourceId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    await db.workScheduleEntry.deleteMany({ where: { sourceId } });
  }

  private mapLeaveTypeToEntryType(leaveType: string): EntryType {
    const map: Record<string, EntryType> = {
      ANNUAL: "ANNUAL",
      HALF: "HALF",
      QUARTER: "QUARTER",
      FAMILY_DAY: "FAMILY_DAY",
      FAMILY_DAY_2H: "FAMILY_DAY_2H",
      BEREAVEMENT: "BEREAVEMENT",
      SICK: "SICK",
      SPECIAL: "SPECIAL",
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
