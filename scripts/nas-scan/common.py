"""
NAS 스캔 공통 설정·헬퍼

- NAS UNC 경로, 제외 폴더, DB 경로 등 단일 출처
- DuckDB 연결·schema 초기화
- 한글 파일명 처리 (UTF-8 NFC 정규화)
"""
from __future__ import annotations
import os
import sys
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Iterator

# Windows PowerShell 콘솔 CP949 회피 — stdout/stderr 강제 UTF-8
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import duckdb

# ─── 설정 ─────────────────────────────────────────────────
NAS_ROOT = r"\\192.168.0.220\oceantech"

# 제외할 top-level 폴더 (사용자 결정)
EXCLUDE_TOP_DIRS = {
    "50.SoftWare(업무용.프린터.제조사sw)",
    "50.SoftWare",  # 이름 약간 다를 가능성 대비
}

# 제외할 패턴 (확장자·이름 prefix)
EXCLUDE_PATTERNS = [
    r"~$",         # Office 잠금 파일
    r"Thumbs.db",
    r".DS_Store",
    r"desktop.ini",
]

# DB·로그 경로
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "nas-scan.duckdb"
SHARD_DIR = DATA_DIR / "shards"
SHARD_DIR.mkdir(exist_ok=True)
LOG_DIR = DATA_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)

# 진행률 출력 간격
PROGRESS_INTERVAL = 500


# ─── DuckDB ───────────────────────────────────────────────
def connect_db(db_path: str | Path | None = None) -> duckdb.DuckDBPyConnection:
    """DB 연결 + schema 보장. db_path 지정 시 shard DB."""
    target = Path(db_path) if db_path else DB_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(target))
    # sequence 먼저 생성 (table에서 참조)
    con.execute("CREATE SEQUENCE IF NOT EXISTS scan_runs_seq START 1;")
    con.execute("""
        CREATE TABLE IF NOT EXISTS files (
            path VARCHAR PRIMARY KEY,       -- 절대 경로 (NFC 정규화)
            name VARCHAR,                    -- 파일명
            ext VARCHAR,                     -- 확장자 (소문자, 점 없음)
            parent_dir VARCHAR,              -- 부모 폴더
            top_dir VARCHAR,                 -- 최상위 폴더 (00.일반관리 등)
            depth INTEGER,                   -- 경로 깊이
            size BIGINT,                     -- 바이트
            mtime TIMESTAMP,                 -- 수정 시각
            ctime TIMESTAMP,                 -- 생성 시각
            is_readable BOOLEAN DEFAULT TRUE,
            scan_error VARCHAR,

            -- Tier 1 (PDF)
            pdf_pages INTEGER,
            pdf_has_text BOOLEAN,
            pdf_text_chars BIGINT,
            pdf_creator VARCHAR,
            pdf_is_scan_likely BOOLEAN,

            -- Tier 2 (HWP)
            hwp_version VARCHAR,             -- '3.0' / '5.0' / 'hwpx'
            hwp_parseable BOOLEAN,

            -- Tier 3 (중복 탐지)
            hash_head1mb VARCHAR,

            recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at  TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS ix_files_ext        ON files(ext);
        CREATE INDEX IF NOT EXISTS ix_files_top_dir    ON files(top_dir);
        CREATE INDEX IF NOT EXISTS ix_files_size       ON files(size);
        CREATE INDEX IF NOT EXISTS ix_files_mtime      ON files(mtime);
        CREATE INDEX IF NOT EXISTS ix_files_hash       ON files(hash_head1mb);

        CREATE TABLE IF NOT EXISTS scan_runs (
            id INTEGER PRIMARY KEY DEFAULT nextval('scan_runs_seq'),
            tier VARCHAR,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ended_at TIMESTAMP,
            files_seen BIGINT DEFAULT 0,
            files_updated BIGINT DEFAULT 0,
            errors BIGINT DEFAULT 0,
            notes VARCHAR
        );
    """)
    return con


def open_run(con, tier: str, notes: str = "") -> int:
    """스캔 실행 기록 시작."""
    cur = con.execute(
        "INSERT INTO scan_runs(tier, notes) VALUES (?, ?) RETURNING id",
        [tier, notes],
    ).fetchone()
    return cur[0]


def close_run(con, run_id: int, files_seen: int, files_updated: int, errors: int) -> None:
    """스캔 실행 기록 종료."""
    con.execute("""
        UPDATE scan_runs
        SET ended_at = CURRENT_TIMESTAMP,
            files_seen = ?,
            files_updated = ?,
            errors = ?
        WHERE id = ?
    """, [files_seen, files_updated, errors, run_id])


# ─── 헬퍼 ─────────────────────────────────────────────────
def normalize_path(p: str) -> str:
    """한글 NFC 정규화 (Windows는 보통 NFC, macOS NFD와 다름)."""
    return unicodedata.normalize("NFC", p)


def get_top_dir(rel_path: str) -> str:
    """경로의 최상위 폴더 추출."""
    parts = rel_path.replace("\\", "/").split("/")
    return parts[0] if parts and parts[0] else ""


def is_excluded(path: str) -> bool:
    """제외 패턴 검사."""
    name = os.path.basename(path)
    for pat in EXCLUDE_PATTERNS:
        if name.startswith(pat.replace("$", "")) and pat == "~$":
            return True
        if name == pat:
            return True
    return False


def get_ext(name: str) -> str:
    """확장자 추출 (소문자, 점 없음)."""
    _, ext = os.path.splitext(name)
    return ext.lower().lstrip(".") if ext else ""


def fmt_size(size_bytes: int) -> str:
    """바이트를 사람 친화적 단위로."""
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f}{unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f}PB"


def log_error(msg: str) -> None:
    """에러 로그 (stderr + 파일)."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, file=sys.stderr)
    log_file = LOG_DIR / f"scan-errors-{datetime.now().strftime('%Y%m%d')}.log"
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(line + "\n")
