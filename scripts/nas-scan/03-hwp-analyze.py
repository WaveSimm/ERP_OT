"""
Tier 2: HWP 파일 버전·파싱 가능성 분석 (batch + 병렬 + timeout)

- HWP 5.0+: OLE Compound File (olefile로 읽기)
- HWP 3.0:  자체 바이너리 (시그니처 "HWP Document File")
- HWPX:     ZIP 컨테이너 (extension으로 판별)

2026-05-24: per-file timeout + 병렬 worker (Tier 3와 동일 패턴)

사용:
    python 03-hwp-analyze.py                # 기본 (6 worker, 20s timeout)
    python 03-hwp-analyze.py --max 1000
    python 03-hwp-analyze.py --workers 8
"""
from __future__ import annotations
import argparse
import multiprocessing as mp
import sys
import time
import warnings
from concurrent.futures import ProcessPoolExecutor, TimeoutError as FutTimeout

warnings.filterwarnings("ignore")

from common import (
    PROGRESS_INTERVAL, connect_db, open_run, close_run, log_error,
)

# 2026-05-24: per-file timeout (NAS 행 회피) + 병렬
PER_FILE_TIMEOUT_SEC = 20
DEFAULT_WORKERS = 6
BATCH_SIZE = 1000


def analyze_hwp(path: str, ext: str):
    """HWP 분석. 결과 (path, dict)."""
    out = {
        "hwp_version": None,
        "hwp_parseable": None,
        "scan_error": None,
    }
    try:
        if ext == "hwpx":
            # HWPX는 ZIP 컨테이너 — 확장자로 판별 + 첫 4바이트 PK\x03\x04 확인
            with open(path, "rb") as f:
                head = f.read(4)
            if head == b"PK\x03\x04":
                out["hwp_version"] = "hwpx"
                out["hwp_parseable"] = True
            else:
                out["hwp_version"] = "unknown"
                out["hwp_parseable"] = False
            return (path, out)

        # HWP — 매직 바이트 검사
        with open(path, "rb") as f:
            head = f.read(64)

        # HWP 5.0+: OLE Compound (\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1)
        if head[:8] == b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1":
            try:
                import olefile
                if olefile.isOleFile(path):
                    ole = olefile.OleFileIO(path)
                    streams = ole.listdir()
                    has_hwp = any("HwpSummaryInformation" in s or "FileHeader" in s for s in [str(x) for x in streams])
                    ole.close()
                    out["hwp_version"] = "5.0+"
                    out["hwp_parseable"] = has_hwp
                else:
                    out["hwp_version"] = "ole_non_hwp"
                    out["hwp_parseable"] = False
            except Exception as e:
                out["hwp_version"] = "5.0+"
                out["hwp_parseable"] = False
                out["scan_error"] = f"OLE 파싱 실패: {str(e)[:200]}"

        elif head.startswith(b"HWP Document File"):
            out["hwp_version"] = "3.0"
            out["hwp_parseable"] = False

        else:
            out["hwp_version"] = "unknown"
            out["hwp_parseable"] = False
            out["scan_error"] = f"HWP 시그니처 불일치: head={head[:16].hex()}"
    except Exception as e:
        out["scan_error"] = f"HWP 분석 실패: {str(e)[:200]}"
    return (path, out)


def main() -> int:
    ap = argparse.ArgumentParser(description="Tier 2: HWP 분석 (batch + 병렬 + timeout)")
    ap.add_argument("--max", type=int, default=None)
    ap.add_argument("--force", action="store_true", help="전체 재분석")
    ap.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help=f"병렬 worker 수 (기본 {DEFAULT_WORKERS})")
    ap.add_argument("--timeout", type=int, default=PER_FILE_TIMEOUT_SEC, help="per-file timeout (초)")
    args = ap.parse_args()

    con = connect_db()

    if args.force:
        where = "ext IN ('hwp', 'hwpx') AND is_readable = TRUE"
    else:
        where = (
            "ext IN ('hwp', 'hwpx') AND is_readable = TRUE AND hwp_version IS NULL "
            "AND (scan_error IS NULL OR (scan_error NOT LIKE 'HWP 분석 실패%' AND scan_error NOT LIKE 'TIMEOUT%'))"
        )

    limit = f"LIMIT {args.max}" if args.max else ""
    rows = con.execute(f"SELECT path, ext FROM files WHERE {where} {limit}").fetchall()

    total = len(rows)
    print(f"[Tier 2] HWP 분석 시작")
    print(f"  대상 HWP   : {total:,}")
    print(f"  병렬 worker: {args.workers}")
    print(f"  timeout    : {args.timeout}초 (per-file)")
    print()
    if total == 0:
        print("✓ 처리할 HWP 없음. 종료.")
        return 0

    run_id = open_run(con, tier="2", notes=f"hwp-analyze target={total} workers={args.workers}")

    t0 = time.time()
    processed = 0
    errors = 0
    timeouts = 0
    last_t = t0

    items = [(r[0], r[1]) for r in rows]

    try:
        for batch_start in range(0, len(items), BATCH_SIZE):
            batch = items[batch_start:batch_start + BATCH_SIZE]
            ex = ProcessPoolExecutor(max_workers=args.workers, mp_context=mp.get_context("spawn"))
            try:
                future_to_item = {ex.submit(analyze_hwp, p, e): (p, e) for (p, e) in batch}
                pending = set(future_to_item.keys())

                deadline = time.time() + (args.timeout * (len(batch) / max(args.workers, 1)) + args.timeout * 2)

                while pending and time.time() < deadline:
                    for f in list(pending):
                        if f.done():
                            pending.remove(f)
                            processed += 1
                            (p, _ext) = future_to_item[f]
                            try:
                                _, result = f.result()
                            except Exception as e:
                                result = {
                                    "hwp_version": None,
                                    "hwp_parseable": None,
                                    "scan_error": f"Worker 실패: {str(e)[:200]}",
                                }

                            if result["scan_error"]:
                                errors += 1
                                if errors <= 30 or errors % 500 == 0:
                                    log_error(f"HWP [{p[:120]}]: {result['scan_error']}")

                            try:
                                con.execute("""
                                    UPDATE files SET
                                        hwp_version = ?,
                                        hwp_parseable = ?,
                                        scan_error = COALESCE(?, scan_error),
                                        updated_at = now()
                                    WHERE path = ?
                                """, [
                                    result["hwp_version"], result["hwp_parseable"],
                                    result["scan_error"], p,
                                ])
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
                        time.sleep(0.3)

                # batch deadline 후 pending은 TIMEOUT 처리
                for f in pending:
                    (p, _ext) = future_to_item[f]
                    timeouts += 1
                    errors += 1
                    if timeouts <= 30 or timeouts % 50 == 0:
                        log_error(f"HWP TIMEOUT [{p[:120]}]")
                    try:
                        con.execute(
                            "UPDATE files SET scan_error = ?, updated_at = now() WHERE path = ?",
                            ["TIMEOUT after batch deadline", p],
                        )
                    except Exception as e:
                        log_error(f"DB update timeout [{p[:120]}]: {e}")
                    processed += 1
            finally:
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
    print(f"✓ Tier 2 완료")
    print(f"  처리       : {processed:,}")
    print(f"  에러       : {errors}")
    print(f"  TIMEOUT    : {timeouts}")
    print(f"  소요 시간  : {elapsed/60:.1f}분")
    print(f"  처리 속도  : {processed/max(elapsed,1):.1f} HWP/초")
    return 0


if __name__ == "__main__":
    sys.exit(main())
