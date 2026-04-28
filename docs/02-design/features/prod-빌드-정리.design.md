# [Design] prod-빌드-정리 (Production Build Cleanup)

> **Feature**: prod-빌드-정리
> **Phase**: Design
> **Created**: 2026-04-28
> **Updated**: 2026-04-28
> **Status**: Design v1.0
> **Planning Doc**: [prod-빌드-정리.plan.md](../../01-plan/features/prod-빌드-정리.plan.md)

---

## 1. 개요

### 1.1 설계 목표

1. **`pnpm build` 무에러 통과**: type errors + useSearchParams prerender 에러 0건
2. **dev/prod 토글 가능 인프라**: docker-compose override로 1줄 전환
3. **회귀 안전**: dev에서 동작하던 기능 prod에서도 동일 동작
4. **부하 재측정 자동화**: 부하테스트 PDCA 시나리오·시드 그대로 재사용

### 1.2 설계 원칙

- **개별 정정 우선**: `ignoreBuildErrors` 같은 우회는 사용 안 함
- **dynamic은 페이지별**: 전역 next.config는 변경 안 함, 영향 범위 최소화
- **사전 type-check**: 빌드 전 `tsc --noEmit`으로 type error 일괄 파악
- **부하 재측정 자동화**: 기존 `run-round.sh` 그대로, LABEL만 변경

---

## 2. force-dynamic 적용 패턴

### 2.1 적용 대상 매트릭스

| 위치 | 파일 | 사용처 | 상태 |
|------|------|--------|:---:|
| L1 | `apps/web/src/app/approval/page.tsx` | useSearchParams (탭 상태) | Pending |
| L2 | `apps/web/src/app/approval/new/page.tsx` | useSearchParams (참조 ID) | Pending |
| L3 | `apps/web/src/app/approval/layout.tsx` | useSearchParams + usePathname | Pending |
| L4 | `apps/web/src/app/board/search/page.tsx` | useSearchParams (q) | Pending |
| L5 | `apps/web/src/app/equipment/page.tsx` | useSearchParams (필터) | Pending |
| L6 | `apps/web/src/app/equipment/schedule/page.tsx` | useSearchParams (날짜) | Pending |
| L7 | `apps/web/src/app/equipment/sensors/page.tsx` | useSearchParams (필터) | Pending |
| L8 | `apps/web/src/app/equipment/sensors/[id]/page.tsx` | useSearchParams (탭) | Pending |
| L9 | `apps/web/src/app/equipment/stats/page.tsx` | useSearchParams (period) | Pending |
| L10 | `apps/web/src/app/equipment/[id]/page.tsx` | useSearchParams | Pending |
| L11 | `apps/web/src/app/equipment/layout.tsx` | useSearchParams + usePathname | Pending |
| L12 | `apps/web/src/app/ocr/scan/page.tsx` | useSearchParams | Pending |
| L13 | `apps/web/src/app/procurement/suppliers/page.tsx` | useSearchParams | Pending |

총 11개 page + 2개 layout = **13개 파일**.

### 2.2 적용 코드 (페이지)

각 page.tsx 또는 layout.tsx의 `"use client"` 직후에 추가:

```tsx
"use client";

// 부하테스트 prod 빌드 정리 — Suspense boundary 없이 useSearchParams 사용 시 prerender 에러
// 회피. ERP 특성상 SSG 효과 없으므로 force-dynamic이 적합.
export const dynamic = 'force-dynamic';

import { useSearchParams } from "next/navigation";
// ...
```

### 2.3 layout.tsx 적용

layout도 동일 옵션:

```tsx
"use client";

export const dynamic = 'force-dynamic';

// 기존 layout 코드
```

> **주의**: layout에 `force-dynamic` 적용 시 하위 모든 page도 dynamic 강제됨. 따라서 approval/equipment 하위 페이지는 layout에만 적용해도 충분. 그러나 명시성을 위해 페이지에도 적용하는 것이 안전.

---

## 3. Type Error 정리

### 3.1 알려진 Type Error

#### Error 1: `equipment/sensors/[id]/page.tsx:79`
```typescript
// 현재 (실패)
setMaintForm({
  type: "PREVENTIVE", title: "", description: "",
  performedBy: "", performedAt: ..., cost: ""
  // startDate, endDate 누락 — SetStateAction 타입 불일치
});
```

**해결**:
```typescript
setMaintForm({
  type: "PREVENTIVE", title: "", description: "",
  performedBy: "", performedAt: ..., cost: "",
  startDate: "", endDate: "",   // ← 추가
});
```

#### Error 2: `components/AttendanceView.tsx:232`
```typescript
// 현재 (실패) — RefObject<HTMLInputElement | null> vs LegacyRef 불호환
ref={someRef}
```

**해결 옵션**:
- `as React.RefObject<HTMLInputElement>` 캐스팅
- 또는 `useRef<HTMLInputElement>(null!)` (initial null 가드)
- 또는 conditional rendering으로 ref 분리

### 3.2 사전 type-check (Phase 1 첫 단계)

빌드 전 전체 type error 파악:

```bash
docker exec erp-ot-web sh -c "cd /app && npx tsc --noEmit" 2>&1 | head -100
```

또는 호스트:
```bash
cd apps/web
pnpm exec tsc --noEmit 2>&1 | tee /tmp/typecheck.log
```

**예상**: 위 2건 외에 추가 발견 가능. 발견 시 매트릭스에 추가.

---

## 4. 빌드 검증 절차

### 4.1 단계별 검증

```bash
# Phase 1: 호스트에서 type-check (빠른 피드백)
cd apps/web
pnpm exec tsc --noEmit             # type errors 모두 정리

# Phase 2: 로컬 next build (Docker 안 쓰고 빠르게)
pnpm build                          # ← 이 단계가 통과해야 prerender 에러 모두 정리됨

# Phase 3: 로컬 standalone 실행 (선택)
node .next/standalone/apps/web/server.js &
curl http://localhost:3000/login    # 200 확인
curl http://localhost:3000/board    # 인증 redirect 또는 200
kill %1

# Phase 4: Docker 빌드
docker compose -f docker-compose.yml -f docker-compose.prod-test.yml build web

# Phase 5: 컨테이너 가동 + sanity
docker compose -f docker-compose.yml -f docker-compose.prod-test.yml up -d web
curl http://localhost:3000          # 응답 확인

# Phase 6: 회귀 sanity
# (수동) 브라우저에서 §6 sanity 페이지 5~10개 확인
```

### 4.2 docker-compose override 검증

기존 `docker-compose.prod-test.yml`은 부하테스트 PDCA에서 작성됨. 그대로 활용:

```yaml
services:
  web:
    image:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      target: runner
    command: []
    working_dir: /app
    environment:
      NODE_ENV: production
```

이름 명확화 위해 `docker-compose.prod.yml`로 rename 가능 (선택).

---

## 5. dev vs prod 비교 표 (목표)

부하테스트 결과 보고서 v1.1에 추가될 비교 매트릭스:

```markdown
## dev vs prod 비교 (부하테스트 결과 v1.1 §X)

| Round | 시나리오 | VU | dev p95 | **prod p95** | dev 에러율 | **prod 에러율** | 개선 |
|-------|---------|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | A 출근 | 60 | 974ms | ??ms | 1.20% | ??% | ?? |
| 4 | A 출근 | 90 | 1.35s + timeout | ??ms | 1.85% | ??% | timeout 해소? |
| 2 | B mix | 60 | 116ms | ??ms | 32% | ??% | (worklog 404 영향) |
| 5 | B mix | 90 | 123ms | ??ms | 34% | ??% | 동일 노이즈 |
| 3 | C 검색 | 30 | 230ms | ??ms | 3.97% | ??% | Ollama 동일 |
| 6 | C 검색 | 60 | 493ms | ??ms | 3.13% | ??% | Ollama 동일 |
```

**예상**: A 출근 burst가 가장 큰 개선 (Next.js 컴파일 부담 제거). 나머지는 비슷.

---

## 6. 회귀 sanity Test 페이지 목록

prod 모드 가동 후 다음 페이지의 핵심 동작 확인 (수동, 5~10분):

| # | 페이지 | 확인 항목 |
|---|--------|----------|
| 1 | `/login` | 로그인 폼 → dev-admin 인증 |
| 2 | `/home` | 홈 6개 카드 로드 |
| 3 | `/board` | 게시판 랜딩, 자료실 목록 |
| 4 | `/board/search?q=메인보드` | 검색 결과 표시 (검색개선 PDCA 동작) |
| 5 | `/board/notice/notice-company` | 공지 게시판 진입 |
| 6 | `/equipment` | 장비 목록 + 필터 |
| 7 | `/equipment/sensors` | 센서 목록 |
| 8 | `/approval` | 결재 inbox/sent 탭 |
| 9 | `/work-logs` | 작업비고 피드 |
| 10 | `/admin/calendar` | 회사달력 |

**기준**: dev에서 정상 동작하던 모든 페이지가 prod에서도 동일하게 동작.

---

## 7. 부하 재측정 절차

### 7.1 시나리오 (변경 없음)

부하테스트 PDCA의 `scripts/load-test/scenario-{a,b,c}-*.js` 그대로 활용.

### 7.2 Round 4-prod, 5-prod, 6-prod 실행

```bash
# prod 모드 web 가동
docker compose -f docker-compose.yml -f docker-compose.prod-test.yml up -d --build web

# 부하 사용자 시드는 이미 90명 존재 (재시드 불필요)

# Round 4-prod: A 출근 burst 90 VU
LABEL=round-4-prod-burst-stress STRESS=true DURATION=120 \
MSYS_NO_PATHCONV=1 bash scripts/load-test/run-round.sh scenario-a-morning-burst.js

# Round 5-prod: B mix 90 VU 10분
LABEL=round-5-prod-mix-stress STRESS=true DURATION=720 \
MSYS_NO_PATHCONV=1 bash scripts/load-test/run-round.sh scenario-b-mixed.js

# Round 6-prod: C 검색 60 VU 5분
LABEL=round-6-prod-search-stress STRESS=true DURATION=360 \
MSYS_NO_PATHCONV=1 bash scripts/load-test/run-round.sh scenario-c-search-burst.js
```

### 7.3 dev round 1, 2, 3 prod 비교용 추가 측정 (선택)

```bash
LABEL=round-1-prod-burst DURATION=120 \
MSYS_NO_PATHCONV=1 bash scripts/load-test/run-round.sh scenario-a-morning-burst.js

# (기타)
```

소요: prod 빌드 ~5분 + 6 round ~25분 = **약 30분**.

---

## 8. 영향 / 리스크 / 안전장치

### 8.1 영향 범위 정량화

| 카테고리 | 변경량 |
|---------|:---:|
| `force-dynamic` 추가 | 13 파일 (page 11 + layout 2) |
| Type error 정정 | 알려진 2건 + 추가 (예상 5건 이하) |
| 신규 / 변경 파일 | ~16개 |
| docker-compose | 0 (기존 override 활용) |

### 8.2 리스크와 완화

| 리스크 | 완화 |
|---|---|
| force-dynamic으로 SSR 부담 증가 | 부하 재측정으로 검증, 필요 시 페이지별 Suspense로 변환 |
| 추가 type errors 발견 | Phase 1에서 `tsc --noEmit`으로 일괄 파악 후 정리 |
| 회귀 (UI/기능 깨짐) | sanity test 10개 페이지 (§6) |
| 빌드 산출물 크기 큼 | Dockerfile multi-stage 활용으로 standalone 최소 |
| prod 환경변수 누락 | docker-compose 환경변수 비교 |

---

## 9. 구현 순서 (Do 단계)

### Phase 1: Type-check (15분)
- [ ] `pnpm exec tsc --noEmit` 실행
- [ ] 에러 매트릭스 작성
- [ ] 알려진 2건 + 발견된 추가 에러 모두 정리

### Phase 2: force-dynamic 적용 (15분)
- [ ] 13 파일에 `export const dynamic = 'force-dynamic'` 추가
- [ ] 사전 grep 검증 — 누락 페이지 없는지

### Phase 3: 로컬 빌드 검증 (10분)
- [ ] `pnpm build` 통과
- [ ] standalone server.js 로컬 실행 + 핵심 페이지 200 확인

### Phase 4: Docker 빌드 + 회귀 sanity (15분)
- [ ] `docker compose -f ... -f docker-compose.prod-test.yml build web`
- [ ] prod 모드 web 가동
- [ ] sanity 10페이지 수동 검증

### Phase 5: 부하 재측정 (30분)
- [ ] Round 4-prod, 5-prod, 6-prod 실행
- [ ] (선택) Round 1-prod, 2-prod, 3-prod 실행 (정상 부하 비교)

### Phase 6: 보고서 갱신 (15분)
- [ ] 부하테스트 결과 보고서 v1.1 — dev vs prod 비교 표 + 결론 갱신

총 예상 시간: **~1.5시간**

---

## 10. Open Questions (Design 단계 보류)

| 항목 | 비고 |
|------|------|
| docker-compose.prod.yml로 rename | 선택. 명확성 측면에서 권장하나 본 PDCA scope 외 |
| Suspense 변환 | 1차 force-dynamic만. SSR 부담 측정 후 필요 시 별도 PDCA |
| 추가 type errors 정리 범위 | "빌드 통과까지" — 빌드와 무관한 cosmetic은 제외 |

---

## 11. Definition of Done (Design 관점)

- [x] 13 파일 매트릭스 명시
- [x] 알려진 2건 type error 해결 패턴 명시
- [x] 사전 type-check 절차 명시
- [x] 빌드 검증 단계별 절차
- [x] dev vs prod 비교 표 골격
- [x] 회귀 sanity 10페이지 목록
- [x] 부하 재측정 절차

---

## Version History

| Version | Date | Changes | Author |
|---|---|---|---|
| 1.0 | 2026-04-28 | 최초 Design — 13 파일 force-dynamic, 2 type errors, 6 phase 구현 계획 | AI + Team |
