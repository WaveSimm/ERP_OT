"use strict";
/*
 * CAPS(ADT CAPS-FPI) 출입기록 → ERP 근태 출퇴근 동기화 워커
 *
 * 규칙(합의):
 *  - 매핑 키 = e_id (캡스 사용자번호). 이름으로 ERP 사용자에 연결(다대일). caps_user_map 테이블 사용.
 *  - 출입 인증(e_result=0, e_mode IN 1/2/3) 중 그날 최초=출근, 최종=퇴근.
 *  - 출근/퇴근 출처 독립: checkInSource/checkOutSource. 'MANUAL'이면 그 칸은 캡스가 안 건드림(사람 수정 보존).
 *  - 증분: e_uptime 워터마크 이후 새 기록이 속한 "날짜"만 전체 재계산(가벼움).
 *  - 안전장치: 기존 기록 status='LEAVE'(연차 등 종일휴가)인 날은 건드리지 않음.
 *
 * 사용:
 *  node sync.js --seed-map         # 이름매칭으로 caps_user_map 채우기
 *  DRY_RUN=1 node sync.js --backfill [YYYYMMDD]   # 과거 일괄 미리보기(쓰기X)
 *  node sync.js --backfill [YYYYMMDD]             # 과거 일괄 반영
 *  DRY_RUN=1 node sync.js          # 증분 미리보기
 *  node sync.js                    # 증분 반영(워터마크 갱신)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Connection, Request } = require("tedious");
const { Client } = require("pg");

// ── env ──
const env = {};
fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n").forEach((l) => {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
});
const DRY = !!process.env.DRY_RUN || process.argv.includes("--dry");
const argFor = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };

// ── CAPS (tedious) ──
function capsConnect() {
  return new Promise((res, rej) => {
    const c = new Connection({
      server: env.CAPS_HOST,
      authentication: { type: "default", options: { userName: env.CAPS_USER, password: env.CAPS_PW } },
      options: { port: +env.CAPS_PORT, database: env.CAPS_DB, encrypt: false, trustServerCertificate: true, rowCollectionOnRequestCompletion: true, connectTimeout: 10000, requestTimeout: 60000 },
    });
    c.on("connect", (e) => e ? rej(e) : res(c));
    c.on("error", () => {});
    c.connect();
  });
}
function capsQuery(c, sql) {
  return new Promise((res, rej) => {
    const rows = [];
    const r = new Request(sql, (e) => e ? rej(e) : res(rows));
    r.on("row", (cols) => { const o = {}; cols.forEach((x) => o[x.metadata.colName] = x.value); rows.push(o); });
    c.execSql(r);
  });
}

// ── helpers ──
const clean = (s) => (s == null ? "" : String(s)).replace(/[\x00-\x1f ]/g, "").trim();
const baseDigit = (nm) => nm.replace(/[0-9]+$/, "");
const ymd2iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
function kstToUtcTs(ymd, hhmmss) { // 'YYYYMMDD','HHMMSS' (KST) → 'YYYY-MM-DD HH:MM:SS' (UTC)
  const t = String(hhmmss).padStart(6, "0");
  const ms = Date.parse(`${ymd2iso(ymd)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}+09:00`);
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}
const tmin = (hhmmss) => { const t = String(hhmmss).padStart(6, "0"); return +t.slice(0, 2) * 60 + +t.slice(2, 4); };
const tsec = (hhmmss) => { const t = String(hhmmss).padStart(6, "0"); return tmin(hhmmss) * 60 + +t.slice(4, 6); };
const kstHHMM = (utcTs) => { if (!utcTs) return null; const k = new Date(Date.parse(utcTs + "Z") + 9 * 3600e3); return String(k.getUTCHours()).padStart(2, "0") + ":" + String(k.getUTCMinutes()).padStart(2, "0"); };

// ── seed-map: 이름매칭으로 caps_user_map 구성 ──
async function seedMap(caps, pg) {
  const erp = (await pg.query(`SELECT id, name FROM auth_users WHERE is_active=true AND name NOT LIKE '테스트%' AND name <> '개발자'`)).rows;
  const erpByName = {}; erp.forEach((u) => { erpByName[u.name.trim()] = u.id; });
  const users = await capsQuery(caps, "SELECT id AS e_id, name FROM tuser");
  let mapped = 0, rows = [];
  for (const u of users) {
    const nm = clean(u.name);
    const target = erpByName[nm] || erpByName[baseDigit(nm)];
    if (!target) continue;
    rows.push({ eId: u.e_id, userId: target, capsName: nm });
    mapped++;
  }
  console.log(`이름매칭 결과: ${mapped} e_id → ERP 사용자`);
  if (DRY) { rows.forEach((r) => console.log(`  e_id ${r.eId} ${r.capsName} → ${r.userId}`)); console.log("(DRY: 저장 안 함)"); return; }
  for (const r of rows) {
    await pg.query(
      `INSERT INTO attendance.caps_user_map ("eId","userId","capsName","updatedAt") VALUES ($1,$2,$3,now())
       ON CONFLICT ("eId") DO UPDATE SET "userId"=EXCLUDED."userId","capsName"=EXCLUDED."capsName","updatedAt"=now()`,
      [r.eId, r.userId, r.capsName]
    );
  }
  console.log(`caps_user_map 적재 완료: ${rows.length}건`);
}

// ── 핵심: 주어진 날짜들 재계산 → 출퇴근 upsert ──
async function runDates(caps, pg, dates, label) {
  if (!dates.length) { console.log(`[${label}] 대상 날짜 없음`); return; }
  // 매핑 로드
  const mapRows = (await pg.query(`SELECT "eId","userId" FROM attendance.caps_user_map WHERE active=true`)).rows;
  const eidToUser = {}; mapRows.forEach((m) => { eidToUser[m.eId] = m.userId; });
  if (!mapRows.length) { console.log("⚠️ caps_user_map 비어있음 — 먼저 --seed-map 실행"); return; }
  // 정책
  const pol = (await pg.query(`SELECT "workStartTime","lateToleranceMinutes" FROM attendance.attendance_policies LIMIT 1`)).rows[0]
    || { workStartTime: "09:30", lateToleranceMinutes: 0 };
  const startMin = (+pol.workStartTime.slice(0, 2)) * 60 + (+pol.workStartTime.slice(3, 5)) + (pol.lateToleranceMinutes || 0);

  // CAPS: 해당 날짜들의 인증기록 (출입 = mode 1출근·2퇴근·3얼굴·9출근계열·7퇴근계열)
  const inList = dates.map((d) => `'${d}'`).join(",");
  const ev = await capsQuery(caps, `SELECT e_id, e_date, e_time, e_mode FROM tenter WHERE e_date IN (${inList}) AND e_result='0' AND e_mode IN ('1','2','3','7','9') AND e_id > 0 ORDER BY e_date, e_time`);
  // (userId,date) 집계: 시간순 이벤트 배열
  const agg = {}; // key = userId|YYYYMMDD
  for (const r of ev) {
    const uid = eidToUser[r.e_id]; if (!uid) continue;
    const k = uid + "|" + r.e_date;
    const a = agg[k] || (agg[k] = { uid, date: r.e_date, events: [] });
    a.events.push({ t: String(r.e_time).padStart(6, "0"), mode: String(r.e_mode).trim() });
  }
  const keys = Object.keys(agg);
  // 오늘(KST) — 실시간(오늘) vs 확정(과거) 구분용
  const _now = new Date(Date.now() + 9 * 3600e3);
  const todayKST = `${_now.getUTCFullYear()}${String(_now.getUTCMonth() + 1).padStart(2, "0")}${String(_now.getUTCDate()).padStart(2, "0")}`;
  const CI = new Set(["1", "9"]), CO = new Set(["2", "7"]); // 출근계열 / 퇴근계열

  // 기존 ERP 레코드 로드 (출처/상태 확인)
  const isoDates = dates.map(ymd2iso);
  const existing = {}; // userId|YYYYMMDD → row
  if (keys.length) {
    const exRows = (await pg.query(
      `SELECT "userId", to_char(date,'YYYYMMDD') d, "checkIn","checkOut","checkInSource","checkOutSource","breakMinutes",status
       FROM attendance.attendance_records WHERE date = ANY($1::date[])`, [isoDates]
    )).rows;
    exRows.forEach((r) => { existing[r.userId + "|" + r.d] = r; });
  }

  let ins = 0, upd = 0, skipLeave = 0, skipManual = 0, noChange = 0, entryW = 0;
  const samples = [];
  for (const k of keys) {
    const a = agg[k];
    const ex = existing[k];
    if (ex && ex.status === "LEAVE") { skipLeave++; continue; } // 안전장치: 종일휴가 보존

    // 이벤트 → 탭(120초 내 연속 = 한 번). 출근길 연타·이중기록 흡수.
    const taps = [];
    for (const e of a.events) {
      const s = tsec(e.t);
      const lt = taps[taps.length - 1];
      if (lt && s - lt.lastSec <= 120) { lt.lastSec = s; lt.modes.add(e.mode); }
      else taps.push({ t: e.t, lastSec: s, modes: new Set([e.mode]) });
    }
    const hasCI = (tp) => [...tp.modes].some((m) => CI.has(m));
    const hasCO = (tp) => [...tp.modes].some((m) => CO.has(m));

    // 출근/퇴근 시각(KST HHMMSS) 결정
    let inT = null, outT = null;
    if (taps.length === 1) {
      const tp = taps[0];
      if (hasCI(tp)) inT = tp.t;                    // 출근계열(1·9) → 출근
      else if (hasCO(tp)) outT = tp.t;              // 퇴근계열(2·7) → 퇴근
      else if (tmin(tp.t) < 14 * 60 + 30) inT = tp.t; // 얼굴만: 14:30 전 = 출근
      else outT = tp.t;                             // 14:30 이후 = 퇴근
    } else {
      inT = taps[0].t;                              // 첫 탭 = 출근
      const last = taps[taps.length - 1];
      if (a.date === todayKST) outT = hasCO(last) ? last.t : null; // 오늘: 마지막이 퇴근버튼(2·7)일 때만 실시간 확정
      else outT = last.t;                           // 과거일: 마지막 탭 = 퇴근 확정
    }

    const capsIn = inT ? kstToUtcTs(a.date, inT) : null;
    const capsOut = outT ? kstToUtcTs(a.date, outT) : null;

    const inManual = ex && ex.checkInSource === "MANUAL";
    const outManual = ex && ex.checkOutSource === "MANUAL";
    if (inManual && outManual) { skipManual++; continue; }

    const finalInTs = inManual ? (ex.checkIn ? new Date(ex.checkIn).toISOString().slice(0, 19).replace("T", " ") : null) : capsIn;
    const finalOutTs = outManual ? (ex.checkOut ? new Date(ex.checkOut).toISOString().slice(0, 19).replace("T", " ") : null) : capsOut;
    const inSrc = inManual ? "MANUAL" : "CAPS";
    const outSrc = outManual ? "MANUAL" : "CAPS";

    // 지각 판정 안 함 (유연근무) — 항상 NORMAL
    const isLate = false, lateMinutes = 0, status = "NORMAL";
    const brk = ex ? ex.breakMinutes || 0 : 0;
    let netMin = 0;
    if (finalOutTs && finalInTs) netMin = Math.max(0, Math.floor((Date.parse(finalOutTs + "Z") - Date.parse(finalInTs + "Z")) / 60000) - brk);
    const checkState = finalOutTs ? "CHECKED_OUT" : (finalInTs ? "CHECKED_IN" : "NOT_STARTED");

    // 변경 없으면 스킵 (미확정 과거날 재확정 시 불필요한 쓰기 방지)
    if (ex) {
      const exIn = ex.checkIn ? new Date(ex.checkIn).toISOString().slice(0, 19).replace("T", " ") : null;
      const exOut = ex.checkOut ? new Date(ex.checkOut).toISOString().slice(0, 19).replace("T", " ") : null;
      if (exIn === finalInTs && exOut === finalOutTs && ex.status === status && ex.checkInSource === inSrc && ex.checkOutSource === outSrc) { noChange++; continue; }
    }

    if (samples.length < 20) samples.push(`${a.uid.slice(-6)} ${a.date} 출${inT ? inT.slice(0, 4) : "(-)"}→퇴${outT ? outT.slice(0, 4) : "(-)"}${ex ? ` [기존:${ex.status}]` : " [신규]"}${inManual || outManual ? ` (수동보존)` : ""}`);

    if (DRY) { ex ? upd++ : ins++; continue; }

    if (ex) {
      await pg.query(
        `UPDATE attendance.attendance_records SET
           "checkIn"=$2,"checkOut"=$3,"workType"='OFFICE',status=$4,"checkState"=$5,
           "isLate"=$6,"lateMinutes"=$7,"netWorkMinutes"=$8,
           "checkInSource"=$9,"checkOutSource"=$10,"updatedAt"=now()
         WHERE "userId"=$1 AND date=$11::date`,
        [a.uid, finalInTs, finalOutTs, status, checkState, isLate, lateMinutes, netMin, inSrc, outSrc, ymd2iso(a.date)]
      );
      upd++;
    } else {
      await pg.query(
        `INSERT INTO attendance.attendance_records
          (id,"userId",date,"checkIn","checkOut","workType",status,"checkState","isLate","lateMinutes","breakMinutes","netWorkMinutes","checkInSource","checkOutSource","createdAt","updatedAt")
         VALUES ($1,$2,$3::date,$4,$5,'OFFICE',$6,$7,$8,$9,0,$10,$11,$12,now(),now())`,
        [crypto.randomUUID(), a.uid, ymd2iso(a.date), finalInTs, finalOutTs, status, checkState, isLate, lateMinutes, netMin, inSrc, outSrc]
      );
      ins++;
    }
  }
  console.log(`[${label}] 대상 ${keys.length}건 | 신규 ${ins} / 갱신 ${upd} / 변경없음 ${noChange} / 휴가스킵 ${skipLeave} / 수동보존 ${skipManual}${DRY ? "  (DRY: 쓰기 안 함)" : ""}`);
  console.log("  샘플:"); samples.forEach((s) => console.log("   " + s));
  return keys.length;
}

async function updateWatermark(caps, pg) {
  const mx = (await capsQuery(caps, "SELECT MAX(e_uptime) AS m FROM tenter"))[0].m;
  if (!DRY && mx) await pg.query(`UPDATE attendance.caps_sync_state SET "lastUptime"=$1,"updatedAt"=now() WHERE id=1`, [mx]);
  return mx;
}

async function main() {
  const caps = await capsConnect();
  const pg = new Client({ host: env.PG_HOST, port: +env.PG_PORT, user: env.PG_USER, password: env.PG_PW, database: env.PG_DB });
  await pg.connect();
  try {
    if (process.argv.includes("--seed-map")) { await seedMap(caps, pg); return; }

    let dates = [];
    if (process.argv.includes("--date")) {
      const d = argFor("--date");
      dates = [d];
      console.log(`단일 날짜 반영: ${d}`);
      await runDates(caps, pg, dates, "single");
      console.log(DRY ? "(DRY: 워터마크 미갱신)" : "단일 반영 완료 (워터마크는 증분 실행 시 갱신)");
    } else if (process.argv.includes("--backfill")) {
      const start = argFor("--backfill") || env.BACKFILL_START;
      const rows = await capsQuery(caps, `SELECT DISTINCT e_date FROM tenter WHERE e_date >= '${start}' AND e_date <= CONVERT(varchar(8), GETDATE(), 112) AND e_result='0' AND e_mode IN ('1','2','3','7','9') ORDER BY e_date`);
      dates = rows.map((r) => r.e_date);
      console.log(`백필 범위: ${start} ~ 오늘 (${dates.length}일)`);
      await runDates(caps, pg, dates, "backfill");
      const mx = await updateWatermark(caps, pg);
      console.log("워터마크:", mx, DRY ? "(DRY)" : "갱신됨");
    } else {
      // 증분: ① 워터마크 이후 새 badge 있는 날(오늘 실시간) ② 아직 확정 안 한 과거 날(한 번씩)
      const _now = new Date(Date.now() + 9 * 3600e3);
      const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
      const yesterday = ymd(new Date(_now.getTime() - 86400e3));
      const finPath = path.join(__dirname, ".state-finalized");
      let lastFin; try { lastFin = fs.readFileSync(finPath, "utf8").trim(); } catch { lastFin = yesterday; } // 최초엔 어제(백필로 이미 확정)

      const last = (await pg.query(`SELECT "lastUptime" FROM attendance.caps_sync_state WHERE id=1`)).rows[0]?.lastUptime || "00000000000000";
      const newRows = await capsQuery(caps, `SELECT DISTINCT e_date FROM tenter WHERE e_uptime > '${last}' AND e_result='0' AND e_mode IN ('1','2','3','7','9') AND e_date > '00000000'`);
      const finRows = (lastFin < yesterday)
        ? await capsQuery(caps, `SELECT DISTINCT e_date FROM tenter WHERE e_date > '${lastFin}' AND e_date <= '${yesterday}' AND e_result='0' AND e_mode IN ('1','2','3','7','9')`)
        : [];
      dates = [...new Set([...newRows.map((r) => r.e_date), ...finRows.map((r) => r.e_date)])].sort();
      console.log(`증분: 새badge날 ${newRows.length} + 미확정과거날 ${finRows.length}(확정 ${lastFin}~${yesterday}) → ${dates.length}일`);
      await runDates(caps, pg, dates, "incremental");
      await updateWatermark(caps, pg);
      if (!DRY) fs.writeFileSync(finPath, yesterday); // 어제까지 확정 완료로 기록
      console.log("확정일:", yesterday, DRY ? "(DRY)" : "기록됨");
    }
  } finally {
    caps.close(); await pg.end();
  }
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
