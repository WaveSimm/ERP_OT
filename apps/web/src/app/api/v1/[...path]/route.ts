// 보안 일괄패치 PDCA Layer 3 + 5
//   C6: cookie / x-forwarded-for / x-real-ip / user-agent forward (audit + rate-limit + reuse detection)
//   H9: notifications는 project로 라우팅 (attendance 충돌 제거)
//   CSRF: state-changing 메서드에 X-CSRF-Token 검증 (cookie csrfToken과 헤더 일치)
//   Authorization 헤더는 Layer 3 이후 미사용 (cookie auth로 전환), 단 호환성 위해 forward 유지

import { NextRequest, NextResponse } from "next/server";

// 폴백은 docker 서비스명 (localhost 아님 — env 누락 시에도 컨테이너 네트워크에서 동작)
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001";
const PROJECT_SERVICE_URL = process.env.API_BASE_URL ?? "http://project-service:3003";
const ATTENDANCE_SERVICE_URL = process.env.ATTENDANCE_SERVICE_URL ?? "http://attendance-service:3004";
const EQUIPMENT_SERVICE_URL = process.env.EQUIPMENT_SERVICE_URL ?? "http://equipment-service:3005";
const APPROVAL_SERVICE_URL = process.env.APPROVAL_SERVICE_URL ?? "http://approval-service:3006";
const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL ?? "http://ocr-service:3007";

// H9: notifications 제거 — project-service의 알림 라우트와 attendance 알림 라우트 충돌
// (attendance는 /internal/notifications/bulk 만 가짐, /api/v1/notifications는 project 소관)
const ATTENDANCE_PREFIXES = new Set(["attendance", "leave", "holiday-work", "policy", "team"]);
const EQUIPMENT_PREFIXES = new Set(["equipment", "categories", "compatibility", "customers", "customer-assets", "deployments", "expense-followups", "import-costs", "inspection-reports", "orders", "parts", "procurement", "products", "repairs", "sensors", "service-targets", "warehouses"]);
const APPROVAL_PREFIXES = new Set(["approval"]);
const OCR_PREFIXES = new Set(["ocr", "scan"]);

function getTargetUrl(path: string[], search: string): string {
  const prefix = path[0];
  if (prefix === "auth" || prefix === "users" || prefix === "departments" || prefix === "approval-lines" || prefix === "boards" || prefix === "posts" || prefix === "comments" || prefix === "attachments" || prefix === "calendar" || prefix === "search") {
    return `${AUTH_SERVICE_URL}/api/v1/${path.join("/")}${search}`;
  }
  if (ATTENDANCE_PREFIXES.has(prefix!)) {
    return `${ATTENDANCE_SERVICE_URL}/api/v1/${path.join("/")}${search}`;
  }
  if (EQUIPMENT_PREFIXES.has(prefix!)) {
    return `${EQUIPMENT_SERVICE_URL}/api/v1/${path.join("/")}${search}`;
  }
  if (APPROVAL_PREFIXES.has(prefix!)) {
    return `${APPROVAL_SERVICE_URL}/api/v1/${path.join("/")}${search}`;
  }
  if (OCR_PREFIXES.has(prefix!)) {
    return `${OCR_SERVICE_URL}/api/v1/${path.join("/")}${search}`;
  }
  // 기본: project (notifications 포함)
  return `${PROJECT_SERVICE_URL}/api/v1/${path.join("/")}${search}`;
}

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri;
  return req.ip ?? "0.0.0.0";
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// 백엔드 연결 일시오류(undici keep-alive 재사용 경합 등) — 죽은 소켓 재사용 시 ECONNRESET 발생.
//   "서버 내부 오류"(500)의 주원인. 멱등(GET/HEAD)만 새 연결로 1회 자동 재시도하면 대부분 해소.
const RETRYABLE = /ECONNRESET|socket hang up|UND_ERR_SOCKET|ECONNREFUSED|ETIMEDOUT|other side closed|fetch failed|terminated/i;

async function fetchUpstream(target: string, init: RequestInit, method: string): Promise<Response> {
  const idempotent = method === "GET" || method === "HEAD";
  const maxRetries = idempotent ? 1 : 0;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(target, { ...init, signal: AbortSignal.timeout(30000) });
    } catch (err: unknown) {
      lastErr = err;
      const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
      const msg = `${e?.cause?.code ?? ""} ${e?.cause?.message ?? ""} ${e?.code ?? ""} ${e?.message ?? ""}`;
      if (attempt < maxRetries && RETRYABLE.test(msg)) continue; // 새 연결로 재시도
      throw err;
    }
  }
  throw lastErr;
}

// CSRF 검증 — accessToken cookie 있고 state-changing이면 X-CSRF-Token이 csrfToken cookie와 일치해야
function checkCsrf(req: NextRequest): { ok: boolean; reason?: string } {
  if (!STATE_CHANGING.has(req.method)) return { ok: true };
  const accessCookie = req.cookies.get("accessToken")?.value;
  if (!accessCookie) return { ok: true }; // 비인증 요청은 백엔드가 401 처리
  const csrfCookie = req.cookies.get("csrfToken")?.value;
  const csrfHeader = req.headers.get("x-csrf-token");
  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return { ok: false, reason: "CSRF token mismatch" };
  }
  return { ok: true };
}

async function proxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path;
  const search = req.nextUrl.search;
  const target = getTargetUrl(path, search);

  // DEBUG: route handler 확인
  if (path.includes("debug-proxy")) {
    return NextResponse.json({
      ok: true,
      version: "Layer3+5",
      cookieAccessToken: req.cookies.get("accessToken")?.value?.slice(0, 30),
      authHeader: req.headers.get("authorization")?.slice(0, 30),
      cookieHeader: req.headers.get("cookie")?.slice(0, 80),
      allCookies: req.cookies.getAll().map(c => c.name),
    });
  }

  // CSRF 검증 (login/refresh 같은 비인증 라우트는 accessToken 없으므로 통과)
  const csrf = checkCsrf(req);
  if (!csrf.ok) {
    return NextResponse.json(
      { error: { code: "CSRF_TOKEN_INVALID", message: csrf.reason } },
      { status: 403 },
    );
  }

  // 헤더 forward (C6)
  const headers = new Headers();
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  const auth = req.headers.get("authorization");
  if (auth) headers.set("authorization", auth);
  const cookie = req.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);

  // accessToken cookie → Authorization Bearer 변환 (백엔드 fastify-jwt 호환)
  const accessTokenCookie = req.cookies.get("accessToken")?.value;
  console.log(`[proxy] ${req.method} ${path.join("/")} cookieAuth=${!!accessTokenCookie} authHdr=${!!auth} cookieHeader=${!!cookie}`);
  if (accessTokenCookie && !auth) {
    headers.set("authorization", `Bearer ${accessTokenCookie}`);
  }

  headers.set("x-forwarded-for", getClientIp(req));
  const ua = req.headers.get("user-agent");
  if (ua) headers.set("user-agent", ua);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const bodyText = hasBody ? await req.text() : undefined;

  let res: Response;
  try {
    res = await fetchUpstream(target, { method: req.method, headers, body: bodyText }, req.method);
  } catch (err: unknown) {
    // 백엔드 연결 실패/타임아웃 → 깔끔한 502 (Next 기본 500 "서버 내부 오류" 대신)
    const e = err as { name?: string; cause?: { code?: string } };
    const isTimeout = e?.name === "TimeoutError";
    console.error(`[proxy] upstream 실패 ${req.method} ${path.join("/")} → ${target}: ${e?.cause?.code ?? e?.name ?? err}`);
    return NextResponse.json(
      { error: { code: isTimeout ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE", message: "백엔드 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해주세요." } },
      { status: isTimeout ? 504 : 502 },
    );
  }

  // 응답 헤더 forward (Set-Cookie 다중 처리)
  const resHeaders = new Headers();
  res.headers.forEach((v, k) => {
    if (k.toLowerCase() === "set-cookie") return; // 따로 처리
    resHeaders.set(k, v);
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    resHeaders.append("set-cookie", sc);
  }

  return new NextResponse(res.body, {
    status: res.status,
    headers: resHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const PUT = proxy;
