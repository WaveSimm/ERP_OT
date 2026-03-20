# Report Generator Agent Memory Index

이 인덱스는 bkit-report-generator 에이전트의 프로젝트 메모리 항목들을 추적합니다.

## Project Memory

### PDCA Completion Reports

- [프로젝트-관리 기능 완료 (2026-03-19)](프로젝트-관리-completion.md)
  - PDCA Cycle #1 완료, 93% Match Rate 달성
  - 22일 소요, 4인 투입 (347% 명일)
  - 44/48 스토리 완료, 7개 Gap 해결
  - 다음: 지휘센터 대시보드 또는 프로젝트-관리 v1.1

## Document Templates & Standards

- **Report Template**: `C:/Users/yunsi/.claude/plugins/cache/bkit-marketplace/bkit/1.5.5/templates/report.template.md`
- **Output Location**: `docs/04-report/`
  - Features: `docs/04-report/features/{feature}-v{N}.md`
  - Changelog: `docs/04-report/changelog.md`
  - Status: `docs/04-report/status/`

## PDCA Cycle Standards

- **Match Rate Target**: 90% (threshold for completion)
- **Act Phase Iterations**: Max 5 (stop at ≥90% or max reached)
- **Report Structure**: Summary + Completed Items + Quality Metrics + Lessons Learned + Next Steps
- **Version Tracking**: {feature}-v1.md, v2.md for multiple cycles

## Related Agents & Skills

- **bkit-pdca**: PDCA workflow orchestration
- **gap-detector**: Compare Design vs Implementation (Check phase)
- **pdca-iterator**: Auto code fixes & re-verification (Act phase)
- **report-generator**: Current agent (this memory)

---

*Last Updated: 2026-03-19*
*Maintained by: bkit-report-generator agent*
