/**
 * 한국 공휴일 자동 갱신 서비스
 * - KASI 특일 정보 API로 연도별 공휴일 fetch
 * - DB의 source=KASI 행만 diff → upsert/delete (source=MANUAL 행은 절대 건드리지 않음)
 *
 * 회사달력 v1.2
 */

import { PrismaClient, CalendarEntryType } from "@prisma/client";
import { KasiClient, KasiHoliday } from "../infrastructure/clients/kasi-client";

const SYSTEM_USER_ID = "system-kasi-sync";

export interface SyncYearResult {
  year: number;
  fetched: number;
  created: number;
  updated: number;
  deleted: number;
  durationMs: number;
}

export class HolidaySyncService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly kasi: KasiClient,
  ) {}

  /**
   * 특정 연도의 공휴일을 KASI에서 받아 DB와 동기화한다.
   * - source=KASI 행만 SELECT/INSERT/UPDATE/DELETE
   * - source=MANUAL 행은 어떤 단계에서도 건드리지 않음 (사용자 등록 보호)
   */
  async syncYear(year: number): Promise<SyncYearResult> {
    const startedAt = Date.now();

    const remote = await this.kasi.getHolidaysByYear(year);
    const remoteByExtId = new Map<string, KasiHoliday>();
    for (const h of remote) remoteByExtId.set(h.externalId, h);

    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year, 11, 31));

    const existing = await this.prisma.companyCalendarEntry.findMany({
      where: {
        source: "KASI",
        startDate: { gte: yearStart, lte: yearEnd },
      },
    });
    const existingByExtId = new Map(existing.map((e) => [e.externalId ?? "", e]));

    const toCreate: KasiHoliday[] = [];
    const toUpdate: { id: string; remote: KasiHoliday }[] = [];
    const toDeleteIds: string[] = [];

    for (const r of remote) {
      const e = existingByExtId.get(r.externalId);
      if (!e) {
        toCreate.push(r);
      } else if (e.title !== r.dateName || this.toIsoDate(e.startDate) !== r.date) {
        toUpdate.push({ id: e.id, remote: r });
      }
    }

    for (const e of existing) {
      if (!e.externalId || !remoteByExtId.has(e.externalId)) {
        toDeleteIds.push(e.id);
      }
    }

    let created = 0;
    let updated = 0;
    let deleted = 0;

    await this.prisma.$transaction(async (tx) => {
      if (toCreate.length > 0) {
        const data = toCreate.map((r) => ({
          type: CalendarEntryType.PUBLIC_HOLIDAY,
          title: r.dateName,
          startDate: this.toDate(r.date),
          endDate: this.toDate(r.date),
          isAllDay: true,
          source: "KASI" as const,
          externalId: r.externalId,
          createdBy: SYSTEM_USER_ID,
        }));
        const result = await tx.companyCalendarEntry.createMany({ data });
        created = result.count;
      }

      for (const u of toUpdate) {
        await tx.companyCalendarEntry.update({
          where: { id: u.id },
          data: {
            title: u.remote.dateName,
            startDate: this.toDate(u.remote.date),
            endDate: this.toDate(u.remote.date),
          },
        });
        updated++;
      }

      if (toDeleteIds.length > 0) {
        const result = await tx.companyCalendarEntry.deleteMany({
          where: { id: { in: toDeleteIds }, source: "KASI" },
        });
        deleted = result.count;
      }
    });

    return {
      year,
      fetched: remote.length,
      created,
      updated,
      deleted,
      durationMs: Date.now() - startedAt,
    };
  }

  private toDate(iso: string): Date {
    return new Date(iso + "T00:00:00.000Z");
  }

  private toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}
