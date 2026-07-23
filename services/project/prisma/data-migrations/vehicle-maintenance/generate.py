#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
차량정비내역 이관 — 2단계 generate (로컬 파일만 생성, DB 미실행)

입력:  plan.json (transform.py 산출)
출력:
  insert.sql       BEGIN; 자원4 + 예약94 + 첨부74 INSERT; COMMIT
  rollback.sql     BEGIN; id로 정확 삭제(첨부→예약→자원); COMMIT
  copy-files.sh    docker exec mkdir + docker cp (NAS→erp-ot-project:/app/storage)
  applied-ids.json 생성된 모든 id (롤백 근거)
  verify.sql       삽입 후 건수 확인용 SELECT

실행은 하지 않는다. 검토 후 사람이 아래 순서로 실행:
  1) docker exec -i erp-ot-postgres psql -U erp_user -d erp_ot < insert.sql
  2) bash copy-files.sh
  (문제 시) docker exec -i erp-ot-postgres psql -U erp_user -d erp_ot < rollback.sql  +  파일폴더 rm
"""
import json, os, re
from datetime import datetime, timezone

HERE = os.path.dirname(__file__)
NAS = "/mnt/nas/oceantech/30. 팀_개인/02. 기술팀/02. 팀원 개인폴더/최지수/ERP/Migrations"
TESTDIR = os.path.join(NAS, "test")
APP_CONTAINER = "erp-ot-project"
STORAGE_ROOT = "/app/storage/ERP/공용자산/차량"
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

MIME = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
        ".hwp": "application/x-hwp", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}

def sql_str(s):
    if s is None: return "NULL"
    return "'" + str(s).replace("'", "''") + "'"

def sanitize_segment(s):
    s = re.sub(r'[/\\:*?"<>|\x00-\x1f]', "_", s or "")
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"^\.+|\.+$", "", s)
    s = s.strip()
    return s or "_"

def to_ts(iso):  # "2023-01-18T15:00:00Z" → "2023-01-18 15:00:00"
    return iso.replace("T", " ").replace("Z", "")

def main():
    plan = json.load(open(os.path.join(HERE, "plan.json"), encoding="utf-8"))
    R = plan["reservations"]; A = plan["attachments"]; NEWRES = plan["newResources"]

    # ---- 신규 자원 id 배정 (기존 cmoeq_vNN, 최대 v20 → v21~) ----
    new_res_ids = {}
    for i, nr in enumerate(NEWRES):
        rid = f"cmoeq_v{21 + i}"
        new_res_ids[nr["key"]] = {"id": rid, "name": nr["name"], "isActive": nr["isActive"]}

    def resolve_res(res_id_field):
        if res_id_field and res_id_field.startswith("NEW:"):
            return new_res_ids[res_id_field]["id"]
        return res_id_field

    # 자원명(폴더명 계산용): resourceId → name.  기존 자원명은 plan에 없으므로 DB조회 필요 → 여기선
    # 신규 자원명만 알고, 기존은 copy-files.sh가 컨테이너에서 __<id> 폴더 규칙으로 처리.
    resid_to_name = {v["id"]: v["name"] for v in new_res_ids.values()}

    applied = {"resources": [], "reservations": [], "attachments": []}

    # ---- INSERT SQL ----
    sql = ["-- 차량정비내역 이관 INSERT (자동생성)  " + NOW,
           "-- 실행: docker exec -i erp-ot-postgres psql -U erp_user -d erp_ot < insert.sql",
           "BEGIN;", ""]

    sql.append("-- 1) 신규 비활성 자원 4대")
    for k, v in new_res_ids.items():
        applied["resources"].append(v["id"])
        sql.append(
            f"INSERT INTO project.equipment_resources (id,name,type,\"isActive\",\"createdAt\",\"updatedAt\",\"sortOrder\") "
            f"VALUES ({sql_str(v['id'])},{sql_str(v['name'])},'VEHICLE'::project.\"EquipmentType\",false,"
            f"'{NOW}','{NOW}',0);")
    sql.append("")

    sql.append("-- 2) 정비내역 예약 94건")
    res_pk = {}  # reservation index → id
    for i, r in enumerate(R):
        rid = f"cmmig_r{i+1:04d}"
        res_pk[i] = rid
        applied["reservations"].append(rid)
        rres = resolve_res(r["resourceId"])
        mileage = "NULL" if r["mileage"] is None else str(r["mileage"])
        sql.append(
            "INSERT INTO project.equipment_reservations "
            "(id,\"resourceId\",\"userId\",title,description,\"startAt\",\"endAt\",\"isAllDay\","
            "recurrence,status,\"createdAt\",\"updatedAt\",\"logType\",mileage) VALUES ("
            f"{sql_str(rid)},{sql_str(rres)},{sql_str(r['userId'])},{sql_str(r['title'])},"
            f"{sql_str(r['description'])},'{to_ts(r['startAt'])}','{to_ts(r['endAt'])}',{str(r['isAllDay']).lower()},"
            # 단발 예약: 앱은 recurrence를 jsonb 'null'로 저장(Prisma JsonNull). SQL NULL이면 listExpanded 조회에서 빠짐.
            f"'null'::jsonb,'CONFIRMED'::project.\"ReservationStatus\",'{NOW}','{NOW}','MAINTENANCE',{mileage});")
    sql.append("")

    # ---- 첨부: storagePath 계산 + INSERT + 복사 스크립트 ----
    # 폴더명 = sanitize(자원명)__<resourceId>.  기존 자원명은 DB에서 가져와야 정확 →
    # copy-files.sh는 컨테이너에서 '__<resourceId>' 로 끝나는 기존 폴더를 찾고, 없으면 생성.
    # storagePath는 DB조회한 자원명으로 계산해야 하므로 generate 시 자원명 맵이 필요.
    # → resid_to_name 에 기존 자원명도 채운다(호출측에서 --resmap 파일 주입). 여기선 plan의 vehicle로 근사 불가하므로
    #   기존 자원 폴더명은 실제 자원명이 필요 → 별도 resmap.json(생성 시 DB조회)로 주입.
    resmap_path = os.path.join(HERE, "resmap.json")
    if os.path.exists(resmap_path):
        resid_to_name.update(json.load(open(resmap_path, encoding="utf-8")))

    sql.append("-- 3) 첨부 74건")
    copy = ["#!/usr/bin/env bash",
            "# 첨부 파일 복사 (NAS → erp-ot-project:/app/storage). 자동생성 " + NOW,
            "set -euo pipefail", 'C="' + APP_CONTAINER + '"', ""]
    dedup = {}
    for j, a in enumerate(A):
        aid = f"cmmig_a{j+1:04d}"
        applied["attachments"].append(aid)
        ri = a["resIndex"]; rid = res_pk[ri]
        r = R[ri]
        resource_id = resolve_res(r["resourceId"])
        res_name = resid_to_name.get(resource_id, resource_id)  # 폴더명용
        folder = f"{sanitize_segment(res_name)}__{resource_id}"
        catfolder = "이미지" if a["category"] == "IMAGE" else "파일"
        src = os.path.join(TESTDIR, a["file"])
        base, ext = os.path.splitext(a["file"])
        diskname = sanitize_segment(base) + ext.lower()
        dirpath = f"{STORAGE_ROOT}/{folder}/{rid}/{catfolder}"
        # dedup within same dir
        key = (dirpath, diskname.lower())
        n = dedup.get(key, 0) + 1; dedup[key] = n
        if n > 1:
            diskname = f"{sanitize_segment(base)}_{n}{ext.lower()}"
        storagepath = f"{dirpath}/{diskname}"
        fsize = os.path.getsize(src)
        mime = MIME.get(ext.lower(), "application/octet-stream")
        sql.append(
            "INSERT INTO project.reservation_attachments "
            "(id,\"reservationId\",\"fileName\",\"fileSize\",\"mimeType\",category,\"storagePath\","
            "\"resourceNameSnapshot\",\"uploadedBy\",\"createdAt\") VALUES ("
            f"{sql_str(aid)},{sql_str(rid)},{sql_str(a['file'])},{fsize},{sql_str(mime)},"
            f"{sql_str(a['category'])},{sql_str(storagepath)},{sql_str(res_name)},{sql_str(r['userId'])},'{NOW}');")
        copy.append(f'docker exec "$C" mkdir -p {sh_q(dirpath)}')
        copy.append(f'docker cp {sh_q(src)} "$C":{sh_q(storagepath)}')
    sql += ["", "COMMIT;"]
    copy.append('echo "첨부 %d개 복사 완료"' % len(A))

    # ---- rollback ----
    def idlist(xs): return ",".join(sql_str(x) for x in xs)
    rb = ["-- 롤백 (자동생성) " + NOW, "BEGIN;",
          f"DELETE FROM project.reservation_attachments WHERE id IN ({idlist(applied['attachments'])});",
          f"DELETE FROM project.equipment_reservations WHERE id IN ({idlist(applied['reservations'])});",
          f"DELETE FROM project.equipment_resources WHERE id IN ({idlist(applied['resources'])});",
          "COMMIT;",
          "-- 파일 폴더 삭제: docker exec erp-ot-project sh -c 'rm -rf /app/storage/ERP/공용자산/차량/*__cmoeq_v2[1-4] ...' (예약폴더는 cmmig_r* 기준 수동)"]

    # ---- verify ----
    vf = ["-- 삽입 검증",
          f"SELECT count(*) AS 자원 FROM project.equipment_resources WHERE id IN ({idlist(applied['resources'])});",
          f"SELECT count(*) AS 예약 FROM project.equipment_reservations WHERE id LIKE 'cmmig_r%';",
          f"SELECT count(*) AS 첨부 FROM project.reservation_attachments WHERE id LIKE 'cmmig_a%';",
          "SELECT \"logType\",count(*) FROM project.equipment_reservations WHERE id LIKE 'cmmig_r%' GROUP BY 1;"]

    open(os.path.join(HERE, "insert.sql"), "w", encoding="utf-8").write("\n".join(sql) + "\n")
    open(os.path.join(HERE, "rollback.sql"), "w", encoding="utf-8").write("\n".join(rb) + "\n")
    open(os.path.join(HERE, "copy-files.sh"), "w", encoding="utf-8").write("\n".join(copy) + "\n")
    open(os.path.join(HERE, "verify.sql"), "w", encoding="utf-8").write("\n".join(vf) + "\n")
    json.dump(applied, open(os.path.join(HERE, "applied-ids.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print(f"생성 완료: 자원 {len(applied['resources'])}, 예약 {len(applied['reservations'])}, 첨부 {len(applied['attachments'])}")
    print("파일: insert.sql / copy-files.sh / rollback.sql / verify.sql / applied-ids.json")
    if not os.path.exists(resmap_path):
        print("\n⚠️ resmap.json 없음 → 기존 자원 폴더명이 자원명이 아니라 id로 계산됨.")
        print("   기존 12대 첨부 경로 정확화하려면 resmap.json(자원id→자원명) 먼저 생성 필요.")

def sh_q(s):  # 셸 단일따옴표 이스케이프
    return "'" + str(s).replace("'", "'\\''") + "'"

if __name__ == "__main__":
    main()
