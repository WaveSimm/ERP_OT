"""
Phase D: 자산 카탈로그 + RAG 인덱싱 청사진 리포트

목적: 정보 축적 우선 원칙 ([[project_nas_scan_purpose_information_first]])
  - Tier 0~3 데이터를 "회사 디지털 자산 카탈로그 + RAG 진입 청사진"으로 정리
  - 중복은 분류 맥락으로 활용 (정리·삭제 대상 X)
  - RAG 인덱싱 큐 자동 분류 (Q1 text PDF / Q2 HWP / Q3 일반 문서 / Q4 OCR 큐 / Q5 수동 / X skip)

산출물:
  - docs/04-operation/nas-스캔-카탈로그-YYYYMMDD.md (사람용)
  - data/catalog/* (CSV·시각화)
  - data/rag-queue/*.csv (RAG 인덱싱 큐별 파일 목록)
"""
from __future__ import annotations
import sys
from datetime import datetime
from pathlib import Path

from common import connect_db, fmt_size, DATA_DIR

CHART_DIR = DATA_DIR / "charts"
CATALOG_DIR = DATA_DIR / "catalog"
RAG_QUEUE_DIR = DATA_DIR / "rag-queue"
for d in (CHART_DIR, CATALOG_DIR, RAG_QUEUE_DIR):
    d.mkdir(exist_ok=True)

REPORT_PATH = Path(__file__).resolve().parent.parent.parent / "docs" / "04-operation" / f"nas-스캔-카탈로그-{datetime.now().strftime('%Y%m%d')}.md"


def q(con, sql, params=None):
    return con.execute(sql, params or []).fetchall()


def export_csv(con, sql, output_path):
    """SQL 결과를 CSV로 export."""
    con.execute(f"COPY ({sql}) TO '{output_path}' (HEADER, DELIMITER ',')")


def make_charts(con):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        plt.rcParams["font.family"] = "Malgun Gothic"
        plt.rcParams["axes.unicode_minus"] = False
    except Exception as e:
        print(f"⚠ matplotlib 사용 불가: {e}")
        return []

    charts = []

    # 1. 확장자별 자료량
    rows = q(con, """
        SELECT ext, COUNT(*) AS cnt, SUM(size)/1e9 AS gb
        FROM files WHERE is_readable
        GROUP BY ext ORDER BY gb DESC LIMIT 20
    """)
    if rows:
        fig, ax = plt.subplots(figsize=(11, 6))
        exts = [r[0] or "(없음)" for r in rows]
        gbs = [r[2] for r in rows]
        ax.barh(exts[::-1], gbs[::-1])
        ax.set_xlabel("용량 (GB)")
        ax.set_title("확장자별 자료 분포 — 자산 인벤토리")
        for i, v in enumerate(gbs[::-1]):
            ax.text(v, i, f" {v:.1f}", va="center")
        p = CHART_DIR / "01-asset-by-ext.png"
        plt.tight_layout(); plt.savefig(p, dpi=100); plt.close()
        charts.append(p)

    # 2. 부서·고객사별 자료
    rows = q(con, """
        SELECT top_dir, COUNT(*) AS cnt, SUM(size)/1e9 AS gb
        FROM files WHERE is_readable AND top_dir <> ''
        GROUP BY top_dir ORDER BY gb DESC LIMIT 15
    """)
    if rows:
        fig, ax = plt.subplots(figsize=(11, 5))
        dirs = [r[0] for r in rows]
        gbs = [r[2] for r in rows]
        ax.barh(dirs[::-1], gbs[::-1])
        ax.set_xlabel("용량 (GB)")
        ax.set_title("부서·기관별 자료 보유량")
        for i, v in enumerate(gbs[::-1]):
            ax.text(v, i, f" {v:.1f}", va="center")
        p = CHART_DIR / "02-asset-by-toplevel.png"
        plt.tight_layout(); plt.savefig(p, dpi=100); plt.close()
        charts.append(p)

    # 3. 연도별 자료 누적 (회사 활동 패턴)
    rows = q(con, """
        SELECT date_trunc('year', mtime) AS yr, COUNT(*) AS cnt, SUM(size)/1e9 AS gb
        FROM files WHERE is_readable AND mtime IS NOT NULL
        GROUP BY yr ORDER BY yr
    """)
    if rows:
        fig, axes = plt.subplots(2, 1, figsize=(12, 7), sharex=True)
        years = [r[0].year if r[0] else 0 for r in rows]
        cnts = [r[1] for r in rows]
        gbs = [r[2] for r in rows]
        axes[0].bar(years, cnts); axes[0].set_ylabel("파일 수"); axes[0].set_title("연도별 자료 누적 — 회사 활동 패턴")
        axes[1].bar(years, gbs);  axes[1].set_ylabel("용량 (GB)"); axes[1].set_xlabel("연도")
        p = CHART_DIR / "03-activity-by-year.png"
        plt.tight_layout(); plt.savefig(p, dpi=100); plt.close()
        charts.append(p)

    return charts


def classify_rag_queue(con):
    """RAG 인덱싱 큐 자동 분류 view 생성."""
    con.execute("""
        CREATE OR REPLACE VIEW rag_queue AS
        SELECT
            path, name, ext, parent_dir, top_dir, size, mtime,
            pdf_pages, pdf_has_text, pdf_is_scan_likely,
            hwp_version, hwp_parseable,
            hash_head1mb,
            CASE
                -- Q1: 텍스트 PDF (즉시 임베딩)
                WHEN ext = 'pdf' AND pdf_has_text = TRUE THEN 'Q1_text_pdf'
                -- Q2: 파싱 가능 HWP
                WHEN ext IN ('hwp','hwpx') AND hwp_parseable = TRUE THEN 'Q2_hwp_auto'
                -- Q3: 일반 문서 (즉시 처리) — 레거시 Office + 웹 문서 포함
                WHEN ext IN (
                    'docx','doc','xlsx','xls','pptx','ppt',
                    'txt','md','csv','rtf','tsv',
                    'html','htm','xml','json'
                ) THEN 'Q3_general_doc'
                -- Q4: OCR 필요 PDF
                WHEN ext = 'pdf' AND pdf_is_scan_likely = TRUE THEN 'Q4_ocr_pdf'
                -- Q5: 수동 검토 HWP (3.0 또는 파싱 어려운 hwpx)
                WHEN ext IN ('hwp','hwpx') AND (hwp_parseable = FALSE OR hwp_version = '3.0') THEN 'Q5_hwp_manual'
                -- Q6: 이미지 (OCR 검토 가능)
                WHEN ext IN ('jpg','jpeg','png','tiff','tif','bmp','gif','webp') THEN 'Q6_image_ocr_optional'
                -- X1: 영상 (인덱싱 대상 아님, 메타만)
                WHEN ext IN ('mp4','m4v','mov','avi','mkv','wmv','flv','mpg','mpeg') THEN 'X1_video'
                -- X2: 백업·VM 이미지 (자료 X)
                WHEN ext IN ('tib','vhdx','vmdk','iso','ova','dmg') THEN 'X2_backup_image'
                -- X3: 압축 (풀어야 확인, 일단 skip)
                WHEN ext IN ('zip','rar','7z','tar','gz','bz2','egg') THEN 'X3_archive'
                -- X4: 계측·관측 raw — 회사 고유 DataFlow + HF radar + 음향측심 등
                WHEN ext IN (
                    'dat','sdf','raw','bin','sgy','xtf',
                    'df047','df038','df037','df025',
                    'ruv','tuv',
                    'mat','hdf','h5','nc',
                    'kan','sil','sdl',
                    'wvp','wvs','wvr',
                    'oculus','pds','jsf','wcd'
                ) THEN 'X4_measurement_raw'
                -- X5: 실행 파일·코드
                WHEN ext IN ('exe','dll','msi','sys','bat','sh','cmd','jar') THEN 'X5_executable'
                -- X6: 시스템·임시 (skip + 정리 후보)
                WHEN name LIKE '~$%' OR ext IN ('tmp','bak','now','opt','wpa','blc') OR name IN ('Thumbs.db','.DS_Store','desktop.ini') THEN 'X6_temp_system'
                -- X7: 로그 (신규)
                WHEN ext = 'log' THEN 'X7_log'
                -- X8: 음성 (신규)
                WHEN ext IN ('wav','mp3','m4a','flac','ogg','aac','wma') THEN 'X8_audio'
                -- X9: CAD·도면 (신규)
                WHEN ext IN ('dwg','dxf','dwf','step','stp','iges','igs','prt','sldprt','sldasm','3dm') THEN 'X9_cad'
                -- X10: 확장자 없는 큰 파일 (휴리스틱) — CCTV chunk, 음향측심 raw 등
                WHEN (ext IS NULL OR ext = '') AND size >= 50000000 THEN 'X10_noext_large'
                -- Q7: 기타 (검토 필요)
                ELSE 'Q7_unknown'
            END AS rag_queue
        FROM files
        WHERE is_readable
    """)


def build_report(con) -> str:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = []
    P = lines.append

    P(f"# NAS 자산 카탈로그 + RAG 인덱싱 청사진")
    P("")
    P(f"> **생성일**: {now}")
    P(f"> **목적**: 회사 디지털 정보 자산의 카탈로그 + RAG 진입 청사진")
    P(f"> **원칙**: 정보 축적 우선, 중복은 분류 맥락으로 보존")
    P(f"> **DB**: `scripts/nas-scan/data/nas-scan.duckdb`")
    P(f"> **소스**: `\\\\192.168.0.220\\oceantech` (45.4TB 사용 중)")
    P("")
    P("---")
    P("")

    # ─── 1. 자산 전체 ────────────────────────────────────
    row = q(con, "SELECT COUNT(*), SUM(size), SUM(size)/1e9 FROM files WHERE is_readable")[0]
    total_cnt, total_bytes, total_gb = row
    P("## 1. 회사 정보 자산 전체")
    P("")
    P(f"| 항목 | 값 |")
    P(f"|---|---:|")
    P(f"| 총 파일 수 | **{total_cnt:,}** |")
    P(f"| 총 용량 | **{fmt_size(total_bytes or 0)}** ({total_gb:.1f} GB) |")
    err = q(con, "SELECT COUNT(*) FROM files WHERE NOT is_readable")[0][0]
    P(f"| 접근 불가 | {err:,} (권한·잠금) |")
    P("")

    # ─── 2. RAG 인덱싱 큐 자동 분류 ───────────────────────
    P("## 2. RAG 인덱싱 큐 자동 분류 ★")
    P("")
    P("각 자료를 RAG 처리 경로별로 자동 분류한 결과입니다.")
    P("")
    rows = q(con, """
        SELECT rag_queue, COUNT(*) AS cnt, SUM(size)/1e9 AS gb
        FROM rag_queue
        GROUP BY rag_queue ORDER BY cnt DESC
    """)
    queue_labels = {
        "Q1_text_pdf":      "Q1 — 텍스트 PDF (즉시 임베딩)",
        "Q2_hwp_auto":      "Q2 — HWP 자동 파싱 (즉시 임베딩)",
        "Q3_general_doc":   "Q3 — 일반 문서 docx/doc/xlsx/xls/pptx/ppt/txt/md/csv/html/xml (즉시)",
        "Q4_ocr_pdf":       "Q4 — 스캔 PDF (OCR 큐)",
        "Q5_hwp_manual":    "Q5 — HWP 수동 검토 (3.0 등)",
        "Q6_image_ocr_optional": "Q6 — 이미지 (OCR 선택)",
        "Q7_unknown":       "Q7 — 미분류 (검토 필요)",
        "X1_video":         "X1 — 영상 (인덱싱 X, 메타만)",
        "X2_backup_image":  "X2 — 백업·VM 이미지",
        "X3_archive":       "X3 — 압축 (풀어야 확인)",
        "X4_measurement_raw": "X4 — 계측·관측 raw (df*/ruv/tuv/mat/hdf/sgy 등)",
        "X5_executable":    "X5 — 실행 파일·코드",
        "X6_temp_system":   "X6 — 임시·시스템 (정리 안전)",
        "X7_log":           "X7 — 로그 (신규)",
        "X8_audio":         "X8 — 음성 (신규)",
        "X9_cad":           "X9 — CAD·도면 (신규)",
        "X10_noext_large":  "X10 — 확장자 없는 큰 파일 (CCTV chunk/음향측심 raw 등)",
    }
    P("| 큐 | 의미 | 파일 수 | 용량 |")
    P("|---|---|---:|---:|")
    for q_name, cnt, gb in rows:
        label = queue_labels.get(q_name, q_name)
        P(f"| `{q_name}` | {label} | {cnt:,} | {gb:.2f} GB |")
    P("")
    P("**즉시 인덱싱 가능 (Q1+Q2+Q3)**: " + str(sum(r[1] for r in rows if r[0] in ("Q1_text_pdf","Q2_hwp_auto","Q3_general_doc"))) + " 파일")
    P("")

    # ─── 3. 자료 분포 — 부서·기관 ─────────────────────────
    P("## 3. 부서·기관별 자산 분포")
    P("")
    P("| 영역 | 파일 수 | 용량 | 최근 활동 |")
    P("|---|---:|---:|---|")
    rows = q(con, """
        SELECT top_dir, COUNT(*) AS cnt, SUM(size)/1e9 AS gb, MAX(mtime) AS recent
        FROM files WHERE is_readable AND top_dir <> ''
        GROUP BY top_dir ORDER BY gb DESC
    """)
    for d, cnt, gb, recent in rows:
        P(f"| {d} | {cnt:,} | {gb:.2f} GB | {recent.strftime('%Y-%m-%d') if recent else '-'} |")
    P("")

    # ─── 4. 확장자별 (RAG 대상 식별) ──────────────────────
    P("## 4. 확장자별 자산 분포 (Top 25)")
    P("")
    P("| 확장자 | 파일 수 | 용량 | RAG 활용 |")
    P("|---|---:|---:|---|")
    ext_rag = {
        "pdf": "✅ Q1(텍스트) or Q4(스캔)", "hwp": "✅ Q2 or Q5", "hwpx": "✅ Q2",
        "docx": "✅ Q3", "doc": "✅ Q3",
        "xlsx": "✅ Q3", "xls": "✅ Q3",
        "pptx": "✅ Q3", "ppt": "✅ Q3",
        "txt": "✅ Q3", "md": "✅ Q3", "csv": "✅ Q3", "rtf": "✅ Q3",
        "html": "✅ Q3", "htm": "✅ Q3", "xml": "✅ Q3", "json": "✅ Q3",
        "jpg": "🔍 Q6 (OCR 선택)", "jpeg": "🔍 Q6", "png": "🔍 Q6", "gif": "🔍 Q6", "bmp": "🔍 Q6", "tiff": "🔍 Q6",
        "mp4": "❌ X1 (메타만)", "m4v": "❌ X1", "mov": "❌ X1", "avi": "❌ X1",
        "zip": "📦 X3 (풀기 검토)", "rar": "📦 X3", "egg": "📦 X3",
        "tib": "❌ X2 (PC 백업)", "vhdx": "❌ X2", "vmdk": "❌ X2",
        "dat": "📊 X4 (계측)", "sdf": "📊 X4", "raw": "📊 X4",
        "df047": "📊 X4 (DataFlow)", "df038": "📊 X4", "df037": "📊 X4", "df025": "📊 X4",
        "ruv": "📊 X4 (HF radar)", "tuv": "📊 X4 (HF radar)",
        "mat": "📊 X4 (Matlab)", "hdf": "📊 X4", "sgy": "📊 X4 (음향)",
        "log": "📝 X7 (로그)", "wav": "🔊 X8 (음성)", "dwg": "📐 X9 (CAD)",
        "tmp": "🧹 X6 (정리)", "bak": "🧹 X6",
    }
    rows = q(con, """
        SELECT COALESCE(NULLIF(ext,''),'(없음)') AS ext, COUNT(*) AS cnt, SUM(size) AS bytes
        FROM files WHERE is_readable
        GROUP BY ext ORDER BY bytes DESC LIMIT 25
    """)
    for ext, cnt, b in rows:
        rag = ext_rag.get(ext, "—")
        P(f"| `{ext}` | {cnt:,} | {fmt_size(b or 0)} | {rag} |")
    P("")

    # ─── 5. 시기 분포 — 회사 활동 패턴 ────────────────────
    P("## 5. 자료 시기 분포 (회사 활동 패턴)")
    P("")
    P("⚠ 시기는 mtime 기준. 폴더·파일명에서 추출한 자료 본연의 연도와 다를 수 있음.")
    P("")
    P("| 기간 | 파일 수 | 용량 | 의미 |")
    P("|---|---:|---:|---|")
    cutoffs = [
        ("최근 1년", "mtime >= now() - INTERVAL 1 YEAR", "Hot — RAG 우선 인덱싱"),
        ("1~2년",   "mtime >= now() - INTERVAL 2 YEAR AND mtime < now() - INTERVAL 1 YEAR", "Warm"),
        ("2~5년",   "mtime >= now() - INTERVAL 5 YEAR AND mtime < now() - INTERVAL 2 YEAR", "Active archive"),
        ("5~10년",  "mtime >= now() - INTERVAL 10 YEAR AND mtime < now() - INTERVAL 5 YEAR", "Cold archive"),
        ("10년 이상", "mtime < now() - INTERVAL 10 YEAR", "보존 자산"),
    ]
    for label, where, meaning in cutoffs:
        cnt_gb = q(con, f"SELECT COUNT(*), SUM(size)/1e9 FROM files WHERE is_readable AND mtime IS NOT NULL AND {where}")[0]
        P(f"| {label} | {cnt_gb[0]:,} | {(cnt_gb[1] or 0):.2f} GB | {meaning} |")
    P("")

    # ─── 6. 분류 맥락 분석 (Tier 3) — 반복 업무 패턴 ─────
    if q(con, "SELECT COUNT(*) FROM files WHERE hash_head1mb IS NOT NULL")[0][0] > 0:
        P("## 6. 자료 분류 맥락 분포 ★ (Tier 3 hash 기반 — 반복 업무 패턴)")
        P("")
        P("같은 hash 그룹은 동일 자료가 여러 폴더에서 **반복 참조**되는 흔적입니다.")
        P("이는 자료의 **핵심성**이 아니라 **회사가 반복 수행하는 업무의 발자국**입니다.")
        P("직원들이 같은 업무를 할 때마다 동일 자료를 첨부·참조한 결과로,")
        P("ERP/Knowledge Platform 업무 자동화 후보 발견에 활용됩니다 (§7 참조).")
        P("")
        P("⚠ **진짜 회사 핵심 산출물은 \"유일 자료\" 영역(단일 위치)에 묻혀 있을**")
        P("가능성이 큽니다 — KHOA 부이 raw 데이터, 연구 최종 보고서 등은 한 곳에만")
        P("보관됩니다. 핵심 산출물 발굴은 별도 다차원 점수 분석이 필요합니다 (향후 작업).")
        P("")
        # 분류 맥락 분포
        rows = q(con, """
            WITH g AS (
                SELECT hash_head1mb, size, COUNT(*) AS contexts
                FROM files
                WHERE hash_head1mb IS NOT NULL AND is_readable
                GROUP BY hash_head1mb, size
            )
            SELECT
                CASE
                    WHEN contexts = 1 THEN '단일 위치'
                    WHEN contexts = 2 THEN '2개 맥락'
                    WHEN contexts = 3 THEN '3개 맥락'
                    WHEN contexts BETWEEN 4 AND 5 THEN '4~5개 맥락 (활용도 ↑)'
                    WHEN contexts BETWEEN 6 AND 10 THEN '6~10개 맥락 (핵심 자료)'
                    ELSE '10개+ 맥락 (회사 표준 자료)'
                END AS context_band,
                COUNT(*) AS asset_count,
                SUM(contexts) AS total_locations
            FROM g
            GROUP BY context_band
            ORDER BY MIN(contexts)
        """)
        P("| 분류 맥락 수 | 자료 수 (unique) | 총 위치 수 | 의미 |")
        P("|---|---:|---:|---|")
        meanings = {
            "단일 위치": "유일 자료 (진짜 산출물·raw 데이터 후보)",
            "2개 맥락": "두 곳 활용",
            "3개 맥락": "다맥락 참조",
            "4~5개 맥락 (활용도 ↑)": "반복 업무 자료",
            "6~10개 맥락 (핵심 자료)": "회사 표준 첨부물",
            "10개+ 맥락 (회사 표준 자료)": "회사 반복 업무 양식 (행정·인허가)",
        }
        for band, cnt, locs in rows:
            P(f"| {band} | {cnt:,} | {locs:,} | {meanings.get(band, '')} |")
        P("")

    else:
        P("## 6. 자료 분류 맥락 분포 (Tier 3 미완료)")
        P("")
        P("Tier 3 (hash) 완료 후 이 섹션에 분류 맥락 그래프가 채워집니다.")
        P("")

    # ─── 7. 반복 업무 자동화 후보 (신규) ──────────────────
    if q(con, "SELECT COUNT(*) FROM files WHERE hash_head1mb IS NOT NULL")[0][0] > 0:
        P("## 7. 반복 업무 자동화 후보 ★ (반복 첨부 자료 발견)")
        P("")
        P("§6의 다맥락 자료는 회사 반복 업무의 발자국입니다. 같은 자료가 여러 폴더에서")
        P("반복 등장한다는 것은 직원들이 그 업무를 반복하면서 매번 첨부·참조하고 있음을")
        P("의미합니다. → **ERP/Knowledge Platform 자동 첨부 후보**.")
        P("")

        # Top 30 반복 첨부 자료 (부서 수 포함)
        top_repeat = q(con, """
            WITH grp AS (
                SELECT hash_head1mb,
                       COUNT(*) AS ctxs,
                       MAX(size) AS size,
                       MIN(name) AS sample_name,
                       MIN(COALESCE(NULLIF(ext,''), '(없음)')) AS ext,
                       COUNT(DISTINCT top_dir) AS dept_count
                FROM files
                WHERE hash_head1mb IS NOT NULL AND is_readable
                GROUP BY hash_head1mb
                HAVING COUNT(*) >= 6
            )
            SELECT ctxs, sample_name, ext, ROUND(size/1e6, 2) AS mb, dept_count
            FROM grp ORDER BY ctxs DESC LIMIT 30
        """)
        if top_repeat:
            P("### Top 30 반복 첨부 자료 (6회 이상 등장)")
            P("")
            P("| 등장 | 파일명 | 형식 | 크기(MB) | 부서·기관 수 |")
            P("|---:|---|---|---:|---:|")
            for ctxs, name, ext, mb, dept_cnt in top_repeat:
                # 파일명 길면 잘라서 표시
                disp_name = name[:55] + ('…' if len(name) > 55 else '')
                P(f"| {ctxs} | `{disp_name}` | {ext} | {mb:.2f} | {dept_cnt} |")
            P("")

        # 형식별 반복 업무 자료 분포 (4개+ 맥락)
        ext_dist = q(con, """
            WITH multi AS (
                SELECT hash_head1mb,
                       MIN(COALESCE(NULLIF(ext,''), '(없음)')) AS ext,
                       MAX(size) AS size,
                       COUNT(*) AS ctxs
                FROM files
                WHERE hash_head1mb IS NOT NULL AND is_readable
                GROUP BY hash_head1mb
                HAVING COUNT(*) >= 4
            )
            SELECT ext, COUNT(*) AS cnt, ROUND(SUM(size)/1e9, 2) AS gb
            FROM multi
            GROUP BY ext
            ORDER BY cnt DESC LIMIT 15
        """)
        if ext_dist:
            P("### 반복 업무 자료 — 형식별 분포 (4회 이상 맥락)")
            P("")
            P("| 확장자 | 자료 수 (unique) | 총 용량(GB) | 자동화 가치 |")
            P("|---|---:|---:|---|")
            auto_value = {
                'pdf':  '⭐⭐⭐ 행정 서류 자동 첨부 (선적증서·검사증서 등)',
                'hwp':  '⭐⭐⭐ 양식 자동 첨부 (계약·보고서 양식)',
                'hwpx': '⭐⭐⭐ 양식 자동 첨부',
                'docx': '⭐⭐⭐ 양식 자동 첨부',
                'doc':  '⭐⭐ 레거시 양식',
                'xlsx': '⭐⭐ 표준 양식 (계산서·집계표)',
                'xls':  '⭐⭐ 레거시 양식',
                'pptx': '⭐⭐ 발표 양식·교육 자료',
                'bmp':  '⭐⭐ 표준 사진 라이브러리',
                'jpg':  '⭐⭐ 표준 사진 라이브러리',
                'png':  '⭐⭐ 표준 도면·아이콘',
                'tif':  '⭐⭐ 표준 스캔본',
                'mp4':  '⭐⭐ 표준 영상 라이브러리 (교육·홍보)',
                'wav':  '⭐ 장비 부속 음성',
                'dwg':  '⭐⭐ 표준 도면',
            }
            for ext, cnt, gb in ext_dist:
                val = auto_value.get(ext, '—')
                P(f"| `{ext}` | {cnt:,} | {gb:.2f} | {val} |")
            P("")

        P("### 시사점")
        P("")
        P("- **ERP 자동 첨부 라이브러리**: 발주·계약·납품 시 선박 서류·증서를 자동 첨부 →")
        P("  직원 반복 검색·첨부 시간 절감 + 누락 방지")
        P("- **표준 서류 중앙 보관**: 회사 표준 양식·증서를 한 곳에서 관리 + 버전 통제")
        P("- **업무 흐름 역추적**: 자료별 등장 부서·프로젝트 분포로 어떤 업무가 어떤 자료를")
        P("  요구하는지 발견 → 업무 자동화 우선순위 결정 근거")
        P("- **신입 온보딩 가이드**: \"이 업무에는 이 자료가 반복 필요\" 자동 안내")
        P("- **신규 자료 표준화**: 새 자료가 다맥락에 등장하기 시작하면 표준화 후보 자동 식별")
        P("")

    # ─── 8. RAG 인덱싱 시간·비용 추정 ─────────────────────
    P("## 8. RAG 인덱싱 시간·비용 추정")
    P("")
    rag_target = q(con, """
        SELECT
          SUM(CASE WHEN rag_queue = 'Q1_text_pdf' THEN 1 ELSE 0 END) AS q1,
          SUM(CASE WHEN rag_queue = 'Q2_hwp_auto' THEN 1 ELSE 0 END) AS q2,
          SUM(CASE WHEN rag_queue = 'Q3_general_doc' THEN 1 ELSE 0 END) AS q3,
          SUM(CASE WHEN rag_queue = 'Q4_ocr_pdf' THEN 1 ELSE 0 END) AS q4,
          SUM(CASE WHEN rag_queue = 'Q1_text_pdf' THEN pdf_pages ELSE 0 END) AS q1_pages,
          SUM(CASE WHEN rag_queue = 'Q4_ocr_pdf' THEN pdf_pages ELSE 0 END) AS q4_pages
        FROM rag_queue
    """)[0]
    q1, q2, q3, q4, q1_pages, q4_pages = rag_target
    q1_pages = q1_pages or 0
    q4_pages = q4_pages or 0

    P("### 즉시 인덱싱 가능 (Q1+Q2+Q3)")
    P("")
    P(f"- 파일 수: **{(q1 or 0) + (q2 or 0) + (q3 or 0):,}**")
    P(f"  - Q1 텍스트 PDF: {q1 or 0:,} ({q1_pages:,} 페이지)")
    P(f"  - Q2 HWP 자동: {q2 or 0:,}")
    P(f"  - Q3 일반 문서: {q3 or 0:,}")
    P("")
    P(f"- 추정 청크 수 (페이지당 3청크, 문서당 8청크): ~{q1_pages * 3 + (q2 + q3) * 8:,} 청크")
    P(f"- 임베딩 시간 (bge-m3, GPU 1대, 500 청크/초): ~{(q1_pages * 3 + (q2 + q3) * 8) / 1800:.1f}시간")
    P("")

    P("### OCR 필요 (Q4)")
    P("")
    P(f"- 스캔 PDF: {q4 or 0:,} 파일, {q4_pages:,} 페이지")
    P(f"- PaddleOCR 소요 (GPU 1대, 2페이지/초): ~{q4_pages / 7200:.1f}시간")
    P("- ⚠ 비용 0 운영 정책 ([[project_nas_rag_ocr_policy]]) — PaddleOCR + 텍스트레이어 fallback")
    P("")

    # ─── 9. 정리 가능 안전 영역 (좁음) ────────────────────
    P("## 9. 정리 가능 안전 영역 (좁음, 분류 의도 X)")
    P("")
    P("⚠ 정보 축적 원칙에 따라 의도된 중복·옛 자료는 보존합니다.")
    P("아래는 분류 의도가 없는 시스템·임시 파일만 표시합니다.")
    P("")
    safe_cleanup = q(con, """
        SELECT
          SUM(CASE WHEN name LIKE '~$%' THEN 1 ELSE 0 END) AS office_lock,
          SUM(CASE WHEN size = 0 THEN 1 ELSE 0 END) AS zero_byte,
          SUM(CASE WHEN ext = 'tmp' THEN 1 ELSE 0 END) AS tmp,
          SUM(CASE WHEN name IN ('Thumbs.db','desktop.ini','.DS_Store') THEN 1 ELSE 0 END) AS sys_files,
          SUM(CASE WHEN name LIKE '~$%' THEN size ELSE 0 END) +
          SUM(CASE WHEN ext = 'tmp' THEN size ELSE 0 END) AS recover_bytes
        FROM files WHERE is_readable
    """)[0]
    P(f"- Office 잠금 파일 (`~$*`): {safe_cleanup[0] or 0:,}")
    P(f"- 0KB 파일: {safe_cleanup[1] or 0:,}")
    P(f"- .tmp 임시: {safe_cleanup[2] or 0:,}")
    P(f"- 시스템 파일 (Thumbs.db, desktop.ini, .DS_Store): {safe_cleanup[3] or 0:,}")
    P(f"- 회수 가능 (안전): ~{fmt_size(safe_cleanup[4] or 0)}")
    P("")
    P("**그 외 영역은 정보 축적 원칙에 따라 보존합니다.** 중복은 분류 맥락으로 활용됩니다.")
    P("")

    # ─── 10. 다음 단계 ───────────────────────────────────
    P("## 10. 다음 단계 — NAS RAG 진입 로드맵")
    P("")
    P("1. **RAG 인덱싱 큐 CSV 검토** (별도 산출물)")
    P("   - `data/rag-queue/q1_text_pdf.csv` — 즉시 임베딩 대상")
    P("   - `data/rag-queue/q2_hwp_auto.csv`")
    P("   - `data/rag-queue/q3_general_doc.csv`")
    P("   - `data/rag-queue/q4_ocr_pdf.csv` — OCR 큐")
    P("")
    P("2. **Hot tier 정의** (사용자 결정)")
    P("   - 최근 N년 + 어느 부서 우선?")
    P("   - 폴더 화이트리스트 추가?")
    P("")
    P("3. **NAS RAG PoC 시작** (메모리 정책)")
    P("   - pgvector 별도 인스턴스 ([[project_nas_rag_vector_db]])")
    P("   - OCR 비용 0 운영 ([[project_nas_rag_ocr_policy]])")
    P("   - 1주 시범 → 사용자 평가")
    P("")
    P("4. **분류 맥락 메타 활용**")
    P("   - 같은 hash 그룹의 다중 위치 → 풍부한 메타데이터")
    P("   - RAG 검색 결과 dedup + 위치 통합")
    P("")

    P("---")
    P("")
    P("## 부록: 산출물")
    P("")
    P("- 시각화 차트:")
    P("  - `scripts/nas-scan/data/charts/01-asset-by-ext.png`")
    P("  - `scripts/nas-scan/data/charts/02-asset-by-toplevel.png`")
    P("  - `scripts/nas-scan/data/charts/03-activity-by-year.png`")
    P("- RAG 인덱싱 큐 CSV:")
    P("  - `scripts/nas-scan/data/rag-queue/q1_text_pdf.csv`")
    P("  - `scripts/nas-scan/data/rag-queue/q2_hwp_auto.csv`")
    P("  - `scripts/nas-scan/data/rag-queue/q3_general_doc.csv`")
    P("  - `scripts/nas-scan/data/rag-queue/q4_ocr_pdf.csv`")
    P("- DB: `scripts/nas-scan/data/nas-scan.duckdb` (전체 메타 + Tier 0~3 결과)")
    P("")
    P("## 관련 메모리")
    P("")
    P("- `project_rag_strategy` — RAG 별도 시스템, NAS 주 대상")
    P("- `project_nas_scan_purpose_information_first` — 정보 축적 우선, 중복 보존")
    P("- `project_nas_rag_ocr_policy` — OCR 비용 0 + 태깅")
    P("- `project_nas_rag_vector_db` — pgvector 별도 인스턴스")
    P("- `project_nas_scan_first` — 디스크 스캔 분석 선행")

    return "\n".join(lines)


def export_rag_queues(con):
    """RAG 인덱싱 큐별 CSV 산출."""
    queues = [
        "Q1_text_pdf", "Q2_hwp_auto", "Q3_general_doc", "Q4_ocr_pdf",
        "Q5_hwp_manual", "Q6_image_ocr_optional", "Q7_unknown",
        "X7_log", "X8_audio", "X9_cad", "X10_noext_large",
    ]
    for q_name in queues:
        out = RAG_QUEUE_DIR / f"{q_name.lower()}.csv"
        try:
            con.execute(f"""
                COPY (
                  SELECT path, name, ext, top_dir, size, mtime, hash_head1mb,
                         pdf_pages, pdf_has_text, pdf_is_scan_likely, hwp_version, hwp_parseable
                  FROM rag_queue
                  WHERE rag_queue = '{q_name}'
                ) TO '{out}' (HEADER, DELIMITER ',')
            """)
            print(f"  ✓ {out.name}")
        except Exception as e:
            print(f"  ⚠ {q_name} export 실패: {e}")


def main() -> int:
    con = connect_db()

    total = q(con, "SELECT COUNT(*) FROM files")[0][0]
    if total == 0:
        print("⚠ files 테이블 비어 있음. 먼저 01-walk-and-record.py 실행 필요.")
        return 1

    print(f"카탈로그 리포트 생성 시작 (총 {total:,} 파일)")
    print()

    print("  1. RAG 큐 분류 view 생성...")
    classify_rag_queue(con)
    print("     ✓ rag_queue view")

    print("  2. 시각화 차트 생성...")
    charts = make_charts(con)
    for c in charts:
        print(f"     ✓ {c.name}")

    print("  3. RAG 인덱싱 큐 CSV export...")
    export_rag_queues(con)

    print("  4. 카탈로그 리포트 Markdown 생성...")
    body = build_report(con)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(body, encoding="utf-8")
    print(f"     ✓ {REPORT_PATH}")

    con.close()
    print()
    print("✓ 카탈로그 리포트 생성 완료")
    print(f"  → {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
