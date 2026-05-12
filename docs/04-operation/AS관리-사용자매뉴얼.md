# AS(수리) 관리 사용자 매뉴얼

> **이 문서는 stub입니다.** 실제 매뉴얼은 ERP 웹앱과 함께 단일 소스로 관리됩니다.

## 위치

- **파일**: `apps/web/public/manual-as/index.html`
- **이미지**: `apps/web/public/manual-as/img/`
- **스타일**: `apps/web/public/manual-as/style.css`

## 접근 방법

- **브라우저**: `http://localhost:3000/manual-as/` (개발 서버 실행 중일 때)
- **편집**: `apps/web/public/manual-as/index.html` 직접 수정 (HTML)

## 통합 이력

- **2026-05-06**: 매뉴얼 파일을 `apps/web/public/manual-as/index.html` 단일 소스로 통합.
  이전에는 이 폴더의 `.md`/`.html`과 `public/manual-as/index.html` 3개 파일을 수동 동기화했으나, 동기화 누락 위험으로 통합.
  변경 이력은 git log로 추적: `git log -- apps/web/public/manual-as/index.html`.

## 백버전 참조

이전 markdown 본문을 보려면 통합 직전 커밋을 참조하세요:
```
git show 790474d:docs/04-operation/AS관리-사용자매뉴얼.md
```
