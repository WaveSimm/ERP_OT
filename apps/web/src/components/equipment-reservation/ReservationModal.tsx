"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DateInput } from "@/components/ui/DateInput";
import { TimeInput } from "@/components/ui/TimeInput";
import {
  equipmentReservationApi,
  reservationAttachmentApi,
  type EquipmentResource,
  type ReservationInstance,
  type ReservationRecurrence,
} from "@/lib/api";
import ReservationAttachmentSection from "./ReservationAttachmentSection";

// 공용자산예약 (2026-05-05) — 등록·수정 모달
//
// 정책:
// - 시간 단위 30분
// - 단발 또는 반복 (매일/매주/매월) + 종료일 또는 횟수
// - 충돌 시 서버가 409 — 응답 conflicts 표시
// - 반복 시리즈 인스턴스 단일 수정은 1차 미지원 (서버 400) — UI에서도 차단

const WEEKDAYS = [
  { value: "MON", label: "월" },
  { value: "TUE", label: "화" },
  { value: "WED", label: "수" },
  { value: "THU", label: "목" },
  { value: "FRI", label: "금" },
  { value: "SAT", label: "토" },
  { value: "SUN", label: "일" },
] as const;

interface Props {
  /** 수정 시 인스턴스 객체. 신규는 null */
  entry: ReservationInstance | null;
  /** 신규 등록 시 기본 자원 (옵션) */
  defaultResourceId?: string;
  /** 신규 등록 시 기본 시작 일자 (YYYY-MM-DD, 옵션) */
  defaultDate?: string;
  /** 신규 등록 시 기본 시작 시간 (HH:mm, 옵션 — 일 뷰의 빈 슬롯 클릭 시 전달) */
  defaultStartTime?: string;
  /** 활성 자원 목록 (부모에서 fetch해서 전달) */
  resources: EquipmentResource[];
  onClose: () => void;
  onSaved: () => void;
}

interface ConflictItem {
  instanceKey: string;
  startAt: string;
  endAt: string;
  title: string;
  userId: string;
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseIsoToLocal(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { date, time };
}

function localToIso(date: string, time: string): string {
  // 사용자 입력 (KST 가정) → UTC ISO
  const [h, m] = time.split(":").map(Number);
  const [y, mo, d] = date.split("-").map(Number);
  const local = new Date(y!, mo! - 1, d!, h ?? 0, m ?? 0, 0, 0);
  return local.toISOString();
}

function isHalfHour(time: string): boolean {
  const [, m] = time.split(":").map(Number);
  return m !== undefined && (m === 0 || m === 30);
}

/** 30분 단위로 자동 스냅 (사용자가 1분 단위로 입력해도 30/60분으로 보정) */
function snapTo30(time: string): string {
  if (!time) return time;
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const snapped = Math.round(m / 30) * 30;
  let newH = h;
  let newM = snapped;
  if (newM === 60) {
    newH = (h + 1) % 24;
    newM = 0;
  }
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

export default function ReservationModal({
  entry,
  defaultResourceId,
  defaultDate,
  defaultStartTime,
  resources,
  onClose,
  onSaved,
}: Props) {
  const isEdit = !!entry;
  const isRecurringEdit = !!entry?.isRecurring;

  // 자원
  const [resourceId, setResourceId] = useState<string>(
    entry?.resourceId ?? defaultResourceId ?? resources[0]?.id ?? "",
  );

  // 종일/시간
  const [isAllDay, setIsAllDay] = useState<boolean>(entry?.isAllDay ?? false);

  // 시작·종료
  // 기본 근무 시작 시간 09:30 (사용자 정책 2026-05-05). 종료는 시작 + 1시간.
  // 일 뷰의 빈 슬롯 클릭 시 defaultStartTime이 전달되면 그 시각 + 1시간으로 설정.
  function plus1Hour(t: string): string {
    const [h, m] = t.split(":").map(Number);
    const total = (h ?? 0) * 60 + (m ?? 0) + 60;
    const newH = Math.floor(total / 60) % 24;
    const newM = total % 60;
    return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
  }
  const initStartTime = defaultStartTime ?? "09:30";
  const initEndTime = plus1Hour(initStartTime);
  const initialStart = entry ? parseIsoToLocal(entry.startAt) : { date: defaultDate ?? isoDate(new Date()), time: initStartTime };
  const initialEnd = entry ? parseIsoToLocal(entry.endAt) : { date: defaultDate ?? isoDate(new Date()), time: initEndTime };
  const [startDate, setStartDate] = useState<string>(initialStart.date);
  const [startTime, setStartTime] = useState<string>(initialStart.time);
  const [endDate, setEndDate] = useState<string>(initialEnd.date);
  const [endTime, setEndTime] = useState<string>(initialEnd.time);

  // 사유·비고
  const [title, setTitle] = useState<string>(entry?.title ?? "");
  const [description, setDescription] = useState<string>(entry?.description ?? "");

  // 예약 유형 (대여/차량정비) — 차량정비는 차량 자원에서만. 주행거리는 정비만.
  const selectedResource = resources.find((r) => r.id === resourceId);
  const isVehicle = selectedResource?.type === "VEHICLE";
  const [logType, setLogType] = useState<"RENTAL" | "MAINTENANCE">(entry?.logType ?? "RENTAL");
  const [mileage, setMileage] = useState<string>(entry?.mileage != null ? String(entry.mileage) : "");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // 차량이 아니면 항상 대여로
  useEffect(() => { if (!isVehicle && logType !== "RENTAL") setLogType("RENTAL"); }, [isVehicle, logType]);

  // 반복 (수정 모드에서는 1차 비활성 — 서버가 시리즈 부분 수정 미지원, 시리즈 전체 변경만 허용)
  const [recurEnabled, setRecurEnabled] = useState<boolean>(isRecurringEdit);
  const [freq, setFreq] = useState<"DAILY" | "WEEKLY" | "MONTHLY">("WEEKLY");
  const [interval, setIntervalVal] = useState<number>(1);
  const [byWeekday, setByWeekday] = useState<string[]>([]);
  const [endMode, setEndMode] = useState<"until" | "count">("until");
  const [until, setUntil] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return isoDate(d);
  });
  const [count, setCount] = useState<number>(10);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);

  // 종일 토글 시 시간 초기화
  useEffect(() => {
    if (isAllDay) {
      setStartTime("00:00");
      setEndTime("00:00");
    }
  }, [isAllDay]);

  // 시작 날짜 변경 → 종료 날짜 항상 같은 날로 동기화
  useEffect(() => {
    if (startDate) setEndDate(startDate);
  }, [startDate]);

  // 시작 시간 변경 → 종료 시간을 시작 + 1시간으로 자동 (종일 모드는 제외)
  useEffect(() => {
    if (isAllDay || !startTime) return;
    const [h, m] = startTime.split(":").map(Number);
    const total = (h ?? 0) * 60 + (m ?? 0) + 60;
    const newH = Math.floor(total / 60) % 24;
    const newM = total % 60;
    setEndTime(`${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`);
  }, [startTime, isAllDay]);

  function toggleWeekday(w: string) {
    setByWeekday((prev) => (prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w]));
  }

  function buildRecurrence(): ReservationRecurrence | null {
    if (!recurEnabled) return null;
    const rec: ReservationRecurrence = { freq };
    if (interval > 1) rec.interval = interval;
    if (freq === "WEEKLY" && byWeekday.length > 0) {
      rec.byWeekday = byWeekday as ReservationRecurrence["byWeekday"];
    }
    if (endMode === "until") rec.until = until;
    else rec.count = count;
    return rec;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setConflicts([]);

    if (!resourceId) return setError("자원을 선택해주세요.");
    if (!title.trim()) return setError("사유를 입력해주세요.");
    if (!isAllDay) {
      if (!isHalfHour(startTime) || !isHalfHour(endTime)) {
        return setError("시간은 30분 단위로 입력해주세요.");
      }
    }
    if (startDate > endDate || (startDate === endDate && startTime >= endTime && !isAllDay)) {
      return setError("종료시각은 시작시각보다 늦어야 합니다.");
    }

    let startIso: string;
    let endIso: string;
    if (isAllDay) {
      startIso = localToIso(startDate, "00:00");
      const next = new Date(endDate);
      next.setDate(next.getDate() + 1);
      endIso = localToIso(isoDate(next), "00:00");
    } else {
      startIso = localToIso(startDate, startTime);
      endIso = localToIso(endDate, endTime);
    }

    const recurrence = buildRecurrence();

    if (recurEnabled && freq === "WEEKLY" && byWeekday.length === 0) {
      return setError("반복 요일을 1개 이상 선택해주세요.");
    }

    setSubmitting(true);
    try {
      const mileageVal = logType === "MAINTENANCE" && mileage.trim() ? parseInt(mileage, 10) : null;
      if (isEdit) {
        await equipmentReservationApi.update(entry!.id, {
          title: title.trim(),
          description: description.trim() || null,
          startAt: startIso,
          endAt: endIso,
          isAllDay,
          recurrence: recurrence ?? null,
          logType,
          mileage: mileageVal,
        }, "series");
      } else {
        const created = await equipmentReservationApi.create({
          resourceId,
          title: title.trim(),
          description: description.trim() || null,
          startAt: startIso,
          endAt: endIso,
          isAllDay,
          recurrence: recurrence ?? null,
          logType,
          mileage: mileageVal,
        });
        // 신규 예약 생성 후 대기 중 첨부 업로드
        for (const f of pendingFiles) {
          const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name);
          await reservationAttachmentApi.upload(created.id, f, isImg ? "IMAGE" : "FILE").catch(() => {});
        }
      }
      onSaved();
    } catch (err: any) {
      const code = err?.body?.code ?? err?.code;
      const conflictsArr = err?.body?.details?.conflicts as ConflictItem[] | undefined;
      if (code === "RESERVATION_CONFLICT" && conflictsArr && conflictsArr.length > 0) {
        setConflicts(conflictsArr);
        setError(`${conflictsArr.length}건의 시간 겹치는 예약이 있습니다.`);
      } else if (code === "UNSUPPORTED_PARTIAL_UPDATE") {
        setError("반복 시리즈의 인스턴스 단일 수정은 지원되지 않습니다. 해당 인스턴스를 취소 후 신규 등록하세요.");
      } else {
        setError(err?.body?.message ?? err?.message ?? "저장 실패");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const resourceOptions = useMemo(
    () => resources.filter((r) => r.isActive).map((r) => ({ ...r, icon: r.type === "VEHICLE" ? "🚗" : "🏭" })),
    [resources],
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-lg font-bold text-gray-900">{isEdit ? "예약 수정" : "+ 예약 추가"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 자원 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">자원</label>
            <select
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
              disabled={isEdit}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
              required
            >
              {resourceOptions.length === 0 && <option value="">활성 자원 없음</option>}
              {resourceOptions.map((r) => (
                <option key={r.id} value={r.id}>{r.icon} {r.name}</option>
              ))}
            </select>
            {isEdit && <p className="text-[11px] text-gray-400 mt-1">자원은 수정할 수 없습니다.</p>}
          </div>

          {/* 유형 (차량 자원만) */}
          {isVehicle && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">유형</label>
              <div className="flex gap-2">
                {(["RENTAL", "MAINTENANCE"] as const).map((t) => (
                  <button
                    type="button"
                    key={t}
                    onClick={() => setLogType(t)}
                    className={`flex-1 px-3 py-2 text-sm rounded-lg border ${
                      logType === t
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {t === "RENTAL" ? "대여" : "차량정비"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 종일 토글 */}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isAllDay} onChange={(e) => setIsAllDay(e.target.checked)} />
            종일
          </label>

          {/* 시작 / 종료 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">시작</label>
              <DateInput
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
                required
              />
              {!isAllDay && (
                <TimeInput
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  onBlur={(e) => setStartTime(snapTo30(e.target.value))}
                  step={1800}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  required
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">종료</label>
              <DateInput
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2"
                required
              />
              {!isAllDay && (
                <TimeInput
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  onBlur={(e) => setEndTime(snapTo30(e.target.value))}
                  step={1800}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  required
                />
              )}
            </div>
          </div>

          {/* 반복 */}
          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={recurEnabled}
                onChange={(e) => setRecurEnabled(e.target.checked)}
                disabled={isEdit && isRecurringEdit}
              />
              반복
              {isEdit && isRecurringEdit && (
                <span className="text-[11px] text-gray-400">시리즈 전체 변경 (이 인스턴스만 수정은 미지원)</span>
              )}
            </label>
            {recurEnabled && (
              <div className="space-y-2 pl-6">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500">매</span>
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={interval}
                    onChange={(e) => setIntervalVal(parseInt(e.target.value, 10) || 1)}
                    className="w-14 border border-gray-300 rounded px-2 py-1 text-sm"
                  />
                  <select
                    value={freq}
                    onChange={(e) => setFreq(e.target.value as any)}
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                  >
                    <option value="DAILY">일</option>
                    <option value="WEEKLY">주</option>
                    <option value="MONTHLY">월</option>
                  </select>
                </div>
                {freq === "WEEKLY" && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-xs text-gray-500 mr-1">요일:</span>
                    {WEEKDAYS.map((w) => (
                      <button
                        type="button"
                        key={w.value}
                        onClick={() => toggleWeekday(w.value)}
                        className={`px-2 py-1 text-xs rounded border ${
                          byWeekday.includes(w.value)
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={endMode === "until"} onChange={() => setEndMode("until")} />
                    <span className="text-xs text-gray-500">종료일</span>
                    <DateInput
                      value={until}
                      onChange={(e) => setUntil(e.target.value)}
                      disabled={endMode !== "until"}
                      className="border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-100"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={endMode === "count"} onChange={() => setEndMode("count")} />
                    <span className="text-xs text-gray-500">횟수</span>
                    <input
                      type="number"
                      min={1}
                      max={366}
                      value={count}
                      onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)}
                      disabled={endMode !== "count"}
                      className="w-16 border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-100"
                    />
                    <span className="text-xs text-gray-500">회</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* 사유 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">사유</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="예: Q2 임원회의, 고객사 출장"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>

          {/* 비고 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              비고 <span className="text-xs text-gray-400 ml-1">(선택)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={1000}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y"
            />
          </div>

          {/* 주행거리 (차량정비만) */}
          {isVehicle && logType === "MAINTENANCE" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                주행거리 (km) <span className="text-xs text-gray-400 ml-1">(선택)</span>
              </label>
              <input
                type="number"
                min={0}
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                placeholder="예: 45200"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          )}

          {/* 첨부 (차량 자원 — 대여·정비 모두 선택) */}
          {isVehicle && (
            <div className="border border-gray-200 rounded-lg p-3">
              {isEdit ? (
                <ReservationAttachmentSection reservationId={entry!.id} />
              ) : (
                <PendingFilePicker files={pendingFiles} onChange={setPendingFiles} />
              )}
            </div>
          )}

          {/* 에러 + 충돌 */}
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700 dark:text-red-300">
              {error}
              {conflicts.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs">
                  {conflicts.slice(0, 5).map((c) => {
                    const s = new Date(c.startAt);
                    const e = new Date(c.endAt);
                    const fmt = (d: Date) =>
                      `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
                    return (
                      <li key={c.instanceKey}>
                        • {fmt(s)}~{fmt(e)} — {c.title}
                      </li>
                    );
                  })}
                  {conflicts.length > 5 && <li>… 외 {conflicts.length - 5}건</li>}
                </ul>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 border border-gray-300 rounded-lg py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "저장 중..." : isEdit ? "저장" : "등록"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// 신규 예약용 대기 첨부 선택기 — 예약 생성 후 일괄 업로드
function PendingFilePicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-500 uppercase">
          📎 첨부 <span className="normal-case text-gray-400 font-normal">(등록 후 업로드)</span>
        </h3>
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="px-2.5 py-1 text-xs border border-gray-300 rounded-lg hover:bg-gray-50"
        >파일 선택</button>
      </div>
      <input
        ref={ref}
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
        className="hidden"
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (fs.length) onChange([...files, ...fs]);
        }}
      />
      {files.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-2">선택된 파일이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="flex-1 truncate text-gray-800 dark:text-gray-100">{f.name}</span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="text-gray-300 hover:text-red-500"
              >×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
