import { PrismaClient } from "@prisma/client";

export interface WorkLogContext {
  authorId: string;
  isDeleted: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export function canEditWorkLog(log: WorkLogContext, user: AuthUser): boolean {
  if (log.isDeleted && user.role !== "ADMIN") return false;
  return user.role === "ADMIN" || log.authorId === user.id;
}

export const canDeleteWorkLog = canEditWorkLog;

// 자원-모델-분리 Phase 4 (2026-05-13): legacy resource lookup 제거 → auth_user id 직접 사용
export async function isAssignedToTask(
  prisma: PrismaClient,
  userId: string,
  taskId: string,
): Promise<boolean> {
  const assignment = await prisma.segmentAssignment.findFirst({
    where: {
      resourceId: userId,
      segment: { taskId },
    },
    select: { id: true },
  });
  return assignment !== null;
}

export async function canCreateWorkLog(
  prisma: PrismaClient,
  taskId: string,
  user: AuthUser,
): Promise<boolean> {
  if (user.role === "ADMIN" || user.role === "MANAGER") return true;
  if (user.role === "VIEWER") return false;
  return await isAssignedToTask(prisma, user.id, taskId);
}

export async function isProjectMember(
  prisma: PrismaClient,
  userId: string,
  projectId: string,
): Promise<boolean> {
  const assignment = await prisma.segmentAssignment.findFirst({
    where: {
      resourceId: userId,
      segment: { task: { projectId } },
    },
    select: { id: true },
  });
  return assignment !== null;
}
