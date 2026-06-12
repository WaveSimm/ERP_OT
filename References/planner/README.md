# planner — 팀즈 플랜(프로젝트) 마이그레이션 입력

- **대응 스크립트**: `scripts/import-planner.py` (+ 보정용 `scripts/fix-planner-sortorder.py`, `scripts/fix-planner-progress.py`)
- **자동 인식**: `References/planner/*.xlsx` — 이 폴더의 **모든 .xlsx 를 자동 처리**
- **파일명 규칙(중요)**: `[팀명] 프로젝트명.xlsx`
  - 파일명의 `[팀명]`으로 팀 배정, 나머지로 프로젝트명을 파싱합니다.
  - 예: `[기술팀] 선박-온바다호-2026.xlsx`, `[사업1팀] KHOA 2026년 해양관측부이 유지관리.xlsx`
- **실행**: 저장소 루트에서 `python scripts/import-planner.py`

플랜이 많아져도 **규칙에 맞게 파일을 이 폴더에 넣기만 하면** 스크립트 수정 없이 전부 인식됩니다.
(주의: `import-planner.py`는 `localhost:3001/3003` 인증·project API를 호출하므로 해당 서비스가 떠 있어야 합니다.)
