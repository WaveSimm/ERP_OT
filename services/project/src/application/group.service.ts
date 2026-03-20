import { PrismaClient, GroupType, ProjectStatus } from "@prisma/client";
import { AppError } from "@erp-ot/shared";
import { ProjectCacheService } from "../infrastructure/cache/project.cache.js";
import { ProjectGateway } from "../infrastructure/websocket/project.gateway.js";

export interface CreateGroupDto {
  name: string;
  type?: GroupType;
  parentGroupId?: string;
  color?: string;
  sortOrder?: number;
  description?: string;
}

export interface UpdateGroupDto {
  name?: string;
  color?: string;
  sortOrder?: number;
  description?: string | null;
}

export interface AddMembershipDto {
  projectId: string;
  displayOrder?: number;
}

export interface GroupRollup {
  groupId: string;
  groupName: string;
  projectCount: number;
  inProgressCount: number;
  completedCount: number;
  onHoldCount: number;
  totalPlannedBudget: number;
  totalActualBudget: number;
  computedAt: string;
}

const MAX_LEVEL = 2;

export class GroupService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: ProjectCacheService,
    private readonly gateway: ProjectGateway,
  ) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async listGroups(type?: GroupType) {
    const where = type ? { type } : {};
    return this.prisma.projectGroup.findMany({
      where,
      include: {
        childGroups: { orderBy: { sortOrder: "asc" } },
      },
      orderBy: { sortOrder: "asc" },
    });
  }

  async getGroup(groupId: string) {
    const group = await this.prisma.projectGroup.findUnique({
      where: { id: groupId },
      include: {
        parentGroup: true,
        childGroups: { orderBy: { sortOrder: "asc" } },
        memberships: {
          include: { project: true },
          orderBy: { displayOrder: "asc" },
        },
      },
    });
    if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "그룹을 찾을 수 없습니다.");
    return group;
  }

  async createGroup(dto: CreateGroupDto, userId: string) {
    let level = 1;
    if (dto.parentGroupId) {
      const parent = await this.prisma.projectGroup.findUnique({
        where: { id: dto.parentGroupId },
      });
      if (!parent) {
        throw new AppError(404, "PARENT_GROUP_NOT_FOUND", "상위 그룹을 찾을 수 없습니다.");
      }
      level = parent.level + 1;
      if (level > MAX_LEVEL) {
        throw new AppError(
          400,
          "GROUP_DEPTH_EXCEEDED",
          `그룹 계층은 최대 ${MAX_LEVEL}단계까지 허용됩니다.`,
        );
      }
    }

    return this.prisma.projectGroup.create({
      data: {
        name: dto.name,
        type: dto.type ?? "CUSTOM",
        level,
        parentGroupId: dto.parentGroupId ?? null,
        color: dto.color ?? "#6B7280",
        sortOrder: dto.sortOrder ?? 0,
        description: dto.description ?? null,
        createdBy: userId,
      },
    });
  }

  async updateGroup(groupId: string, dto: UpdateGroupDto) {
    await this.getGroup(groupId);

    const updated = await this.prisma.projectGroup.update({
      where: { id: groupId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });

    await this.cache.invalidateGroupRollup(groupId);
    return updated;
  }

  async deleteGroup(groupId: string) {
    const group = await this.prisma.projectGroup.findUnique({
      where: { id: groupId },
      include: { childGroups: { take: 1 } },
    });
    if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "그룹을 찾을 수 없습니다.");
    if (group.childGroups.length > 0) {
      throw new AppError(
        400,
        "GROUP_HAS_CHILDREN",
        "하위 그룹이 있는 그룹은 삭제할 수 없습니다.",
      );
    }

    await this.prisma.projectGroup.delete({ where: { id: groupId } });
    await this.cache.invalidateGroupRollup(groupId);
  }

  // ─── Membership ───────────────────────────────────────────────────────────

  async addMembership(groupId: string, dto: AddMembershipDto, userId: string) {
    await this.getGroup(groupId);

    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");

    const existing = await this.prisma.projectGroupMembership.findUnique({
      where: { groupId_projectId: { groupId, projectId: dto.projectId } },
    });
    if (existing) {
      throw new AppError(409, "ALREADY_MEMBER", "이미 그룹에 속한 프로젝트입니다.");
    }

    const membership = await this.prisma.projectGroupMembership.create({
      data: {
        groupId,
        projectId: dto.projectId,
        displayOrder: dto.displayOrder ?? 0,
        addedBy: userId,
      },
      include: { project: true },
    });

    await this.cache.invalidateGroupRollup(groupId);
    return membership;
  }

  async updateMembershipOrder(groupId: string, projectId: string, displayOrder: number) {
    const membership = await this.prisma.projectGroupMembership.findUnique({
      where: { groupId_projectId: { groupId, projectId } },
    });
    if (!membership) {
      throw new AppError(404, "MEMBERSHIP_NOT_FOUND", "멤버십을 찾을 수 없습니다.");
    }

    return this.prisma.projectGroupMembership.update({
      where: { groupId_projectId: { groupId, projectId } },
      data: { displayOrder },
    });
  }

  async removeMembership(groupId: string, projectId: string) {
    const membership = await this.prisma.projectGroupMembership.findUnique({
      where: { groupId_projectId: { groupId, projectId } },
    });
    if (!membership) {
      throw new AppError(404, "MEMBERSHIP_NOT_FOUND", "멤버십을 찾을 수 없습니다.");
    }

    await this.prisma.projectGroupMembership.delete({
      where: { groupId_projectId: { groupId, projectId } },
    });
    await this.cache.invalidateGroupRollup(groupId);
  }

  // ─── Rollup 집계 ─────────────────────────────────────────────────────────

  async getGroupRollup(groupId: string): Promise<GroupRollup> {
    const cached = await this.cache.getGroupRollup<GroupRollup>(groupId);
    if (cached) return cached;

    const group = await this.prisma.projectGroup.findUnique({
      where: { id: groupId },
      include: {
        memberships: { include: { project: true } },
      },
    });
    if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "그룹을 찾을 수 없습니다.");

    const projects = group.memberships.map((m) => m.project);

    const rollup: GroupRollup = {
      groupId,
      groupName: group.name,
      projectCount: projects.length,
      inProgressCount: projects.filter((p) => p.status === ProjectStatus.IN_PROGRESS).length,
      completedCount: projects.filter((p) => p.status === ProjectStatus.COMPLETED).length,
      onHoldCount: projects.filter((p) => p.status === ProjectStatus.ON_HOLD).length,
      totalPlannedBudget: projects.reduce(
        (sum, p) => sum + (p.plannedBudget?.toNumber() ?? 0),
        0,
      ),
      totalActualBudget: projects.reduce(
        (sum, p) => sum + (p.actualBudget?.toNumber() ?? 0),
        0,
      ),
      computedAt: new Date().toISOString(),
    };

    await this.cache.setGroupRollup(groupId, rollup);
    return rollup;
  }
}
