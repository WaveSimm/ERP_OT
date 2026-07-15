"use client";

import { request, API_PREFIX, getCsrfToken } from "./client";
import type {
  Project, ProjectListItem, Paginated,
  Folder, Dependency, Task, TaskSegment, SegmentAssignment, TaskComment,
  WorkScheduleEntry, LeaveBalance, LeaveRequest, HolidayWorkRequest,
  User, Department, ApprovalLine,
  Notification, ActivityLog, DashboardConfig,
  ProjectSummary, ProjectTemplate,
} from "./types";


// ─── Projects ────────────────────────────────────────────────────────────────

export const projectApi = {
  // 전체 로드: 백엔드 limit 상한(100)에 맞춰 페이지를 끝까지 순회해 모든 프로젝트를 모아 반환.
  list: async (params?: { search?: string; status?: string }) => {
    const PAGE_SIZE = 100;
    const items: ProjectListItem[] = [];
    let page = 1;
    let total = 0;
    // 무한루프 방지용 안전장치 (최대 1000페이지 = 10만 건)
    for (let guard = 0; guard < 1000; guard++) {
      const q = new URLSearchParams({
        ...(params as Record<string, string>),
        page: String(page),
        limit: String(PAGE_SIZE),
      }).toString();
      const res = await request<Paginated<ProjectListItem>>(`/projects?${q}`);
      items.push(...res.items);
      total = res.total;
      if (items.length >= total || res.items.length === 0) break;
      page++;
    }
    return { items, total, page: 1, limit: items.length } as Paginated<ProjectListItem>;
  },
  get: (id: string) => request<Project>(`/projects/${id}`),
  getSummary: (id: string) => request<ProjectSummary>(`/projects/${id}/summary`),
  create: (data: { name: string; description?: string }) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Record<string, unknown>) =>
    request<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),
  gantt: (id: string) => request<any>(`/projects/${id}/gantt`),
  runCpm: (id: string) => request<any>(`/projects/${id}/cpm`, { method: "POST", body: "{}" }),
  activities: (id: string, page = 1) =>
    request<any>(`/projects/${id}/activities?page=${page}&pageSize=20`),
  // MS Planner 일괄 이관 (프로젝트 마이그레이션 탭, ADMIN)
  importPlanner: (data: unknown) =>
    request<{
      aborted: boolean;
      reason?: string;
      projectId?: string;
      tasks?: number;
      segments?: number;
      assignments?: number;
      dependencies?: number;
    }>("/projects/import-planner", { method: "POST", body: JSON.stringify(data) }),
};

// ─── Folders ─────────────────────────────────────────────────────────────────

export const folderApi = {
  list: () => request<Folder[]>("/folders"),
  create: (data: { name: string; parentId?: string; sortOrder?: number }) =>
    request<Folder>("/folders", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; parentId?: string; sortOrder?: number }) =>
    request<Folder>(`/folders/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/folders/${id}`, { method: "DELETE" }),
  addProject: (folderId: string, projectId: string, sortOrder?: number) =>
    request<any>(`/folders/${folderId}/projects`, { method: "POST", body: JSON.stringify({ projectId, sortOrder }) }),
  removeProject: (folderId: string, projectId: string) =>
    request<void>(`/folders/${folderId}/projects/${projectId}`, { method: "DELETE" }),
  reorderProjects: (folderId: string, projectIds: string[]) =>
    request<any>(`/folders/${folderId}/reorder`, { method: "PATCH", body: JSON.stringify({ projectIds }) }),
  reorderFolders: (folderIds: string[]) =>
    request<any>("/folders/reorder", { method: "PATCH", body: JSON.stringify({ folderIds }) }),

  // 내 즐겨찾기 (사용자별 프라이빗)
  favorites: () => request<{ projectIds: string[] }>("/folders/favorites"),
  addFavorite: (projectId: string) =>
    request<{ ok: true }>(`/folders/favorites/${projectId}`, { method: "POST" }),
  removeFavorite: (projectId: string) =>
    request<void>(`/folders/favorites/${projectId}`, { method: "DELETE" }),
};

// ─── Dependencies (Task ↔ Task) ────────────────────────────────────────────
// "마일스톤-시점태스크-회귀" PDCA에서 milestoneApi 폐기, dependencyApi 단순화

export const dependencyApi = {
  list: (projectId: string) =>
    request<Dependency[]>(`/projects/${projectId}/dependencies`),
  create: (projectId: string, data: {
    predecessorTaskId: string;
    successorTaskId: string;
    dependencyType?: "FS" | "SS" | "FF" | "SF";
    lag?: number;
  }) =>
    request<Dependency>(`/projects/${projectId}/dependencies`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/dependencies/${id}`, { method: "DELETE" }),
};

// ─── Tasks ───────────────────────────────────────────────────────────────────

export const taskApi = {
  list: (projectId: string) => request<Task[]>(`/projects/${projectId}/tasks`),
  get: (projectId: string, taskId: string) =>
    request<Task>(`/projects/${projectId}/tasks/${taskId}`),
  create: (projectId: string, data: unknown) =>
    request<Task>(`/projects/${projectId}/tasks`, { method: "POST", body: JSON.stringify(data) }),
  update: (projectId: string, taskId: string, data: unknown) =>
    request<Task>(`/projects/${projectId}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (projectId: string, taskId: string) =>
    request<void>(`/projects/${projectId}/tasks/${taskId}`, { method: "DELETE" }),

  // 프로젝트-관리 PDCA US-32: 태스크 복사 (백엔드 template.service.copyTask 활용)
  copy: (projectId: string, taskId: string, data: {
    targetProjectId: string;
    includeSegments: boolean;
    includeAssignments: boolean;
    dateOffsetDays: number;
  }) =>
    request<any>(`/projects/${projectId}/tasks/${taskId}/copy`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // 다중 태스크 복사 (선택 세트 내부 parent-child 관계 보존)
  bulkCopy: (projectId: string, data: {
    taskIds: string[];
    targetProjectId: string;
    includeSegments: boolean;
    includeAssignments: boolean;
    dateOffsetDays: number;
  }) =>
    request<{ count: number; idMap: Record<string, string> }>(
      `/projects/${projectId}/tasks/bulk-copy`,
      { method: "POST", body: JSON.stringify(data) },
    ),

  // Segments
  createSegment: (projectId: string, taskId: string, data: unknown) =>
    request<TaskSegment>(`/projects/${projectId}/tasks/${taskId}/segments`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateSegment: (projectId: string, taskId: string, segmentId: string, data: unknown) =>
    request<TaskSegment>(`/projects/${projectId}/tasks/${taskId}/segments/${segmentId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteSegment: (projectId: string, taskId: string, segmentId: string) =>
    request<void>(`/projects/${projectId}/tasks/${taskId}/segments/${segmentId}`, {
      method: "DELETE",
    }),

  // Assignments
  listAssignments: (projectId: string, taskId: string, segmentId: string) =>
    request<SegmentAssignment[]>(`/projects/${projectId}/tasks/${taskId}/segments/${segmentId}/assignments`),
  upsertAssignment: (projectId: string, taskId: string, segmentId: string, data: {
    resourceId: string;
    allocationMode: "PERCENT" | "HOURS";
    allocationPercent?: number;
    allocationHoursPerDay?: number;
    contributionWeight?: number;
  }) =>
    request<SegmentAssignment>(`/projects/${projectId}/tasks/${taskId}/segments/${segmentId}/assignments`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  removeAssignment: (projectId: string, taskId: string, segmentId: string, resourceId: string) =>
    request<void>(
      `/projects/${projectId}/tasks/${taskId}/segments/${segmentId}/assignments/${resourceId}`,
      { method: "DELETE" },
    ),
  // 자원-기여도-진척률: 자원 본인 진척률 갱신
  updateAssignmentProgress: (projectId: string, taskId: string, segmentId: string, resourceId: string, data: {
    progressPercent: number;
    changeReason?: string;
  }) =>
    request<SegmentAssignment>(
      `/projects/${projectId}/tasks/${taskId}/segments/${segmentId}/assignments/${resourceId}/progress`,
      { method: "PATCH", body: JSON.stringify(data) },
    ),

  // Dependencies
  listDependencies: (projectId: string, taskId: string) =>
    request<any>(`/projects/${projectId}/tasks/${taskId}/dependencies`),
  addDependency: (projectId: string, taskId: string, data: {
    predecessorId: string;
    type?: string;
    lagDays?: number;
  }) =>
    request<any>(`/projects/${projectId}/tasks/${taskId}/dependencies`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  removeDependency: (projectId: string, taskId: string, predecessorId: string) =>
    request<void>(`/projects/${projectId}/tasks/${taskId}/dependencies/${predecessorId}`, {
      method: "DELETE",
    }),

  // History
  history: (projectId: string, taskId: string) =>
    request<any[]>(`/projects/${projectId}/tasks/${taskId}/history`),
};

// ─── Comments ────────────────────────────────────────────────────────────────

export const commentApi = {
  list: (taskId: string) => request<TaskComment[]>(`/tasks/${taskId}/comments`),
  create: (taskId: string, content: string) =>
    request<TaskComment>(`/tasks/${taskId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  update: (taskId: string, commentId: string, content: string) =>
    request<TaskComment>(`/tasks/${taskId}/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),
  delete: (taskId: string, commentId: string) =>
    request<void>(`/tasks/${taskId}/comments/${commentId}`, { method: "DELETE" }),
};

// ─── Task Attachments (파일/이미지) ───────────────────────────────────────────

export interface TaskAttachment {
  id: string;
  taskId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  category: "FILE" | "IMAGE";
  uploadedBy: string;
  createdAt: string;
}

export const taskAttachmentApi = {
  list: (taskId: string) => request<TaskAttachment[]>(`/tasks/${taskId}/attachments`),
  upload: async (taskId: string, file: File, category: "FILE" | "IMAGE"): Promise<TaskAttachment> => {
    const headers: Record<string, string> = {};
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API_PREFIX}/tasks/${taskId}/attachments?category=${category}`, {
      method: "POST",
      headers,
      body: fd,
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message ?? err.message ?? "업로드에 실패했습니다.");
    }
    return res.json();
  },
  // 다운로드·삭제는 /tasks/* 하위로 — /attachments/* 는 프록시가 auth-service(게시판)로 보냄
  delete: (taskId: string, attachmentId: string) =>
    request<void>(`/tasks/${taskId}/attachments/${attachmentId}`, { method: "DELETE" }),
  downloadUrl: (taskId: string, attachmentId: string) =>
    `${API_PREFIX}/tasks/${taskId}/attachments/${attachmentId}/download`,
};

// ─── Resources ───────────────────────────────────────────────────────────────

export const resourceGroupApi = {
  list: () => request<any[]>("/resources/groups"),
  create: (data: { name: string; description?: string; parentId?: string; sortOrder?: number }) =>
    request<any>("/resources/groups", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; description?: string; parentId?: string | null; sortOrder?: number }) =>
    request<any>(`/resources/groups/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/resources/groups/${id}`, { method: "DELETE" }),
  setMembers: (id: string, resourceIds: string[]) =>
    request<void>(`/resources/groups/${id}/members`, { method: "PUT", body: JSON.stringify({ resourceIds }) }),
};

// Phase 5 (2026-05-13): legacy Resource CRUD 폐기.
// list/create/update는 noop stub. utilization/dashboard/heatmap은 polymorphic ID로 동작 (서버 잔존).
export const resourceApi = {
  list: async (_params?: { type?: string; isActive?: boolean }) => [] as any[],
  create: async (_data: any) => { throw new Error("legacy Resource는 폐기되었습니다."); },
  update: async (_id: string, _data: any) => { throw new Error("legacy Resource는 폐기되었습니다."); },
  utilization: (id: string, startDate: string, endDate: string) =>
    request<any>(`/resources/${id}/utilization?startDate=${startDate}&endDate=${endDate}`),
  dashboard: (startDate: string, endDate: string) =>
    request<any[]>(`/resources/dashboard?startDate=${startDate}&endDate=${endDate}`),
  heatmap: (startDate: string, endDate: string, granularity = "week") =>
    request<any>(`/resources/heatmap?startDate=${startDate}&endDate=${endDate}&granularity=${granularity}`),
};

// 자원-모델-분리 PDCA Phase 3b-1: 비인력 자원 API
export const equipmentResourceApi = {
  list: (params?: { type?: "EQUIPMENT" | "VEHICLE" | "FACILITY"; isActive?: boolean; search?: string }) => {
    const q = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
    return request<EquipmentResource[]>(`/equipment-resources${q ? `?${q}` : ""}`);
  },
  get: (id: string) => request<EquipmentResource>(`/equipment-resources/${id}`),
  create: (data: { name: string; type?: "EQUIPMENT" | "VEHICLE" | "FACILITY"; isActive?: boolean }) =>
    request<EquipmentResource>("/equipment-resources", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; type?: "EQUIPMENT" | "VEHICLE" | "FACILITY"; isActive?: boolean }) =>
    request<EquipmentResource>(`/equipment-resources/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/equipment-resources/${id}`, { method: "DELETE" }),
  // 수동 정렬 순서 저장 (관리화면 ▲▼ → 예약 목록 반영)
  reorder: (orderedIds: string[]) =>
    request<void>("/equipment-resources/reorder", { method: "PATCH", body: JSON.stringify({ orderedIds }) }),
};

export interface EquipmentResource {
  id: string;
  name: string;
  type: "EQUIPMENT" | "VEHICLE" | "FACILITY";  // EQUIPMENT는 폐기됨 (2026-05-05). 신규 등록은 VEHICLE/FACILITY만
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// 공용자산예약 (2026-05-05) — Reservation API
export interface ReservationRecurrence {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval?: number;
  byWeekday?: Array<"MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN">;
  until?: string;  // YYYY-MM-DD
  count?: number;
}

export interface ReservationInstance {
  id: string;
  parentId: string | null;
  instanceKey: string;
  resourceId: string;
  resourceName: string;
  userId: string;
  userName: string | null;
  title: string;
  description: string | null;
  startAt: string;  // ISO UTC
  endAt: string;
  isAllDay: boolean;
  isRecurring: boolean;
  isException: boolean;
  recurrenceSummary: string;
  status: "CONFIRMED" | "CANCELED";
}

export interface ReservationCreateInput {
  resourceId: string;
  title: string;
  description?: string | null;
  startAt: string;  // ISO UTC
  endAt: string;
  isAllDay?: boolean;
  recurrence?: ReservationRecurrence | null;
}

export interface ReservationUpdateInput {
  title?: string;
  description?: string | null;
  startAt?: string;
  endAt?: string;
  isAllDay?: boolean;
  recurrence?: ReservationRecurrence | null;
}

export const equipmentReservationApi = {
  list: (params: { from?: string; to?: string; resourceId?: string; userId?: string }) => {
    const q = new URLSearchParams();
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    if (params.resourceId) q.set("resourceId", params.resourceId);
    if (params.userId) q.set("userId", params.userId);
    const qs = q.toString();
    return request<ReservationInstance[]>(`/equipment-reservations${qs ? `?${qs}` : ""}`);
  },
  mine: (params?: { upcoming?: boolean; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.upcoming !== undefined) q.set("upcoming", String(params.upcoming));
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<ReservationInstance[]>(`/equipment-reservations/mine${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => request<ReservationInstance>(`/equipment-reservations/${id}`),
  create: (data: ReservationCreateInput) =>
    request<ReservationInstance>(`/equipment-reservations`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: ReservationUpdateInput, scope: "instance" | "series" = "series") =>
    request<ReservationInstance>(`/equipment-reservations/${id}?scope=${scope}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  cancel: (
    id: string,
    opts: { scope?: "instance" | "series"; instanceStartAt?: string; cancelReason?: string } = {},
  ) => {
    const q = new URLSearchParams();
    q.set("scope", opts.scope ?? "series");
    if (opts.instanceStartAt) q.set("instanceStartAt", opts.instanceStartAt);
    return request<{ canceled: true; scope: string; instanceStartAt?: string }>(
      `/equipment-reservations/${id}?${q.toString()}`,
      {
        method: "DELETE",
        body: opts.cancelReason ? JSON.stringify({ cancelReason: opts.cancelReason }) : undefined,
      },
    );
  },
};

// 자원-모델-분리 PDCA Phase 3b-1: 외부 자원 API
export const externalPersonApi = {
  list: (params?: { status?: "ACTIVE" | "ARCHIVED"; company?: string; search?: string }) => {
    const q = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
    return request<ExternalPerson[]>(`/external-persons${q ? `?${q}` : ""}`);
  },
  get: (id: string) => request<ExternalPerson>(`/external-persons/${id}`),
  create: (data: {
    name: string;
    company?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    contractStart?: string | null;
    contractEnd?: string | null;
    notes?: string | null;
  }) => request<ExternalPerson>("/external-persons", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{
    name: string;
    company: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    status: "ACTIVE" | "ARCHIVED";
    contractStart: string | null;
    contractEnd: string | null;
    notes: string | null;
  }>) => request<ExternalPerson>(`/external-persons/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  archive: (id: string, contractEnd?: string) =>
    request<ExternalPerson>(`/external-persons/${id}/archive`, {
      method: "POST",
      body: JSON.stringify(contractEnd ? { contractEnd } : {}),
    }),
  reactivate: (id: string) =>
    request<ExternalPerson>(`/external-persons/${id}/reactivate`, { method: "POST" }),
  delete: (id: string) => request<void>(`/external-persons/${id}`, { method: "DELETE" }),
};

export interface ExternalPerson {
  id: string;
  name: string;
  company: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: "ACTIVE" | "ARCHIVED";
  contractStart: string | null;
  contractEnd: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Baselines ───────────────────────────────────────────────────────────────

export const baselineApi = {
  list: (projectId: string) =>
    request<any[]>(`/projects/${projectId}/baselines`),
  create: (projectId: string, data: { name: string; reason: string }) =>
    request<any>(`/projects/${projectId}/baselines`, { method: "POST", body: JSON.stringify(data) }),
  get: (projectId: string, baselineId: string) =>
    request<any>(`/projects/${projectId}/baselines/${baselineId}`),
  delete: (projectId: string, baselineId: string) =>
    request<void>(`/projects/${projectId}/baselines/${baselineId}`, { method: "DELETE" }),
  diff: (projectId: string, baselineId: string) =>
    request<any>(`/projects/${projectId}/baselines/${baselineId}/diff`),
};

// ─── Templates ───────────────────────────────────────────────────────────────

export const templateApi = {
  list: (params?: { category?: string; scope?: string }) => {
    const q = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
    return request<ProjectTemplate[]>(`/templates${q ? `?${q}` : ""}`);
  },
  get: (id: string) => request<any>(`/templates/${id}`),
  update: (id: string, data: { name?: string; description?: string; category?: string; tags?: string[]; scope?: string; isRecommended?: boolean }) =>
    request<any>(`/templates/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/templates/${id}`, { method: "DELETE" }),
  preview: (id: string, data: { startDate: string }) =>
    request<any>(`/templates/${id}/preview`, { method: "POST", body: JSON.stringify(data) }),
  instantiate: (id: string, data: {
    projectName: string;
    startDate: string;
    includeAssignments: boolean;
  }) =>
    request<any>(`/templates/${id}/instantiate`, { method: "POST", body: JSON.stringify(data) }),
  saveAsTemplate: (projectId: string, data: {
    name: string;
    category: string;
    tags?: string[];
    scope?: string;
    includeAssignments: boolean;
  }) =>
    request<any>(`/projects/${projectId}/save-as-template`, { method: "POST", body: JSON.stringify(data) }),
};

// ─── Impact ──────────────────────────────────────────────────────────────────

export const impactApi = {
  // 현재 상태 분석 — 실제 지연 태스크 자동 탐지 (입력 불필요)
  analyze: (projectId: string) => request<any>(`/projects/${projectId}/impact`),
  // What-If — 가정 지연 입력
  whatIf: (projectId: string, data: { taskId: string; delayDays: number }) =>
    request<any>(`/projects/${projectId}/whatif`, { method: "POST", body: JSON.stringify(data) }),
};

// ─── Notifications ───────────────────────────────────────────────────────────

export const notificationApi = {
  list: (params?: { unreadOnly?: boolean; page?: number; pageSize?: number }) => {
    const q = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
    return request<{ items: Notification[]; total: number; page: number; pageSize: number }>(
      `/notifications${q ? `?${q}` : ""}`,
    );
  },
  unreadCount: () => request<{ count: number }>("/notifications/unread-count"),
  markRead: (id: string) =>
    request<any>(`/notifications/${id}/read`, { method: "PATCH", body: "{}" }),
  markAllRead: () =>
    request<any>(`/notifications/read-all`, { method: "PATCH", body: "{}" }),
};

// ─── My Tasks ────────────────────────────────────────────────────────────────

export const myTasksApi = {
  list: () => request<any[]>("/tasks/mine"),
};

// ─── Me (project-service) ─────────────────────────────────────────────────────

export const meApi = {
  getKanban: (date?: string) =>
    request<any>(`/me/kanban${date ? `?date=${date}` : ""}`),
  getWeekCalendar: (date?: string) =>
    request<any>(`/me/week-calendar${date ? `?date=${date}` : ""}`),
  getProjects: () => request<any[]>("/me/projects"),
  getStaleSegments: (staleDays = 3) =>
    request<any[]>(`/me/stale-segments?staleDays=${staleDays}`),
  updateSegmentProgress: (segmentId: string, data: { progressPercent: number; changeReason?: string }) =>
    request<TaskSegment>(`/me/segments/${segmentId}/progress`, { method: "PATCH", body: JSON.stringify(data) }),
};

// ─── Attendance ───────────────────────────────────────────────────────────────

export const attendanceApi = {
  getToday: () => request<any>("/attendance/today"),
  checkIn: (data: { workType?: string; note?: string }) =>
    request<any>("/attendance/check-in", { method: "POST", body: JSON.stringify(data) }),
  checkOut: () => request<any>("/attendance/check-out", { method: "POST", body: "{}" }),
  breakOut: () => request<any>("/attendance/break-out", { method: "POST", body: "{}" }),
  breakIn: () => request<any>("/attendance/break-in", { method: "POST", body: "{}" }),
  getCalendar: (year: number, month: number) =>
    request<any>(`/attendance/calendar?year=${year}&month=${month}`),
  getSummary: (year: number, month: number) =>
    request<any>(`/attendance/summary?year=${year}&month=${month}`),
};

// ─── Work Schedule ────────────────────────────────────────────────────────────

export const workScheduleApi = {
  listAll: () => request<any[]>("/policy/work-schedules"),
  // 본인 유효 근무시간(개인 유연근무 설정 우선, 없으면 회사 기본) — 근태 입력 기본값용
  mine: () => request<{ workStartTime: string; workEndTime: string; dailyWorkHours: number; source: string }>("/policy/work-schedule/me"),
  get: (userId: string) => request<any>(`/policy/work-schedule/${userId}`),
  set: (userId: string, data: { workStartTime: string; workEndTime: string; dailyWorkHours?: number }) =>
    request<any>(`/policy/work-schedule/${userId}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (userId: string) =>
    request<any>(`/policy/work-schedule/${userId}`, { method: "DELETE" }),
};

// ─── Attendance Overview (근태현황) ──────────────────────────────────────────

export const attendanceOverviewApi = {
  getWeekly: (start: string, end: string) =>
    request<any>(`/work-schedule?start=${start}&end=${end}`),
  reorderMembers: (departmentId: string, orderedUserIds: string[]) =>
    request<any>("/work-schedule/members/reorder", { method: "PATCH", body: JSON.stringify({ departmentId, orderedUserIds }) }),
  createEntry: (data: { date: string; entryType: string; startTime?: string; endTime?: string; label?: string; groupId?: string }) =>
    request<WorkScheduleEntry>("/work-schedule", { method: "POST", body: JSON.stringify(data) }),
  updateEntry: (id: string, data: { entryType?: string; startTime?: string; endTime?: string; label?: string }) =>
    request<WorkScheduleEntry>(`/work-schedule/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteEntry: (id: string) =>
    request<void>(`/work-schedule/${id}`, { method: "DELETE" }),
  updateGroup: (groupId: string, data: { entryType?: string; startTime?: string; endTime?: string; label?: string }) =>
    request<any>(`/work-schedule/group/${groupId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteGroup: (groupId: string) =>
    request<any>(`/work-schedule/group/${groupId}`, { method: "DELETE" }),
};

// ─── Attendance Admin (관리>근태현황 — ecount 결재 확인) ────────────────────

export interface ApprovalCheckRow {
  kind: "LEAVE" | "HOLIDAY_WORK";
  id: string;
  userId: string;
  userName: string;
  departmentName: string | null;
  type: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  days: number | null;
  status: string;
  ecountCheckedAt: string | null;
  ecountCheckedById: string | null;
  ecountCheckedByName: string | null;
}

export const attendanceAdminApi = {
  listApprovalChecks: (year: number, month: number) =>
    request<{ year: number; month: number; total: number; unchecked: number; rows: ApprovalCheckRow[] }>(
      `/attendance-admin/approval-checks?year=${year}&month=${month}`),
  setEcountCheck: (kind: "LEAVE" | "HOLIDAY_WORK", id: string, checked: boolean) =>
    request<{ id: string; ecountCheckedAt: string | null; ecountCheckedById: string | null }>(
      `/attendance-admin/approval-checks/${kind === "LEAVE" ? "leave" : "holiday-work"}/${id}/ecount`,
      { method: "PATCH", body: JSON.stringify({ checked }) }),
};

// ─── Leave ────────────────────────────────────────────────────────────────────

export const leaveApi = {
  getBalance: () => request<LeaveBalance>("/leave/balance"),
  // ADMIN
  adminGetBalance: (userId: string, year?: number) =>
    request<LeaveBalance>(`/leave/balance/${userId}${year ? `?year=${year}` : ""}`),
  adminSetBalance: (userId: string, year: number, data: { totalDays?: number; longServiceDays?: number; adjustedDays?: number }) =>
    request<LeaveBalance>(`/leave/balance/${userId}?year=${year}`, { method: "PATCH", body: JSON.stringify(data) }),
  list: (params?: { status?: string; year?: number }) => {
    const q = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
    return request<LeaveRequest[]>(`/leave/requests${q ? `?${q}` : ""}`);
  },
  create: (data: { type: string; startDate: string; endDate: string; reason: string; startTime?: string; approverId?: string; direct?: boolean }) =>
    request<LeaveRequest>("/leave/requests", { method: "POST", body: JSON.stringify(data) }),
  cancel: (id: string) =>
    request<LeaveRequest>(`/leave/requests/${id}/cancel`, { method: "PATCH", body: "{}" }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/leave/requests/${id}`, { method: "DELETE" }),
};

// ─── Holiday Work (휴일근무 신청, 구 OT) ───────────────────────────────────────

export const holidayWorkApi = {
  list: (status?: string) =>
    request<HolidayWorkRequest[]>(`/holiday-work/requests${status ? `?status=${status}` : ""}`),
  create: (data: { date: string; reason: string; projectId?: string; taskId?: string; approverId?: string; direct?: boolean }) =>
    request<HolidayWorkRequest>("/holiday-work/requests", { method: "POST", body: JSON.stringify(data) }),
  cancel: (id: string) =>
    request<HolidayWorkRequest>(`/holiday-work/requests/${id}/cancel`, { method: "PATCH", body: "{}" }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/holiday-work/requests/${id}`, { method: "DELETE" }),
};

// ─── Team (Manager) ──────────────────────────────────────────────────────────

export const teamApi = {
  getAttendance: (year: number, month: number) =>
    request<any[]>(`/team/attendance?year=${year}&month=${month}`),
  getPendingLeave: () => request<LeaveRequest[]>("/leave/pending"),
  getPendingHolidayWork: () => request<HolidayWorkRequest[]>("/holiday-work/pending"),
  approveLeave: (id: string) =>
    request<LeaveRequest>(`/leave/requests/${id}/approve`, { method: "POST", body: "{}" }),
  rejectLeave: (id: string, rejectReason: string) =>
    request<LeaveRequest>(`/leave/requests/${id}/reject`, { method: "POST", body: JSON.stringify({ rejectReason }) }),
  approveHolidayWork: (id: string) =>
    request<HolidayWorkRequest>(`/holiday-work/requests/${id}/approve`, { method: "POST", body: "{}" }),
  rejectHolidayWork: (id: string, rejectReason: string) =>
    request<HolidayWorkRequest>(`/holiday-work/requests/${id}/reject`, { method: "POST", body: JSON.stringify({ rejectReason }) }),
};

// ─── My Profile ──────────────────────────────────────────────────────────────

export const myProfileApi = {
  get: () => request<User>("/auth/me"),
  getProfile: (id: string) => request<User>(`/users/${id}/profile`),
  updateProfile: (id: string, data: {
    phoneOffice?: string | null;
    phoneMobile?: string | null;
    address?: string | null;
  }) => request<User>(`/users/${id}/profile`, { method: "PATCH", body: JSON.stringify(data) }),
  changeName: (name: string) =>
    request<User>("/auth/me", { method: "PATCH", body: JSON.stringify({ name }) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/auth/me/password", { method: "PATCH", body: JSON.stringify({ currentPassword, newPassword }) }),
};

// ─── Auth ────────────────────────────────────────────────────────────────────

export const authApi = {
  // 보안 일괄패치 PDCA Layer 3 (C1): 응답 본문에서 accessToken 제거 (cookie로만)
  login: async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // Set-Cookie 수신 + 기존 deviceId cookie 전송
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message ?? (typeof data?.error === "string" ? data.error : null) ?? "로그인 실패";
      throw new Error(msg);
    }
    return data as { user: { id: string; email: string; name: string; role: string; isTeamLeader?: boolean } };
  },
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<User>("/auth/me"),
};

export const departmentApi = {
  // includeHidden=true는 관리 화면 전용 (숨김 부서 포함). 일반 픽커는 인자 없이 호출.
  list: (includeHidden?: boolean) =>
    request<Department[]>(`/departments${includeHidden ? "?includeHidden=true" : ""}`),
  create: (data: { name: string; code: string; level?: number; sortOrder?: number }) =>
    request<Department>("/departments", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; headUserId?: string | null; parentId?: string | null; soukwalUserId?: string | null; daepyoUserId?: string | null; sortOrder?: number; hiddenFromMenus?: boolean }) =>
    request<Department>(`/departments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/departments/${id}`, { method: "DELETE" }),
  getById: (id: string) => request<Department>(`/departments/${id}`),
};

export const approvalLineApi = {
  list: () => request<ApprovalLine[]>("/approval-lines"),
  getMe: () => request<ApprovalLine | null>("/approval-lines/me"),
  getByUser: (userId: string) => request<ApprovalLine | null>(`/approval-lines/${userId}`),
  upsert: (data: { userId: string; approverId: string; secondApproverId?: string | null; thirdApproverId?: string | null }) =>
    request<ApprovalLine>("/approval-lines", { method: "POST", body: JSON.stringify(data) }),
  remove: (userId: string) => request<void>(`/approval-lines/${userId}`, { method: "DELETE" }),
  bulkByDepartment: (departmentId: string) =>
    request<void>("/approval-lines/bulk-by-department", { method: "POST", body: JSON.stringify({ departmentId }) }),
  bulkAll: () =>
    request<void>("/approval-lines/bulk-all", { method: "POST", body: JSON.stringify({}) }),
};

export const userManagementApi = {
  list: (opts?: { includeRetired?: boolean }) => {
    const q = opts?.includeRetired ? "?includeRetired=true" : "";
    return request<{ items: User[]; total: number }>(`/users${q}`);
  },
  members: (all?: boolean) => request<{ id: string; name: string }[]>(`/users/members${all ? "?all=true" : ""}`),
  create: (data: { email: string; name: string; password: string; role: string }) =>
    request<User>("/users", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; role?: string; isActive?: boolean }) =>
    request<User>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  resetPassword: (id: string, newPassword: string) =>
    request<void>(`/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword }) }),
  getProfile: (id: string) => request<User>(`/users/${id}/profile`),
  upsertProfile: (id: string, data: {
    phoneOffice?: string | null;
    phoneMobile?: string | null;
    address?: string | null;
    departmentId?: string | null;
    departmentName?: string | null;
  }) => request<User>(`/users/${id}/profile`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/users/${id}`, { method: "DELETE" }),
  // 자원-모델-분리 PDCA Phase 3b-1: 직원 라이프사이클
  retire: (id: string, retirementDate?: string) =>
    request<User>(`/users/${id}/retire`, {
      method: "POST",
      body: JSON.stringify(retirementDate ? { retirementDate } : {}),
    }),
  reactivate: (id: string) =>
    request<User>(`/users/${id}/reactivate`, { method: "POST" }),
  updateStatus: (id: string, data: { status: "ACTIVE" | "RETIRED" | "SUSPENDED"; retirementDate?: string | null }) =>
    request<User>(`/users/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
};

// ─── 자원-모델-분리 PDCA Phase 3b-6: 통합 자원 picker용 ────────────────────
//   직원 (auth_users, status=ACTIVE) + 외부 (status=ACTIVE) + 비인력 (isActive=true) 합산
export interface AssignableResource {
  id: string;
  name: string;
  category: "PERSON" | "EXTERNAL" | "EQUIPMENT";
  type?: string;
  email?: string | null;
  company?: string | null;
  isActive: boolean;
}

export async function listAssignableResources(): Promise<AssignableResource[]> {
  // 공용자산 정리 (2026-05-05): EquipmentResource는 프로젝트 미연계 — 자원 popover에서 제외.
  // 직원(auth_users) + 외부 인력만 자원 배정 대상.
  const [users, externals] = await Promise.all([
    // 자원 배정 대상 = 활성 전직원. GET /users는 ADMIN 전용이라 OPERATOR는 403 → 전 사용자 허용인
    // /users/members?all=true (활성 전직원 id+name) 사용. (기존엔 operator가 외부인력만 보였음)
    userManagementApi.members(true).catch(() => [] as { id: string; name: string }[]),
    externalPersonApi.list({ status: "ACTIVE" }).catch(() => [] as ExternalPerson[]),
  ]);
  const out: AssignableResource[] = [];
  for (const u of users) {
    out.push({ id: u.id, name: u.name, category: "PERSON", type: "PERSON", isActive: true });
  }
  for (const e of externals) {
    out.push({ id: e.id, name: e.name, category: "EXTERNAL", type: "PERSON", company: e.company, isActive: true });
  }
  return out;
}

// ─── Dashboard (지휘센터) ─────────────────────────────────────────────────────

export const dashboardApi = {
  get: (params?: { groupBy?: string; date?: string; issueFilter?: string }) => {
    const q = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
    return request<any>(`/dashboard${q ? `?${q}` : ""}`);
  },
  getSummary: (date?: string) =>
    request<any>(`/dashboard/summary${date ? `?date=${date}` : ""}`),
  getSummaryDetails: (type: string, date?: string) => {
    const params = new URLSearchParams({ type });
    if (date) params.set("date", date);
    return request<any>(`/dashboard/summary/details?${params}`);
  },
  getProjectIssues: (projectId: string) =>
    request<any[]>(`/dashboard/projects/${projectId}/issues`),
  getProjectTimeline: (projectId: string, date?: string) =>
    request<any[]>(`/dashboard/projects/${projectId}/timeline${date ? `?date=${date}` : ""}`),
  getConfig: () => request<DashboardConfig>("/dashboard/config"),
  updateConfig: (data: { defaultGroupBy?: string; pinnedProjectIds?: string[]; issueFilter?: string; presentationMode?: boolean }) =>
    request<DashboardConfig>("/dashboard/config", { method: "PUT", body: JSON.stringify(data) }),
  getThresholds: () => request<any>("/dashboard/thresholds"),
  updateThresholds: (data: unknown) =>
    request<any>("/dashboard/thresholds", { method: "PUT", body: JSON.stringify(data) }),
  refreshProject: (projectId: string) =>
    request<any>(`/dashboard/projects/${projectId}/refresh`, { method: "POST", body: "{}" }),
  refreshAll: () =>
    request<any>("/dashboard/refresh-all", { method: "POST", body: "{}" }),
};

// ─── Activity Logs (전체 이력) ─────────────────────────────────────────────────

export const activityLogApi = {
  list: (params?: { page?: number; pageSize?: number; action?: string; userId?: string; search?: string }) => {
    const q = params ? new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))
    ).toString() : "";
    return request<{ items: ActivityLog[]; total: number; page: number; pageSize: number; totalPages: number }>(
      `/activities${q ? `?${q}` : ""}`,
    );
  },
};
