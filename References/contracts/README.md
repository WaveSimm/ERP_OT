# contracts — 계약 마이그레이션 입력

- **대응 스크립트**: `scripts/import-contracts.py` (저장소 루트에 위치)
- **자동 인식**: `References/contracts/*계약파일리스트*.xlsx` (glob)
- **파일명 규칙**: 이름에 `계약파일리스트` 포함 (예: `2026년 계약파일리스트.xlsx`)
- **실행**: 저장소 루트에서 `python scripts/import-contracts.py`

새 연도 파일은 규칙에 맞춰 이 폴더에 넣고 스크립트만 재실행하면 됩니다.
