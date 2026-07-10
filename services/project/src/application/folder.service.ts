import { PrismaClient } from "@prisma/client";

interface DeptDto {
  id: string;
  code: string;
  name: string;
  sortOrder?: number;
  soukwalUserId?: string | null; // 이사 (결재라인)
  daepyoUserId?: string | null; // 대표이사 (결재라인)
}
interface UserDeptDto { id: string; departmentId: string | null; departmentHidden?: boolean }

// 부서 기본 폴더 표시 순서 (이 순서대로 상단 고정). 목록에 없는 팀은 뒤에 부서 정렬순으로 붙음.
const DEPT_FOLDER_ORDER = [
  "BIZ1", "BIZ2", "BIZ3", // 사업1·2·3팀
  "UAVBIZ1", "UAVBIZ2",   // 무인1·2팀
  "TECH",                 // 기술팀
  "SALES1", "SALES2",     // 영업1·2팀
  "FIN",                  // 재무팀
  "BIZSUPP",              // 경영지원팀
];
// 폴더를 만들지 않는 부서 (임원·대표이사 그룹 — 소속 임원 프로젝트는 결재라인 팀으로 배치)
const EXCLUDED_DEPT_CODES = new Set(["CEO_GROUP", "EXEC_GROUP"]);
// 부서 폴더는 수동 폴더보다 항상 위. 음수 sortOrder로 상단 고정.
const DEPT_SORT_BASE = -100000;

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

  /** 부서 폴더 대상(제외 부서 뺀 활성·비숨김) + 지정 순서 sortOrder 계산 */
  private eligibleDeptSort(d: DeptDto): number {
    const idx = DEPT_FOLDER_ORDER.indexOf(d.code);
    // 지정 순서에 있으면 그 순서대로, 없으면 지정목록 뒤 + 부서 정렬순 (모두 음수 → 수동 폴더보다 위)
    return idx >= 0 ? DEPT_SORT_BASE + idx : DEPT_SORT_BASE + 1000 + (d.sortOrder ?? 0);
  }

  /** 부서 기본 폴더 동기화 — 대상 부서당 폴더 1개 (생성/개명/순서/삭제). 상단 고정. */
  private async syncDepartmentFolders(all: DeptDto[] | null): Promise<void> {
    if (!all) return; // auth 미응답 시 기존 상태 유지 (파괴적 변경 방지)
    const depts = all.filter((d) => !EXCLUDED_DEPT_CODES.has(d.code)); // 임원·대표이사 그룹 폴더 미생성

    const existing = await this.prisma.projectFolder.findMany({ where: { departmentId: { not: null } } });
    const existingByDept = new Map(existing.map((f) => [f.departmentId as string, f]));
    const deptIds = new Set(depts.map((d) => d.id));

    for (const d of depts) {
      const f = existingByDept.get(d.id);
      const sort = this.eligibleDeptSort(d);
      if (!f) {
        // 동시 실행 대비 unique 충돌은 무시
        await this.prisma.projectFolder
          .create({ data: { name: d.name, departmentId: d.id, createdBy: "system", sortOrder: sort, parentId: null } })
          .catch(() => null);
      } else if (f.name !== d.name || f.sortOrder !== sort || f.parentId !== null) {
        // 이름·순서 동기화 + 부서 폴더는 항상 최상위(root) 유지
        await this.prisma.projectFolder.update({ where: { id: f.id }, data: { name: d.name, sortOrder: sort, parentId: null } });
      }
    }
    // 대상에서 빠진(제외·삭제·숨김) 부서 폴더 제거 — cascade로 수동추가 항목도 함께 삭제
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
    const deptList = await this.authGet<DeptDto[]>("/internal/departments");
    await this.syncDepartmentFolders(deptList);

    const folders = await this.prisma.projectFolder.findMany({
      include: {
        projects: { orderBy: { sortOrder: "asc" }, select: { projectId: true, sortOrder: true } },
      },
      orderBy: { sortOrder: "asc" },
    });

    const hasDeptFolder = folders.some((f) => f.departmentId);
    if (!hasDeptFolder || !deptList) {
      return folders.map((f) => ({ ...f, projects: f.projects.map((i) => ({ ...i, auto: false })) }));
    }

    // 폴더가 있는 대상 부서 + 임원 결재라인(이사 soukwal) 역매핑
    const eligible = deptList.filter((d) => !EXCLUDED_DEPT_CODES.has(d.code));
    const eligibleIds = new Set(eligible.map((d) => d.id));
    const soukwalOf = new Map<string, string[]>(); // 이사 userId → [deptId] (결재라인)
    const pushMap = (m: Map<string, string[]>, k: string, v: string) => {
      const a = m.get(k);
      if (a) a.push(v);
      else m.set(k, [v]);
    };
    // 이사(soukwal)만 결재라인 라우팅. 대표이사(daepyo)는 여러 팀 걸침 → 예외(폴더 미배치, 전체목록만).
    for (const d of eligible) {
      if (d.soukwalUserId) pushMap(soukwalOf, d.soukwalUserId, d.id);
    }

    // 자동 소속: 소유자 부서별 프로젝트 그룹핑
    const ownerDept = await this.ownerDeptMap();
    const projects = await this.prisma.project.findMany({ select: { id: true, ownerId: true } });
    const byDept = new Map<string, string[]>();
    for (const p of projects) {
      const owner = p.ownerId;
      if (!owner) continue;
      const od = ownerDept.get(owner);
      let targets: string[];
      if (od && eligibleIds.has(od)) {
        targets = [od]; // 소유자가 팀원 → 그 팀 폴더
      } else {
        // 임원진 등 폴더 없는 부서 소유 → 이사(soukwal)로 있는 팀 폴더로. 대표이사만이면 미배치(전체목록만).
        targets = soukwalOf.get(owner) ?? [];
      }
      for (const t of targets) pushMap(byDept, t, p.id);
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

  // ─── 내 즐겨찾기 (사용자별 프라이빗) ────────────────────────────────────────

  /** 내 즐겨찾기 프로젝트 id 목록 (최신 추가순) */
  async listFavorites(userId: string): Promise<string[]> {
    const rows = await this.prisma.projectFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { projectId: true },
    });
    return rows.map((r) => r.projectId);
  }

  /** 즐겨찾기 추가 (이미 있으면 무시) */
  async addFavorite(userId: string, projectId: string): Promise<{ ok: true }> {
    await this.prisma.projectFavorite.upsert({
      where: { userId_projectId: { userId, projectId } },
      create: { userId, projectId },
      update: {},
    });
    return { ok: true };
  }

  /** 즐겨찾기 해제 */
  async removeFavorite(userId: string, projectId: string): Promise<{ ok: true }> {
    await this.prisma.projectFavorite.deleteMany({ where: { userId, projectId } });
    return { ok: true };
  }
}
