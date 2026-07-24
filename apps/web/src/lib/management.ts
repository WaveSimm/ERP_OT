// 관리(관리부서) 메뉴 접근 게이트 — 재무팀·경영지원팀·임원·대표이사 + ADMIN 역할.
//   부서명은 auth 프로필(departmentName) 기준. 백엔드 게이트(attendance admin.routes.ts
//   MGMT_DEPTS)와 목록을 반드시 일치시킬 것.
import { getUser, myProfileApi } from "@/lib/api";

export const MGMT_DEPTS = ["재무팀", "경영지원팀", "임원", "대표이사"];

/** 관리 메뉴 접근 가능 여부 (ADMIN 또는 관리부서 소속). 프로필 조회 실패 시 false. */
export async function isManagementUser(): Promise<boolean> {
  const u = getUser();
  if (!u) return false;
  if (u.role === "ADMIN") return true;
  try {
    const data: any = await myProfileApi.getProfile(u.id);
    const deptName = data?.profile?.departmentName ?? data?.departmentName ?? "";
    return MGMT_DEPTS.includes(deptName);
  } catch {
    return false;
  }
}
