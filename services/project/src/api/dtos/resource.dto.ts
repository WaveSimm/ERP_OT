// Phase 5 (2026-05-13): legacy Resource DTO는 사용 안 함. 호환용 stub 타입만 유지
type ResourceType = "PERSON" | "EQUIPMENT" | "VEHICLE" | "FACILITY";

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
