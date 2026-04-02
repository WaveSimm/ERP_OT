"use client";

import { useRouter } from "next/navigation";

/* ─── 레이아웃 상수 ─────────────────────────────────────────────────
   모든 같은 직급 박스는 고정 높이 → 정확한 수직 정렬 보장
────────────────────────────────────────────────────────────────── */
const V_CEO_BAR  = 28;  // CEO → 가로바 거리
const V_BAR_ROW2 = 20;  // 가로바 → ROW2 박스 거리
const ROW2_H     = 62;  // ROW2 박스 고정 높이 (직속팀 & 총괄이사 동일)
const V_ROW2_BAR = 22;  // 총괄이사 → 가로바 거리
const V_BAR_ROW3 = 18;  // 가로바 → ROW3 박스 거리
const TEAM_H     = 52;  // ROW3 팀 박스 고정 높이

/* ─── 데이터 ─────────────────────────────────────────────────────── */
const CHAIRMEN = [
  { name: "홍성두", title: "회장" },
  { name: "이기욱", title: "부회장" },
];

type Team     = { dept: string; head: string };
type ExecNode = { name: string; title: string; teams: Team[] };
type CeoCol   = {
  name: string;
  cls: { ceo: string; exec: string; team: string; line: string };
  directTeams: Team[];
  execs: ExecNode[];
};

const COLS: CeoCol[] = [
  {
    name: "문홍배",
    cls: { ceo: "bg-blue-600 border-blue-700 text-white", exec: "bg-blue-50 border-blue-300 text-blue-900", team: "bg-sky-50 border-sky-300 text-sky-900", line: "#93c5fd" },
    directTeams: [{ dept: "영업1팀", head: "하선종" }, { dept: "영업2팀", head: "강성화" }],
    execs: [{ name: "모태준", title: "총괄이사", teams: [{ dept: "무인사업1팀", head: "모태준" }, { dept: "무인사업2팀", head: "이수현" }] }],
  },
  {
    name: "신용은",
    cls: { ceo: "bg-emerald-600 border-emerald-700 text-white", exec: "bg-emerald-50 border-emerald-300 text-emerald-900", team: "bg-teal-50 border-teal-300 text-teal-900", line: "#6ee7b7" },
    directTeams: [{ dept: "사업1팀", head: "고태호" }, { dept: "사업2팀", head: "황규하" }],
    execs: [{ name: "문기돈", title: "총괄이사", teams: [{ dept: "사업3팀", head: "유정연" }] }],
  },
  {
    name: "조혁만",
    cls: { ceo: "bg-violet-600 border-violet-700 text-white", exec: "bg-violet-50 border-violet-300 text-violet-900", team: "bg-purple-50 border-purple-300 text-purple-900", line: "#c4b5fd" },
    directTeams: [{ dept: "재무팀", head: "박고은" }],
    execs: [
      { name: "심윤송", title: "총괄이사", teams: [{ dept: "기술팀", head: "최창영" }] },
      { name: "김대현", title: "총괄이사", teams: [{ dept: "경영지원팀", head: "홍아름" }] },
    ],
  },
];

/* ─── 기본 요소 ─────────────────────────────────────────────────── */
function Line({ h, color }: { h: number; color: string }) {
  return <div style={{ width: 2, height: h, background: color, margin: "0 auto", flexShrink: 0 }} />;
}

/**
 * 자식 배열을 가로로 나열하면서 첫 자식 중앙 ↔ 끝 자식 중앙만 연결하는 가로선을 그립니다.
 * 각 자식이 gap/2 만큼 선을 확장해서 이음새 없이 연결.
 */
function Branch({
  items,
  gap,
  color,
  renderItem,
}: {
  items: unknown[];
  gap: number;
  color: string;
  renderItem: (item: unknown, i: number) => React.ReactNode;
}) {
  const n = items.length;
  const half = gap / 2;
  return (
    <div style={{ display: "flex", gap }}>
      {items.map((item, i) => {
        const isFirst = i === 0;
        const isLast  = i === n - 1;
        return (
          <div key={i} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
            {/* 이 자식의 가로선 구간: 첫 자식은 왼쪽 잘림, 끝 자식은 오른쪽 잘림 */}
            {n > 1 && (
              <div style={{
                position: "absolute",
                top: 0,
                left:  isFirst ? "50%"   : -half,
                right: isLast  ? "50%"   : -half,
                height: 2,
                background: color,
              }} />
            )}
            {renderItem(item, i)}
          </div>
        );
      })}
    </div>
  );
}

/* ─── 팀 박스 (ROW3) ─────────────────────────────────────────────── */
function TeamBox({ dept, head, cls }: { dept: string; head: string; cls: string }) {
  return (
    <div className={`border-2 rounded-xl text-center flex flex-col items-center justify-center ${cls}`}
      style={{ minWidth: 88, height: TEAM_H, padding: "0 12px" }}>
      <div className="font-bold text-sm leading-tight">{dept}</div>
      <div className="text-[11px] mt-0.5 opacity-70">팀장 {head}</div>
    </div>
  );
}

/* ─── 총괄이사 박스 + 아래 팀들 (ROW2 + ROW3) ──────────────────── */
function ExecGroup({ exec, cls }: { exec: ExecNode; cls: CeoCol["cls"] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {/* 총괄이사 박스 */}
      <div className={`border-2 rounded-xl text-center flex flex-col items-center justify-center shadow-sm ${cls.exec}`}
        style={{ minWidth: 92, height: ROW2_H, padding: "0 12px" }}>
        <div className="text-[10px] font-semibold opacity-50 mb-0.5">{exec.title}</div>
        <div className="font-bold text-sm">{exec.name}</div>
      </div>

      {exec.teams.length === 1 ? (
        <>
          <Line h={V_ROW2_BAR + V_BAR_ROW3} color={cls.line} />
          <TeamBox dept={exec.teams[0].dept} head={exec.teams[0].head} cls={cls.team} />
        </>
      ) : (
        <>
          <Line h={V_ROW2_BAR} color={cls.line} />
          <Branch items={exec.teams} gap={10} color={cls.line} renderItem={(t) => {
            const team = t as Team;
            return (
              <>
                <Line h={V_BAR_ROW3} color={cls.line} />
                <TeamBox dept={team.dept} head={team.head} cls={cls.team} />
              </>
            );
          }} />
        </>
      )}
    </div>
  );
}


/* ─── 대표이사 열 ─────────────────────────────────────────────────── */
function CeoColumn({ col }: { col: CeoCol }) {
  const { name, cls, directTeams, execs } = col;
  const row2Count = directTeams.length + execs.length;

  // row2Count === 1 일 때만 사용하는 단일 자식 렌더링
  const singleChild = row2Count === 1
    ? directTeams.length === 1
      ? (
          <>
            <Line h={V_BAR_ROW2 + ROW2_H + V_ROW2_BAR + V_BAR_ROW3} color={cls.line} />
            <TeamBox dept={directTeams[0].dept} head={directTeams[0].head} cls={cls.team} />
          </>
        )
      : (
          <>
            <Line h={V_BAR_ROW2} color={cls.line} />
            <ExecGroup exec={execs[0]} cls={cls} />
          </>
        )
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
      {/* CEO 박스 */}
      <div className={`border-2 rounded-2xl px-6 py-3 text-center shadow-md ${cls.ceo}`} style={{ minWidth: 120 }}>
        <div className="text-[10px] font-semibold opacity-60 tracking-widest mb-0.5">대표이사</div>
        <div className="font-extrabold text-lg leading-tight">{name}</div>
      </div>

      <Line h={V_CEO_BAR} color={cls.line} />

      {/* ROW2 — 단일이면 바로, 복수면 가로바 */}
      {row2Count === 1 ? (
        singleChild
      ) : (
        <Branch
          items={[...directTeams.map(t => ({ _type: "direct" as const, ...t })),
                  ...execs.map(e  => ({ _type: "exec"   as const, ...e  }))]}
          gap={12}
          color={cls.line}
          renderItem={(raw) => {
            const item = raw as ({ _type: "direct"; dept: string; head: string } | { _type: "exec"; name: string; title: string; teams: Team[] });
            if (item._type === "direct") {
              return (
                <>
                  <Line h={V_BAR_ROW2 + ROW2_H + V_ROW2_BAR + V_BAR_ROW3} color={cls.line} />
                  <TeamBox dept={item.dept} head={item.head} cls={cls.team} />
                </>
              );
            }
            return (
              <>
                <Line h={V_BAR_ROW2} color={cls.line} />
                <ExecGroup exec={item} cls={cls} />
              </>
            );
          }}
        />
      )}
    </div>
  );
}

/* ─── 페이지 ─────────────────────────────────────────────────────── */
export default function OrgChartPage() {
  const router = useRouter();

  return (
    <div className="p-6 min-h-screen bg-gray-50">
      <div className="flex items-center justify-between mb-10 max-w-6xl mx-auto">
        <div>
          <h1 className="text-xl font-bold text-gray-900">조직도</h1>
          <p className="text-sm text-gray-500 mt-1">오션테크(주) · 2026년 기준</p>
        </div>
        <button onClick={() => router.push("/admin/departments")} className="text-sm text-blue-600 hover:underline">
          ← 부서 관리
        </button>
      </div>

      <div className="overflow-x-auto pb-10">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 860 }}>

          {/* 회장단 */}
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl px-8 py-4 text-center shadow-sm"
            style={{ minWidth: 280 }}>
            <div className="text-xs font-semibold text-amber-500 tracking-widest mb-2">회장단</div>
            <div style={{ display: "flex", justifyContent: "center", gap: 40 }}>
              {CHAIRMEN.map((p) => (
                <div key={p.name}>
                  <div className="font-bold text-amber-900">{p.name}</div>
                  <div className="text-xs text-amber-700 mt-0.5">{p.title}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ height: 40 }} />

          {/* 대표이사 3열 */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 48 }}>
            {COLS.map((col) => <CeoColumn key={col.name} col={col} />)}
          </div>

        </div>
      </div>

      {/* 범례 */}
      <div className="mt-8 max-w-6xl mx-auto">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-500 mb-3">범례</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
            {[
              { cls: "bg-amber-100 border-amber-300",                label: "임원 · 회장단" },
              { cls: "bg-blue-600 border-blue-700 text-white",       label: "문홍배 대표이사" },
              { cls: "bg-emerald-600 border-emerald-700 text-white", label: "신용은 대표이사" },
              { cls: "bg-violet-600 border-violet-700 text-white",   label: "조혁만 대표이사" },
            ].map(({ cls, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className={`w-4 h-4 rounded border-2 ${cls}`} />
                <span className="text-xs text-gray-600">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
