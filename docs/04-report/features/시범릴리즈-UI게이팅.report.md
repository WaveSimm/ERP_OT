# 시범 릴리즈 UI 게이팅 (Report)

**일자**: 2026-06-23 | **대상**: apps/web | **PR**: #87 (feat/trial-release-ui-improvements)

## 배경
2026-06-23 시범 릴리즈. 회계(/procurement)·결재(/approval)를 비관리자에게 숨김(UI 레벨).

## 구현
- 비관리자: 회계·결재 메뉴 숨김 + 라우트 가드(UI 레벨).
- 종료 후 원복 대상 4파일에 `시범 릴리즈(2026-06-23)` 마커 — `grep "시범 릴리즈(2026-06-23)"` 로 추적.

## 잔여 (종료 시 원복)
- 마커 4파일 원복. (CC메모리 trial-release-accounting-approval-admin-only.md 기록 — 임시 UI 게이팅, 백엔드 권한과 별개)
