import { PrismaClient, Dependency, DependencyType } from "@prisma/client";
import { AppError } from "@erp-ot/shared";
import { ProjectGateway } from "../infrastructure/websocket/project.gateway.js";
import type { CpmService } from "./cpm.service.js";

export interface CreateDependencyDto {
  predecessorTaskId: string;
  successorTaskId: string;
  dependencyType?: DependencyType | undefined;
  lag?: number | undefined;
}

/**
 * Task ↔ Task 의존성 관리.
 * "마일스톤-시점태스크-회귀" PDCA에서 polymorphic(Task↔Milestone) 폐기.
 * Cycle detection은 BFS로 app layer에서 검증.
 */
export class DependencyService {
  private cpmService: CpmService | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: ProjectGateway,
  ) {}

  /** circular import 방지를 위한 setter 주입 */
  setCpmService(cpm: CpmService): void {
    this.cpmService = cpm;
  }

  /** 의존성 변경 후 CPM 재계산 트리거 — fire-and-forget */
  private triggerCpmRecalc(projectId: string): void {
    if (!this.cpmService) return;
    void this.cpmService.runProjectCpm(projectId).catch((err) => {
      // TODO: inject logger — DependencyService에 FastifyBaseLogger 주입 후 this.log.error로 교체
      console.error("CPM recalc after dependency change failed:", err);  
    });
  }

  async findByProject(projectId: string): Promise<Dependency[]> {
    return this.prisma.dependency.findMany({
      where: { predecessorTask: { projectId } },
    });
  }

  async create(dto: CreateDependencyDto, userId: string): Promise<Dependency> {
    // 자기참조 검증
    if (dto.predecessorTaskId === dto.successorTaskId) {
      throw new AppError(400, "SELF_DEPENDENCY", "자기 자신에 의존할 수 없습니다.");
    }

    // 노드 존재 + 같은 프로젝트 검증
    const projectId = await this.validateTasksAndGetProject(dto.predecessorTaskId, dto.successorTaskId);

    // 동일 의존성 중복 검증
    const existing = await this.prisma.dependency.findFirst({
      where: {
        predecessorTaskId: dto.predecessorTaskId,
        successorTaskId: dto.successorTaskId,
      },
    });
    if (existing) {
      throw new AppError(409, "DEPENDENCY_EXISTS", "이미 존재하는 의존성입니다.");
    }

    // Cycle 검증
    await this.checkNoCycle(dto.predecessorTaskId, dto.successorTaskId);

    const dep = await this.prisma.dependency.create({
      data: {
        predecessorTaskId: dto.predecessorTaskId,
        successorTaskId: dto.successorTaskId,
        dependencyType: dto.dependencyType ?? "FS",
        lag: dto.lag ?? 0,
        createdBy: userId,
      },
    });

    this.gateway.emitToProject(projectId, "dependency:created", { projectId, dependencyId: dep.id });
    this.triggerCpmRecalc(projectId);
    return dep;
  }

  async delete(id: string, userId: string): Promise<void> {
    const dep = await this.prisma.dependency.findUnique({
      where: { id },
      include: { predecessorTask: { select: { projectId: true } } },
    });
    if (!dep) throw new AppError(404, "DEPENDENCY_NOT_FOUND", "의존성을 찾을 수 없습니다.");

    await this.prisma.dependency.delete({ where: { id } });

    const projectId = dep.predecessorTask?.projectId;
    if (projectId) {
      this.gateway.emitToProject(projectId, "dependency:deleted", { projectId, dependencyId: id });
      this.triggerCpmRecalc(projectId);
    }
  }

  // ─── 내부: 검증 ──────────────────────────────────────────────────────────

  private async validateTasksAndGetProject(predTaskId: string, succTaskId: string): Promise<string> {
    const [pred, succ] = await Promise.all([
      this.prisma.task.findUnique({ where: { id: predTaskId }, select: { projectId: true } }),
      this.prisma.task.findUnique({ where: { id: succTaskId }, select: { projectId: true } }),
    ]);
    if (!pred) throw new AppError(404, "TASK_NOT_FOUND", `태스크 ${predTaskId}를 찾을 수 없습니다.`);
    if (!succ) throw new AppError(404, "TASK_NOT_FOUND", `태스크 ${succTaskId}를 찾을 수 없습니다.`);
    if (pred.projectId !== succ.projectId) {
      throw new AppError(400, "CROSS_PROJECT_DEPENDENCY", "다른 프로젝트의 task에 의존할 수 없습니다.");
    }
    return pred.projectId;
  }

  /**
   * 신규 pred → succ 의존성 추가 시 BFS로 cycle 검증.
   * succ에서 출발해 successor 방향으로 따라가다 pred에 도달하면 cycle.
   */
  private async checkNoCycle(predTaskId: string, succTaskId: string): Promise<void> {
    const visited = new Set<string>();
    const queue: string[] = [succTaskId];

    while (queue.length > 0) {
      const taskId = queue.shift()!;
      if (visited.has(taskId)) continue;
      visited.add(taskId);

      if (taskId === predTaskId) {
        throw new AppError(409, "DEPENDENCY_CYCLE", "의존성 순환이 발생합니다.");
      }

      const nextDeps = await this.prisma.dependency.findMany({
        where: { predecessorTaskId: taskId },
        select: { successorTaskId: true },
      });
      for (const d of nextDeps) queue.push(d.successorTaskId);
    }
  }
}
