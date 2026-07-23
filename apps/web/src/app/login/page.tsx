"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { authApi, setToken, setUser, clearToken } from "@/lib/api";

// 로그인 시 아이디 뒤에 자동으로 붙는 고정 도메인 (운영 계정 전부 이 도메인).
// 사용자가 전체 이메일(@ 포함)을 입력하면 그대로 사용(예외 계정 대비).
const LOGIN_DOMAIN = "@oceant.onmicrosoft.com";
// 마지막 접속 아이디 저장 (기기별 localStorage). clearToken/로그아웃으로 안 지워지는 별도 키.
const LS_LAST_ID = "erp_last_login_id";
const LS_REMEMBER_ON = "erp_remember_id";

export default function LoginPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [idle, setIdle] = useState(false);
  const [remember, setRemember] = useState(false);
  const [nextPath, setNextPath] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // 유휴 자동 로그아웃 안내 + 복귀 경로 (useSearchParams는 Suspense 필요 → window 직접 사용)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("idle") === "1") setIdle(true);
    // open redirect 방지: 내부 경로("/...")만 허용, "//host"·절대 URL 차단
    const next = params.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login")) setNextPath(next);
  }, []);
  // 마지막 접속 아이디 미리 채움 ("아이디 저장"을 체크했던 경우에만)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const on = localStorage.getItem(LS_REMEMBER_ON) === "1";
    setRemember(on);
    if (on) {
      const last = localStorage.getItem(LS_LAST_ID);
      if (last) { setUserId(last); passwordRef.current?.focus(); }
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      // 보안 일괄패치 PDCA Layer 3 (C1): accessToken은 응답 본문 없음 (cookie로만)
      // 기존 erp_token localStorage가 남아 있다면 정리
      clearToken();
      const raw = userId.trim();
      const loginEmail = raw.includes("@") ? raw : `${raw.toLowerCase()}${LOGIN_DOMAIN}`;
      const { user } = await authApi.login(loginEmail, password);
      setToken(""); // no-op (호환), 잔존 정리
      setUser({ id: user.id, name: user.name, role: user.role, isTeamLeader: user.isTeamLeader });
      if (remember) {
        localStorage.setItem(LS_REMEMBER_ON, "1");
        localStorage.setItem(LS_LAST_ID, raw);
      } else {
        localStorage.removeItem(LS_REMEMBER_ON);
        localStorage.removeItem(LS_LAST_ID);
      }
      router.push(nextPath ?? "/home"); // 세션 만료로 튕긴 경우 보던 페이지로 복귀
    } catch (err: any) {
      setError(err.message ?? "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-950 dark:to-slate-950">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-2xl font-bold">ERP</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">ERP-OT 관리 시스템</h1>
            <p className="text-sm text-gray-500 mt-1">아이디와 비밀번호로 로그인하세요</p>
          </div>

          {idle && (
            <div className="mb-4 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-center">
              30분 이상 활동이 없어 자동 로그아웃되었습니다. 다시 로그인해 주세요.
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">아이디</label>
              <div className="flex items-stretch border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent">
                <input
                  type="text"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="flex-1 min-w-0 px-4 py-2.5 bg-transparent focus:outline-none"
                  placeholder="아이디"
                  autoComplete="username"
                  required
                  autoFocus
                />
                <span className="flex items-center pr-3 pl-0.5 text-gray-900 font-semibold text-sm whitespace-nowrap select-none">
                  {LOGIN_DOMAIN}
                </span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호</label>
              <input
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
                required
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-600 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              아이디 저장
            </label>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 dark:text-red-300 text-sm rounded-lg px-4 py-2.5">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "로그인 중..." : "로그인"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
