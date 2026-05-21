"""
Tier 0: NAS 전체 walk → 파일 메타데이터 수집

- os.walk로 NAS 순회
- 50.SoftWare(...) 폴더 제외
- 각 파일: path/size/mtime/ctime/ext/depth/top_dir
- DuckDB에 idempotent INSERT (path가 PK, 재실행 시 갱신)
- 권한 차단·잠긴 파일은 skip + 로그
- 진행률 500개마다 출력
- 중단 시 재실행 가능

사용:
    python 01-walk-and-record.py
    python 01-walk-and-record.py --dry-run    # 카운트만
    python 01-walk-and-record.py --max 10000  # 테스트용 (10000개에서 중단)
"""
from __future__ import annotations
import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from common import (
    NAS_ROOT, EXCLUDE_TOP_DIRS, PROGRESS_INTERVAL,
    connect_db, open_run, close_run,
    normalize_path, get_top_dir, get_ext, is_excluded, log_error, fmt_size,
)


def iter_files(root: str, max_count: int | None = None):
    """NAS를 walk하며 (full_path, top_dir, depth) 반환."""
    seen = 0
    root_len = len(root.rstrip("\\/")) + 1
    for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        # 상대 경로
        rel = dirpath[root_len:] if len(dirpath) > root_len else ""
        top_dir = get_top_dir(rel) if rel else ""

        # 제외 폴더는 walk 자체 차단
        if not rel:
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_TOP_DIRS]
        elif top_dir in EXCLUDE_TOP_DIRS:
            dirnames[:] = []
            continue

        depth = dirpath.replace("\\", "/").count("/")

        for fname in filenames:
            if is_excluded(fname):
                continue
            full = os.path.join(dirpath, fname)
            yield full, top_dir, depth
            seen += 1
            if max_count and seen >= max_count:
                return


def stat_to_dict(path: str, top_dir: str, depth: int):
    """파일 stat을 dict로 변환. 에러 시 None."""
    try:
        st = os.stat(path)
        return {
            "path":       normalize_path(path),
            "name":       normalize_path(os.path.basename(path)),
            "ext":        get_ext(os.path.basename(path)),
            "parent_dir": normalize_path(os.path.dirname(path)),
            "top_dir":    normalize_path(top_dir),
            "depth":      depth,
            "size":       st.st_size,
            "mtime":      datetime.fromtimestamp(st.st_mtime),
            "ctime":      datetime.fromtimestamp(st.st_ctime),
            "is_readable": True,
            "scan_error": None,
        }
    except (PermissionError, OSError) as e:
        return {
            "path":       normalize_path(path),
            "name":       normalize_path(os.path.basename(path)),
            "ext":        get_ext(os.path.basename(path)),
            "parent_dir": normalize_path(os.path.dirname(path)),
            "top_dir":    normalize_path(top_dir),
            "depth":      depth,
            "size":       None,
            "mtime":      None,
            "ctime":      None,
            "is_readable": False,
            "scan_error": str(e)[:200],
        }


def upsert_file(con, rec: dict) -> None:
    """idempotent INSERT/UPDATE. path 기준."""
    con.execute("""
        INSERT INTO files (path, name, ext, parent_dir, top_dir, depth, size, mtime, ctime, is_readable, scan_error, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
        ON CONFLICT (path) DO UPDATE SET
            size = excluded.size,
            mtime = excluded.mtime,
            ctime = excluded.ctime,
            is_readable = excluded.is_readable,
            scan_error = excluded.scan_error,
            updated_at = now()
    """, [
        rec["path"], rec["name"], rec["ext"], rec["parent_dir"], rec["top_dir"],
        rec["depth"], rec["size"], rec["mtime"], rec["ctime"],
        rec["is_readable"], rec["scan_error"],
    ])


def main() -> int:
    ap = argparse.ArgumentParser(description="Tier 0: NAS walk + 메타데이터 수집")
    ap.add_argument("--dry-run", action="store_true", help="DB 쓰지 않고 카운트만")
    ap.add_argument("--max", type=int, default=None, help="최대 처리 파일 수 (테스트용)")
    ap.add_argument("--root", default=NAS_ROOT, help=f"스캔 루트 (기본 {NAS_ROOT})")
    ap.add_argument("--subdir", default=None, help="root 아래 특정 sub-directory만 스캔 (병렬 워커용)")
    ap.add_argument("--subdirs", nargs="+", default=None, help="여러 sub-directory를 순차 스캔 (한 워커가 여러 폴더 처리)")
    ap.add_argument("--db", default=None, help="대체 DB 경로 (shard용). 미지정 시 메인 DB")
    args = ap.parse_args()

    # 실제 스캔 root(들) 결정
    scan_roots: list[tuple[str, str]] = []  # (full_path, top_dir_label)
    if args.subdirs:
        for sd in args.subdirs:
            scan_roots.append((os.path.join(args.root, sd), sd))
    elif args.subdir:
        scan_roots.append((os.path.join(args.root, args.subdir), args.subdir))
    else:
        scan_roots.append((args.root, ""))

    print(f"[Tier 0] NAS Walk + 메타 수집 시작")
    print(f"  roots       : {len(scan_roots)}개")
    for r, label in scan_roots:
        print(f"    - {label or '(root)'}: {r}")
    print(f"  exclude     : {sorted(EXCLUDE_TOP_DIRS)}")
    print(f"  dry-run     : {args.dry_run}")
    print(f"  max         : {args.max or '제한 없음'}")
    print(f"  db          : {args.db or '(default)'}")
    print()

    # 각 root 접근 가능성 사전 확인
    for r, _ in scan_roots:
        if not os.path.exists(r):
            print(f"❌ NAS 경로 접근 불가: {r}", file=sys.stderr)
            return 1

    con = None if args.dry_run else connect_db(args.db)
    notes_str = ", ".join(label for _, label in scan_roots) or "root"
    notes = f"walk roots={notes_str}"
    run_id = None if args.dry_run else open_run(con, tier="0", notes=notes)

    t0 = time.time()
    seen = 0
    updated = 0
    errors = 0
    total_bytes = 0
    last_progress_t = t0

    try:
        # 여러 root 순차 walk. subdir/subdirs 모드면 top_dir을 입력 label로 override.
        all_done = False
        for scan_root, top_dir_label in scan_roots:
            if all_done:
                break
            for full, top_dir, depth in iter_files(scan_root, args.max - seen if args.max else None):
                # subdir·subdirs 모드: top_dir을 입력 label로 강제
                if top_dir_label:
                    top_dir = top_dir_label
                seen += 1
                rec = stat_to_dict(full, top_dir, depth)
                if not rec["is_readable"]:
                    errors += 1
                    log_error(f"stat 실패 [{full}]: {rec['scan_error']}")
                else:
                    total_bytes += rec["size"] or 0

                if not args.dry_run:
                    try:
                        upsert_file(con, rec)
                        updated += 1
                    except Exception as e:
                        errors += 1
                        log_error(f"DB upsert 실패 [{full}]: {e}")

                # 진행률
                if seen % PROGRESS_INTERVAL == 0:
                    now = time.time()
                    rate = PROGRESS_INTERVAL / max(now - last_progress_t, 0.001)
                    last_progress_t = now
                    elapsed = now - t0
                    print(
                        f"  [{seen:>10,}] elapsed={elapsed/60:>6.1f}min  "
                        f"rate={rate:>6.0f}/s  total={fmt_size(total_bytes)}  "
                        f"errors={errors}",
                        flush=True,
                    )

                # max 도달 시 모든 root 중단
                if args.max and seen >= args.max:
                    all_done = True
                    break
    except KeyboardInterrupt:
        print("\n⚠ 중단됨 (DB 보존). 재실행 시 이어서 갱신됩니다.", file=sys.stderr)
    finally:
        if not args.dry_run and run_id is not None:
            close_run(con, run_id, files_seen=seen, files_updated=updated, errors=errors)
            con.close()

    elapsed = time.time() - t0
    print()
    print(f"✓ Tier 0 완료")
    print(f"  파일 수    : {seen:,}")
    print(f"  업데이트   : {updated:,}")
    print(f"  에러       : {errors}")
    print(f"  총 크기    : {fmt_size(total_bytes)}")
    print(f"  소요 시간  : {elapsed/60:.1f}분 ({elapsed:.0f}초)")
    print(f"  처리 속도  : {seen/max(elapsed,1):.0f} 파일/초")
    return 0


if __name__ == "__main__":
    sys.exit(main())
