"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  monitoringApi,
  getUser,
  type Monitor,
  type AlertRecipient,
  type AlertEvent,
} from "@/lib/api";
import { fmtDateTime24 } from "@/lib/datetime";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableEmpty, RowButton } from "@/components/ui/Table";

const LEVEL_BADGE: Record<string, string> = {
  CRIT: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  WARN: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  RECOVER: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  TEST: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
  INFO: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
};

export default function MonitoringPage() {
  const router = useRouter();
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [recipients, setRecipients] = useState<AlertRecipient[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // 모니터별 임계치 편집 버퍼: key -> { warn, crit }
  const [edits, setEdits] = useState<Record<string, { warn: string; crit: string }>>({});

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [m, r, e] = await Promise.all([
        monitoringApi.monitors(),
        monitoringApi.recipients(),
        monitoringApi.events({ pageSize: 50 }),
      ]);
      setMonitors(m.items);
      setRecipients(r.items);
      setEvents(e.items);
      const buf: Record<string, { warn: string; crit: string }> = {};
      m.items.forEach((mon) => {
        buf[mon.key] = {
          warn: String(mon.config?.warn ?? ""),
          crit: String(mon.config?.crit ?? ""),
        };
      });
      setEdits(buf);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const u = getUser();
    if (!u || u.role !== "ADMIN") { router.replace("/projects"); return; }
    loadAll();
  }, [router, loadAll]);

  const toggleMonitor = async (mon: Monitor) => {
    setBusy(true);
    try {
      await monitoringApi.updateMonitor(mon.key, { enabled: !mon.enabled });
      flash(`${mon.name} ${!mon.enabled ? "활성화" : "비활성화"}`);
      await loadAll();
    } catch (e: any) { flash(e?.message ?? "변경 실패"); } finally { setBusy(false); }
  };

  const saveThresholds = async (mon: Monitor) => {
    const buf = edits[mon.key];
    const warn = parseInt(buf?.warn ?? "", 10);
    const crit = parseInt(buf?.crit ?? "", 10);
    if (Number.isNaN(warn) || Number.isNaN(crit) || warn < 1 || crit < 1 || warn > 100 || crit > 100) {
      flash("임계치는 1~100 사이여야 합니다."); return;
    }
    if (warn >= crit) { flash("경고(WARN) 값은 위험(CRIT)보다 작아야 합니다."); return; }
    setBusy(true);
    try {
      await monitoringApi.updateMonitor(mon.key, { config: { warn, crit } });
      flash(`${mon.name} 임계치 저장 (경고 ${warn}% / 위험 ${crit}%)`);
      await loadAll();
    } catch (e: any) { flash(e?.message ?? "저장 실패"); } finally { setBusy(false); }
  };

  const addRecipient = async () => {
    const addr = newEmail.trim();
    if (!addr) return;
    setBusy(true);
    try {
      await monitoringApi.addRecipient(addr);
      setNewEmail("");
      flash(`수신자 추가: ${addr}`);
      await loadAll();
    } catch (e: any) { flash(e?.message ?? "추가 실패 (중복/형식 확인)"); } finally { setBusy(false); }
  };

  const toggleRecipient = async (r: AlertRecipient) => {
    setBusy(true);
    try { await monitoringApi.toggleRecipient(r.id, !r.enabled); await loadAll(); }
    catch (e: any) { flash(e?.message ?? "변경 실패"); } finally { setBusy(false); }
  };

  const removeRecipient = async (r: AlertRecipient) => {
    if (!confirm(`수신자 '${r.address}' 를 삭제할까요?`)) return;
    setBusy(true);
    try { await monitoringApi.deleteRecipient(r.id); flash("삭제됨"); await loadAll(); }
    catch (e: any) { flash(e?.message ?? "삭제 실패"); } finally { setBusy(false); }
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      const res = await monitoringApi.test();
      flash(res.note ?? "테스트 이벤트 적재됨");
      setTimeout(loadAll, 1500);
    } catch (e: any) { flash(e?.message ?? "테스트 실패"); } finally { setBusy(false); }
  };

  if (loading) return <div className="p-8 text-gray-500">불러오는 중…</div>;

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">시스템 모니터링 / 알림</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            디스크 등 시스템 자원을 감시하고 임계 초과 시 이메일로 알립니다. 발송은 호스트 notifier가 큐를 처리합니다.
          </p>
        </div>
        <RowButton neutral disabled={busy} className="disabled:opacity-50" onClick={loadAll}>새로고침</RowButton>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 dark:text-red-300 rounded text-sm">{error}</div>}
      {toast && <div className="p-3 bg-blue-50 text-blue-700 dark:text-blue-300 rounded text-sm">{toast}</div>}

      {/* 모니터 */}
      <section>
        <h2 className="text-lg font-semibold text-gray-700 mb-3">모니터</h2>
        <div className="space-y-3">
          {monitors.map((mon) => (
            <div key={mon.key} className="border border-gray-200 rounded-lg p-4 bg-white">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-gray-800">{mon.name}</span>
                  <span className="ml-2 text-xs text-gray-400">({mon.key})</span>
                  {Array.isArray(mon.config?.mounts) && (
                    <span className="ml-2 text-xs text-gray-500">감시: {mon.config.mounts.join(", ")}</span>
                  )}
                </div>
                <button onClick={() => toggleMonitor(mon)} disabled={busy}
                  className={`px-3 py-1 text-xs rounded-full ${mon.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" : "bg-gray-200 text-gray-500"}`}>
                  {mon.enabled ? "활성" : "비활성"}
                </button>
              </div>
              {edits[mon.key] && (
                <div className="mt-3 flex items-end gap-3">
                  <label className="text-sm text-gray-600">
                    경고(WARN) %
                    <input type="number" min={1} max={100} value={edits[mon.key].warn}
                      onChange={(e) => setEdits((s) => ({ ...s, [mon.key]: { ...s[mon.key], warn: e.target.value } }))}
                      className="block mt-1 w-24 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded px-2 py-1 text-sm" />
                  </label>
                  <label className="text-sm text-gray-600">
                    위험(CRIT) %
                    <input type="number" min={1} max={100} value={edits[mon.key].crit}
                      onChange={(e) => setEdits((s) => ({ ...s, [mon.key]: { ...s[mon.key], crit: e.target.value } }))}
                      className="block mt-1 w-24 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded px-2 py-1 text-sm" />
                  </label>
                  <RowButton disabled={busy} className="disabled:opacity-50" onClick={() => saveThresholds(mon)}>저장</RowButton>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 수신자 */}
      <section>
        <h2 className="text-lg font-semibold text-gray-700 mb-3">알림 수신자 (전역)</h2>
        <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-200">
          {recipients.length === 0 && <div className="p-4 text-sm text-gray-400">등록된 수신자가 없습니다.</div>}
          {recipients.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-4 py-2.5">
              <span className={`text-sm ${r.enabled ? "text-gray-800" : "text-gray-400 line-through"}`}>{r.address}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => toggleRecipient(r)} disabled={busy}
                  className={`px-2.5 py-1 text-xs rounded-full ${r.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" : "bg-gray-200 text-gray-500"}`}>
                  {r.enabled ? "수신" : "중지"}
                </button>
                <RowButton danger disabled={busy} className="disabled:opacity-50" onClick={() => removeRecipient(r)}>삭제</RowButton>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 px-4 py-3">
            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRecipient()}
              placeholder="email@example.com"
              className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded px-3 py-1.5 text-sm" />
            <RowButton disabled={busy} className="disabled:opacity-50" onClick={addRecipient}>추가</RowButton>
            <RowButton neutral disabled={busy} className="disabled:opacity-50" onClick={sendTest}>테스트 발송</RowButton>
          </div>
        </div>
      </section>

      {/* 이벤트 이력 */}
      <section>
        <h2 className="text-lg font-semibold text-gray-700 mb-3">이벤트 이력</h2>
        <TableCard>
          <Table fixed columnDividers>
            <colgroup>
              <col className="w-[15%]" />
              <col className="w-[9%]" />
              <col className="w-[15%]" />
              <col className="w-[13%]" />
              <col className="w-[36%]" />
              <col className="w-[12%]" />
            </colgroup>
            <THead>
              <Th align="center">시각</Th>
              <Th align="center">레벨</Th>
              <Th align="center">모니터</Th>
              <Th align="center">대상</Th>
              <Th align="center">메시지</Th>
              <Th align="center">발송</Th>
            </THead>
            <TBody>
              {events.length === 0 ? (
                <TableEmpty colSpan={6}>이벤트가 없습니다.</TableEmpty>
              ) : events.map((e) => (
                <Tr key={e.id}>
                  <Td align="center" mono className="whitespace-nowrap">{fmtDateTime24(e.createdAt, { short: true })}</Td>
                  <Td align="center">
                    <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${LEVEL_BADGE[e.level] ?? "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>{e.level}</span>
                  </Td>
                  <Td dash mono align="left" truncate title={e.monitorKey}>{e.monitorKey}</Td>
                  <Td dash truncate title={e.source ?? undefined}>{e.source}</Td>
                  <Td truncate title={e.message}>{e.message}</Td>
                  <Td align="center" className="whitespace-nowrap">
                    {e.notify
                      ? (e.notifiedAt
                          ? <span className="text-emerald-600 dark:text-emerald-400 text-xs">✓ {fmtDateTime24(e.notifiedAt, { short: true })}</span>
                          : <span className="text-amber-600 dark:text-amber-400 text-xs">대기</span>)
                      : <span className="text-gray-400 text-xs">—</span>}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableCard>
      </section>
    </div>
  );
}
