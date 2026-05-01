import { PrismaClient, Prisma, CalendarEntryType } from "@prisma/client";

export class CalendarError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "CalendarError";
  }
}

export interface CreateEntryInput {
  type: CalendarEntryType;
  title: string;
  description?: string | null | undefined;
  startDate: string;
  endDate: string;
  color?: string | null | undefined;
}

export interface UpdateEntryInput {
  type?: CalendarEntryType | undefined;
  title?: string | undefined;
  description?: string | null | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  color?: string | null | undefined;
}

function toDate(s: string): Date {
  return new Date(s + "T00:00:00.000Z");
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class CalendarService {
  constructor(private readonly prisma: PrismaClient) {}

  // createdBy → createdByName 일괄 조회 (CompanyCalendar는 auth-service의 User 모델 사용)
  private async attachCreatedByName<T extends { createdBy: string }>(entries: T[]): Promise<Array<T & { createdByName: string | null }>> {
    const ids = [...new Set(entries.map((e) => e.createdBy).filter(Boolean))];
    if (ids.length === 0) return entries.map((e) => ({ ...e, createdByName: null }));
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(users.map((u) => [u.id, u.name]));
    return entries.map((e) => ({ ...e, createdByName: nameMap.get(e.createdBy) ?? null }));
  }

  async list(params: { from?: string | undefined; to?: string | undefined; type?: CalendarEntryType | undefined }) {
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const from = params.from ? toDate(params.from) : defaultFrom;
    const to = params.to ? toDate(params.to) : defaultTo;

    // overlap: NOT (endDate < from OR startDate > to)
    const where: Prisma.CompanyCalendarEntryWhereInput = {
      AND: [
        { endDate: { gte: from } },
        { startDate: { lte: to } },
      ],
    };
    if (params.type) where.type = params.type;

    const entries = await this.prisma.companyCalendarEntry.findMany({
      where,
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
    });
    return this.attachCreatedByName(entries);
  }

  async upcoming(days: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const limit = new Date(today);
    limit.setDate(limit.getDate() + days);

    return this.prisma.companyCalendarEntry.findMany({
      where: {
        endDate: { gte: today },
        startDate: { lte: limit },
      },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
    });
  }

  async getById(id: string) {
    const entry = await this.prisma.companyCalendarEntry.findUnique({ where: { id } });
    if (!entry) throw new CalendarError("CALENDAR_NOT_FOUND", "항목을 찾을 수 없습니다.", 404);
    const [withName] = await this.attachCreatedByName([entry]);
    return withName;
  }

  async create(input: CreateEntryInput, createdBy: string) {
    return this.prisma.companyCalendarEntry.create({
      data: {
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        startDate: toDate(input.startDate),
        endDate: toDate(input.endDate),
        color: input.color ?? null,
        createdBy,
      },
    });
  }

  async update(id: string, input: UpdateEntryInput) {
    const existing = await this.prisma.companyCalendarEntry.findUnique({ where: { id } });
    if (!existing) throw new CalendarError("CALENDAR_NOT_FOUND", "항목을 찾을 수 없습니다.", 404);

    const data: Prisma.CompanyCalendarEntryUpdateInput = {};
    if (input.type !== undefined) data.type = input.type;
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.startDate !== undefined) data.startDate = toDate(input.startDate);
    if (input.endDate !== undefined) data.endDate = toDate(input.endDate);
    if (input.color !== undefined) data.color = input.color;

    // 추가 검증: 최종 startDate ≤ endDate
    const finalStart = input.startDate ? toDate(input.startDate) : existing.startDate;
    const finalEnd = input.endDate ? toDate(input.endDate) : existing.endDate;
    if (finalEnd < finalStart) {
      throw new CalendarError("INVALID_DATE_RANGE", "종료일은 시작일보다 빠를 수 없습니다.", 400);
    }

    return this.prisma.companyCalendarEntry.update({ where: { id }, data });
  }

  async remove(id: string) {
    const existing = await this.prisma.companyCalendarEntry.findUnique({ where: { id } });
    if (!existing) throw new CalendarError("CALENDAR_NOT_FOUND", "항목을 찾을 수 없습니다.", 404);
    await this.prisma.companyCalendarEntry.delete({ where: { id } });
  }

  // Internal: 휴일만 일자별로 정규화 반환 (attendance/project 소비용)
  async holidaysByDate(from: string, to: string): Promise<Array<{ date: string; title: string; type: string }>> {
    const fromDate = toDate(from);
    const toEndDate = toDate(to);

    const entries = await this.prisma.companyCalendarEntry.findMany({
      where: {
        type: { in: ["PUBLIC_HOLIDAY", "COMPANY_HOLIDAY"] },
        endDate: { gte: fromDate },
        startDate: { lte: toEndDate },
      },
    });

    const result: Array<{ date: string; title: string; type: string }> = [];
    for (const e of entries) {
      const start = e.startDate < fromDate ? fromDate : e.startDate;
      const end = e.endDate > toEndDate ? toEndDate : e.endDate;
      const cur = new Date(start);
      while (cur <= end) {
        result.push({ date: toIsoDate(cur), title: e.title, type: e.type });
        cur.setDate(cur.getDate() + 1);
      }
    }
    return result;
  }
}
