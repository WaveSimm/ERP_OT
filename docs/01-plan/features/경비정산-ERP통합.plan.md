# 경비정산-ERP통합 Plan

> **Summary**: 별도 프로젝트(`E:/claude/Expense/`)에서 단일 사용자 모드로 운영 중인 개인경비정산 V1을 ERP로 흡수하여 멀티 사용자·결재 연동 V2로 통합 재설계
>
> **Project**: erp-ot-platform
> **Version**: V2
> **Author**: 오션테크 (yunsim@gmail.com) + Claude
> **Date**: 2026-05-08
> **Status**: Draft
> **Related**:
> - V1 출처: `E:/claude/Expense/` (별도 git repo, single-user)
> - 의존: `services/approval` (지출결의서 결재 양식 EXPENSE 활용), `services/ocr` (영수증 OCR), `services/auth` (인증·부서·결재라인)

---

## 1. Overview

### 1.1 Purpose

V1(분리 운영)은 단일 사용자 시범으로 워크플로 검증 완료. 이제 **ERP 본체에 흡수**해
- 멀티 사용자(전 임직원) 지원
- **정산 → 지출결의서 결재**까지 한 흐름으로 자동 상신
- ERP 기존 자산(인증·OCR·첨부 저장·통합 검색·결재라인) 재사용
- 내대시보드에 "💳 경비" 카드로 통합 진입점 제공

### 1.2 Background

V1 분리 결정(2026-05-06) 사유: 개인 데이터 격리 + 빠른 검증.
실사용 검증 결과 **전표 결재까지 연동되어야 효과가 크다**는 판단으로 V2 통합 결정(2026-05-08).

V1에서 검증된 자산:
- 다중 카드 명세서(신한·현대·국민) 파싱 (`xlsx` 라이브러리)
- 영수증 OCR (CLOVA OCR 사용 — ERP의 ocr-service와 동일)
- 거래↔영수증 1:1 매칭 알고리즘
- 카테고리별 정산 + 회사 Excel 양식 출력 (`exceljs`)
- 도메인 모델 8개 (Source/Statement/Transaction/Receipt/Settlement 등)

### 1.3 Related Documents

- V1 Plan: `E:/claude/Expense/docs/01-plan/features/개인경비정산.plan.md`
- V1 Design: `E:/claude/Expense/docs/02-design/features/개인경비정산.design.md`
- V1 stub (ERP 측): `docs/01-plan/features/개인경비정산.plan.md`
- ERP 결재 구조: `docs/02-design/features/구매-재고-결재.design.md`

---

## 2. Scope

### 2.1 In Scope

- [ ] **신규 서비스** `services/expense/` (Fastify + Prisma + TS, 포트 3008 예정)
- [ ] **Prisma 스키마 이식**: V1의 8개 모델 + enum 5개 → ERP `expense` 스키마
- [ ] **userId → auth_users.id FK** 전환 (single-user → 멀티유저)
- [ ] **카드 명세서 import** (신한·현대·국민 + 수동 입력)
- [ ] **영수증 OCR**: 기존 `ocr-service` 호출 (CLOVA OCR 흐름 재사용)
- [ ] **거래↔영수증 매칭** UI + 자동 매칭 알고리즘 이식
- [ ] **카테고리 마스터** (전사 공유 vs 개인 공유 결정 필요 — Open Q1)
- [ ] **정산 묶음(Settlement)** 생성·수정·완료
- [ ] **정산 완료 → 결재 자동 상신**: approval-service의 `EXPENSE` 템플릿으로 문서 생성
- [ ] **결재 결과 sync**: 승인/반려 시 settlement 상태 업데이트 (webhook 또는 polling)
- [ ] **ERP UI 신규 작성**: `apps/web/src/app/expense/` (V1 UI 무시, ERP 컨벤션 따름)
- [ ] **내대시보드 카드**: 미정산 N건 / 결재 대기 N건 요약
- [ ] **첨부 저장**: `expense_uploads` Docker volume (또는 `auth_uploads` 통합)

### 2.2 Out of Scope

- V1 데이터 마이그레이션 (사용자 결정: 처음부터 새로)
- V1 UI 코드 재사용 (사용자 결정: ERP 컨벤션으로 신규 작성)
- 외부 영수증 자동 수집(이메일·앱 연동) — V3 후보
- 다국가/다통화 — KRW 단일 유지
- 회계 시스템(이카운트) 자동 전송 — 별도 PDCA
- 모바일 전용 UI — 반응형으로 충분, 별도 앱 없음

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 카드 명세서(xlsx) 업로드 → 자동 파싱·중복 제거 | High | Pending |
| FR-02 | 수동 거래 추가 (현금·기타) | High | Pending |
| FR-03 | 영수증 사진 업로드 → ocr-service로 텍스트·금액·날짜·가맹점명 추출 | High | Pending |
| FR-04 | 거래↔영수증 자동 매칭 후보 제안 (날짜 ±2일, 금액 일치, 가맹점명 유사도) | High | Pending |
| FR-05 | 사용자 confirm 매칭 / 수동 매칭 / 매칭 해제 | High | Pending |
| FR-06 | 카테고리 분류 (식대·교통비·접대·소모품 등) | High | Pending |
| FR-07 | 정산 묶음 생성: 기간·카테고리 기준 transaction 선택 | High | Pending |
| FR-08 | 정산 묶음 → **회사 양식 Excel 출력** (V1과 동일) | High | Pending |
| FR-09 | **정산 완료 → 지출결의서 자동 상신** (approval EXPENSE 템플릿) | High | Pending |
| FR-10 | 결재 진행 상태 sync: 결재 승인/반려 시 settlement.status 갱신 | High | Pending |
| FR-11 | 내대시보드 카드: 미정산 transaction 수 + 진행 중 결재 수 | Medium | Pending |
| FR-12 | 통합 검색에 영수증 텍스트(OCR 결과) 포함 | Medium | Pending |
| FR-13 | 카테고리 마스터 관리 (admin/CRUD) | Medium | Pending |
| FR-14 | 거래·정산 이력 활동 로그(activity) 발행 | Medium | Pending |
| FR-15 | 권한: 본인 데이터만 조회·수정 (admin은 전사 조회 가능) | High | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | 명세서 100건 import < 3초 | k6 load test |
| Performance | 영수증 OCR 단일 처리 < 5초 (ocr-service SLA 따름) | API timing |
| Security | 본인 데이터 외 접근 금지 (RLS·서비스 레벨 권한) | gap-detector + 코드 리뷰 |
| Security | OCR 원본 파일은 첨부 저장 정책 따름 (LocalFsStorage) | 보안 일괄패치 PDCA Layer 3 준수 |
| Usability | 페이지 진입 시 첫 화면 로드 < 1초 | Chrome devtools |
| Reliability | 카드 명세서 파싱 실패 시 명확 에러 + 무손실 (트랜잭션) | 의도적 실패 케이스 테스트 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] 새 서비스 `services/expense/` 가동 (`/health` 200)
- [ ] Prisma migration 적용, ERP postgres에 `expense` 스키마 생성
- [ ] 카드 import → 매칭 → 정산 → 결재 상신까지 end-to-end 동작
- [ ] approval에서 결재 승인 → settlement.status = APPROVED 자동 갱신
- [ ] 내대시보드 카드 정상 노출
- [ ] gap-detector Match Rate ≥ 90%
- [ ] 활동 로그(activity) 누락 없음
- [ ] 회사 Excel 양식과 V1 결과물 동등 (회귀 시각 비교)

### 4.2 Quality Criteria

- [ ] TypeScript strict 컴파일 통과
- [ ] Lint 0 error
- [ ] 통합 검색에 영수증 텍스트 색인됨
- [ ] 첨부 파일 최대 50MB 정책 준수

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| approval ↔ expense **순환 의존** (expense가 approval 호출 + approval이 expense 데이터 조회) | High | Medium | 한 방향만 허용 — expense → approval 호출만. approval은 documentBody의 expenseSettlementId만 참조 (HTTP 호출 X) |
| **결재 상태 동기화 지연** (polling 간격 vs 사용자 기대) | Medium | High | RabbitMQ 이벤트 발행 (approval.document.{approved/rejected}) → expense가 구독 |
| 카테고리 마스터 **전사 공유 vs 개인 공유** 미결정 | Medium | Medium | Open Q1로 초기 결정 — Plan 승인 전 확정 |
| 카드 명세서 포맷 변경 (은행이 양식 바꿈) | Medium | Low | Source별 어댑터 패턴 + 테스트 fixture로 회귀 보장 |
| OCR 인식률 낮음 (영수증 이미지 품질) | Medium | High | 매칭 confirm UI에서 사용자가 보정 가능 (V1 검증된 흐름) |
| **첨부 GC**: 정산 삭제 시 영수증 orphan | Low | Medium | Settlement 삭제 시 receipts 해제 (transaction unmatch) — 파일 자체는 별도 cron 정리 |
| **Excel 양식 변경**: 회사 양식이 바뀌면 출력 깨짐 | Medium | Low | 양식 파일은 templates/expense/ 별도 보관 + 버전 관리 |
| **단일 카드 다중 사용자**: 법인카드 공유 시 충돌 | Low | Low | V2 범위 외. V3에서 카드 sharing 정책 |

---

## 6. Architecture Considerations

### 6.1 Project Level Selection

| Level | Characteristics | Recommended For | Selected |
|-------|-----------------|-----------------|:--------:|
| Starter | Simple structure | Static sites | ☐ |
| Dynamic | Feature-based modules | Web apps with backend | ☐ |
| **Enterprise** | Strict layer separation, microservice | High-traffic systems, complex architectures | ☑ |

→ **Enterprise**: ERP 본체와 동일 레벨. 신규 서비스 1개 추가, 기존 microservice 패턴 따름.

### 6.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| 서비스 분리 | services/expense 신규 / services/approval에 흡수 / services/auth에 흡수 | **services/expense 신규** | 도메인 응집도 ↑, V1 코드 이식 용이, 다른 서비스 영향 없음 |
| 포트 | 3008 (다음 가용) | 3008 | 3000~3007 점유, 3008 사용 |
| DB schema | expense (전용 스키마) | expense | 다른 서비스와 격리, 권한 관리 단순 |
| 결재 연동 | HTTP 호출 / RabbitMQ 이벤트 / DB 직접 | **HTTP 호출(상신) + RabbitMQ 구독(결과 sync)** | 상신은 즉시성, 결과는 비동기로 충분 |
| 첨부 저장 | LocalFsStorage(공유) / 신규 expense_uploads volume | **신규 `expense_uploads` volume** | 격리 + Synology NAS 통합 시점에 일괄 이전 |
| OCR | 자체 호출 / ocr-service 재사용 | **ocr-service 재사용** | CLOVA OCR 어댑터 이미 검증됨 |
| 상태머신 | settlement state | DRAFT → SUBMITTED → APPROVED / REJECTED | approval과 1:1 매핑 |

### 6.3 Clean Architecture Approach

```
services/expense/
├── src/
│   ├── api/
│   │   ├── routes/         (transaction, receipt, settlement, source, statement, category, match)
│   │   └── dtos/           (Zod schemas)
│   ├── application/        (각 도메인 service)
│   ├── domain/             (entity + repository interface)
│   ├── infrastructure/
│   │   ├── repositories/   (Prisma 구현)
│   │   ├── ocr-client.ts   (ocr-service HTTP)
│   │   ├── approval-client.ts (approval-service HTTP)
│   │   ├── auth-client.ts  (auth 검증 / user 조회)
│   │   └── card-parsers/   (신한·현대·국민 어댑터)
│   ├── shared/
│   └── index.ts
├── prisma/
│   ├── schema.prisma       (8 models, 5 enums)
│   └── migrations/
├── Dockerfile
└── package.json

apps/web/src/app/expense/
├── page.tsx                (대시보드: 카테고리별 요약)
├── transactions/page.tsx   (거래 리스트)
├── receipts/page.tsx       (영수증 + OCR 진행상태)
├── matches/page.tsx        (매칭 confirm)
├── settlements/page.tsx    (정산 묶음 리스트)
└── settlements/[id]/page.tsx (정산 상세 + 결재 상신)
```

---

## 7. Convention Prerequisites

### 7.1 Existing Project Conventions

- [x] `CLAUDE.md` — Enterprise 모노레포 컨벤션 보유
- [x] `services/CLAUDE.md` — 백엔드 4계층 구조
- [x] `apps/CLAUDE.md` — 프론트 3단계 응답형 nav, DateInput·TimeInput·datetime helper 강제
- [x] ESLint·Prettier·TS strict 설정 보유

### 7.2 Conventions to Define/Verify

| Category | Current State | To Define | Priority |
|----------|---------------|-----------|:--------:|
| Naming | exists | expense 도메인 필드명 정합화 (V1과 약간 다른 부분 통일) | Medium |
| Folder structure | exists | 위 6.3 따름 | High |
| Activity log | exists | `expense.transaction.{created,updated,deleted}`, `expense.settlement.{submitted,approved,rejected}` 액션 코드 정의 | High |
| 결재 양식 mapping | exists (EXPENSE) | settlement → documentBody JSON 구조 정의 | High |

### 7.3 Environment Variables Needed

| Variable | Purpose | Scope | To Be Created |
|----------|---------|-------|:-------------:|
| `EXPENSE_SERVICE_PORT` | 서비스 포트 (3008) | Server | ☑ |
| `OCR_SERVICE_URL` | OCR 호출 (이미 있음) | Server | ☐ (재사용) |
| `APPROVAL_SERVICE_URL` | 결재 상신 | Server | ☑ |
| `AUTH_SERVICE_URL` | 사용자/부서 검증 | Server | ☐ (재사용) |
| `EXPENSE_ATTACHMENT_DIR` | 영수증 저장 (`/app/uploads/expense`) | Server | ☑ |
| `EXPENSE_ATTACHMENT_MAX_SIZE` | 단일 파일 최대 (default 10MB) | Server | ☑ |
| `RABBITMQ_URL` | 결재 결과 구독 | Server | ☐ (재사용) |
| `INTERNAL_API_TOKEN` | 서비스 간 호출 | Server | ☐ (재사용) |

### 7.4 Pipeline Integration

본 PDCA는 9-phase pipeline의 Phase 4 (API) + Phase 6 (UI Integration) 영역. Phase 1·2 schema·convention은 ERP 본체에서 이미 확정.

---

## 8. Phase 분해 (Phasing)

| Phase | 작업 | 산출물 | 추정 |
|-------|------|--------|------|
| **P1** | `services/expense/` 부트스트랩 + Prisma schema 이식 + Docker 통합 | `services/expense/`, prisma migration, docker-compose 추가 | 1일 |
| **P2** | application service + routes 이식 (UI 무관, V1 비즈니스 로직) | 9개 routes, 8개 service | 2~3일 |
| **P3** | apps/web/src/app/expense/ UI 신규 작성 (ERP 컨벤션) | 6개 페이지 + 공용 컴포넌트 | 3~5일 |
| **P4** | approval 연동 (settlement → 지출결의서 자동 상신 + 결과 sync) | approval-client, RabbitMQ subscriber | 1~2일 |
| **P5** | OCR 연동 (영수증 → ocr-service) | ocr-client + 매칭 알고리즘 | 0.5~1일 |
| **P6** | 데이터 정리 + 옛 프로젝트(E:/claude/Expense/) 아카이브 + 매뉴얼 | 매뉴얼, archive note | 0.5일 |

**총 추정**: 8~13일 (1~3주). 큰 작업이므로 P1·P2·P3을 우선 마치고 P4·P5에서 통합 검증.

---

## 9. Decisions Made (2026-05-08 사용자 확정)

### Q1. 카테고리 마스터 — **C 하이브리드**
- 전사 표준 (admin CRUD) + 개인 커스텀 동시 지원
- 표준 카테고리(약 10종): 식대 / 교통비 / 접대 / 출장경비 / 소모품 / 통신비 / 도서 / 교육 / 사무용품 / 기타
- 개인 카테고리는 본인 정산용. 회계 매핑은 admin이 표준 카테고리에만 적용

### Q2. 카드 import 방식 — **자동(개인카드) + 수동(공용·현금)**
- 개인 카드(1:1) → xlsx 명세서 자동 import (신한·현대·국민)
- 공용 법인카드 + 현금 → **영수증 단위 수동 입력** (가맹점·금액·날짜 직접 입력 + 영수증 첨부 + OCR 보조)
- 공용카드 다중 사용자 모델은 V3로 미루기

### Q3. 결재 흐름 + 6단계 상태머신
```
DRAFT (작성)
  → SUBMITTED (결재 진행)
    → APPROVED (결재 완료, 재무팀 자동 이관)
      → RECEIVED (재무팀 접수)
        → PAID (재무팀 입금 완료, 신청자 알림)
  └→ REJECTED (반려)
```
- 결재라인: **기존 ERP 결재 양식 패턴**(EXPENSE 양식의 `default_approval_line_rule`) + 사용자 customize
- 재무팀 이관: post_approval_action `FINANCE_FORWARD` (이미 정의됨) 활용
- 신청자는 결재 단계 + 재무팀 처리 단계 + 입금 여부를 한 화면에서 추적

### Q4. 자동 결재 — **A 모두 결재 의무 (V2)**
- 1원이라도 결재 거침. 단순·추적성·감사 유리
- 자동 결재는 V3 미루기

### Q5. 첨부 저장 — **별도 `expense_uploads` volume + 결재양식 분리**
- 첨부: `expense_uploads:/app/uploads/expense` (도메인 격리)
- 결재 양식: **신규 EXPENSE_CLAIM (경비정산) 추가** + 기존 EXPENSE (지출결의서) 그대로 유지
  - 경비정산 = 직원 → 회사 환급 청구 (expense-service 자동 상신 전용)
  - 지출결의서 = 회사 → 외부 지출 (거래처·운영비·외주 등, 수기 작성 그대로)
- 수기 작성 차단: **EXPENSE_CLAIM 양식만** approval UI에서 hide. EXPENSE는 자유 작성 유지
- 단일 입력 경로(EXPENSE_CLAIM) = 정산 데이터 정합성 ↑, 다른 지출(EXPENSE)은 자유

### 추가 결정 (운영 단계 반영)
- **기존 EXPENSE 8건 = 테스트 데이터** → 삭제 (운영 데이터 아님)
- **운영 단계**: AS관리만 production. 그 외 기능은 pre-prod → drop & rebuild 자유
- **V1 데이터 마이그**: 처음부터 새로

---

## 10. 개발 순서 (수평형 — 백엔드 우선)

| Phase | 작업 | 산출물 | 검증 | 일수 |
|-------|------|--------|------|------|
| **P1** | 서비스 부트스트랩 | services/expense, Prisma migration, docker-compose, expense_uploads volume | `/health` 200 | 1 |
| **P2** | 도메인 코어 | Source / Statement / Transaction / Category, card-parsers (xlsx), 활동로그 | curl로 거래 CRUD + 명세서 import | 2~3 |
| **P3** | OCR + 매칭 | Receipt + ocr-client + 매칭 알고리즘 + Match | 영수증 1개 → OCR 결과 + 매칭 후보 | 1~2 |
| **P4** | 정산 + 결재 통합 (핵심) | Settlement + Excel 출력 + EXPENSE 양식 재정의 + approval-client + RabbitMQ subscriber + 6단계 상태머신 + 수기작성 차단 | 정산 작성 → 상신 → 결재자 승인 → status=APPROVED 자동 갱신 | 2~3 |
| **P5** | 재무팀 처리 | 재무팀 큐 + RECEIVED/PAID 액션 + 신청자 알림 | 재무팀 계정 접수·입금 → 신청자 화면 "💰 입금 완료" | 1 |
| **P6** | 프론트엔드 UI | apps/web/src/app/expense/ 8개 페이지 + 공용 컴포넌트 | end-to-end 시연 | 3~5 |
| **P7** | 통합·정리 | 내대시보드 카드, NAV 추가, 권한 체크, V1 archive, 매뉴얼, gap 분석 | gap Match Rate ≥ 90% | 0.5~1 |

**총 11~16일 (약 2~3주)**.

각 phase 끝에 사용자 검증 1회. P4 끝에 핵심 시연 가능 (백엔드만으로 결재 통합 검증).

---

---

## 10. Next Steps

1. [ ] 본 Plan 검토·승인
2. [ ] Open Questions Q1~Q5 답변 확정 (사용자 결정 필요)
3. [ ] Design 문서 작성 (`/pdca design 경비정산-ERP통합`) — 스키마 세부, API 명세, UI 와이어프레임
4. [ ] approval-line 마스터에 "지출결의서" 라인 등록 (선결제)
5. [ ] P1 부터 구현 시작

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-08 | 초기 Draft. V1(분리)→V2(통합) 전환 결정 반영. Open Q 5건 식별 | yunsim + Claude |
| 1.0 | 2026-05-08 | Open Q 5건 모두 답변 확정 (하이브리드 카테고리, 자동+수동 import, 6단계 상태머신, 모두결재 의무, 별도 볼륨+양식통합). 운영 단계 반영(AS관리만 prod, 기존 8건 삭제). 개발 순서(수평형 P1~P7) 확정 | yunsim + Claude |
| 1.1 | 2026-05-08 | **개념 분리**: 경비정산 ≠ 지출결의서. Q5 갱신 — 신규 EXPENSE_CLAIM 양식 + 기존 EXPENSE 그대로. 차단은 EXPENSE_CLAIM에만 | yunsim + Claude |
