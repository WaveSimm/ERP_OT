import { PrismaClient, Resource, ResourceGroup, ResourceType, AllocationMode } from "@prisma/client";
import { AppError } from "@erp-ot/shared";
import { ProjectCacheService } from "../infrastructure/cache/project.cache.js";

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface CreateResourceGroupDto {
  name: string;
  description?: string;
  parentId?: string;
  sortOrder?: number;
}

export interface UpdateResourceGroupDto {
  name?: string;
  description?: string;
  parentId?: string | null;
  sortOrder?: number;
}

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

export interface ResourceUtilizationResponse {
  resourceId: string;
  resourceName: string;
  dailyCapacityHours: number;
  period: { startDate: string; endDate: string };
  totalAllocationPercent: number;
  availablePercent: number;
  isOverloaded: boolean;
  isUnderutilized: boolean;
  projects: AssignmentDetail[];
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
  allocationPercent: number | null;     // 저장된 원본값 (PERCENT 모드)
  allocationHoursPerDay: number | null; // 저장된 원본값 (HOURS 모드)
  effectivePercent: number;             // 항상 % 환산값 (바 표시용)
}

export interface DashboardResourceRow {
  resourceId: string;
  resourceName: string;
  type: ResourceType;
  dailyCapacityHours: number;
  totalAllocationPercent: number;
  availablePercent: number;
  isOverloaded: boolean;
  isUnderutilized: boolean;
  assignments: AssignmentDetail[];
}

export interface HeatmapCell {
  allocationPercent: number;
  isOverloaded: boolean;
}

export interface HeatmapResponse {
  rows: { resourceId: string; resourceName: string }[];
  columns: string[]; // 버킷 시작일 (ISO date)
  cells: HeatmapCell[][];
}

const MS_PER_DAY = 86_400_000;

export class ResourceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: ProjectCacheService,
  ) {}

  // ─── Resource Group CRUD ──────────────────────────────────────────────────

  async listResourceGroups() {
    const groups = await this.prisma.resourceGroup.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        memberships: { select: { resourceId: true } },
      },
    });
    return groups.map((g) => ({
      ...g,
      resourceIds: g.memberships.map((m) => m.resourceId),
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
    if (existing.children.length > 0) throw new AppError(400, "HAS_CHILDREN", "하위 그룹이 있어 삭제할 수 없습니다. 먼저 하위 그룹을 삭제하세요.");
    // memberships는 onDelete: Cascade로 자동 삭제됨
    await this.prisma.resourceGroup.delete({ where: { id } });
  }

  // ─── 그룹 멤버 설정 (전체 교체) ──────────────────────────────────────────

  async setGroupMembers(groupId: string, resourceIds: string[]): Promise<void> {
    const group = await this.prisma.resourceGroup.findUnique({ where: { id: groupId } });
    if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "그룹을 찾을 수 없습니다.");

    await this.prisma.$transaction([
      this.prisma.resourceGroupMember.deleteMany({ where: { groupId } }),
      this.prisma.resourceGroupMember.createMany({
        data: resourceIds.map((resourceId) => ({ groupId, resourceId })),
        skipDuplicates: true,
      }),
    ]);
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

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

  // ─── #26 유틸리제이션 (Redis 60s) ─────────────────────────────────────────

  async getUtilization(
    resourceId: string,
    startDate: string,
    endDate: string,
  ): Promise<ResourceUtilizationResponse> {
    const cached = await this.cache.getResourceUtilization<ResourceUtilizationResponse>(
      resourceId, startDate, endDate,
    );
    if (cached) return cached;

    const resource = await this.getResource(resourceId);
    const result = await this.computeUtilization(resource, startDate, endDate);

    await this.cache.setResourceUtilization(resourceId, startDate, endDate, result);
    return result;
  }

  private async computeUtilization(
    resource: Resource,
    startDate: string,
    endDate: string,
  ): Promise<ResourceUtilizationResponse> {
    const qStart = new Date(startDate);
    const qEnd = new Date(endDate);

    // 기간 내 겹치는 배정 조회
    const assignments = await this.prisma.segmentAssignment.findMany({
      where: {
        resourceId: resource.id,
        segment: {
          startDate: { lte: qEnd },
          endDate: { gte: qStart },
        },
      },
      include: {
        segment: {
          include: {
            task: { include: { project: true } },
          },
        },
      },
    });

    // 배정별 할당률 계산 (HOURS 모드 → % 변환)
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

    const totalAllocationPercent = Math.round(
      projectRows.reduce((sum, r) => sum + r.effectivePercent, 0) * 10,
    ) / 10;

    return {
      resourceId: resource.id,
      resourceName: resource.name,
      dailyCapacityHours: resource.dailyCapacityHours,
      period: { startDate, endDate },
      totalAllocationPercent,
      availablePercent: Math.max(0, Math.round((100 - totalAllocationPercent) * 10) / 10),
      isOverloaded: totalAllocationPercent > 100,
      isUnderutilized: totalAllocationPercent < 20,
      projects: projectRows,
    };
  }

  // ─── #27 운영 현황 대시보드 ──────────────────────────────────────────────

  async getDashboard(
    startDate: string,
    endDate: string,
  ): Promise<DashboardResourceRow[]> {
    const resources = await this.prisma.resource.findMany({
      where: { isActive: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });

    const rows: DashboardResourceRow[] = [];
    for (const r of resources) {
      const util = await this.computeUtilization(r, startDate, endDate);
      rows.push({
        resourceId: r.id,
        resourceName: r.name,
        type: r.type,
        dailyCapacityHours: r.dailyCapacityHours,
        totalAllocationPercent: util.totalAllocationPercent,
        availablePercent: util.availablePercent,
        isOverloaded: util.isOverloaded,
        isUnderutilized: util.isUnderutilized,
        assignments: util.projects,
      });
    }

    return rows;
  }

  // ─── #28 히트맵 데이터 ────────────────────────────────────────────────────

  async getHeatmap(
    startDate: string,
    endDate: string,
    granularity: "week" | "month",
  ): Promise<HeatmapResponse> {
    const cached = await this.cache.getResourceUtilization<HeatmapResponse>(
      `heatmap:${granularity}`, startDate, endDate,
    );
    if (cached) return cached;

    const resources = await this.prisma.resource.findMany({
      where: { isActive: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });

    const buckets = generateBuckets(new Date(startDate), new Date(endDate), granularity);

    const cells: HeatmapCell[][] = [];

    for (const r of resources) {
      const row: HeatmapCell[] = [];

      for (const bucket of buckets) {
        const bStart = bucket.start.toISOString().slice(0, 10);
        const bEnd = bucket.end.toISOString().slice(0, 10);
        const util = await this.computeUtilization(r, bStart, bEnd);
        row.push({
          allocationPercent: util.totalAllocationPercent,
          isOverloaded: util.isOverloaded,
        });
      }

      cells.push(row);
    }

    const result: HeatmapResponse = {
      rows: resources.map((r) => ({ resourceId: r.id, resourceName: r.name })),
      columns: buckets.map((b) => b.start.toISOString().slice(0, 10)),
      cells,
    };

    await this.cache.setResourceUtilization(`heatmap:${granularity}`, startDate, endDate, result);
    return result;
  }
}

// ─── 헬퍼: 시간 버킷 생성 ────────────────────────────────────────────────────

function generateBuckets(
  start: Date,
  end: Date,
  granularity: "week" | "month",
): { start: Date; end: Date }[] {
  const buckets: { start: Date; end: Date }[] = [];
  let cursor = new Date(start);

  while (cursor <= end) {
    const bucketStart = new Date(cursor);
    let bucketEnd: Date;

    if (granularity === "week") {
      bucketEnd = new Date(cursor);
      bucketEnd.setDate(bucketEnd.getDate() + 6);
    } else {
      bucketEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0); // 월말
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
