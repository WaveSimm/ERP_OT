// API 응답 엔티티 타입 (프론트가 JSON으로 받는 형태)
//   - DateTime → ISO string
//   - Decimal  → string | number (드라이버 직렬화)
//   - enum     → string (백엔드 enum 값)

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  plannedBudget: string | number | null;
  actualBudget: string | number | null;
  ownerId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  overallProgress: number | null;
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
}

export interface ProjectListItem extends Project {
  ownerName: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  projects?: { projectId: string; sortOrder: number }[];
}

export interface Dependency {
  id: string;
  predecessorTaskId: string;
  successorTaskId: string;
  dependencyType: string;
  lag: number;
  createdBy: string;
  createdAt: string;
}

export interface SegmentAssignment {
  id: string;
  segmentId: string;
  resourceId: string;
  personUserId: string | null;
  externalPersonId: string | null;
  equipmentResourceId: string | null;
  allocationMode: string;
  allocationPercent: number | null;
  allocationHoursPerDay: number | null;
  createdAt: string;
  updatedAt: string;
  resourceName?: string;
  resourceType?: string;
}

export interface TaskSegment {
  id: string;
  taskId: string;
  name: string;
  sortOrder: number;
  startDate: string;
  endDate: string;
  progressPercent: number;
  createdAt: string;
  updatedAt: string;
  assignments?: SegmentAssignment[];
}

export interface Task {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  description: string | null;
  status: string;
  sortOrder: number;
  overallProgress: number;
  isManualProgress: boolean;
  isMilestone: boolean;
  isCritical: boolean;
  totalFloat: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
  segments?: TaskSegment[];
}

export interface TaskComment {
  id: string;
  taskId: string;
  content: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  mentions?: { userId: string }[];
}
