# NAS 스캔 분석

NAS의 파일 메타데이터를 수집·분석하여 RAG 시스템 설계의 기반 데이터를 만듭니다.

## 목적

- NAS 자료의 실제 분포 파악 (가정이 아닌 실측)
- Hot tier 후보 식별 (시간·접근 빈도 기반)
- OCR 필요 비율 추정 (스캔 PDF 비율)
- 중복·임시 파일 정리 기회 발견
- RAG 인덱싱 시간·비용 정밀 추정

## 구성

| 단계 | 파일 | 작업 | 예상 시간 (~200만 파일) |
|------|------|------|----------------------|
| Tier 0 | `01-walk-and-record.py` | os.walk → 파일 메타 (path/size/mtime/ext) | ~19시간 |
| Tier 1 | `02-pdf-analyze.py` | PDF 페이지·텍스트 레이어 (pdfplumber) | ~10시간 |
| Tier 2 | `03-hwp-analyze.py` | HWP 버전·파싱 가능성 (olefile) | ~5시간 |
| Tier 3 | `04-hash-dedup.py` | head 1MB hash → 중복 탐지 | ~12시간 |
| Phase D | `05-report.py` | 통계·시각화·리포트 | ~30분 |

## 사전 준비

```powershell
# Python 3.11+ 필요
python -m pip install duckdb pdfplumber tqdm olefile matplotlib

# NAS 마운트 확인 (\\192.168.0.220\oceantech 접근 가능)
Test-Path "\\192.168.0.220\oceantech"

# UTF-8 환경변수 (Windows PowerShell)
$env:PYTHONIOENCODING="utf-8"
```

## 실행 순서

### 빠른 sanity check (1분)

```powershell
cd scripts\nas-scan
python 01-walk-and-record.py --dry-run --max 100
```

### Tier 0 (메타) — 백그라운드 실행 권장

```powershell
python 01-walk-and-record.py 2>&1 | Tee-Object data\logs\tier0-$(Get-Date -Format yyyyMMdd-HHmm).log
```

### Tier 1 (PDF 분석) — Tier 0 완료 후

```powershell
python 02-pdf-analyze.py 2>&1 | Tee-Object data\logs\tier1-$(Get-Date -Format yyyyMMdd-HHmm).log
```

### Tier 2, 3 (HWP, hash) — 병렬 가능

```powershell
# 별도 터미널에서 동시 실행 가능
python 03-hwp-analyze.py
python 04-hash-dedup.py
```

### 분석 리포트

```powershell
python 05-report.py
# → docs/04-operation/nas-스캔-분석-리포트-YYYYMMDD.md 생성
```

## 데이터 저장 위치

| 산출물 | 위치 |
|---|---|
| **메타 DB** (핵심) | `data/nas-scan.duckdb` |
| 에러 로그 | `data/logs/scan-errors-YYYYMMDD.log` |
| 시각화 차트 | `data/charts/*.png` |
| **분석 리포트** | `../../docs/04-operation/nas-스캔-분석-리포트-YYYYMMDD.md` |

## 재실행·중단

- 모든 Tier는 **idempotent** — 중단 후 재실행 시 미처리 파일만 처리
- Tier 0: path PK 기준 UPSERT, mtime 갱신 자동
- Tier 1~3: `--force` 옵션으로 전체 재처리, 기본은 미처리만
- KeyboardInterrupt (Ctrl+C) 안전 — DB 상태 보존

## 정책 메모리

이 작업은 다음 사용자 메모리 정책을 준수합니다:

- `project_rag_strategy` — RAG는 별도 시스템
- `project_nas_rag_ocr_policy` — OCR 비용 0 + Tier 2/3 후보 태깅
- `project_nas_rag_vector_db` — pgvector 별도 인스턴스로 시작
- `feedback_review_before_execute` — 큰 변경 전 검토안 + 사용자 승인

## 트러블슈팅

| 증상 | 원인·해결 |
|---|---|
| `NAS_NOT_ACCESSIBLE` | net use로 Z: 재매핑 또는 UNC 직접 사용 |
| `UnicodeEncodeError cp949` | `$env:PYTHONIOENCODING="utf-8"` 설정 |
| `Sequence not exist` | `data/nas-scan.duckdb` 삭제 후 재실행 |
| Tier 1 매우 느림 | PDF 큰 파일 위주. `--max 1000` 부분 실행 권장 |
| 권한 거부 폴더 | 자동 skip + 로그 (안전). 로그 확인 후 정책 결정 |
