/**
 * CPM (Critical Path Method) — Forward/Backward Pass
 *
 * 입력: 태스크 목록 + 의존 관계
 * 출력: 각 태스크의 ES/EF/LS/LF/Float + 크리티컬 패스 여부
 */

export interface CpmNode {
  taskId: string;
  duration: number; // 영업일 수 (effectiveEndDate - effectiveStartDate + 1)
  // Forward Pass 결과
  earlyStart: number; // ES (프로젝트 시작일 기준 오프셋)
  earlyFinish: number; // EF = ES + duration - 1
  // Backward Pass 결과
  lateStart: number; // LS
  lateFinish: number; // LF
  totalFloat: number; // TF = LS - ES = LF - EF
  isCritical: boolean; // TF === 0
}

export interface CpmEdge {
  predecessorId: string;
  successorId: string;
  type: "FS" | "SS" | "FF" | "SF";
  lagDays: number;
}

export interface CpmResult {
  nodes: Map<string, CpmNode>;
  criticalPath: string[]; // taskId 순서열
  projectDuration: number;
}

export function runCpm(
  tasks: Array<{ taskId: string; duration: number }>,
  edges: CpmEdge[],
): CpmResult {
  const nodes = new Map<string, CpmNode>();

  // 초기화
  for (const t of tasks) {
    nodes.set(t.taskId, {
      taskId: t.taskId,
      duration: t.duration,
      earlyStart: 0,
      earlyFinish: t.duration - 1,
      lateStart: 0,
      lateFinish: 0,
      totalFloat: 0,
      isCritical: false,
    });
  }

  // 위상 정렬
  const order = topologicalSort(tasks.map((t) => t.taskId), edges);

  // ─── Forward Pass ────────────────────────────────────────
  for (const taskId of order) {
    const node = nodes.get(taskId)!;
    const predecessorEdges = edges.filter((e) => e.successorId === taskId);

    let maxES = 0;
    for (const edge of predecessorEdges) {
      const pred = nodes.get(edge.predecessorId)!;
      let candidateES = 0;

      switch (edge.type) {
        case "FS":
          candidateES = pred.earlyFinish + 1 + edge.lagDays;
          break;
        case "SS":
          candidateES = pred.earlyStart + edge.lagDays;
          break;
        case "FF":
          // EF_succ = EF_pred + lag → ES_succ = EF_pred + lag - duration + 1
          candidateES = pred.earlyFinish + edge.lagDays - node.duration + 1;
          break;
        case "SF":
          // ES_succ <= ES_pred + lag - duration + 1 (드물게 사용)
          candidateES = pred.earlyStart + edge.lagDays - node.duration + 1;
          break;
      }
      maxES = Math.max(maxES, candidateES);
    }

    node.earlyStart = Math.max(0, maxES);
    node.earlyFinish = node.earlyStart + node.duration - 1;
  }

  // 프로젝트 총 기간 = 가장 늦은 EF + 1
  const projectDuration =
    Math.max(...Array.from(nodes.values()).map((n) => n.earlyFinish)) + 1;

  // ─── Backward Pass ───────────────────────────────────────
  // 역순 위상 정렬
  for (const taskId of [...order].reverse()) {
    const node = nodes.get(taskId)!;
    const successorEdges = edges.filter((e) => e.predecessorId === taskId);

    if (successorEdges.length === 0) {
      // 종단 노드: LF = projectDuration - 1
      node.lateFinish = projectDuration - 1;
    } else {
      let minLF = Infinity;
      for (const edge of successorEdges) {
        const succ = nodes.get(edge.successorId)!;
        let candidateLF = Infinity;

        switch (edge.type) {
          case "FS":
            // LF_pred = LS_succ - lag - 1
            candidateLF = succ.lateStart - edge.lagDays - 1;
            break;
          case "SS":
            candidateLF = succ.lateStart - edge.lagDays + node.duration - 1;
            break;
          case "FF":
            candidateLF = succ.lateFinish - edge.lagDays;
            break;
          case "SF":
            candidateLF = succ.lateStart - edge.lagDays + node.duration - 1;
            break;
        }
        minLF = Math.min(minLF, candidateLF);
      }
      node.lateFinish = minLF === Infinity ? projectDuration - 1 : minLF;
    }

    node.lateStart = node.lateFinish - node.duration + 1;
    node.totalFloat = node.lateStart - node.earlyStart;
    node.isCritical = node.totalFloat <= 0;
  }

  // 크리티컬 패스 순서 추출
  const criticalPath = order.filter((id) => nodes.get(id)!.isCritical);

  return { nodes, criticalPath, projectDuration };
}

/**
 * Kahn's Algorithm — 위상 정렬 (순환 감지 포함)
 */
function topologicalSort(taskIds: string[], edges: CpmEdge[]): string[] {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const id of taskIds) {
    inDegree.set(id, 0);
    adjList.set(id, []);
  }

  for (const edge of edges) {
    adjList.get(edge.predecessorId)?.push(edge.successorId);
    inDegree.set(edge.successorId, (inDegree.get(edge.successorId) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);

    for (const neighbor of adjList.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (result.length !== taskIds.length) {
    throw new Error("Circular dependency detected in task graph");
  }

  return result;
}
