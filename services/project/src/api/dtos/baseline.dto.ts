export interface CreateBaselineDto {
  name: string;
  reason: string;
}

export interface BaselineResponse {
  id: string;
  projectId: string;
  name: string;
  reason: string;
  createdBy: string;
  createdAt: Date;
}

export interface BaselineDiffResponse {
  baselineId: string;
  baselineName: string;
  tasks: BaselineTaskDiff[];
  summary: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
  };
}

export interface BaselineTaskDiff {
  taskId: string;
  taskName: string;
  status: "added" | "removed" | "changed" | "unchanged";
  changes?: {
    field: string;
    baseline: unknown;
    current: unknown;
  }[];
}
