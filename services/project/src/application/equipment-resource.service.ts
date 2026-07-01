import { PrismaClient, EquipmentType, Prisma } from "@prisma/client";
import { AppError } from "@erp-ot/shared";

// 자원-모델-분리 PDCA Phase 3a-2 (2026-05-04)
// 비인력 자원(장비/차량/시설) CRUD

export interface CreateEquipmentResourceDto {
  name: string;
  type?: EquipmentType | undefined;
  isActive?: boolean | undefined;
}

export interface UpdateEquipmentResourceDto {
  name?: string | undefined;
  type?: EquipmentType | undefined;
  isActive?: boolean | undefined;
}

export interface ListEquipmentResourceFilter {
  type?: EquipmentType;
  isActive?: boolean;
  search?: string;
}

export class EquipmentResourceService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(filter: ListEquipmentResourceFilter = {}) {
    const where: Prisma.EquipmentResourceWhereInput = {};
    if (filter.type) where.type = filter.type;
    if (filter.isActive !== undefined) where.isActive = filter.isActive;
    if (filter.search) where.name = { contains: filter.search, mode: "insensitive" };
    return this.prisma.equipmentResource.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  /** 공용자산 수동 정렬 — 전달된 id 순서대로 sortOrder 재부여 (관리화면 ▲▼) */
  async reorder(orderedIds: string[]) {
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.equipmentResource.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
  }

  async get(id: string) {
    const item = await this.prisma.equipmentResource.findUnique({ where: { id } });
    if (!item) throw new AppError(404, "EQUIPMENT_NOT_FOUND", "비인력 자원을 찾을 수 없습니다.");
    return item;
  }

  async create(dto: CreateEquipmentResourceDto) {
    if (!dto.name || dto.name.trim().length === 0) {
      throw new AppError(400, "INVALID_INPUT", "이름은 필수입니다.");
    }
    return this.prisma.equipmentResource.create({
      data: {
        name: dto.name.trim(),
        type: dto.type ?? "VEHICLE",
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateEquipmentResourceDto) {
    await this.get(id); // 존재 검증
    const data: Prisma.EquipmentResourceUpdateInput = {};
    if (dto.name !== undefined) {
      if (dto.name.trim().length === 0) throw new AppError(400, "INVALID_INPUT", "이름은 비어있을 수 없습니다.");
      data.name = dto.name.trim();
    }
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.equipmentResource.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.get(id);
    // 배정 이력이 있으면 hard delete 차단 (대신 isActive=false 권장)
    const assignmentCount = await this.prisma.segmentAssignment.count({
      where: { equipmentResourceId: id },
    });
    const groupMemberCount = await this.prisma.resourceGroupMember.count({
      where: { equipmentResourceId: id },
    });
    if (assignmentCount > 0 || groupMemberCount > 0) {
      throw new AppError(
        409,
        "EQUIPMENT_IN_USE",
        `사용 중인 자원입니다. (배정 ${assignmentCount}건, 그룹 ${groupMemberCount}건). 비활성으로 변경하세요.`,
      );
    }
    await this.prisma.equipmentResource.delete({ where: { id } });
  }
}
