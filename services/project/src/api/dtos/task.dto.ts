import { TaskStatus, DependencyType, AllocationMode } from "@prisma/client";

export interface CreateTaskDto {
  name: string;
  description?: string;
  parentId?: string;
  sortOrder?: number;
  isMilestone?: boolean;
}

export interface UpdateTaskDto {
  name?: string;
  description?: string | null;
  status?: TaskStatus;
  parentId?: string | null;
  sortOrder?: number;
  overallProgress?: number;
  isManualProgress?: boolean;
  isMilestone?: boolean;
}

export interface CreateSegmentDto {
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  sortOrder?: number;
}

export interface UpdateSegmentDto {
  name?: string;
  startDate?: string;
  endDate?: string;
  progressPercent?: number;
  sortOrder?: number;
  changeReason: string;
}

export interface UpsertAssignmentDto {
  resourceId: string;
  allocationMode: AllocationMode;
  allocationPercent?: number;
  allocationHoursPerDay?: number;
}

/**
 * Task ↔ Task 의존성용 (legacy shorthand).
 * Polymorphic Task ↔ Milestone 의존성은 /dependencies 라우트에서 처리.
 */
export interface AddTaskDependencyDto {
  predecessorId: string;
  type?: DependencyType;
  lagDays?: number;
}
