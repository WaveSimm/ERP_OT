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

export interface ImpactAnalysisResult {
  triggeredTask: {
    taskId: string;
    taskName: string;
    delayDays: number;
  };
  affectedTasks: AffectedTask[];
  projectEndDateChange: {
    original: string;
    projected: string;
    deviationDays: number;
  };
  isWhatIf: boolean;
}

export class ImpactService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cpmService: CpmService,
  ) {}

  async analyzeImpact(
    projectId: string,
    taskId: string,
    delayDays: number,
    isWhatIf: boolean,
  ): Promise<ImpactAnalysisResult> {
    if (delayDays <= 0) {
      throw new AppError(400, "INVALID_DELAY", "지연 일수는 1 이상이어야 합니다.");
    }

    // 태스크 + 의존 관계 조회
    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      include: {
        segments: { orderBy: { sortOrder: "asc" } },
        predecessorDeps: true,
      },
    });

    const triggeredTask = tasks.find((t) => t.id === taskId);
    if (!triggeredTask) {
      throw new AppError(404, "TASK_NOT_FOUND", "태스크를 찾을 수 없습니다.");
    }

    // CPM 결과 가져오기 (캐시 우선, 없으면 재계산)
    const cpmResult: CpmRunResult = await this.cpmService.getCachedOrRun(projectId);

    // 프로젝트 시작일 (전체 세그먼트 중 최솟값)
    const allStartDates = tasks
      .flatMap((t) => t.segments.map((s) => s.startDate.getTime()))
      .filter((d) => !isNaN(d));
    const projectStartMs = allStartDates.length > 0 ? Math.min(...allStartDates) : Date.now();

    // CPM 노드 맵 (taskId → 노드)
    const nodeMap = new Map(cpmResult.tasks.map((n) => [n.taskId, n]));

    // 의존 관계 엣지 목록
    const edges: CpmEdge[] = tasks.flatMap((t) =>
      t.predecessorDeps.map((dep) => ({
        predecessorId: dep.predecessorId,
        successorId: dep.successorId,
        type: dep.type as "FS" | "SS" | "FF" | "SF",
        lagDays: dep.lagDays,
      })),
    );

    // 태스크명 맵
    const nameMap = new Map(tasks.map((t) => [t.id, t.name]));

    // 트리거 태스크의 원래 완료일
    const triggeredNode = nodeMap.get(taskId);
    const triggeredEndMs = triggeredNode
      ? projectStartMs + triggeredNode.earlyFinish * 86_400_000
      : projectStartMs;

    // ─── BFS 지연 전파 ─────────────────────────────────────────────────────

    const affected: AffectedTask[] = [];
    const visited = new Set<string>();
    const queue: { taskId: string; delay: number; chain: string[] }[] = [
      { taskId, delay: delayDays, chain: [taskId] },
    ];

    while (queue.length > 0) {
      const { taskId: currentId, delay, chain } = queue.shift()!;
      const successorEdges = edges.filter((e) => e.predecessorId === currentId);

      for (const edge of successorEdges) {
        if (visited.has(edge.successorId)) continue;

        const succNode = nodeMap.get(edge.successorId);
        if (!succNode) continue;

        // 엣지 타입별 전파 계산 (보수적: 전체 지연 전파)
        const propagated = calculatePropagated(edge.type, delay, edge.lagDays);

        // Float 초과 시에만 실제 지연
        const actualDelay = propagated - Math.max(succNode.totalFloat, 0);
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

        queue.push({
          taskId: edge.successorId,
          delay: actualDelay,
          chain: [...chain, edge.successorId],
        });
      }
    }

    // 프로젝트 완료일 변화 계산
    const origProjectEndMs =
      projectStartMs + (cpmResult.projectDuration - 1) * 86_400_000;

    const maxProjectedMs = affected.reduce((maxMs, t) => {
      const ms = new Date(t.projectedEndDate).getTime();
      return ms > maxMs ? ms : maxMs;
    }, origProjectEndMs);

    const deviationDays = Math.round(
      (maxProjectedMs - origProjectEndMs) / 86_400_000,
    );

    return {
      triggeredTask: {
        taskId,
        taskName: triggeredTask.name,
        delayDays,
      },
      affectedTasks: affected,
      projectEndDateChange: {
        original: new Date(origProjectEndMs).toISOString().slice(0, 10),
        projected: new Date(maxProjectedMs).toISOString().slice(0, 10),
        deviationDays,
      },
      isWhatIf,
    };
  }
}

// 엣지 타입별 지연 전파량 계산
function calculatePropagated(
  type: "FS" | "SS" | "FF" | "SF",
  delay: number,
  lagDays: number,
): number {
  // FS/SS/SF: 선행 태스크 시작 또는 완료가 밀리므로 후행도 동일하게 전파
  // FF: 선행 완료가 delay 만큼 밀리면 후행 완료도 동일하게 전파
  // 모든 유형에서 delay는 동일하게 전파 (lag는 이미 CPM에서 반영)
  void lagDays; // lag는 CPM float 계산에 이미 반영됨
  return delay;
}
