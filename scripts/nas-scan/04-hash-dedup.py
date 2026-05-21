"""
Tier 3: 파일 head 1MB hash (중복 탐지용)

- 모든 파일의 첫 1MB SHA-256 hash 계산
- 같은 hash + 같은 size → 중복 후보
- 너무 작은 파일(<4KB)은 skip (의미 없음)
- 너무 큰 파일도 1MB만 (시간 절약)

사용:
    python 04-hash-dedup.py
    python 04-hash-dedup.py --max 10000
"""
from __future__ import annotations
import argparse
import hashlib
import sys
import time

from common import (
    PROGRESS_INTERVAL, connect_db, open_run, close_run, log_error, fmt_size,
)

CHUNK_SIZE = 1024 * 1024  # 1MB
MIN_SIZE = 4096            # 4KB 미만은 skip


def hash_head(path: str) -> str | None:
    """파일 head 1MB SHA-256."""
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            data = f.read(CHUNK_SIZE)
            if not data:
                return None
            h.update(data)
        return h.hexdigest()
    except (PermissionError, OSError):
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Tier 3: head 1MB hash")
    ap.add_argument("--max", type=int, default=None)
    ap.add_argument("--force", action="store_true", help="모든 파일 재계산")
    args = ap.parse_args()

    con = connect_db()

    if args.force:
        where = f"is_readable = TRUE AND size >= {MIN_SIZE}"
    else:
        where = f"is_readable = TRUE AND size >= {MIN_SIZE} AND hash_head1mb IS NULL"

    limit = f"LIMIT {args.max}" if args.max else ""
    rows = con.execute(f"SELECT path FROM files WHERE {where} {limit}").fetchall()

    total = len(rows)
    print(f"[Tier 3] Hash (head 1MB) 시작")
    print(f"  대상 파일  : {total:,} ({fmt_size(MIN_SIZE)} 이상)")
    print()
    if total == 0:
        print("✓ 처리 대상 없음. 종료.")
        return 0

    run_id = open_run(con, tier="3", notes=f"hash target={total}")

    t0 = time.time()
    processed = 0
    errors = 0
    last_t = t0

    try:
        for (path,) in rows:
            processed += 1
            h = hash_head(path)
            if h is None:
                errors += 1
                if errors <= 30 or errors % 500 == 0:
                    log_error(f"hash 실패 [{path[:120]}]")

            try:
                con.execute(
                    "UPDATE files SET hash_head1mb = ?, updated_at = now() WHERE path = ?",
                    [h, path],
                )
            except Exception as e:
                errors += 1
                log_error(f"DB update [{path[:120]}]: {e}")

            if processed % PROGRESS_INTERVAL == 0:
                now = time.time()
                rate = PROGRESS_INTERVAL / max(now - last_t, 0.001)
                last_t = now
                eta = (total - processed) / max(rate, 0.001)
                print(
                    f"  [{processed:>8,}/{total:,}] rate={rate:>5.1f}/s  errors={errors}  ETA={eta/60:.1f}min",
                    flush=True,
                )
    except KeyboardInterrupt:
        print("\n⚠ 중단됨.", file=sys.stderr)
    finally:
        close_run(con, run_id, files_seen=processed, files_updated=processed - errors, errors=errors)
        con.close()

    elapsed = time.time() - t0
    print()
    print(f"✓ Tier 3 완료")
    print(f"  처리       : {processed:,}")
    print(f"  에러       : {errors}")
    print(f"  소요 시간  : {elapsed/60:.1f}분")
    return 0


if __name__ == "__main__":
    sys.exit(main())
