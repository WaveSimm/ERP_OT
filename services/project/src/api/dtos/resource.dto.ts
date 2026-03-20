import { ResourceType } from "@prisma/client";

export interface CreateResourceDto {
  name: string;
  type?: ResourceType;
  dailyCapacityHours?: number;
}

export interface UpdateResourceDto {
  name?: string;
  type?: ResourceType;
  dailyCapacityHours?: number;
  isActive?: boolean;
}

export interface ResourceUtilizationQuery {
  startDate: string;
  endDate: string;
}

export interface ResourceHeatmapQuery {
  startDate: string;
  endDate: string;
  granularity?: "day" | "week" | "month";
}
