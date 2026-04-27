// SA-2026-xxxx 20건의 notes 필드에서 이벤트 날짜를 추출해 구조화된 필드로 분리 (preview + SQL)
// 년도: 모두 2026
//
// 라벨 매핑:
//   입고(단독) / 최초 입고 → stockedAt
//   기술팀 인계 / 기술부 수리요청 → handedToTechAt
//   제조사 발송 / 해외 발송 / 선적 → Shipment.OUTBOUND.shippedAt
//   제조사 도착 / 제조사 입고 → Shipment.OUTBOUND.receivedAt (OR create Shipment)
//   본사 도착 / 반납 / (본사) 입고 (2차) → Shipment.INBOUND.receivedAt
//   Quote 수신 → quoteReceivedAt
//   견적서 발송 / 견적 확정 → quoteApprovedAt
//   PO 발송 / 발주 → poIssuedAt

const fs = require("fs");
const xlsx = require("xlsx");

const wb = xlsx.readFile("/tmp/repair_status.xlsx");
const sh = wb.Sheets["수리 현황"];
const range = xlsx.utils.decode_range(sh["!ref"]); range.e.c = Math.min(range.e.c, 16); sh["!ref"] = xlsx.utils.encode_range(range);
const d = xlsx.utils.sheet_to_json(sh, { header: 1, raw: false, defval: "" });

function parseDate(s) {
  const m = s.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (!m) return null;
  return { month: +m[1], day: +m[2] };
}

function classifyLabel(label) {
  const t = label.trim();
  if (/^(최초\s*입고|입고|창고\s*입고)$/.test(t)) return "stockedAt";
  if (/(본사\s*도착|본사\s*입고|반납|수리품\s*입고)/.test(t)) return "inboundReceivedAt";
  if (/(제조사\s*(도착|입고))/.test(t)) return "outboundReceivedAt";
  if (/(제조사(로)?\s*발송|해외\s*발송|선적)/.test(t)) return "outboundShippedAt";
  if (/(기술팀\s*인계|기술부\s*수리요청)/.test(t)) return "handedToTechAt";
  if (/Quote\s*수신|견적\s*수신/i.test(t)) return "quoteReceivedAt";
  if (/견적서\s*발송|견적\s*확정/.test(t)) return "quoteApprovedAt";
  if (/(PO|발주)\s*(발송|발행)?/.test(t)) return "poIssuedAt";
  return null;
}

function parseNotes(notes, year = 2026) {
  if (!notes) return { events: [], unknown: [] };
  // '-' 또는 ',' 로 분리, 때로는 ';' 도 사용됨
  // 토큰별: "M/D ; 라벨" 또는 "M/D 라벨" 패턴
  const tokens = notes.split(/\s*[-,]\s*(?=\d{1,2}\s*\/\s*\d{1,2})/);
  const events = [];
  const unknown = [];
  for (const tok of tokens) {
    const t = tok.trim();
    const dateMatch = t.match(/^(\d{1,2})\s*\/\s*(\d{1,2})/);
    if (!dateMatch) {
      if (t) unknown.push(t);
      continue;
    }
    const month = +dateMatch[1];
    const day = +dateMatch[2];
    const afterDate = t.slice(dateMatch[0].length).replace(/^[\s;:]+/, "");
    const field = classifyLabel(afterDate);
    if (field) {
      events.push({
        field,
        date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        label: afterDate.slice(0, 40),
      });
    } else if (afterDate) {
      unknown.push(`${month}/${day} ${afterDate.slice(0, 40)}`);
    }
  }
  return { events, unknown };
}

const results = [];
for (let i = 6; i < d.length; i++) {
  const r = d[i];
  if (!r || !r.some((c) => String(c || "").trim())) continue;
  const notes = String(r[13] || "").trim();
  const idx = results.length + 1;
  const orderNumber = `SA-2026-${String(idx).padStart(4, "0")}`;
  const parsed = parseNotes(notes);
  results.push({
    orderNumber,
    org: String(r[3] || "").trim(),
    rma: String(r[11] || "").trim(),
    notes: notes.slice(0, 80),
    eventCount: parsed.events.length,
    events: parsed.events,
    unknownCount: parsed.unknown.length,
    unknown: parsed.unknown,
  });
}

console.log(JSON.stringify(results, null, 2));
fs.writeFileSync("/tmp/notes_extracted.json", JSON.stringify(results, null, 2));
