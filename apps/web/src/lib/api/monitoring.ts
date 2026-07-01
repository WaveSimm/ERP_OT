"use client";

import { request } from "./client";

// 시스템 모니터링/알림 (admin). 백엔드: project-service /api/v1/monitoring/*
export interface Monitor {
  key: string;
  name: string;
  enabled: boolean;
  config: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}
export interface AlertRecipient {
  id: string;
  channel: string;
  address: string;
  enabled: boolean;
  createdAt: string;
}
export interface AlertEvent {
  id: string;
  monitorKey: string;
  level: string;
  source: string | null;
  message: string;
  notify: boolean;
  notifiedAt: string | null;
  createdAt: string;
}

export const monitoringApi = {
  monitors: () => request<{ items: Monitor[] }>("/monitoring/monitors"),
  updateMonitor: (key: string, data: { enabled?: boolean; config?: Record<string, any> }) =>
    request<Monitor>(`/monitoring/monitors/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  recipients: () => request<{ items: AlertRecipient[] }>("/monitoring/recipients"),
  addRecipient: (address: string) =>
    request<AlertRecipient>("/monitoring/recipients", {
      method: "POST",
      body: JSON.stringify({ address }),
    }),
  toggleRecipient: (id: string, enabled: boolean) =>
    request<AlertRecipient>(`/monitoring/recipients/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  deleteRecipient: (id: string) =>
    request<void>(`/monitoring/recipients/${id}`, { method: "DELETE" }),

  events: (params?: { page?: number; pageSize?: number; level?: string; monitorKey?: string }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set("page", String(params.page));
    if (params?.pageSize) q.set("pageSize", String(params.pageSize));
    if (params?.level) q.set("level", params.level);
    if (params?.monitorKey) q.set("monitorKey", params.monitorKey);
    const s = q.toString();
    return request<{ items: AlertEvent[]; total: number; page: number; pageSize: number }>(
      `/monitoring/events${s ? `?${s}` : ""}`,
    );
  },

  test: () => request<{ queued: boolean; id: string; note: string }>("/monitoring/test", {
    method: "POST",
    body: "{}",
  }),
};
