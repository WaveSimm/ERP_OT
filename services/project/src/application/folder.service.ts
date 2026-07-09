import { PrismaClient } from "@prisma/client";

interface DeptDto { id: string; name: string; sortOrder?: number }
interface UserDeptDto { id: string; departmentId: string | null; departmentHidden?: boolean }

export class FolderService {
  constructor(private prisma: PrismaClient) {}

  private async authGet<T>(path: string): Promise<T | null> {
    try {
      const authUrl = process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001";
      const res = await fetch(`${authUrl}${path}`, {
        headers: { "X-Internal-Token": process.env.INTERNAL_API_TOKEN as string },
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  /** 부서 기본 폴더 동기화 — 활성·비숨김 부서당 폴더 1개 (생성/개명/삭제). 부서 변화 시에만 write. */
  private async syncDepartmentFolders(): Promise<void> {
    const depts = await this.authGet<DeptDto[]>("/internal/departments");
    if (!depts) return; // auth 미응답 시 기존 상태 유지 (파괴적 변경 방지)

    const existing = await this.prisma.projectFolder.findMany({ where: { departmentId: { not: null } } });
    const existingByDept = new Map(existing.map((f) => [f.departmentId as string, f]));
    const deptIds = new Set(depts.map((d) => d.id));

    for (const d of depts) {
      const f = existingByDept.get(d.id);
      if (!f) {
        // 동시 실행 대비 unique 충돌은 무시
        await this.prisma.projectFolder
          .create({ data: { name: d.name, departmentId: d.id, createdBy: "system", sortOrder: d.sortOrder ?? 0 } })
          .catch(() => null);
      } else if (f.name !== d.name) {
        await this.prisma.projectFolder.update({ where: { id: f.id }, data: { name: d.name } });
      }
    }
    // 더 이상 자격 없는(삭제·숨김) 부서 폴더 제거 — cascade로 수동추가 항목도 함께 삭제
    for (const f of existing) {
      if (!deptIds.has(f.departmentId as string)) {
        await this.prisma.projectFolder.delete({ where: { id: f.id } }).catch(() => null);
      }
    }
  }

  /** 소유자 userId → 부서 id (숨김 부서 제외) 매핑 */
  private async ownerDeptMap(): Promise<Map<string, string>> {
    const users = await this.authGet<UserDeptDto[]>("/internal/users/all-with-departments");
    const map = new Map<string, string>();
    for (const u of users ?? []) {
      if (u.departmentId && !u.departmentHidden) map.set(u.id, u.departmentId);
    }
    return map;
  }

  /** 전체 폴더 트리 + 소속 프로젝트 (부서 폴더는 자동 소속 계산 + 수동추가 병합) */
  async list(_userId: string) {
    await this.syncDepartmentFolders();

    const folders = await this.prisma.projectFolder.findMany({
      include: {
        projects: { orderBy: { sortOrder: "asc" }, select: { projectId: true, sortOrder: true } },
      },
      orderBy: { sortOrder: "asc" },
    });

    const hasDeptFolder = folders.some((f) => f.departmentId);
    if (!hasDeptFolder) {
      return folders.map((f) => ({ ...f, projects: f.projects.map((i) => ({ ...i, auto: false })) }));
    }

    // 자동 소속: 소유자 부서별 프로젝트 그룹핑
    const ownerDept = await this.ownerDeptMap();
    const projects = await this.prisma.project.findMany({ select: { id: true, ownerId: true } });
    const byDept = new Map<string, string[]>();
    for (const p of projects) {
      const d = p.ownerId ? ownerDept.get(p.ownerId) : undefined;
      if (!d) continue;
      const arr = byDept.get(d);
      if (arr) arr.push(p.id);
      else byDept.set(d, [p.id]);
    }

    return folders.map((f) => {
      if (!f.departmentId) {
        return { ...f, projects: f.projects.map((i) => ({ ...i, auto: false })) };
      }
      const manual = f.projects; // 팀장 수동추가 (저장분)
      const manualIds = new Set(manual.map((i) => i.projectId));
      const auto = (byDept.get(f.departmentId) ?? [])
        .filter((pid) => !manualIds.has(pid))
        .map((pid, idx) => ({ projectId: pid, sortOrder: -100000 + idx, auto: true }));
      return { ...f, projects: [...auto, ...manual.map((i) => ({ ...i, auto: false }))] };
    });
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
    const folder = await this.prisma.projectFolder.findUnique({ where: { id }, select: { departmentId: true, name: true } });
    // 부서 폴더는 이름·상위 변경 불가 (자동 동기화 대상). 순서(sortOrder)만 허용.
    if (folder?.departmentId) {
      if ((data.name !== undefined && data.name !== folder.name) || data.parentId !== undefined) {
        throw new Error("부서 기본 폴더는 이름·위치를 변경할 수 없습니다.");
      }
    }
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
    const folder = await this.prisma.projectFolder.findUnique({ where: { id }, select: { departmentId: true } });
    if (folder?.departmentId) throw new Error("부서 기본 폴더는 삭제할 수 없습니다.");
    // Cascade delete handles children + items
    return this.prisma.projectFolder.delete({ where: { id } });
  }

  /** 폴더에 프로젝트 추가 (부서 폴더엔 팀장이 타 부서 프로젝트를 수동추가) */
  async addProject(folderId: string, projectId: string, sortOrder?: number) {
    return this.prisma.projectFolderItem.upsert({
      where: { folderId_projectId: { folderId, projectId } },
      create: { folderId, projectId, sortOrder: sortOrder ?? 0 },
      update: { sortOrder: sortOrder ?? 0 },
    });
  }

  /** 폴더에서 프로젝트 제거 (자동 소속분은 저장돼 있지 않아 no-op) */
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
