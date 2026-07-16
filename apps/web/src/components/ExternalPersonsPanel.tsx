"use client";

// 자원-모델-분리 PDCA Phase 3b-4b (2026-05-04)
// 외부 자원(외주/협력업체) 목록·등록·archive 탭

import { useEffect, useState } from "react";
import { externalPersonApi, type ExternalPerson } from "@/lib/api";
import { ExternalPersonForm } from "@/components/ExternalPersonForm";
import { fmtDate } from "@/lib/datetime";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableEmpty, RowButton, StatusBadge } from "@/components/ui/Table";

export function ExternalPersonsPanel({ isAdmin }: { isAdmin: boolean }) {
  const [items, setItems] = useState<ExternalPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "ARCHIVED" | "ALL">("ACTIVE");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ExternalPerson | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter !== "ALL") params.status = statusFilter;
      if (search) params.search = search;
      const data = await externalPersonApi.list(params);
      setItems(data);
    } catch (err: any) {
      alert("외부 자원 목록 실패: " + (err.message ?? "오류"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const handleArchive = async (p: ExternalPerson) => {
    if (!confirm(`${p.name}님의 계약을 종료 처리하시겠습니까?`)) return;
    try {
      await externalPersonApi.archive(p.id);
      load();
    } catch (err: any) {
      alert("종료 실패: " + (err.message ?? "오류"));
    }
  };

  const handleReactivate = async (p: ExternalPerson) => {
    if (!confirm(`${p.name}님을 다시 활성화하시겠습니까?`)) return;
    try {
      await externalPersonApi.reactivate(p.id);
      load();
    } catch (err: any) {
      alert("재활성 실패: " + (err.message ?? "오류"));
    }
  };

  const handleDelete = async (p: ExternalPerson) => {
    if (!confirm(`${p.name}을(를) 삭제하시겠습니까?\n(배정 이력이 있으면 삭제 불가, 종료 처리 권장)`)) return;
    try {
      await externalPersonApi.delete(p.id);
      load();
    } catch (err: any) {
      alert("삭제 실패: " + (err.message ?? "오류"));
    }
  };

  return (
    <div>
      {/* 툴바 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-gray-500">전체 {items.length}건</span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="border border-gray-300 rounded px-2 py-1 text-sm"
        >
          <option value="ACTIVE">활성</option>
          <option value="ARCHIVED">종료</option>
          <option value="ALL">전체</option>
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="이름·업체 검색"
          className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm"
        />
        <button onClick={load} className="text-sm border border-gray-300 dark:border-gray-600 rounded px-3 py-1 hover:bg-gray-50 dark:hover:bg-gray-800">검색</button>
        <div className="flex-1" />
        {isAdmin && (
          <button
            onClick={() => setCreating(true)}
            className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + 외부 자원 등록
          </button>
        )}
      </div>

      {/* 목록 */}
      <TableCard>
        <Table columnDividers>
          <THead>
            <Th align="center">이름</Th>
            <Th align="center">업체</Th>
            <Th align="center">연락처</Th>
            <Th align="center">계약기간</Th>
            <Th align="center">상태</Th>
            {isAdmin && <Th align="center">관리</Th>}
          </THead>
          <TBody>
            {loading ? (
              <TableEmpty colSpan={isAdmin ? 6 : 5}>불러오는 중...</TableEmpty>
            ) : items.length === 0 ? (
              <TableEmpty colSpan={isAdmin ? 6 : 5}>🤝 등록된 외부 자원이 없습니다.</TableEmpty>
            ) : items.map((p) => (
              <Tr key={p.id}>
                <Td strong>{p.name}</Td>
                <Td dash>{p.company}</Td>
                <Td align={p.contactEmail || p.contactPhone ? "left" : "center"} className="text-xs text-gray-500">
                  {p.contactEmail || p.contactPhone ? (
                    <>
                      {p.contactEmail && <div>{p.contactEmail}</div>}
                      {p.contactPhone && <div>{p.contactPhone}</div>}
                    </>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </Td>
                <Td align="center" mono className="whitespace-nowrap text-xs">
                  {p.contractStart || p.contractEnd
                    ? `${p.contractStart ? fmtDate(p.contractStart) : "?"} ~ ${p.contractEnd ? fmtDate(p.contractEnd) : "?"}`
                    : "-"}
                </Td>
                <Td align="center">
                  <StatusBadge color={p.status === "ACTIVE" ? "green" : "gray"}>
                    {p.status === "ACTIVE" ? "활성" : "종료"}
                  </StatusBadge>
                </Td>
                {isAdmin && (
                  <Td align="center">
                    <div className="inline-flex items-center gap-1.5">
                      <RowButton onClick={() => setEditing(p)}>수정</RowButton>
                      {p.status === "ACTIVE" ? (
                        <RowButton tone="orange" onClick={() => handleArchive(p)}>종료</RowButton>
                      ) : (
                        <RowButton tone="emerald" onClick={() => handleReactivate(p)}>활성</RowButton>
                      )}
                      <RowButton danger onClick={() => handleDelete(p)}>삭제</RowButton>
                    </div>
                  </Td>
                )}
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>

      {/* 모달 */}
      {(creating || editing) && (
        <ExternalPersonForm
          person={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSuccess={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
