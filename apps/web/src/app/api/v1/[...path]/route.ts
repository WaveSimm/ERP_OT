import { NextRequest, NextResponse } from "next/server";

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL ?? "http://localhost:3001";
const PROJECT_SERVICE_URL = process.env.API_BASE_URL ?? "http://localhost:3003";
const ATTENDANCE_SERVICE_URL = process.env.ATTENDANCE_SERVICE_URL ?? "http://localhost:3004";

const ATTENDANCE_PREFIXES = new Set(["attendance", "leave", "overtime", "policy", "team", "notifications"]);

function getTargetUrl(path: string[], search: string): string {
  const prefix = path[0];
  if (prefix === "auth" || prefix === "users" || prefix === "departments" || prefix === "approval-lines") {
    return `${AUTH_SERVICE_URL}/api/v1/${path.join("/")}${search}`;
  }
  if (ATTENDANCE_PREFIXES.has(prefix)) {
    return `${ATTENDANCE_SERVICE_URL}/api/v1/${path.join("/")}${search}`;
  }
  return `${PROJECT_SERVICE_URL}/api/v1/${path.join("/")}${search}`;
}

async function proxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path;
  const search = req.nextUrl.search;
  const target = getTargetUrl(path, search);

  const headers = new Headers();
  const auth = req.headers.get("authorization");
  if (auth) headers.set("authorization", auth);
  const ct = req.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const bodyText = hasBody ? await req.text() : undefined;

  const res = await fetch(target, {
    method: req.method,
    headers,
    body: bodyText,
  });

  const resHeaders = new Headers();
  res.headers.forEach((v, k) => resHeaders.set(k, v));

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
