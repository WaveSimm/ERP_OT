"""
Tier 1: PDF 페이지·텍스트 레이어 분석 (pypdf + batch + 병렬 + size 필터)

2026-05-24: pdfplumber → pypdf 전환 (메모리 폭증 회피)
  - pypdf: lazy 파싱, 메모리 효율, 페이지·메타 빠르게 추출
  - 사이즈 사전 필터:
    * >= 500MB: skip 마킹 (분석 불가, 너무 큼)
    * 100MB ~ 500MB: 페이지·메타만, text 추출 skip
    * < 100MB: 정상 분석
  - per-file timeout 60초 (batch deadline 패턴)
  - 4 병렬 worker

사용:
    python 02-pdf-analyze.py                # 기본 (4 worker, 60s)
    python 02-pdf-analyze.py --max 100
    python 02-pdf-analyze.py --workers 6
"""
from __future__ import annotations
import argparse
import multiprocessing as mp
import sys
import time
import warnings
from concurrent.futures import ProcessPoolExecutor

# pypdf 경고 끄기
warnings.filterwarnings("ignore")

from common import (
    PROGRESS_INTERVAL, connect_db, open_run, close_run,
    log_error, fmt_size,
)

# 텍스트 레이어 판단 임계값
MIN_TEXT_CHARS_PER_PAGE = 50

# 스캔 PDF 의심 producer/creator 키워드 (case-insensitive)
SCAN_KEYWORDS = ("scan", "scanner", "scansnap", "neat", "epson", "fujitsu", "canon scan")

# 사이즈 임계값
LARGE_SIZE_BYTES    = 500 * 1024 * 1024   # 500MB: 완전 skip
NO_TEXT_SIZE_BYTES  = 100 * 1024 * 1024   # 100MB: text 추출 skip (페이지/메타만)

PER_FILE_TIMEOUT_SEC = 60
DEFAULT_WORKERS = 4
BATCH_SIZE = 500


def analyze_pdf(path: str, size: int | None):
    """PDF 분석 (pypdf 기반). 반환 (path, dict)."""
    out = {
        "pdf_pages": None,
        "pdf_has_text": None,
        "pdf_text_chars": 0,
        "pdf_creator": None,
        "pdf_is_scan_likely": None,
        "scan_error": None,
    }

    # 안전 장치 1: 매우 큰 PDF는 즉시 skip
    if size and size >= LARGE_SIZE_BYTES:
        out["scan_error"] = f"large_pdf_skip: {size // 1024 // 1024}MB"
        return (path, out)

    try:
        from pypdf import PdfReader

        # strict=False: 일부 손상 PDF도 best-effort 파싱
        reader = PdfReader(path, strict=False)

        # 페이지 수 (lazy load 후 len)
        try:
            out["pdf_pages"] = len(reader.pages)
        except Exception as e:
            out["scan_error"] = f"페이지 수 추출 실패: {str(e)[:150]}"
            return (path, out)

        # 메타데이터
        try:
            meta = reader.metadata
            if meta:
                creator = meta.get("/Creator") or meta.get("/Producer") or ""
                out["pdf_creator"] = str(creator)[:200]
        except Exception:
            out["pdf_creator"] = ""

        # 안전 장치 2: 100MB 이상은 text 추출 skip (메모리 보호)
        if size and size >= NO_TEXT_SIZE_BYTES:
            out["scan_error"] = f"text_skip_large: {size // 1024 // 1024}MB (페이지만 측정)"
            # 메타로만 스캔 판별
            creator_lower = (out["pdf_creator"] or "").lower()
            out["pdf_is_scan_likely"] = any(kw in creator_lower for kw in SCAN_KEYWORDS)
            return (path, out)

        # 정상 분석: 첫 5페이지 텍스트 추출
        try:
            sample_pages = reader.pages[:5]
            total_chars = 0
            for p in sample_pages:
                text = p.extract_text() or ""
                total_chars += len(text)
            out["pdf_text_chars"] = total_chars

            avg_chars = total_chars / max(len(sample_pages), 1)
            creator_lower = (out["pdf_creator"] or "").lower()
            is_scan = (
                avg_chars < MIN_TEXT_CHARS_PER_PAGE
                or any(kw in creator_lower for kw in SCAN_KEYWORDS)
            )
            out["pdf_has_text"] = avg_chars >= MIN_TEXT_CHARS_PER_PAGE
            out["pdf_is_scan_likely"] = is_scan
        except Exception as e:
            # text 추출만 실패 — 페이지·메타는 이미 채워짐
            out["scan_error"] = f"text 추출 실패: {str(e)[:150]}"
            creator_lower = (out["pdf_creator"] or "").lower()
            out["pdf_is_scan_likely"] = any(kw in creator_lower for kw in SCAN_KEYWORDS)
    except Exception as e:
        out["scan_error"] = f"PDF 분석 실패: {str(e)[:200]}"
    return (path, out)


def main() -> int:
    ap = argparse.ArgumentParser(description="Tier 1: PDF 분석 (pypdf + 사이즈 필터 + 병렬)")
    ap.add_argument("--max", type=int, default=None, help="최대 처리 (테스트용)")
    ap.add_argument("--resume", action="store_true", default=True, help="미처리만 (기본)")
    ap.add_argument("--force", action="store_true", help="모든 PDF 재분석")
    ap.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help=f"병렬 worker (기본 {DEFAULT_WORKERS})")
    ap.add_argument("--timeout", type=int, default=PER_FILE_TIMEOUT_SEC, help="per-file timeout (초)")
    args = ap.parse_args()

    con = connect_db()

    # 대상 PDF 조회 (size 포함)
    if args.force:
        where = "ext = 'pdf' AND is_readable = TRUE"
    else:
        where = (
            "ext = 'pdf' AND is_readable = TRUE AND pdf_pages IS NULL "
            "AND (scan_error IS NULL OR ("
            "scan_error NOT LIKE 'PDF 분석 실패%' "
            "AND scan_error NOT LIKE 'TIMEOUT%' "
            "AND scan_error NOT LIKE 'large_pdf_skip%' "
            "AND scan_error NOT LIKE 'text_skip_large%' "
            "AND scan_error NOT LIKE '페이지 수 추출 실패%'"
            "))"
        )

    limit = f"LIMIT {args.max}" if args.max else ""
    rows = con.execute(f"SELECT path, size FROM files WHERE {where} {limit}").fetchall()

    total = len(rows)
    print(f"[Tier 1] PDF 분석 시작 (pypdf 기반)")
    print(f"  대상 PDF   : {total:,}")
    print(f"  모드       : {'force (전체 재분석)' if args.force else 'resume (미처리만)'}")
    print(f"  병렬 worker: {args.workers}")
    print(f"  timeout    : {args.timeout}초 (per-file)")
    print(f"  큰 PDF skip: ≥{fmt_size(LARGE_SIZE_BYTES)} (완전 skip), ≥{fmt_size(NO_TEXT_SIZE_BYTES)} (text skip)")
    print()
    if total == 0:
        print("✓ 처리할 PDF 없음. 종료.")
        return 0

    run_id = open_run(con, tier="1", notes=f"pdf-analyze-pypdf target={total} workers={args.workers}")

    t0 = time.time()
    processed = 0
    errors = 0
    timeouts = 0
    large_skipped = 0
    last_t = t0

    items = [(r[0], r[1]) for r in rows]

    try:
        for batch_start in range(0, len(items), BATCH_SIZE):
            batch = items[batch_start:batch_start + BATCH_SIZE]
            ex = ProcessPoolExecutor(max_workers=args.workers, mp_context=mp.get_context("spawn"))
            try:
                future_to_item = {ex.submit(analyze_pdf, p, s): (p, s) for (p, s) in batch}
                pending = set(future_to_item.keys())

                # batch deadline: timeout * (batch_size / workers) + buffer
                deadline = time.time() + (args.timeout * (len(batch) / max(args.workers, 1)) + args.timeout * 2)

                while pending and time.time() < deadline:
                    for f in list(pending):
                        if f.done():
                            pending.remove(f)
                            processed += 1
                            (p, s) = future_to_item[f]
                            try:
                                _, result = f.result()
                            except Exception as e:
                                result = {
                                    "pdf_pages": None, "pdf_has_text": None, "pdf_text_chars": 0,
                                    "pdf_creator": None, "pdf_is_scan_likely": None,
                                    "scan_error": f"Worker 실패: {str(e)[:200]}",
                                }

                            err = result.get("scan_error") or ""
                            if err:
                                if "skip" in err.lower():
                                    large_skipped += 1
                                else:
                                    errors += 1
                                    if errors <= 50 or errors % 200 == 0:
                                        log_error(f"PDF [{p[:120]}]: {err}")

                            try:
                                con.execute("""
                                    UPDATE files SET
                                        pdf_pages = ?,
                                        pdf_has_text = ?,
                                        pdf_text_chars = ?,
                                        pdf_creator = ?,
                                        pdf_is_scan_likely = ?,
                                        scan_error = COALESCE(?, scan_error),
                                        updated_at = now()
                                    WHERE path = ?
                                """, [
                                    result["pdf_pages"], result["pdf_has_text"], result["pdf_text_chars"],
                                    result["pdf_creator"], result["pdf_is_scan_likely"],
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
                                    f"  [{processed:>8,}/{total:,}] rate={rate:>5.1f}/s  "
                                    f"errors={errors}  timeouts={timeouts}  skip={large_skipped}  "
                                    f"ETA={eta/60:.1f}min",
                                    flush=True,
                                )
                    if pending:
                        time.sleep(0.5)

                # batch deadline 후 pending은 TIMEOUT 처리
                for f in pending:
                    (p, s) = future_to_item[f]
                    timeouts += 1
                    if timeouts <= 30 or timeouts % 50 == 0:
                        log_error(f"PDF TIMEOUT [{p[:120]}]")
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
        print("\n⚠ 중단됨. 재실행 시 이어서 처리합니다.", file=sys.stderr)
    finally:
        close_run(con, run_id, files_seen=processed, files_updated=processed - errors, errors=errors)
        con.close()

    elapsed = time.time() - t0
    print()
    print(f"✓ Tier 1 완료")
    print(f"  처리 PDF   : {processed:,}")
    print(f"  에러       : {errors}")
    print(f"  TIMEOUT    : {timeouts}")
    print(f"  큰 PDF skip: {large_skipped}")
    print(f"  소요 시간  : {elapsed/60:.1f}분")
    print(f"  처리 속도  : {processed/max(elapsed,1):.1f} PDF/초")
    return 0


if __name__ == "__main__":
    sys.exit(main())
