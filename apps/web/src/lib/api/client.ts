"use client";

// 보안 일괄패치 PDCA Layer 3
//   C1: accessToken localStorage 제거 → httpOnly cookie 사용 (서버 자동 set)
//   CSRF: csrfToken cookie를 JS로 읽어 X-CSRF-Token 헤더에 자동 첨부
//   silent refresh: 401 시 /api/v1/auth/refresh 시도 후 원 요청 재시도

export const API_PREFIX = "/api/v1";

// ─── localStorage 호환 API (token은 더 이상 저장 안 함, user는 UX 캐시) ──
// 기존 호출처(login page 등) 호환을 위해 시그니처 유지

export function setToken(_token: string) {
  // C1: accessToken은 httpOnly cookie로 서버가 set. 클라이언트 저장 불필요.
  // 기존 erp_token localStorage 잔존분 정리
  if (typeof window !== "undefined") localStorage.removeItem("erp_token");
}

// 보안 일괄패치 PDCA 후 cookie 인증 전환 — getToken은 항상 null 반환 (헤더 미설정, cookie 자동 전송)
export function getToken(): string | null {
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

export function getCsrfToken(): string | null {
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

export async function request<T>(path: string, init: RequestInit = {}, _isRetry = false): Promise<T> {
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
    const msg = err?.error?.message ?? err?.message ?? (typeof err?.error === "string" ? err.error : null) ?? "API Error";
    throw new Error(msg);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
