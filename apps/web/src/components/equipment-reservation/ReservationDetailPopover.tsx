"use client";

import { useState } from "react";
import { equipmentReservationApi, type ReservationInstance } from "@/lib/api";
import { RowButton } from "@/components/ui/Table";

// 공용자산예약 (2026-05-05) — 인스턴스 상세 + 수정/취소 버튼

interface Props {
  instance: ReservationInstance;
  /** 본인이거나 ADMIN/MANAGER이면 true (수정·취소 버튼 노출) */
  canModify: boolean;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;  // 취소 후 리로드
}

function fmtDateTime(iso: string, isAllDay: boolean): string {
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (isAllDay) return date;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${date} ${time}`;
}

export default function ReservationDetailPopover({ instance, canModify, onClose, onEdit, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancelInstance() {
    if (!confirm(`이 인스턴스(${fmtDateTime(instance.startAt, instance.isAllDay)})만 취소할까요?`)) return;
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
      setError(err?.body?.message ?? err?.message ?? "취소 실패");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelSeries() {
    const msg = instance.isRecurring
      ? `반복 시리즈 전체를 취소할까요? (${instance.recurrenceSummary})`
      : `예약을 취소할까요?\n사유: ${instance.title}`;
    if (!confirm(msg)) return;
    setBusy(true);
    setError(null);
    try {
      await equipmentReservationApi.cancel(instance.parentId ?? instance.id, { scope: "series" });
      onChanged();
      onClose();
    } catch (err: any) {
      setError(err?.body?.message ?? err?.message ?? "취소 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 truncate">{instance.title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">자원</span>
            <span className="font-medium text-gray-900">{instance.resourceName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">예약자</span>
            <span className="text-gray-900">{instance.userName ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">시작</span>
            <span className="text-gray-900 font-mono text-xs">{fmtDateTime(instance.startAt, instance.isAllDay)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">종료</span>
            <span className="text-gray-900 font-mono text-xs">{fmtDateTime(instance.endAt, instance.isAllDay)}</span>
          </div>
          {instance.isRecurring && (
            <div className="flex justify-between">
              <span className="text-gray-500">반복</span>
              <span className="text-gray-900 text-xs">{instance.recurrenceSummary}</span>
            </div>
          )}
          {instance.isException && (
            <div className="px-2 py-1 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 dark:text-amber-300">
              이 인스턴스는 시리즈에서 예외 처리된 항목입니다.
            </div>
          )}
          {instance.description && (
            <div>
              <div className="text-gray-500 mb-1">비고</div>
              <div className="bg-gray-50 border border-gray-200 rounded p-2 text-gray-700 text-xs whitespace-pre-wrap">
                {instance.description}
              </div>
            </div>
          )}
          {error && (
            <div className="px-2 py-1 bg-red-50 border border-red-200 rounded text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        {canModify && (
          <div className="px-5 py-3 border-t border-gray-200 flex gap-2">
            {instance.isRecurring && !instance.isException && (
              <RowButton type="button" tone="orange" onClick={handleCancelInstance} disabled={busy}>
                이 인스턴스만 취소
              </RowButton>
            )}
            <RowButton type="button" danger onClick={handleCancelSeries} disabled={busy}>
              {instance.isRecurring ? "시리즈 전체 취소" : "취소"}
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
