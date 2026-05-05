import { PrismaClient, Prisma, ReservationStatus } from "@prisma/client";
import { AppError } from "@erp-ot/shared";
import {
  expand,
  overlaps,
  recurrenceLabel,
  type Recurrence,
  type InstanceWindow,
} from "./recurrence/recurrence-expander.js";
import type {
  CreateReservationDto,
  UpdateReservationDto,
} from "../api/dtos/equipment-reservation.dto.js";

// 공용자산예약 (2026-05-05)
//   - 단발/반복 통합 모델 (recurrence JSON)
//   - 충돌 검사 = transaction에서 검사 + insert
//   - soft delete (status=CANCELED)

export interface ReservationContext {
  userId: string;
  role: "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
}

export interface ListFilter {
  from?: string | undefined; // YYYY-MM-DD
  to?: string | undefined;
  resourceId?: string | undefined;
  userId?: string | undefined;
}

export interface InstancePayload {
  id: string;
  parentId: string | null;
  instanceKey: string; // {parentId}:{startISO}
  resourceId: string;
  resourceName: string;
  userId: string;
  userName?: string | null;
  title: string;
  description: string | null;
  startAt: string; // ISO
  endAt: string;
  isAllDay: boolean;
  isRecurring: boolean;
  isException: boolean;
  recurrenceSummary: string;
  status: ReservationStatus;
}

interface ConflictDetail {
  instanceKey: string;
  startAt: string;
  endAt: string;
  title: string;
  userId: string;
}

const DEFAULT_WINDOW_DAYS = 31;

export class EquipmentReservationService {
  constructor(private readonly prisma: PrismaClient) {}

  // ─── 조회 (반복 가상 전개) ──────────────────────────────────────────────────

  async listExpanded(filter: ListFilter): Promise<InstancePayload[]> {
    const { fromDate, toDate } = this.resolveWindow(filter.from, filter.to);

    // 후보 row: 단발(범위 겹침) OR 반복(시리즈가 윈도우와 겹칠 가능성) OR 예외 취소 row
    // 예외 row는 status=CANCELED일 수 있으므로 각 분기에 status 조건을 명시.
    const where: Prisma.EquipmentReservationWhereInput = {
      OR: [
        // 단발 (CONFIRMED): 시간이 윈도우와 겹침, 예외 row 아님
        {
          status: "CONFIRMED",
          recurrence: { equals: Prisma.JsonNull },
          recurrenceParentId: null,
          startAt: { lte: toDate },
          endAt: { gte: fromDate },
        },
        // 반복 (CONFIRMED): anchor가 윈도우 끝 이전
        {
          status: "CONFIRMED",
          recurrence: { not: Prisma.JsonNull },
          startAt: { lte: toDate },
        },
        // 예외 row (CONFIRMED 또는 CANCELED): recurrenceParentId set, recurrence null
        // — CANCELED 예외 row는 인스턴스 덮어쓰기(취소)에 사용
        {
          recurrenceParentId: { not: null },
          recurrence: { equals: Prisma.JsonNull },
          startAt: { lte: toDate },
          endAt: { gte: fromDate },
        },
      ],
    };
    if (filter.resourceId) where.resourceId = filter.resourceId;
    if (filter.userId) where.userId = filter.userId;

    const rows = await this.prisma.equipmentReservation.findMany({
      where,
      include: { resource: { select: { id: true, name: true, type: true } } },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
    });

    // 사용자 이름 일괄 조회
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const userNameMap = await this.fetchUserNames(userIds);

    // 예외 row 별도 분리: parentId 동일한 인스턴스 시각의 인스턴스를 덮어씀(또는 취소)
    const exceptions = new Map<string, typeof rows>(); // parentId → exception rows
    for (const r of rows) {
      if (r.recurrenceParentId) {
        const list = exceptions.get(r.recurrenceParentId) ?? [];
        list.push(r);
        exceptions.set(r.recurrenceParentId, list);
      }
    }

    const result: InstancePayload[] = [];
    for (const r of rows) {
      // 예외 row: CANCELED는 인스턴스 덮어쓰기에만 사용(목록 미노출), CONFIRMED는 단발 인스턴스로 추가
      if (r.recurrenceParentId) {
        if (r.status === "CONFIRMED" && this.intersectsWindow(r.startAt, r.endAt, fromDate, toDate)) {
          result.push(this.toInstancePayload(r, r.recurrenceParentId, true, userNameMap));
        }
        continue;
      }

      if (!r.recurrence) {
        // 단발 (이 분기는 outer where에서 CONFIRMED만 들어옴)
        result.push(this.toInstancePayload(r, null, false, userNameMap));
        continue;
      }

      // 반복: expand 후 예외/취소 적용
      const recurrence = r.recurrence as unknown as Recurrence;
      const anchor: InstanceWindow = { startAt: r.startAt, endAt: r.endAt };
      const instances = expand(recurrence, anchor, fromDate, toDate);
      const exList = exceptions.get(r.id) ?? [];
      const overrideStarts = new Set(exList.map((e) => e.startAt.toISOString()));

      for (const inst of instances) {
        const key = inst.startAt.toISOString();
        if (overrideStarts.has(key)) continue; // 예외/취소된 인스턴스 — 예외 row에서 처리됨
        result.push({
          id: r.id,
          parentId: r.id,
          instanceKey: `${r.id}:${key}`,
          resourceId: r.resourceId,
          resourceName: r.resource.name,
          userId: r.userId,
          userName: userNameMap.get(r.userId) ?? null,
          title: r.title,
          description: r.description,
          startAt: key,
          endAt: inst.endAt.toISOString(),
          isAllDay: r.isAllDay,
          isRecurring: true,
          isException: false,
          recurrenceSummary: recurrenceLabel(recurrence),
          status: r.status,
        });
      }
    }

    result.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.resourceId.localeCompare(b.resourceId));
    return result;
  }

  // ─── 단건 조회 ───────────────────────────────────────────────────────────────

  async getById(id: string): Promise<InstancePayload> {
    const r = await this.prisma.equipmentReservation.findUnique({
      where: { id },
      include: { resource: { select: { id: true, name: true, type: true } } },
    });
    if (!r) throw new AppError(404, "RESERVATION_NOT_FOUND", "예약을 찾을 수 없습니다.");
    const userNameMap = await this.fetchUserNames([r.userId]);
    return this.toInstancePayload(r, r.recurrenceParentId ?? null, !!r.recurrenceParentId, userNameMap);
  }

  // ─── 내 예약 목록 ────────────────────────────────────────────────────────────

  async listMine(userId: string, opts: { upcoming?: boolean | undefined; limit?: number | undefined } = {}) {
    const where: Prisma.EquipmentReservationWhereInput = {
      userId,
      status: "CONFIRMED",
    };
    if (opts.upcoming) {
      where.endAt = { gte: new Date() };
    }
    const rows = await this.prisma.equipmentReservation.findMany({
      where,
      include: { resource: { select: { id: true, name: true, type: true } } },
      orderBy: [{ startAt: "asc" }],
      take: opts.limit ?? 50,
    });
    const userNameMap = await this.fetchUserNames([userId]);
    return rows.map((r) =>
      this.toInstancePayload(r, r.recurrenceParentId ?? null, !!r.recurrenceParentId, userNameMap),
    );
  }

  // ─── 등록 (충돌 검사) ────────────────────────────────────────────────────────

  async create(dto: CreateReservationDto, ctx: ReservationContext) {
    // 자원 검증
    const resource = await this.prisma.equipmentResource.findUnique({
      where: { id: dto.resourceId },
    });
    if (!resource) throw new AppError(404, "RESOURCE_NOT_FOUND", "자원을 찾을 수 없습니다.");
    if (!resource.isActive) throw new AppError(422, "RESOURCE_INACTIVE", "비활성 자원입니다.");

    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    const recurrence = (dto.recurrence ?? null) as Recurrence | null;

    // 충돌 검사 + insert를 하나의 트랜잭션으로
    return await this.prisma.$transaction(async (tx) => {
      const conflicts = await this.findConflictsForNew(tx, dto.resourceId, startAt, endAt, recurrence);
      if (conflicts.length > 0) {
        throw new AppError(409, "RESERVATION_CONFLICT", "시간 겹치는 예약이 있습니다.", { conflicts });
      }
      return tx.equipmentReservation.create({
        data: {
          resourceId: dto.resourceId,
          userId: ctx.userId,
          title: dto.title,
          description: dto.description ?? null,
          startAt,
          endAt,
          isAllDay: dto.isAllDay ?? false,
          recurrence: recurrence ? (recurrence as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });
    });
  }

  // ─── 수정 ─────────────────────────────────────────────────────────────────────

  async update(
    id: string,
    dto: UpdateReservationDto,
    ctx: ReservationContext,
    scope: "instance" | "series" = "instance",
  ) {
    const existing = await this.prisma.equipmentReservation.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "RESERVATION_NOT_FOUND", "예약을 찾을 수 없습니다.");
    this.assertCanModify(existing.userId, ctx);

    // 시리즈 전체 vs 인스턴스 단일은 1차에서는 단순화: 단발 row에 대한 PATCH만 지원.
    // 반복 시리즈의 부분 수정은 cancel(scope=instance) → 새 단발 등록의 2단계로 운영.
    if (existing.recurrence && scope === "instance") {
      throw new AppError(
        400,
        "UNSUPPORTED_PARTIAL_UPDATE",
        "반복 시리즈의 인스턴스 단일 수정은 1차에서 지원하지 않습니다. 시리즈 전체 변경(scope=series) 또는 해당 인스턴스 취소 후 신규 등록을 사용하세요.",
      );
    }

    const newStart = dto.startAt ? new Date(dto.startAt) : existing.startAt;
    const newEnd = dto.endAt ? new Date(dto.endAt) : existing.endAt;
    const newRecurrence =
      dto.recurrence !== undefined
        ? ((dto.recurrence as Recurrence | null) ?? null)
        : ((existing.recurrence as unknown as Recurrence | null) ?? null);

    return await this.prisma.$transaction(async (tx) => {
      const conflicts = await this.findConflictsForNew(
        tx,
        existing.resourceId,
        newStart,
        newEnd,
        newRecurrence,
        id,
      );
      if (conflicts.length > 0) {
        throw new AppError(409, "RESERVATION_CONFLICT", "시간 겹치는 예약이 있습니다.", { conflicts });
      }
      return tx.equipmentReservation.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.startAt !== undefined ? { startAt: newStart } : {}),
          ...(dto.endAt !== undefined ? { endAt: newEnd } : {}),
          ...(dto.isAllDay !== undefined ? { isAllDay: dto.isAllDay } : {}),
          ...(dto.recurrence !== undefined
            ? {
                recurrence: newRecurrence
                  ? (newRecurrence as unknown as Prisma.InputJsonValue)
                  : Prisma.JsonNull,
              }
            : {}),
        },
      });
    });
  }

  // ─── 취소 (soft delete) ─────────────────────────────────────────────────────

  async cancel(
    id: string,
    ctx: ReservationContext,
    scope: "instance" | "series" = "instance",
    reason?: string,
    instanceStartAt?: string, // scope=instance + 반복 시리즈일 때 어느 인스턴스 취소
  ) {
    const existing = await this.prisma.equipmentReservation.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "RESERVATION_NOT_FOUND", "예약을 찾을 수 없습니다.");
    this.assertCanModify(existing.userId, ctx);

    // 단발 또는 시리즈 전체
    if (!existing.recurrence || scope === "series") {
      await this.prisma.equipmentReservation.updateMany({
        where: {
          OR: [{ id }, { recurrenceParentId: id }],
        },
        data: {
          status: "CANCELED",
          cancelReason: reason ?? null,
          canceledAt: new Date(),
          canceledBy: ctx.userId,
        },
      });
      return { canceled: true, scope };
    }

    // 반복 시리즈의 인스턴스 단일 취소: 예외 row 추가 (status=CANCELED, recurrenceParentId=id)
    if (!instanceStartAt) {
      throw new AppError(
        400,
        "INSTANCE_DATE_REQUIRED",
        "반복 시리즈의 인스턴스 단일 취소는 instanceStartAt이 필요합니다.",
      );
    }
    const startAt = new Date(instanceStartAt);
    const duration = existing.endAt.getTime() - existing.startAt.getTime();
    const endAt = new Date(startAt.getTime() + duration);

    await this.prisma.equipmentReservation.create({
      data: {
        resourceId: existing.resourceId,
        userId: existing.userId,
        title: existing.title,
        description: existing.description,
        startAt,
        endAt,
        isAllDay: existing.isAllDay,
        recurrence: Prisma.JsonNull,
        recurrenceParentId: id,
        status: "CANCELED",
        cancelReason: reason ?? null,
        canceledAt: new Date(),
        canceledBy: ctx.userId,
      },
    });
    return { canceled: true, scope: "instance" as const, instanceStartAt };
  }

  // ─── 충돌 검사 (private) ────────────────────────────────────────────────────

  private async findConflictsForNew(
    tx: Prisma.TransactionClient,
    resourceId: string,
    startAt: Date,
    endAt: Date,
    recurrence: Recurrence | null,
    excludeId?: string,
  ): Promise<ConflictDetail[]> {
    // 신규 후보 인스턴스 (반복이면 전개)
    const candidateInstances: InstanceWindow[] = recurrence
      ? expand(recurrence, { startAt, endAt }, startAt, this.recurrenceWindowEnd(recurrence, startAt))
      : [{ startAt, endAt }];

    if (candidateInstances.length === 0) return [];

    // 같은 자원의 활성 예약을 모두 가져와서 메모리에서 비교
    // (성능: 평균 ~수십 건 수준이라 충분, 대규모 시 SQL 최적화 가능)
    const minStart = candidateInstances[0]!.startAt;
    const maxEnd = candidateInstances[candidateInstances.length - 1]!.endAt;

    const existingRows = await tx.equipmentReservation.findMany({
      where: {
        resourceId,
        status: "CONFIRMED",
        ...(excludeId ? { id: { not: excludeId } } : {}),
        // anchor가 윈도우 안에 있을 가능성 (반복은 anchor만 검사하면 안 됨 — 단순화 위해 자원 전체 가져옴)
      },
      orderBy: [{ startAt: "asc" }],
    });

    const conflicts: ConflictDetail[] = [];
    for (const cand of candidateInstances) {
      for (const ex of existingRows) {
        // 예외 취소 row는 충돌 검사 대상 아님 — recurrenceParentId 있고 status=CANCELED는 이미 위에서 걸러짐
        // 단발/예외 row
        if (!ex.recurrence) {
          if (overlaps(cand, { startAt: ex.startAt, endAt: ex.endAt })) {
            conflicts.push({
              instanceKey: `${ex.recurrenceParentId ?? ex.id}:${ex.startAt.toISOString()}`,
              startAt: ex.startAt.toISOString(),
              endAt: ex.endAt.toISOString(),
              title: ex.title,
              userId: ex.userId,
            });
          }
          continue;
        }
        // 반복 row 전개 후 비교
        const exRec = ex.recurrence as unknown as Recurrence;
        const exInstances = expand(
          exRec,
          { startAt: ex.startAt, endAt: ex.endAt },
          minStart,
          maxEnd,
        );
        for (const exi of exInstances) {
          if (overlaps(cand, exi)) {
            conflicts.push({
              instanceKey: `${ex.id}:${exi.startAt.toISOString()}`,
              startAt: exi.startAt.toISOString(),
              endAt: exi.endAt.toISOString(),
              title: ex.title,
              userId: ex.userId,
            });
          }
        }
      }
    }
    return conflicts;
  }

  private recurrenceWindowEnd(rec: Recurrence, startAt: Date): Date {
    if (rec.until) return new Date(rec.until + "T23:59:59.999Z");
    if (rec.count) {
      const intervalDays =
        rec.freq === "DAILY" ? rec.interval ?? 1 : rec.freq === "WEEKLY" ? 7 * (rec.interval ?? 1) : 31 * (rec.interval ?? 1);
      return new Date(startAt.getTime() + intervalDays * (rec.count + 1) * 24 * 60 * 60 * 1000);
    }
    // 안전 한계 — 5년
    return new Date(startAt.getTime() + 5 * 365 * 24 * 60 * 60 * 1000);
  }

  private assertCanModify(ownerId: string, ctx: ReservationContext) {
    if (ctx.role === "ADMIN" || ctx.role === "MANAGER") return;
    if (ctx.userId === ownerId) return;
    throw new AppError(403, "RESERVATION_FORBIDDEN", "본인 예약만 변경할 수 있습니다.");
  }

  private resolveWindow(from?: string, to?: string): { fromDate: Date; toDate: Date } {
    const now = new Date();
    const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const fromDate = from ? new Date(from + "T00:00:00.000Z") : defaultFrom;
    const toDate = to ? new Date(to + "T23:59:59.999Z") : defaultTo;
    return { fromDate, toDate };
  }

  private intersectsWindow(start: Date, end: Date, from: Date, to: Date): boolean {
    return end >= from && start <= to;
  }

  private toInstancePayload(
    r: {
      id: string;
      resourceId: string;
      resource: { id: string; name: string };
      userId: string;
      title: string;
      description: string | null;
      startAt: Date;
      endAt: Date;
      isAllDay: boolean;
      recurrence: Prisma.JsonValue | null;
      recurrenceParentId: string | null;
      status: ReservationStatus;
    },
    parentId: string | null,
    isException: boolean,
    userNameMap: Map<string, string>,
  ): InstancePayload {
    const recurrence = (r.recurrence as unknown as Recurrence | null) ?? null;
    return {
      id: r.id,
      parentId,
      instanceKey: `${parentId ?? r.id}:${r.startAt.toISOString()}`,
      resourceId: r.resourceId,
      resourceName: r.resource.name,
      userId: r.userId,
      userName: userNameMap.get(r.userId) ?? null,
      title: r.title,
      description: r.description,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      isAllDay: r.isAllDay,
      isRecurring: !!recurrence,
      isException,
      recurrenceSummary: recurrenceLabel(recurrence),
      status: r.status,
    };
  }

  private async fetchUserNames(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const authUrl = process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001";
    const token = process.env.INTERNAL_API_TOKEN as string;
    const map = new Map<string, string>();
    try {
      const r = await fetch(`${authUrl}/internal/users/bulk?ids=${userIds.join(",")}`, {
        headers: { "x-internal-token": token },
      });
      if (r.ok) {
        const data = (await r.json()) as Record<string, { id: string; name: string; email: string }>;
        for (const [id, u] of Object.entries(data)) map.set(id, u.name);
      }
    } catch {
      // ignore — userName이 null로 표시됨
    }
    return map;
  }
}
