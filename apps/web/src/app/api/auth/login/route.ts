// 보안 일괄패치 PDCA Layer 3 (C1, C6, NEW-7)
//   - login 요청을 auth-service로 프록시 + 4종 Set-Cookie 일괄 forward
//   - C6: x-forwarded-for / x-real-ip / user-agent forward (audit + reuse detection ip 추적)
//   - 응답 본문은 { user } 만 (accessToken은 cookie로만)

import { NextRequest, NextResponse } from "next/server";

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL ?? "http://localhost:3001";

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri;
  return req.ip ?? "0.0.0.0";
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-forwarded-for": getClientIp(req),
    "user-agent": req.headers.get("user-agent") ?? "",
  };
  // 기존 deviceId cookie forward (재로그인 시 동일 디바이스 식별)
  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) headers["cookie"] = cookieHeader;

  const res = await fetch(`${AUTH_SERVICE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  const response = NextResponse.json(data, { status: res.status });

  // 4종 Set-Cookie 일괄 forward (Next.js getSetCookie() — Node.js fetch가 array 반환)
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    response.headers.append("set-cookie", sc);
  }

  return response;
}
