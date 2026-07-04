"use client";

import { request, getToken, getCsrfToken, API_PREFIX } from "./client";
import type {
  BoardCategory, Board, BoardPost, BoardPostListItem, BoardFeedItem, BoardComment, WorkLog, CalendarEntry,
  ExpenseSource, ExpenseTransaction, ExpenseStatement, ExpenseReceipt, ExpenseMatch, ExpenseSettlement,
  ApprovalTemplate, ApprovalDocument, ApprovalAttachment, Paginated,
} from "./types";


// ── Approval (결재) ──────────────────────────────────────────────────────
export const approvalApi = {
  // 템플릿
  getTemplates: () => request<ApprovalTemplate[]>("/approval/templates"),
  getTemplate: (id: string) => request<ApprovalTemplate>(`/approval/templates/${id}`),

  // 문서 CRUD
  createDocument: (data: unknown) =>
    request<ApprovalDocument>("/approval/documents", { method: "POST", body: JSON.stringify(data) }),
  getDocument: (id: string) => request<ApprovalDocument>(`/approval/documents/${id}`),
  getDocumentByReference: (referenceType: string, referenceId: string) =>
    request<ApprovalDocument>(`/approval/documents/by-reference/${referenceType}/${referenceId}`),
  updateDocument: (id: string, data: unknown) =>
    request<ApprovalDocument>(`/approval/documents/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  // 결재 액션
  submitDocument: (id: string) =>
    request<ApprovalDocument>(`/approval/documents/${id}/submit`, { method: "PATCH" }),
  withdrawDocument: (id: string) =>
    request<ApprovalDocument>(`/approval/documents/${id}/withdraw`, { method: "PATCH" }),
  approveDocument: (id: string, comment?: string) =>
    request<ApprovalDocument>(`/approval/documents/${id}/approve`, { method: "PATCH", body: JSON.stringify({ comment: comment || "" }) }),
  rejectDocument: (id: string, comment: string) =>
    request<ApprovalDocument>(`/approval/documents/${id}/reject`, { method: "PATCH", body: JSON.stringify({ comment }) }),
  agreeDocument: (id: string, comment?: string) =>
    request<ApprovalDocument>(`/approval/documents/${id}/agree`, { method: "PATCH", body: JSON.stringify({ comment: comment || "" }) }),

  // 수신함
  getPendingDocuments: (page = 1, limit = 20) =>
    request<Paginated<ApprovalDocument>>(`/approval/documents/pending?page=${page}&limit=${limit}`),
  getSentDocuments: (page = 1, limit = 20) =>
    request<Paginated<ApprovalDocument>>(`/approval/documents/sent?page=${page}&limit=${limit}`),
  getCcDocuments: (page = 1, limit = 20) =>
    request<Paginated<ApprovalDocument>>(`/approval/documents/cc?page=${page}&limit=${limit}`),
  getCompletedDocuments: (page = 1, limit = 20) =>
    request<Paginated<ApprovalDocument>>(`/approval/documents/completed?page=${page}&limit=${limit}`),

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
    request<ApprovalAttachment[]>(`/approval/files/document/${documentId}`),
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
    request<ApprovalAttachment[]>(`/approval/files/reference/${referenceType}/${referenceId}`),
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
  listCategories: () => request<BoardCategory[]>("/board-categories"),
  listBoards: (categoryCode?: string) =>
    request<Board[]>(`/boards${categoryCode ? `?categoryCode=${encodeURIComponent(categoryCode)}` : ""}`),
  getBoard: (code: string) => request<Board>(`/boards/${encodeURIComponent(code)}`),
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
    return request<{ items: BoardPostListItem[]; total: number; page: number; pageSize: number }>(
      `/boards/${encodeURIComponent(boardCode)}/posts${qs ? `?${qs}` : ""}`,
    );
  },
  feed: (params?: { categoryCode?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.categoryCode) q.set("categoryCode", params.categoryCode);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<{ items: BoardFeedItem[] }>(`/posts/feed${qs ? `?${qs}` : ""}`);
  },
  unreadCount: (categoryCode?: string) => {
    const qs = categoryCode ? `?categoryCode=${encodeURIComponent(categoryCode)}` : "";
    return request<{ total: number; byCategory: Record<string, number> }>(
      `/posts/me/unread-count${qs}`,
    );
  },
  get: (id: string) => request<BoardPost>(`/posts/${id}`),
  create: (
    boardCode: string,
    data: {
      title: string; content: string; priority?: number; expiresAt?: string | null;
      attachmentIds?: string[]; targetDepartmentId?: string | null;
      // 게시판 design v2.0 (2026-05-22): 기능 요구
      requestType?: string; moduleArea?: string;
    },
  ) =>
    request<BoardPost>(`/boards/${encodeURIComponent(boardCode)}/posts`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: { title?: string; content?: string; priority?: number; expiresAt?: string | null },
  ) =>
    request<BoardPost>(`/posts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/posts/${id}`, { method: "DELETE" }),
  togglePin: (id: string, isPinned: boolean) =>
    request<{ id: string; isPinned: boolean }>(`/posts/${id}/pin`, {
      method: "POST",
      body: JSON.stringify({ isPinned }),
    }),
  // 게시판 design v2.0 (2026-05-22): 기능 요구 카테고리 전용
  updateFeatureStatus: (
    id: string,
    data: {
      requestStatus: "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "ON_HOLD";
      releaseVersion?: string | null;
    },
  ) =>
    request<BoardPost>(`/posts/${id}/feature-status`, { method: "PATCH", body: JSON.stringify(data) }),
  assignFeature: (id: string, assigneeId: string | null) =>
    request<BoardPost>(`/posts/${id}/feature-assign`, { method: "PATCH", body: JSON.stringify({ assigneeId }) }),
  featureRequestStats: () =>
    request<{ total: number; byStatus: Record<string, number>; byType: Record<string, number>; byModule: Record<string, number> }>(
      `/feature-requests/stats`,
    ),
};

export const boardCommentApi = {
  list: (postId: string) => request<BoardComment[]>(`/posts/${postId}/comments`),
  create: (postId: string, data: { content: string; parentId?: string }) =>
    request<BoardComment>(`/posts/${postId}/comments`, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, content: string) =>
    request<BoardComment>(`/comments/${id}`, { method: "PATCH", body: JSON.stringify({ content }) }),
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
    return request<WorkLog[]>(`/tasks/${taskId}/work-logs${qs ? `?${qs}` : ""}`);
  },
  create: (
    taskId: string,
    data: { content: string; workedAt: string; segmentId?: string },
  ) =>
    request<WorkLog>(`/tasks/${taskId}/work-logs`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { content?: string; workedAt?: string }) =>
    request<WorkLog>(`/work-logs/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
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

  feed: (params?: {
    limit?: number;
    offset?: number;
    from?: string;
    to?: string;
    authorId?: string;
    projectId?: string;
    q?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.authorId) q.set("authorId", params.authorId);
    if (params?.projectId) q.set("projectId", params.projectId);
    if (params?.q) q.set("q", params.q);
    const qs = q.toString();
    return request<{ items: any[]; total: number }>(`/me/work-log-feed${qs ? `?${qs}` : ""}`);
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

// ─── OT-Brain NAS 통합검색 (knowledge-api, 게시판 내장 시범) ──────────────────
export type KnowledgeResult = {
  id: string;
  fileName: string;
  ext: string | null;
  agency: string | null;
  nasPath: string;
  folder: string | null;
  folderPath: string;
  copies: number;
  otherLocations: number;
  agencies: string[];
  score: number;
  snippet: string | null;
  place?: string | null;
  takenAt?: string | null;   // 사진 EXIF 촬영일
  docDate?: string | null;   // 문서 본문에서 추출한 작업/작성일
  isPhotoFolder?: boolean;
  folderFiles?: number | null;   // 폴더(촬영 세션) 전체 사진/파일 수
  photosMatched?: number | null; // 그중 검색 매칭 수
};
export type KnowledgeSearchResponse = {
  query: string;
  count: number;
  hasExact: boolean;
  dateLabel?: string | null;      // 인식한 시기 라벨 ("2026년" 등)
  dateMatched?: boolean | null;   // 시기 지정 시 그 시기 매칭 결과 유무 (false면 전 기간 결과 표시 중)
  tokenWeights?: { token: string; df: number; weight: number }[];
  results: KnowledgeResult[];
};
export type KnowledgeAnswer = {
  query: string;
  model: string;
  tookMs: number;
  answer: string;
  sources: { n: number; fileName: string; nasPath: string; score: number | null }[];
};
export const knowledgeApi = {
  searchDocuments: (q: string, topK = 20) =>
    request<KnowledgeSearchResponse>(
      `/knowledge/documents/search?q=${encodeURIComponent(q)}&topK=${topK}`,
    ),
  // RAG: 로컬 LLM 답변 (느림 — 수~수십초). 사내 자료 기반, 외부 전송 없음.
  ask: (q: string, topK = 6) =>
    request<KnowledgeAnswer>(`/knowledge/ask`, {
      method: "POST",
      body: JSON.stringify({ q, topK }),
    }),
};

// ─── 회사 달력 ─────────────────────────────────────────────────────

export const calendarApi = {
  list: (params?: { from?: string; to?: string; type?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.type) q.set("type", params.type);
    const qs = q.toString();
    return request<CalendarEntry[]>(`/calendar${qs ? `?${qs}` : ""}`);
  },
  upcoming: (days = 14) => request<CalendarEntry[]>(`/calendar/upcoming?days=${days}`),
  get: (id: string) => request<CalendarEntry>(`/calendar/${id}`),
  create: (data: { type: string; title: string; description?: string | null; startDate: string; endDate: string; color?: string | null }) =>
    request<CalendarEntry>("/calendar", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { type?: string; title?: string; description?: string | null; startDate?: string; endDate?: string; color?: string | null }) =>
    request<CalendarEntry>(`/calendar/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
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
    request<ExpenseSource[]>(`/expense/sources${includeInactive ? "?includeInactive=true" : ""}`),
  createSource: (data: { name: string; displayName?: string; type: string; cardNumber?: string; ownership?: "PERSONAL" | "CORPORATE" }) =>
    request<ExpenseSource>("/expense/sources", { method: "POST", body: JSON.stringify(data) }),
  updateSource: (id: string, data: { name?: string; displayName?: string | null; type?: string; cardNumber?: string | null; ownership?: "PERSONAL" | "CORPORATE"; active?: boolean }) =>
    request<ExpenseSource>(`/expense/sources/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteSource: (id: string) => request<void>(`/expense/sources/${id}`, { method: "DELETE" }),

  // Transactions (data: detail/memo 등 임의 필드)
  // v1.6.2 (2026-05-15): categoryId → contractId (사업(계약) 연계)
  listTransactions: (params: { status?: string; contractId?: string; sourceId?: string; from?: string; to?: string; page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<{ items: ExpenseTransaction[]; total: number; page: number; limit: number }>(
      `/expense/transactions${q.toString() ? `?${q}` : ""}`,
    );
  },
  getTransaction: (id: string) => request<ExpenseTransaction>(`/expense/transactions/${id}`),
  createTransaction: (data: unknown) =>
    request<ExpenseTransaction>("/expense/transactions", { method: "POST", body: JSON.stringify(data) }),
  updateTransaction: (id: string, data: unknown) =>
    request<ExpenseTransaction>(`/expense/transactions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTransaction: (id: string) =>
    request<void>(`/expense/transactions/${id}`, { method: "DELETE" }),
  // 일괄 삭제 — 단일 요청으로 N건 처리(개별 DELETE 동시발사 → rate-limit 폭주 방지)
  bulkDeleteTransactions: (ids: string[]) =>
    request<{ deleted: number }>("/expense/transactions/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),

  // Statements
  listStatements: (params: { page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<{ items: ExpenseStatement[]; total: number; page: number; limit: number }>(
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
    return request<{ items: ExpenseReceipt[]; total: number; page: number; limit: number }>(
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
  getReceipt: (id: string) => request<ExpenseReceipt>(`/expense/receipts/${id}`),
  updateReceipt: (
    id: string,
    data: { extractedAmount?: number | null; extractedMerchant?: string | null; extractedDate?: string | null },
  ) => request<ExpenseReceipt>(`/expense/receipts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
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
    return request<ExpenseMatch[]>(`/expense/matches${q.toString() ? `?${q}` : ""}`);
  },
  createMatch: (transactionId: string, receiptId: string) =>
    request<ExpenseMatch>("/expense/matches", { method: "POST", body: JSON.stringify({ transactionId, receiptId }) }),
  confirmMatch: (id: string) =>
    request<ExpenseMatch>(`/expense/matches/${id}/confirm`, { method: "PATCH" }),
  removeMatch: (id: string) => request<void>(`/expense/matches/${id}`, { method: "DELETE" }),

  // Settlements
  listSettlements: (params: { status?: string; page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v != null && q.set(k, String(v)));
    return request<{ items: ExpenseSettlement[]; total: number; page: number; limit: number }>(
      `/expense/settlements${q.toString() ? `?${q}` : ""}`,
    );
  },
  getSettlement: (id: string) => request<ExpenseSettlement>(`/expense/settlements/${id}`),
  // 카테고리별 N개 자동 생성 — legacy
  createSettlement: (data: { periodStart: string; periodEnd: string }) =>
    request<{ created: any[]; updated: any[]; skipped: any[]; message: string | null }>(
      "/expense/settlements",
      { method: "POST", body: JSON.stringify(data) },
    ),
  // 빈 정산 묶음 생성 (수동 워크플로우)
  createEmptySettlement: (data: { title: string }) =>
    request<ExpenseSettlement>("/expense/settlements/empty", { method: "POST", body: JSON.stringify(data) }),
  // 거래의 정산 묶음 할당/해제
  setTransactionSettlement: (transactionId: string, settlementId: string | null) =>
    request<{ success: boolean }>(`/expense/settlements/transactions/${transactionId}`, {
      method: "PATCH",
      body: JSON.stringify({ settlementId }),
    }),
  deleteSettlement: (id: string) =>
    request<void>(`/expense/settlements/${id}`, { method: "DELETE" }),
  // v1.6.4 (2026-05-16): 결재 분리 — submitSettlement/cancelSettlement 폐기.
  // 결재 작성·취소는 /approval/new 또는 결재 상세에서 수행. expense-service는 webhook으로 연결됨.
  updateSettlementTitle: (id: string, title: string) =>
    request<ExpenseSettlement>(`/expense/settlements/${id}/title`, { method: "PATCH", body: JSON.stringify({ title }) }),
  excelDownloadUrl: (id: string) => `${API_PREFIX}/expense/settlements/${id}/excel`,
  meSummary: () => request<{ unclassified: number; unsettled: number; unapproved: number; settled: number; paid: number }>(
    "/expense/settlements/me/summary",
  ),

  // Finance
  financeQueue: (status?: string) =>
    request<{ items: ExpenseSettlement[]; total: number; page: number; limit: number }>(
      `/expense/finance/queue${status ? `?status=${status}` : ""}`,
    ),
  receive: (id: string) =>
    request<ExpenseSettlement>(`/expense/finance/settlements/${id}/receive`, { method: "POST", body: "{}" }),
  pay: (id: string, data: { paidAt?: string; paidAmount?: number; paidNote?: string }) =>
    request<ExpenseSettlement>(`/expense/finance/settlements/${id}/pay`, { method: "POST", body: JSON.stringify(data) }),
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
