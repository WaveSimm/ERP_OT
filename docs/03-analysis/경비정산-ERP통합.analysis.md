# 경비정산-ERP통합 Gap 분석

> **Feature**: 경비정산-ERP통합 (V1 분리 프로젝트 → V2 ERP 통합)
> **분석일**: 2026-05-15
> **분석 방법**: gap-detector Agent (Design v0.3 vs commit fb8a184 이후 구현)
> **Plan**: [경비정산-ERP통합.plan.md](../01-plan/features/경비정산-ERP통합.plan.md)
> **Design**: [경비정산-ERP통합.design.md](../02-design/features/경비정산-ERP통합.design.md) (v0.3)

---

## 1. 분석 요약

| 항목 | 값 |
|---|---|
| **Match Rate** | **88%** |
| Design 갱신 시 예상 Match Rate | 95%+ |
| 통과 카테고리 (≥90%) | 6 / 9 |
| 미달 카테고리 (<90%) | 3 / 9 |
| High 우선순위 Gap | 2건 |
| Medium 우선순위 Gap | 3건 |
| Low 우선순위 Gap | 3건 |

**핵심 결론**: 구현은 견고하며, 미달의 주요 원인은 **사용자 후속 결정(2026-05-11) 이 Design v0.3 에 미반영**된 데 있습니다. 실제 코드는 정답이며 Design v0.4 갱신만으로 95%+ 회복이 가능합니다.

---

## 2. 검증 매트릭스

| # | 카테고리 | 상태 | Match | 비고 |
|---|---|:---:|:---:|---|
| 1 | Data Model (8 모델 + 7 Enum) | ✅ | 100% | 구현 +확장: `ExpenseSource.displayName`, `ExpenseTransaction.detail`, `ExpenseSettlement.categoryCode` (legacy). Design O3 결정 따라 `@@unique([userId, periodStart, periodEnd])` 제거 |
| 2 | State Machine (Settlement 6단계) | ✅ | 95% | 모든 상태 존재. `APPROVED → PAID` 직접 전이 추가됨 (2026-05-12 재무 후속 통합) |
| 3 | API Endpoints | ⚠️ | 85% | 사용자/재무팀/Admin/Internal 모두 구현. `/admin/settlements` + `/internal/settlement-summary` 미구현 |
| 4 | **Approval Template** | ❌ | **60%** | **Design v0.3 EXPENSE_CLAIM 신설 vs 실제 EXPENSE 일원화**. 메모리 노트(2026-05-11) 사용자 결정 반영. Design 갱신 필요 |
| 5 | UI Pages | ✅ | 95% | 7 페이지. `/expense/matches` 별도 라우트 없음 (transactions/receipts 페이지 내 통합). 신규 `/expense/sources` 추가 |
| 6 | Card Parsers | ✅ | 100% | shinhan/hyundai/kb 3종, parserVersion 명기 |
| 7 | File Storage | ✅ | 100% | LocalFsStorage, `/app/uploads` volume, `receipts/{YYYY-MM}/{id}.{ext}` 월별 분산, validateReceipt 확장자/MIME 검증 추가 |
| 8 | Permissions | ⚠️ | 85% | `requireFinanceTeam` 동등 로직은 `onRequest` hook + `authClient.isFinanceTeam`로 인라인. `ownsResource` 미들웨어 미구현 (서비스 레이어 `WHERE userId=` 직접 검증) |
| 9 | **RabbitMQ Subscriber** | ❌ | **75%** | **Design §5.5 AMQP queue 명세 vs 실제 HTTP webhook** (`POST /internal/settlements/from-approval`, `/from-payment`). 2026-05-12 결재 통합 PDCA 결정. Design 갱신 필요 |

---

## 3. Gap 목록

### 🔴 High 우선순위 (2건) — Design 갱신 필수

#### G-1. Approval Template — EXPENSE_CLAIM 폐기 미반영

- **Design 명세**: §6.1 신규 양식 `EXPENSE_CLAIM` 추가 + 기존 `EXPENSE` 양식 유지 (이중 양식)
- **실제 구현**: `EXPENSE` 양식으로 단일화. `services/approval/prisma/seed.ts` 에 EXPENSE_CLAIM 없음
- **결정 근거**: 사용자 메모리 노트(2026-05-11) "경비정산도 EXPENSE 양식으로 일원화. EXPENSE_CLAIM 폐기"
- **증거 위치**:
  - `services/expense/src/infrastructure/approval-client.ts:41-44` (EXPENSE 호출)
  - `services/approval/prisma/seed.ts` (EXPENSE_CLAIM 부재)
- **조치**: Design v0.4 §6 전면 재작성

#### G-2. RabbitMQ Subscriber → HTTP Webhook

- **Design 명세**: §5.5 `expense.approval-result-listener` AMQP 큐, `approval.document.{approved,rejected}` 이벤트 수신
- **실제 구현**: approval-service가 expense에 직접 HTTP 호출
  - `POST /internal/settlements/from-approval` (결재 완료/반려)
  - `POST /internal/settlements/from-payment` (재무 입금)
  - RabbitMQ event-publisher는 활동 로그 전용으로만 사용
- **결정 근거**: 2026-05-12 결재 후속 통합 PDCA 결정 (HTTP가 더 견고)
- **증거 위치**: `services/expense/src/api/routes/settlement.routes.ts:165-220`
- **조치**: Design v0.4 §5.5 + §2.3 dependencies + §2.1 component diagram 갱신

### 🟡 Medium 우선순위 (3건)

#### G-3. State Machine `APPROVED → PAID` 직접 전이

- Design §4.2 전이표에 없는 직접 전이 추가됨 (RECEIVED 단계 생략 가능)
- 재무 후속 통합 결정 반영. Design v0.4 §4 전이도 + 표 갱신 필요

#### G-4. `/admin/settlements` 엔드포인트 미구현

- Design §5.3 명시되었으나 실제 미구현 (Admin 전사 정산 감사 조회)
- 우선순위: 사용자 명시 요청 시에만 추가. 백로그로 보류 가능

#### G-5. 프론트엔드 EXPENSE_CLAIM 잔여 dead code (3개 파일)

- `apps/web/src/app/approval/new/page.tsx:126-131` (양식 dropdown filter)
- `apps/web/src/app/approval/[id]/page.tsx:73-74, 311` (분기 코드)
- `apps/web/src/app/approval/[id]/edit/page.tsx:290-291` (분기 코드)
- EXPENSE_CLAIM이 seed에 없으므로 무해하지만 혼란 유발. 정리 권장

### 🟢 Low 우선순위 (3건)

#### G-6. `/internal/expense/settlement-summary` 미구현

- Design §5.4 명시. 다른 서비스 재사용 용도였으나 실 사용처 발생 안 함
- 옵션: 삭제 (Design v0.4에서 제거) 또는 YAGNI 백로그

#### G-7. `ownsResource` 미들웨어 미구현

- Design §9.2 명시. 각 service에서 인라인 `WHERE userId=` 패턴으로 동등 구현
- 기능적 차이 없음. Design v0.4에서 "인라인 패턴" 으로 문서화 갱신 권장

#### G-8. ICardParser 인터페이스 → 함수형 구현

- Design §8 클래스 기반 인터페이스 → 실제는 함수형 (parse 함수 export)
- 기능적 차이 없음. Design v0.4 갱신 가능 (또는 무시)

---

## 4. Design 갱신 권장 사항 (v0.4)

다음 절을 우선 갱신 권장합니다:

| 절 | 변경 사항 |
|---|---|
| §2.1 Component Diagram | RabbitMQ 의존성 표시를 HTTP webhook 으로 |
| §2.3 Dependencies | `approval → expense` 통신 방식 AMQP → HTTP |
| §4 State Machine | `APPROVED → PAID` 직접 전이 추가 + 표 갱신 |
| **§5.5 RabbitMQ Subscriber** | **HTTP webhook (`/internal/settlements/from-approval`, `/from-payment`)** 으로 재작성 |
| **§6 Approval Template** | **EXPENSE_CLAIM 폐기, EXPENSE 양식 일원화. settlement.approvalDocumentId 는 EXPENSE + referenceType=EXPENSE_SETTLEMENT 로 구분** |
| §8 Card Parsers | 함수형 구현 표기 (선택) |
| §9.2 미들웨어 | `ownsResource` 인라인 패턴 명시 |
| §12.1 진입 작업 | EXPENSE_CLAIM seed 단계 제거 |

---

## 5. 권장 다음 단계

### 🥇 추천 경로: Design v0.4 갱신 → /pdca analyze 재실행 → /pdca report

**근거**: 현재 구현은 사용자 후속 의사결정을 정확히 반영. 코드 iteration 불필요. Design 만 갱신하면 Match Rate 95%+ 도달 예상.

```
Step 1. Design v0.4 작성 (§5.5, §6, §4, §2 갱신)
Step 2. /pdca analyze 경비정산-ERP통합 재실행 (Match Rate 재계산)
Step 3. (선택) Frontend EXPENSE_CLAIM dead code 3개 파일 정리
Step 4. /pdca report 경비정산-ERP통합 (>=95%)
```

### 🥈 대안 경로: iterate 단계 진입

코드 변경 필요 항목이 dead code 3개뿐이라 iterate Agent 호출은 과잉. 수동 정리 권장.

### 🥉 백로그 처리 (사용자 명시 요청 시)

- `/admin/settlements` 구현 (Admin 전사 정산 감사)
- `/internal/expense/settlement-summary` 구현 또는 Design에서 제거

---

## 6. 구현 증거 경로

| 항목 | 위치 |
|---|---|
| Prisma schema | `services/expense/prisma/schema.prisma` |
| Settlement service | `services/expense/src/application/settlement.service.ts` |
| Approval client (EXPENSE 일원화 증거) | `services/expense/src/infrastructure/approval-client.ts:41-44` |
| Approval seed (EXPENSE_CLAIM 부재) | `services/approval/prisma/seed.ts` |
| Webhook 라우트 (AMQP 대신) | `services/expense/src/api/routes/settlement.routes.ts:165-220` |
| Card parsers | `services/expense/src/infrastructure/parsers/{shinhan,hyundai,kb}.parser.ts` |
| Storage | `services/expense/src/infrastructure/storage.ts` |
| Frontend pages | `apps/web/src/app/expense/{dashboard,transactions,receipts,settlements,...}/` |
| Frontend dead code | `apps/web/src/app/approval/{new,[id],[id]/edit}/page.tsx` (EXPENSE_CLAIM 분기) |

---

## 7. Version History

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-05-15 | gap-detector Agent 1차 분석. Match Rate 88%. High Gap 2건 (Design §6 + §5.5 갱신 필요), Medium 3건, Low 3건. Design v0.4 갱신 권장 |
| 2.0 | 2026-05-15 | gap-detector Agent 2차 분석. Match Rate 96% (+8%p). Design v0.4 갱신 + frontend 마이그레이션 + 주석 정리로 High Gap 0건 + Medium Gap 0건 도달. Report 단계 진입 가능 |
| **3.0** | **2026-05-19** | **gap-detector Agent 3차 분석. Match Rate 98% (+2%p, v2 96% → v3). Design v0.5 갱신(카테고리 도메인 폐기 + SourceOwnership + contractId snapshot + link/unlink-approval webhook + 자동 제목 폐기 + 매뉴얼 v1.4) 모두 코드와 일치 확인. High/Medium Gap 0건, 잔여 Low Gap 2건(G-4, G-6 백로그) + G-9(categoryCode legacy 잔재, 정상). Report 진입 가능** |

---

## 8. v2 분석 (2026-05-15) — Design v0.4 갱신 후

### 8.1 요약

| 항목 | 1차 (v0.3 vs 구현) | 2차 (v0.4 vs 구현) | 변화 |
|---|:---:|:---:|:---:|
| Match Rate | **88%** | **96%** | +8%p |
| High Gap | 2건 | **0건** | -2 |
| Medium Gap | 3건 | **0건** | -3 |
| Low Gap | 3건 | 2건 (백로그) | -1 |
| 통과 카테고리 | 6/9 | **9/9** | +3 |

### 8.2 카테고리별 Match 비교

| 카테고리 | 1차 | 2차 | 비고 |
|---|:---:|:---:|---|
| Data Model | 100% | 100% | 변경 없음 |
| State Machine | 95% | **100%** | §4 v0.4: `APPROVED→PAID` 직접 전이 + `PAID→APPROVED` 회귀 명세화 |
| API Endpoints | 85% | 88% | 백로그 2건 분류 |
| Approval Template | 60% | **100%** | §6 v0.4: EXPENSE 일원화 + referenceType 분기 명세 |
| UI Pages | 95% | 95% | 변경 없음 |
| Card Parsers | 100% | 100% | 변경 없음 |
| File Storage | 100% | 100% | 변경 없음 |
| Permissions | 85% | **98%** | §9.2 v0.4: 인라인 패턴 명시 |
| Webhook 통신 | 75% | **100%** | §5.5 v0.4: HTTP webhook 3종 명세 |

### 8.3 v0.4 갱신 + 정리로 해결된 항목

| ID | 1차 Gap | 해결 방식 |
|---|---|---|
| G-1 (High) | Approval Template — EXPENSE_CLAIM 폐기 미반영 | Design v0.4 §6 전면 재작성 + approval-client.ts 일치 확인 ✅ |
| G-2 (High) | RabbitMQ → HTTP Webhook | Design v0.4 §5.5/§2.1/§2.3 갱신 + settlement.routes.ts:164-220 일치 ✅ |
| G-3 (Medium) | State Machine `APPROVED→PAID` 직접 전이 | Design v0.4 §4 전이표 갱신 + TRANSITIONS 객체 일치 ✅ |
| G-5 (Medium) | Frontend EXPENSE_CLAIM dead code | `referenceType="EXPENSE_SETTLEMENT"` 분기로 마이그레이션 (회귀 fix 동반) ✅ |
| G-7 (Low) | `ownsResource` 미들웨어 미구현 | Design v0.4 §9.2 인라인 패턴으로 실제 구현 반영 ✅ |

### 8.4 잔여 백로그 (Gap 미적용)

| ID | 항목 | 영향 | 조치 |
|---|---|:--:|---|
| G-4 | `/admin/settlements` 미구현 | Low | 사용자 명시 요청 시 진행 |
| G-6 | `/internal/expense/settlement-summary` 미구현 | Low | v0.5에서 §5.4 제거 또는 백로그 |

### 8.5 다음 단계

**Match Rate 96% ≥ 90% 도달 → Report 진입 가능**

사용자 메모리 정책 ([feedback_report_timing](memory/feedback_report_timing.md)): "기능 안정화 후 작성. check/act 머무는 건 의도적"

- **옵션 A**: 즉시 `/pdca report 경비정산-ERP통합` 실행 (기능 5/7~5/12 완료, 안정 가동 중)
- **옵션 B**: 운영 사용 사례 누적 후 진행 (check 단계 유지)

---

## 9. v3 분석 (2026-05-19) — Design v0.5 갱신 후

### 9.1 요약

| 항목 | 2차 (v0.4 vs 구현) | 3차 (v0.5 vs 구현) | 변화 |
|---|:---:|:---:|:---:|
| Match Rate | **96%** | **98%** | +2%p |
| High Gap | 0건 | **0건** | - |
| Medium Gap | 0건 | **0건** | - |
| Low Gap | 2건 (백로그) | 2건 (백로그) + 1건 (legacy 정상) | +1 (정상 잔재) |
| 통과 카테고리 | 9/9 | **9/9** | - |
| Report 진입 | 가능 | **가능** | - |

### 9.2 카테고리별 Match 비교

| 카테고리 | v1 | v2 | **v3** | 비고 |
|---|:---:|:---:|:---:|---|
| Data Model | 100% | 100% | **100%** | v0.5 schema 완전 일치 — SourceOwnership enum, contractId/contractNumber/contractName/detail, periodStart/periodEnd nullable, unique 제거, categoryCode/categoryStats legacy 잔재 모두 반영 |
| State Machine | 95% | 100% | **100%** | 변경 없음 — TRANSITIONS (settlement.service.ts:17-24) + clearPaymentSync 일치 |
| API Endpoints | 85% | 88% | **96%** | `/categories` 폐기 명시 + `POST /settlements/empty` + `PATCH /settlements/transactions/:txId` + `PATCH /settlements/:id/title` 모두 명세-구현 일치 |
| Approval Template | 60% | 100% | **100%** | 변경 없음 — EXPENSE 단일화 + referenceType 분기 |
| UI Pages | 95% | 95% | **100%** | `/expense/categories` 폐기 명시 + 폴더 부재 일치, 매뉴얼 v1.4 일치, 정산 상세 컬럼 정정 |
| Card Parsers | 100% | 100% | **100%** | 변경 없음 |
| File Storage | 100% | 100% | **100%** | 변경 없음 |
| Permissions | 85% | 98% | **98%** | 변경 없음 (인라인 패턴 유지) |
| Webhook (HTTP) | 75% | 100% | **100%** | link-approval / unlink-approval / from-approval / from-payment(POST·DELETE) 5종 모두 일치 (settlement.routes.ts:135-205) |

### 9.3 v0.5 갱신으로 해결된 항목 (v2 잠재 Gap)

| 항목 | 해결 방식 |
|---|---|
| Data Model 불일치 — categoryId 코드/스키마 vs Design 미반영 | Design v0.5 §3에 `ExpenseCategory` 폐기 + `contractId`/`contractNumber`/`contractName`/`detail` snapshot 반영 |
| SourceOwnership enum 미문서화 | Design v0.5 §3 enum 신규 + §6.3 ownership 분기표 추가 |
| `/settlements` legacy + `/submit` 라우트 명세 vs 코드 폐기 | Design v0.5 §5 폐기 명시 + 신규 라우트 (empty/transactions/title) 명세 추가 |
| link-approval / unlink-approval webhook 미문서화 (v1.6.4) | Design v0.5 §5.5.0 신규 절 추가 + §5.5.4 통신 방향 정리 |
| 자동 제목 + periodStart/periodEnd unique 제약 폐기 | Design v0.5 §3 nullable + unique 제거 + O3 해결됨 표기 |

### 9.4 잔여 Gap (v3)

| ID | 항목 | 영향 | 조치 |
|---|---|:--:|---|
| G-4 | `/admin/settlements` 미구현 | Low | Design v0.5 §5.3 백로그 명시. 사용자 명시 요청 시 진행 |
| G-6 | `/internal/expense/settlement-summary` 미구현 | Low | Design v0.5 §5.4 백로그 명시. 실 사용처 발생 시 추가 |
| G-9 | `ExpenseSettlement.categoryCode` / `categoryStats` legacy 잔재 | Low | Design v0.5 §3 legacy 통계용으로 잔존 명시 — **정상**. 추후 통계 마이그레이션 시 제거 가능 |

신규 High/Medium Gap **0건**.

### 9.5 다음 단계

**Match Rate 98% ≥ 90% → Report 진입 가능**

v2 (96%) 대비 +2%p 회복. v3는 메모리 정책에 따라 사용자가 안정화 후 결정:
- **옵션 A**: 즉시 `/pdca report 경비정산-ERP통합` 실행 (코드 안정 가동, ecount 마이그도 완료)
- **옵션 B**: 추가 운영 사례 누적 후 진행 (check 단계 유지)
- **백로그**: G-4 / G-6는 사용자 명시 요청 시에만 진행 (Design에 백로그로 명시됨)

