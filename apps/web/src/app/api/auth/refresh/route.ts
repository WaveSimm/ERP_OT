// 보안 일괄패치 PDCA Layer 3 (C1, C6)
//   - refresh 요청을 auth-service로 프록시 + 4종 Set-Cookie 일괄 forward
//   - cookie (refreshToken, deviceId) 자동 forward via cookie header

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
  const headers: Record<string, string> = {
    "x-forwarded-for": getClientIp(req),
    "user-agent": req.headers.get("user-agent") ?? "",
  };
  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) headers["cookie"] = cookieHeader;
  const csrf = req.headers.get("x-csrf-token");
  if (csrf) headers["x-csrf-token"] = csrf;

  const res = await fetch(`${AUTH_SERVICE_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers,
  });

  const data = await res.json().catch(() => ({}));
  const response = NextResponse.json(data, { status: res.status });

  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    response.headers.append("set-cookie", sc);
  }

  return response;
}
