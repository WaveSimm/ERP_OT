"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { activityLogApi, userManagementApi, getUser } from "@/lib/api";
import Pagination from "@/components/Pagination";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableEmpty } from "@/components/ui/Table";

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  // ─── 프로젝트/태스크 ───
  TASK_CREATED:          { label: "태스크 생성",   color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  TASK_DELETED:          { label: "태스크 삭제",   color: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
  TASK_STATUS_CHANGED:   { label: "상태 변경",     color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  TASK_PROGRESS_CHANGED: { label: "진행률 변경",   color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  TASK_SCHEDULE_CHANGED: { label: "일정/진도 변경", color: "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300" },
  TASK_RENAMED:          { label: "태스크 이름변경", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  TASK_NOTE_CHANGED:     { label: "비고 변경",     color: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  ASSIGNMENT_CHANGED:    { label: "자원 배정",     color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" },
  ASSIGNMENT_REMOVED:    { label: "배정 해제",     color: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  COMMENT_CREATED:       { label: "댓글 작성",     color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300" },
  COMMENT_DELETED:       { label: "댓글 삭제",     color: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  "project.created":     { label: "프로젝트 생성", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  "project.updated":     { label: "프로젝트 수정", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  // ─── 인증/사용자 ───
  "auth.login":          { label: "로그인",        color: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" },
  "auth.login_failed":   { label: "로그인 실패",   color: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
  "auth.logout":         { label: "로그아웃",      color: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  "auth.password_changed": { label: "비밀번호 변경", color: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
  "user.created":        { label: "사용자 생성",   color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  "user.updated":        { label: "사용자 수정",   color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  "user.role_changed":   { label: "역할 변경",     color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  "user.deleted":        { label: "사용자 삭제",   color: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
  "user.password_reset": { label: "비밀번호 초기화", color: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
  // ─── 부서 ───
  "dept.created":        { label: "부서 생성",     color: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300" },
  "dept.updated":        { label: "부서 수정",     color: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300" },
  "dept.deleted":        { label: "부서 삭제",     color: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
  // ─── 결재라인 ───
  "approval.updated":    { label: "결재라인 설정", color: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" },
  "approval.deleted":    { label: "결재라인 삭제", color: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  "approval.bulk_set":   { label: "결재라인 일괄설정", color: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" },
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
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">시스템 이력</h1>
          <p className="text-sm text-gray-500 mt-0.5">전체 {total}건</p>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">전체 유형</option>
          {actions.map((a) => (
            <option key={a} value={a}>{ACTION_LABELS[a].label}</option>
          ))}
        </select>
        <form onSubmit={handleSearch} className="ml-auto flex items-center gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="설명 검색..."
            className="border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
      <TableCard footer={<Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} />}>
        <Table fixed columnDividers>
          <colgroup>
            <col className="w-[13%]" />
            <col className="w-[12%]" />
            <col className="w-[20%]" />
            <col className="w-[45%]" />
            <col className="w-[10%]" />
          </colgroup>
          <THead>
            <Th align="center">시간</Th>
            <Th align="center">유형</Th>
            <Th align="center">프로젝트</Th>
            <Th align="center">내용</Th>
            <Th align="center">사용자</Th>
          </THead>
          <TBody>
            {loading ? (
              <TableEmpty colSpan={5}>불러오는 중...</TableEmpty>
            ) : items.length === 0 ? (
              <TableEmpty colSpan={5}>이력이 없습니다.</TableEmpty>
            ) : items.map((item) => {
              const actionInfo = ACTION_LABELS[item.action] ?? { label: item.action, color: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" };
              const meta = item.metadata ?? {};
              return (
                <Tr key={item.id}>
                  <Td align="center" mono className="whitespace-nowrap text-xs">{formatDate(item.createdAt)}</Td>
                  <Td align="center">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${actionInfo.color}`}>
                      {actionInfo.label}
                    </span>
                  </Td>
                  <Td dash truncate title={item.project?.name ?? undefined}>{item.project?.name}</Td>
                  <Td>
                    <div>{item.description}</div>
                    {meta.taskName && (
                      <div className="text-[11px] text-gray-400 mt-0.5">태스크: {meta.taskName}</div>
                    )}
                  </Td>
                  <Td dash align="center" truncate title={userMap.get(item.userId) ?? item.userId}>{userMap.get(item.userId) ?? item.userId}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </TableCard>
    </div>
  );
}
