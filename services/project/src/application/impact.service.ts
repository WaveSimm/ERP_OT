import { PrismaClient } from "@prisma/client";
import { AppError } from "@erp-ot/shared";
import { CpmService, CpmRunResult } from "./cpm.service.js";
import { CpmEdge } from "../domain/algorithms/cpm.algorithm.js";

export interface AffectedTask {
  taskId: string;
  taskName: string;
  originalEndDate: string;
  projectedEndDate: string;
  propagatedDelayDays: number;
  isCritical: boolean;
  dependencyChain: string[];
}

export interface ProjectEndChange {
  original: string;
  projected: string;
  deviationDays: number;
}

// What-If(가정) 분석 결과 — 사용자가 입력한 지연을 전파
export interface ImpactAnalysisResult {
  triggeredTask: {
    taskId: string;
    taskName: string;
    delayDays: number;
  };
  affectedTasks: AffectedTask[];
  projectEndDateChange: ProjectEndChange;
  isWhatIf: boolean;
}

// 현재 상태 분석 결과 — 실제로 지연된 태스크들을 자동 탐지해 전파
export interface CurrentStateResult {
  delayedTasks: { taskId: string; taskName: string; delayDays: number; endDate: string }[];
  affectedTasks: AffectedTask[];
  projectEndDateChange: ProjectEndChange;
  isWhatIf: false;
}

interface ImpactContext {
  tasks: Array<{ id: string; name: string; status: string; overallProgress: number; segments: { startDate: Date; endDate: Date }[] }>;
  nodeMap: Map<string, CpmRunResult["tasks"][number]>;
  edges: CpmEdge[];
  nameMap: Map<string, string>;
  projectStartMs: number;
  cpmResult: CpmRunResult;
}

export class ImpactService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cpmService: CpmService,
  ) {}

  // ─── 공통 컨텍스트 (태스크·의존관계·CPM 로드) ────────────────────────────────
  private async buildContext(projectId: string): Promise<ImpactContext> {
    const [tasks, deps] = await Promise.all([
      this.prisma.task.findMany({
        where: { projectId },
        include: { segments: { orderBy: { sortOrder: "asc" } } },
      }),
      this.prisma.dependency.findMany({
        where: { predecessorTask: { projectId } },
      }),
    ]);

    const cpmResult: CpmRunResult = await this.cpmService.getCachedOrRun(projectId);

    const allStartDates = tasks
      .flatMap((t) => t.segments.map((s) => s.startDate.getTime()))
      .filter((d) => !isNaN(d));
    const projectStartMs = allStartDates.length > 0 ? Math.min(...allStartDates) : Date.now();

    const nodeMap = new Map(cpmResult.tasks.map((n) => [n.taskId, n]));
    const edges: CpmEdge[] = deps.map((dep) => ({
      predecessorId: dep.predecessorTaskId,
      successorId: dep.successorTaskId,
      type: dep.dependencyType as "FS" | "SS" | "FF" | "SF",
      lagDays: dep.lag,
    }));
    const nameMap = new Map(tasks.map((t) => [t.id, t.name]));

    return {
      tasks: tasks.map((t) => ({ id: t.id, name: t.name, status: t.status as string, overallProgress: t.overallProgress, segments: t.segments })),
      nodeMap, edges, nameMap, projectStartMs, cpmResult,
    };
  }

  // ─── 단일 트리거 BFS 지연 전파 ────────────────────────────────────────────────
  private propagate(triggerId: string, delayDays: number, ctx: ImpactContext): AffectedTask[] {
    const { nodeMap, edges, nameMap, projectStartMs } = ctx;
    const affected: AffectedTask[] = [];
    const visited = new Set<string>();
    const queue: { taskId: string; delay: number; chain: string[] }[] = [
      { taskId: triggerId, delay: delayDays, chain: [triggerId] },
    ];

    while (queue.length > 0) {
      const { taskId: currentId, delay, chain } = queue.shift()!;
      const successorEdges = edges.filter((e) => e.predecessorId === currentId);

      for (const edge of successorEdges) {
        if (visited.has(edge.successorId)) continue;
        const succNode = nodeMap.get(edge.successorId);
        if (!succNode) continue;

        const propagated = calculatePropagated(edge.type, delay, edge.lagDays);
        const actualDelay = propagated - Math.max(succNode.totalFloat, 0); // Float 초과 시에만 실제 지연
        if (actualDelay <= 0) continue;

        visited.add(edge.successorId);
        const origEndMs = projectStartMs + succNode.earlyFinish * 86_400_000;
        const projEndMs = origEndMs + actualDelay * 86_400_000;

        affected.push({
          taskId: edge.successorId,
          taskName: nameMap.get(edge.successorId) ?? edge.successorId,
          originalEndDate: new Date(origEndMs).toISOString().slice(0, 10),
          projectedEndDate: new Date(projEndMs).toISOString().slice(0, 10),
          propagatedDelayDays: actualDelay,
          isCritical: succNode.isCritical,
          dependencyChain: [...chain, edge.successorId],
        });
        queue.push({ taskId: edge.successorId, delay: actualDelay, chain: [...chain, edge.successorId] });
      }
    }
    return affected;
  }

  private projectEndChange(ctx: ImpactContext, affected: AffectedTask[]): ProjectEndChange {
    const origProjectEndMs = ctx.projectStartMs + (ctx.cpmResult.projectDuration - 1) * 86_400_000;
    const maxProjectedMs = affected.reduce((maxMs, t) => {
      const ms = new Date(t.projectedEndDate).getTime();
      return ms > maxMs ? ms : maxMs;
    }, origProjectEndMs);
    return {
      original: new Date(origProjectEndMs).toISOString().slice(0, 10),
      projected: new Date(maxProjectedMs).toISOString().slice(0, 10),
      deviationDays: Math.round((maxProjectedMs - origProjectEndMs) / 86_400_000),
    };
  }

  // 태스크의 실제 현재 지연(일) — 미완료이고 계획 종료일이 지났으면 초과 일수
  private computeActualDelay(
    task: ImpactContext["tasks"][number],
    todayMs: number,
  ): number {
    const done = task.overallProgress >= 100 || task.status === "DONE";
    if (done) return 0;
    const endTimes = task.segments.map((s) => s.endDate.getTime()).filter((n) => !isNaN(n));
    if (endTimes.length === 0) return 0;
    const endMs = Math.max(...endTimes);
    if (endMs >= todayMs) return 0; // 아직 기한 전 — 지연 아님
    return Math.ceil((todayMs - endMs) / 86_400_000);
  }

  // ─── What-If: 사용자 입력 지연 전파 ──────────────────────────────────────────
  async analyzeImpact(
    projectId: string,
    taskId: string,
    delayDays: number,
    isWhatIf: boolean,
  ): Promise<ImpactAnalysisResult> {
    if (delayDays <= 0) {
      throw new AppError(400, "INVALID_DELAY", "지연 일수는 1 이상이어야 합니다.");
    }
    const ctx = await this.buildContext(projectId);
    const triggeredTask = ctx.tasks.find((t) => t.id === taskId);
    if (!triggeredTask) {
      throw new AppError(404, "TASK_NOT_FOUND", "태스크를 찾을 수 없습니다.");
    }
    const affected = this.propagate(taskId, delayDays, ctx);
    return {
      triggeredTask: { taskId, taskName: triggeredTask.name, delayDays },
      affectedTasks: affected,
      projectEndDateChange: this.projectEndChange(ctx, affected),
      isWhatIf,
    };
  }

  // ─── 현재 상태: 실제 지연 태스크 자동 탐지 → 전파 ──────────────────────────────
  async analyzeCurrentState(projectId: string): Promise<CurrentStateResult> {
    const ctx = await this.buildContext(projectId);
    const todayMs = startOfTodayUtcMs();

    const delayedTasks: CurrentStateResult["delayedTasks"] = [];
    for (const t of ctx.tasks) {
      const d = this.computeActualDelay(t, todayMs);
      if (d > 0) {
        const endMs = Math.max(...t.segments.map((s) => s.endDate.getTime()).filter((n) => !isNaN(n)));
        delayedTasks.push({ taskId: t.id, taskName: t.name, delayDays: d, endDate: new Date(endMs).toISOString().slice(0, 10) });
      }
    }
    delayedTasks.sort((a, b) => b.delayDays - a.delayDays);

    // 각 지연 태스크에서 전파 후 영향 태스크별 최대 지연으로 병합
    const merged = new Map<string, AffectedTask>();
    for (const dt of delayedTasks) {
      for (const a of this.propagate(dt.taskId, dt.delayDays, ctx)) {
        const ex = merged.get(a.taskId);
        if (!ex || a.propagatedDelayDays > ex.propagatedDelayDays) merged.set(a.taskId, a);
      }
    }
    const affected = [...merged.values()].sort((a, b) => b.propagatedDelayDays - a.propagatedDelayDays);

    return {
      delayedTasks,
      affectedTasks: affected,
      projectEndDateChange: this.projectEndChange(ctx, affected),
      isWhatIf: false,
    };
  }
}

// 오늘 00:00 UTC ms (날짜 단위 비교용)
function startOfTodayUtcMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

// 엣지 타입별 지연 전파량 — 모든 유형에서 delay 동일 전파 (lag는 CPM float에 이미 반영)
function calculatePropagated(
  type: "FS" | "SS" | "FF" | "SF",
  delay: number,
  lagDays: number,
): number {
  void type;
  void lagDays;
  return delay;
}
