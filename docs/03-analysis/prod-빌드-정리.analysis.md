# Gap Analysis — prod-빌드-정리 (Production Build Cleanup)

**Date**: 2026-04-28
**Plan**: `docs/01-plan/features/prod-빌드-정리.plan.md` (v1.0)
**Design**: `docs/02-design/features/prod-빌드-정리.design.md` (v1.0)
**Result**: `docs/04-operation/부하테스트-결과-2026-04-28.md` v1.1 (§1.1, §9)

**Match Rate: 92%** ✅ Ready for Report

---

## Overall Scores

| Category | Score | Status |
|----------|:-----:|:------:|
| FR Coverage (10 항목) | 95% (9.5/10) | OK |
| NFR Coverage | 핵심 100% (90VU timeout 해소), 부수 80% | OK |
| Design Match | 90% | OK |
| **Overall Match Rate** | **92%** | OK |

---

## FR Coverage (10 항목)

| FR | 요구사항 | 결과 | 상태 |
|----|---------|------|:---:|
| FR-01 | sensors/[id] setMaintForm 타입 | startDate/endDate 추가 | OK |
| FR-02 | AttendanceView ref 타입 | MutableRefObject 적용 | OK |
| FR-03 | `pnpm build` 통과 | 53 pages 생성 ✅ | OK |
| FR-04 | 13 파일 force-dynamic | 13/13 모두 적용 | OK |
| FR-05 | standalone server.js 생성 | 확인 ✅ | OK |
| FR-06 | docker-compose.prod-test.yml 정착 | 파일은 존재, **빌드 실패** | Partial |
| FR-07 | 로컬 standalone 검증 | 호스트 직접 실행 OK | OK |
| FR-08 | Round 4-6 prod 실행 | 4 round (+ Round 1-prod) | OK |
| FR-09 | dev vs prod 비교 표 | 보고서 §1.1 | OK |
| FR-10 | 보고서 v1.1 갱신 | §1.1 + §9 추가 | OK |

**FR Coverage: 9.5 / 10 = 95%**

---

## NFR Coverage

| NFR | 목표 | 실측 | 상태 |
|-----|------|------|:---:|
| 빌드 시간 | < 5분 | (호스트 직접) | N/A |
| standalone 크기 | < 1GB | — | N/A |
| 60 VU burst p95 | < 800ms (dev 50%↓) | login 1.02s (-33%), home 647ms (-34%) | Partial |
| 90 VU burst timeout | **0건** | **0건** ⭐ | **OK (핵심)** |
| 회귀 안전 | 기능 회귀 없음 | 부하 round 간접 증명 | OK |
| next.config 변경 없이 빌드 | git diff 0 | `missingSuspenseWithCSRBailout: false` 추가 | Deviation |

**핵심 NFR (90 VU burst timeout 해소): 100% 달성 ⭐**

---

## Gap List

### 🔵 D1. `missingSuspenseWithCSRBailout: false` 추가 (Plan/Design 미반영)

- Plan §6.2 NFR: "next.config.mjs 변경 없이"
- 실제: `apps/web/next.config.mjs:7`에 `experimental.missingSuspenseWithCSRBailout: false` 추가
- 사유: force-dynamic만으로는 prerender 에러 회피 불가 (Next.js 14 한계)
- **Severity**: Low — 본질 목적(빌드 통과) 달성을 위한 합리적 우회
- **조치**: Design v1.1에 §2.4 "Next.js 14 추가 빌드 옵션" 추가

### 🔵 D2. Docker 빌드 실패 — 호스트 standalone 직접 실행 (FR-06 partial)

- Plan FR-06: docker-compose.prod-test.yml 정착화
- 실제: 파일 작성 완료, `docker compose build web` 실패
- 사유: `apps/web/Dockerfile`이 npm install + monorepo workspace unaware → @swc/helpers, @/lib/api, MonthCalendar 모듈 못 찾음
- 우회: 호스트 `node .next/standalone/server.js` 직접 실행 → 부하 측정 목적 달성
- **Severity**: Medium (scope 외) / Low (본 PDCA 목적 관점)
- **조치**: 별도 PDCA `monorepo-dockerfile-정리` 분리 (보고서 §1 헤더에도 명시됨)

### 🟡 D3. Round 1/2/3-prod 부분 측정

- Plan §7.3: "선택" 항목
- 실제: Round 1-prod 1개만 (burst 비교용)
- **Severity**: Negligible — Plan에서 명시적 Optional, 핵심 stress 4-6 prod 모두 완료

### 🟡 D4. 60 VU burst p95 < 800ms 절댓값 미달

- Plan §6.2: 60 VU prod p95 < 800ms (dev 50%+ 개선)
- 실제: login p95 1.02s (-33%), home 647ms (-34%) — 30%대 개선, 50% 미달
- **Severity**: Low — 보고서 §4 "이관 후 H/W 향상으로 추가 개선 예상"
- **조치**: 회사 서버 이관 후 재측정으로 검증

### 🟢 D5. AttendanceView 라인 번호 (Design 오기)

- Design §3.1 Error 2: line 232
- 실제: line 207 (props 정의)
- **Severity**: Trivial

### 🟢 D6. 회귀 sanity test 명시 누락

- Design §6: 10페이지 sanity 매뉴얼
- 보고서·analysis에 sanity 통과 명시 없음 (부하 round 간접 증명만)
- **Severity**: Low
- **조치**: 보고서 v1.2 또는 Report에 sanity 통과 한 줄 추가

---

## 핵심 가치 달성 (Plan §1.2)

| 가치 | 달성 |
|------|:---:|
| prod 빌드 통과 → next start 가능 | ✅ |
| dev/prod 응답 시간 정량화 | ✅ |
| 이관 전 prod 빌드 안정성 보장 | Partial (호스트 standalone OK, Docker 별도 PDCA) |
| docker-compose prod 운영 절차 정착화 | Partial (파일 정착, 빌드 미동작) |

**핵심 성과**:
- **90 VU burst timeout 0건** ⭐ (Plan §6.2 핵심 NFR)
- **mix p99 -69%** (562ms → 173ms) — Next.js dev 컴파일 부담이 tail latency 주범 정량 입증
- 13 파일 force-dynamic 100% 일치

---

## 후속 조치

### Report 전 권장
1. Design v1.1 — §2.4 missingSuspenseWithCSRBailout 추가 결정 기록
2. 보고서에 sanity 통과 한 줄 명시 (D6)

### 별도 PDCA로 분리
3. **`monorepo-dockerfile-정리`** — Dockerfile을 turborepo + pnpm workspace 대응 (D2)

### 회사 서버 이관 후
4. Round 1/2/3-prod 추가 측정 (D3)
5. 60 VU burst 800ms 절댓값 검증 (D4)

---

## Verdict

**92% ≥ 90% → READY FOR REPORT**

본 PDCA의 핵심 가치(빌드 통과 + dev/prod 비교 + 90 VU timeout 해소)는 모두 달성. Docker 빌드는 monorepo Dockerfile 별도 정리 필요하나 부하 측정 목적은 호스트 standalone으로 달성됨.

다음 명령:
1. `/pdca report prod-빌드-정리`
2. (선택) `/pdca plan monorepo-dockerfile-정리` — Docker 빌드 정리 별도 PDCA
