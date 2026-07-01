# 자원배정 Undo 전면 적용 (Report)

**일자**: 2026-06-23 | **대상**: apps/web (projects/[id], TaskDrawer, ResourcePickerPopover)

## 구현
- **일괄삭제 undo**: 삭제 스냅샷(task+segment+assignment) 저장 후 복원, id 리매핑 처리.
- **모든 자원배정 액션에 undo 추가**: 분담율(saveAssignWeight)·진척률(saveAssignProgress)·간트 quick-assign(toggleResource)에 pushUndo 연결.
- ResourcePickerPopover에 `pushUndo?` prop 추가.

## 검증
- 각 배정 변경/삭제 후 undo로 원상복구 확인.
