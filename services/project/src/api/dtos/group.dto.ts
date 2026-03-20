import { GroupType } from "@prisma/client";

export interface CreateGroupDto {
  name: string;
  type?: GroupType;
  parentGroupId?: string;
  sortOrder?: number;
}

export interface UpdateGroupDto {
  name?: string;
  type?: GroupType;
  parentGroupId?: string | null;
  sortOrder?: number;
}

export interface GroupMemberDto {
  projectId: string;
}

export interface GroupRollupResponse {
  groupId: string;
  groupName: string;
  totalProjects: number;
  completedProjects: number;
  overallProgress: number;
  criticalIssues: number;
  children?: GroupRollupResponse[];
}
