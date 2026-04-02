import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { IssueDetectorService, DashboardIssue } from "./issue-detector.service.js";
import { TimelineService, TimelineEvent } from "./timeline.service.js";

const TTL = 300; // 5분

export interface ProjectRowSummary {
  id: string;
  name: string;
  status: string;
  ragStatus: "GREEN" | "AMBER" | "RED";
  overallProgress: number;
  plannedBudget: number | undefined;
  actualBudget: number | undefined;
  budgetUsagePercent: number | undefined;
  isCriticalPathDelayed: boolean;
  issueCount: { critical: number; warning: number; info: number };
  weeklyTimeline: TimelineEvent[];
  isPinned: boolean;
  lastUpdatedAt: string;
}

export interface GroupRollupSummary {
  totalProjects: number;
  weightedProgress: number;
  issueCount: { critical: number; warning: number; info: number };
  statusCount: { onTrack: number; warning: number; critical: number };
  plannedBudget: number | undefined;
  actualBudget: number | undefined;
  budgetUsagePercent: number | undefined;
  earliestStartDate: string | undefined;
  latestEndDate: string | undefined;
  cachedAt: string;
}

export interface GlobalSummary {
  totalProjects: number;
  statusCount: { onTrack: number; warning: number; critical: number; completed: number; onHold: number };
  issueCount: { critical: number; warning: number; info: number };
  thisWeekEvents: { starting: number; ending: number; milestones: number };
}

function determineRAG(issues: DashboardIssue[]): "GREEN" | "AMBER" | "RED" {
  if (issues.some((i) => i.severity === "CRITICAL")) return "RED";
  if (issues.some((i) => i.severity === "WARNING")) return "AMBER";
  return "GREEN";
}

function countIssues(issues: DashboardIssue[]) {
  return {
    critical: issues.filter((i) => i.severity === "CRITICAL").length,
    warning: issues.filter((i) => i.severity === "WARNING").length,
    info: issues.filter((i) => i.severity === "INFO").length,
  };
}

export class DashboardService {
  private readonly issueDetector: IssueDetectorService;
  private readonly timelineService: TimelineService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {
    this.issueDetector = new IssueDetectorService(prisma);
    this.timelineService = new TimelineService(prisma);
  }

  private async cacheGetOrSet<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as T;
    const value = await fn();
    await this.redis.setex(key, ttl, JSON.stringify(value));
    return value;
  }

  async computeProjectSummary(projectId: string, date: Date): Promise<ProjectRowSummary> {
    const [project, issues, timeline] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: projectId },
        include: {
          tasks: { select: { overallProgress: true, status: true } },
        },
      }),
      this.issueDetector.detectForProject(projectId),
      this.timelineService.getWeeklyEvents(projectId, date),
    ]);

    if (!project) throw new Error(`Project ${projectId} not found`);

    const activeTasks = project.tasks.filter((t) => t.status !== "DONE");
    const overallProgress = activeTasks.length > 0
      ? Math.round(activeTasks.reduce((s, t) => s + t.overallProgress, 0) / activeTasks.length)
      : 0;

    const planned = project.plannedBudget ? Number(project.plannedBudget) : undefined;
    const actual = project.actualBudget ? Number(project.actualBudget) : undefined;
    const budgetUsagePercent = planned && actual ? Math.round((actual / planned) * 100) : undefined;

    return {
      id: project.id,
      name: project.name,
      status: project.status,
      ragStatus: determineRAG(issues),
      overallProgress,
      plannedBudget: planned,
      actualBudget: actual,
      budgetUsagePercent,
      isCriticalPathDelayed: issues.some((i) => i.id.startsWith("CRITICAL_PATH_DELAYED")),
      issueCount: countIssues(issues),
      weeklyTimeline: timeline,
      isPinned: false,
      lastUpdatedAt: project.updatedAt.toISOString(),
    };
  }

  async getProjectSummary(projectId: string, date: Date): Promise<ProjectRowSummary> {
    return this.cacheGetOrSet(
      `dashboard:project:${projectId}:summary`,
      TTL,
      () => this.computeProjectSummary(projectId, date),
    );
  }

  async getProjectIssues(projectId: string): Promise<DashboardIssue[]> {
    return this.cacheGetOrSet(
      `dashboard:project:${projectId}:issues`,
      TTL,
      () => this.issueDetector.detectForProject(projectId),
    );
  }

  async getGlobalSummary(date: Date): Promise<GlobalSummary> {
    return this.cacheGetOrSet("dashboard:global:summary", TTL, async () => {
      const today = new Date(date);
      today.setHours(0, 0, 0, 0);
      const weekEnd = new Date(today);
      weekEnd.setDate(today.getDate() + 7);

      const projects = await this.prisma.project.findMany({
        where: { status: { notIn: ["CANCELLED"] } },
        select: { id: true, status: true },
      });

      const issuesList = await Promise.all(
        projects.map((p) => this.getProjectIssues(p.id)),
      );

      let critical = 0, warning = 0, info = 0;
      let onTrack = 0, warningProj = 0, criticalProj = 0, completed = 0, onHold = 0;

      projects.forEach((p, i) => {
        const issues = issuesList[i]!;
        const rag = determineRAG(issues);
        if (p.status === "COMPLETED") completed++;
        else if (p.status === "ON_HOLD") onHold++;
        else if (rag === "RED") criticalProj++;
        else if (rag === "AMBER") warningProj++;
        else onTrack++;

        issues.forEach((iss) => {
          if (iss.severity === "CRITICAL") critical++;
          else if (iss.severity === "WARNING") warning++;
          else info++;
        });
      });

      const endingSegs = await this.prisma.taskSegment.count({
        where: {
          endDate: { gte: today, lte: weekEnd },
          progressPercent: { lt: 100 },
        },
      });
      const startingSegs = await this.prisma.taskSegment.count({
        where: { startDate: { gte: today, lte: weekEnd } },
      });
      const milestoneCount = await this.prisma.task.count({
        where: {
          isMilestone: true,
          status: { not: "DONE" },
          segments: { some: { endDate: { gte: today, lte: weekEnd } } },
        },
      });

      return {
        totalProjects: projects.length,
        statusCount: { onTrack, warning: warningProj, critical: criticalProj, completed, onHold },
        issueCount: { critical, warning, info },
        thisWeekEvents: { starting: startingSegs, ending: endingSegs, milestones: milestoneCount },
      };
    });
  }

  async getDashboard(userId: string, options: {
    groupBy?: string;
    date?: string;
    issueFilter?: string;
  }) {
    const date = options.date ? new Date(options.date) : new Date();
    date.setHours(0, 0, 0, 0);
    const groupBy = options.groupBy ?? "NONE";
    const issueFilter = options.issueFilter ?? "ALL";

    const [globalSummary, projects, userConfig] = await Promise.all([
      this.getGlobalSummary(date),
      this.prisma.project.findMany({
        where: { status: { notIn: ["CANCELLED"] } },
        select: { id: true },
        orderBy: { updatedAt: "desc" },
      }),
      this.prisma.dashboardConfig.findUnique({ where: { userId } }).catch(() => null),
    ]);

    const BATCH = 20;
    const summaries: ProjectRowSummary[] = [];
    for (let i = 0; i < projects.length; i += BATCH) {
      const batch = projects.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((p) => this.getProjectSummary(p.id, date)));
      summaries.push(...results);
    }

    const pinnedIds = new Set(userConfig?.pinnedProjectIds ?? []);
    const rows = summaries.map((s) => ({ ...s, isPinned: pinnedIds.has(s.id) }));

    const filtered = issueFilter === "ALL"
      ? rows
      : rows.filter((r) => {
          if (issueFilter === "CRITICAL") return r.ragStatus === "RED";
          if (issueFilter === "WARNING") return r.ragStatus === "AMBER";
          if (issueFilter === "INFO") return r.issueCount.info > 0;
          return true;
        });

    filtered.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      const ragOrder = { RED: 0, AMBER: 1, GREEN: 2 };
      return ragOrder[a.ragStatus] - ragOrder[b.ragStatus];
    });

    let groups: unknown[] = [];
    let ungroupedProjects = filtered;

    if (groupBy !== "NONE") {
      const memberships = await this.prisma.projectGroupMembership.findMany({
        where: { project: { status: { notIn: ["CANCELLED"] } } },
        include: { group: true },
      });

      const groupMap = new Map<string, { group: any; projectIds: Set<string> }>();
      for (const m of memberships) {
        if (m.group.type !== groupBy) continue;
        if (!groupMap.has(m.groupId)) {
          groupMap.set(m.groupId, { group: m.group, projectIds: new Set() });
        }
        groupMap.get(m.groupId)!.projectIds.add(m.projectId);
      }

      const groupedProjectIds = new Set<string>();
      groups = Array.from(groupMap.values()).map(({ group, projectIds }) => {
        const groupProjects = filtered.filter((p) => projectIds.has(p.id));
        groupProjects.forEach((p) => groupedProjectIds.add(p.id));

        const ic = groupProjects.reduce(
          (acc, p) => ({
            critical: acc.critical + p.issueCount.critical,
            warning: acc.warning + p.issueCount.warning,
            info: acc.info + p.issueCount.info,
          }),
          { critical: 0, warning: 0, info: 0 },
        );
        const sc = {
          onTrack: groupProjects.filter((p) => p.ragStatus === "GREEN").length,
          warning: groupProjects.filter((p) => p.ragStatus === "AMBER").length,
          critical: groupProjects.filter((p) => p.ragStatus === "RED").length,
        };
        const avgProgress = groupProjects.length > 0
          ? Math.round(groupProjects.reduce((s, p) => s + p.overallProgress, 0) / groupProjects.length)
          : 0;

        let totalPlanned = 0, totalActual = 0, hasBudget = false;
        let earliestStart: Date | undefined, latestEnd: Date | undefined;
        for (const p of groupProjects) {
          if (p.plannedBudget) { totalPlanned += p.plannedBudget; hasBudget = true; }
          if (p.actualBudget) { totalActual += p.actualBudget; hasBudget = true; }
        }

        return {
          id: group.id,
          name: group.name,
          type: group.type,
          color: group.color,
          rollup: {
            totalProjects: groupProjects.length,
            weightedProgress: avgProgress,
            issueCount: ic,
            statusCount: sc,
            plannedBudget: hasBudget && totalPlanned > 0 ? totalPlanned : undefined,
            actualBudget: hasBudget && totalActual > 0 ? totalActual : undefined,
            budgetUsagePercent: totalPlanned > 0 && totalActual > 0
              ? Math.round((totalActual / totalPlanned) * 100)
              : undefined,
          },
          projects: groupProjects,
        };
      });

      ungroupedProjects = filtered.filter((p) => !groupedProjectIds.has(p.id));
    }

    return {
      date: date.toISOString().slice(0, 10),
      globalSummary,
      groups,
      ungroupedProjects,
      cachedAt: new Date().toISOString(),
    };
  }

  async getGroupRollup(groupId: string): Promise<GroupRollupSummary> {
    return this.cacheGetOrSet(
      `dashboard:group:${groupId}:rollup`,
      TTL,
      async () => {
        const memberships = await this.prisma.projectGroupMembership.findMany({
          where: { groupId },
          select: { projectId: true },
        });

        const projectIds = memberships.map((m) => m.projectId);
        const projects = await this.prisma.project.findMany({
          where: { id: { in: projectIds } },
          include: {
            tasks: {
              include: {
                segments: { select: { startDate: true, endDate: true } },
              },
            },
          },
        });

        const issuesList = await Promise.all(
          projects.map((p) => this.getProjectIssues(p.id)),
        );

        let totalPlanned = 0, totalActual = 0;
        let hasBudget = false;
        let earliestStart: Date | undefined;
        let latestEnd: Date | undefined;
        let onTrack = 0, warning = 0, critical = 0;
        const totalIssues = { critical: 0, warning: 0, info: 0 };
        let totalProgress = 0;

        projects.forEach((p, i) => {
          const issues = issuesList[i]!;
          const rag = determineRAG(issues);
          if (rag === "RED") critical++;
          else if (rag === "AMBER") warning++;
          else onTrack++;

          issues.forEach((iss) => {
            if (iss.severity === "CRITICAL") totalIssues.critical++;
            else if (iss.severity === "WARNING") totalIssues.warning++;
            else totalIssues.info++;
          });

          if (p.plannedBudget) { totalPlanned += Number(p.plannedBudget); hasBudget = true; }
          if (p.actualBudget) { totalActual += Number(p.actualBudget); hasBudget = true; }

          for (const task of p.tasks) {
            for (const seg of task.segments) {
              const start = new Date(seg.startDate);
              const end = new Date(seg.endDate);
              if (!earliestStart || start < earliestStart) earliestStart = start;
              if (!latestEnd || end > latestEnd) latestEnd = end;
            }
          }

          const activeTasks = p.tasks.filter((t) => t.status !== "DONE");
          const progress = activeTasks.length > 0
            ? Math.round(activeTasks.reduce((s, t) => s + t.overallProgress, 0) / activeTasks.length)
            : 0;
          totalProgress += progress;
        });

        return {
          totalProjects: projects.length,
          weightedProgress: projects.length > 0 ? Math.round(totalProgress / projects.length) : 0,
          issueCount: totalIssues,
          statusCount: { onTrack, warning, critical },
          plannedBudget: hasBudget && totalPlanned > 0 ? totalPlanned : undefined,
          actualBudget: hasBudget && totalActual > 0 ? totalActual : undefined,
          budgetUsagePercent: totalPlanned > 0 && totalActual > 0
            ? Math.round((totalActual / totalPlanned) * 100)
            : undefined,
          earliestStartDate: earliestStart?.toISOString().slice(0, 10),
          latestEndDate: latestEnd?.toISOString().slice(0, 10),
          cachedAt: new Date().toISOString(),
        };
      },
    );
  }

  async getUserConfig(userId: string) {
    let config = await this.prisma.dashboardConfig.findUnique({ where: { userId } });
    if (!config) {
      config = await this.prisma.dashboardConfig.create({ data: { userId } });
    }
    return config;
  }

  async updateUserConfig(userId: string, data: {
    pinnedProjectIds?: string[];
    issueFilter?: string;
    compactView?: boolean;
  }) {
    return this.prisma.dashboardConfig.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  async invalidateProject(projectId: string) {
    await this.redis.del(`dashboard:project:${projectId}:summary`);
    await this.redis.del(`dashboard:project:${projectId}:issues`);
    await this.redis.del("dashboard:global:summary");
  }

  async refreshAll() {
    const locked = await this.redis.set("dashboard:refresh:lock", "locked", "EX", 60, "NX");
    if (!locked) return { skipped: true };

    try {
      const projects = await this.prisma.project.findMany({
        where: { status: { notIn: ["CANCELLED", "COMPLETED"] } },
        select: { id: true },
      });

      const date = new Date();
      const BATCH = 20;
      for (let i = 0; i < projects.length; i += BATCH) {
        const batch = projects.slice(i, i + BATCH);
        await Promise.all(batch.map(async (p) => {
          await this.invalidateProject(p.id);
          await this.computeProjectSummary(p.id, date);
        }));
      }
      await this.redis.del("dashboard:global:summary");
      return { refreshed: projects.length };
    } finally {
      await this.redis.del("dashboard:refresh:lock");
    }
  }
}
