"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { clearToken, getUser, setUser, myProfileApi, notificationApi, attendanceApi, authApi } from "@/lib/api";
import clsx from "clsx";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  managerOnly: boolean;
  /** 두 줄 모드 분할 override — 자동 규칙(띄어쓰기/슬래시/floor(len/2))과 다른 결과를 강제할 때만 사용 */
  short?: [string, string];
};

const NAV: NavItem[] = [
  { href: "/me/dashboard",   label: "내 대시보드", icon: "🗂", managerOnly: false, short: ["내대시", "보드"] },
  { href: "/dashboard",      label: "지휘센터",   icon: "🎯", managerOnly: false },
  { href: "/projects",       label: "프로젝트",   icon: "📋", managerOnly: false },
  { href: "/resources",      label: "자원",       icon: "👥", managerOnly: false },
  { href: "/equipment",      label: "장비",       icon: "🔧", managerOnly: false },
  { href: "/repair",         label: "수리",       icon: "🛠", managerOnly: false },
  { href: "/procurement",    label: "회계",       icon: "📦", managerOnly: false },
  { href: "/approval",       label: "결재",      icon: "📝", managerOnly: false },
  { href: "/board",          label: "게시판",     icon: "📋", managerOnly: false },
];

// 두 줄 모드용 라벨 분할 — 자동 규칙: 띄어쓰기/슬래시 우선, 없으면 floor(len/2), 2자 이하는 그대로.
function splitLabel(label: string): [string, string?] {
  const spaceIdx = label.indexOf(" ");
  if (spaceIdx > 0) return [label.slice(0, spaceIdx), label.slice(spaceIdx + 1)];
  const slashIdx = label.indexOf("/");
  if (slashIdx > 0) return [label.slice(0, slashIdx), label.slice(slashIdx + 1)];
  if (label.length <= 2) return [label];
  const mid = Math.floor(label.length / 2);
  return [label.slice(0, mid), label.slice(mid)];
}

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

function CheckInWidget() {
  const [today, setToday] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setToday(await attendanceApi.getToday()); } catch {}
    finally { setLoaded(true); }
  }, []);

  useEffect(() => { load(); }, []);

  // 다른 컴포넌트(예: 홈 카드)에서 근태 변경 이벤트 발신 시 동기화
  useEffect(() => {
    const handler = () => { void load(); };
    window.addEventListener("attendance-updated", handler);
    return () => window.removeEventListener("attendance-updated", handler);
  }, [load]);

  const act = async (fn: () => Promise<any>) => {
    setSaving(true);
    try { await fn(); } catch {}
    finally {
      await load();
      window.dispatchEvent(new CustomEvent("attendance-updated"));
      setSaving(false);
    }
  };

  if (!loaded) return null;

  const state: string = today?.checkState ?? "NOT_STARTED";

  return (
    <div className="hidden sm:flex items-center gap-1.5 ml-auto shrink-0">
      {/* 액션 버튼 */}
      {state === "NOT_STARTED" && (
        <button onClick={() => { if (confirm("출근 처리하시겠습니까?")) act(() => attendanceApi.checkIn({ workType: "OFFICE" })); }} disabled={saving}
          title="출근"
          className="px-1.5 py-1 text-xs font-semibold bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors">
          🟢 출근
        </button>
      )}
      {state === "CHECKED_IN" && (
        <>
          <button onClick={() => { if (confirm("외출 처리하시겠습니까?")) act(() => attendanceApi.breakOut()); }} disabled={saving}
            title="외출"
            className="px-1.5 py-1 text-xs font-semibold border border-orange-300 text-orange-600 rounded-md hover:bg-orange-50 disabled:opacity-50 transition-colors">
            🟡 외출
          </button>
          <button onClick={() => { if (confirm("퇴근 처리하시겠습니까?\n퇴근 후에는 되돌릴 수 없습니다.")) act(() => attendanceApi.checkOut()); }} disabled={saving}
            title="퇴근"
            className="px-1 py-1 text-xs font-semibold bg-gray-700 text-white rounded-md hover:bg-gray-800 disabled:opacity-50 transition-colors">
            🔴 퇴근
          </button>
        </>
      )}
      {state === "ON_BREAK" && (
        <>
          <span className="text-xs text-orange-500 font-medium">🟡 외출중</span>
          <button onClick={() => { if (confirm("복귀 처리하시겠습니까?")) act(() => attendanceApi.breakIn()); }} disabled={saving}
            title="복귀"
            className="px-1.5 py-1 text-xs font-semibold bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors">
            🟢 복귀
          </button>
        </>
      )}
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; role: string; isTeamLeader?: boolean } | null>(null);
  const isManager = currentUser?.role === "ADMIN" || currentUser?.role === "MANAGER";
  const isAdmin = currentUser?.role === "ADMIN";
  const isTeamLeader = !!currentUser?.isTeamLeader;
  const showAdminDropdown = isAdmin || isTeamLeader;
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
  const [originalProfileForm, setOriginalProfileForm] = useState({ name: "", phoneOffice: "", phoneMobile: "" });
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [pwMsg, setPwMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const adminMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentUser(getUser());
    // 서버 기준 최신 메타(isTeamLeader 등) 갱신 — 로그인 후 직책 변경 반영
    authApi.me().then((u: any) => {
      const fresh = { id: u.id, name: u.name, role: u.role, isTeamLeader: !!u.isTeamLeader };
      setUser(fresh);
      setCurrentUser(fresh);
    }).catch(() => { /* 401 등은 silent — request 헬퍼가 refresh/redirect 처리 */ });
  }, []);

  const openProfile = async () => {
    const user = getUser();
    if (!user) return;
    setProfileTab("info");
    setProfileMsg(null);
    setPwMsg(null);
    setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    const initial = { name: user.name, phoneOffice: "", phoneMobile: "" };
    setProfileForm(initial);
    setOriginalProfileForm(initial);
    try {
      const profile = await myProfileApi.getProfile(user.id);
      const loaded = { name: user.name, phoneOffice: profile?.phoneOffice ?? "", phoneMobile: profile?.phoneMobile ?? "" };
      setProfileForm(loaded);
      setOriginalProfileForm(loaded);
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

  // 마지막 위치 기억에서 제외할 섹션 (항상 루트로 이동)
  const NO_REMEMBER = ["/approval", "/board"];

  const handleNavClick = (href: string) => {
    if (pathname === href) return; // 이미 섹션 루트
    if (pathname.startsWith(href + "/")) {
      router.push(href); // 하위 페이지 → 섹션 루트로
      return;
    }
    if (NO_REMEMBER.includes(href)) {
      router.push(href);
      return;
    }
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
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-2">
          <button
            onClick={() => router.push("/home")}
            className="shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
            title="홈으로"
          >
            <div className="w-7 h-7 bg-blue-600 rounded-md flex items-center justify-center">
              <span className="text-white text-xs font-bold">ERP</span>
            </div>
          </button>

          <nav className="flex items-center gap-1 shrink-0">
            {NAV.filter((n) => !n.managerOnly || isManager).map((n) => {
              const [first, second] = n.short ?? splitLabel(n.label);
              return (
                <button
                  key={n.href}
                  onClick={() => handleNavClick(n.href)}
                  title={n.label}
                  className={clsx(
                    "flex items-center gap-0.5 px-1 xl:px-1.5 py-0.5 rounded-md text-sm font-medium transition-colors shrink-0",
                    pathname.startsWith(n.href)
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100",
                  )}
                >
                  <span className="shrink-0">{n.icon}</span>
                  {/* 한 줄 (xl+) */}
                  <span className="hidden xl:inline whitespace-nowrap">{n.label}</span>
                  {/* 두 줄 (md~xl) */}
                  <span className="hidden md:flex xl:hidden flex-col items-start leading-[1.1] text-left">
                    <span className="whitespace-nowrap">{first}</span>
                    {second && <span className="whitespace-nowrap">{second}</span>}
                  </span>
                  {/* md 미만: 아이콘만 (라벨 양쪽 모두 숨김) */}
                </button>
              );
            })}
          </nav>

          <CheckInWidget />

          <div className="flex items-center gap-2 shrink-0">
            {/* 알림 벨 */}
            <button
              onClick={() => router.push("/me/notifications")}
              className="relative p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              title="알림"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>

            {currentUser && (
              <button onClick={openProfile} className="text-sm text-gray-600 hover:text-blue-600 transition-colors whitespace-nowrap shrink-0">
                {currentUser.name}
              </button>
            )}
            <button
              onClick={handleLogout}
              title="로그아웃"
              aria-label="로그아웃"
              className="p-1 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
            {showAdminDropdown && (
              <div className="relative shrink-0" ref={adminMenuRef}>
                <button
                  onClick={() => setShowAdminMenu((v) => !v)}
                  title="관리"
                  className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100 flex items-center gap-1 whitespace-nowrap"
                >
                  관리 <span className="text-xs">{showAdminMenu ? "▴" : "▾"}</span>
                </button>
                {showAdminMenu && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50">
                    {isTeamLeader && (
                      <>
                        <div className="px-4 pt-1 pb-0.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">팀</div>
                        <button onClick={() => { router.push("/me/team"); setShowAdminMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          👥 팀 근태/승인
                        </button>
                      </>
                    )}
                    {isTeamLeader && isAdmin && <div className="my-1 border-t border-gray-100" />}
                    {isAdmin && (
                      <>
                        <div className="px-4 pt-1 pb-0.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">시스템 관리</div>
                        <button onClick={() => { router.push("/admin/users"); setShowAdminMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          👤 직원 관리
                        </button>
                        <button onClick={() => { router.push("/admin/equipment-resources"); setShowAdminMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          💼 공용자산 관리
                        </button>
                        <button onClick={() => { router.push("/admin/approval-lines"); setShowAdminMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          🖋 결재라인
                        </button>
                        <button onClick={() => { router.push("/admin/calendar"); setShowAdminMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          📅 회사 달력
                        </button>
                        <button onClick={() => { router.push("/admin/activity-logs"); setShowAdminMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          📜 시스템 이력
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
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
              <div className="flex items-baseline gap-2">
                <h3 className="font-semibold text-gray-900">내 프로필</h3>
                {currentUser && (
                  <span className="text-xs text-gray-400">
                    {ROLE_LABELS[currentUser.role] ?? currentUser.role}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={handleLogout} className="text-xs text-gray-500 hover:text-red-600 transition-colors">
                  로그아웃
                </button>
                <button onClick={() => setShowProfile(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
              </div>
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
                  profileMsg.type === "err" ? (
                    <p
                      className="text-sm text-red-600 cursor-pointer hover:underline"
                      title="클릭하면 원래 값으로 되돌립니다"
                      onClick={() => { setProfileForm(originalProfileForm); setProfileMsg(null); }}
                    >
                      {profileMsg.text} <span className="text-xs underline ml-1">되돌리기</span>
                    </p>
                  ) : (
                    <p className="text-sm text-green-600">{profileMsg.text}</p>
                  )
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
