"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  equipmentResourceApi,
  equipmentReservationApi,
  type EquipmentResource,
  type ReservationInstance,
} from "@/lib/api";
import { fmtDate } from "@/lib/datetime";
import { TableCard, Table, THead, Th, TBody, Tr, Td, TableEmpty, StatusBadge } from "@/components/ui/Table";
import { DateInput } from "@/components/ui/DateInput";
import ReservationDetailPopover from "@/components/equipment-reservation/ReservationDetailPopover";

// 공용자산(차량) 상세 — 이력(대여/차량정비) 뷰 (2026-07-21)
//   생성·수정은 자원관리 > 공용자산 예약 캘린더에서. 여기선 열람·다운로드만.

const TYPE_LABEL: Record<string, string> = { VEHICLE: "🚗 차량", FACILITY: "🏭 시설" };

type LabelFilter = "ALL" | "RENTAL" | "MAINTENANCE";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

// 기간을 한 줄로: { date: 연-월-일 요일, time: 시간범위 } — 날짜·시간을 나란히 표시
function periodInline(startAt: string, endAt: string, isAllDay: boolean): { date: string; time: string } {
  const p = (n: number) => String(n).padStart(2, "0");
  const s = new Date(startAt);
  const e = new Date(endAt);
  const dp = (x: Date) => `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} (${WEEKDAY[x.getDay()]})`;
  const tp = (x: Date) => `${p(x.getHours())}:${p(x.getMinutes())}`;
  if (isAllDay) {
    const dispEnd = new Date(e.getTime() - 1); // endAt는 다음날 00:00(배타) → 실제 마지막 날
    return s.toDateString() === dispEnd.toDateString()
      ? { date: dp(s), time: "종일" }
      : { date: dp(s), time: `~ ${dp(dispEnd)} 종일` };
  }
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay
    ? { date: dp(s), time: `${tp(s)} ~ ${tp(e)}` }
    : { date: dp(s), time: `${tp(s)} ~ ${dp(e)} ${tp(e)}` };
}

type Period = "3m" | "6m" | "1y" | "3y";

// 이력 조회 윈도우: 선택 기간(과거) ~ 미래 6개월. 프리셋은 유계(성능). 그보다 오래된 자료는 날짜 선택 필터로 조회.
function historyWindow(period: Period) {
  const now = new Date();
  const to = new Date(now); to.setMonth(to.getMonth() + 6);
  const from = new Date(now);
  if (period === "3m") from.setMonth(from.getMonth() - 3);
  else if (period === "6m") from.setMonth(from.getMonth() - 6);
  else if (period === "1y") from.setFullYear(from.getFullYear() - 1);
  else from.setFullYear(from.getFullYear() - 3);
  return { from: fmtDate(from), to: fmtDate(to) };
}

export default function EquipmentResourceDetailPage() {
  const params = useParams();
  const id = String(params.id);

  const [resource, setResource] = useState<EquipmentResource | null>(null);
  const [items, setItems] = useState<ReservationInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<LabelFilter>("ALL");
  const [period, setPeriod] = useState<Period>("1y");
  // 날짜 선택 필터: 둘 다 채워지면 프리셋 대신 이 범위로 조회(프리셋 상한보다 오래된 자료 조회용).
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const customActive = Boolean(customFrom && customTo);
  const [selected, setSelected] = useState<ReservationInstance | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const { from, to } = customFrom && customTo
      ? { from: customFrom, to: customTo }
      : historyWindow(period);
    Promise.all([
      equipmentResourceApi.get(id),
      equipmentReservationApi.list({ resourceId: id, from, to }),
    ])
      .then(([res, list]) => {
        if (!alive) return;
        setResource(res);
        setItems((list ?? []).sort((a, b) => b.startAt.localeCompare(a.startAt)));
      })
      .catch(() => { if (alive) { setResource(null); setItems([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, period, customFrom, customTo]);

  const shown = useMemo(
    () => (filter === "ALL" ? items : items.filter((r) => r.logType === filter)),
    [items, filter],
  );

  const reload = () => {
    const { from, to } = customFrom && customTo
      ? { from: customFrom, to: customTo }
      : historyWindow(period);
    equipmentReservationApi
      .list({ resourceId: id, from, to })
      .then((list) => setItems((list ?? []).sort((a, b) => b.startAt.localeCompare(a.startAt))))
      .catch(() => {});
  };

  const FILTERS: Array<[LabelFilter, string]> = [["ALL", "전체"], ["RENTAL", "대여"], ["MAINTENANCE", "차량정비"]];
  const PERIODS: Array<[Period, string]> = [["3m", "3개월"], ["6m", "6개월"], ["1y", "1년"], ["3y", "3년"]];
  const pillCls = (active: boolean) =>
    `px-3 py-1 text-xs rounded-full border ${
      active
        ? "bg-blue-600 text-white border-blue-600"
        : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600"
    }`;

  return (
    <div>
      <Link href="/management/equipment-resources" className="text-sm text-gray-500 hover:text-gray-700">← 공용자산 관리</Link>

      {/* 기본정보 */}
      <div className="mt-3 mb-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-5 py-4">
        {loading && !resource ? (
          <p className="text-sm text-gray-400">불러오는 중…</p>
        ) : !resource ? (
          <p className="text-sm text-gray-400">자원을 찾을 수 없습니다.</p>
        ) : (
          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold text-gray-900 dark:text-gray-100">{resource.name}</h1>
            <span className="text-xs text-gray-500">{TYPE_LABEL[resource.type] ?? resource.type}</span>
            <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${
              resource.isActive
                ? "bg-green-50 text-green-700 border-green-200 dark:text-green-300"
                : "bg-gray-100 text-gray-500 border-gray-200"
            }`}>
              {resource.isActive ? "활성" : "비활성"}
            </span>
          </div>
        )}
      </div>

      {/* 이력 */}
      <TableCard
        title="이력"
        count={shown.length}
        actions={
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-gray-400 mr-0.5">기간</span>
            {PERIODS.map(([v, label]) => (
              <button
                key={v}
                onClick={() => { setPeriod(v); setCustomFrom(""); setCustomTo(""); }}
                className={pillCls(!customActive && period === v)}
              >
                {label}
              </button>
            ))}
            <DateInput
              value={customFrom}
              max={customTo || "2100-12-31"}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-6 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1 text-[11px] text-gray-700 dark:text-gray-200"
            />
            <span className="text-[11px] text-gray-400">~</span>
            <DateInput
              value={customTo}
              min={customFrom || "1900-01-01"}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-6 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1 text-[11px] text-gray-700 dark:text-gray-200"
            />
            {customActive && (
              <button
                onClick={() => { setCustomFrom(""); setCustomTo(""); }}
                className="text-[11px] text-gray-400 hover:text-gray-600 underline"
              >
                초기화
              </button>
            )}
            <span className="mx-1.5 h-4 w-px bg-gray-200 dark:bg-gray-700" />
            <span className="text-[11px] text-gray-400 mr-0.5">유형</span>
            {FILTERS.map(([v, label]) => (
              <button key={v} onClick={() => setFilter(v)} className={pillCls(filter === v)}>{label}</button>
            ))}
          </div>
        }
      >
        <Table fixed columnDividers>
          <colgroup>
            <col className="w-[8%]" />   {/* 유형 — 좁게 */}
            <col className="w-[14%]" />  {/* 이름 */}
            <col className="w-[24%]" />  {/* 기간 — 날짜+시간 한 줄 */}
            <col className="w-[8%]" />   {/* 예약자 — 좁게 */}
            <col className="w-[18%]" />  {/* 사유 */}
            <col className="w-[10%]" />  {/* 주행거리 */}
            <col className="w-[18%]" />  {/* 비고 — 넓게 */}
          </colgroup>
          <THead>
            <Th align="center">유형</Th>
            <Th align="center">이름</Th>
            <Th align="center">기간</Th>
            <Th align="center">예약자</Th>
            <Th align="center">사유</Th>
            <Th align="center">주행거리</Th>
            <Th align="center">비고</Th>
          </THead>
          <TBody>
            {loading ? (
              <TableEmpty colSpan={7}>불러오는 중…</TableEmpty>
            ) : shown.length === 0 ? (
              <TableEmpty colSpan={7}>이력이 없습니다.</TableEmpty>
            ) : (
              shown.map((r) => (
                <Tr key={r.instanceKey} onClick={() => setSelected(r)}>
                  <Td align="center">
                    <StatusBadge color={r.logType === "MAINTENANCE" ? "purple" : "blue"}>
                      {r.logType === "MAINTENANCE" ? "차량정비" : "대여"}
                    </StatusBadge>
                  </Td>
                  <Td strong truncate>{r.resourceName}</Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    {(() => {
                      const { date, time } = periodInline(r.startAt, r.endAt, r.isAllDay);
                      return (
                        <>
                          {r.isRecurring && <span className="mr-1 font-bold text-gray-400">↻</span>}
                          <span className="font-medium text-gray-800 dark:text-gray-100">{date}</span>
                          <span className="ml-1.5 text-gray-600 dark:text-gray-300">{time}</span>
                        </>
                      );
                    })()}
                  </Td>
                  <Td dash>{r.userName}</Td>
                  <Td truncate>{r.title}</Td>
                  <Td align="right" mono dash>
                    {r.mileage != null ? `${r.mileage.toLocaleString()} km` : null}
                  </Td>
                  <Td truncate muted dash>{r.description}</Td>
                </Tr>
              ))
            )}
          </TBody>
        </Table>
      </TableCard>

      {selected && (
        <ReservationDetailPopover
          instance={selected}
          canModify={false}
          onClose={() => setSelected(null)}
          onEdit={() => {}}
          onChanged={reload}
          wide
        />
      )}
    </div>
  );
}
