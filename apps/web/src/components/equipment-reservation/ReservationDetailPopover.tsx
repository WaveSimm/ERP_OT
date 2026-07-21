"use client";

import { useState, type ReactNode } from "react";
import { equipmentReservationApi, type ReservationInstance } from "@/lib/api";
import { RowButton, StatusBadge } from "@/components/ui/Table";
import ReservationAttachmentSection from "./ReservationAttachmentSection";

// 팝업 항목-값 표의 한 행
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <td className="py-2 pr-3 align-top text-gray-500 whitespace-nowrap w-20">{label}</td>
      <td className="py-2 align-top text-gray-900 break-words">{children}</td>
    </tr>
  );
}

// 공용자산예약 (2026-05-05) — 인스턴스 상세 + 수정/취소 버튼

interface Props {
  instance: ReservationInstance;
  /** 본인이거나 ADMIN/MANAGER이면 true (수정·취소 버튼 노출) */
  canModify: boolean;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;  // 취소 후 리로드
  /** 넓은 팝업(차량 상세 등)에서 true — max-w-lg */
  wide?: boolean;
}

function fmtDateTime(iso: string, isAllDay: boolean): string {
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (isAllDay) return date;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${date} ${time}`;
}

export default function ReservationDetailPopover({ instance, canModify, onClose, onEdit, onChanged, wide = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancelInstance() {
    if (!confirm(`이 인스턴스(${fmtDateTime(instance.startAt, instance.isAllDay)})만 삭제할까요?`)) return;
    setBusy(true);
    setError(null);
    try {
      await equipmentReservationApi.cancel(instance.parentId ?? instance.id, {
        scope: "instance",
        instanceStartAt: instance.startAt,
      });
      onChanged();
      onClose();
    } catch (err: any) {
      setError(err?.body?.message ?? err?.message ?? "삭제 실패");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelSeries() {
    const msg = instance.isRecurring
      ? `반복 시리즈 전체를 삭제할까요? (${instance.recurrenceSummary})`
      : `예약을 삭제할까요?\n사유: ${instance.title}`;
    if (!confirm(msg)) return;
    setBusy(true);
    setError(null);
    try {
      await equipmentReservationApi.cancel(instance.parentId ?? instance.id, { scope: "series" });
      onChanged();
      onClose();
    } catch (err: any) {
      setError(err?.body?.message ?? err?.message ?? "삭제 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40 p-4" onClick={onClose}>
      <div
        className={`bg-white rounded-xl shadow-xl w-full ${wide ? "max-w-2xl" : "max-w-sm"} max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-gray-900 truncate">
            {instance.isRecurring && <span className="mr-1 font-bold text-gray-500">↻</span>}
            {instance.title}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-3 text-sm overflow-y-auto flex-1">
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-20" />
              <col />
            </colgroup>
            <tbody className="divide-y divide-gray-100">
              <InfoRow label="자원"><span className="font-medium">{instance.resourceName}</span></InfoRow>
              <InfoRow label="예약자">{instance.userName ?? "—"}</InfoRow>
              <InfoRow label="시작"><span className="font-mono text-xs">{fmtDateTime(instance.startAt, instance.isAllDay)}</span></InfoRow>
              <InfoRow label="종료"><span className="font-mono text-xs">{fmtDateTime(instance.endAt, instance.isAllDay)}</span></InfoRow>
              <InfoRow label="유형">
                <StatusBadge color={instance.logType === "MAINTENANCE" ? "purple" : "blue"}>
                  {instance.logType === "MAINTENANCE" ? "차량정비" : "대여"}
                </StatusBadge>
              </InfoRow>
              {instance.logType === "MAINTENANCE" && instance.mileage != null && (
                <InfoRow label="주행거리"><span className="font-mono text-xs">{instance.mileage.toLocaleString()} km</span></InfoRow>
              )}
              {instance.isRecurring && (
                <InfoRow label="반복"><span className="text-xs">{instance.recurrenceSummary}</span></InfoRow>
              )}
              {instance.description && (
                <InfoRow label="비고">
                  <div className="whitespace-pre-wrap break-words leading-relaxed text-gray-700">{instance.description}</div>
                </InfoRow>
              )}
            </tbody>
          </table>

          {instance.isException && (
            <div className="px-2 py-1 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 dark:text-amber-300">
              이 인스턴스는 시리즈에서 예외 처리된 항목입니다.
            </div>
          )}

          <ReservationAttachmentSection reservationId={instance.id} readOnly />

          {error && (
            <div className="px-2 py-1 bg-red-50 border border-red-200 rounded text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        {canModify && (
          <div className="px-5 py-3 border-t border-gray-200 flex gap-2 shrink-0">
            {instance.isRecurring && !instance.isException && (
              <RowButton type="button" tone="orange" onClick={handleCancelInstance} disabled={busy}>
                이 인스턴스만 삭제
              </RowButton>
            )}
            <RowButton type="button" danger onClick={handleCancelSeries} disabled={busy}>
              {instance.isRecurring ? "시리즈 전체 삭제" : "삭제"}
            </RowButton>
            <div className="flex-1" />
            <RowButton type="button" onClick={onEdit} disabled={busy}>
              수정
            </RowButton>
          </div>
        )}
      </div>
    </div>
  );
}
