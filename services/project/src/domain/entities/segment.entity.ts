export class SegmentEntity {
  constructor(
    public readonly id: string,
    public readonly taskId: string,
    public name: string,
    public startDate: Date,
    public endDate: Date,
    public progressPercent: number,
    public sortOrder: number,
  ) {}

  /** 세그먼트 기간 (일수) */
  get durationDays(): number {
    return Math.ceil((this.endDate.getTime() - this.startDate.getTime()) / 86_400_000) + 1;
  }

  /** 날짜 범위 유효성 검사 */
  isValidDateRange(): boolean {
    return this.startDate <= this.endDate;
  }

  /** 다른 세그먼트와 날짜 중복 여부 */
  overlapsWith(other: SegmentEntity): boolean {
    return this.startDate <= other.endDate && this.endDate >= other.startDate;
  }
}
