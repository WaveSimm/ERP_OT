import { Task, TaskSegment, SegmentAssignment, TaskDependency } from "@prisma/client";

export type TaskWithSegments = Task & {
  segments: (TaskSegment & { assignments: SegmentAssignment[] })[];
};

export type TaskWithDeps = Task & {
  segments: (TaskSegment & { assignments: SegmentAssignment[] })[];
  predecessorDeps: TaskDependency[];
  successorDeps: TaskDependency[];
};

export interface ITaskRepository {
  findById(id: string): Promise<TaskWithSegments | null>;
  findByProject(projectId: string): Promise<TaskWithDeps[]>;
  create(data: Omit<Task, "id" | "createdAt" | "updatedAt">): Promise<Task>;
  update(id: string, data: Partial<Task>): Promise<Task>;
  delete(id: string): Promise<void>;
  updateCpmResults(
    results: Array<{ taskId: string; isCritical: boolean; totalFloat: number }>,
  ): Promise<void>;
}
