"use client";

// 계약 마이그레이션 — References/contracts/YYYY년 계약파일리스트.xlsx 파서 (브라우저용).
//   scripts/import-contracts.py 로직 포팅.
//   - 헤더는 '거래처'+'계약건명/품명'이 같이 있는 행(보통 R2). 그 다음 행부터 데이터.
//   - 연도마다 컬럼 위치가 달라 '헤더명 기반' 매핑.
//   - contractNumber = #YY-{A열 연번}  (기존 DB와 동일 형식). 이게 중복 판정 키.
import * as XLSX from "xlsx";

export type ParsedContract = {
  contractNumber: string;
  name: string;
  client: string;
  clientContact: string | null;
  manufacturer: string | null;
  category: string;
  contractType: string;
  contractDate: string | null;
  deadline: string | null;
  manager: string | null;
  notes: string | null;
  year: string;
};

export type ParseResult = {
  records: ParsedContract[];
  skipped: number; // 이름/연번 누락으로 건너뛴 데이터행 수
  year: string | null;
};

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, "").trim();

function findHeaderRow(rows: any[][]): number {
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const cells = (rows[i] ?? []).map(norm);
    if (cells.some((c) => c.includes("거래처")) && cells.some((c) => c.includes("계약건명") || c.includes("품명"))) {
      return i;
    }
  }
  return 2;
}

function colMap(header: any[]): Record<string, number> {
  const cells = (header ?? []).map(norm);
  const m: Record<string, number> = {};
  cells.forEach((c, i) => {
    if (!c) return;
    if (c.includes("거래처") && m.client == null) m.client = i;
    else if (c === "담당" && m.clientContact == null) m.clientContact = i;
    else if (c.includes("제작사") && m.manufacturer == null) m.manufacturer = i;
    else if ((c.includes("계약건명") || c.includes("품명")) && m.name == null) m.name = i;
    else if (c === "구분" && m.category == null) m.category = i;
    else if (c.includes("계약종류") && m.contractType == null) m.contractType = i;
    else if (c.includes("계약일자") && m.contractDate == null) m.contractDate = i;
    else if (c === "납기" && m.deadline == null) m.deadline = i;
    else if ((c.startsWith("계약담당") || c === "담당자") && m.manager == null) m.manager = i;
    else if (c === "비고" && m.notes == null) m.notes = i;
  });
  return m;
}

function asDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

const cat = (v: unknown) => (norm(v).includes("용역") ? "용역" : "물품");
const ctype = (v: unknown) => (norm(v).includes("외자") ? "외자" : "내자");

/** 파일명에서 4자리 연도 추출 → YY */
function yearFromName(fileName: string): string | null {
  const m = fileName.match(/(20\d{2})/);
  return m ? m[1].slice(2) : null;
}

export async function parseContractWorkbook(file: File): Promise<ParseResult> {
  const yy = yearFromName(file.name);
  if (!yy) {
    throw new Error(`파일명에서 연도를 찾을 수 없습니다. '2026년 계약파일리스트.xlsx' 형식이어야 합니다. (입력: ${file.name})`);
  }

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as any[][];

  const hidx = findHeaderRow(rows);
  const m = colMap(rows[hidx] ?? []);
  if (m.name == null) {
    throw new Error("'계약건명/품명' 컬럼을 찾지 못했습니다. 양식을 확인해주세요.");
  }

  const records: ParsedContract[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (let r = hidx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const cell = (key: string) => {
      const i = m[key];
      return i != null && i < row.length ? row[i] : null;
    };
    const seq = row.length > 0 ? row[0] : null;
    const name = cell("name");

    if (!(name && norm(name))) continue; // 빈 행
    if (typeof seq !== "number") {
      skipped++; // 연번 없는 데이터행
      continue;
    }
    const cnum = `#${yy}-${Math.trunc(seq)}`;
    if (seen.has(cnum)) continue; // 파일 내 중복 연번
    seen.add(cnum);

    const s = (v: unknown, max: number) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));
    records.push({
      contractNumber: cnum,
      name: String(name).trim().slice(0, 200),
      client: cell("client") ? String(cell("client")).trim().slice(0, 200) : "",
      clientContact: s(cell("clientContact"), 100),
      manufacturer: s(cell("manufacturer"), 200),
      category: cat(cell("category")),
      contractType: ctype(cell("contractType")),
      contractDate: asDate(cell("contractDate")),
      deadline: asDate(cell("deadline")),
      manager: s(cell("manager"), 100),
      notes: s(cell("notes"), 500),
      year: "20" + yy,
    });
  }

  return { records, skipped, year: "20" + yy };
}
