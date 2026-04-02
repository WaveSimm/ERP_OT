import { PrismaClient } from "@prisma/client";

export interface DashboardIssue {
  id: string;
  projectId: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  category: "SCHEDULE_DELAY" | "BUDGET_OVERRUN" | "RESOURCE_OVERLOAD" | "PROGRESS_STALE" | "MILESTONE_DUE";
  title: string;
  description: string;
  taskId?: string;
  taskName?: string;
  detectedAt: string;
  metadata: Record<string, unknown>;
}

interface ThresholdConfig {
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
    const delayedCriticalTasks = (project as any).tasks.filter((t: any) => {
      if (!t.isCritical || t.status === "DONE") return false;
      const latestEnd = t.segments.reduce((max: Date | null, s: any) => {
        const d = new Date(s.endDate);
        return !max || d > max ? d : max;
      }, null);
      if (!latestEnd) return false;
      return latestEnd < today && dateDiffDays(latestEnd, today) > thresholds.delayCriticalDays;
    });

    if (delayedCriticalTasks.length > 0) {
      const maxDelay = Math.max(...delayedCriticalTasks.map((t: any) => {
        const latestEnd = t.segments.reduce((max: Date | null, s: any) => {
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
          tasks: delayedCriticalTasks.slice(0, 3).map((t: any) => ({ id: t.id, name: t.name })),
        },
      });
    }

    // ─── CRITICAL: 예산 초과 (110%) ────────────────────────────────────────────
    if (project.plannedBudget && project.actualBudget) {
      const pct = (Number(project.actualBudget) / Number(project.plannedBudget)) * 100;
      if (pct >= 110) {
        issues.push({
          id: `BUDGET_CRITICAL:${projectId}`,
          projectId,
          severity: "CRITICAL",
          category: "BUDGET_OVERRUN",
          title: `예산 ${Math.round(pct)}% 초과`,
          description: `계획 예산 대비 실제 비용이 ${Math.round(pct)}%에 달합니다.`,
          detectedAt,
          metadata: {
            plannedBudget: Number(project.plannedBudget),
            actualBudget: Number(project.actualBudget),
            overrunPercent: Math.round(pct),
          },
        });
      } else if (pct >= 100) {
        // ─── WARNING: 예산 경고 (100~110%) ─────────────────────────────────────
        issues.push({
          id: `BUDGET_WARNING:${projectId}`,
          projectId,
          severity: "WARNING",
          category: "BUDGET_OVERRUN",
          title: `예산 ${Math.round(pct)}% 사용`,
          description: `계획 예산의 ${Math.round(pct)}%를 사용했습니다.`,
          detectedAt,
          metadata: {
            plannedBudget: Number(project.plannedBudget),
            actualBudget: Number(project.actualBudget),
            usagePercent: Math.round(pct),
          },
        });
      }
    }

    // ─── CRITICAL: 자원 과부하 ──────────────────────────────────────────────────
    const overloaded = this.detectResourceOverload((project as any).tasks, today, windowEnd, thresholds.resourceOverloadWarning * 1.2);
    if (overloaded.length > 0) {
      issues.push({
        id: `RESOURCE_CRITICAL:${projectId}`,
        projectId,
        severity: "CRITICAL",
        category: "RESOURCE_OVERLOAD",
        title: "자원 과부하 배정",
        description: `${overloaded.length}명의 자원이 120% 이상 배정되었습니다.`,
        detectedAt,
        metadata: { overloaded: overloaded.slice(0, 3) },
      });
    }

    // ─── WARNING: 비크리티컬 태스크 지연 ───────────────────────────────────────
    const delayedNonCritical = (project as any).tasks.filter((t: any) => {
      if (t.isCritical || t.status === "DONE") return false;
      const latestEnd = t.segments.reduce((max: Date | null, s: any) => {
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
          tasks: delayedNonCritical.slice(0, 3).map((t: any) => ({ id: t.id, name: t.name })),
        },
      });
    }

    // ─── WARNING: 자원 경고 (resourceOverloadWarning%) ─────────────────────────
    const overloadedWarn = this.detectResourceOverload((project as any).tasks, today, windowEnd, thresholds.resourceOverloadWarning);
    const criticalIds = new Set(overloaded.map((r) => r.resourceId));
    const warnOnly = overloadedWarn.filter((r) => !criticalIds.has(r.resourceId));
    if (warnOnly.length > 0) {
      issues.push({
        id: `RESOURCE_WARNING:${projectId}`,
        projectId,
        severity: "WARNING",
        category: "RESOURCE_OVERLOAD",
        title: `자원 ${Math.round(thresholds.resourceOverloadWarning)}% 초과 배정`,
        description: `${warnOnly.length}명의 자원이 ${Math.round(thresholds.resourceOverloadWarning)}% 이상 배정되었습니다.`,
        detectedAt,
        metadata: { overloaded: warnOnly.slice(0, 3) },
      });
    }

    // ─── WARNING: 진행률 미업데이트 (7일 이상) ─────────────────────────────────
    const staleThreshold = new Date(today);
    staleThreshold.setDate(today.getDate() - 7);
    const staleTasks = (project as any).tasks.filter((t: any) =>
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
          tasks: staleTasks.slice(0, 3).map((t: any) => ({
            id: t.id, name: t.name,
            staleDays: dateDiffDays(new Date(t.updatedAt), today),
          })),
        },
      });
    }

    // ─── INFO: 마일스톤 임박 (3일 이내) ────────────────────────────────────────
    const milestoneTasks = (project as any).tasks.filter((t: any) => t.isMilestone && t.status !== "DONE");
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
          title: `마일스톤 D-${daysUntil}`,
          description: `마일스톤 "${m.name}"이 ${daysUntil}일 후 완료 예정입니다.`,
          taskId: m.id,
          taskName: m.name,
          detectedAt,
          metadata: { milestoneDate: due.toISOString().slice(0, 10), daysUntil },
        });
      }
    }

    // ─── INFO: 이번 주 완료 예정 ────────────────────────────────────────────────
    const endingThisWeek = (project as any).tasks.flatMap((t: any) =>
      t.segments.filter((s: any) => {
        const end = new Date(s.endDate);
        return end >= today && end <= windowEnd && s.progressPercent < 100;
      }).map((s: any) => ({ taskName: t.name, segmentName: s.name, endDate: s.endDate })),
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

  private detectResourceOverload(
    tasks: any[],
    windowStart: Date,
    windowEnd: Date,
    threshold: number,
  ): { resourceId: string; allocationPercent: number }[] {
    const resourceAllocMap = new Map<string, number>();

    for (const task of tasks) {
      for (const seg of task.segments) {
        const start = new Date(seg.startDate);
        const end = new Date(seg.endDate);
        if (start > windowEnd || end < windowStart) continue;
        for (const a of seg.assignments) {
          const pct = a.allocationPercent ?? 0;
          resourceAllocMap.set(a.resourceId, (resourceAllocMap.get(a.resourceId) ?? 0) + pct);
        }
      }
    }

    return Array.from(resourceAllocMap.entries())
      .filter(([, total]) => total >= threshold)
      .map(([id, allocationPercent]) => ({ resourceId: id, allocationPercent }));
  }
}
