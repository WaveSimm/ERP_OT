"use client";

const API_PREFIX = "/api/v1";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("erp_token");
}

export function setToken(token: string) {
  localStorage.setItem("erp_token", token);
}

export function clearToken() {
  localStorage.removeItem("erp_token");
  localStorage.removeItem("erp_user");
}

export function setUser(user: { id: string; name: string; role: string }) {
  localStorage.setItem("erp_user", JSON.stringify(user));
}

export function getUser(): { id: string; name: string; role: string } | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem("erp_user") ?? "null");
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(init.body != null && { "Content-Type": "application/json" }),
    ...(init.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_PREFIX}${path}`, { ...init, headers, cache: "no-store" });

  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message ?? "API Error");
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

// ─── Milestones ───────────────────────────────────────────────────────────────

export const milestoneApi = {
  list: (projectId: string) =>
    request<any[]>(`/projects/${projectId}/milestones`),
  create: (projectId: string, data: { name: string; description?: string; sortOrder?: number }) =>
    request<any>(`/projects/${projectId}/milestones`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (projectId: string, milestoneId: string, data: any) =>
    request<any>(`/projects/${projectId}/milestones/${milestoneId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (projectId: string, milestoneId: string) =>
    request<void>(`/projects/${projectId}/milestones/${milestoneId}`, { method: "DELETE" }),
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
  list: (params?: { type?: string; isActive?: boolean }) => {
    const q = params ? new URLSearchParams(params as any).toString() : "";
    return request<any[]>(`/resources${q ? `?${q}` : ""}`);
  },
  create: (data: { name: string; type?: string; dailyCapacityHours?: number; groupId?: string }) =>
    request<any>("/resources", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/resources/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  utilization: (id: string, startDate: string, endDate: string) =>
    request<any>(`/resources/${id}/utilization?startDate=${startDate}&endDate=${endDate}`),
  dashboard: (startDate: string, endDate: string) =>
    request<any[]>(`/resources/dashboard?startDate=${startDate}&endDate=${endDate}`),
  heatmap: (startDate: string, endDate: string, granularity = "week") =>
    request<any>(`/resources/heatmap?startDate=${startDate}&endDate=${endDate}&granularity=${granularity}`),
};

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
  list: (params?: { status?: string; year?: number }) => {
    const q = params ? new URLSearchParams(params as any).toString() : "";
    return request<any[]>(`/leave/requests${q ? `?${q}` : ""}`);
  },
  create: (data: { type: string; startDate: string; endDate: string; reason: string; approverId?: string }) =>
    request<any>("/leave/requests", { method: "POST", body: JSON.stringify(data) }),
  cancel: (id: string) =>
    request<any>(`/leave/requests/${id}/cancel`, { method: "PATCH", body: "{}" }),
};

// ─── Overtime ─────────────────────────────────────────────────────────────────

export const overtimeApi = {
  list: (status?: string) =>
    request<any[]>(`/overtime/requests${status ? `?status=${status}` : ""}`),
  create: (data: { date: string; plannedHours: number; reason: string; projectId?: string; approverId?: string }) =>
    request<any>("/overtime/requests", { method: "POST", body: JSON.stringify(data) }),
  complete: (id: string, actualHours: number) =>
    request<any>(`/overtime/requests/${id}/complete`, { method: "PATCH", body: JSON.stringify({ actualHours }) }),
  cancel: (id: string) =>
    request<any>(`/overtime/requests/${id}/cancel`, { method: "PATCH", body: "{}" }),
};

// ─── Team (Manager) ──────────────────────────────────────────────────────────

export const teamApi = {
  getAttendance: (year: number, month: number) =>
    request<any[]>(`/team/attendance?year=${year}&month=${month}`),
  getPendingLeave: () => request<any[]>("/leave/pending"),
  getPendingOT: () => request<any[]>("/overtime/pending"),
  approveLeave: (id: string) =>
    request<any>(`/leave/requests/${id}/approve`, { method: "POST", body: "{}" }),
  rejectLeave: (id: string, rejectReason: string) =>
    request<any>(`/leave/requests/${id}/reject`, { method: "POST", body: JSON.stringify({ rejectReason }) }),
  approveOT: (id: string) =>
    request<any>(`/overtime/requests/${id}/approve`, { method: "POST", body: "{}" }),
  rejectOT: (id: string, rejectReason: string) =>
    request<any>(`/overtime/requests/${id}/reject`, { method: "POST", body: JSON.stringify({ rejectReason }) }),
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
  login: async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "로그인 실패");
    return data as { accessToken: string; user: { id: string; email: string; name: string; role: string } };
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
  list: () => request<{ items: any[]; total: number }>("/users"),
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
};

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

  // 고객 자산
  getCustomerAssets: (params?: { customerId?: string; search?: string }) => {
    const q = new URLSearchParams();
    if (params?.customerId) q.set("customerId", params.customerId);
    if (params?.search) q.set("search", params.search);
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
  getRepairOrders: (params?: { status?: string; statusGroup?: string; customerId?: string; search?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.statusGroup) q.set("statusGroup", params.statusGroup);
    if (params?.customerId) q.set("customerId", params.customerId);
    if (params?.search) q.set("search", params.search);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
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
  updateTechStatus: (id: string, data: { techStatus: string }) =>
    request<any>(`/repair-orders/${id}/tech-status`, { method: "PATCH", body: JSON.stringify(data) }),
  updateSalesStatus: (id: string, data: { salesStatus: string }) =>
    request<any>(`/repair-orders/${id}/sales-status`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteRepairOrder: (id: string) =>
    request<void>(`/repair-orders/${id}`, { method: "DELETE" }),
  getTransitions: (id: string) => request<any>(`/repair-orders/${id}/transitions`),
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
