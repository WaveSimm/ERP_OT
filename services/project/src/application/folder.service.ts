import { PrismaClient } from "@prisma/client";

export class FolderService {
  constructor(private prisma: PrismaClient) {}

  /** 전체 폴더 트리 + 소속 프로젝트 */
  async list(userId: string) {
    const folders = await this.prisma.projectFolder.findMany({
      include: {
        projects: { orderBy: { sortOrder: "asc" }, select: { projectId: true, sortOrder: true } },
      },
      orderBy: { sortOrder: "asc" },
    });
    return folders;
  }

  async create(data: { name: string; parentId?: string; sortOrder?: number }, userId: string) {
    return this.prisma.projectFolder.create({
      data: {
        name: data.name,
        parentId: data.parentId || null,
        sortOrder: data.sortOrder ?? 0,
        createdBy: userId,
      },
    });
  }

  async update(id: string, data: { name?: string; parentId?: string; sortOrder?: number }) {
    return this.prisma.projectFolder.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId || null } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });
  }

  async remove(id: string) {
    // Cascade delete handles children + items
    return this.prisma.projectFolder.delete({ where: { id } });
  }

  /** 폴더에 프로젝트 추가 */
  async addProject(folderId: string, projectId: string, sortOrder?: number) {
    return this.prisma.projectFolderItem.upsert({
      where: { folderId_projectId: { folderId, projectId } },
      create: { folderId, projectId, sortOrder: sortOrder ?? 0 },
      update: { sortOrder: sortOrder ?? 0 },
    });
  }

  /** 폴더에서 프로젝트 제거 */
  async removeProject(folderId: string, projectId: string) {
    return this.prisma.projectFolderItem.delete({
      where: { folderId_projectId: { folderId, projectId } },
    }).catch(() => null); // 없으면 무시
  }

  /** 폴더 내 프로젝트 순서 일괄 업데이트 */
  async reorderProjects(folderId: string, projectIds: string[]) {
    await this.prisma.$transaction(
      projectIds.map((projectId, idx) =>
        this.prisma.projectFolderItem.upsert({
          where: { folderId_projectId: { folderId, projectId } },
          create: { folderId, projectId, sortOrder: idx },
          update: { sortOrder: idx },
        })
      )
    );
    return { ok: true };
  }

  /** 폴더 순서 일괄 업데이트 */
  async reorderFolders(folderIds: string[]) {
    await this.prisma.$transaction(
      folderIds.map((id, idx) =>
        this.prisma.projectFolder.update({ where: { id }, data: { sortOrder: idx } })
      )
    );
    return { ok: true };
  }
}
