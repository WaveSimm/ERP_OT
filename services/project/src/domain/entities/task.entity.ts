import { TaskStatus } from "@prisma/client";

export interface TaskSegmentData {
  id: string;
  name: string;
  sortOrder: number;
  startDate: Date;
  endDate: Date;
  progressPercent: number;
}

export class TaskEntity {
  constructor(
    public readonly id: string,
    public readonly projectId: string,
    public name: string,
    public status: TaskStatus,
    public overallProgress: number,
    public isCritical: boolean,
    public createdBy: string,
    public segments: TaskSegmentData[] = [],
    public milestoneId?: string | null,
    public totalFloat?: number | null,
    public isManualProgress: boolean = false,
  ) {}

  /** 세그먼트 날짜 기반 effectiveStartDate 계산 */
  get effectiveStartDate(): Date | null {
    if (this.segments.length === 0) return null;
    return this.segments.reduce(
      (min, s) => (s.startDate < min ? s.startDate : min),
      this.segments[0]!.startDate,
    );
  }

  /** 세그먼트 날짜 기반 effectiveEndDate 계산 */
  get effectiveEndDate(): Date | null {
    if (this.segments.length === 0) return null;
    return this.segments.reduce(
      (max, s) => (s.endDate > max ? s.endDate : max),
      this.segments[0]!.endDate,
    );
  }

  /** 자동 진행률: 세그먼트 가중 평균 (날짜 길이 기준) */
  calculateAutoProgress(): number {
    if (this.isManualProgress) return this.overallProgress;
    if (this.segments.length === 0) return 0;

    let totalDays = 0;
    let weightedProgress = 0;

    for (const seg of this.segments) {
      const days =
        Math.ceil((seg.endDate.getTime() - seg.startDate.getTime()) / 86_400_000) + 1;
      totalDays += days;
      weightedProgress += seg.progressPercent * days;
    }

    return totalDays === 0 ? 0 : Math.round(weightedProgress / totalDays);
  }

  /** 같은 Task 내 세그먼트 날짜 중복 검증 */
  hasSegmentOverlap(newStart: Date, newEnd: Date, excludeSegmentId?: string): boolean {
    for (const seg of this.segments) {
      if (excludeSegmentId && seg.id === excludeSegmentId) continue;
      if (newStart <= seg.endDate && newEnd >= seg.startDate) return true;
    }
    return false;
  }
}
