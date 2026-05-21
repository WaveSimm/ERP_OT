"""
정리 영역 분석 — 현재까지 수집된 shard들로 정리 가능 후보 추출.

이미 완료된 shard만 사용 (락 회피):
  - shard-00-general.duckdb       (완료)
  - shard-98-fax.duckdb            (완료)
  - shard-99-scan.duckdb           (완료)
  - shard-30-rest.duckdb           (이미 완료)
  - shard-30-02-tech.duckdb        (오래 전 마지막 업데이트, 시도)

진행 중 shard도 read_only로 시도 (락이면 skip).

출력: 정리 영역 인사이트
"""
from __future__ import annotations
import sys
from pathlib import Path
from datetime import datetime
import duckdb

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

SHARD_DIR = Path(__file__).resolve().parent / "data" / "shards"


def attach_shards(con) -> list[str]:
    """가능한 shard 모두 ATTACH. 락 실패는 skip."""
    attached = []
    idx = 1
    for f in sorted(SHARD_DIR.glob("shard-*.duckdb")):
        try:
            con.execute(f"ATTACH '{f}' AS s{idx} (READ_ONLY)")
            attached.append(f.name)
            idx += 1
        except Exception as e:
            print(f"  skip {f.name}: {str(e)[:80]}", file=sys.stderr)
    return attached


def main():
    con = duckdb.connect(":memory:")
    print("=" * 70)
    print("정리 영역 분석 — 현재 가용 shard 통합")
    print("=" * 70)
    print()

    attached = attach_shards(con)
    print(f"ATTACH 성공: {len(attached)} shards")
    for a in attached:
        print(f"  - {a}")
    print()

    if not attached:
        print("⚠ 사용 가능한 shard 없음. 모두 락 상태.")
        return 1

    # UNION ALL view
    union_parts = [f"SELECT * FROM s{i+1}.files" for i in range(len(attached))]
    con.execute(f"CREATE VIEW all_files AS {' UNION ALL '.join(union_parts)}")

    total = con.execute("SELECT COUNT(*), SUM(size)/1e9 FROM all_files WHERE is_readable").fetchone()
    print(f"총 파일: {total[0]:,}, 총 용량: {total[1]:.2f} GB")
    print()

    # ────────────────────────────────────────────────────────
    print("=" * 70)
    print("정리 영역 1 — 임시·잠금·시스템 파일")
    print("=" * 70)
    rows = con.execute("""
        SELECT 'Office 잠금 (~$*)' AS kind, COUNT(*) AS cnt, SUM(size) AS sz
        FROM all_files WHERE name LIKE '~$%'
        UNION ALL
        SELECT '.tmp', COUNT(*), SUM(size) FROM all_files WHERE ext = 'tmp'
        UNION ALL
        SELECT '.bak', COUNT(*), SUM(size) FROM all_files WHERE ext = 'bak'
        UNION ALL
        SELECT 'Thumbs.db', COUNT(*), SUM(size) FROM all_files WHERE name = 'Thumbs.db'
        UNION ALL
        SELECT 'desktop.ini', COUNT(*), SUM(size) FROM all_files WHERE name = 'desktop.ini'
        UNION ALL
        SELECT '.DS_Store', COUNT(*), SUM(size) FROM all_files WHERE name = '.DS_Store'
        UNION ALL
        SELECT '0KB 파일', COUNT(*), SUM(size) FROM all_files WHERE size = 0
        ORDER BY cnt DESC
    """).fetchall()
    print(f"  {'kind':<25} {'개수':>10} {'용량 (MB)':>15}")
    for kind, cnt, sz in rows:
        if cnt:
            print(f"  {kind:<25} {cnt:>10,} {(sz or 0)/1e6:>15.2f}")
    print()

    # ────────────────────────────────────────────────────────
    print("=" * 70)
    print("정리 영역 2 — 백업·복사본·옛 자료 의심 (이름 패턴)")
    print("=" * 70)
    rows = con.execute("""
        SELECT pattern, cnt, sz/1e6 AS mb FROM (
          SELECT '복사본' AS pattern, COUNT(*) AS cnt, SUM(size) AS sz
            FROM all_files WHERE lower(name) LIKE '%복사본%' OR lower(name) LIKE 'copy of%' OR name LIKE '%- copy%'
          UNION ALL
          SELECT '_backup', COUNT(*), SUM(size) FROM all_files WHERE lower(name) LIKE '%backup%' OR lower(name) LIKE '%_bak%'
          UNION ALL
          SELECT '_old / _old_', COUNT(*), SUM(size) FROM all_files WHERE lower(name) LIKE '%_old%' OR lower(name) LIKE 'old_%'
          UNION ALL
          SELECT 'final 패턴', COUNT(*), SUM(size) FROM all_files WHERE lower(name) LIKE '%final%' OR lower(name) LIKE '%최종%'
          UNION ALL
          SELECT 'v숫자 (버전 의심)', COUNT(*), SUM(size) FROM all_files WHERE regexp_matches(lower(name), '_v[0-9]+')
          UNION ALL
          SELECT '_temp / 임시', COUNT(*), SUM(size) FROM all_files WHERE lower(name) LIKE '%temp%' OR lower(name) LIKE '%임시%'
        ) WHERE cnt > 0 ORDER BY cnt DESC
    """).fetchall()
    print(f"  {'패턴':<25} {'개수':>10} {'용량 (MB)':>15}")
    for kind, cnt, mb in rows:
        print(f"  {kind:<25} {cnt:>10,} {mb:>15.2f}")
    print()

    # ────────────────────────────────────────────────────────
    print("=" * 70)
    print("정리 영역 3 — 시간 분포 (Archive·삭제 후보)")
    print("=" * 70)
    rows = con.execute("""
        SELECT
          CASE
            WHEN mtime >= DATE '2025-05-21' THEN '최근 1년'
            WHEN mtime >= DATE '2024-05-21' THEN '1~2년'
            WHEN mtime >= DATE '2021-05-21' THEN '2~5년'
            WHEN mtime >= DATE '2016-05-21' THEN '5~10년'
            ELSE '10년 이상'
          END AS bucket,
          COUNT(*) AS cnt,
          SUM(size)/1e9 AS gb
        FROM all_files WHERE is_readable AND mtime IS NOT NULL
        GROUP BY bucket
        ORDER BY MAX(mtime) DESC
    """).fetchall()
    print(f"  {'기간':<15} {'개수':>10} {'용량 (GB)':>12}")
    for bucket, cnt, gb in rows:
        print(f"  {bucket:<15} {cnt:>10,} {gb:>12.2f}")
    print()

    # ────────────────────────────────────────────────────────
    print("=" * 70)
    print("정리 영역 4 — 거대 파일 (Top 20, 백업·압축 후보)")
    print("=" * 70)
    rows = con.execute("""
        SELECT path, size/1e6 AS mb
        FROM all_files
        WHERE is_readable
        ORDER BY size DESC LIMIT 20
    """).fetchall()
    print(f"  {'크기 (MB)':>12}  경로")
    for path, mb in rows:
        path_short = path if len(path) < 100 else "..." + path[-100:]
        print(f"  {mb:>12.1f}  {path_short}")
    print()

    # ────────────────────────────────────────────────────────
    print("=" * 70)
    print("정리 영역 5 — 확장자별 분포 (Top 15)")
    print("=" * 70)
    rows = con.execute("""
        SELECT COALESCE(NULLIF(ext,''),'(없음)') AS ext,
               COUNT(*) AS cnt, SUM(size)/1e9 AS gb
        FROM all_files WHERE is_readable
        GROUP BY ext ORDER BY gb DESC LIMIT 15
    """).fetchall()
    print(f"  {'확장자':<12} {'개수':>10} {'용량 (GB)':>12}")
    for ext, cnt, gb in rows:
        print(f"  {ext:<12} {cnt:>10,} {gb:>12.2f}")
    print()

    # ────────────────────────────────────────────────────────
    print("=" * 70)
    print("정리 영역 6 — Top 폴더 (가장 큰 폴더 Top 15)")
    print("=" * 70)
    rows = con.execute("""
        SELECT parent_dir, COUNT(*) AS cnt, SUM(size)/1e9 AS gb
        FROM all_files WHERE is_readable
        GROUP BY parent_dir
        ORDER BY gb DESC LIMIT 15
    """).fetchall()
    print(f"  {'개수':>8} {'GB':>8}  폴더")
    for parent, cnt, gb in rows:
        p_short = parent if len(parent) < 90 else "..." + parent[-90:]
        print(f"  {cnt:>8,} {gb:>8.2f}  {p_short}")
    print()

    print("=" * 70)
    print("⚠ 위 분석은 현재 진행 중인 스캔 중간 데이터 (일부 shard만)")
    print("   전체 스캔 완료(~1일) 후 더 정확한 인사이트 가능")
    print("=" * 70)

    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
