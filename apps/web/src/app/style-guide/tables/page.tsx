"use client";

/**
 * 최종 표 레이아웃  (/style-guide/tables)
 * ------------------------------------------------------------------
 * 확정한 통일 규칙을 모두 적용한 실제 모습.
 *   - 표제목 바: 56px 고정, 제목 + 건수 + 우측 액션
 *   - 중제목:   회색 헤더, 상단 고정. 텍스트=좌 / 숫자=우 / 상태=가운데
 *   - 표내용:   행 높이 44px 고정, 긴 텍스트는 truncate(…)
 *   - 상태뱃지: 고정 8색 팔레트
 *   - 액션버튼: 평상시 회색 → hover 시 파랑(수정)/빨강(삭제) 채움 + 흰 글자
 *   - 세로선:   숫자 많은 표(정산)만 사용
 */

import { useEffect, useState } from "react";
import {
  TableCard,
  Table,
  THead,
  Th,
  TBody,
  Tr,
  Td,
  TableActions,
  RowButton,
  StatusBadge,
  type BadgeColor,
} from "@/components/ui/Table";

const ORDERS = [
  { id: 1, no: "PO-2026-0142", vendor: "센서테크", item: "온도센서 DS18B20", qty: 120, amount: 3_840_000, status: "승인", color: "green" as BadgeColor },
  { id: 2, no: "PO-2026-0141", vendor: "한빛계측", item: "압력 트랜스미터 4-20mA", qty: 12, amount: 9_360_000, status: "결재중", color: "amber" as BadgeColor },
  { id: 3, no: "PO-2026-0140", vendor: "대양전자", item: "PLC 확장 모듈", qty: 6, amount: 5_220_000, status: "반려", color: "red" as BadgeColor },
  { id: 4, no: "PO-2026-0139", vendor: "글로벌파츠", item: "스테인리스 밸브 2\"", qty: 40, amount: 1_600_000, status: "완료", color: "blue" as BadgeColor },
  { id: 5, no: "PO-2026-0138", vendor: "센서테크", item: "습도센서 SHT31", qty: 80, amount: 2_240_000, status: "작성", color: "gray" as BadgeColor },
];

const ATTENDANCE = [
  { id: 1, name: "김현수", dept: "생산1팀", checkIn: "08:52", checkOut: "18:07", ot: "1.2h", state: "정상", color: "green" as BadgeColor },
  { id: 2, name: "이지은", dept: "품질보증", checkIn: "09:14", checkOut: "18:30", ot: "0.0h", state: "지각", color: "amber" as BadgeColor },
  { id: 3, name: "박준영", dept: "설비보전", checkIn: "—", checkOut: "—", ot: "—", state: "연차", color: "purple" as BadgeColor },
  { id: 4, name: "최민서", dept: "생산2팀", checkIn: "08:45", checkOut: "21:36", ot: "3.6h", state: "정상", color: "green" as BadgeColor },
];

const won = (n: number) => n.toLocaleString() + "원";

export default function TableStyleGuidePage() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggleDark = () => {
    const el = document.documentElement;
    const next = !el.classList.contains("dark");
    el.classList.toggle("dark", next);
    try { localStorage.setItem("erp-theme", next ? "dark" : "light"); } catch {}
    setDark(next);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">최종 표 레이아웃</h1>
        <button
          onClick={toggleDark}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
        >
          {dark ? "☀️ 라이트 모드" : "🌙 다크 모드"}
        </button>
      </header>

      {/* 목록형: 제목 + 검색/등록 + 관리 버튼 */}
      <TableCard
        title="발주 목록"
        count={ORDERS.length}
        actions={
          <>
            <input
              placeholder="발주번호·거래처 검색…"
              className="w-48 rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
            />
            <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">
              + 발주 등록
            </button>
          </>
        }
      >
        <Table fixed columnDividers>
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[14%]" />
            <col className="w-[22%]" />
            <col className="w-[9%]" />
            <col className="w-[15%]" />
            <col className="w-[10%]" />
            <col className="w-[14%]" />
          </colgroup>
          <THead>
            <Th align="center">발주번호</Th>
            <Th align="center">거래처</Th>
            <Th align="center">품목</Th>
            <Th align="center">수량</Th>
            <Th align="center">금액</Th>
            <Th align="center">상태</Th>
            <Th align="center">관리</Th>
          </THead>
          <TBody>
            {ORDERS.map((o) => (
              <Tr key={o.id} onClick={() => {}}>
                <Td strong truncate>{o.no}</Td>
                <Td truncate title={o.vendor}>{o.vendor}</Td>
                <Td truncate title={o.item}>{o.item}</Td>
                <Td align="right" mono>{o.qty}</Td>
                <Td align="right" mono>{won(o.amount)}</Td>
                <Td align="center"><StatusBadge color={o.color}>{o.status}</StatusBadge></Td>
                <Td align="center" onClick={(e) => e.stopPropagation()}>
                  <TableActions>
                    <RowButton>수정</RowButton>
                    <RowButton danger>삭제</RowButton>
                  </TableActions>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>

      {/* 숫자 많은 표: 중제목 가운데 + 세로선 */}
      <TableCard title="정산 내역" count={ORDERS.length}>
        <Table fixed columnDividers>
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-[10%]" />
            <col className="w-[18%]" />
            <col className="w-[16%]" />
            <col className="w-[18%]" />
            <col className="w-[12%]" />
          </colgroup>
          <THead>
            <Th align="center">거래처</Th>
            <Th align="center">수량</Th>
            <Th align="center">공급가</Th>
            <Th align="center">세액</Th>
            <Th align="center">합계</Th>
            <Th align="center">상태</Th>
          </THead>
          <TBody>
            {ORDERS.map((o) => (
              <Tr key={o.id}>
                <Td strong truncate title={o.vendor}>{o.vendor}</Td>
                <Td align="right" mono>{o.qty}</Td>
                <Td align="right" mono>{won(o.amount)}</Td>
                <Td align="right" mono>{won(Math.round(o.amount * 0.1))}</Td>
                <Td align="right" mono>{won(Math.round(o.amount * 1.1))}</Td>
                <Td align="center"><StatusBadge color={o.color}>{o.status}</StatusBadge></Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>

      {/* 컴팩트 목록 */}
      <TableCard title="근태 현황" count={ATTENDANCE.length}>
        <Table columnDividers>
          <THead>
            <Th align="center">이름</Th>
            <Th align="center">부서</Th>
            <Th align="center">출근</Th>
            <Th align="center">퇴근</Th>
            <Th align="center">연장</Th>
            <Th align="center">상태</Th>
          </THead>
          <TBody>
            {ATTENDANCE.map((a) => (
              <Tr key={a.id}>
                <Td strong>{a.name}</Td>
                <Td>{a.dept}</Td>
                <Td align="center" mono>{a.checkIn}</Td>
                <Td align="center" mono>{a.checkOut}</Td>
                <Td align="center" mono>{a.ot}</Td>
                <Td align="center"><StatusBadge color={a.color}>{a.state}</StatusBadge></Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableCard>
    </div>
  );
}
