import { ProjectStatus } from "@prisma/client";

// 死 repository 인터페이스(IProjectRepository 등 7종, implements 0) 제거 — application→Prisma 직접 방식 공식화.
//   살아있는 쿼리 필터 타입만 유지(project.service.ts 사용).
export interface ProjectListFilter {
  status?: ProjectStatus | undefined;
  groupId?: string | undefined;
  ownerId?: string | undefined;
  search?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}
