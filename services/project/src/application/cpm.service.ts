import { PrismaClient, DependencyType } from "@prisma/client";
import { AppError } from "@erp-ot/shared";
import { runCpm, CpmEdge, CpmResult } from "../domain/algorithms/cpm.algorithm.js";
import { ProjectCacheService } from "../infrastructure/cache/project.cache.js";
import { ProjectGateway } from "../infrastructure/websocket/project.gateway.js";

export interface CpmRunResult {
  projectId: string;
  projectDuration: number;
  criticalPath: string[];
  tasks: Array<{
    taskId: string;
    isCritical: boolean;
    totalFloat: number;
    earlyStart: number;
    earlyFinish: number;
    lateStart: number;
    lateFinish: number;
  }>;
}

export class CpmService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: ProjectCacheService,
    private readonly gateway: ProjectGateway,
  ) {}

  async getCachedOrRun(projectId: string): Promise<CpmRunResult> {
    const cached = await this.cache.getCpmResult<CpmRunResult>(projectId);
    if (cached) return cached;
    return this.runProjectCpm(projectId);
  }

  async runProjectCpm(projectId: string): Promise<CpmRunResult> {
    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      include: {
        segments: { orderBy: { sortOrder: "asc" } },
        predecessorDeps: true,
      },
    });

    if (tasks.length === 0) {
      throw new AppError(400, "NO_TASKS", "태스크가 없어 CPM을 실행할 수 없습니다.");
    }

    // 태스크 기간 계산 (세그먼트 전체 기간 = effectiveEnd - effectiveStart + 1)
    const cpmInputs = tasks.map((task) => {
      if (task.segments.length === 0) return { taskId: task.id, duration: 1 };

      const startDates = task.segments.map((s) => s.startDate.getTime());
      const endDates = task.segments.map((s) => s.endDate.getTime());
      const minStart = Math.min(...startDates);
      const maxEnd = Math.max(...endDates);
      const duration = Math.ceil((maxEnd - minStart) / 86_400_000) + 1;

      return { taskId: task.id, duration };
    });

    // 의존 관계 변환
    const edges: CpmEdge[] = tasks.flatMap((task) =>
      task.predecessorDeps.map((dep) => ({
        predecessorId: dep.predecessorId,
        successorId: dep.successorId,
        type: dep.type as "FS" | "SS" | "FF" | "SF",
        lagDays: dep.lagDays,
      })),
    );

    let result: CpmResult;
    try {
      result = runCpm(cpmInputs, edges);
    } catch (e: any) {
      if (e.message?.includes("Circular dependency")) {
        throw new AppError(422, "CIRCULAR_DEPENDENCY", "태스크 의존 관계에 순환이 있습니다.");
      }
      throw e;
    }

    // DB 업데이트 (배치)
    await this.prisma.$transaction(
      Array.from(result.nodes.entries()).map(([taskId, node]) =>
        this.prisma.task.update({
          where: { id: taskId },
          data: { isCritical: node.isCritical, totalFloat: node.totalFloat },
        }),
      ),
    );

    await this.cache.invalidateProjectSummary(projectId);
    await this.cache.invalidateCpmResult(projectId); // 이전 캐시 삭제 후 새로 저장

    const runResult: CpmRunResult = {
      projectId,
      projectDuration: result.projectDuration,
      criticalPath: result.criticalPath,
      tasks: Array.from(result.nodes.values()).map((node) => ({
        taskId: node.taskId,
        isCritical: node.isCritical,
        totalFloat: node.totalFloat,
        earlyStart: node.earlyStart,
        earlyFinish: node.earlyFinish,
        lateStart: node.lateStart,
        lateFinish: node.lateFinish,
      })),
    };
    await this.cache.setCpmResult(projectId, runResult);

    this.gateway.emitToProject(projectId, "cpm:completed", {
      projectId,
      criticalPath: result.criticalPath,
    });

    return runResult;
  }

  async addDependency(
    predecessorId: string,
    successorId: string,
    type: DependencyType,
    lagDays: number,
    projectId: string,
  ): Promise<void> {
    // 순환 감지를 위해 임시 그래프 구성
    const allDeps = await this.prisma.taskDependency.findMany({
      where: { predecessor: { projectId } },
    });

    const tempEdges: CpmEdge[] = [
      ...allDeps.map((d) => ({
        predecessorId: d.predecessorId,
        successorId: d.successorId,
        type: d.type as "FS" | "SS" | "FF" | "SF",
        lagDays: d.lagDays,
      })),
      { predecessorId, successorId, type: type as "FS" | "SS" | "FF" | "SF", lagDays },
    ];

    const tasks = await this.prisma.task.findMany({ where: { projectId }, select: { id: true } });
    try {
      // 위상 정렬으로 순환 감지
      runCpm(tasks.map((t) => ({ taskId: t.id, duration: 1 })), tempEdges);
    } catch (e: any) {
      if (e.message?.includes("Circular dependency")) {
        throw new AppError(422, "CIRCULAR_DEPENDENCY", "이 의존 관계를 추가하면 순환이 발생합니다.");
      }
      throw e;
    }

    await this.prisma.taskDependency.upsert({
      where: { predecessorId_successorId: { predecessorId, successorId } },
      create: { predecessorId, successorId, type, lagDays },
      update: { type, lagDays },
    });

    // ── 일정 자동 반영 (FS/SS only) ──────────────────────────────────────────
    await this.adjustSuccessorSchedule(predecessorId, successorId, type as "FS" | "SS" | "FF" | "SF", lagDays);
  }

  private async adjustSuccessorSchedule(
    predecessorId: string,
    successorId: string,
    type: "FS" | "SS" | "FF" | "SF",
    lagDays: number,
  ): Promise<void> {
    if (type !== "FS" && type !== "SS") return;

    const [predSegs, succSegs] = await Promise.all([
      this.prisma.taskSegment.findMany({ where: { taskId: predecessorId }, orderBy: { startDate: "asc" } }),
      this.prisma.taskSegment.findMany({ where: { taskId: successorId }, orderBy: { startDate: "asc" } }),
    ]);
    if (predSegs.length === 0 || succSegs.length === 0) return;

    // 기준일 계산
    const refDate =
      type === "FS"
        ? new Date(Math.max(...predSegs.map((s) => s.endDate.getTime())))   // pred 최종 종료일
        : new Date(Math.min(...predSegs.map((s) => s.startDate.getTime()))); // pred 최초 시작일

    const succFirstStart = new Date(Math.min(...succSegs.map((s) => s.startDate.getTime())));

    // 필요한 시작일: refDate + lagDays + (FS면 1일 추가)
    const MS_PER_DAY = 86_400_000;
    const requiredStart = new Date(refDate.getTime() + lagDays * MS_PER_DAY + (type === "FS" ? MS_PER_DAY : 0));

    // 이미 조건 충족이면 무시
    if (succFirstStart >= requiredStart) return;

    // 시프트 일수
    const shiftDays = Math.ceil((requiredStart.getTime() - succFirstStart.getTime()) / MS_PER_DAY);

    // 후행 태스크의 모든 세그먼트를 shiftDays 만큼 밀기
    await Promise.all(
      succSegs.map((seg) => {
        const newStart = new Date(seg.startDate.getTime() + shiftDays * MS_PER_DAY);
        const newEnd = new Date(seg.endDate.getTime() + shiftDays * MS_PER_DAY);
        return this.prisma.taskSegment.update({
          where: { id: seg.id },
          data: { startDate: newStart, endDate: newEnd },
        });
      }),
    );
  }
}
