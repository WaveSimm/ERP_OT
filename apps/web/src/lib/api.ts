"use client";

// 보안 일괄패치 PDCA Layer 3
//   C1: accessToken localStorage 제거 → httpOnly cookie 사용 (서버 자동 set)
//   CSRF: csrfToken cookie를 JS로 읽어 X-CSRF-Token 헤더에 자동 첨부
//   silent refresh: 401 시 /api/v1/auth/refresh 시도 후 원 요청 재시도

const API_PREFIX = "/api/v1";

// ─── localStorage 호환 API (token은 더 이상 저장 안 함, user는 UX 캐시) ──
// 기존 호출처(login page 등) 호환을 위해 시그니처 유지

export function setToken(_token: string) {
  // C1: accessToken은 httpOnly cookie로 서버가 set. 클라이언트 저장 불필요.
  // 기존 erp_token localStorage 잔존분 정리
  if (typeof window !== "undefined") localStorage.removeItem("erp_token");
}

// 보안 일괄패치 PDCA 후 cookie 인증 전환 — getToken은 항상 null 반환 (헤더 미설정, cookie 자동 전송)
function getToken(): string | null {
  return null;
}

export function clearToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("erp_token");
    localStorage.removeItem("erp_user");
  }
}

export type CurrentUser = { id: string; name: string; role: string; isTeamLeader?: boolean };

export function setUser(user: CurrentUser) {
  if (typeof window !== "undefined") localStorage.setItem("erp_user", JSON.stringify(user));
}

export function getUser(): CurrentUser | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem("erp_user") ?? "null");
  } catch {
    return null;
  }
}

// ─── CSRF helper ─────────────────────────────────────────────────────────
function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.$?*|{}()\[\]\\\/+^]/g, "\\$&")}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

function getCsrfToken(): string | null {
  return readCookie("csrfToken");
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

let refreshInFlight: Promise<boolean> | null = null;

// silent refresh: 동시 다발 401을 단일 refresh로 해결
// 보안 PDCA Layer 3: 전용 /api/auth/refresh 라우트 사용 (catch-all proxy CSRF 우회)
//   refresh는 SameSite=strict cookie + reuse detection으로 CSRF 본질 차단
async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // 다음 401 사이클에 다시 시도 가능
      setTimeout(() => { refreshInFlight = null; }, 100);
    }
  })();
  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}, _isRetry = false): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const headers: Record<string, string> = {
    ...(init.body != null && { "Content-Type": "application/json" }),
    ...(init.headers as Record<string, string>),
  };

  // CSRF: state-changing 요청에 X-CSRF-Token 자동 첨부
  if (STATE_CHANGING_METHODS.has(method)) {
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }

  const res = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    headers,
    credentials: "include", // C1: cookie 자동 전송
    cache: "no-store",
  });

  // 401 silent refresh (refresh 자체 호출은 제외)
  if (res.status === 401 && !_isRetry && !path.startsWith("/auth/refresh") && !path.startsWith("/auth/login")) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return request<T>(path, init, true); // 한 번만 재시도
    }
    clearToken();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    // 새 에러 포맷 ({error: {code, message}}) + 기존 포맷 ({error: msg} 또는 {message}) 호환
    const msg = err?.error?.message ?? (typeof err?.error === "string" ? err.error : null) ?? err?.message ?? "API Error";
    throw new Error(msg);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Projects ────────────────────────────────────────────────────────────────

export const projectApi = {
  list: (params?: { search?: string; status?: string }) => {
    const q = new URLSearchParams(params as any).toString();
    return request<{ items: any[]; total: number; page: number; limit: number }>(
      `/projects${q ? `?${q}` : ""}`,
    );
  },
  get: (id: string) => request<any>(`/projects/${id}`),
  create: (data: { name: string; description?: string }) =>
    request<any>("/projects", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),
  gantt: (id: string) => request<any>(`/projects/${id}/gantt`),
  runCpm: (id: string) => request<any>(`/projects/${id}/cpm`, { method: "POST", body: "{}" }),
  activities: (id: string, page = 1) =>
    request<any>(`/projects/${id}/activities?page=${page}&pageSize=20`),
};

// ─── Folders ─────────────────────────────────────────────────────────────────

export const folderApi = {
  list: () => request<any[]>("/folders"),
  create: (data: { name: string; parentId?: string; sortOrder?: number }) =>
    request<any>("/folders", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; parentId?: string; sortOrder?: number }) =>
    request<any>(`/folders/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/folders/${id}`, { method: "DELETE" }),
  addProject: (folderId: string, projectId: string, sortOrder?: number) =>
    request<any>(`/folders/${folderId}/projects`, { method: "POST", body: JSON.stringify({ projectId, sortOrder }) }),
  removeProject: (folderId: string, projectId: string) =>
    request<void>(`/folders/${folderId}/projects/${projectId}`, { method: "DELETE" }),
  reorderProjects: (folderId: string, projectIds: string[]) =>
    request<any>(`/folders/${folderId}/reorder`, { method: "PATCH", body: JSON.stringify({ projectIds }) }),
  reorderFolders: (folderIds: string[]) =>
    request<any>("/folders/reorder", { method: "PATCH", body: JSON.stringify({ folderIds }) }),
};

// ─── Dependencies (Task ↔ Task) ────────────────────────────────────────────
// "마일스톤-시점태스크-회귀" PDCA에서 milestoneApi 폐기, dependencyApi 단순화

export const dependencyApi = {
  list: (projectId: string) =>
    request<any[]>(`/projects/${projectId}/dependencies`),
  create: (projectId: string, data: {
    predecessorTaskId: string;
    successorTaskId: string;
    dependencyType?: "FS" | "SS" | "FF" | "SF";
    lag?: number;
  }) =>
    request<any>(`/projects/${projectId}/dependencies`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<void>(`/dependencies/${id}`, { method: "DELETE" }),
};

// ─── Tasks ───────────────────────────────────────────────────────────────────

export const taskApi = {
  list: (projectId: string) => request<any[]>(`/projects/${projectId}/tasks`),
  get: (projectId: string, taskId: string) =>
    request<any>(`/projects/${projectId}/tasks/${taskId}`),
  create: (projectId: string, data: any) =>
    request<any>(`/projects/${projectId}/tasks`, { method: "POST", body: JSON.stringify(data) }),
  update: (projectId: string, taskId: string, data: any) =>
    request<any>(`/projects/${projectId}/tasks/${taskId}`, {
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
  createSegment: (projectId: string, taskId: string, data: any) =>
    request<any>(`/projects/${projectId}/tasks/${taskId}/segments`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateSegment: (projectId: string, taskId: string, segmentId: string, data: any) =>
    request<any>(`/projects/${projectId}/tasks/${taskId}/segments/${segmentId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteSegment: (projectId: string, taskId: string, segmentId: string) =>
    request<void>(`/projects/${projectId}/tasks/${taskId}/segments/${segmentId}`, {
      method: "DELETE",
    }),

  // Assignments
  listAssignments: (projectId: string, taskId: string, segmentId: string) =>
    request<any[]>(`/projects/${projectId}/tasks/${taskId}/segments/${segmentId}/assignments`),
  upsertAssignment: (projectId: string, taskId: string, segmentId: string, data: {
    resourceId: string;
    allocationMode: "PERCENT" | "HOURS";
    allocationPercent?: number;
    allocationHoursPerDay?: number;
  }) =>
    request<any>(`/projects/${projectId}/tasks/${taskId}/segments/${segmentId}/assignments`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  removeAssignment: (projectId: string, taskId: string, segmentId: string, resourceId: string) =>
    request<void>(
      `/projects/${projectId}/tasks/${taskId}/segments/${segmentId}/assignments/${resourceId}`,
      { method: "DELETE" },
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
  list: (taskId: string) => request<any[]>(`/tasks/${taskId}/comments`),
  create: (taskId: string, content: string) =>
    request<any>(`/tasks/${taskId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  update: (taskId: string, commentId: string, content: string) =>
    request<any>(`/tasks/${taskId}/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),
  delete: (taskId: string, commentId: string) =>
    request<void>(`/tasks/${taskId}/comments/${commentId}`, { method: "DELETE" }),
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

export const resourceApi = {
  // ⚠️ deprecated (자원-모델-분리 PDCA): list/create/update는 Phase 4까지 호환만 유지.
  //    신규: equipmentResourceApi (비인력) + externalPersonApi (외부) + userApi (직원)
  list: (params?: { type?: string; isActive?: boolean }) => {
    const q = params ? new URLSearchParams(params as any).toString() : "";
    return request<any[]>(`/resources${q ? `?${q}` : ""}`);
  },
  create: (data: { name: string; type?: string; dailyCapacityHours?: number; groupId?: string }) =>
    request<any>("/resources", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/resources/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  // 통합 dashboard/utilization은 그대로 유지 (3그룹 통합 응답)
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
    const q = params ? new URLSearchParams(params as any).toString() : "";
    return request<EquipmentResource[]>(`/equipment-resources${q ? `?${q}` : ""}`);
  },
  get: (id: string) => request<EquipmentResource>(`/equipment-resources/${id}`),
  create: (data: { name: string; type?: "EQUIPMENT" | "VEHICLE" | "FACILITY"; isActive?: boolean }) =>
    request<EquipmentResource>("/equipment-resources", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; type?: "EQUIPMENT" | "VEHICLE" | "FACILITY"; isActive?: boolean }) =>
    request<EquipmentResource>(`/equipment-resources/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/equipment-resources/${id}`, { method: "DELETE" }),
};

export interface EquipmentResource {
  id: string;
  name: string;
  type: "EQUIPMENT" | "VEHICLE" | "FACILITY";  // EQUIPMENT는 폐기됨 (2026-05-05). 신규 등록은 VEHICLE/FACILITY만
  isActive: boolean;
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
    request<any>(`/equipment-reservations`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: ReservationUpdateInput, scope: "instance" | "series" = "series") =>
    request<any>(`/equipment-reservations/${id}?scope=${scope}`, {
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
    const q = params ? new URLSearchParams(params as any).toString() : "";
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
    const q = params ? new URLSearchParams(params as any).toString() : "";
    return request<any[]>(`/templates${q ? `?${q}` : ""}`);
  },
  get: (id: string) => request<any>(`/templates/${id}`),
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
  analyze: (projectId: string, params?: { taskId?: string; delayDays?: number }) => {
    const q = params ? new URLSearchParams(params as any).toString() : "";
    return request<any>(`/projects/${projectId}/impact${q ? `?${q}` : ""}`);
  },
  whatIf: (projectId: string, data: { taskId: string; delayDays: number }) =>
    request<any>(`/projects/${projectId}/whatif`, { method: "POST", body: JSON.stringify(data) }),
};

// ─── Notifications ───────────────────────────────────────────────────────────

export const notificationApi = {
  list: (params?: { unreadOnly?: boolean; page?: number; pageSize?: number }) => {
    const q = params ? new URLSearchParams(params as any).toString() : "";
    return request<{ items: any[]; total: number; page: number; pageSize: number }>(
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
    request<any>(`/me/segments/${segmentId}/progress`, { method: "PATCH", body: JSON.stringify(data) }),
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
  createEntry: (data: { date: string; entryType: string; startTime?: string; endTime?: string; label?: string; groupId?: string }) =>
    request<any>("/work-schedule", { method: "POST", body: JSON.stringify(data) }),
  updateEntry: (id: string, data: { entryType?: string; startTime?: string; endTime?: string; label?: string }) =>
    request<any>(`/work-schedule/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteEntry: (id: string) =>
    request<void>(`/work-schedule/${id}`, { method: "DELETE" }),
  updateGroup: (groupId: string, data: { entryType?: string; startTime?: string; endTime?: string; label?: string }) =>
    request<any>(`/work-schedule/group/${groupId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteGroup: (groupId: string) =>
    request<any>(`/work-schedule/group/${groupId}`, { method: "DELETE" }),
};

// ─── Leave ────────────────────────────────────────────────────────────────────

export const leaveApi = {
  getBalance: () => request<any>("/leave/balance"),
  // ADMIN
  adminGetBalance: (userId: string, year?: number) =>
    request<any>(`/leave/balance/${userId}${year ? `?year=${year}` : ""}`),
  adminSetBalance: (userId: string, year: number, data: { totalDays?: number; longServiceDays?: number; adjustedDays?: number }) =>
    request<any>(`/leave/balance/${userId}?year=${year}`, { method: "PATCH", body: JSON.stringify(data) }),
  list: (params?: { status?: string; year?: number }) => {
    const q = params ? new URLSearchParams(params as any).toString() : "";
    return request<any[]>(`/leave/requests${q ? `?${q}` : ""}`);
  },
  create: (data: { type: string; startDate: string; endDate: string; reason: string; approverId?: string }) =>
    request<any>("/leave/requests", { method: "POST", body: JSON.stringify(data) }),
  cancel: (id: string) =>
    request<any>(`/leave/requests/${id}/cancel`, { method: "PATCH", body: "{}" }),
};

// ─── Holiday Work (휴일근무 신청, 구 OT) ───────────────────────────────────────

export const holidayWorkApi = {
  list: (status?: string) =>
    request<any[]>(`/holiday-work/requests${status ? `?status=${status}` : ""}`),
  create: (data: { date: string; reason: string; projectId?: string; taskId?: string; approverId?: string }) =>
    request<any>("/holiday-work/requests", { method: "POST", body: JSON.stringify(data) }),
  cancel: (id: string) =>
    request<any>(`/holiday-work/requests/${id}/cancel`, { method: "PATCH", body: "{}" }),
};

// ─── Team (Manager) ──────────────────────────────────────────────────────────

export const teamApi = {
  getAttendance: (year: number, month: number) =>
    request<any[]>(`/team/attendance?year=${year}&month=${month}`),
  getPendingLeave: () => request<any[]>("/leave/pending"),
  getPendingHolidayWork: () => request<any[]>("/holiday-work/pending"),
  approveLeave: (id: string) =>
    request<any>(`/leave/requests/${id}/approve`, { method: "POST", body: "{}" }),
  rejectLeave: (id: string, rejectReason: string) =>
    request<any>(`/leave/requests/${id}/reject`, { method: "POST", body: JSON.stringify({ rejectReason }) }),
  approveHolidayWork: (id: string) =>
    request<any>(`/holiday-work/requests/${id}/approve`, { method: "POST", body: "{}" }),
  rejectHolidayWork: (id: string, rejectReason: string) =>
    request<any>(`/holiday-work/requests/${id}/reject`, { method: "POST", body: JSON.stringify({ rejectReason }) }),
};

// ─── My Profile ──────────────────────────────────────────────────────────────

export const myProfileApi = {
  get: () => request<any>("/auth/me"),
  getProfile: (id: string) => request<any>(`/users/${id}/profile`),
  updateProfile: (id: string, data: {
    phoneOffice?: string | null;
    phoneMobile?: string | null;
  }) => request<any>(`/users/${id}/profile`, { method: "PATCH", body: JSON.stringify(data) }),
  changeName: (name: string) =>
    request<any>("/auth/me", { method: "PATCH", body: JSON.stringify({ name }) }),
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
    return data as { user: { id: string; email: string; name: string; role: string } };
  },
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<any>("/auth/me"),
};

export const departmentApi = {
  list: () => request<any[]>("/departments"),
  create: (data: { name: string; code: string; level?: number; sortOrder?: number }) =>
    request<any>("/departments", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; headUserId?: string | null; parentId?: string | null; soukwalUserId?: string | null; daepyoUserId?: string | null; sortOrder?: number }) =>
    request<any>(`/departments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/departments/${id}`, { method: "DELETE" }),
  getById: (id: string) => request<any>(`/departments/${id}`),
};

export const approvalLineApi = {
  list: () => request<any[]>("/approval-lines"),
  getMe: () => request<any>("/approval-lines/me"),
  getByUser: (userId: string) => request<any>(`/approval-lines/${userId}`),
  upsert: (data: { userId: string; approverId: string; secondApproverId?: string | null; thirdApproverId?: string | null }) =>
    request<any>("/approval-lines", { method: "POST", body: JSON.stringify(data) }),
  remove: (userId: string) => request<void>(`/approval-lines/${userId}`, { method: "DELETE" }),
  bulkByDepartment: (departmentId: string) =>
    request<void>("/approval-lines/bulk-by-department", { method: "POST", body: JSON.stringify({ departmentId }) }),
  bulkAll: () =>
    request<void>("/approval-lines/bulk-all", { method: "POST", body: JSON.stringify({}) }),
};

export const userManagementApi = {
  list: (opts?: { includeRetired?: boolean }) => {
    const q = opts?.includeRetired ? "?includeRetired=true" : "";
    return request<{ items: any[]; total: number }>(`/users${q}`);
  },
  members: (all?: boolean) => request<{ id: string; name: string }[]>(`/users/members${all ? "?all=true" : ""}`),
  create: (data: { email: string; name: string; password: string; role: string }) =>
    request<any>("/users", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; role?: string; isActive?: boolean }) =>
    request<any>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  resetPassword: (id: string, newPassword: string) =>
    request<void>(`/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword }) }),
  getProfile: (id: string) => request<any>(`/users/${id}/profile`),
  upsertProfile: (id: string, data: {
    phoneOffice?: string | null;
    phoneMobile?: string | null;
    address?: string | null;
    departmentId?: string | null;
    departmentName?: string | null;
  }) => request<any>(`/users/${id}/profile`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/users/${id}`, { method: "DELETE" }),
  // 자원-모델-분리 PDCA Phase 3b-1: 직원 라이프사이클
  retire: (id: string, retirementDate?: string) =>
    request<any>(`/users/${id}/retire`, {
      method: "POST",
      body: JSON.stringify(retirementDate ? { retirementDate } : {}),
    }),
  reactivate: (id: string) =>
    request<any>(`/users/${id}/reactivate`, { method: "POST" }),
  updateStatus: (id: string, data: { status: "ACTIVE" | "RETIRED" | "SUSPENDED"; retirementDate?: string | null }) =>
    request<any>(`/users/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
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
    userManagementApi.list().catch(() => ({ items: [] as any[] })),
    externalPersonApi.list({ status: "ACTIVE" }).catch(() => [] as ExternalPerson[]),
  ]);
  const out: AssignableResource[] = [];
  const userList: any[] = Array.isArray((users as any).items)
    ? (users as any).items
    : (Array.isArray(users) ? (users as any[]) : []);
  for (const u of userList) {
    if (u.status === "RETIRED" || u.isActive === false) continue;
    out.push({ id: u.id, name: u.name, category: "PERSON", type: "PERSON", email: u.email, isActive: true });
  }
  for (const e of externals) {
    out.push({ id: e.id, name: e.name, category: "EXTERNAL", type: "PERSON", company: e.company, isActive: true });
  }
  return out;
}

// ─── Dashboard (지휘센터) ─────────────────────────────────────────────────────

export const dashboardApi = {
  get: (params?: { groupBy?: string; date?: string; issueFilter?: string }) => {
    const q = params ? new URLSearchParams(params as any).toString() : "";
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
  getConfig: () => request<any>("/dashboard/config"),
  updateConfig: (data: { defaultGroupBy?: string; pinnedProjectIds?: string[]; issueFilter?: string; presentationMode?: boolean }) =>
    request<any>("/dashboard/config", { method: "PUT", body: JSON.stringify(data) }),
  getThresholds: () => request<any>("/dashboard/thresholds"),
  updateThresholds: (data: any) =>
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
    return request<{ items: any[]; total: number; page: number; pageSize: number; totalPages: number }>(
      `/activities${q ? `?${q}` : ""}`,
    );
  },
};

// ─── Equipment (장비 관리) ────────────────────────────────────────────────────

export const equipmentApi = {
  list: (params?: { categoryId?: string; status?: string; search?: string; page?: number; limit?: number }) => {
    const q = params ? new URLSearchParams(params as any).toString() : "";
    return request<{ items: any[]; total: number; page: number; limit: number }>(
      `/equipment${q ? `?${q}` : ""}`,
    );
  },
  get: (id: string) => request<any>(`/equipment/${id}`),
  create: (data: any) =>
    request<any>("/equipment", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/equipment/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  changeStatus: (id: string, status: string) =>
    request<any>(`/equipment/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  remove: (id: string) => request<void>(`/equipment/${id}`, { method: "DELETE" }),
  getMaintenance: (id: string, page = 1) =>
    request<any>(`/maintenance/equipment/${id}?page=${page}`),
  getSchedules: (id: string, startDate?: string, endDate?: string) => {
    const q = new URLSearchParams();
    if (startDate) q.set("startDate", startDate);
    if (endDate) q.set("endDate", endDate);
    return request<any[]>(`/schedules/equipment/${id}${q.toString() ? `?${q}` : ""}`);
  },
  getCompatibleSensors: (id: string) =>
    request<any[]>(`/compatibility/equipment/${id}`),
  getDeployments: (id: string) =>
    request<any>(`/deployments?equipmentId=${id}`),
  // 구성요소
  getComponents: (id: string) => request<any[]>(`/equipment/${id}/components`),
  addComponent: (id: string, data: { name: string; spec?: string; notes?: string }) =>
    request<any>(`/equipment/${id}/components`, { method: "POST", body: JSON.stringify(data) }),
  updateComponent: (compId: string, data: { name?: string; spec?: string; notes?: string }) =>
    request<any>(`/equipment/components/${compId}`, { method: "PUT", body: JSON.stringify(data) }),
  removeComponent: (compId: string) =>
    request<void>(`/equipment/components/${compId}`, { method: "DELETE" }),
};

export const sensorApi = {
  list: (params?: { categoryId?: string; status?: string; search?: string; page?: number; limit?: number }) => {
    const q = params ? new URLSearchParams(params as any).toString() : "";
    return request<{ items: any[]; total: number; page: number; limit: number }>(
      `/sensors${q ? `?${q}` : ""}`,
    );
  },
  listAvailable: (categoryId?: string, startDate?: string, endDate?: string) => {
    const q = new URLSearchParams();
    if (categoryId) q.set("categoryId", categoryId);
    if (startDate) q.set("startDate", startDate);
    if (endDate) q.set("endDate", endDate);
    const qs = q.toString();
    return request<any[]>(`/sensors/available${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => request<any>(`/sensors/${id}`),
  create: (data: any) =>
    request<any>("/sensors", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/sensors/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  changeStatus: (id: string, status: string) =>
    request<any>(`/sensors/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  remove: (id: string) => request<void>(`/sensors/${id}`, { method: "DELETE" }),
  getDeploymentHistory: (id: string) => request<any[]>(`/sensors/${id}/deployment-history`),
  getCompatibleEquipment: (id: string) =>
    request<any[]>(`/compatibility/sensor/${id}`),
  getDeployments: (id: string) =>
    request<any>(`/deployments?sensorId=${id}`),
  getMaintenance: (id: string, page = 1) =>
    request<any>(`/sensors/${id}/maintenance?page=${page}`),
  getSchedules: (id: string, startDate?: string, endDate?: string) => {
    const q = new URLSearchParams();
    if (startDate) q.set("startDate", startDate);
    if (endDate) q.set("endDate", endDate);
    return request<any[]>(`/schedules/sensor/${id}${q.toString() ? `?${q}` : ""}`);
  },
};

export const equipmentCategoryApi = {
  list: (type?: string) =>
    request<any[]>(`/categories${type ? `?type=${type}` : ""}`),
  create: (data: { name: string; type: string; description?: string; sortOrder?: number }) =>
    request<any>("/categories", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/categories/${id}`, { method: "DELETE" }),
};

export const maintenanceApi = {
  create: (data: any) =>
    request<any>("/maintenance", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/maintenance/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/maintenance/${id}`, { method: "DELETE" }),
};

export const equipmentScheduleApi = {
  getTimeline: (params: { startDate: string; endDate: string; assetType?: string; categoryId?: string }) => {
    const q = new URLSearchParams();
    q.set("startDate", params.startDate);
    q.set("endDate", params.endDate);
    if (params.assetType) q.set("assetType", params.assetType);
    if (params.categoryId) q.set("categoryId", params.categoryId);
    return request<any>(`/schedules/timeline?${q}`);
  },
  create: (data: any) =>
    request<any>("/schedules", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/schedules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/schedules/${id}`, { method: "DELETE" }),
};

export const deploymentApi = {
  list: (params?: { projectId?: string; equipmentId?: string; sensorId?: string; status?: string }) => {
    const q = params ? new URLSearchParams(params as any).toString() : "";
    return request<any>(`/deployments${q ? `?${q}` : ""}`);
  },
  listByTask: (taskId: string) => request<any[]>(`/deployments/by-task/${taskId}`),
  get: (id: string) => request<any>(`/deployments/${id}`),
  create: (data: any) =>
    request<any>("/deployments", { method: "POST", body: JSON.stringify(data) }),
  activate: (id: string) =>
    request<any>(`/deployments/${id}/activate`, { method: "POST", body: "{}" }),
  complete: (id: string) =>
    request<any>(`/deployments/${id}/complete`, { method: "POST", body: "{}" }),
  cancel: (id: string) =>
    request<any>(`/deployments/${id}/cancel`, { method: "POST", body: "{}" }),
  remove: (id: string) =>
    request<void>(`/deployments/${id}`, { method: "DELETE" }),
};

export const equipmentStatsApi = {
  summary: () => request<any>("/stats/summary"),
  utilization: (startDate: string, endDate: string) =>
    request<any[]>(`/stats/utilization?startDate=${startDate}&endDate=${endDate}`),
  maintenanceCosts: (startDate?: string, endDate?: string) => {
    const q = new URLSearchParams();
    if (startDate) q.set("startDate", startDate);
    if (endDate) q.set("endDate", endDate);
    return request<any[]>(`/stats/maintenance-costs${q.toString() ? `?${q}` : ""}`);
  },
  breakdownFrequency: (limit = 10) =>
    request<any[]>(`/stats/breakdown-frequency?limit=${limit}`),
  calibrationWarnings: () => request<any[]>("/stats/calibration-warnings"),
  preventiveDue: (days = 30) => request<any[]>(`/stats/preventive-due?days=${days}`),
};

export const deploymentTemplateApi = {
  list: (params?: { categoryId?: string }) => {
    const q = params ? new URLSearchParams(params as any).toString() : "";
    return request<any[]>(`/deployment-templates${q ? `?${q}` : ""}`);
  },
  get: (id: string) => request<any>(`/deployment-templates/${id}`),
  create: (data: { name: string; description?: string; categoryId?: string; sensorConfig: any; isPublic?: boolean }) =>
    request<any>("/deployment-templates", { method: "POST", body: JSON.stringify(data) }),
  saveFromDeployment: (deploymentId: string, data: { name: string; description?: string; isPublic?: boolean }) =>
    request<any>(`/deployment-templates/from-deployment/${deploymentId}`, { method: "POST", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/deployment-templates/${id}`, { method: "DELETE" }),
};

export const compatibilityApi = {
  create: (data: { equipmentId: string; sensorId: string; notes?: string }) =>
    request<any>("/compatibility", { method: "POST", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/compatibility/${id}`, { method: "DELETE" }),
};

// ─── Repair/AS Management API ────────────────────────────────────────────

export const repairApi = {
  // 고객
  getCustomers: (params?: { search?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<any>(`/customers${qs ? `?${qs}` : ""}`);
  },
  createCustomer: (data: any) =>
    request<any>("/customers", { method: "POST", body: JSON.stringify(data) }),
  getCustomer: (id: string) => request<any>(`/customers/${id}`),
  updateCustomer: (id: string, data: any) =>
    request<any>(`/customers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteCustomer: (id: string) =>
    request<void>(`/customers/${id}`, { method: "DELETE" }),

  // 고객 담당자
  getContacts: (customerId: string) =>
    request<any[]>(`/customers/${customerId}/contacts`),
  createContact: (customerId: string, data: any) =>
    request<any>(`/customers/${customerId}/contacts`, { method: "POST", body: JSON.stringify(data) }),
  updateContact: (contactId: string, data: any) =>
    request<any>(`/customers/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteContact: (contactId: string) =>
    request<void>(`/customers/contacts/${contactId}`, { method: "DELETE" }),

  // 고객 자산
  getCustomerAssets: (params?: { customerId?: string; search?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.customerId) q.set("customerId", params.customerId);
    if (params?.search) q.set("search", params.search);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<any>(`/customer-assets${qs ? `?${qs}` : ""}`);
  },
  getCustomerAsset: (id: string) => request<any>(`/customer-assets/${id}`),
  createCustomerAsset: (data: any) =>
    request<any>("/customer-assets", { method: "POST", body: JSON.stringify(data) }),
  updateCustomerAsset: (id: string, data: any) =>
    request<any>(`/customer-assets/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteCustomerAsset: (id: string) =>
    request<void>(`/customer-assets/${id}`, { method: "DELETE" }),

  // 수리 접수
  getRepairOrders: (params?: { status?: string; statusGroup?: string; customerId?: string; search?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.statusGroup) q.set("statusGroup", params.statusGroup);
    if (params?.customerId) q.set("customerId", params.customerId);
    if (params?.search) q.set("search", params.search);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.sortBy) q.set("sortBy", params.sortBy);
    if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
    const qs = q.toString();
    return request<any>(`/repair-orders${qs ? `?${qs}` : ""}`);
  },
  createRepairOrder: (data: any) =>
    request<any>("/repair-orders", { method: "POST", body: JSON.stringify(data) }),
  getRepairOrder: (id: string) => request<any>(`/repair-orders/${id}`),
  updateRepairOrder: (id: string, data: any) =>
    request<any>(`/repair-orders/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  changeStatus: (id: string, data: { status: string }) =>
    request<any>(`/repair-orders/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteRepairOrder: (id: string) =>
    request<void>(`/repair-orders/${id}`, { method: "DELETE" }),
  restoreRepairOrder: (id: string) =>
    request<any>(`/repair-orders/${id}/restore`, { method: "POST" }),
  getTransitions: (id: string) => request<any>(`/repair-orders/${id}/transitions`),

  // 점검보고서
  getInspectionReport: (repairOrderId: string) =>
    request<any>(`/inspection-reports?repairOrderId=${repairOrderId}`),
  createInspectionReport: (data: any) =>
    request<any>("/inspection-reports", { method: "POST", body: JSON.stringify(data) }),
  updateInspectionReport: (id: string, data: any) =>
    request<any>(`/inspection-reports/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // 비용
  getRepairCosts: (repairOrderId: string) =>
    request<any>(`/repair-costs?repairOrderId=${repairOrderId}`),
  createRepairCost: (data: any) =>
    request<any>("/repair-costs", { method: "POST", body: JSON.stringify(data) }),
  updateRepairCost: (id: string, data: any) =>
    request<any>(`/repair-costs/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteRepairCost: (id: string) =>
    request<void>(`/repair-costs/${id}`, { method: "DELETE" }),

  // 견적
  getRepairQuotes: (repairOrderId: string) =>
    request<any>(`/repair-quotes?repairOrderId=${repairOrderId}`),
  createRepairQuote: (data: any) =>
    request<any>("/repair-quotes", { method: "POST", body: JSON.stringify(data) }),
  updateRepairQuote: (id: string, data: any) =>
    request<any>(`/repair-quotes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  changeQuoteStatus: (id: string, data: { status: string }) =>
    request<any>(`/repair-quotes/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteRepairQuote: (id: string) =>
    request<void>(`/repair-quotes/${id}`, { method: "DELETE" }),
  addQuoteItem: (quoteId: string, data: any) =>
    request<any>(`/repair-quotes/${quoteId}/items`, { method: "POST", body: JSON.stringify(data) }),
  deleteQuoteItem: (itemId: string) =>
    request<void>(`/repair-quotes/items/${itemId}`, { method: "DELETE" }),

  // 부품
  getParts: (params?: { search?: string; lowStock?: boolean; page?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.lowStock) q.set("lowStock", "true");
    if (params?.page) q.set("page", String(params.page));
    const qs = q.toString();
    return request<any>(`/parts${qs ? `?${qs}` : ""}`);
  },
  getPart: (id: string) => request<any>(`/parts/${id}`),
  createPart: (data: any) =>
    request<any>("/parts", { method: "POST", body: JSON.stringify(data) }),
  updatePart: (id: string, data: any) =>
    request<any>(`/parts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deletePart: (id: string) =>
    request<void>(`/parts/${id}`, { method: "DELETE" }),

  // 부품 입출고
  getPartTransactions: (params?: { partId?: string; repairOrderId?: string }) => {
    const q = new URLSearchParams();
    if (params?.partId) q.set("partId", params.partId);
    if (params?.repairOrderId) q.set("repairOrderId", params.repairOrderId);
    const qs = q.toString();
    return request<any>(`/part-transactions${qs ? `?${qs}` : ""}`);
  },
  createPartTransaction: (data: any) =>
    request<any>("/part-transactions", { method: "POST", body: JSON.stringify(data) }),

  // 발주
  getPurchaseOrders: (params?: { status?: string; page?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.page) q.set("page", String(params.page));
    const qs = q.toString();
    return request<any>(`/purchase-orders${qs ? `?${qs}` : ""}`);
  },
  createPurchaseOrder: (data: any) =>
    request<any>("/purchase-orders", { method: "POST", body: JSON.stringify(data) }),
  updatePurchaseOrder: (id: string, data: any) =>
    request<any>(`/purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  receivePurchaseOrder: (id: string, data: { items: { itemId: string; receivedQuantity: number }[] }) =>
    request<any>(`/purchase-orders/${id}/receive`, { method: "PATCH", body: JSON.stringify(data) }),

  // 발송/입고
  getShipments: (repairOrderId: string) =>
    request<any>(`/shipments?repairOrderId=${repairOrderId}`),
  createShipment: (data: any) =>
    request<any>("/shipments", { method: "POST", body: JSON.stringify(data) }),
  updateShipment: (id: string, data: any) =>
    request<any>(`/shipments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  changeShipmentStatus: (id: string, data: { status: string }) =>
    request<any>(`/shipments/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteShipment: (id: string) =>
    request<void>(`/shipments/${id}`, { method: "DELETE" }),

  // 통계
  getRepairStatsSummary: () => request<any>("/repair-stats/summary"),
  getRepairStatsByEquipment: () => request<any>("/repair-stats/by-equipment"),
  getRepairStatsMonthly: (months?: number) =>
    request<any>(`/repair-stats/monthly${months ? `?months=${months}` : ""}`),
  getRepairStatsCosts: () => request<any>("/repair-stats/costs"),
  getRepairStatsPartsUsage: () => request<any>("/repair-stats/parts-usage"),
  getRepairStatsYearly: () => request<any>("/repair-stats/yearly"),
  getRepairStatsByCustomer: () => request<any>("/repair-stats/by-customer"),
  getRepairStatsByHandler: () => request<any>("/repair-stats/by-handler"),
};

// ─── Supplier (제조사/공급사) API ────────────────────────────────────────────

export const supplierApi = {
  list: (params?: { search?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<any>(`/suppliers${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => request<any>(`/suppliers/${id}`),
  findByName: (name: string) => request<any>(`/suppliers/by-name?name=${encodeURIComponent(name)}`),
  create: (data: any) =>
    request<any>("/suppliers", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/suppliers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/suppliers/${id}`, { method: "DELETE" }),
  addContact: (supplierId: string, data: any) =>
    request<any>(`/suppliers/${supplierId}/contacts`, { method: "POST", body: JSON.stringify(data) }),
  updateContact: (contactId: string, data: any) =>
    request<any>(`/suppliers/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteContact: (contactId: string) =>
    request<void>(`/suppliers/contacts/${contactId}`, { method: "DELETE" }),
};

// ─── Procurement (구매/재고) API ─────────────────────────────────────────────

export const procurementApi = {
  // 장비 마스터
  getProducts: (params?: { search?: string; name?: string; modelName?: string; manufacturer?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.name) q.set("name", params.name);
    if (params?.modelName) q.set("modelName", params.modelName);
    if (params?.manufacturer) q.set("manufacturer", params.manufacturer);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<any>(`/procurement/products${qs ? `?${qs}` : ""}`);
  },
  getProduct: (id: string) => request<any>(`/procurement/products/${id}`),
  createProduct: (data: any) =>
    request<any>("/procurement/products", { method: "POST", body: JSON.stringify(data) }),
  updateProduct: (id: string, data: any) =>
    request<any>(`/procurement/products/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProduct: (id: string) =>
    request<void>(`/procurement/products/${id}`, { method: "DELETE" }),
  getManufacturers: () => request<string[]>("/procurement/products/manufacturers"),

  // 계약
  getContracts: (params?: { search?: string; status?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.status) q.set("status", params.status);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<any>(`/procurement/contracts${qs ? `?${qs}` : ""}`);
  },
  getContract: (id: string) => request<any>(`/procurement/contracts/${id}`),
  createContract: (data: any) =>
    request<any>("/procurement/contracts", { method: "POST", body: JSON.stringify(data) }),
  updateContract: (id: string, data: any) =>
    request<any>(`/procurement/contracts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteContract: (id: string) =>
    request<void>(`/procurement/contracts/${id}`, { method: "DELETE" }),

  // 해외 발주
  getOrders: (params?: { search?: string; status?: string; currency?: string; orderType?: string; contractId?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.status) q.set("status", params.status);
    if (params?.currency) q.set("currency", params.currency);
    if (params?.orderType) q.set("orderType", params.orderType);
    if (params?.contractId) q.set("contractId", params.contractId);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<any>(`/procurement/orders${qs ? `?${qs}` : ""}`);
  },
  getOrder: (id: string) => request<any>(`/procurement/orders/${id}`),
  createOrder: (data: any) =>
    request<any>("/procurement/orders", { method: "POST", body: JSON.stringify(data) }),
  updateOrder: (id: string, data: any) =>
    request<any>(`/procurement/orders/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteOrder: (id: string) =>
    request<void>(`/procurement/orders/${id}`, { method: "DELETE" }),
  transitionOrder: (id: string, status: string) =>
    request<any>(`/procurement/orders/${id}/transition`, { method: "POST", body: JSON.stringify({ status }) }),
  getDashboard: () => request<any>("/procurement/orders/dashboard"),

  // 발주 품목
  addOrderItem: (orderId: string, data: any) =>
    request<any>(`/procurement/orders/${orderId}/items`, { method: "POST", body: JSON.stringify(data) }),
  updateOrderItem: (itemId: string, data: any) =>
    request<any>(`/procurement/orders/items/${itemId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteOrderItem: (itemId: string) =>
    request<void>(`/procurement/orders/items/${itemId}`, { method: "DELETE" }),

  // 부분 입고
  receiveItems: (orderId: string, receipts: Array<{ itemId: string; quantity: number }>) =>
    request<any>(`/procurement/orders/${orderId}/receive`, { method: "POST", body: JSON.stringify({ receipts }) }),

  // 재고 연결
  linkInventory: (itemId: string, inventoryNo: string) =>
    request<any>(`/procurement/orders/items/${itemId}/link-inventory`, { method: "POST", body: JSON.stringify({ inventoryNo }) }),
  unlinkInventory: (itemId: string, inventoryId: string) =>
    request<any>(`/procurement/orders/items/${itemId}/inventory/${inventoryId}`, { method: "DELETE" }),

  // 진행 이력
  getProgress: (orderId: string) =>
    request<any>(`/procurement/orders/${orderId}/progress`),
  addProgress: (orderId: string, data: { progress: number; note?: string }) =>
    request<any>(`/procurement/orders/${orderId}/progress`, { method: "POST", body: JSON.stringify(data) }),
  deleteProgress: (logId: string) =>
    request<void>(`/procurement/orders/progress/${logId}`, { method: "DELETE" }),
};

// ── Inventory Audit (재고 실사) ──────────────────────────────────────
export const auditApi = {
  list: () => request<any[]>("/inventory/audits"),
  getById: (id: string) => request<any>(`/inventory/audits/${id}`),
  create: (data: { name: string; plannedDate: string; notes?: string }) =>
    request<any>("/inventory/audits", { method: "POST", body: JSON.stringify(data) }),
  start: (id: string) =>
    request<any>(`/inventory/audits/${id}/start`, { method: "POST" }),
  pause: (id: string) =>
    request<any>(`/inventory/audits/${id}/pause`, { method: "POST" }),
  resume: (id: string) =>
    request<any>(`/inventory/audits/${id}/resume`, { method: "POST" }),
  cancel: (id: string) =>
    request<any>(`/inventory/audits/${id}/cancel`, { method: "POST" }),
  complete: (id: string) =>
    request<any>(`/inventory/audits/${id}/complete`, { method: "POST" }),
  checkItem: (itemId: string, data: { actualQuantity: number; actualLocation?: string; notes?: string }) =>
    request<any>(`/inventory/audits/items/${itemId}/check`, { method: "POST", body: JSON.stringify(data) }),
  resetItem: (itemId: string) =>
    request<any>(`/inventory/audits/items/${itemId}/reset`, { method: "POST" }),
};

// ── Expense Follow-up (지출결의 후속처리 — procurement) ──────────────────────────────
export const expenseFollowupApi = {
  list: (status?: string) => {
    const q = status ? `?status=${status}` : "";
    return request<any[]>(`/procurement/expenses${q}`);
  },
  getById: (id: string) => request<any>(`/procurement/expenses/${id}`),
  decide: (id: string, data: { isInventoryTarget: boolean; note?: string; inventoryItems?: number[] }) =>
    request<any>(`/procurement/expenses/${id}/decide`, { method: "POST", body: JSON.stringify(data) }),
  confirmArrival: (id: string, data: { arrivalDate: string; arrivalLocation?: string }) =>
    request<any>(`/procurement/expenses/${id}/confirm-arrival`, { method: "POST", body: JSON.stringify(data) }),
};

// ── Import Cost Settlement (수입원가정산) ────────────────────────────
export const settlementApi = {
  list: () => request<any[]>("/procurement/settlements"),
  getById: (id: string) => request<any>(`/procurement/settlements/${id}`),
  create: (data: any) =>
    request<any>("/procurement/settlements", { method: "POST", body: JSON.stringify(data) }),
  addExtra: (id: string, data: any) =>
    request<any>(`/procurement/settlements/${id}/extras`, { method: "POST", body: JSON.stringify(data) }),
  updateContract: (id: string, contractId: string | null) =>
    request<any>(`/procurement/settlements/${id}/contract`, { method: "PATCH", body: JSON.stringify({ contractId }) }),
  addRemittance: (id: string, data: any) =>
    request<any>(`/procurement/settlements/${id}/remittances`, { method: "POST", body: JSON.stringify(data) }),
  removeRemittance: (remittanceId: string) =>
    request<void>(`/procurement/settlements/remittances/${remittanceId}`, { method: "DELETE" }),
  remove: (id: string) =>
    request<void>(`/procurement/settlements/${id}`, { method: "DELETE" }),
};

// ── Inventory (재고) ─────────────────────────────────────────────────────
export const inventoryApi = {
  // 재고 목록
  list: (params?: { category?: string; status?: string; location?: string; search?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.category) q.set("category", params.category);
    if (params?.status) q.set("status", params.status);
    if (params?.location) q.set("location", params.location);
    if (params?.search) q.set("search", params.search);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    return request<any>(`/inventory/items?${q.toString()}`);
  },
  getFilterOptions: () => request<{ locations: string[]; projects: string[]; assignees: string[] }>("/inventory/items/filter-options"),
  getStats: () => request<any>("/inventory/items/stats"),
  getByNo: (inventoryNo: string) => request<any>(`/inventory/items/by-no/${inventoryNo}`),
  getById: (id: string) => request<any>(`/inventory/items/${id}`),
  create: (data: any) =>
    request<any>("/inventory/items", { method: "POST", body: JSON.stringify(data) }),
  createFromReceipt: (data: { orderItemId: string; serialNumber?: string; currentLocation?: string }) =>
    request<any>("/inventory/items/from-receipt", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/inventory/items/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // 입출고 이력
  getTransactions: (itemId: string) => request<any[]>(`/inventory/transactions/item/${itemId}`),
  getRecentTransactions: (params?: { type?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.type) q.set("type", params.type);
    if (params?.limit) q.set("limit", String(params.limit));
    return request<any[]>(`/inventory/transactions/recent?${q.toString()}`);
  },
  createTransaction: (data: any) =>
    request<any>("/inventory/transactions", { method: "POST", body: JSON.stringify(data) }),

  // 비용이력
  getCostEvents: (itemId: string) => request<any[]>(`/inventory/costs/item/${itemId}`),
  addCostEvent: (data: any) =>
    request<any>("/inventory/costs", { method: "POST", body: JSON.stringify(data) }),
  deleteCostEvent: (id: string) =>
    request<void>(`/inventory/costs/${id}`, { method: "DELETE" }),

  // 보관위치
  getLocations: (params?: { type?: string; search?: string; includeInactive?: boolean; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.type) q.set("type", params.type);
    if (params?.search) q.set("search", params.search);
    if (params?.includeInactive) q.set("includeInactive", "true");
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    return request<{ items: any[]; total: number; page: number; limit: number; totalPages: number }>(`/inventory/locations?${q.toString()}`);
  },
  createLocation: (data: any) =>
    request<any>("/inventory/locations", { method: "POST", body: JSON.stringify(data) }),
  updateLocation: (id: string, data: any) =>
    request<any>(`/inventory/locations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteLocation: (id: string) =>
    request<void>(`/inventory/locations/${id}`, { method: "DELETE" }),
};

// ── Approval (결재) ──────────────────────────────────────────────────────
export const approvalApi = {
  // 템플릿
  getTemplates: () => request<any[]>("/approval/templates"),
  getTemplate: (id: string) => request<any>(`/approval/templates/${id}`),

  // 문서 CRUD
  createDocument: (data: any) =>
    request<any>("/approval/documents", { method: "POST", body: JSON.stringify(data) }),
  getDocument: (id: string) => request<any>(`/approval/documents/${id}`),
  getDocumentByReference: (referenceType: string, referenceId: string) =>
    request<any>(`/approval/documents/by-reference/${referenceType}/${referenceId}`),
  updateDocument: (id: string, data: any) =>
    request<any>(`/approval/documents/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  // 결재 액션
  submitDocument: (id: string) =>
    request<any>(`/approval/documents/${id}/submit`, { method: "PATCH" }),
  withdrawDocument: (id: string) =>
    request<any>(`/approval/documents/${id}/withdraw`, { method: "PATCH" }),
  approveDocument: (id: string, comment?: string) =>
    request<any>(`/approval/documents/${id}/approve`, { method: "PATCH", body: JSON.stringify({ comment: comment || "" }) }),
  rejectDocument: (id: string, comment: string) =>
    request<any>(`/approval/documents/${id}/reject`, { method: "PATCH", body: JSON.stringify({ comment }) }),
  agreeDocument: (id: string, comment?: string) =>
    request<any>(`/approval/documents/${id}/agree`, { method: "PATCH", body: JSON.stringify({ comment: comment || "" }) }),

  // 수신함
  getPendingDocuments: (page = 1, limit = 20) =>
    request<any>(`/approval/documents/pending?page=${page}&limit=${limit}`),
  getSentDocuments: (page = 1, limit = 20) =>
    request<any>(`/approval/documents/sent?page=${page}&limit=${limit}`),
  getCcDocuments: (page = 1, limit = 20) =>
    request<any>(`/approval/documents/cc?page=${page}&limit=${limit}`),
  getCompletedDocuments: (page = 1, limit = 20) =>
    request<any>(`/approval/documents/completed?page=${page}&limit=${limit}`),

  // 파일
  uploadFile: (documentId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const headers: Record<string, string> = {};
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
    return fetch(`${API_PREFIX}/approval/files/upload?documentId=${documentId}`, {
      method: "POST",
      headers,
      body: formData,
      credentials: "include",
    }).then(r => { if (!r.ok) throw new Error("Upload failed"); return r.json(); });
  },
  getDocumentFiles: (documentId: string) =>
    request<any[]>(`/approval/files/document/${documentId}`),
  deleteFile: (id: string) =>
    request<void>(`/approval/files/${id}`, { method: "DELETE" }),
};

// ── 파일 첨부 (범용 — referenceType 기반) ─────────────────────────────────
export const fileApi = {
  upload: (referenceType: string, referenceId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const headers: Record<string, string> = {};
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
    return fetch(`${API_PREFIX}/approval/files/upload?referenceType=${referenceType}&referenceId=${referenceId}`, {
      method: "POST",
      headers,
      body: formData,
      credentials: "include",
    }).then(r => { if (!r.ok) throw new Error("Upload failed"); return r.json(); });
  },
  list: (referenceType: string, referenceId: string) =>
    request<any[]>(`/approval/files/reference/${referenceType}/${referenceId}`),
  download: (id: string) => {
    const token = getToken();
    return fetch(`${API_PREFIX}/approval/files/${id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
  remove: (id: string) =>
    request<void>(`/approval/files/${id}`, { method: "DELETE" }),
};

// ── OCR 문서인식 ──────────────────────────────────────────────────────────────
export const ocrApi = {
  // 이미지 업로드 + OCR 처리 (DB 저장)
  scan: (file: File, templateCode?: string, engineId?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (templateCode) formData.append("templateCode", templateCode);
    if (engineId) formData.append("engineId", engineId);
    const headers: Record<string, string> = {};
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
    return fetch(`${API_PREFIX}/ocr/scan`, {
      method: "POST",
      headers,
      body: formData,
      credentials: "include",
    }).then(async (r) => {
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: r.statusText }));
        throw new Error(err.message ?? "OCR 처리 실패");
      }
      return r.json();
    });
  },

  // 엔진 목록
  engines: () => request<Array<{ id: string; name: string; group: string; lang: string; ready: boolean }>>("/ocr/engines"),

  // 처리 이력 목록
  listResults: (params?: { status?: string; templateCode?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.templateCode) qs.set("templateCode", params.templateCode);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return request<{ items: any[]; total: number; page: number; limit: number; totalPages: number }>(`/ocr/results${q ? `?${q}` : ""}`);
  },

  // 결과 상세
  getResult: (id: string) => request<any>(`/ocr/results/${id}`),

  // 원본 이미지 URL
  imageUrl: (id: string) => `${API_PREFIX}/ocr/results/${id}/image`,

  // 필드 수정
  updateFields: (id: string, fields: Array<{ fieldKey: string; confirmedValue: string }>) =>
    request<any>(`/ocr/results/${id}/fields`, { method: "PATCH", body: JSON.stringify({ fields }) }),

  // 확인 완료
  confirmResult: (id: string) =>
    request<any>(`/ocr/results/${id}/confirm`, { method: "POST" }),

  // 결과 삭제
  deleteResult: (id: string) =>
    request<void>(`/ocr/results/${id}`, { method: "DELETE" }),

  // 템플릿 목록
  listTemplates: () => request<any[]>("/ocr/templates"),

  // 템플릿 상세
  getTemplate: (code: string) => request<any>(`/ocr/templates/${code}`),

  // 통계
  getStats: () => request<any>("/ocr/stats"),
};

// ─── 게시판 ────────────────────────────────────────────────────────────────

export const boardApi = {
  listCategories: () => request<any[]>("/board-categories"),
  listBoards: (categoryCode?: string) =>
    request<any[]>(`/boards${categoryCode ? `?categoryCode=${encodeURIComponent(categoryCode)}` : ""}`),
  getBoard: (code: string) => request<any>(`/boards/${encodeURIComponent(code)}`),
};

export const postApi = {
  list: (
    boardCode: string,
    params?: { page?: number; pageSize?: number; search?: string; publishingDeptId?: string; priority?: number },
  ) => {
    const q = new URLSearchParams();
    if (params?.page) q.set("page", String(params.page));
    if (params?.pageSize) q.set("pageSize", String(params.pageSize));
    if (params?.search) q.set("search", params.search);
    if (params?.publishingDeptId) q.set("publishingDeptId", params.publishingDeptId);
    if (typeof params?.priority === "number") q.set("priority", String(params.priority));
    const qs = q.toString();
    return request<{ items: any[]; total: number; page: number; pageSize: number }>(
      `/boards/${encodeURIComponent(boardCode)}/posts${qs ? `?${qs}` : ""}`,
    );
  },
  feed: (params?: { categoryCode?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.categoryCode) q.set("categoryCode", params.categoryCode);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<{ items: any[] }>(`/posts/feed${qs ? `?${qs}` : ""}`);
  },
  unreadCount: (categoryCode?: string) => {
    const qs = categoryCode ? `?categoryCode=${encodeURIComponent(categoryCode)}` : "";
    return request<{ total: number; byCategory: Record<string, number> }>(
      `/posts/me/unread-count${qs}`,
    );
  },
  get: (id: string) => request<any>(`/posts/${id}`),
  create: (
    boardCode: string,
    data: { title: string; content: string; priority?: number; expiresAt?: string | null; attachmentIds?: string[] },
  ) =>
    request<any>(`/boards/${encodeURIComponent(boardCode)}/posts`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: { title?: string; content?: string; priority?: number; expiresAt?: string | null },
  ) =>
    request<any>(`/posts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/posts/${id}`, { method: "DELETE" }),
  togglePin: (id: string, isPinned: boolean) =>
    request<{ id: string; isPinned: boolean }>(`/posts/${id}/pin`, {
      method: "POST",
      body: JSON.stringify({ isPinned }),
    }),
};

export const boardCommentApi = {
  list: (postId: string) => request<any[]>(`/posts/${postId}/comments`),
  create: (postId: string, data: { content: string; parentId?: string }) =>
    request<any>(`/posts/${postId}/comments`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, content: string) =>
    request<any>(`/comments/${id}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  remove: (id: string) => request<void>(`/comments/${id}`, { method: "DELETE" }),
};

export const attachmentApi = {
  upload: async (file: File, isInline = false): Promise<{ id: string; url: string; fileName: string; fileSize: number; mimeType: string; isInline: boolean }> => {
    const headers: Record<string, string> = {};
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API_PREFIX}/attachments/upload?isInline=${isInline}`, {
      method: "POST",
      headers,
      body: fd,
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message ?? err.message ?? "업로드 실패");
    }
    return res.json();
  },
  downloadUrl: (id: string) => `${API_PREFIX}/attachments/${id}`,
};

// ─── 작업비고 (WorkLog) ────────────────────────────────────────────────────

export const workLogApi = {
  listByTask: (taskId: string, params?: { segmentId?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.segmentId) q.set("segmentId", params.segmentId);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<any[]>(`/tasks/${taskId}/work-logs${qs ? `?${qs}` : ""}`);
  },
  create: (
    taskId: string,
    data: { content: string; workedAt: string; segmentId?: string },
  ) =>
    request<any>(`/tasks/${taskId}/work-logs`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { content?: string; workedAt?: string }) =>
    request<any>(`/work-logs/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/work-logs/${id}`, { method: "DELETE" }),

  listByProject: (
    projectId: string,
    params?: { from?: string; to?: string; authorId?: string; taskId?: string; limit?: number; cursor?: string },
  ) => {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.authorId) q.set("authorId", params.authorId);
    if (params?.taskId) q.set("taskId", params.taskId);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.cursor) q.set("cursor", params.cursor);
    const qs = q.toString();
    return request<{ items: any[]; nextCursor: string | null }>(
      `/projects/${projectId}/work-logs${qs ? `?${qs}` : ""}`,
    );
  },

  listMine: (params?: { from?: string; to?: string; projectId?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.projectId) q.set("projectId", params.projectId);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<any[]>(`/me/work-logs${qs ? `?${qs}` : ""}`);
  },

  myProjects: () => request<any[]>("/me/work-log-projects"),

  feed: (params?: { limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<any[]>(`/me/work-log-feed${qs ? `?${qs}` : ""}`);
  },
};

// ─── 자연어 검색 ───────────────────────────────────────────────────

export interface SearchResultItem {
  type: "post" | "worklog";
  id: string;
  title: string;
  snippet: string;
  author: string;
  publishedAt: string;
  url: string;
  boardName?: string;
  projectName?: string;
  taskName?: string;
  score: number;
}

export const searchApi = {
  search: (q: string, params?: { scope?: "all" | "posts" | "worklogs"; limit?: number }) => {
    const sp = new URLSearchParams({ q });
    if (params?.scope) sp.set("scope", params.scope);
    if (params?.limit) sp.set("limit", String(params.limit));
    return request<{ query: string; took: number; items: SearchResultItem[] }>(
      `/search?${sp.toString()}`,
    );
  },
};

// ─── 회사 달력 ─────────────────────────────────────────────────────

export const calendarApi = {
  list: (params?: { from?: string; to?: string; type?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.type) q.set("type", params.type);
    const qs = q.toString();
    return request<any[]>(`/calendar${qs ? `?${qs}` : ""}`);
  },
  upcoming: (days = 14) => request<any[]>(`/calendar/upcoming?days=${days}`),
  get: (id: string) => request<any>(`/calendar/${id}`),
  create: (data: { type: string; title: string; description?: string | null; startDate: string; endDate: string; color?: string | null }) =>
    request<any>("/calendar", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { type?: string; title?: string; description?: string | null; startDate?: string; endDate?: string; color?: string | null }) =>
    request<any>(`/calendar/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/calendar/${id}`, { method: "DELETE" }),
  // v1.2 — KASI 한국 공휴일 동기화 (year 미지정 시 현재 연도)
  syncHolidays: (year?: number) =>
    request<{ year: number; fetched: number; created: number; updated: number; deleted: number; durationMs: number }>(
      `/calendar/sync-holidays${year ? `?year=${year}` : ""}`,
      { method: "POST" },
    ),
};

// ─── 경비정산 V2 (services/expense, port 3008) ──────────────────────────────

export const expenseApi = {
  // Sources (카드 관리)
  listSources: (includeInactive = false) =>
    request<any[]>(`/expense/sources${includeInactive ? "?includeInactive=true" : ""}`),
  createSource: (data: { name: string; displayName?: string; type: string; cardNumber?: string }) =>
    request<any>("/expense/sources", { method: "POST", body: JSON.stringify(data) }),
  updateSource: (id: string, data: { name?: string; displayName?: string | null; type?: string; cardNumber?: string | null; active?: boolean }) =>
    request<any>(`/expense/sources/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteSource: (id: string) => request<void>(`/expense/sources/${id}`, { method: "DELETE" }),

  // Categories (전사 표준 + 본인 개인)
  listCategories: () => request<any[]>("/expense/categories"),
  createPersonalCategory: (data: { code: string; name: string; sheetName?: string; displayOrder?: number }) =>
    request<any>("/expense/categories", { method: "POST", body: JSON.stringify(data) }),
  updatePersonalCategory: (id: string, data: any) =>
    request<any>(`/expense/categories/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deletePersonalCategory: (id: string) =>
    request<void>(`/expense/categories/${id}`, { method: "DELETE" }),

  // Transactions (data: detail/memo 등 임의 필드)
  listTransactions: (params: { status?: string; categoryId?: string; sourceId?: string; from?: string; to?: string; page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<{ items: any[]; total: number; page: number; limit: number }>(
      `/expense/transactions${q.toString() ? `?${q}` : ""}`,
    );
  },
  getTransaction: (id: string) => request<any>(`/expense/transactions/${id}`),
  createTransaction: (data: any) =>
    request<any>("/expense/transactions", { method: "POST", body: JSON.stringify(data) }),
  updateTransaction: (id: string, data: any) =>
    request<any>(`/expense/transactions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTransaction: (id: string) =>
    request<void>(`/expense/transactions/${id}`, { method: "DELETE" }),

  // Statements
  listStatements: (params: { page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<{ items: any[]; total: number; page: number; limit: number }>(
      `/expense/statements${q.toString() ? `?${q}` : ""}`,
    );
  },
  importStatement: async (file: File, sourceId?: string): Promise<any> => {
    const fd = new FormData();
    fd.append("file", file);
    if (sourceId) fd.append("sourceId", sourceId);
    const headers: Record<string, string> = {};
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
    const res = await fetch(`${API_PREFIX}/expense/statements/import`, {
      method: "POST",
      headers,
      body: fd,
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message ?? err.message ?? "import 실패");
    }
    return res.json();
  },

  // Receipts
  listReceipts: (params: { page?: number; limit?: number; ocrStatus?: string } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<{ items: any[]; total: number; page: number; limit: number }>(
      `/expense/receipts${q.toString() ? `?${q}` : ""}`,
    );
  },
  uploadReceipt: async (file: File): Promise<any> => {
    const fd = new FormData();
    fd.append("file", file);
    const headers: Record<string, string> = {};
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
    const res = await fetch(`${API_PREFIX}/expense/receipts`, {
      method: "POST",
      headers,
      body: fd,
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message ?? err.message ?? "업로드 실패");
    }
    return res.json();
  },
  receiptDownloadUrl: (id: string) => `${API_PREFIX}/expense/receipts/${id}/download`,
  deleteReceipt: (id: string) => request<void>(`/expense/receipts/${id}`, { method: "DELETE" }),
  getReceipt: (id: string) => request<any>(`/expense/receipts/${id}`),
  updateReceipt: (
    id: string,
    data: { extractedAmount?: number | null; extractedMerchant?: string | null; extractedDate?: string | null },
  ) => request<any>(`/expense/receipts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  splitReceipt: (
    id: string,
    regions: Array<{ x: number; y: number; width: number; height: number }>,
  ) =>
    request<{ created: Array<{ id: string; ocrStatus: string }> }>(
      `/expense/receipts/${id}/split`,
      { method: "POST", body: JSON.stringify({ regions }) },
    ),
  reprocessReceipt: (id: string) =>
    request<{ status: string }>(`/expense/receipts/${id}/reprocess`, { method: "POST" }),

  // Matches
  listMatches: (params: { transactionId?: string; receiptId?: string; confirmed?: boolean } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<any[]>(`/expense/matches${q.toString() ? `?${q}` : ""}`);
  },
  createMatch: (transactionId: string, receiptId: string) =>
    request<any>("/expense/matches", { method: "POST", body: JSON.stringify({ transactionId, receiptId }) }),
  confirmMatch: (id: string) =>
    request<any>(`/expense/matches/${id}/confirm`, { method: "PATCH" }),
  removeMatch: (id: string) => request<void>(`/expense/matches/${id}`, { method: "DELETE" }),

  // Settlements
  listSettlements: (params: { status?: string; page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<{ items: any[]; total: number; page: number; limit: number }>(
      `/expense/settlements${q.toString() ? `?${q}` : ""}`,
    );
  },
  getSettlement: (id: string) => request<any>(`/expense/settlements/${id}`),
  // 카테고리별 N개 자동 생성 — legacy
  createSettlement: (data: { periodStart: string; periodEnd: string }) =>
    request<{ created: any[]; updated: any[]; skipped: any[]; message: string | null }>(
      "/expense/settlements",
      { method: "POST", body: JSON.stringify(data) },
    ),
  // 빈 정산 묶음 생성 (수동 워크플로우)
  createEmptySettlement: (data: { title: string }) =>
    request<any>("/expense/settlements/empty", { method: "POST", body: JSON.stringify(data) }),
  // 거래의 정산 묶음 할당/해제
  setTransactionSettlement: (transactionId: string, settlementId: string | null) =>
    request<{ success: boolean }>(`/expense/settlements/transactions/${transactionId}`, {
      method: "PATCH",
      body: JSON.stringify({ settlementId }),
    }),
  deleteSettlement: (id: string) =>
    request<void>(`/expense/settlements/${id}`, { method: "DELETE" }),
  submitSettlement: (id: string) =>
    request<any>(`/expense/settlements/${id}/submit`, { method: "POST", body: "{}" }),
  cancelSettlement: (id: string) =>
    request<any>(`/expense/settlements/${id}/cancel`, { method: "POST", body: "{}" }),
  excelDownloadUrl: (id: string) => `${API_PREFIX}/expense/settlements/${id}/excel`,
  meSummary: () => request<{ unmatched: number; pendingApproval: number; awaitingPayment: number }>(
    "/expense/settlements/me/summary",
  ),

  // Finance
  financeQueue: (status?: string) =>
    request<{ items: any[]; total: number; page: number; limit: number }>(
      `/expense/finance/queue${status ? `?status=${status}` : ""}`,
    ),
  receive: (id: string) =>
    request<any>(`/expense/finance/settlements/${id}/receive`, { method: "POST", body: "{}" }),
  pay: (id: string, data: { paidAt?: string; paidAmount?: number; paidNote?: string }) =>
    request<any>(`/expense/finance/settlements/${id}/pay`, { method: "POST", body: JSON.stringify(data) }),
};

/** @deprecated Use authApi.login instead */
export async function devLogin(username: string, _password: string) {
  // Legacy dev login kept for backward compatibility — redirects through authApi
  console.warn("devLogin is deprecated. Use authApi.login instead.");
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${username}@erp-ot.local`, password: _password }),
  });
  if (!res.ok) throw new Error("로그인 실패");
  const data = await res.json();
  return { token: data.accessToken, role: data.user?.role, name: data.user?.name };
}
