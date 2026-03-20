import { TaskSegment } from "@prisma/client";

export interface ISegmentRepository {
  findById(id: string): Promise<TaskSegment | null>;
  findByTaskId(taskId: string): Promise<TaskSegment[]>;
  create(data: Omit<TaskSegment, "id" | "createdAt" | "updatedAt">): Promise<TaskSegment>;
  update(id: string, data: Partial<TaskSegment>): Promise<TaskSegment>;
  delete(id: string): Promise<void>;
  reorder(taskId: string, orderedIds: string[]): Promise<void>;
}
