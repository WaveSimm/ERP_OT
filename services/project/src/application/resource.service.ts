import { PrismaClient, Resource, ResourceGroup, ResourceType, AllocationMode } from "@prisma/client";
import { AppError } from "@erp-ot/shared";
import { ProjectCacheService } from "../infrastructure/cache/project.cache.js";

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface CreateResourceGroupDto {
  name: string;
  description?: string;
  parentId?: string;
  sortOrder?: number;
  type?: "PERSON" | "EXTERNAL" | "EQUIPMENT";
}

export interface UpdateResourceGroupDto {
  name?: string;
  description?: string;
  parentId?: string | null;
  sortOrder?: number;
}

// ⚠️ deprecated — Phase 4에서 Resource 폐기와 함께 제거.
//   직원: auth-service /api/v1/users / 외부: external-person.service / 비인력: equipment-resource.service 사용
export interface CreateResourceDto {
  name: string;
  type?: ResourceType;
  userId?: string;
  dailyCapacityHours?: number;
}

export interface UpdateResourceDto {
  name?: string;
  type?: ResourceType;
  userId?: string | null;
  dailyCapacityHours?: number;
  isActive?: boolean;
}

// ─── 응답 타입 ────────────────────────────────────────────────────────────────

export interface DayBreakdownEntry {
  date: string;
  percent: number;
  isWeekend: boolean;
  isHoliday?: boolean;
  holidayName?: string;
  leaveType?: string;
  leaveLabel?: string;
  hasHolidayWork?: boolean;
  holidayWorkLabel?: string;
}

export interface ResourceUtilizationResponse {
  resourceId: string;
  resourceName: string;
  resourceCategory: "PERSON" | "EXTERNAL" | "EQUIPMENT";
  dailyCapacityHours: number;
  period: { startDate: string; endDate: string };
  totalAllocationPercent: number;
  availablePercent: number;
  isOverloaded: boolean;
  isUnderutilized: boolean;
  projects: AssignmentDetail[];
  dayBreakdown?: DayBreakdownEntry[];
}

export interface AssignmentDetail {
  projectId: string;
  projectName: string;
  taskId: string;
  taskName: string;
  taskSortOrder: number;
  segmentId: string;
  segmentName: string;
  startDate: string;
  endDate: string;
  allocationMode: string;
  allocationPercent: number | null;
  allocationHoursPerDay: number | null;
  effectivePercent: number;
}

export interface DashboardResourceRow {
  resourceId: string;
  resourceName: string;
  type: ResourceType | "EXTERNAL";   // 자원-모델-분리 PDCA: EXTERNAL 추가
  resourceCategory: "PERSON" | "EXTERNAL" | "EQUIPMENT";
  company?: string | null;            // 외부 자원만
  dailyCapacityHours: number;
  totalAllocationPercent: number;
  availablePercent: number;
  isOverloaded: boolean;
  isUnderutilized: boolean;
  assignments: AssignmentDetail[];
  dayBreakdown?: DayBreakdownEntry[];
}

export interface HeatmapCell {
  allocationPercent: number;
  isOverloaded: boolean;
}

export interface HeatmapResponse {
  rows: { resourceId: string; resourceName: string }[];
  columns: string[];
  cells: HeatmapCell[][];
}

const DEFAULT_CAPACITY_HOURS = 8;
const LEAVE_LABELS: Record<string, string> = {
  ANNUAL: "연차",
  HALF: "반차",
  QUARTER: "1/4연차",
  FAMILY_DAY: "가정의날(1H)",
  FAMILY_DAY_2H: "가정의날(2H)",
  BEREAVEMENT: "경조사",
  SICK: "병가",
  SPECIAL: "공가",
};

// 직원/외부/비인력 자원에 대한 통합 부하 계산용 input
type ResourceLike =
  | { kind: "PERSON"; id: string; name: string; dailyCapacityHours: number }
  | { kind: "EXTERNAL"; id: string; name: string; dailyCapacityHours: number; company: string | null }
  | { kind: "EQUIPMENT"; id: string; name: string; dailyCapacityHours: number; type: string };

export class ResourceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: ProjectCacheService,
  ) {}

  // ─── ⚠️ deprecated: userId 마이그레이션 (1회성, Phase 2에서 SQL로 완료) ────
  // Phase 4에서 routes와 함께 제거 예정. 호출 시 410 에러.
  async migratePreview(): Promise<never> {
    throw new AppError(410, "DEPRECATED", "마이그레이션은 자원-모델-분리 PDCA Phase 2에서 SQL로 완료되었습니다.");
  }

  async migrateApply(): Promise<never> {
    throw new AppError(410, "DEPRECATED", "마이그레이션은 자원-모델-분리 PDCA Phase 2에서 SQL로 완료되었습니다.");
  }

  // ─── Resource Group CRUD ──────────────────────────────────────────────────

  async listResourceGroups() {
    const groups = await this.prisma.resourceGroup.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        memberships: {
          select: {
            resourceId: true,
            personUserId: true,
            externalPersonId: true,
            equipmentResourceId: true,
          },
        },
      },
    });
    return groups.map((g) => ({
      ...g,
      // 호환: legacy resourceIds + 신규 polymorphic ids
      resourceIds: g.memberships.map((m) => m.resourceId),
      personUserIds: g.memberships.map((m) => m.personUserId).filter((x): x is string => !!x),
      externalPersonIds: g.memberships.map((m) => m.externalPersonId).filter((x): x is string => !!x),
      equipmentResourceIds: g.memberships.map((m) => m.equipmentResourceId).filter((x): x is string => !!x),
    }));
  }

  async createResourceGroup(dto: CreateResourceGroupDto): Promise<ResourceGroup> {
    if (dto.parentId) {
      const parent = await this.prisma.resourceGroup.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new AppError(404, "GROUP_NOT_FOUND", "상위 그룹을 찾을 수 없습니다.");
      if (parent.parentId) throw new AppError(400, "MAX_DEPTH", "그룹은 최대 2단계까지만 지원합니다.");
    }
    return this.prisma.resourceGroup.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        parentId: dto.parentId ?? null,
        sortOrder: dto.sortOrder ?? 0,
        type: dto.type ?? "PERSON",
      },
    });
  }

  async updateResourceGroup(id: string, dto: UpdateResourceGroupDto): Promise<ResourceGroup> {
    const existing = await this.prisma.resourceGroup.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "GROUP_NOT_FOUND", "그룹을 찾을 수 없습니다.");
    if (dto.parentId) {
      if (dto.parentId === id) throw new AppError(400, "SELF_PARENT", "자기 자신을 부모로 설정할 수 없습니다.");
      const parent = await this.prisma.resourceGroup.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new AppError(404, "GROUP_NOT_FOUND", "상위 그룹을 찾을 수 없습니다.");
      if (parent.parentId) throw new AppError(400, "MAX_DEPTH", "그룹은 최대 2단계까지만 지원합니다.");
    }
    return this.prisma.resourceGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...("parentId" in dto && { parentId: dto.parentId ?? null }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async deleteResourceGroup(id: string): Promise<void> {
    const existing = await this.prisma.resourceGroup.findUnique({ where: { id }, include: { children: true } });
    if (!existing) throw new AppError(404, "GROUP_NOT_FOUND", "그룹을 찾을 수 없습니다.");
    if (existing.children.length > 0) throw new AppError(400, "HAS_CHILDREN", "하위 그룹이 있어 삭제할 수 없습니다.");
    await this.prisma.resourceGroup.delete({ where: { id } });
  }

  // ─── 그룹 멤버 설정 (legacy resourceIds 호환 + 신규 polymorphic) ───────────
  async setGroupMembers(groupId: string, resourceIds: string[]): Promise<void> {
    const group = await this.prisma.resourceGroup.findUnique({ where: { id: groupId } });
    if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "그룹을 찾을 수 없습니다.");

    // 각 resourceId를 polymorphic 컬럼으로 해석 (xor_check 위반 방지)
    // 자원-모델-분리 PDCA Phase 2 이후 personUserId / externalPersonId / equipmentResourceId
    // 중 정확히 하나가 채워져야 함.
    const rows: Array<{
      groupId: string;
      resourceId: string;
      personUserId?: string;
      externalPersonId?: string;
      equipmentResourceId?: string;
    }> = [];

    for (const resourceId of resourceIds) {
      const resolved = await this.resolveResourceLike(resourceId);
      if (!resolved) {
        // 해석 불가 → 건너뜀 (log)
        console.warn(`[setGroupMembers] cannot resolve resourceId=${resourceId} — skip`);
        continue;
      }
      const row: {
        groupId: string;
        resourceId: string;
        personUserId?: string;
        externalPersonId?: string;
        equipmentResourceId?: string;
      } = { groupId, resourceId };
      if (resolved.kind === "PERSON") row.personUserId = resolved.id;
      else if (resolved.kind === "EXTERNAL") row.externalPersonId = resolved.id;
      else if (resolved.kind === "EQUIPMENT") row.equipmentResourceId = resolved.id;
      rows.push(row);
    }

    await this.prisma.$transaction([
      this.prisma.resourceGroupMember.deleteMany({ where: { groupId } }),
      ...(rows.length > 0
        ? [this.prisma.resourceGroupMember.createMany({ data: rows, skipDuplicates: true })]
        : []),
    ]);
  }

  // ─── ⚠️ deprecated CRUD (Phase 4에서 제거) ─────────────────────────────────
  // 신규 화면은 /api/v1/equipment-resources, /api/v1/external-persons, /api/v1/users 사용

  async listResources(filter?: { type?: ResourceType; isActive?: boolean }) {
    const where: Record<string, unknown> = {};
    if (filter?.type) where.type = filter.type;
    if (filter?.isActive !== undefined) where.isActive = filter.isActive;
    return this.prisma.resource.findMany({
      where,
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
  }

  async getResource(id: string): Promise<Resource> {
    const r = await this.prisma.resource.findUnique({ where: { id } });
    if (!r) throw new AppError(404, "RESOURCE_NOT_FOUND", "자원을 찾을 수 없습니다.");
    return r;
  }

  async createResource(dto: CreateResourceDto): Promise<Resource> {
    return this.prisma.resource.create({
      data: {
        name: dto.name,
        type: dto.type ?? "PERSON",
        userId: dto.userId ?? null,
        dailyCapacityHours: dto.dailyCapacityHours ?? 8.0,
      },
    });
  }

  async updateResource(id: string, dto: UpdateResourceDto): Promise<Resource> {
    await this.getResource(id);
    return this.prisma.resource.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.userId !== undefined && { userId: dto.userId }),
        ...(dto.dailyCapacityHours !== undefined && { dailyCapacityHours: dto.dailyCapacityHours }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  // ─── #26 Utilization (자원-모델-분리: polymorphic) ─────────────────────────

  async getUtilization(resourceId: string, startDate: string, endDate: string): Promise<ResourceUtilizationResponse> {
    const cached = await this.cache.getResourceUtilization<ResourceUtilizationResponse>(resourceId, startDate, endDate);
    if (cached) return cached;

    // resourceId가 어떤 종류인지 자동 판별 (auth_users.id / external_persons.id / equipment_resources.id)
    const resource = await this.resolveResourceLike(resourceId);
    if (!resource) throw new AppError(404, "RESOURCE_NOT_FOUND", "자원을 찾을 수 없습니다.");

    const result = await this.computeUtilization(resource, startDate, endDate, { withDayBreakdown: true });
    await this.cache.setResourceUtilization(resourceId, startDate, endDate, result);
    return result;
  }

  // resourceId가 어느 카테고리인지 식별 — 신규 모델 우선, fallback으로 legacy Resource
  private async resolveResourceLike(id: string): Promise<ResourceLike | null> {
    // 1. EquipmentResource 우선 시도
    const eq = await this.prisma.equipmentResource.findUnique({ where: { id } });
    if (eq) return { kind: "EQUIPMENT", id: eq.id, name: eq.name, dailyCapacityHours: DEFAULT_CAPACITY_HOURS, type: eq.type };

    // 2. ExternalPerson
    const ext = await this.prisma.externalPerson.findUnique({ where: { id } });
    if (ext) return { kind: "EXTERNAL", id: ext.id, name: ext.name, dailyCapacityHours: DEFAULT_CAPACITY_HOURS, company: ext.company };

    // 3. AuthUser (cross-service via internal API)
    const authResolved = await this.resolveAuthUser(id);
    if (authResolved) return { kind: "PERSON", id, name: authResolved.name, dailyCapacityHours: DEFAULT_CAPACITY_HOURS };

    // 4. Legacy Resource (Phase 4까지 호환)
    const legacy = await this.prisma.resource.findUnique({ where: { id } });
    if (legacy) {
      if (legacy.type === "PERSON") {
        // userId(email)로 auth_user 찾아서 personUserId로 변환
        const authId = legacy.userId ? await this.lookupAuthIdByEmail(legacy.userId) : null;
        if (authId) {
          return { kind: "PERSON", id: authId, name: legacy.name, dailyCapacityHours: legacy.dailyCapacityHours };
        }
      } else {
        return { kind: "EQUIPMENT", id: legacy.id, name: legacy.name, dailyCapacityHours: legacy.dailyCapacityHours, type: legacy.type };
      }
    }
    return null;
  }

  private async resolveAuthUser(authUserId: string): Promise<{ id: string; name: string; email: string } | null> {
    const authUrl = process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001";
    const token = process.env.INTERNAL_API_TOKEN as string;
    try {
      const r = await fetch(`${authUrl}/internal/users/bulk?ids=${authUserId}`, { headers: { "x-internal-token": token } });
      if (!r.ok) return null;
      const map = (await r.json()) as Record<string, { name: string; email: string }>;
      const user = map[authUserId];
      return user ? { id: authUserId, name: user.name, email: user.email } : null;
    } catch {
      return null;
    }
  }

  private async lookupAuthIdByEmail(email: string): Promise<string | null> {
    const authUrl = process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001";
    const token = process.env.INTERNAL_API_TOKEN as string;
    try {
      const r = await fetch(`${authUrl}/internal/users/all?includeRetired=true`, { headers: { "x-internal-token": token } });
      if (!r.ok) return null;
      const users = (await r.json()) as { id: string; email: string }[];
      return users.find((u) => u.email === email)?.id ?? null;
    } catch {
      return null;
    }
  }

  // 통합 부하 계산 — polymorphic
  private async computeUtilization(
    resource: ResourceLike,
    startDate: string,
    endDate: string,
    opts: { withDayBreakdown?: boolean } = {},
  ): Promise<ResourceUtilizationResponse> {
    const qStart = new Date(startDate);
    const qEnd = new Date(endDate);

    // polymorphic where
    const assignmentWhere =
      resource.kind === "PERSON"
        ? { personUserId: resource.id }
        : resource.kind === "EXTERNAL"
        ? { externalPersonId: resource.id }
        : { equipmentResourceId: resource.id };

    const assignments = await this.prisma.segmentAssignment.findMany({
      where: {
        ...assignmentWhere,
        segment: {
          startDate: { lte: qEnd },
          endDate: { gte: qStart },
        },
      },
      include: {
        segment: { include: { task: { include: { project: true } } } },
      },
    });

    const projectRows: AssignmentDetail[] = assignments.map((a) => {
      const effectivePct =
        a.allocationMode === AllocationMode.PERCENT
          ? (a.allocationPercent ?? 0)
          : ((a.allocationHoursPerDay ?? 0) / resource.dailyCapacityHours) * 100;
      return {
        projectId: a.segment.task.project.id,
        projectName: a.segment.task.project.name,
        taskId: a.segment.task.id,
        taskName: a.segment.task.name,
        taskSortOrder: a.segment.task.sortOrder ?? 0,
        segmentId: a.segmentId,
        segmentName: a.segment.name,
        startDate: a.segment.startDate.toISOString().slice(0, 10),
        endDate: a.segment.endDate.toISOString().slice(0, 10),
        allocationMode: a.allocationMode as string,
        allocationPercent: a.allocationPercent,
        allocationHoursPerDay: a.allocationHoursPerDay,
        effectivePercent: Math.round(effectivePct * 10) / 10,
      };
    });

    // 일별 부하
    const dayMap = new Map<string, number>();
    for (const row of projectRows) {
      const s = new Date(row.startDate);
      const e = new Date(row.endDate);
      const overlapStart = s > qStart ? s : qStart;
      const overlapEnd = e < qEnd ? e : qEnd;
      const d = new Date(overlapStart);
      while (d <= overlapEnd) {
        const key = d.toISOString().slice(0, 10);
        dayMap.set(key, (dayMap.get(key) ?? 0) + row.effectivePercent);
        d.setDate(d.getDate() + 1);
      }
    }
    let peakPercent = 0;
    for (const pct of dayMap.values()) if (pct > peakPercent) peakPercent = pct;
    const totalAllocationPercent = Math.round(peakPercent * 10) / 10;

    // dayBreakdown (옵션)
    let dayBreakdown: DayBreakdownEntry[] | undefined;
    if (opts.withDayBreakdown) {
      // 직원만 휴가/근태 머지. 외부·비인력은 휴일만.
      const holidayMap = await this.fetchHolidays(startDate, endDate);
      const userEntries = resource.kind === "PERSON" ? await this.fetchUserEntries(resource.id, startDate, endDate) : new Map();

      dayBreakdown = [];
      const cur = new Date(qStart);
      while (cur <= qEnd) {
        const key = cur.toISOString().slice(0, 10);
        const dow = cur.getUTCDay();
        const entry: DayBreakdownEntry = {
          date: key,
          percent: Math.round((dayMap.get(key) ?? 0) * 10) / 10,
          isWeekend: dow === 0 || dow === 6,
        };
        const holiday = holidayMap.get(key);
        if (holiday) {
          entry.isHoliday = true;
          entry.holidayName = holiday;
        }
        const ue = userEntries.get(key);
        if (ue) {
          if (ue.entryType === "OT") {
            entry.hasHolidayWork = true;
            entry.holidayWorkLabel = ue.label ?? "휴일근무";
          } else if (ue.entryType in LEAVE_LABELS) {
            entry.leaveType = ue.entryType;
            entry.leaveLabel = LEAVE_LABELS[ue.entryType] ?? ue.entryType;
          }
        }
        dayBreakdown.push(entry);
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    return {
      resourceId: resource.id,
      resourceName: resource.name,
      resourceCategory: resource.kind,
      dailyCapacityHours: resource.dailyCapacityHours,
      period: { startDate, endDate },
      totalAllocationPercent,
      availablePercent: Math.max(0, Math.round((100 - totalAllocationPercent) * 10) / 10),
      isOverloaded: totalAllocationPercent > 100,
      isUnderutilized: totalAllocationPercent < 20,
      projects: projectRows,
      ...(dayBreakdown ? { dayBreakdown } : {}),
    };
  }

  private async fetchHolidays(start: string, end: string): Promise<Map<string, string>> {
    const authUrl = process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001";
    const token = process.env.INTERNAL_API_TOKEN as string;
    const map = new Map<string, string>();
    try {
      const r = await fetch(`${authUrl}/internal/calendar/holidays?from=${start}&to=${end}`, {
        headers: { "x-internal-token": token },
      });
      if (r.ok) {
        const arr = (await r.json()) as Array<{ date: string; title: string; type: string }>;
        for (const h of arr) map.set(h.date, h.title);
      }
    } catch { /* ignore */ }
    return map;
  }

  private async fetchUserEntries(authUserId: string, start: string, end: string) {
    const attUrl = process.env.ATTENDANCE_SERVICE_URL ?? "http://attendance-service:3004";
    const token = process.env.INTERNAL_API_TOKEN as string;
    const map = new Map<string, { entryType: string; sourceType: string; label: string | null }>();
    try {
      const r = await fetch(
        `${attUrl}/internal/work-schedule/by-users?userIds=${authUserId}&start=${start}&end=${end}`,
        { headers: { "x-internal-token": token } },
      );
      if (r.ok) {
        const arr = (await r.json()) as Array<{ userId: string; date: string; entryType: string; sourceType: string; label: string | null }>;
        for (const e of arr) {
          if (e.sourceType === "LEAVE_APPROVED" || e.sourceType === "OT_APPROVED") {
            map.set(e.date, e);
          } else if (!map.has(e.date)) {
            map.set(e.date, e);
          }
        }
      }
    } catch { /* ignore */ }
    return map;
  }

  // ─── #27 운영 현황 대시보드 — 직원 + 외부 + 비인력 통합 ─────────────────────

  async getDashboard(startDate: string, endDate: string): Promise<DashboardResourceRow[]> {
    // 1. 직원 (auth-service /internal/users/all-with-departments — status=ACTIVE only)
    const personUsers = await this.fetchActiveAuthUsers();

    // 2. 외부 자원 (status=ACTIVE)
    const externalPersons = await this.prisma.externalPerson.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ company: "asc" }, { name: "asc" }],
    });

    // 공용자산 정리 (2026-05-05): EquipmentResource는 프로젝트 미연계 — 직원현황 대시보드에서 제외.
    // (자원 배정·부하 모니터링 대상 아님. /admin/equipment-resources에서만 단순 마스터 관리)

    const rows: DashboardResourceRow[] = [];

    // 직원
    for (const u of personUsers) {
      const resource: ResourceLike = { kind: "PERSON", id: u.id, name: u.name, dailyCapacityHours: DEFAULT_CAPACITY_HOURS };
      const util = await this.computeUtilization(resource, startDate, endDate, { withDayBreakdown: true });
      rows.push({
        resourceId: u.id,
        resourceName: u.name,
        type: "PERSON",
        resourceCategory: "PERSON",
        dailyCapacityHours: DEFAULT_CAPACITY_HOURS,
        totalAllocationPercent: util.totalAllocationPercent,
        availablePercent: util.availablePercent,
        isOverloaded: util.isOverloaded,
        isUnderutilized: util.isUnderutilized,
        assignments: util.projects,
        ...(util.dayBreakdown ? { dayBreakdown: util.dayBreakdown } : {}),
      });
    }

    // 외부
    for (const ep of externalPersons) {
      const resource: ResourceLike = { kind: "EXTERNAL", id: ep.id, name: ep.name, dailyCapacityHours: DEFAULT_CAPACITY_HOURS, company: ep.company };
      const util = await this.computeUtilization(resource, startDate, endDate, { withDayBreakdown: true });
      rows.push({
        resourceId: ep.id,
        resourceName: ep.name,
        type: "EXTERNAL",
        resourceCategory: "EXTERNAL",
        company: ep.company,
        dailyCapacityHours: DEFAULT_CAPACITY_HOURS,
        totalAllocationPercent: util.totalAllocationPercent,
        availablePercent: util.availablePercent,
        isOverloaded: util.isOverloaded,
        isUnderutilized: util.isUnderutilized,
        assignments: util.projects,
        ...(util.dayBreakdown ? { dayBreakdown: util.dayBreakdown } : {}),
      });
    }

    // 공용자산(EquipmentResource) 루프 제거 (2026-05-05) — 프로젝트 미연계

    return rows;
  }

  private async fetchActiveAuthUsers(): Promise<{ id: string; name: string; email: string }[]> {
    const authUrl = process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001";
    const token = process.env.INTERNAL_API_TOKEN as string;
    try {
      const r = await fetch(`${authUrl}/internal/users/all`, {
        headers: { "x-internal-token": token },
      });
      if (!r.ok) return [];
      return (await r.json()) as { id: string; name: string; email: string }[];
    } catch {
      return [];
    }
  }

  // ─── #28 히트맵 데이터 ────────────────────────────────────────────────────

  async getHeatmap(startDate: string, endDate: string, granularity: "week" | "month"): Promise<HeatmapResponse> {
    const cached = await this.cache.getResourceUtilization<HeatmapResponse>(`heatmap:${granularity}`, startDate, endDate);
    if (cached) return cached;

    const personUsers = await this.fetchActiveAuthUsers();
    const externalPersons = await this.prisma.externalPerson.findMany({ where: { status: "ACTIVE" } });
    const equipmentResources = await this.prisma.equipmentResource.findMany({ where: { isActive: true } });

    const all: { resourceId: string; resourceName: string; resource: ResourceLike }[] = [
      ...personUsers.map((u) => ({
        resourceId: u.id,
        resourceName: u.name,
        resource: { kind: "PERSON" as const, id: u.id, name: u.name, dailyCapacityHours: DEFAULT_CAPACITY_HOURS },
      })),
      ...externalPersons.map((ep) => ({
        resourceId: ep.id,
        resourceName: ep.name,
        resource: { kind: "EXTERNAL" as const, id: ep.id, name: ep.name, dailyCapacityHours: DEFAULT_CAPACITY_HOURS, company: ep.company },
      })),
      ...equipmentResources.map((eq) => ({
        resourceId: eq.id,
        resourceName: eq.name,
        resource: { kind: "EQUIPMENT" as const, id: eq.id, name: eq.name, dailyCapacityHours: DEFAULT_CAPACITY_HOURS, type: eq.type },
      })),
    ];

    const buckets = generateBuckets(new Date(startDate), new Date(endDate), granularity);
    const cells: HeatmapCell[][] = [];

    for (const item of all) {
      const row: HeatmapCell[] = [];
      for (const bucket of buckets) {
        const bStart = bucket.start.toISOString().slice(0, 10);
        const bEnd = bucket.end.toISOString().slice(0, 10);
        const util = await this.computeUtilization(item.resource, bStart, bEnd);
        row.push({ allocationPercent: util.totalAllocationPercent, isOverloaded: util.isOverloaded });
      }
      cells.push(row);
    }

    const result: HeatmapResponse = {
      rows: all.map((a) => ({ resourceId: a.resourceId, resourceName: a.resourceName })),
      columns: buckets.map((b) => b.start.toISOString().slice(0, 10)),
      cells,
    };

    await this.cache.setResourceUtilization(`heatmap:${granularity}`, startDate, endDate, result);
    return result;
  }
}

// ─── 헬퍼: 시간 버킷 생성 ────────────────────────────────────────────────────

function generateBuckets(start: Date, end: Date, granularity: "week" | "month"): { start: Date; end: Date }[] {
  const buckets: { start: Date; end: Date }[] = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const bucketStart = new Date(cursor);
    let bucketEnd: Date;
    if (granularity === "week") {
      bucketEnd = new Date(cursor);
      bucketEnd.setDate(bucketEnd.getDate() + 6);
    } else {
      bucketEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    }
    if (bucketEnd > end) bucketEnd = new Date(end);
    buckets.push({ start: bucketStart, end: bucketEnd });
    if (granularity === "week") {
      cursor.setDate(cursor.getDate() + 7);
    } else {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  }
  return buckets;
}
