// 보안 일괄패치 PDCA Layer 3.5 — CSRF 더블 서브밋 토큰 검증
//
// next.config.mjs의 rewrites가 /api/v1/* 를 백엔드로 직접 forward하므로
// /api/v1/[...path]/route.ts handler를 우회. 따라서 middleware에서 CSRF 검증.
//
// 동작:
//   - state-changing (POST/PUT/PATCH/DELETE) 요청 + accessToken cookie 있을 때
//   - csrfToken cookie === X-CSRF-Token 헤더 일치해야 통과
//   - 비인증 요청 (cookie 없음)은 백엔드가 401 처리하므로 통과
//
// 예외:
//   - /api/auth/login, /api/auth/refresh: 인증 전 라우트 (csrf 적용 안 함)
//   - GET/HEAD/OPTIONS: state-changing 아님

import { NextRequest, NextResponse } from "next/server";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// ── 모바일 자동 전환 ──────────────────────────────────────────────────────────
// User-Agent가 모바일인 "문서(GET, text/html)" 요청을 경량 모바일 화면(/m)으로 리다이렉트.
// 모바일 기기는 예외 없이 /m 로 고정 (PC 버전 전환 없음).
const MOBILE_UA = /Android|iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini|Mobile Safari|webOS/i;

function mobileRedirect(req: NextRequest): NextResponse | null {
  if (req.method !== "GET") return null;
  const { pathname } = req.nextUrl;
  // 이미 모바일 경로 / 로그인 / 정적파일(확장자)은 제외 — /m 은 정확히 일치하거나 /m/ 하위만
  if (pathname === "/m" || pathname.startsWith("/m/")) return null;
  if (pathname.startsWith("/login")) return null;
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) return null; // *.html, *.png 등 정적파일
  // 문서 요청만 (fetch/prefetch/data 요청 제외)
  const accept = req.headers.get("accept") || "";
  if (!accept.includes("text/html")) return null;
  // 모바일 UA만
  if (!MOBILE_UA.test(req.headers.get("user-agent") || "")) return null;

  const url = req.nextUrl.clone();
  url.pathname = "/m";
  url.search = "";
  return NextResponse.redirect(url);
}

// CSRF 검증 제외 경로 (인증 전 또는 cookie 미사용)
const CSRF_EXEMPT_PATHS = [
  "/api/auth/login",
  "/api/auth/refresh",
  // /api/auth/logout, /api/auth/logout-all은 cookie 사용하므로 CSRF 적용
];

export function middleware(req: NextRequest) {
  // 페이지 navigation: 모바일이면 /m 으로 리다이렉트, 아니면 통과
  if (!req.nextUrl.pathname.startsWith("/api/")) {
    return mobileRedirect(req) ?? NextResponse.next();
  }

  // state-changing 메서드만 검사
  if (!STATE_CHANGING.has(req.method)) return NextResponse.next();

  // 예외 경로 통과
  for (const exempt of CSRF_EXEMPT_PATHS) {
    if (req.nextUrl.pathname === exempt) return NextResponse.next();
  }

  // 인증 토큰 없으면 백엔드가 401 처리하므로 CSRF 검사 불필요
  const accessCookie = req.cookies.get("accessToken")?.value;
  if (!accessCookie) return NextResponse.next();

  // CSRF 더블 서브밋 검증
  const csrfCookie = req.cookies.get("csrfToken")?.value;
  const csrfHeader = req.headers.get("x-csrf-token");

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return NextResponse.json(
      {
        error: {
          code: "CSRF_TOKEN_INVALID",
          message: "CSRF 토큰이 유효하지 않습니다. 페이지를 새로고침해 주세요.",
        },
      },
      { status: 403 },
    );
  }

  return NextResponse.next();
}

export const config = {
  // /api(CSRF 검증) + 페이지(모바일 리다이렉트). 정적 자산은 제외.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
