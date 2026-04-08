"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { activityLogApi, userManagementApi, getUser } from "@/lib/api";

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  // ─── 프로젝트/태스크 ───
  TASK_CREATED:          { label: "태스크 생성",   color: "bg-blue-100 text-blue-700" },
  TASK_DELETED:          { label: "태스크 삭제",   color: "bg-red-100 text-red-700" },
  TASK_STATUS_CHANGED:   { label: "상태 변경",     color: "bg-amber-100 text-amber-700" },
  TASK_PROGRESS_CHANGED: { label: "진행률 변경",   color: "bg-emerald-100 text-emerald-700" },
  TASK_SCHEDULE_CHANGED: { label: "일정/진도 변경", color: "bg-purple-100 text-purple-700" },
  TASK_RENAMED:          { label: "태스크 이름변경", color: "bg-amber-100 text-amber-700" },
  TASK_NOTE_CHANGED:     { label: "비고 변경",     color: "bg-gray-100 text-gray-600" },
  ASSIGNMENT_CHANGED:    { label: "자원 배정",     color: "bg-cyan-100 text-cyan-700" },
  ASSIGNMENT_REMOVED:    { label: "배정 해제",     color: "bg-gray-100 text-gray-600" },
  COMMENT_CREATED:       { label: "댓글 작성",     color: "bg-indigo-100 text-indigo-700" },
  COMMENT_DELETED:       { label: "댓글 삭제",     color: "bg-gray-100 text-gray-600" },
  "project.created":     { label: "프로젝트 생성", color: "bg-blue-100 text-blue-700" },
  "project.updated":     { label: "프로젝트 수정", color: "bg-amber-100 text-amber-700" },
  // ─── 인증/사용자 ───
  "auth.login":          { label: "로그인",        color: "bg-green-100 text-green-700" },
  "auth.login_failed":   { label: "로그인 실패",   color: "bg-red-100 text-red-700" },
  "auth.logout":         { label: "로그아웃",      color: "bg-gray-100 text-gray-600" },
  "auth.password_changed": { label: "비밀번호 변경", color: "bg-orange-100 text-orange-700" },
  "user.created":        { label: "사용자 생성",   color: "bg-blue-100 text-blue-700" },
  "user.updated":        { label: "사용자 수정",   color: "bg-amber-100 text-amber-700" },
  "user.role_changed":   { label: "역할 변경",     color: "bg-rose-100 text-rose-700" },
  "user.deleted":        { label: "사용자 삭제",   color: "bg-red-100 text-red-700" },
  "user.password_reset": { label: "비밀번호 초기화", color: "bg-orange-100 text-orange-700" },
  // ─── 부서 ───
  "dept.created":        { label: "부서 생성",     color: "bg-teal-100 text-teal-700" },
  "dept.updated":        { label: "부서 수정",     color: "bg-teal-100 text-teal-700" },
  "dept.deleted":        { label: "부서 삭제",     color: "bg-red-100 text-red-700" },
  // ─── 결재라인 ───
  "approval.updated":    { label: "결재라인 설정", color: "bg-violet-100 text-violet-700" },
  "approval.deleted":    { label: "결재라인 삭제", color: "bg-gray-100 text-gray-600" },
  "approval.bulk_set":   { label: "결재라인 일괄설정", color: "bg-violet-100 text-violet-700" },
};

function formatDate(iso: string) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${dd} ${hh}:${mm}:${ss}`;
}

export default function ActivityLogsPage() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [userMap, setUserMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const user = getUser();
    if (!user || user.role !== "ADMIN") { router.replace("/projects"); return; }
    // 사용자 ID→이름 매핑 로드
    userManagementApi.list().then((data) => {
      const users: any[] = Array.isArray(data) ? data : ((data as any).items ?? []);
      const map = new Map<string, string>();
      for (const u of users) {
        map.set(u.id, u.name);
        if (u.email) map.set(u.email, u.name);
      }
      setUserMap(map);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [page, actionFilter, search]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await activityLogApi.list({
        page,
        pageSize: 30,
        action: actionFilter || undefined,
        search: search || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  const actions = Object.keys(ACTION_LABELS);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">시스템 이력</h1>
          <p className="text-xs text-gray-400 mt-0.5">전체 {total}건</p>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">전체 유형</option>
          {actions.map((a) => (
            <option key={a} value={a}>{ACTION_LABELS[a].label}</option>
          ))}
        </select>
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="설명 검색..."
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">검색</button>
        </form>
        {(actionFilter || search) && (
          <button
            onClick={() => { setActionFilter(""); setSearch(""); setSearchInput(""); setPage(1); }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            필터 초기화
          </button>
        )}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">이력이 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 w-36">시간</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-28">유형</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-24">프로젝트</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">내용</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 w-20">사용자</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => {
                const actionInfo = ACTION_LABELS[item.action] ?? { label: item.action, color: "bg-gray-100 text-gray-600" };
                const meta = item.metadata ?? {};
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{formatDate(item.createdAt)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${actionInfo.color}`}>
                        {actionInfo.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 truncate max-w-[120px]" title={item.project?.name ?? ""}>
                      {item.project?.name ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      <div className="text-sm">{item.description}</div>
                      {meta.taskName && (
                        <div className="text-[11px] text-gray-400 mt-0.5">태스크: {meta.taskName}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{userMap.get(item.userId) ?? item.userId}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-sm text-gray-600">{page} / {totalPages}</span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
