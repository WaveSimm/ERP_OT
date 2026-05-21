"""
Tier 1: PDF 페이지·텍스트 레이어 분석

- DB에서 ext='pdf' 파일 조회 (pdf_pages IS NULL 우선)
- pdfplumber로 페이지 수·텍스트 양 추출
- 텍스트 레이어 유무 → 스캔 PDF 판별
- producer/creator 메타에서 스캐너 의심 패턴 검출

사용:
    python 02-pdf-analyze.py
    python 02-pdf-analyze.py --max 1000     # 테스트
    python 02-pdf-analyze.py --resume       # 미처리만 (기본)
    python 02-pdf-analyze.py --force        # 전체 재분석
"""
from __future__ import annotations
import argparse
import sys
import time
import warnings

# pdfplumber 경고 끄기
warnings.filterwarnings("ignore")

from common import (
    PROGRESS_INTERVAL, connect_db, open_run, close_run,
    log_error, fmt_size,
)

# 텍스트 레이어 판단 임계값
MIN_TEXT_CHARS_PER_PAGE = 50

# 스캔 PDF 의심 producer/creator 키워드 (case-insensitive)
SCAN_KEYWORDS = ("scan", "scanner", "scansnap", "neat", "epson", "fujitsu", "canon scan")


def analyze_pdf(path: str):
    """PDF 분석 결과 dict 반환. 실패 시 error 포함."""
    import pdfplumber
    out = {
        "pdf_pages": None,
        "pdf_has_text": None,
        "pdf_text_chars": 0,
        "pdf_creator": None,
        "pdf_is_scan_likely": None,
        "scan_error": None,
    }
    try:
        with pdfplumber.open(path) as pdf:
            out["pdf_pages"] = len(pdf.pages)
            # 첫 5페이지만 sampling (큰 PDF 회피)
            sample_pages = pdf.pages[:5]
            total_chars = 0
            for p in sample_pages:
                text = p.extract_text() or ""
                total_chars += len(text)
            out["pdf_text_chars"] = total_chars

            # 메타
            meta = pdf.metadata or {}
            creator = meta.get("Creator") or meta.get("Producer") or ""
            out["pdf_creator"] = str(creator)[:200]

            # 스캔 판별
            avg_chars = total_chars / max(len(sample_pages), 1)
            creator_lower = (out["pdf_creator"] or "").lower()
            is_scan = (
                avg_chars < MIN_TEXT_CHARS_PER_PAGE
                or any(kw in creator_lower for kw in SCAN_KEYWORDS)
            )
            out["pdf_has_text"] = avg_chars >= MIN_TEXT_CHARS_PER_PAGE
            out["pdf_is_scan_likely"] = is_scan
    except Exception as e:
        out["scan_error"] = f"PDF 분석 실패: {str(e)[:200]}"
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Tier 1: PDF 페이지·텍스트 레이어 분석")
    ap.add_argument("--max", type=int, default=None, help="최대 처리 (테스트용)")
    ap.add_argument("--resume", action="store_true", default=True, help="미처리만 (기본)")
    ap.add_argument("--force", action="store_true", help="모든 PDF 재분석")
    args = ap.parse_args()

    con = connect_db()

    # 대상 PDF 조회
    if args.force:
        where = "ext = 'pdf' AND is_readable = TRUE"
    else:
        where = "ext = 'pdf' AND is_readable = TRUE AND pdf_pages IS NULL AND (scan_error IS NULL OR scan_error NOT LIKE 'PDF 분석 실패%')"

    limit = f"LIMIT {args.max}" if args.max else ""
    rows = con.execute(f"SELECT path FROM files WHERE {where} {limit}").fetchall()

    total = len(rows)
    print(f"[Tier 1] PDF 분석 시작")
    print(f"  대상 PDF   : {total:,}")
    print(f"  모드       : {'force (전체 재분석)' if args.force else 'resume (미처리만)'}")
    print()
    if total == 0:
        print("✓ 처리할 PDF 없음. 종료.")
        return 0

    run_id = open_run(con, tier="1", notes=f"pdf-analyze target={total}")

    t0 = time.time()
    processed = 0
    errors = 0
    last_t = t0

    try:
        for (path,) in rows:
            processed += 1
            result = analyze_pdf(path)
            if result["scan_error"]:
                errors += 1
                # 한 줄 요약만 (수천 개 PDF 에러 시 로그 폭발 회피)
                if errors <= 50 or errors % 100 == 0:
                    log_error(f"PDF [{path[:120]}]: {result['scan_error']}")

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
                    result["scan_error"], path,
                ])
            except Exception as e:
                errors += 1
                log_error(f"DB update 실패 [{path[:120]}]: {e}")

            if processed % PROGRESS_INTERVAL == 0:
                now = time.time()
                rate = PROGRESS_INTERVAL / max(now - last_t, 0.001)
                last_t = now
                eta = (total - processed) / max(rate, 0.001)
                print(
                    f"  [{processed:>8,}/{total:,}] "
                    f"rate={rate:>5.1f}/s  errors={errors}  "
                    f"ETA={eta/60:.1f}min",
                    flush=True,
                )
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
    print(f"  소요 시간  : {elapsed/60:.1f}분")
    print(f"  처리 속도  : {processed/max(elapsed,1):.1f} PDF/초")
    return 0


if __name__ == "__main__":
    sys.exit(main())
