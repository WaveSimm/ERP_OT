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
    "Content-Type": "application/json",
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
  markRead: (id: string) =>
    request<any>(`/notifications/${id}/read`, { method: "PATCH", body: "{}" }),
  markAllRead: () =>
    request<any>(`/notifications/read-all`, { method: "PATCH", body: "{}" }),
};

// ─── My Tasks ────────────────────────────────────────────────────────────────

export const myTasksApi = {
  list: () => request<any[]>("/tasks/mine"),
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

export const userManagementApi = {
  list: () => request<{ items: any[]; total: number }>("/users"),
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
