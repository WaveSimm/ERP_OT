import { PrismaClient } from "@prisma/client";
import { ProjectGateway } from "../infrastructure/websocket/project.gateway.js";

interface DelayedTask {
  taskId: string;
  taskName: string;
  projectId: string;
  projectName: string;
  overdueDays: number;
  isCritical: boolean;
}

interface OverloadedResource {
  resourceId: string;
  resourceName: string;
  projectId: string;
  projectName: string;
  totalAllocationPercent: number;
}

export class RiskDetectionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: ProjectGateway,
  ) {}

  async detectAndNotify(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 전역 임계값 설정 로드 (없으면 기본값 사용)
    const thresholdConfig = await this.prisma.issueThresholdConfig.findFirst();
    const overloadThreshold = thresholdConfig?.resourceOverloadWarning ?? 90;
    const delayWarningDays = thresholdConfig?.delayWarningDays ?? 3;

    const [delayedTasks, overloadedResources] = await Promise.all([
      this.detectDelayedTasks(today, delayWarningDays),
      this.detectOverloadedResources(today, overloadThreshold),
    ]);

    this.emitRiskEvents(delayedTasks, overloadedResources);
  }

  private async detectDelayedTasks(today: Date, warningDays: number): Promise<DelayedTask[]> {
    // 진행 중인 프로젝트의 크리티컬 태스크 중 세그먼트 종료일이 지난 미완료 태스크
    const tasks = await this.prisma.task.findMany({
      where: {
        isCritical: true,
        status: { notIn: ["DONE", "CANCELLED"] as any },
        project: { status: "IN_PROGRESS" },
        segments: {
          some: { endDate: { lt: today } },
        },
      },
      include: {
        project: { select: { id: true, name: true, ownerId: true } },
        segments: { orderBy: { endDate: "desc" }, take: 1 },
      },
    });

    return tasks
      .map((task) => {
        const latestSegment = task.segments[0];
        if (!latestSegment) return null;

        const overdueDays = Math.floor(
          (today.getTime() - new Date(latestSegment.endDate).getTime()) / (1000 * 60 * 60 * 24),
        );

        if (overdueDays < warningDays) return null;

        return {
          taskId: task.id,
          taskName: task.name,
          projectId: task.project.id,
          projectName: task.project.name,
          overdueDays,
          isCritical: task.isCritical,
          ownerId: task.project.ownerId,
        };
      })
      .filter(Boolean) as (DelayedTask & { ownerId: string })[];
  }

  private async detectOverloadedResources(
    today: Date,
    overloadThreshold: number,
  ): Promise<OverloadedResource[]> {
    // 오늘 날짜에 걸쳐 있는 세그먼트 배정 조회
    const assignments = await this.prisma.segmentAssignment.findMany({
      where: {
        allocationMode: "PERCENT",
        segment: {
          startDate: { lte: today },
          endDate: { gte: today },
        },
      },
      include: {
        segment: {
          include: {
            task: {
              include: {
                project: { select: { id: true, name: true, ownerId: true } },
              },
            },
          },
        },
      },
    });

    // 프로젝트별 자원별 총 배정률 집계
    const allocationMap = new Map<string, { total: number; projectId: string; projectName: string; ownerId: string }>();

    for (const assignment of assignments) {
      const key = `${assignment.resourceId}::${assignment.segment.task.projectId}`;
      const current = allocationMap.get(key);
      const percent = assignment.allocationPercent ?? 0;
      const project = assignment.segment.task.project;

      if (current) {
        current.total += percent;
      } else {
        allocationMap.set(key, {
          total: percent,
          projectId: project.id,
          projectName: project.name,
          ownerId: project.ownerId,
        });
      }
    }

    // 임계값 초과 자원 필터링 (resourceId 조회)
    const overloaded: (OverloadedResource & { ownerId: string })[] = [];
    for (const [key, info] of allocationMap.entries()) {
      if (info.total <= overloadThreshold) continue;

      const [resourceId] = key.split("::");
      if (!resourceId) continue;
      const resource = await this.prisma.resource.findFirst({
        where: { id: resourceId },
        select: { id: true, name: true },
      });
      if (!resource) continue;

      overloaded.push({
        resourceId: resource.id,
        resourceName: resource.name,
        projectId: info.projectId,
        projectName: info.projectName,
        totalAllocationPercent: info.total,
        ownerId: info.ownerId,
      });
    }

    return overloaded;
  }

  private emitRiskEvents(
    delayedTasks: (DelayedTask & { ownerId?: string })[],
    overloadedResources: (OverloadedResource & { ownerId?: string })[],
  ): void {
    // 지연 위험 알림
    for (const task of delayedTasks) {
      if (task.ownerId) {
        this.gateway.emitToUser(task.ownerId, "risk:delay_detected", {
          type: "DELAY",
          taskId: task.taskId,
          taskName: task.taskName,
          projectId: task.projectId,
          projectName: task.projectName,
          overdueDays: task.overdueDays,
          isCritical: task.isCritical,
          detectedAt: new Date().toISOString(),
        });
      }

      this.gateway.emitToProject(task.projectId, "risk:delay_detected", {
        type: "DELAY",
        taskId: task.taskId,
        taskName: task.taskName,
        overdueDays: task.overdueDays,
        detectedAt: new Date().toISOString(),
      });
    }

    // 자원 과부하 알림
    for (const resource of overloadedResources) {
      if (resource.ownerId) {
        this.gateway.emitToUser(resource.ownerId, "risk:overload_detected", {
          type: "OVERLOAD",
          resourceId: resource.resourceId,
          resourceName: resource.resourceName,
          projectId: resource.projectId,
          projectName: resource.projectName,
          totalAllocationPercent: resource.totalAllocationPercent,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // 대시보드에 이슈 발생 알림
    if (delayedTasks.length > 0 || overloadedResources.length > 0) {
      this.gateway.emitToAll("dashboard:new_critical_issue", {
        delayCount: delayedTasks.length,
        overloadCount: overloadedResources.length,
        detectedAt: new Date().toISOString(),
      });
    }
  }
}
