import { ProjectStatus } from "@prisma/client";

export class ProjectEntity {
  constructor(
    public readonly id: string,
    public name: string,
    public description: string | null,
    public status: ProjectStatus,
    public ownerId: string,
    public createdBy: string,
    public createdAt: Date,
    public updatedAt: Date,
    public plannedBudget?: number | null,
    public actualBudget?: number | null,
  ) {}

  isEditable(): boolean {
    return this.status !== ProjectStatus.CANCELLED && this.status !== ProjectStatus.COMPLETED;
  }

  canDelete(): boolean {
    return this.status === ProjectStatus.PLANNING;
  }
}
