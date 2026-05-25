"""
Tier 3: 파일 head 1MB hash (중복 탐지용 - "같은 파일 인지"가 목적)

- size-group 1차 필터: 같은 size가 2개 이상인 그룹만 hash 대상 (대상 수 70~85% 감소)
- per-file timeout (NAS I/O 행 회피)
- 병렬 worker (NAS 동시 read 활용)
- 모든 파일의 첫 1MB SHA-256 hash 계산
- 같은 hash + 같은 size → 중복 후보
- 너무 작은 파일(<4KB)은 skip

사용:
    python 04-hash-dedup.py                    # 기본: size-group + 6 worker + 60s timeout
    python 04-hash-dedup.py --max 10000         # 테스트
    python 04-hash-dedup.py --workers 8         # worker 수 조정
    python 04-hash-dedup.py --timeout 30        # per-file timeout 조정
    python 04-hash-dedup.py --no-size-filter    # size-group 필터 끔 (전체 hash)
    python 04-hash-dedup.py --force             # 모든 파일 재계산
"""
from __future__ import annotations
import argparse
import hashlib
import multiprocessing as mp
import sys
import time
from concurrent.futures import ProcessPoolExecutor, TimeoutError as FutTimeout, as_completed

from common import (
    PROGRESS_INTERVAL, connect_db, open_run, close_run, log_error, fmt_size,
)

CHUNK_SIZE = 128 * 1024    # 128KB (2026-05-24: 1MB → 128KB로 축소, NAS read 8배 가속, 같은 파일 식별 충분)
MIN_SIZE = 1024 * 1024     # 1MB (2026-05-24: NAS latency 병목으로 5MB+ 파일만 hash 가치 큼. 큰 파일 중복이 진짜 의미)
PER_FILE_TIMEOUT_SEC = 60
DEFAULT_WORKERS = 12       # 6 → 12 (NAS 동시 SMB connection 활용)


def hash_head(path: str) -> tuple[str, str | None, str | None]:
    """파일 head 1MB SHA-256.
    반환: (path, hash or None, error or None)
    """
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            data = f.read(CHUNK_SIZE)
            if not data:
                return (path, None, "empty_read")
            h.update(data)
        return (path, h.hexdigest(), None)
    except (PermissionError, OSError) as e:
        return (path, None, f"IO: {str(e)[:200]}")
    except Exception as e:
        return (path, None, f"hash 실패: {str(e)[:200]}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Tier 3: head 1MB hash (size-group filter + 병렬)")
    ap.add_argument("--max", type=int, default=None)
    ap.add_argument("--force", action="store_true", help="모든 파일 재계산")
    ap.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help=f"병렬 worker 수 (기본 {DEFAULT_WORKERS})")
    ap.add_argument("--timeout", type=int, default=PER_FILE_TIMEOUT_SEC, help="per-file timeout (초)")
    ap.add_argument("--no-size-filter", action="store_true", help="size-group 1차 필터 끔 (전체 hash)")
    args = ap.parse_args()

    con = connect_db()

    # 대상 쿼리 (2026-05-24: size-group 1차 필터 적용)
    base_where = f"is_readable = TRUE AND size >= {MIN_SIZE}"
    if not args.force:
        base_where += " AND hash_head1mb IS NULL"

    if args.no_size_filter:
        # 전체 모드 (이전 동작)
        where_clause = base_where
        filter_desc = "전체 hash (size-group 필터 꺼짐)"
    else:
        # 2026-05-24: size + ext 그룹 필터 강화 — 같은 ext + 같은 size 2개 이상
        #   동일 파일이면 size·ext 모두 같음. 다른 ext의 동일 size는 중복일 수 없음
        #   → 대상 수 추가 감소 (효과: 작은 사이즈 group에서 ext 다른 파일들 제외)
        where_clause = (
            f"{base_where} "
            f"AND (COALESCE(ext, ''), size) IN ("
            f"  SELECT COALESCE(ext, ''), size FROM files "
            f"  WHERE is_readable = TRUE AND size >= {MIN_SIZE} "
            f"  GROUP BY COALESCE(ext, ''), size HAVING COUNT(*) >= 2"
            f")"
        )
        filter_desc = "size+ext 그룹 필터 (강화: 같은 ext 안에서 같은 size)"

    limit = f"LIMIT {args.max}" if args.max else ""
    print(f"[Tier 3] 대상 파일 조회 중...")
    rows = con.execute(f"SELECT path FROM files WHERE {where_clause} {limit}").fetchall()

    total = len(rows)

    # 전체 모드 vs filter 모드 대비 표시
    total_all = con.execute(f"SELECT COUNT(*) FROM files WHERE {base_where}").fetchone()[0]

    print(f"[Tier 3] Hash (head 1MB) 시작")
    print(f"  필터       : {filter_desc}")
    print(f"  대상 파일  : {total:,} (전체 후보 {total_all:,} 중 {total/max(total_all,1)*100:.1f}%)")
    print(f"  최소 크기  : {fmt_size(MIN_SIZE)} 이상")
    print(f"  병렬 worker: {args.workers}")
    print(f"  timeout    : {args.timeout}초 (per-file)")
    print()
    if total == 0:
        print("✓ 처리 대상 없음. 종료.")
        return 0

    run_id = open_run(con, tier="3", notes=f"hash target={total} workers={args.workers} filter={'on' if not args.no_size_filter else 'off'}")

    t0 = time.time()
    processed = 0
    errors = 0
    timeouts = 0
    last_t = t0

    paths = [r[0] for r in rows]

    try:
        # 청크 단위로 submit (메모리 부담 회피)
        BATCH = 1000
        for batch_start in range(0, len(paths), BATCH):
            batch_paths = paths[batch_start:batch_start + BATCH]
            ex = ProcessPoolExecutor(max_workers=args.workers, mp_context=mp.get_context("spawn"))
            try:
                future_to_path = {ex.submit(hash_head, p): p for p in batch_paths}
                done_set = set()
                # as_completed 사용. 단, 일부 future가 timeout 걸려서 영원히 안 끝날 수 있으므로
                # 전체 batch에 대해 (timeout * batch_size / workers) 정도의 deadline 적용
                deadline = time.time() + (args.timeout * (len(batch_paths) / max(args.workers, 1)) + args.timeout * 2)
                pending = set(future_to_path.keys())

                # 폴링 방식: 짧은 timeout으로 done 수집
                while pending and time.time() < deadline:
                    for f in list(pending):
                        if f.done():
                            pending.remove(f)
                            processed += 1
                            p = future_to_path[f]
                            try:
                                _, h, err = f.result()
                            except Exception as e:
                                h, err = None, f"Worker 실패: {str(e)[:200]}"

                            if err:
                                errors += 1
                                if errors <= 30 or errors % 500 == 0:
                                    log_error(f"hash [{p[:120]}]: {err}")

                            try:
                                # err가 timeout/IO이면 scan_error에 기록
                                scan_err = err if err else None
                                con.execute(
                                    "UPDATE files SET hash_head1mb = ?, scan_error = COALESCE(?, scan_error), updated_at = now() WHERE path = ?",
                                    [h, scan_err, p],
                                )
                            except Exception as e:
                                errors += 1
                                log_error(f"DB update [{p[:120]}]: {e}")

                            if processed % PROGRESS_INTERVAL == 0:
                                now = time.time()
                                rate = PROGRESS_INTERVAL / max(now - last_t, 0.001)
                                last_t = now
                                eta = (total - processed) / max(rate, 0.001)
                                print(
                                    f"  [{processed:>8,}/{total:,}] rate={rate:>5.1f}/s  errors={errors}  timeouts={timeouts}  ETA={eta/60:.1f}min",
                                    flush=True,
                                )
                    if pending:
                        time.sleep(0.5)

                # deadline 후 남은 pending은 timeout 처리
                for f in pending:
                    p = future_to_path[f]
                    timeouts += 1
                    errors += 1
                    if timeouts <= 30 or timeouts % 50 == 0:
                        log_error(f"hash TIMEOUT [{p[:120]}]")
                    try:
                        con.execute(
                            "UPDATE files SET hash_head1mb = NULL, scan_error = ?, updated_at = now() WHERE path = ?",
                            [f"TIMEOUT after batch deadline", p],
                        )
                    except Exception as e:
                        log_error(f"DB update timeout [{p[:120]}]: {e}")
                    processed += 1
            finally:
                # 강제 종료 (남은 worker process)
                try:
                    ex.shutdown(wait=False, cancel_futures=True)
                except Exception:
                    pass
                for child in mp.active_children():
                    try:
                        child.kill()
                        child.join(timeout=2)
                    except Exception:
                        pass
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
    print(f"  TIMEOUT    : {timeouts}")
    print(f"  소요 시간  : {elapsed/60:.1f}분")
    print(f"  처리 속도  : {processed/max(elapsed,1):.1f} 파일/초")
    return 0


if __name__ == "__main__":
    sys.exit(main())
