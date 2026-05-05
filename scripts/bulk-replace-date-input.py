#!/usr/bin/env python3
"""
Bulk replace <input type="date" ...> with <DateInput ...> across apps/web/src.
Adds import if missing.

날짜 입력 공통 컴포넌트 도입 (2026-05-04).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "apps" / "web" / "src"
IMPORT_LINE = 'import { DateInput } from "@/components/ui/DateInput";'


def process_file(path: Path) -> int:
    """Returns number of replacements."""
    text = path.read_text(encoding="utf-8")
    original = text

    # Pattern 1: multi-line <input\n  type="date" ...
    # Replace <input followed by whitespace+newline+whitespace+type="date" with <DateInput (keeping subsequent props)
    text = re.sub(
        r'<input(\s*\n\s*)type="date"',
        r'<DateInput\1',
        text,
    )

    # Pattern 2: single-line <input type="date" ...
    text = re.sub(
        r'<input\s+type="date"',
        r'<DateInput',
        text,
    )

    if text == original:
        return 0

    # Add import if missing (insert after last import statement)
    if 'from "@/components/ui/DateInput"' not in text:
        lines = text.split("\n")
        last_import_idx = -1
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith("import ") and (";" in stripped or stripped.endswith('"') or stripped.endswith("'")):
                last_import_idx = i
        if last_import_idx >= 0:
            lines.insert(last_import_idx + 1, IMPORT_LINE)
            text = "\n".join(lines)
        else:
            # Fallback: prepend
            text = IMPORT_LINE + "\n" + text

    path.write_text(text, encoding="utf-8")
    # Count by counting "DateInput" occurrences minus the 1 import
    return text.count("<DateInput") - original.count("<DateInput")


def main() -> None:
    # Find all .tsx/.ts files containing type="date"
    files: list[Path] = []
    for p in SRC.rglob("*.tsx"):
        try:
            if 'type="date"' in p.read_text(encoding="utf-8"):
                files.append(p)
        except UnicodeDecodeError:
            pass
    for p in SRC.rglob("*.ts"):
        try:
            if 'type="date"' in p.read_text(encoding="utf-8"):
                files.append(p)
        except UnicodeDecodeError:
            pass

    # Skip the DateInput component itself
    files = [f for f in files if f.name != "DateInput.tsx"]

    total = 0
    print(f"Found {len(files)} files with date inputs")
    for f in files:
        count = process_file(f)
        if count > 0:
            rel = f.relative_to(ROOT)
            print(f"  [{count}] {rel}")
            total += count
    print(f"\nTotal replacements: {total}")


if __name__ == "__main__":
    main()
