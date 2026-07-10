import { PrismaClient } from "@prisma/client";

export interface DashboardIssue {
  id: string;
  projectId: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  category: "SCHEDULE_DELAY" | "BUDGET_OVERRUN" | "PROGRESS_STALE" | "MILESTONE_DUE" | "MANUAL_ISSUE";
  title: string;
  description: string;
  taskId?: string;
  taskName?: string;
  detectedAt: string;
  metadata: Record<string, unknown>;
}

export interface ThresholdConfig {
  delayCriticalDays: number;
  delayWarningDays: number;
  resourceOverloadWarning: number;
}

function dateDiffDays(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export class IssueDetectorService {
  constructor(private readonly prisma: PrismaClient) {}

  async getThresholds(): Promise<ThresholdConfig> {
    let config = await this.prisma.issueThresholdConfig.findFirst();
    if (!config) {
      config = await this.prisma.issueThresholdConfig.create({
        data: { updatedBy: "system" },
      });
    }
    return {
      delayCriticalDays: config.delayCriticalDays,
      delayWarningDays: config.delayWarningDays,
      resourceOverloadWarning: Number(config.resourceOverloadWarning),
    };
  }

  async detectForProject(projectId: string): Promise<DashboardIssue[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const windowEnd = new Date(today);
    windowEnd.setDate(today.getDate() + 7);

    const [project, thresholds] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: projectId },
        include: {
          tasks: {
            include: {
              segments: {
                include: { assignments: true },
              },
            },
          },
        },
      }),
      this.getThresholds(),
    ]);

    if (!project) return [];

    const issues: DashboardIssue[] = [];
    const detectedAt = new Date().toISOString();

    // ─── CRITICAL: 크리티컬 패스 지연 ─────────────────────────────────────────
    const delayedCriticalTasks = project.tasks.filter((t) => {
      if (!t.isCritical || t.status === "DONE") return false;
      const latestEnd = t.segments.reduce((max: Date | null, s) => {
        const d = new Date(s.endDate);
        return !max || d > max ? d : max;
      }, null);
      if (!latestEnd) return false;
      return latestEnd < today && dateDiffDays(latestEnd, today) > thresholds.delayCriticalDays;
    });

    if (delayedCriticalTasks.length > 0) {
      const maxDelay = Math.max(...delayedCriticalTasks.map((t) => {
        const latestEnd = t.segments.reduce((max: Date | null, s) => {
          const d = new Date(s.endDate); return !max || d > max ? d : max;
        }, null) as Date;
        return dateDiffDays(latestEnd, today);
      }));
      issues.push({
        id: `CRITICAL_PATH_DELAYED:${projectId}`,
        projectId,
        severity: "CRITICAL",
        category: "SCHEDULE_DELAY",
        title: "크리티컬 패스 지연",
        description: `크리티컬 패스 태스크 ${delayedCriticalTasks.length}개가 지연되었습니다. 최대 ${maxDelay}일 지연.`,
        detectedAt,
        metadata: {
          delayedCount: delayedCriticalTasks.length,
          maxDelayDays: maxDelay,
          tasks: delayedCriticalTasks.slice(0, 3).map((t) => ({ id: t.id, name: t.name })),
        },
      });
    }

    // 예산 이슈(BUDGET_CRITICAL/WARNING)는 폐기 — 예산 개념 미사용 (2026-06-24)
    // 자원 과부하 이슈(RESOURCE_CRITICAL/WARNING)는 폐기 — 미사용 (2026-07-10)

    // ─── CRITICAL: 수동 이슈 (미해결) ───────────────────────────────────────────
    // 태스크 상세에서 사용자가 등록한 이슈. 체크(해결)되기 전까지 CRITICAL로 노출.
    const manualIssues = await this.prisma.taskIssue.findMany({
      where: { isResolved: false, task: { projectId } },
      orderBy: { createdAt: "desc" },
      include: { task: { select: { name: true } } },
    });
    for (const mi of manualIssues) {
      const summary = mi.content.length > 50 ? `${mi.content.slice(0, 50)}…` : mi.content;
      issues.push({
        id: `MANUAL_ISSUE:${mi.id}`,
        projectId,
        severity: "CRITICAL",
        category: "MANUAL_ISSUE",
        title: summary,
        description: mi.content,
        taskId: mi.taskId,
        taskName: mi.task.name,
        detectedAt,
        metadata: { issueId: mi.id, authorName: mi.authorName, createdAt: mi.createdAt.toISOString() },
      });
    }

    // ─── WARNING: 비크리티컬 태스크 지연 ───────────────────────────────────────
    const delayedNonCritical = project.tasks.filter((t) => {
      if (t.isCritical || t.status === "DONE") return false;
      const latestEnd = t.segments.reduce((max: Date | null, s) => {
        const d = new Date(s.endDate); return !max || d > max ? d : max;
      }, null);
      if (!latestEnd) return false;
      return latestEnd < today && dateDiffDays(latestEnd, today) >= thresholds.delayWarningDays;
    });
    if (delayedNonCritical.length > 0) {
      issues.push({
        id: `NON_CRITICAL_DELAYED:${projectId}`,
        projectId,
        severity: "WARNING",
        category: "SCHEDULE_DELAY",
        title: "태스크 일정 지연",
        description: `비크리티컬 태스크 ${delayedNonCritical.length}개가 지연되었습니다.`,
        detectedAt,
        metadata: {
          delayedCount: delayedNonCritical.length,
          tasks: delayedNonCritical.slice(0, 3).map((t) => ({ id: t.id, name: t.name })),
        },
      });
    }

    // ─── WARNING: 진행률 미업데이트 (7일 이상) ─────────────────────────────────
    const staleThreshold = new Date(today);
    staleThreshold.setDate(today.getDate() - 7);
    const staleTasks = project.tasks.filter((t) =>
      t.status === "IN_PROGRESS" && new Date(t.updatedAt) < staleThreshold,
    );
    if (staleTasks.length > 0) {
      issues.push({
        id: `PROGRESS_STALE:${projectId}`,
        projectId,
        severity: "WARNING",
        category: "PROGRESS_STALE",
        title: "7일 이상 업데이트 없음",
        description: `${staleTasks.length}개 진행 중 태스크의 진행률이 7일 이상 업데이트되지 않았습니다.`,
        detectedAt,
        metadata: {
          staleCount: staleTasks.length,
          tasks: staleTasks.slice(0, 3).map((t) => ({
            id: t.id, name: t.name,
            staleDays: dateDiffDays(new Date(t.updatedAt), today),
          })),
        },
      });
    }

    // ─── INFO: 시점 task 임박 (3일 이내) ────────────────────────────────────────
    // 마일스톤은 Task isMilestone=true로 회귀
    const milestoneTasks = project.tasks.filter((t) =>
      t.isMilestone && t.status !== "DONE"
    );
    for (const m of milestoneTasks) {
      const dueDate = m.segments[0]?.endDate;
      if (!dueDate) continue;
      const due = new Date(dueDate);
      const daysUntil = dateDiffDays(today, due);
      if (daysUntil >= 0 && daysUntil <= 3) {
        issues.push({
          id: `MILESTONE_DUE:${m.id}`,
          projectId,
          severity: "INFO",
          category: "MILESTONE_DUE",
          title: `시점 D-${daysUntil}`,
          description: `시점 "${m.name}"이 ${daysUntil}일 후 도래합니다.`,
          taskId: m.id,
          taskName: m.name,
          detectedAt,
          metadata: { milestoneDate: due.toISOString().slice(0, 10), daysUntil },
        });
      }
    }

    // ─── INFO: 이번 주 완료 예정 ────────────────────────────────────────────────
    const endingThisWeek = project.tasks.flatMap((t) =>
      t.segments.filter((s) => {
        const end = new Date(s.endDate);
        return end >= today && end <= windowEnd && s.progressPercent < 100;
      }).map((s) => ({ taskName: t.name, segmentName: s.name, endDate: s.endDate })),
    );
    if (endingThisWeek.length > 0) {
      issues.push({
        id: `ENDING_THIS_WEEK:${projectId}`,
        projectId,
        severity: "INFO",
        category: "SCHEDULE_DELAY",
        title: "이번 주 완료 예정",
        description: `이번 주 내 완료 예정 세그먼트 ${endingThisWeek.length}개가 있습니다.`,
        detectedAt,
        metadata: {
          count: endingThisWeek.length,
          segments: endingThisWeek.slice(0, 3),
        },
      });
    }

    const ORDER = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    return issues.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  }
}
