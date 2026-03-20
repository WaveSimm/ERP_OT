"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { clearToken, getUser, setUser, myProfileApi } from "@/lib/api";
import clsx from "clsx";

const NAV = [
  { href: "/projects", label: "프로젝트", icon: "📋" },
  { href: "/resources", label: "자원 관리", icon: "👥" },
  { href: "/my-tasks", label: "내 작업", icon: "✅" },
];

const STORAGE_KEY = "erp_last_path";

function getLastPaths(): Record<string, string> {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}"); } catch { return {}; }
}
function saveLastPath(section: string, path: string) {
  try {
    const map = getLastPaths();
    map[section] = path;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "관리자",
  MANAGER: "매니저",
  OPERATOR: "운영자",
  VIEWER: "조회자",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; role: string } | null>(null);

  // 프로필 모달
  const [showProfile, setShowProfile] = useState(false);
  const [profileTab, setProfileTab] = useState<"info" | "password">("info");
  const [profileForm, setProfileForm] = useState({ name: "", phoneOffice: "", phoneMobile: "" });
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [pwMsg, setPwMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    setCurrentUser(getUser());
  }, []);

  const openProfile = async () => {
    const user = getUser();
    if (!user) return;
    setProfileTab("info");
    setProfileMsg(null);
    setPwMsg(null);
    setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setProfileForm({ name: user.name, phoneOffice: "", phoneMobile: "" });
    try {
      const profile = await myProfileApi.getProfile(user.id);
      setProfileForm({ name: user.name, phoneOffice: profile?.phoneOffice ?? "", phoneMobile: profile?.phoneMobile ?? "" });
    } catch {}
    setShowProfile(true);
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = getUser();
    if (!user) return;
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      if (profileForm.name.trim() !== user.name) {
        const updated = await myProfileApi.changeName(profileForm.name.trim());
        const newUser = { ...user, name: updated.name };
        setUser(newUser);
        setCurrentUser(newUser);
      }
      await myProfileApi.updateProfile(user.id, {
        phoneOffice: profileForm.phoneOffice || null,
        phoneMobile: profileForm.phoneMobile || null,
      });
      setProfileMsg({ type: "ok", text: "저장되었습니다." });
    } catch (e: any) {
      setProfileMsg({ type: "err", text: e.message ?? "저장 실패" });
    } finally {
      setProfileSaving(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwMsg({ type: "err", text: "새 비밀번호가 일치하지 않습니다." });
      return;
    }
    if (pwForm.newPassword.length < 8) {
      setPwMsg({ type: "err", text: "비밀번호는 8자 이상이어야 합니다." });
      return;
    }
    setPwSaving(true);
    setPwMsg(null);
    try {
      await myProfileApi.changePassword(pwForm.currentPassword, pwForm.newPassword);
      setPwMsg({ type: "ok", text: "비밀번호가 변경되었습니다." });
      setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (e: any) {
      setPwMsg({ type: "err", text: e.message ?? "변경 실패" });
    } finally {
      setPwSaving(false);
    }
  };

  // 현재 경로를 해당 섹션의 마지막 경로로 저장
  useEffect(() => {
    const section = NAV.find((n) => pathname.startsWith(n.href));
    if (section) saveLastPath(section.href, pathname);
  }, [pathname]);

  const handleNavClick = (href: string) => {
    if (pathname.startsWith(href)) return;
    const last = getLastPaths()[href];
    router.push(last && last.startsWith(href) ? last : href);
  };

  const handleLogout = () => {
    clearToken();
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-full px-6 h-14 flex items-center gap-6">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 bg-blue-600 rounded-md flex items-center justify-center">
              <span className="text-white text-xs font-bold">ERP</span>
            </div>
            <span className="font-semibold text-gray-900 text-sm">OT 관리</span>
          </div>

          <nav className="flex items-center gap-1">
            {NAV.map((n) => (
              <button
                key={n.href}
                onClick={() => handleNavClick(n.href)}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  pathname.startsWith(n.href)
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100",
                )}
              >
                <span>{n.icon}</span>
                {n.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            {currentUser && (
              <button onClick={openProfile} className="text-sm text-gray-600 hover:text-blue-600 transition-colors">
                {currentUser.name}
                <span className="ml-1 text-xs text-gray-400">
                  ({ROLE_LABELS[currentUser.role] ?? currentUser.role})
                </span>
              </button>
            )}
            {currentUser?.role === "ADMIN" && (
              <button
                onClick={() => router.push("/admin/users")}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                사용자 관리
              </button>
            )}
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      {/* ── 내 프로필 모달 ───────────────────────────────────────────────────── */}
      {showProfile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            {/* 헤더 */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">내 프로필</h3>
              <button onClick={() => setShowProfile(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            {/* 탭 */}
            <div className="flex border-b border-gray-200 px-6">
              {(["info", "password"] as const).map((t) => (
                <button key={t} onClick={() => setProfileTab(t)}
                  className={`py-3 text-sm font-medium border-b-2 mr-4 transition-colors ${
                    profileTab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}>
                  {t === "info" ? "기본 정보" : "비밀번호 변경"}
                </button>
              ))}
            </div>

            {/* 기본 정보 탭 */}
            {profileTab === "info" && (
              <form onSubmit={saveProfile} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">이름</label>
                  <input type="text" value={profileForm.name}
                    onChange={(e) => setProfileForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">내선번호</label>
                  <input type="text" value={profileForm.phoneOffice}
                    onChange={(e) => setProfileForm((p) => ({ ...p, phoneOffice: e.target.value }))}
                    placeholder="예: 02-1234-5678"
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">휴대폰</label>
                  <input type="text" value={profileForm.phoneMobile}
                    onChange={(e) => setProfileForm((p) => ({ ...p, phoneMobile: e.target.value }))}
                    placeholder="예: 010-1234-5678"
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                {profileMsg && (
                  <p className={`text-sm ${profileMsg.type === "ok" ? "text-green-600" : "text-red-600"}`}>{profileMsg.text}</p>
                )}
                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => setShowProfile(false)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">닫기</button>
                  <button type="submit" disabled={profileSaving}
                    className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                    {profileSaving ? "저장 중..." : "저장"}
                  </button>
                </div>
              </form>
            )}

            {/* 비밀번호 변경 탭 */}
            {profileTab === "password" && (
              <form onSubmit={savePassword} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">현재 비밀번호</label>
                  <input type="password" value={pwForm.currentPassword}
                    onChange={(e) => setPwForm((p) => ({ ...p, currentPassword: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required autoFocus />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호</label>
                  <input type="password" value={pwForm.newPassword}
                    onChange={(e) => setPwForm((p) => ({ ...p, newPassword: e.target.value }))}
                    placeholder="8자 이상"
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호 확인</label>
                  <input type="password" value={pwForm.confirmPassword}
                    onChange={(e) => setPwForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required />
                </div>
                {pwMsg && (
                  <p className={`text-sm ${pwMsg.type === "ok" ? "text-green-600" : "text-red-600"}`}>{pwMsg.text}</p>
                )}
                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => setShowProfile(false)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">닫기</button>
                  <button type="submit" disabled={pwSaving}
                    className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                    {pwSaving ? "변경 중..." : "변경"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
