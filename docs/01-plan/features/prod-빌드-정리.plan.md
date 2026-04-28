# [Plan] prod-빌드-정리 (Production Build Cleanup)

> **Feature**: prod-빌드-정리 (Next.js Production Build Cleanup)
> **Phase**: Plan
> **Created**: 2026-04-28
> **Updated**: 2026-04-28
> **Status**: Plan v1.0
> **Predecessor**: 부하테스트 (scope split로 분리)

---

## 1. 개요 (Overview)

부하테스트 PDCA 진행 중 Next.js production 빌드가 다음 두 종류 에러로 실패함을 확인.
이를 정리하여 prod 빌드 통과시키고, 부하테스트 6 round를 prod 모드로 재측정해 dev/prod 차이를 정량화한다.

### 1.1 배경 — 발견된 빌드 실패 사유

**A. Type errors** (TypeScript strict mode):
- `apps/web/src/app/equipment/sensors/[id]/page.tsx:79` — `setMaintForm({...})` SetStateAction 타입에 `startDate/endDate` 누락
- `apps/web/src/components/AttendanceView.tsx:232` — `RefObject<HTMLInputElement | null>` vs `LegacyRef` 호환성

**B. Prerender errors** (useSearchParams + Suspense boundary 누락):
- 9개 페이지가 useSearchParams를 사용하지만 export `dynamic` 또는 Suspense 미적용:
  - `/approval`, `/approval/new`
  - `/board/search`
  - `/equipment`, `/equipment/schedule`, `/equipment/sensors`, `/equipment/stats`
  - `/ocr/scan`
  - `/procurement/suppliers`
  - `/equipment/sensors/[id]`, `/equipment/[id]` (동적 routes)
- 추가로 layout 2개에도 useSearchParams 사용: `/approval/layout.tsx`, `/equipment/layout.tsx`

### 1.2 핵심 가치

1. **prod 빌드 통과**: `pnpm build` 성공 → `next start` 가능
2. **부하 측정 완성**: 부하테스트 PDCA의 Round 4-6을 prod에서 재측정하여 dev/prod 응답 시간 차이 정량화
3. **이관 전 검증**: 회사 서버 이관 시점에 prod 빌드가 안정적으로 동작함을 사전 보장
4. **운영 모드 표준화**: docker-compose.prod.yml로 prod 모드 운영 절차 정착

### 1.3 관련 문서

- 부하테스트 Plan/Design v1.1 — scope split 출처
- 부하테스트 결과 보고서 — dev 모드 결과 (비교 baseline)

---

## 2. 사용자 (Users & Roles)

| 역할 | 사용 패턴 |
|---|---|
| **운영자/CTO** | prod 빌드 명령 실행, 컨테이너 전환, 부하 재측정 |
| **개발자** | type error / prerender 에러 정리, 빌드 검증 |

---

## 3. 핵심 도메인 모델

### 3.1 useSearchParams + Suspense 패턴

Next.js App Router에서 `useSearchParams`를 사용하는 클라이언트 컴포넌트는 prerender 시 SSR이 실패. 두 가지 해결 방안:

**Option A — `export const dynamic = 'force-dynamic'`** (페이지 단위)
- 해당 페이지를 항상 SSR로 렌더링
- 단순, 코드 변경 1줄

**Option B — `<Suspense>` boundary**
- 페이지의 useSearchParams 사용 부분만 Suspense로 감싸기
- 부분적으로 SSG 가능 (성능 유리)
- 코드 구조 변경

권장: **A안** — 부하테스트 + 인증 ERP라 어차피 모두 동적 렌더링. SSG 효과 미미.

### 3.2 Type Error 카테고리

| 카테고리 | 위치 | 해결 |
|---------|------|------|
| **누락된 필드** | `equipment/sensors/[id]/page.tsx` setMaintForm | 모든 필드 명시 |
| **호환성** | `AttendanceView.tsx` ref 타입 | `as RefObject<HTMLInputElement>` 또는 ref 타입 명시 |

---

## 4. 사용자 시나리오

| ID | As a | I want | So that |
|---|---|---|---|
| US-01 | 개발자 | `pnpm build` 명령이 통과 | prod 모드 컨테이너 실행 가능 |
| US-02 | 운영자 | docker-compose 옵션으로 prod 모드 전환 | 1줄 명령으로 dev↔prod 전환 |
| US-03 | CTO | 부하테스트 6 round prod 재측정 가능 | dev/prod 차이 정량 비교 |
| US-04 | 운영자 | 회사 서버 이관 시 prod 모드 가동 | 안정 운영 |

---

## 5. 범위 (Scope)

### 5.1 In Scope (1차)

- [ ] **Type error 정리** (현재 발견된 2건):
  - `equipment/sensors/[id]/page.tsx` setMaintForm 모든 필드 명시
  - `AttendanceView.tsx` ref 타입 호환성
- [ ] **`pnpm build` 시 발견되는 추가 type errors 정리** (전체 빌드 패스 통과까지)
- [ ] **9개 페이지에 `export const dynamic = 'force-dynamic'`** 추가
- [ ] **2개 layout (approval, equipment)에 동일 옵션** 또는 Suspense
- [ ] **`apps/web/Dockerfile` 빌드 검증** — `target: runner` 정상 동작
- [ ] **`docker-compose.prod-test.yml` 또는 `docker-compose.prod.yml`** 정착화
- [ ] **`pnpm build` + `next start` 로컬 검증**
- [ ] **부하테스트 Round 4-6 prod 모드 재측정** (Round 4-prod, 5-prod, 6-prod)
- [ ] **dev vs prod 결과 비교 표** 작성
- [ ] **부하테스트 결과 보고서 v1.1** — prod 측정 결과 + 비교 + 임계점 재해석

### 5.2 Out of Scope

- 일반 코드 리팩토링 (기능 변화 없는 정리는 별도 PDCA)
- 페이지별 부분 Suspense (현재 페이지는 거의 모두 동적)
- ESLint 정리 (build와 무관)
- Next.js 15 업그레이드 (현재 14)
- App Router 미들웨어 변경
- Server Actions 도입

---

## 6. 요구사항 (Requirements)

### 6.1 기능 요구사항 (Functional)

| ID | 요구사항 | 우선순위 | 상태 |
|---|---|---|---|
| FR-01 | `equipment/sensors/[id]/page.tsx` setMaintForm 타입 정정 | High | Pending |
| FR-02 | `AttendanceView.tsx` ref 타입 호환성 | High | Pending |
| FR-03 | `pnpm build` 통과 (남은 type errors 모두 정리) | High | Pending |
| FR-04 | 9개 페이지 + 2개 layout에 `force-dynamic` 적용 | High | Pending |
| FR-05 | `next build` 후 `.next/standalone/server.js` 생성 확인 | High | Pending |
| FR-06 | `docker-compose.prod-test.yml` (또는 prod.yml) 정착화 | High | Pending |
| FR-07 | `pnpm start` (또는 `node server.js`) 로컬 검증 — 모든 페이지 200/3xx | High | Pending |
| FR-08 | 부하테스트 Round 4-prod, 5-prod, 6-prod 실행 | High | Pending |
| FR-09 | dev vs prod 응답 시간 비교 표 (4개 시나리오 × 2 모드 × p50/p95/p99) | High | Pending |
| FR-10 | 부하테스트 결과 보고서 v1.1 갱신 | Medium | Pending |

### 6.2 비기능 요구사항 (Non-Functional)

| 카테고리 | 기준 | 측정 |
|---|---|---|
| 빌드 시간 | < 5분 | docker compose build 시간 |
| 빌드 산출물 크기 | standalone 이미지 < 1GB | docker images |
| prod 모드 60 VU burst p95 | < 800ms (dev 1.53s 대비 50% 이상 개선) | k6 |
| prod 모드 90 VU burst | timeout 0건 (dev 명백한 timeout 발생) | k6 |
| 회귀 안전 | dev 모드 측정 결과와 prod의 차이가 응답 시간만, 기능 회귀 없음 | UI 수동 |
| 빌드 cleanup | next.config.mjs 변경 없이 정상 빌드 | git diff 검증 |

---

## 7. 성공 기준

### 7.1 Definition of Done

- [ ] `pnpm build`가 0 error로 통과
- [ ] `node .next/standalone/server.js` 로컬 실행 시 모든 핵심 페이지 200/3xx
- [ ] 9개 페이지 + 2 layout이 `force-dynamic`으로 정상 SSR
- [ ] type error 0건
- [ ] docker-compose prod 모드로 web 컨테이너 가동
- [ ] 부하테스트 Round 4-prod, 5-prod, 6-prod 완료 + 결과 캡처
- [ ] dev vs prod 비교 표 작성
- [ ] 부하테스트 결과 보고서 v1.1 갱신

### 7.2 Quality Criteria

- [ ] gap-detector Match Rate ≥ 90%
- [ ] prod 빌드가 60 VU burst에서 dev 대비 50%+ 응답 시간 개선
- [ ] prod 90 VU burst가 timeout 없이 처리됨
- [ ] 검색·게시판·결재·작업비고 등 모든 핵심 페이지 prod에서 정상 동작 (수동 sanity)

---

## 8. 리스크 및 완화

| 리스크 | 영향 | 가능성 | 완화 |
|---|---|---|---|
| 추가 type errors 다수 발견 | Medium | High | 1차 점검 후 패키지화 — 1건씩 정리 |
| force-dynamic으로 SSR 부담 증가 | Low | Medium | 부하테스트로 측정. 문제 시 Suspense로 개별 변환 |
| docker-compose 빌드 시간 길어짐 | Low | Medium | 1회성, 캐시 활용 |
| 일부 페이지가 useSearchParams 외 다른 dynamic 의존 | Medium | Low | 빌드 에러 메시지로 감지 |
| prod 모드에서 환경변수 못 받는 페이지 | Medium | Low | dev/prod env 비교 검증 |
| 부하 재측정 시 Round 4-6 결과가 dev와 큰 차이 안 나면 결론 무효 | Low | Low | 그것 자체가 분석 결과 |
| 회귀 (UI 깨짐, 기능 누락) | High | Low | 수동 sanity test 5~10페이지 |

---

## 9. 아키텍처 고려사항

### 9.1 프로젝트 레벨

| Level | 적용 |
|---|:---:|
| Enterprise | ☑ |

### 9.2 핵심 결정

| 결정 | 선택 | 근거 |
|---|---|---|
| useSearchParams 처리 | **`force-dynamic` 페이지별 적용** | 단순, ERP 특성상 SSG 효과 거의 없음 |
| Type error 처리 | **개별 정정** (no `ignoreBuildErrors`) | 회귀 없는 정정 가능 |
| docker-compose prod 파일 | **`docker-compose.prod-test.yml` 정착화** | 부하테스트 PDCA에서 작성된 것 활용 |
| 빌드 검증 | **로컬 `pnpm build` + `node server.js`** | docker 빌드보다 빠른 피드백 |
| 측정 시점 | **부하테스트 Round 4-6 재실행** | 기존 매트릭스 활용 |

### 9.3 영향 범위

```
apps/web/
├── src/app/
│   ├── approval/{page.tsx,new/page.tsx,layout.tsx}      # [수정] dynamic
│   ├── board/search/page.tsx                            # [수정] dynamic
│   ├── equipment/{page,schedule,sensors,stats}/page.tsx # [수정] dynamic
│   ├── equipment/{layout.tsx,[id]/page.tsx}             # [수정] dynamic
│   ├── equipment/sensors/[id]/page.tsx                  # [수정] type + dynamic
│   ├── ocr/scan/page.tsx                                # [수정] dynamic
│   └── procurement/suppliers/page.tsx                   # [수정] dynamic
├── src/components/AttendanceView.tsx                    # [수정] ref 타입
└── Dockerfile                                           # 검증만 (변경 없음)

docker-compose.prod-test.yml                             # 검증/정착화
docs/04-operation/부하테스트-결과-2026-04-28.md          # [수정] v1.1 + prod 결과
```

---

## 10. Convention Prerequisites

### 10.1 기존 컨벤션 활용

- ✅ Next.js 14 App Router 패턴
- ✅ apps/web 빌드 시스템 (Dockerfile 그대로)
- ✅ docker-compose override 패턴

### 10.2 신규 정의

| 카테고리 | 정의 | 우선순위 |
|---|---|:---:|
| dynamic 옵션 적용 위치 매트릭스 | 9페이지 + 2 layout (목록 §1.1 B) | High |
| dev vs prod 비교 표 형식 | 시나리오 × 모드 × p50/p95/p99/에러율/리소스 | Medium |

### 10.3 환경변수

신규 변수 없음. 기존 `NODE_ENV=production` 활용.

---

## 11. 다음 단계 (Next Steps)

1. [ ] **Design 작성**: `/pdca design prod-빌드-정리`
   - 페이지별 dynamic 적용 패턴
   - 빌드 검증 절차 단계별
   - dev vs prod 비교 표 골격
   - 회귀 sanity test 페이지 목록
2. [ ] **Do 진입**: type 정리 → dynamic 적용 → 빌드 검증 → 부하 재측정
3. [ ] Check + Report

---

## 12. 의존성

### 사전 작업

- ✅ 부하테스트 PDCA 완료 (dev 측정 + 시나리오 + 시드 + cleanup 스크립트)
- ✅ 부하 사용자 시드 90명 (재시드 불필요)
- ✅ k6 시나리오 그대로 재사용 가능

### 신규 패키지 / 도구

없음. 기존 의존성으로 충분.

---

## 13. 결정 요약 (의사결정 로그 — 2026-04-28)

| # | 항목 | 결정 |
|---|---|---|
| 1 | useSearchParams 처리 | **`force-dynamic` 페이지별 적용** |
| 2 | Type error 처리 | **개별 정정** (ignoreBuildErrors 사용 안 함) |
| 3 | 빌드 도구 | **`pnpm build` + Docker target=runner** |
| 4 | 측정 비교 | **부하테스트 Round 4-6 재실행** (시나리오 동일) |
| 5 | 보고서 정착 | **부하테스트 결과 v1.1로 통합** (별도 보고서 X) |

---

## Version History

| Version | Date | Changes | Author |
|---|---|---|---|
| 1.0 | 2026-04-28 | 최초 Plan — 부하테스트 PDCA scope split 결과 분리 작업 | AI + Team |
