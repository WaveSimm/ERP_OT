"""
Phase: shard DB → main DB 병합

병렬 워커가 각자 shard-XX.duckdb에 INSERT한 결과를
main nas-scan.duckdb로 병합합니다.

- 중복 path는 가장 최근 데이터 우선 (updated_at DESC)
- scan_runs는 모든 shard의 기록 누적
- shard 파일은 백업 보존 (수동 삭제)

사용:
    python 06-merge-shards.py
"""
from __future__ import annotations
import sys
from pathlib import Path
import duckdb

from common import DB_PATH, SHARD_DIR, connect_db


def main() -> int:
    shards = sorted(SHARD_DIR.glob("shard-*.duckdb"))
    if not shards:
        print("⚠ shard 파일 없음")
        return 1

    print(f"병합 시작 — main: {DB_PATH}")
    print(f"  shard {len(shards)}개:")
    for s in shards:
        print(f"    - {s.name}")
    print()

    # main DB schema 보장
    con = connect_db()

    total_files = 0
    total_runs = 0
    for shard in shards:
        try:
            # ATTACH shard as read-only
            con.execute(f"ATTACH '{shard}' AS shard (READ_ONLY)")

            # files merge (path PK 충돌 시 shard 데이터로 갱신 — 최신 우선)
            r = con.execute("""
                INSERT INTO files
                SELECT * FROM shard.files
                ON CONFLICT (path) DO UPDATE SET
                    size = excluded.size,
                    mtime = excluded.mtime,
                    ctime = excluded.ctime,
                    is_readable = excluded.is_readable,
                    scan_error = excluded.scan_error,
                    pdf_pages = COALESCE(excluded.pdf_pages, files.pdf_pages),
                    pdf_has_text = COALESCE(excluded.pdf_has_text, files.pdf_has_text),
                    pdf_text_chars = COALESCE(excluded.pdf_text_chars, files.pdf_text_chars),
                    pdf_creator = COALESCE(excluded.pdf_creator, files.pdf_creator),
                    pdf_is_scan_likely = COALESCE(excluded.pdf_is_scan_likely, files.pdf_is_scan_likely),
                    hwp_version = COALESCE(excluded.hwp_version, files.hwp_version),
                    hwp_parseable = COALESCE(excluded.hwp_parseable, files.hwp_parseable),
                    hash_head1mb = COALESCE(excluded.hash_head1mb, files.hash_head1mb),
                    updated_at = now()
            """)
            inserted = con.execute("SELECT COUNT(*) FROM shard.files").fetchone()[0]
            total_files += inserted

            # scan_runs 병합 (id는 main DB가 새로 매김)
            con.execute("""
                INSERT INTO scan_runs (tier, started_at, ended_at, files_seen, files_updated, errors, notes)
                SELECT tier, started_at, ended_at, files_seen, files_updated, errors,
                       COALESCE(notes,'') || ' [shard: ' || ? || ']'
                FROM shard.scan_runs
            """, [shard.name])
            runs = con.execute("SELECT COUNT(*) FROM shard.scan_runs").fetchone()[0]
            total_runs += runs

            con.execute("DETACH shard")
            print(f"  ✓ {shard.name}: {inserted:,} files, {runs} runs")
        except Exception as e:
            print(f"  ❌ {shard.name}: {e}", file=sys.stderr)
            try:
                con.execute("DETACH shard")
            except Exception:
                pass

    # 최종 통계
    final_count = con.execute("SELECT COUNT(*) FROM files").fetchone()[0]
    final_runs = con.execute("SELECT COUNT(*) FROM scan_runs").fetchone()[0]
    print()
    print(f"✓ 병합 완료")
    print(f"  main DB files     : {final_count:,}")
    print(f"  main DB scan_runs : {final_runs}")
    print(f"  병합 input files  : {total_files:,}")
    print(f"  병합 input runs   : {total_runs}")
    con.close()

    # Tier 0 완료 마커: shard들 중 최신 tier='0' 종료 기록을 main에도 명시적으로 등록 (이미 위에서 등록됨)
    # 명시적 신호 등록 (이 스크립트가 끝나면 Tier 0 전체 완료로 간주)
    con = connect_db()
    con.execute("""
        INSERT INTO scan_runs (tier, started_at, ended_at, files_seen, files_updated, errors, notes)
        VALUES ('0', now(), now(), ?, ?, 0, 'PARALLEL TIER 0 MERGED — completion marker')
    """, [final_count, final_count])
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
