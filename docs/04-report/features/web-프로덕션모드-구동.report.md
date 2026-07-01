# web 프로덕션 모드 구동 (Report)

**일자**: 2026-06-25 | **대상**: apps/web

## 배경
미뤄온 web-standalone-fix. 프로덕션 빌드(`next build && next start`)가 안 돼 dev모드(66%CPU·5GB)로 운영 중이었음.

## 해결 (막던 원인 4가지)
1. dual-use page(page를 컴포넌트로 import) PageProps 충돌 → expense Transactions/Settlements를 `_components/`로 추출, page는 thin wrapper.
2. `output: standalone` 제거 + `experimental.missingSuspenseWithCSRBailout: true`.
3. ★루트 layout에 `<Suspense fallback={null}>` 래핑 — useContext null 프리렌더(약 40개 client page) 해결의 핵심.
4. `import dynamic from next/dynamic` ↔ `export const dynamic` 충돌 → `nextDynamic` 리네임.
- custom not-found.tsx 추가, NODE_ENV=production 빌드.

## 효과
- web 리소스 대폭 절감(프로덕션: 77MB·15%, dev 상위10위 밖). 단 핫리로드 없음 → 수정마다 재빌드.

## 잔여
- 코드 수정 시 재빌드 절차. (CC메모리 web-production-build-fix.md 기록)
