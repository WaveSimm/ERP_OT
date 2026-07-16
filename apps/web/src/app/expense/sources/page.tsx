"use client";

import { useEffect, useState } from "react";
import { expenseApi } from "@/lib/api";
import { useTableSort } from "@/lib/hooks/useTableSort";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableEmpty, RowButton, StatusBadge } from "@/components/ui/Table";

const TYPE_LABEL: Record<string, string> = {
  CARD_SHINHAN: "신한카드",
  CARD_HYUNDAI: "현대카드",
  CARD_KB: "국민카드",
  CARD_OTHER: "기타카드",
  CASH: "현금",
};

// v1.6.1 (2026-05-15): 정산 구분 (개인/법인)
const OWNERSHIP_LABEL: Record<string, string> = {
  PERSONAL: "개인",
  CORPORATE: "법인",
};

export default function SourcesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);

  type SortKey = "name" | "displayName" | "type" | "cardNumber" | "ownership" | "active";
  const sort = useTableSort<any, SortKey>(items, {
    initialKey: "name",
    initialDir: "asc",
    keyExtractor: (s, key) => {
      switch (key) {
        case "name": return s.name ?? "";
        case "displayName": return s.displayName ?? "";
        case "type": return TYPE_LABEL[s.type] ?? s.type;
        case "cardNumber": return s.cardNumber ?? "";
        case "ownership": return OWNERSHIP_LABEL[s.ownership] ?? s.ownership ?? "";
        case "active": return s.active ? 1 : 0;
      }
    },
  });
  const sortedItems = sort.sortedItems;

  const load = async () => {
    setLoading(true);
    // v1.6.1 (2026-05-15): 현금(CASH)은 카드 관리 목록에서 숨김 (내부 사용은 그대로)
    const all = await expenseApi.listSources(includeInactive);
    setItems(all.filter((s: any) => s.type !== "CASH"));
    setLoading(false);
  };

  useEffect(() => { load();   }, [includeInactive]);

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
      <div className="flex items-center justify-end">
        <button onClick={() => setShowForm(true)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md">+ 추가</button>
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-500">
        <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
        비활성 포함
      </label>

      <TableCard>
        <Table columnDividers>
          <THead>
            <Th align="center" onClick={() => sort.handleSort("name")} className="cursor-pointer hover:bg-gray-100 select-none">명세표이름{sort.sortIndicator("name")}</Th>
            <Th align="center" onClick={() => sort.handleSort("displayName")} className="cursor-pointer hover:bg-gray-100 select-none">대표이름{sort.sortIndicator("displayName")}</Th>
            <Th align="center" onClick={() => sort.handleSort("cardNumber")} className="cursor-pointer hover:bg-gray-100 select-none">카드번호{sort.sortIndicator("cardNumber")}</Th>
            <Th align="center" onClick={() => sort.handleSort("ownership")} className="cursor-pointer hover:bg-gray-100 select-none">정산구분{sort.sortIndicator("ownership")}</Th>
            <Th align="center" onClick={() => sort.handleSort("active")} className="cursor-pointer hover:bg-gray-100 select-none">상태{sort.sortIndicator("active")}</Th>
            <Th align="center">관리</Th>
          </THead>
          <TBody>
            {loading ? (
              <TableEmpty colSpan={6}>불러오는 중...</TableEmpty>
            ) : sortedItems.length === 0 ? (
              <TableEmpty colSpan={6}>등록된 결제수단이 없습니다.</TableEmpty>
            ) : sortedItems.map((s) => (
              <SourceRow key={s.id} source={s} onSaved={load} />
            ))}
          </TBody>
        </Table>
      </TableCard>

      {showForm && <SourceForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function SourceRow({ source, onSaved }: { source: any; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(source.displayName ?? "");
  const [cardNumber, setCardNumber] = useState(source.cardNumber ?? "");

  const saveIfChanged = async (field: "displayName" | "cardNumber", newValue: string) => {
    const orig = source[field] ?? "";
    if (newValue === orig) return;
    const data: any = {};
    data[field] = newValue.trim() === "" ? null : newValue;
    try {
      await expenseApi.updateSource(source.id, data);
      onSaved();
    } catch (e: any) {
      alert(`저장 실패: ${e.message}`);
      if (field === "displayName") setDisplayName(source.displayName ?? "");
      else setCardNumber(source.cardNumber ?? "");
    }
  };

  return (
    <Tr>
      <Td strong title="명세표 import 시 자동 생성 (편집 불가)">{source.name}</Td>
      <Td>
        <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
          onBlur={(e) => saveIfChanged("displayName", e.target.value)}
          placeholder="예: 신한카드(3969)"
          className="text-sm w-full px-2 py-1 border border-transparent rounded hover:border-gray-300 focus:border-blue-500 focus:outline-none" />
      </Td>
      <Td>
        <input type="text" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)}
          onBlur={(e) => saveIfChanged("cardNumber", e.target.value)}
          placeholder="예: 1234-5678-9012-3456"
          className="text-xs w-full px-2 py-1 border border-transparent rounded hover:border-gray-300 focus:border-blue-500 focus:outline-none font-mono" />
      </Td>
      <Td align="center">
        <select value={source.ownership || "PERSONAL"}
          onChange={async (e) => {
            try { await expenseApi.updateSource(source.id, { ownership: e.target.value as "PERSONAL" | "CORPORATE" }); onSaved(); }
            catch (err: any) { alert(`저장 실패: ${err.message}`); }
          }}
          className="text-xs px-1 py-0.5 border border-gray-300 dark:border-gray-600 rounded focus:border-blue-500 focus:outline-none">
          <option value="PERSONAL">개인</option>
          <option value="CORPORATE">법인</option>
        </select>
      </Td>
      <Td align="center">
        <StatusBadge color={source.active ? "green" : "gray"}>{source.active ? "활성" : "비활성"}</StatusBadge>
      </Td>
      <Td align="center">
        {source.active ? (
          <RowButton danger onClick={async () => {
            if (confirm("비활성화 하시겠습니까?")) {
              await expenseApi.deleteSource(source.id); onSaved();
            }
          }}>비활성화</RowButton>
        ) : (
          <RowButton onClick={async () => {
            await expenseApi.updateSource(source.id, { active: true }); onSaved();
          }}>활성화</RowButton>
        )}
      </Td>
    </Tr>
  );
}

function SourceForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ displayName: "", cardNumber: "", name: "", ownership: "PERSONAL" as "PERSONAL" | "CORPORATE" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // displayName/cardNumber에서 카드사 자동 감지 (parser 디스패치용)
  // v1.6.1 (2026-05-15): 카드 관리 목록에서는 현금 등록 안 함 — CASH 매칭 제거
  const detectType = (displayName: string): string => {
    const s = displayName.toLowerCase();
    if (s.includes("신한") || s.includes("shinhan")) return "CARD_SHINHAN";
    if (s.includes("현대") || s.includes("hyundai")) return "CARD_HYUNDAI";
    if (s.includes("국민") || s.includes("kb") || s.includes("쿠팡")) return "CARD_KB";
    return "CARD_OTHER";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.displayName.trim()) { setErr("대표이름을 입력하세요."); return; }
    setSaving(true);
    try {
      // 명세표이름 미입력 시 대표이름으로 채움
      const nameToSave = form.name.trim() || form.displayName.trim();
      await expenseApi.createSource({
        name: nameToSave,
        displayName: form.displayName,
        type: detectType(form.displayName),
        ownership: form.ownership,
        ...(form.cardNumber && { cardNumber: form.cardNumber }),
      });
      onSaved();
    } catch (e: any) { setErr(e.message); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h3 className="font-semibold text-gray-900 mb-4">결제수단 추가</h3>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">대표이름</label>
            <input type="text" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder="예: 신한카드(3969)" autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
            <p className="text-[10px] text-gray-500 mt-1">정산서·거래 리스트에 표시되는 이름</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">카드번호</label>
            <input type="text" value={form.cardNumber} onChange={(e) => setForm({ ...form, cardNumber: e.target.value })}
              placeholder="예: 1234-5678-9012-3456"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">정산구분</label>
            <select value={form.ownership} onChange={(e) => setForm({ ...form, ownership: e.target.value as "PERSONAL" | "CORPORATE" })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
              <option value="PERSONAL">개인 (본인 부담 → 환급)</option>
              <option value="CORPORATE">법인 (회사 결제 → 환급 없음)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">명세표이름 <span className="text-gray-400 font-normal">(선택)</span></label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="비워두면 대표이름과 동일"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
            <p className="text-[10px] text-gray-500 mt-1">명세서 import 시 자동 매칭용 — 보통 비워두면 됨</p>
          </div>
          {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 rounded-md py-2 text-sm">취소</button>
            <button type="submit" disabled={saving} className="flex-1 bg-blue-600 text-white rounded-md py-2 text-sm font-medium">
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
