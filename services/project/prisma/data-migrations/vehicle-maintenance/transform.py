#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
차량정비내역 이관 — 1단계 transform (읽기전용)

입력:
  - NAS: EGK001M-차량정비.xlsx  (정비 레코드)
  - NAS: test/  (첨부 PDF/JPG)
  - DB(읽기전용, docker exec psql): auth_users, equipment_resources

출력:
  - plan.json  { reservations:[...], attachments:[...], newResources:[...], summary:{...} }

이 스크립트는 DB를 수정하지 않는다. 확정된 7개 규칙을 그대로 적용해 seed.ts가 먹을
중간 산출물(plan.json)을 만든다. 소스 xlsx/첨부도 수정하지 않는다.
"""
import zipfile, xml.etree.ElementTree as ET, re, os, json, subprocess
from datetime import date, datetime, timedelta, timezone

NAS = "/mnt/nas/oceantech/30. 팀_개인/02. 기술팀/02. 팀원 개인폴더/최지수/ERP/Migrations"
XLSX = os.path.join(NAS, "EGK001M-차량정비.xlsx")
TESTDIR = os.path.join(NAS, "test")
OUT = os.path.join(os.path.dirname(__file__), "plan.json")
KST = timezone(timedelta(hours=9))

# 번호판 변경 별칭: 옛 번호판(파일명) → 현 번호판(레코드/자원)
PLATE_ALIAS = {"4966": "2909", "9084": "8167"}
# 수동 배정 첨부 (파일명 → 현 번호판 + 레코드 날짜)
MANUAL_ATTACH = {
    "스타렉스9970_정비내역_240208.pdf": ("9970", date(2024, 2, 14)),
    "차량정비 명세서_스타리아 2331.pdf": ("2331", date(2025, 10, 16)),
}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

# ---------- xlsx 파싱 ----------
def load_rows():
    z = zipfile.ZipFile(XLSX); NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    shared = []
    for si in ET.fromstring(z.read("xl/sharedStrings.xml")):
        shared.append("".join(t.text or "" for t in si.iter(NS + "t")))
    sh = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    def coln(ref):
        c = "".join(ch for ch in ref if ch.isalpha()); n = 0
        for ch in c: n = n * 26 + (ord(ch) - 64)
        return n
    rows = []
    for row in sh.iter(NS + "row"):
        cells = {}
        for c in row.findall(NS + "c"):
            t = c.attrib.get("t"); v = c.find(NS + "v"); val = None
            if v is not None:
                val = v.text
                if t == "s": val = shared[int(val)]
            else:
                isel = c.find(NS + "is")
                if isel is not None: val = "".join(x.text or "" for x in isel.iter(NS + "t"))
            cells[coln(c.attrib.get("r", ""))] = val
        rows.append(cells)
    return rows

def pdate(s):
    m = re.match(r"(\d{4})/(\d{2})/(\d{2})", s or "")
    return date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None

# ---------- DB 조회 (읽기전용) ----------
def psql(sql):
    out = subprocess.check_output(["docker", "exec", "erp-ot-postgres", "psql", "-U", "erp_user",
        "-d", "erp_ot", "-P", "pager=off", "-t", "-A", "-F", "\t", "-c", sql]).decode()
    return [ln.split("\t") for ln in out.strip().splitlines() if ln.strip()]

def load_auth_users():
    return {name: uid for name, uid in psql("SELECT name, id FROM public.auth_users;")}

def load_resources():
    # name suffix(물품명) → id.  name 형식 "차량02 — 지사-스타렉스(97도0765)"
    m = {}
    for name, rid in psql("SELECT name, id FROM project.equipment_resources WHERE type='VEHICLE';"):
        suffix = name.split("— ")[-1].strip()
        m[suffix] = rid
    return m

# ---------- 규칙 적용 ----------
KM = re.compile(r"([\d]{1,3}(?:,\d{3})+|\d{4,6})\s*km")
PROG = re.compile(r"진행\s*[:：]\s*([가-힣]{2,4}|사장님)")

def extract_mileage(title, remark):
    text = (title or "") + " " + (remark or "")
    cands = [int(x.replace(",", "")) for x in KM.findall(text)]
    cands = [v for v in cands if 1000 <= v <= 999999]
    return max(cands) if cands else None

def norm_title(s):  # 중복판정용 정규화
    return re.sub(r"[\s,및()]", "", (s or "").replace("[차량정비]", ""))

def clean_title(s):
    t = (s or "").replace("[차량정비]", "")
    # 원본 제목이 잘려 들어온 주행거리 조각 제거 (예: "...교체(주행 68,884km")
    t = re.sub(r"\(?\s*주행\s*(?:거리)?\s*[:：]?\s*[\d,]+\s*km\)?", "", t)
    return re.sub(r"\s{2,}", " ", t).strip(" ,/·")

def valid_timeblock(s, e):
    def ok(t): return bool(t) and t != "24:00" and re.match(r"^\d{2}:00$", t)
    return ok(s) and ok(e) and s != e

def to_utc(d, hhmm):
    h, mnt = int(hhmm[:2]), int(hhmm[3:])
    return datetime(d.year, d.month, d.day, h, mnt, tzinfo=KST).astimezone(timezone.utc)

def build_times(d, s, e):
    if valid_timeblock(s, e):
        return to_utc(d, s).isoformat().replace("+00:00", "Z"), to_utc(d, e).isoformat().replace("+00:00", "Z"), False
    # 종일: KST 00:00 ~ 다음날 00:00
    start = datetime(d.year, d.month, d.day, tzinfo=KST).astimezone(timezone.utc)
    end = (datetime(d.year, d.month, d.day, tzinfo=KST) + timedelta(days=1)).astimezone(timezone.utc)
    return start.isoformat().replace("+00:00", "Z"), end.isoformat().replace("+00:00", "Z"), True

def build_description(remark, prog_name, userid_is_prog, registrant):
    """적요에서 주행거리 제거, 진행자는 userId로 안 갔을 때만 유지, 나머지 유지 + 담당:{등록자}."""
    txt = (remark or "").strip()
    # 주행거리 구문 제거 (mileage 필드로 감)
    txt = re.sub(r"주행거리\s*[:：]?\s*[\d,]+\s*km", "", txt)
    txt = re.sub(r"주행\s*[\d,]+\s*km", "", txt)
    txt = re.sub(r"[\d,]{4,}\s*km", "", txt)
    # 진행자 구문은 항상 원문에서 제거하고(표기 통일), 필요 시 아래서 재삽입
    txt = PROG.sub("", txt)
    # 잔여 정리: 빈 괄호, 중복 구분자, 앞뒤 기호
    txt = re.sub(r"\(\s*[/,:：]?\s*\)", "", txt)
    txt = re.sub(r"[\s/·,]{2,}", " ", txt)
    txt = txt.strip(" /·,\t")
    parts = [txt]
    # 진행자가 userId로 안 간 대체건만 진행자명을 비고에 통일 표기
    if prog_name and not userid_is_prog:
        parts.append(f"진행: {prog_name}")
    parts.append(f"담당: {registrant}")
    return " / ".join(p for p in parts if p)

# ---------- 메인 ----------
def main():
    users = load_auth_users()
    resmap = load_resources()
    rows = load_rows()
    real = [r for r in rows[2:] if r.get(1) and r.get(4)]  # 타이틀/헤더/footer 제외

    # 신규 비활성 자원 4대 (레코드에는 있으나 자산 마스터에 없음)
    NEW_RES = ["지사-스타렉스(94수0822)", "본사-스타렉스(74모9970)",
               "본사-카니발(53두6849)", "본사-스타리아(193허9553)"]
    new_resources = [{"key": f"NEW:{n}", "name": f"{n} (구차량)", "isActive": False} for n in NEW_RES]
    for n in NEW_RES:
        resmap.setdefault(n, f"NEW:{n}")  # seed가 생성 후 실제 id로 치환

    reservations = []
    seen = {}  # (물품명, date, norm_title) → 중복 제거 (충돌①)
    dropped_dup = []
    plate_of = {}  # (물품명,date,idx) 편의용

    for idx, r in enumerate(real):
        veh = r.get(4).strip(); d = pdate(r.get(1))
        s, e = r.get(2), r.get(3)
        title_raw = r.get(5); remark = r.get(6); registrant = (r.get(7) or "").strip()
        key = (veh, d, norm_title(title_raw))
        if key in seen:
            dropped_dup.append({"date": str(d), "vehicle": veh, "title": title_raw})
            continue
        seen[key] = True

        # userId: 진행자(내부계정) 우선, 없으면 등록자
        m = PROG.search((title_raw or "") + " " + (remark or ""))
        prog_name = m.group(1) if m else None
        if prog_name and prog_name in users:
            userid_name, userid_is_prog = prog_name, True
        else:
            userid_name, userid_is_prog = registrant, False

        startAt, endAt, allday = build_times(d, s, e)
        res_id = resmap.get(veh)
        plate_m = re.search(r"(\d{4})\)", veh)
        reservations.append({
            "sourceDate": str(d),
            "vehicle": veh,
            "plate": plate_m.group(1) if plate_m else None,
            "resourceId": res_id,                     # NEW:... 이면 seed가 치환
            "userName": userid_name,                  # seed가 name→id 치환
            "userId": users.get(userid_name),
            "userIsProgress": userid_is_prog,
            "title": clean_title(title_raw),
            "description": build_description(remark, prog_name, userid_is_prog, registrant),
            "startAt": startAt, "endAt": endAt, "isAllDay": allday,
            "logType": "MAINTENANCE", "status": "CONFIRMED",
            "mileage": extract_mileage(title_raw, remark),
            "registrant": registrant,
            "progName": prog_name,
        })

    # ---------- 첨부 매핑 ----------
    def fdate(fn):
        for m in re.finditer(r"(2[3-6])(0[1-9]|1[0-2])([0-3]\d)", fn.replace(" ", "")):
            try: return date(2000 + int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except: pass
        return None
    # 레코드 인덱스: 현번호판 → [(date, res_index)]
    rec_by_plate = {}
    for i, rv in enumerate(reservations):
        rec_by_plate.setdefault(rv["plate"], []).append((date.fromisoformat(rv["sourceDate"]), i))
    known_plates = set(rec_by_plate.keys())

    files = [x for x in os.listdir(TESTDIR) if not x.startswith("Thumbs")]
    attachments = []; unmatched = []
    for fn in sorted(files):
        ext = os.path.splitext(fn)[1].lower()
        category = "IMAGE" if ext in IMAGE_EXTS else "FILE"
        # 번호판 결정 (수동 → 별칭 → 알려진 번호판)
        if fn in MANUAL_ATTACH:
            plate, rdate = MANUAL_ATTACH[fn]
        else:
            plate = None
            for old, new in PLATE_ALIAS.items():
                if old in fn: plate = new; break
            if not plate:
                for p in known_plates:
                    if p and p in fn: plate = p; break
            rdate = fdate(fn)
        if not plate or plate not in rec_by_plate:
            unmatched.append({"file": fn, "reason": "번호판 매칭 실패"}); continue
        cands = rec_by_plate[plate]
        if rdate is None:
            unmatched.append({"file": fn, "reason": "날짜 없음"}); continue
        diff, ri = min((abs((cd - rdate).days), i) for cd, i in cands)
        attachments.append({
            "file": fn, "category": category, "plate": plate,
            "fileDate": str(rdate), "dayDiff": diff,
            "resIndex": ri, "recordDate": reservations[ri]["sourceDate"],
            "recordVehicle": reservations[ri]["vehicle"], "recordTitle": reservations[ri]["title"],
        })

    summary = {
        "reservations": len(reservations),
        "droppedDuplicates": len(dropped_dup),
        "newResources": len(new_resources),
        "attachmentsMatched": len(attachments),
        "attachmentsUnmatched": len(unmatched),
        "userIdFromProgress": sum(1 for r in reservations if r["userIsProgress"]),
        "userIdFromRegistrant": sum(1 for r in reservations if not r["userIsProgress"]),
        "mileageExtracted": sum(1 for r in reservations if r["mileage"] is not None),
        "allDay": sum(1 for r in reservations if r["isAllDay"]),
        "timed": sum(1 for r in reservations if not r["isAllDay"]),
    }
    plan = {"summary": summary, "newResources": new_resources,
            "reservations": reservations, "attachments": attachments,
            "unmatched": unmatched, "dropped": dropped_dup}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\n→ {OUT}")
    if unmatched:
        print("\n[미매칭 첨부]");
        for u in unmatched: print("  ", u)

if __name__ == "__main__":
    main()
