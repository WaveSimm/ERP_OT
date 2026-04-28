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

export async function isAssignedToTask(
  prisma: PrismaClient,
  userEmail: string,
  taskId: string,
): Promise<boolean> {
  const resource = await prisma.resource.findFirst({
    where: { userId: userEmail },
    select: { id: true },
  });
  if (!resource) return false;
  const assignment = await prisma.segmentAssignment.findFirst({
    where: {
      resourceId: resource.id,
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
  return await isAssignedToTask(prisma, user.email, taskId);
}

export async function isProjectMember(
  prisma: PrismaClient,
  userEmail: string,
  projectId: string,
): Promise<boolean> {
  const resource = await prisma.resource.findFirst({
    where: { userId: userEmail },
    select: { id: true },
  });
  if (!resource) return false;
  const assignment = await prisma.segmentAssignment.findFirst({
    where: {
      resourceId: resource.id,
      segment: { task: { projectId } },
    },
    select: { id: true },
  });
  return assignment !== null;
}
