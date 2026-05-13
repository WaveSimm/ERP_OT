// Phase 5 (2026-05-13): legacy Resource 폐기. 호환 stub 타입
type ResourceType = "PERSON" | "EQUIPMENT" | "VEHICLE" | "FACILITY";
interface Resource {
  id: string;
  name: string;
  type: ResourceType;
  userId: string | null;
  dailyCapacityHours: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResourceListFilter {
  type?: ResourceType;
  isActive?: boolean;
}

export interface IResourceRepository {
  findById(id: string): Promise<Resource | null>;
  findAll(filter?: ResourceListFilter): Promise<Resource[]>;
  create(data: Omit<Resource, "id" | "createdAt" | "updatedAt">): Promise<Resource>;
  update(id: string, data: Partial<Resource>): Promise<Resource>;
}
