"""
Tier 2: HWP 파일 버전·파싱 가능성 분석

- HWP 5.0+: OLE Compound File (olefile로 읽기)
- HWP 3.0:  자체 바이너리 (시그니처 "HWP Document File")
- HWPX:     ZIP 컨테이너 (extension으로 판별)

사용:
    python 03-hwp-analyze.py
    python 03-hwp-analyze.py --max 1000
"""
from __future__ import annotations
import argparse
import sys
import time
import warnings

warnings.filterwarnings("ignore")

from common import (
    PROGRESS_INTERVAL, connect_db, open_run, close_run, log_error,
)


def analyze_hwp(path: str, ext: str):
    """HWP 분석. 결과 dict."""
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
            return out

        # HWP — 매직 바이트 검사
        with open(path, "rb") as f:
            head = f.read(64)

        # HWP 5.0+: OLE Compound (\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1)
        if head[:8] == b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1":
            # OLE 컨테이너 안에서 "HWP Document File" 스트림 확인
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

        # HWP 3.0: "HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05"
        elif head.startswith(b"HWP Document File"):
            out["hwp_version"] = "3.0"
            out["hwp_parseable"] = False  # 3.0은 libhwp/pyhwp 등 별도 도구 필요

        else:
            out["hwp_version"] = "unknown"
            out["hwp_parseable"] = False
            out["scan_error"] = f"HWP 시그니처 불일치: head={head[:16].hex()}"
    except Exception as e:
        out["scan_error"] = f"HWP 분석 실패: {str(e)[:200]}"
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Tier 2: HWP 분석")
    ap.add_argument("--max", type=int, default=None)
    ap.add_argument("--force", action="store_true", help="전체 재분석")
    args = ap.parse_args()

    con = connect_db()

    if args.force:
        where = "ext IN ('hwp', 'hwpx') AND is_readable = TRUE"
    else:
        where = "ext IN ('hwp', 'hwpx') AND is_readable = TRUE AND hwp_version IS NULL"

    limit = f"LIMIT {args.max}" if args.max else ""
    rows = con.execute(f"SELECT path, ext FROM files WHERE {where} {limit}").fetchall()

    total = len(rows)
    print(f"[Tier 2] HWP 분석 시작")
    print(f"  대상 HWP   : {total:,}")
    print()
    if total == 0:
        print("✓ 처리할 HWP 없음. 종료.")
        return 0

    run_id = open_run(con, tier="2", notes=f"hwp-analyze target={total}")

    t0 = time.time()
    processed = 0
    errors = 0
    last_t = t0

    try:
        for (path, ext) in rows:
            processed += 1
            result = analyze_hwp(path, ext)
            if result["scan_error"]:
                errors += 1
                if errors <= 30 or errors % 200 == 0:
                    log_error(f"HWP [{path[:120]}]: {result['scan_error']}")

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
                    result["scan_error"], path,
                ])
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
    print(f"✓ Tier 2 완료")
    print(f"  처리       : {processed:,}")
    print(f"  에러       : {errors}")
    print(f"  소요 시간  : {elapsed/60:.1f}분")
    return 0


if __name__ == "__main__":
    sys.exit(main())
