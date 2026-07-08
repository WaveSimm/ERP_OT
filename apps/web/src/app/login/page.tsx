"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { authApi, setToken, setUser, clearToken } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [idle, setIdle] = useState(false);
  // 유휴 자동 로그아웃 안내 (useSearchParams는 Suspense 필요 → window 직접 사용)
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("idle") === "1") setIdle(true);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      // 보안 일괄패치 PDCA Layer 3 (C1): accessToken은 응답 본문 없음 (cookie로만)
      // 기존 erp_token localStorage가 남아 있다면 정리
      clearToken();
      const { user } = await authApi.login(email, password);
      setToken(""); // no-op (호환), 잔존 정리
      setUser({ id: user.id, name: user.name, role: user.role, isTeamLeader: user.isTeamLeader });
      router.push("/home");
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
            <p className="text-sm text-gray-500 mt-1">이메일과 비밀번호로 로그인하세요</p>
          </div>

          {idle && (
            <div className="mb-4 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-center">
              30분 이상 활동이 없어 자동 로그아웃되었습니다. 다시 로그인해 주세요.
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="admin@erp-ot.local"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
                required
              />
            </div>

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
