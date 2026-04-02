import { PrismaClient } from "@prisma/client";

export interface TimelineEvent {
  date: string;
  type: "SEGMENT_START" | "SEGMENT_END" | "SEGMENT_ACTIVE" | "MILESTONE";
  taskId: string;
  taskName: string;
  segmentId: string;
  segmentName: string;
  progressPercent: number;
  isDelayed: boolean;
  delayDays?: number;
  isCriticalPath: boolean;
}

function dateDiffDays(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export class TimelineService {
  constructor(private readonly prisma: PrismaClient) {}

  async getWeeklyEvents(projectId: string, centerDate: Date): Promise<TimelineEvent[]> {
    const center = new Date(centerDate);
    center.setHours(0, 0, 0, 0);

    const windowStart = new Date(center);
    windowStart.setDate(center.getDate() - 7);
    const windowEnd = new Date(center);
    windowEnd.setDate(center.getDate() + 7);

    const segments = await this.prisma.taskSegment.findMany({
      where: {
        task: { projectId },
        startDate: { lte: windowEnd },
        endDate: { gte: windowStart },
      },
      include: {
        task: { select: { id: true, name: true, isCritical: true, isMilestone: true } },
      },
      orderBy: { startDate: "asc" },
    });

    const events: TimelineEvent[] = [];

    for (const seg of segments) {
      const start = new Date(seg.startDate);
      const end = new Date(seg.endDate);
      const isDelayed = end < center && seg.progressPercent < 100;
      const delayDays = isDelayed ? dateDiffDays(end, center) : undefined;

      const base = {
        taskId: seg.task.id,
        taskName: seg.task.name,
        segmentId: seg.id,
        segmentName: seg.name,
        progressPercent: seg.progressPercent,
        isDelayed,
        isCriticalPath: seg.task.isCritical,
      };

      // 마일스톤
      if (seg.task.isMilestone) {
        events.push({
          ...base,
          date: end.toISOString().slice(0, 10),
          type: "MILESTONE",
          ...(delayDays !== undefined ? { delayDays } : {}),
        });
        continue;
      }

      // 창 내 시작
      if (start >= windowStart && start <= windowEnd) {
        events.push({
          ...base,
          date: start.toISOString().slice(0, 10),
          type: "SEGMENT_START",
          ...(delayDays !== undefined ? { delayDays } : {}),
        });
      }

      // 창 내 종료
      if (end >= windowStart && end <= windowEnd) {
        events.push({
          ...base,
          date: end.toISOString().slice(0, 10),
          type: "SEGMENT_END",
          ...(delayDays !== undefined ? { delayDays } : {}),
        });
      }

      // 창을 완전히 가로지르는 세그먼트
      if (start < windowStart && end > windowEnd) {
        events.push({
          ...base,
          date: center.toISOString().slice(0, 10),
          type: "SEGMENT_ACTIVE",
          ...(delayDays !== undefined ? { delayDays } : {}),
        });
      }
    }

    return events.sort((a, b) => a.date.localeCompare(b.date));
  }
}
