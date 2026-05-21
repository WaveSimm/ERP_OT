"""
헬퍼: 특정 Tier의 완료 여부 확인 → exit 0 (완료) / 1 (미완료) / 2 (에러)

사용:
    python _check-tier-done.py 0
"""
import sys
import duckdb
from pathlib import Path

DB = Path(__file__).resolve().parent / "data" / "nas-scan.duckdb"

def main():
    if len(sys.argv) < 2:
        print("usage: _check-tier-done.py <tier>", file=sys.stderr)
        sys.exit(2)
    tier = sys.argv[1]
    try:
        # read_only로 시도 (쓰기 중인 프로세스와 충돌 회피)
        con = duckdb.connect(str(DB), read_only=True)
        cnt = con.execute(
            "SELECT COUNT(*) FROM scan_runs WHERE tier = ? AND ended_at IS NOT NULL",
            [tier],
        ).fetchone()[0]
        con.close()
        sys.exit(0 if cnt > 0 else 1)
    except Exception as e:
        # DB 락 / 파일 없음 등 — 미완료로 간주
        print(f"check error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
