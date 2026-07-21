"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { clearToken, getUser, setUser, myProfileApi, notificationApi, authApi, boardApi } from "@/lib/api";
import { isManagementUser } from "@/lib/management";
import clsx from "clsx";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  managerOnly: boolean;
  /** 시범 릴리즈(2026-06-23): 관리자 외 계정에서 숨김 — 회계/결재 메뉴 제한 */
  adminOnly?: boolean;
  /** 관리부서(회계·경영지원·임원·대표이사) + ADMIN만 — lib/management.ts 게이트 */
  mgmtOnly?: boolean;
  /** 두 줄 모드 분할 override — 자동 규칙(띄어쓰기/슬래시/floor(len/2))과 다른 결과를 강제할 때만 사용 */
  short?: [string, string];
};

const NAV: NavItem[] = [
  { href: "/me/dashboard",   label: "내 대시보드", icon: "🗂", managerOnly: false, short: ["내대시", "보드"] },
  { href: "/dashboard",      label: "전사 대시보드",   icon: "🎯", managerOnly: false },
  { href: "/projects",       label: "프로젝트",   icon: "📋", managerOnly: false },
  { href: "/resources",      label: "자원",       icon: "👥", managerOnly: false },
  { href: "/equipment",      label: "장비",       icon: "🔧", managerOnly: false },
  { href: "/repair",         label: "수리",       icon: "🛠", managerOnly: false },
  { href: "/management/attendance", label: "관리", icon: "🗄", managerOnly: false, mgmtOnly: true },
  { href: "/procurement",    label: "회계",       icon: "📦", managerOnly: false, adminOnly: true },
  { href: "/approval",       label: "결재",      icon: "📝", managerOnly: false, adminOnly: true },
  { href: "/board",          label: "게시판",     icon: "📋", managerOnly: false },
];

// 우측 "관리" 메뉴 링크 — 데스크톱 드롭다운 + 모바일 햄버거 패널에서 공유
const TEAM_LINKS = [{ href: "/me/team", label: "팀 근태/승인", icon: "👥" }];
const ADMIN_LINKS = [
  { href: "/admin/users", label: "직원 관리", icon: "👤" },
  { href: "/admin/approval-lines", label: "결재라인", icon: "🖋" },
  { href: "/admin/calendar", label: "회사 달력", icon: "📅" },
  { href: "/admin/activity-logs", label: "시스템 이력", icon: "📜" },
  { href: "/admin/monitoring", label: "시스템 모니터링", icon: "🖥" },
  { href: "/admin/feature-requests", label: "기능 요구 관리", icon: "💡" },
  { href: "/admin/contract-migration", label: "계약 마이그레이션", icon: "📥" },
  { href: "/admin/project-migration", label: "프로젝트 마이그레이션", icon: "📊" },
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

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; role: string; isTeamLeader?: boolean } | null>(null);
  const isManager = currentUser?.role === "ADMIN" || currentUser?.role === "MANAGER";
  const isAdmin = currentUser?.role === "ADMIN";
  // 관리 메뉴(관리부서 전용) 게이트 — 부서 확인은 비동기(프로필 조회)라 확인 전엔 숨김
  const [isMgmt, setIsMgmt] = useState(false);
  useEffect(() => {
    if (!currentUser) return;
    let alive = true;
    isManagementUser().then((ok) => { if (alive) setIsMgmt(ok); });
    return () => { alive = false; };
  }, [currentUser?.id]);
  const isTeamLeader = !!currentUser?.isTeamLeader;
  const showAdminDropdown = isAdmin || isTeamLeader;
  const visibleNav = NAV.filter((n) => (!n.managerOnly || isManager) && (!n.adminOnly || isAdmin) && (!n.mgmtOnly || isMgmt));
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
  const [profileForm, setProfileForm] = useState({ name: "", phoneOffice: "", phoneMobile: "", address: "" });
  const [originalProfileForm, setOriginalProfileForm] = useState({ name: "", phoneOffice: "", phoneMobile: "", address: "" });
  const [profileMeta, setProfileMeta] = useState<{ email: string; departmentName: string }>({ email: "", departmentName: "" });
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [pwMsg, setPwMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const adminMenuRef = useRef<HTMLDivElement>(null);
  // 좁은 화면(xl 미만) 햄버거 메뉴
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  // 햄버거 메뉴의 게시판 하위 항목 — 게시판 화면이면 기본 펼침, 그 외엔 탭하여 펼침
  const [boardExpanded, setBoardExpanded] = useState(false);
  const [boardSubs, setBoardSubs] = useState<{ href: string; label: string; icon: string }[]>([]);
  const [boardSubsLoaded, setBoardSubsLoaded] = useState(false);
  useEffect(() => {
    setBoardExpanded(pathname.startsWith("/board"));
  }, [pathname]);
  // 하위 항목(카테고리)은 처음 펼칠 때 한 번만 로드 (전역 성능 부담 방지)
  useEffect(() => {
    if (!boardExpanded || boardSubsLoaded) return;
    let alive = true;
    boardApi
      .listCategories()
      .catch(() => [])
      .then((cats: any) => {
        if (!alive) return;
        const catItems = ((cats ?? []) as any[]).map((c) => ({
          href: `/board/${c.code}`,
          label: c.name as string,
          icon: (c.icon as string) || "📁",
        }));
        setBoardSubs([
          { href: "/board/knowledge", label: "NAS 통합검색", icon: "🔎" },
          ...catItems,
          { href: "/work-logs", label: "프로젝트 게시판", icon: "📝" },
        ]);
        setBoardSubsLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [boardExpanded, boardSubsLoaded]);

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
    const initial = { name: user.name, phoneOffice: "", phoneMobile: "", address: "" };
    setProfileForm(initial);
    setOriginalProfileForm(initial);
    try {
      const data = await myProfileApi.getProfile(user.id);
      // 응답은 {...user, profile:{ phoneOffice, ... }} 구조 — 개인정보는 profile에 중첩됨.
      // 직원관리와 동일하게 data.profile에서 읽어 값 통일(과거엔 최상위에서 읽어 빈 값/불일치였음).
      const p: any = (data as any)?.profile ?? data ?? {};
      const loaded = { name: user.name, phoneOffice: p.phoneOffice ?? "", phoneMobile: p.phoneMobile ?? "", address: p.address ?? "" };
      setProfileForm(loaded);
      setOriginalProfileForm(loaded);
      setProfileMeta({ email: (data as any)?.email ?? "", departmentName: p.departmentName ?? "" });
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
        address: profileForm.address || null,
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
    setShowMobileMenu(false); // 라우트 변경 시 햄버거 닫기
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

  // 30분 유휴(무활동) 시 자동 로그아웃 — 탭 간 활동 공유(localStorage)로
  //   한 탭이라도 활동하면 다른 탭들도 유휴 타이머가 리셋됨(여러 탭에서 조기 로그아웃 방지).
  useEffect(() => {
    if (!currentUser) return;
    const IDLE_MS = 30 * 60 * 1000;
    const LS_KEY = "erp_last_activity";
    localStorage.setItem(LS_KEY, String(Date.now())); // 세션 시작(로드) 시각으로 초기화
    const readLast = () => {
      const v = Number(localStorage.getItem(LS_KEY));
      return Number.isFinite(v) && v > 0 ? v : Date.now();
    };
    let lastWrite = 0;
    const bump = () => {
      const now = Date.now();
      if (now - lastWrite < 5000) return; // 5초 throttle: 잦은 이벤트에도 공유 write 최소화
      lastWrite = now;
      localStorage.setItem(LS_KEY, String(now)); // 다른 탭도 이 값을 읽어 유휴 판정
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const iv = setInterval(() => {
      if (Date.now() - readLast() > IDLE_MS) { // 어느 탭이든 마지막 활동 기준
        clearInterval(iv);
        events.forEach((e) => window.removeEventListener(e, bump));
        authApi.logout().catch(() => {}).finally(() => { clearToken(); router.push("/login?idle=1"); });
      }
    }, 60 * 1000);
    return () => { events.forEach((e) => window.removeEventListener(e, bump)); clearInterval(iv); };
  }, [currentUser, router]);

  // 다크모드 토글 — html.dark 클래스 + localStorage 저장. 전체 로그인 사용자 노출.
  // 초기 .dark 적용은 app/layout.tsx의 인라인 스크립트가 페인트 전에 처리(FOUC 방지). 아래 effect는 isDark 상태 동기화용.
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const dark = localStorage.getItem("erp-theme") === "dark";
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
  }, []);
  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("erp-theme", next ? "dark" : "light");
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
        <div className="px-6 h-14 flex items-center gap-2">
          <button
            onClick={() => router.push("/home")}
            className="shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
            title="홈으로"
          >
            <div className="w-7 h-7 bg-blue-600 rounded-md flex items-center justify-center">
              <span className="text-white text-xs font-bold">ERP</span>
            </div>
          </button>

          <nav className="hidden lg:flex items-center gap-2 shrink-0">
            {visibleNav.map((n) => {
              const [first, second] = n.short ?? splitLabel(n.label);
              return (
                <button
                  key={n.href}
                  onClick={() => handleNavClick(n.href)}
                  title={n.label}
                  className={clsx(
                    "flex items-center px-2 xl:px-2.5 py-0.5 rounded-md text-sm font-medium transition-colors shrink-0",
                    pathname.startsWith(n.href)
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                      : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700",
                  )}
                >
                  {/* 한 줄 (lg+) */}
                  <span className="hidden lg:inline whitespace-nowrap">{n.label}</span>
                  {/* 두 줄 (lg 미만) — nav가 lg부터 보이므로 실질 미사용, 안전용 유지 */}
                  <span className="flex lg:hidden flex-col items-start leading-[1.1] text-left">
                    <span className="whitespace-nowrap">{first}</span>
                    {second && <span className="whitespace-nowrap">{second}</span>}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="hidden lg:flex items-center gap-2 shrink-0 ml-auto">
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

            {/* 다크모드 토글 — 전체 로그인 사용자 */}
            {currentUser && (
              <button
                onClick={toggleTheme}
                title={isDark ? "라이트 모드로" : "다크 모드로"}
                aria-label="테마 전환"
                className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-700 rounded-md transition-colors shrink-0"
              >
                {isDark ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
            )}

            {currentUser && (
              <button onClick={openProfile} className="text-sm text-gray-600 hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0">
                {currentUser.name}
              </button>
            )}
            <button
              onClick={handleLogout}
              title="로그아웃"
              aria-label="로그아웃"
              className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors shrink-0"
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
                        {TEAM_LINKS.map((l) => (
                          <button key={l.href} onClick={() => { router.push(l.href); setShowAdminMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                            {l.icon} {l.label}
                          </button>
                        ))}
                      </>
                    )}
                    {isTeamLeader && isAdmin && <div className="my-1 border-t border-gray-100" />}
                    {isAdmin && (
                      <>
                        <div className="px-4 pt-1 pb-0.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">시스템 관리</div>
                        {ADMIN_LINKS.map((l) => (
                          <button key={l.href} onClick={() => { router.push(l.href); setShowAdminMenu(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                            {l.icon} {l.label}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 좁은 화면(lg 미만): 햄버거 버튼 */}
          <button
            onClick={() => setShowMobileMenu((v) => !v)}
            aria-label="메뉴"
            className="lg:hidden ml-auto p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 rounded-md shrink-0"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              {showMobileMenu
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>

        {/* 좁은 화면 펼침 패널 — 메뉴 + 우측영역 통합 */}
        {showMobileMenu && (
          <>
            {/* 배경: 화면을 가리지 않는 투명 클릭영역(바깥 클릭 시 닫기) */}
            <div className="lg:hidden fixed inset-0 top-14 z-30" onClick={() => setShowMobileMenu(false)} />
            {/* 우측에서만 펼쳐지는 드로어 — 헤더 아래부터 화면 맨 아래까지 */}
            <div className="lg:hidden fixed right-0 top-14 bottom-0 w-64 max-w-[85vw] bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 shadow-xl z-40 overflow-y-auto">
              <div className="flex flex-col">
                {/* 상단: 알림·다크·프로필·로그아웃 (가로, 전환 전 우측영역과 동일) */}
                <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => { router.push("/me/notifications"); setShowMobileMenu(false); }}
                    title="알림"
                    className="relative p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 rounded-md"
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
                    <button
                      onClick={() => toggleTheme()}
                      title={isDark ? "라이트 모드로" : "다크 모드로"}
                      aria-label="테마 전환"
                      className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-700 rounded-md"
                    >
                      {isDark ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                        </svg>
                      )}
                    </button>
                  )}
                  {currentUser && (
                    <button
                      onClick={() => { openProfile(); setShowMobileMenu(false); }}
                      className="text-sm text-gray-600 hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-400 px-1 truncate"
                    >
                      {currentUser.name}
                    </button>
                  )}
                  <button
                    onClick={() => handleLogout()}
                    title="로그아웃"
                    aria-label="로그아웃"
                    className="ml-auto p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 rounded-md"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                  </button>
                </div>

                {/* 메뉴 */}
                <div className="px-4 py-1.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-900/30">메뉴</div>
                {visibleNav.map((n) =>
                  n.href === "/board" ? (
                    <div key={n.href} className="flex flex-col">
                      {/* 게시판: 라벨 탭 = 이동, ▾ 탭 = 하위 펼침/접힘 */}
                      <div
                        className={clsx(
                          "flex items-center",
                          pathname.startsWith("/board")
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                            : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700",
                        )}
                      >
                        <button
                          onClick={() => { handleNavClick(n.href); setShowMobileMenu(false); }}
                          className="flex-1 text-left px-6 py-2.5 text-sm font-medium"
                        >
                          {n.label}
                        </button>
                        <button
                          onClick={() => setBoardExpanded((v) => !v)}
                          aria-label="게시판 하위 메뉴 펼치기"
                          aria-expanded={boardExpanded}
                          className="px-4 py-2.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                        >
                          {boardExpanded ? "▴" : "▾"}
                        </button>
                      </div>
                      {boardExpanded && (
                        <div className="bg-gray-50 dark:bg-gray-900/20 border-y border-gray-100 dark:border-gray-700">
                          {boardSubs.length === 0 ? (
                            <div className="pl-10 pr-6 py-2 text-xs text-gray-400">불러오는 중…</div>
                          ) : (
                            boardSubs.map((s) => {
                              const active =
                                s.href === "/work-logs"
                                  ? pathname.startsWith("/work-logs")
                                  : s.href === "/board/knowledge"
                                    ? pathname === "/board/knowledge"
                                    : pathname.startsWith(s.href);
                              return (
                                <button
                                  key={s.href}
                                  onClick={() => { router.push(s.href); setShowMobileMenu(false); }}
                                  className={clsx(
                                    "w-full text-left pl-10 pr-6 py-2 text-sm",
                                    active
                                      ? "text-blue-700 dark:text-blue-300 font-medium"
                                      : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700",
                                  )}
                                >
                                  <span className="truncate">{s.label}</span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      key={n.href}
                      onClick={() => { handleNavClick(n.href); setShowMobileMenu(false); }}
                      className={clsx(
                        "text-left px-6 py-2.5 text-sm font-medium",
                        pathname.startsWith(n.href)
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                          : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700",
                      )}
                    >
                      {n.label}
                    </button>
                  ),
                )}

                {showAdminDropdown && (
                  <>
                    {isTeamLeader && (
                      <>
                        <div className="px-4 py-1.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-900/30 border-t border-gray-200 dark:border-gray-700">팀</div>
                        {TEAM_LINKS.map((l) => (
                          <button key={l.href} onClick={() => { router.push(l.href); setShowMobileMenu(false); }}
                            className="text-left px-6 py-2.5 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700">
                            {l.label}
                          </button>
                        ))}
                      </>
                    )}
                    {isAdmin && (
                      <>
                        <div className="px-4 py-1.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-900/30 border-t border-gray-200 dark:border-gray-700">시스템 관리</div>
                        {ADMIN_LINKS.map((l) => (
                          <button key={l.href} onClick={() => { router.push(l.href); setShowMobileMenu(false); }}
                            className="text-left px-6 py-2.5 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700">
                            {l.label}
                          </button>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
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
                    {profileMeta.email && <span className="ml-1.5 text-gray-400">· {profileMeta.email}</span>}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={handleLogout} className="text-xs text-gray-500 hover:text-red-600 dark:hover:text-red-400 transition-colors">
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
                    profileTab === t ? "border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400" : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}>
                  {t === "info" ? "기본 정보" : "비밀번호 변경"}
                </button>
              ))}
            </div>

            {/* 기본 정보 탭 */}
            {profileTab === "info" && (
              <form onSubmit={saveProfile} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">부서</label>
                  <div className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">{profileMeta.departmentName || "—"}</div>
                </div>
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
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">주소</label>
                  <input type="text" value={profileForm.address}
                    onChange={(e) => setProfileForm((p) => ({ ...p, address: e.target.value }))}
                    placeholder="예: 서울시 강남구 ..."
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                {profileMsg && (
                  profileMsg.type === "err" ? (
                    <p
                      className="text-sm text-red-600 dark:text-red-400 cursor-pointer hover:underline"
                      title="클릭하면 원래 값으로 되돌립니다"
                      onClick={() => { setProfileForm(originalProfileForm); setProfileMsg(null); }}
                    >
                      {profileMsg.text} <span className="text-xs underline ml-1">되돌리기</span>
                    </p>
                  ) : (
                    <p className="text-sm text-green-600 dark:text-green-400">{profileMsg.text}</p>
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
                  <p className={`text-sm ${pwMsg.type === "ok" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{pwMsg.text}</p>
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
