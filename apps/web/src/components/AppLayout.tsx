"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { clearToken, getUser, setUser, myProfileApi, notificationApi, attendanceApi } from "@/lib/api";
import clsx from "clsx";

const NAV = [
  { href: "/dashboard",      label: "지휘센터",   icon: "🎯", managerOnly: false },
  { href: "/projects",       label: "프로젝트",   icon: "📋", managerOnly: false },
  { href: "/resources",      label: "자원 관리",  icon: "👥", managerOnly: true  },
  { href: "/me/dashboard",   label: "내 대시보드", icon: "🗂", managerOnly: false },
  { href: "/me/attendance",  label: "근태",       icon: "🕐", managerOnly: false },
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

function fmtMin(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function CheckInWidget() {
  const [today, setToday] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setToday(await attendanceApi.getToday()); } catch {}
  }, []);

  useEffect(() => { load(); }, []);

  const act = async (fn: () => Promise<any>) => {
    setSaving(true);
    try { await fn(); await load(); }
    catch {} finally { setSaving(false); }
  };

  const state: string = today?.checkState ?? "NOT_STARTED";

  if (state === "CHECKED_OUT") {
    return (
      <span className="text-xs text-gray-500 hidden sm:inline">
        오늘 근무 <span className="font-medium text-gray-700">{fmtMin(today.netWorkMinutes ?? 0)}</span>
      </span>
    );
  }

  return (
    <div className="items-center gap-1.5 hidden sm:flex">
      {state === "NOT_STARTED" && (
        <button onClick={() => act(() => attendanceApi.checkIn({ workType: "OFFICE" }))} disabled={saving}
          className="px-2.5 py-1 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
          출근
        </button>
      )}
      {state === "CHECKED_IN" && (
        <>
          {today?.checkIn && (
            <span className="text-xs text-gray-500">{today.checkIn.slice(11, 16)} 출근</span>
          )}
          <button onClick={() => act(() => attendanceApi.breakOut())} disabled={saving}
            className="px-2 py-1 text-xs font-medium border border-orange-400 text-orange-600 rounded-lg hover:bg-orange-50 disabled:opacity-50">
            외출
          </button>
          <button onClick={() => act(() => attendanceApi.checkOut())} disabled={saving}
            className="px-2 py-1 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            퇴근
          </button>
        </>
      )}
      {state === "ON_BREAK" && (
        <>
          <span className="text-xs text-orange-600 font-medium">외출 중</span>
          <button onClick={() => act(() => attendanceApi.breakIn())} disabled={saving}
            className="px-2.5 py-1 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
            복귀
          </button>
        </>
      )}
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; role: string } | null>(null);
  const isManager = currentUser?.role === "ADMIN" || currentUser?.role === "MANAGER";
  const [unreadCount, setUnreadCount] = useState(0);

  // 알림 미읽음 수 폴링 (30초)
  const loadUnread = useCallback(async () => {
    try {
      const res = await notificationApi.unreadCount();
      setUnreadCount(res.count);
    } catch {}
  }, []);

  useEffect(() => {
    loadUnread();
    const t = setInterval(loadUnread, 30_000);
    return () => clearInterval(t);
  }, [loadUnread]);

  // 프로필 모달
  const [showProfile, setShowProfile] = useState(false);
  const [profileTab, setProfileTab] = useState<"info" | "password">("info");
  const [profileForm, setProfileForm] = useState({ name: "", phoneOffice: "", phoneMobile: "" });
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [pwMsg, setPwMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const adminMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (adminMenuRef.current && !adminMenuRef.current.contains(e.target as Node)) {
        setShowAdminMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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
            {NAV.filter((n) => !n.managerOnly || isManager).map((n) => (
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

          <CheckInWidget />

          <div className="ml-auto flex items-center gap-3">
            {/* 알림 벨 */}
            <button
              onClick={() => router.push("/me/notifications")}
              className="relative p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="알림"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>

            {/* 팀 관리 (Manager/Admin) */}
            {currentUser && ["ADMIN", "MANAGER"].includes(currentUser.role) && (
              <button
                onClick={() => router.push("/me/team")}
                className={clsx(
                  "text-sm font-medium px-2.5 py-1.5 rounded-lg transition-colors",
                  pathname.startsWith("/me/team") ? "bg-blue-50 text-blue-700" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100",
                )}
              >
                팀 관리
              </button>
            )}

            {currentUser && (
              <button onClick={openProfile} className="text-sm text-gray-600 hover:text-blue-600 transition-colors">
                {currentUser.name}
                <span className="ml-1 text-xs text-gray-400">
                  ({ROLE_LABELS[currentUser.role] ?? currentUser.role})
                </span>
              </button>
            )}
            {currentUser?.role === "ADMIN" && (
              <div className="relative" ref={adminMenuRef}>
                <button
                  onClick={() => setShowAdminMenu((v) => !v)}
                  className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100 flex items-center gap-1"
                >
                  관리 <span className="text-xs">{showAdminMenu ? "▴" : "▾"}</span>
                </button>
                {showAdminMenu && (
                  <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50">
                    <button onClick={() => { router.push("/admin/users"); setShowAdminMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      사용자 관리
                    </button>
                    <button onClick={() => { router.push("/admin/departments"); setShowAdminMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      부서 관리
                    </button>
                    <button onClick={() => { router.push("/admin/approval-lines"); setShowAdminMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      결재라인
                    </button>
                    <button onClick={() => { router.push("/admin/org-chart"); setShowAdminMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      조직도
                    </button>
                  </div>
                )}
              </div>
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
