import { PrismaClient, ExternalStatus, Prisma } from "@prisma/client";
import { AppError } from "@erp-ot/shared";

// 자원-모델-분리 PDCA Phase 3a-3 (2026-05-04)
// 외부 자원(외주/협력업체) CRUD

export interface CreateExternalPersonDto {
  name: string;
  company?: string | null | undefined;
  contactEmail?: string | null | undefined;
  contactPhone?: string | null | undefined;
  contractStart?: Date | null | undefined;
  contractEnd?: Date | null | undefined;
  notes?: string | null | undefined;
}

export interface UpdateExternalPersonDto {
  name?: string | undefined;
  company?: string | null | undefined;
  contactEmail?: string | null | undefined;
  contactPhone?: string | null | undefined;
  status?: ExternalStatus | undefined;
  contractStart?: Date | null | undefined;
  contractEnd?: Date | null | undefined;
  notes?: string | null | undefined;
}

export interface ListExternalPersonFilter {
  status?: ExternalStatus | undefined;
  company?: string | undefined;
  search?: string | undefined;
}

export class ExternalPersonService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(filter: ListExternalPersonFilter = {}) {
    const where: Prisma.ExternalPersonWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.company) where.company = filter.company;
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: "insensitive" } },
        { company: { contains: filter.search, mode: "insensitive" } },
      ];
    }
    return this.prisma.externalPerson.findMany({
      where,
      orderBy: [{ status: "asc" }, { company: "asc" }, { name: "asc" }],
    });
  }

  async get(id: string) {
    const item = await this.prisma.externalPerson.findUnique({ where: { id } });
    if (!item) throw new AppError(404, "EXTERNAL_NOT_FOUND", "외부 자원을 찾을 수 없습니다.");
    return item;
  }

  async create(dto: CreateExternalPersonDto) {
    if (!dto.name || dto.name.trim().length === 0) {
      throw new AppError(400, "INVALID_INPUT", "이름은 필수입니다.");
    }
    return this.prisma.externalPerson.create({
      data: {
        name: dto.name.trim(),
        company: dto.company ?? null,
        contactEmail: dto.contactEmail ?? null,
        contactPhone: dto.contactPhone ?? null,
        contractStart: dto.contractStart ?? null,
        contractEnd: dto.contractEnd ?? null,
        notes: dto.notes ?? null,
        status: "ACTIVE",
      },
    });
  }

  async update(id: string, dto: UpdateExternalPersonDto) {
    await this.get(id);
    const data: Prisma.ExternalPersonUpdateInput = {};
    if (dto.name !== undefined) {
      if (dto.name.trim().length === 0) throw new AppError(400, "INVALID_INPUT", "이름은 비어있을 수 없습니다.");
      data.name = dto.name.trim();
    }
    if (dto.company !== undefined) data.company = dto.company;
    if (dto.contactEmail !== undefined) data.contactEmail = dto.contactEmail;
    if (dto.contactPhone !== undefined) data.contactPhone = dto.contactPhone;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.contractStart !== undefined) data.contractStart = dto.contractStart;
    if (dto.contractEnd !== undefined) data.contractEnd = dto.contractEnd;
    if (dto.notes !== undefined) data.notes = dto.notes;
    return this.prisma.externalPerson.update({ where: { id }, data });
  }

  async archive(id: string, contractEnd?: Date) {
    await this.get(id);
    return this.prisma.externalPerson.update({
      where: { id },
      data: {
        status: "ARCHIVED",
        contractEnd: contractEnd ?? new Date(),
      },
    });
  }

  async reactivate(id: string) {
    await this.get(id);
    return this.prisma.externalPerson.update({
      where: { id },
      data: { status: "ACTIVE" },
    });
  }

  async delete(id: string) {
    await this.get(id);
    const assignmentCount = await this.prisma.segmentAssignment.count({
      where: { externalPersonId: id },
    });
    const groupMemberCount = await this.prisma.resourceGroupMember.count({
      where: { externalPersonId: id },
    });
    if (assignmentCount > 0 || groupMemberCount > 0) {
      throw new AppError(
        409,
        "EXTERNAL_IN_USE",
        `사용 중인 외부 자원입니다. (배정 ${assignmentCount}건, 그룹 ${groupMemberCount}건). archive 처리하세요.`,
      );
    }
    await this.prisma.externalPerson.delete({ where: { id } });
  }
}
