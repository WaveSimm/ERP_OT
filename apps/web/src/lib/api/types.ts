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

// ─── Attendance ──────────────────────────────────────────────────────────────
// NOTE: 출퇴근 기록/캘린더(getToday·getCalendar·getSummary) 응답은 컴포넌트 로컬
//   타입(AttendanceView의 TodayRecord·CalendarDay)과 필드가 달라 별도 정밀 대조 후 타이핑 예정.

export interface WorkScheduleEntry {
  id: string;
  userId: string;
  date: string;
  entryType: string;
  startTime: string | null;
  endTime: string | null;
  label: string | null;
  groupId: string | null;
  sourceType: string;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Leave / Holiday Work ────────────────────────────────────────────────────
export interface LeaveBalance {
  id: string;
  userId: string;
  year: number;
  totalDays: number;
  longServiceDays: number;
  usedDays: number;
  pendingDays: number;
  adjustedDays: number;
  updatedAt: string;
  remainingDays: number;
}

export interface LeaveRequest {
  id: string;
  userId: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: string;
  approverId: string | null;
  secondApproverId: string | null;
  thirdApproverId: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  userName?: string | null;
  approverName?: string | null;
  secondApproverName?: string | null;
  thirdApproverName?: string | null;
}

export interface HolidayWorkRequest {
  id: string;
  userId: string;
  date: string;
  reason: string;
  status: string;
  approverId: string | null;
  secondApproverId: string | null;
  thirdApproverId: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
  projectId: string | null;
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
  userName?: string | null;
  approverName?: string | null;
  secondApproverName?: string | null;
  thirdApproverName?: string | null;
}

// ─── User / Org ──────────────────────────────────────────────────────────────
export interface UserProfile {
  phoneOffice?: string | null;
  phoneMobile?: string | null;
  address?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  status: string;
  retirementDate: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  profile?: UserProfile | null;
  isOnline?: boolean;
  // 일부 응답/caller가 프로필 필드를 평탄하게 접근 (호환용 옵셔널)
  phoneOffice?: string | null;
  phoneMobile?: string | null;
  address?: string | null;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  headUserId: string | null;
  soukwalUserId: string | null;
  daepyoUserId: string | null;
  level: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // getTree/getById 계산·관계 필드
  memberCount?: number;
  headName?: string | null;
  soukwalName?: string | null;
  daepyoName?: string | null;
  children?: Department[];
  members?: {
    userId: string;
    departmentName?: string | null;
    user?: { id: string; name: string; email: string; role: string };
  }[];
}

export interface ApprovalLine {
  id: string;
  userId: string;
  approverId: string;
  secondApproverId: string | null;
  thirdApproverId: string | null;
  delegateId: string | null;
  delegateUntil: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // 백엔드 보강 필드 (이름 lookup / 위임 상태)
  approverName?: string | null;
  secondApproverName?: string | null;
  thirdApproverName?: string | null;
  delegateName?: string | null;
  isDelegated?: boolean;
}

// ─── Notification / ActivityLog / Dashboard ──────────────────────────────────
export interface Notification {
  id: string;
  userId: string;
  type: string;
  source: string;
  title: string;
  body: string;
  isRead: boolean;
  priority: number;
  linkUrl: string | null;
  metadata?: unknown;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  projectId: string | null;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  description: string;
  metadata?: unknown;
  createdAt: string;
  project?: { id: string; name: string } | null;
}

export interface DashboardConfig {
  defaultGroupBy?: string;
  pinnedProjectIds?: string[];
  issueFilter?: string;
  presentationMode?: boolean;
}
