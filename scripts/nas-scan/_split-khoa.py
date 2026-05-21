"""
KHOA 측정 결과를 읽어 40개 폴더를 용량 균형 3그룹으로 분할.

입력: 측정 결과 출력 파일 (run-everything-v3.ps1 에서 전달)
출력: workers-batch2.json (3 워커 정의)

사용:
    python _split-khoa.py <measurement_output_file>
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_JSON = SCRIPT_DIR / "workers-batch2.json"

KHOA_PREFIX = "10. Project\\PROJECT\\1. 국립해양조사원(KHOA)"


def _read_with_encoding_fallback(path: str) -> str:
    """PowerShell 콘솔 출력 인코딩 자동 감지 (cp949 → utf-8 → utf-16)."""
    for enc in ("cp949", "utf-8-sig", "utf-8", "utf-16"):
        try:
            with open(path, "r", encoding=enc) as f:
                return f.read()
        except (UnicodeDecodeError, UnicodeError):
            continue
    # 최후의 수단
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def parse_measurement(path: str) -> list[tuple[str, float, int]]:
    """PowerShell 측정 결과 파싱.
    출력 예:
        Name                SizeGB    Files
        ----                ------    -----
        00. KHOA_해양관측부이    1234.56  100000
    """
    rows: list[tuple[str, float, int]] = []
    content = _read_with_encoding_fallback(path)
    for line in content.splitlines():
        line = line.rstrip()
        if not line or line.startswith("=") or line.startswith("-") or line.startswith("Name"):
            continue
        # 우측에서 숫자 2개 추출, 나머지가 Name
        m = re.match(r"^(.*?)\s+([\d.]+)\s+(\d+)\s*$", line)
        if not m:
            continue
        name, gb, cnt = m.group(1).strip(), float(m.group(2)), int(m.group(3))
        rows.append((name, gb, cnt))
    return rows


def split_balanced(rows: list[tuple[str, float, int]], n_groups: int) -> list[list[tuple]]:
    """파일 수 기준 균형 그룹 분할 (greedy: 큰 것부터 작은 그룹에 배정)."""
    # 파일 수 desc
    rows = sorted(rows, key=lambda r: -r[2])
    groups: list[list[tuple]] = [[] for _ in range(n_groups)]
    group_files = [0] * n_groups

    for row in rows:
        # 현재 파일 수 최소 그룹에 배정
        idx = group_files.index(min(group_files))
        groups[idx].append(row)
        group_files[idx] += row[2]

    return groups


def main():
    if len(sys.argv) < 2:
        print("usage: _split-khoa.py <measurement_output_file>", file=sys.stderr)
        sys.exit(2)

    measurement_path = sys.argv[1]
    if not Path(measurement_path).exists():
        print(f"파일 없음: {measurement_path}", file=sys.stderr)
        sys.exit(3)

    rows = parse_measurement(measurement_path)
    if len(rows) < 3:
        print(f"파싱된 폴더가 너무 적음 ({len(rows)})", file=sys.stderr)
        sys.exit(4)

    groups = split_balanced(rows, 3)

    # JSON 생성
    workers = []
    for i, group in enumerate(groups):
        names = [r[0] for r in group]
        total_gb = sum(r[1] for r in group)
        total_files = sum(r[2] for r in group)
        worker = {
            "id": f"10-khoa-{chr(ord('a') + i)}",
            "label": f"KHOA-{chr(ord('A') + i)} ({len(names)}개, {total_gb:.0f}GB, {total_files:,}건)",
            "subdirs": [f"{KHOA_PREFIX}\\{n}" for n in names],
        }
        workers.append(worker)

    OUTPUT_JSON.write_text(json.dumps(workers, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ {OUTPUT_JSON} 생성됨")
    for w in workers:
        print(f"  {w['id']}: {w['label']}")


if __name__ == "__main__":
    main()
