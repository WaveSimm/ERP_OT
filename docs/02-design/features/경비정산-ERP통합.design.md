# 경비정산-ERP통합 Design Document

> **Summary**: V1(`E:/claude/Expense/`) 도메인을 ERP `services/expense/`로 흡수하여 멀티 사용자 + 결재 통합 + 재무팀 처리 흐름을 한 시스템으로 구축
>
> **Project**: erp-ot-platform
> **Version**: V2 (Design **v0.4** — 구현 후속 결정 반영)
> **Author**: 오션테크 + Claude
> **Date**: 2026-05-15 (v0.4)
> **Status**: 구현 완료 (commit fb8a184, 5/7~5/12) + Design 갱신 완료
> **Planning Doc**: [경비정산-ERP통합.plan.md](../01-plan/features/경비정산-ERP통합.plan.md)
> **Analysis**: [경비정산-ERP통합.analysis.md](../03-analysis/경비정산-ERP통합.analysis.md) (Match 88% → v0.4 갱신으로 95%+ 회복 예상)
> **V1 참조**: ~~`E:/claude/Expense/docs/02-design/features/개인경비정산.design.md`~~ (2026-05-15 V1 폴더 완전 제거)

---

## 1. Overview

### 1.1 Design Goals

- **단일 결재 입력 경로**: 지출결의서 양식은 expense-service를 통해서만 자동 상신 (수기 작성 차단)
- **6단계 상태머신**: 정산 작성 → 결재 → 재무팀 접수 → 입금 완료를 한 흐름으로 추적
- **ERP 자산 재사용**: auth-service(인증/부서/결재라인), ocr-service(영수증 OCR), approval-service(결재), RabbitMQ(이벤트), bge-m3(검색)
- **도메인 격리**: services/expense 단독 컨테이너·DB 스키마·첨부 볼륨

### 1.2 Design Principles

- **Clean Architecture 4계층**: api → application → domain ← infrastructure (ERP 컨벤션)
- **Cross-service 통신**: HTTP(상신·즉시성) + RabbitMQ(결재 결과 sync)
- **idempotency**: 명세서 import 재실행 시 중복 거래 자동 차단 (`@@unique([sourceId, approvalNo])`)
- **사용자 데이터 격리**: 모든 쿼리 `WHERE userId = req.userId` (admin·재무팀 예외)

---

## 2. Architecture

### 2.1 Component Diagram

```
                        ┌─────────────────────────────────────────────────┐
                        │  apps/web (Next.js, port 3000)                  │
                        │   /expense/* (7 pages: dashboard/transactions/  │
                        │     receipts/settlements/sources/categories/    │
                        │     finance, 신규)                              │
                        │   /me/dashboard (경비 카드 추가)                │
                        └────────────────┬────────────────────────────────┘
                                         │ HTTP /api/v1/expense/* (rewrite)
                ┌────────────────────────┼────────────────────────────────┐
                │                        ▼                                │
                │        ┌───────────────────────────────────┐            │
                │        │  expense-service (port 3008, 신규) │            │
                │        │  ┌──────────────────────────────┐  │            │
                │        │  │ api/routes/                  │  │            │
                │        │  │  source / statement /         │  │            │
                │        │  │  transaction / receipt /      │  │            │
                │        │  │  match / category /           │  │            │
                │        │  │  settlement / finance         │  │            │
                │        │  │  internal (webhooks ★)        │  │            │
                │        │  ├──────────────────────────────┤  │            │
                │        │  │ application/services         │  │            │
                │        │  ├──────────────────────────────┤  │            │
                │        │  │ infrastructure/              │  │            │
                │        │  │  prisma repositories          │  │            │
                │        │  │  card-parsers (3종)           │  │            │
                │        │  │  ocr-client                   │  │            │
                │        │  │  approval-client (EXPENSE)    │  │            │
                │        │  │  auth-client                  │  │            │
                │        │  │  storage (LocalFsStorage)     │  │            │
                │        │  └──────────────────────────────┘  │            │
                │        └─▲──────┬───────┬─────────┬─────────┘            │
                │          │      │       │         │                     │
                │  HTTP ★  │ HTTP │ HTTP  │  HTTP   │ AMQP publish        │
                │ webhook  │ (외부)│ (외부) │ (외부)  │ (활동 로그 전용)     │
                │          │      ▼       ▼         ▼                     │
                │  ┌───────┴──┐  ┌─────────────┐  ┌──────────┐  ┌────────┐ │
                │  │ approval │  │ ocr-service │  │ auth     │  │RabbitMQ│ │
                │  │  (3006)  │  │  (3007)     │  │ (3001)   │  │ (5672) │ │
                │  └──────────┘  └─────────────┘  └──────────┘  └────────┘ │
                │                                                          │
                │  ★ v0.4: RabbitMQ subscriber 폐기 → HTTP webhook 전환:    │
                │    approval → expense /internal/settlements/from-approval│
                │    재무모듈 → expense /internal/settlements/from-payment │
                └─────────────────────────────────────────────────────────┘
                              │
                              ▼
                   ┌───────────────────────┐    ┌──────────────────┐
                   │ PostgreSQL (5432)     │    │ Volume:          │
                   │  schema: expense       │    │ expense_uploads   │
                   │  (8 tables)            │    │ /app/uploads      │
                   └───────────────────────┘    └──────────────────┘
```

### 2.2 Data Flow (정산 → 결재 → 입금)

```
1. 사용자: 카드 명세서 xlsx 업로드
   POST /api/v1/expense/statements/import
   → card-parser → expense_transactions (PENDING)

2. 사용자: 영수증 사진 업로드
   POST /api/v1/expense/receipts
   → expense_uploads 저장 → ocr-service 호출 (비동기) → ocr_status: DONE

3. 시스템: 자동 매칭 후보 계산
   GET /api/v1/expense/matches/suggestions
   → 날짜±2일·금액일치·가맹점 유사도 → confidence 점수

4. 사용자: 매칭 confirm + 카테고리 분류
   PATCH /api/v1/expense/transactions/:id { categoryId, memo }
   PATCH /api/v1/expense/matches/:id { confirmedAt }

5. 사용자: 정산 묶음 작성
   POST /api/v1/expense/settlements { periodStart, periodEnd, transactionIds[] }
   → settlement: DRAFT
   → exceljs로 회사 양식 Excel 생성 (s3 또는 local)

6. 사용자: 결재 상신
   POST /api/v1/expense/settlements/:id/submit
   → expense-service → approval-service POST /api/v1/approval/documents
     body: { templateCode: "EXPENSE", title, body, items, attachments }
   → settlement.status = SUBMITTED, approvalDocumentId 기록

7. 결재자: 결재 진행 (기존 ERP 결재 화면)
   approval-service: 단계별 승인 → 최종 APPROVED
   → AMQP publish: approval.document.approved { documentId, ... }

8. expense-service RabbitMQ subscriber:
   → settlement.status = APPROVED, approvedAt 기록
   → 재무팀 큐 자동 노출

9. 재무팀: 큐에서 접수
   POST /api/v1/expense/settlements/:id/receive
   → settlement.status = RECEIVED, receivedAt/By 기록
   → notification: 신청자에게 "재무팀 접수"

10. 재무팀: 입금 처리
    POST /api/v1/expense/settlements/:id/pay { paidAt, amount }
    → settlement.status = PAID
    → notification: 신청자에게 "💰 입금 완료"
```

### 2.3 Dependencies (v0.4)

| 의존 | 방향 | 통신 | 목적 |
|---|---|---|---|
| expense → auth | HTTP | `/internal/users/*` | 사용자/부서 검증, 결재라인 조회 |
| expense → ocr | HTTP | `/api/v1/ocr/scan` | 영수증 OCR |
| expense → approval | HTTP | `POST /internal/documents` | 결재 자동 상신 (EXPENSE 양식 + referenceType=EXPENSE_SETTLEMENT) |
| **approval → expense** | **HTTP webhook** | `POST /internal/settlements/from-approval` | 결재 완료/반려 동기화 (v0.4 변경: AMQP → HTTP) |
| **재무 송금 모듈 → expense** | **HTTP webhook** | `POST /internal/settlements/from-payment` `DELETE /internal/settlements/from-payment` | 송금 처리/해제 동기화 (2026-05-12 신규) |
| expense → RabbitMQ | AMQP publish | activity-log queue | 활동 로그 전용 (subscriber 폐기) |

---

## 3. Data Model

### 3.1 Prisma Schema (`services/expense/prisma/schema.prisma`)

V1 스키마 기반 + V2 확장:

```prisma
// 스키마 격리
generator client { provider = "prisma-client-js" }
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["expense"]
}

// ── Enums ─────────────────────────────────────────────

enum SourceType {
  CARD_SHINHAN
  CARD_HYUNDAI
  CARD_KB
  CARD_OTHER
  CASH       // 현금 + 공용 법인카드 모두 (영수증 단위 수동 입력)

  @@schema("expense")
}

enum TransactionStatus {
  PENDING        // 분류 전
  CATEGORIZED    // 카테고리 분류 완료
  EXCLUDED       // 정산 제외 (개인적 결제 등)
  CANCELED       // 카드사 취소
  SETTLED        // 정산 묶음에 포함됨

  @@schema("expense")
}

enum OcrStatus {
  PENDING
  RUNNING
  DONE
  FAILED

  @@schema("expense")
}

enum MatchSource {
  AUTO
  MANUAL

  @@schema("expense")
}

// ⚠️ V2 확장 — 6단계 상태머신
enum SettlementStatus {
  DRAFT       // 작성 중
  SUBMITTED   // 결재 진행 중
  APPROVED    // 결재 완료, 재무팀 큐 노출
  RECEIVED    // 재무팀 접수
  PAID        // 입금 완료
  REJECTED    // 결재 반려

  @@schema("expense")
}

enum CategoryScope {
  STANDARD    // 전사 표준 (admin 관리)
  PERSONAL    // 개인 커스텀

  @@schema("expense")
}

// ── Models ────────────────────────────────────────────

model ExpenseSource {
  id         String     @id @default(cuid())
  userId     String     // FK auth_users.id (logical, cross-service)
  name       String
  type       SourceType
  cardNumber String?
  active     Boolean    @default(true)
  createdAt  DateTime   @default(now())

  statements   ExpenseStatement[]
  transactions ExpenseTransaction[]

  @@index([userId, active])
  @@map("sources")
  @@schema("expense")
}

model ExpenseStatement {
  id               String    @id @default(cuid())
  userId           String
  sourceId         String
  source           ExpenseSource @relation(fields: [sourceId], references: [id])

  originalFileName String
  fileUrl          String
  parserVersion    String

  periodStart      DateTime?
  periodEnd        DateTime?

  totalRows        Int       @default(0)
  parsedRows       Int       @default(0)
  errorRows        Int       @default(0)

  parsedAt         DateTime  @default(now())

  transactions     ExpenseTransaction[]

  @@index([userId, parsedAt(sort: Desc)])
  @@map("statements")
  @@schema("expense")
}

model ExpenseTransaction {
  id                String    @id @default(cuid())
  userId            String

  statementId       String?
  statement         ExpenseStatement? @relation(fields: [statementId], references: [id])
  sourceId          String
  source            ExpenseSource @relation(fields: [sourceId], references: [id])
  isManual          Boolean   @default(false)

  // 거래 정보 (V1 동일)
  transactedAt      DateTime
  merchantName      String
  amount            Decimal   @db.Decimal(15, 2)
  currency          String    @default("KRW")
  foreignAmount     Decimal?  @db.Decimal(15, 4)
  paymentType       String?
  installmentMonths Int?
  approvalNo        String?

  // 분류
  categoryId        String?
  category          ExpenseCategory? @relation(fields: [categoryId], references: [id])
  memo              String?

  // 상태
  status            TransactionStatus @default(PENDING)
  isCanceled        Boolean   @default(false)

  // 매칭
  matches           TransactionReceiptMatch[]

  // 정산
  settlementItems   ExpenseSettlementItem[]

  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@unique([sourceId, approvalNo])
  @@index([userId, transactedAt])
  @@index([userId, categoryId])
  @@index([userId, status])
  @@map("transactions")
  @@schema("expense")
}

model ExpenseReceipt {
  id                String    @id @default(cuid())
  userId            String

  fileUrl           String      // expense_uploads 상대경로
  storageKey        String   @unique
  originalFileName  String
  fileType          String
  fileSize          Int

  // OCR (ocr-service 호출 결과)
  ocrStatus         OcrStatus @default(PENDING)
  ocrEngineUsed     String?
  ocrRawJson        Json?
  ocrText           String?    // 통합 검색 색인 대상

  // 추출 정보
  extractedAmount   Decimal?  @db.Decimal(15, 2)
  extractedMerchant String?
  extractedDate     DateTime?

  matches           TransactionReceiptMatch[]

  uploadedAt        DateTime  @default(now())
  ocrCompletedAt    DateTime?

  @@index([userId, uploadedAt(sort: Desc)])
  @@index([userId, ocrStatus])
  @@map("receipts")
  @@schema("expense")
}

model TransactionReceiptMatch {
  id                String    @id @default(cuid())

  transactionId     String
  transaction       ExpenseTransaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)

  receiptId         String
  receipt           ExpenseReceipt @relation(fields: [receiptId], references: [id], onDelete: Cascade)

  source            MatchSource
  confidence        Float?     // AUTO 매칭 시 0~1

  confirmedAt       DateTime?
  confirmedByUserId String?

  createdAt         DateTime  @default(now())

  @@unique([transactionId, receiptId])
  @@index([transactionId])
  @@index([receiptId])
  @@map("transaction_receipt_matches")
  @@schema("expense")
}

// ⚠️ V2 확장 — 전사/개인 카테고리
model ExpenseCategory {
  id           String        @id @default(cuid())
  scope        CategoryScope @default(STANDARD)
  ownerUserId  String?       // PERSONAL일 때만 채워짐
  code         String        @unique
  name         String
  description  String?
  displayOrder Int           @default(0)
  active       Boolean       @default(true)
  sheetName    String        // Excel 출력 시 시트 이름

  transactions    ExpenseTransaction[]
  settlementItems ExpenseSettlementItem[]

  @@index([scope, active])
  @@index([ownerUserId])
  @@map("categories")
  @@schema("expense")
}

// ⚠️ V2 확장 — 결재·재무팀 흐름 통합
model ExpenseSettlement {
  id              String          @id @default(cuid())
  userId          String

  periodStart     DateTime
  periodEnd       DateTime

  title           String
  status          SettlementStatus @default(DRAFT)

  // Excel 출력
  exportedFileUrl String?
  exportedAt      DateTime?

  // 결재 연동
  approvalDocumentId String?      @unique  // approval.documents.id
  submittedAt        DateTime?
  approvedAt         DateTime?
  rejectedAt         DateTime?
  rejectReason       String?

  // 재무팀 처리
  receivedAt      DateTime?
  receivedById    String?         // 재무팀 사용자 id

  // 입금 처리
  paidAt          DateTime?
  paidById        String?
  paidAmount      Decimal?        @db.Decimal(15, 2)
  paidNote        String?

  // 통계
  totalCount      Int?
  totalAmount     Decimal?        @db.Decimal(15, 2)
  categoryStats   Json?

  items           ExpenseSettlementItem[]

  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@unique([userId, periodStart, periodEnd])
  @@index([userId, periodStart(sort: Desc)])
  @@index([status])               // 재무팀 큐: WHERE status='APPROVED'
  @@index([approvalDocumentId])
  @@map("settlements")
  @@schema("expense")
}

model ExpenseSettlementItem {
  id                 String    @id @default(cuid())

  settlementId       String
  settlement         ExpenseSettlement @relation(fields: [settlementId], references: [id], onDelete: Cascade)

  transactionId      String
  transaction        ExpenseTransaction @relation(fields: [transactionId], references: [id])

  categoryOverrideId String?
  categoryOverride   ExpenseCategory? @relation(fields: [categoryOverrideId], references: [id])
  memoOverride       String?

  sortOrder          Int       @default(0)

  @@unique([settlementId, transactionId])
  @@index([settlementId])
  @@map("settlement_items")
  @@schema("expense")
}
```

### 3.2 ER 다이어그램 (요약)

```
auth_users(id) ──┬─→ ExpenseSource (1:N)
                 ├─→ ExpenseStatement (1:N)
                 ├─→ ExpenseTransaction (1:N)
                 ├─→ ExpenseReceipt (1:N)
                 └─→ ExpenseSettlement (1:N)

ExpenseSource ──→ ExpenseStatement ──→ ExpenseTransaction
                                        │
                                        ├─→ ExpenseCategory (N:1)
                                        ├─→ TransactionReceiptMatch ←─ ExpenseReceipt
                                        └─→ ExpenseSettlementItem ←─ ExpenseSettlement
                                                                          │
                                                                          └─→ approval.documents (logical link via approvalDocumentId)
```

---

## 4. State Machine — Settlement

### 4.1 상태 전이도 (v0.4 — APPROVED→PAID 직접 전이 추가)

```
        ┌──────────┐
        │  DRAFT   │  ◀── createSettlement
        └────┬─────┘
             │ submit (POST /settlements/:id/submit)
             │ → approval-service에 문서 생성, 결재 진행 시작 (submitImmediately)
             ▼
        ┌──────────────┐
        │  SUBMITTED   │
        └──┬─────────┬─┘
           │         │
   approve │         │ reject
   (HTTP)  │         │ (HTTP)
           ▼         ▼
   ┌────────────┐  ┌────────────┐
   │  APPROVED  │  │  REJECTED  │
   └──┬─────┬───┘  └────────────┘
      │     │
      │     │ receive (재무팀 수동 액션, 옵션)
      │     ▼
      │  ┌────────────┐
      │  │  RECEIVED  │
      │  └─────┬──────┘
      │        │ pay (재무팀 수동 액션)
      │        ▼
      │  ┌────────────┐
      └─→│   PAID     │  ◀── 종착
   (from-payment       └────────────┘
    webhook 직접 전이)        ▲
                              │ DELETE /from-payment (송금 해제 회귀)
                              │
                        (PAID → APPROVED 복귀)
```

### 4.2 전이 규칙 (v0.4)

| from | to | 트리거 | 권한 | 부수효과 |
|---|---|---|---|---|
| (없음) | DRAFT | 사용자가 settlement 생성 | 신청자 | items 채워짐 |
| DRAFT | SUBMITTED | 사용자 "결재 상신" 클릭 | 신청자(본인) | approval-service `/internal/documents` 호출 (submitImmediately:true), approvalDocumentId 저장, submittedAt 기록 |
| DRAFT | (삭제) | 사용자 settlement 삭제 | 신청자(본인) | items 모두 분리 (transaction.status=CATEGORIZED 복원) |
| SUBMITTED | APPROVED | **HTTP webhook** `POST /internal/settlements/from-approval` (status:APPROVED) | 시스템 (approval-service 호출) | approvedAt 기록, 재무팀 큐 노출 |
| SUBMITTED | REJECTED | **HTTP webhook** `POST /internal/settlements/from-approval` (status:REJECTED) | 시스템 (approval-service 호출) | rejectedAt + rejectReason 기록, 신청자 알림 |
| APPROVED | RECEIVED | 재무팀 "접수" (수동) | 재무팀 | receivedAt/By 기록, 신청자 알림 |
| RECEIVED | PAID | 재무팀 "지출 완료" (수동) | 재무팀 | paidAt/By/Amount 기록, 신청자 알림 |
| **APPROVED** | **PAID** | **HTTP webhook** `POST /internal/settlements/from-payment` (2026-05-12 재무 후속 통합) | 시스템 (재무 송금 모듈) | RECEIVED 단계 생략, paidAt/By/Amount/Note 기록, 신청자 알림 |
| **PAID** | **APPROVED** | **HTTP webhook** `DELETE /internal/settlements/from-payment` | 시스템 (재무 송금 해제) | paid* 필드 초기화 — 송금 실수 취소용 |
| REJECTED | DRAFT | 사용자가 재작성 결정 | 신청자 | (선택사항 — V3 후보) |

**역방향 정책**: PAID → APPROVED 만 시스템 webhook 으로 허용 (송금 해제). 그 외 역전이는 사용자 액션으로 불가. RECEIVED → APPROVED 도 불가 (정정은 신규 settlement로).

---

## 5. API Endpoints

### 5.1 사용자용 (`/api/v1/expense/*`, 본인 데이터만)

```
# Sources (카드/현금 마스터)
GET    /sources
POST   /sources             { type, name, cardNumber? }
PATCH  /sources/:id
DELETE /sources/:id

# Statements (명세서 import)
GET    /statements
POST   /statements/import   multipart: file, sourceId
GET    /statements/:id

# Transactions (거래)
GET    /transactions?status=&category=&from=&to=
POST   /transactions        (수동 입력)
GET    /transactions/:id
PATCH  /transactions/:id    { categoryId?, memo?, status? }
DELETE /transactions/:id    (수동 입력 한정)

# Receipts (영수증)
GET    /receipts
POST   /receipts            multipart: file → ocr 자동 호출
GET    /receipts/:id
DELETE /receipts/:id

# Matches (매칭)
GET    /matches/suggestions?transactionId=  (자동 매칭 후보)
POST   /matches             { transactionId, receiptId, source: AUTO|MANUAL }
PATCH  /matches/:id/confirm
DELETE /matches/:id

# Categories (개인 카테고리만 CRUD; 표준은 read-only)
GET    /categories                  (표준 + 본인 개인)
POST   /categories                  (PERSONAL만)
PATCH  /categories/:id              (자기 PERSONAL만)
DELETE /categories/:id

# Settlements (정산 + 결재)
GET    /settlements?status=&period=
POST   /settlements         { periodStart, periodEnd, title, transactionIds[] }
GET    /settlements/:id
PATCH  /settlements/:id     (DRAFT만)
DELETE /settlements/:id     (DRAFT만)
POST   /settlements/:id/submit       → approval 자동 상신
GET    /settlements/:id/excel        → 회사 양식 Excel 다운로드

# 내대시보드 카드
GET    /me/expense/summary           { unmatched, pendingApproval, awaitingPayment }
```

### 5.2 재무팀용 (`/api/v1/expense/finance/*`)

```
GET    /finance/queue                → status IN ('APPROVED', 'RECEIVED') 정산 목록
POST   /finance/settlements/:id/receive   { receivedNote? }
POST   /finance/settlements/:id/pay       { paidAt, paidAmount, paidNote? }
```

권한: `req.user`의 부서명 = "재무팀" 또는 ADMIN.

### 5.3 Admin용 (`/api/v1/expense/admin/*`)

```
# 표준 카테고리 관리
GET    /admin/categories
POST   /admin/categories             { code, name, sheetName, scope: STANDARD }
PATCH  /admin/categories/:id
DELETE /admin/categories/:id

# 전사 정산 조회 (감사용)
GET    /admin/settlements?userId=&status=
```

권한: ADMIN role 만.

### 5.4 Internal (`/internal/*`, x-internal-token)

```
GET    /internal/expense/settlement-summary   { userId } → 내대시보드 카드용 (다른 서비스 재사용)
```

### 5.5 Internal Webhook Endpoints (expense-service 측) — v0.4

v0.3 명세는 RabbitMQ Subscriber 였으나, **2026-05-12 결재 후속 통합 PDCA 결정으로 HTTP webhook 방식으로 변경**되었습니다. RabbitMQ는 활동 로그 전용으로만 사용.

```
POST   /internal/settlements/from-approval     (결재 완료/반려 동기화)
POST   /internal/settlements/from-payment      (재무 송금 처리 동기화)
DELETE /internal/settlements/from-payment      (송금 해제 — PAID → APPROVED 회귀)
```

모두 `x-internal-token` 인증.

#### 5.5.1 `POST /internal/settlements/from-approval`

approval-service가 결재 완료/반려 시 호출. `referenceType = "EXPENSE_SETTLEMENT"` 결재 문서만 대상.

```typescript
// Request body
{
  approvalDocumentId: string;       // 🔑 routing key
  settlementId?: string;             // 보조 식별자
  status: "APPROVED" | "REJECTED";
  reason?: string;                   // REJECTED 시 사유
}

// 처리: approvalDocumentId로 settlement 조회 → status 동기화
//   APPROVED  → settlement.status = APPROVED + approvedAt 기록 + 재무팀 큐 노출
//   REJECTED  → settlement.status = REJECTED + rejectReason 기록 + 신청자 알림
```

#### 5.5.2 `POST /internal/settlements/from-payment`

재무 후속 통합(2026-05-12 결정)으로 추가됨. 송금 처리 모듈이 입금 완료 시 호출 → settlement 를 PAID 로 직접 전이 (RECEIVED 단계 생략 가능).

```typescript
// Request body
{
  approvalDocumentId: string;       // 🔑 routing key
  paidAt?:     string;               // ISO datetime
  paidAmount?: number;
  paidNote?:   string;
  paidById?:   string;               // 송금 처리자 (재무팀)
}

// 처리: settlement.status = PAID + paid* 필드 기록 + 신청자 알림
```

#### 5.5.3 `DELETE /internal/settlements/from-payment`

송금 해제 시 호출 (실수 송금 취소 등). settlement.status = PAID → APPROVED 로 회귀.

```typescript
// Request body
{ approvalDocumentId: string }

// 처리: paid* 필드 초기화, status = APPROVED 복귀
```

#### 5.5.4 통신 방향 정리

```
approval-service ─[HTTP POST]─→ expense-service /internal/settlements/from-approval
재무 송금 모듈   ─[HTTP POST]─→ expense-service /internal/settlements/from-payment
재무 송금 해제   ─[HTTP DELETE]→ expense-service /internal/settlements/from-payment
expense-service ─[HTTP POST]─→ approval-service /internal/documents       (결재 자동 상신)
expense-service ─[AMQP publish]→ activity-log queue                       (활동 로그 전용)
```

**RabbitMQ 큐 `expense.approval-result-listener` 는 사용하지 않음** (v0.3 명세 폐기).

---

## 6. Approval Template 구조 — EXPENSE 양식 일원화 (v0.4)

### 6.0 양식 일원화 결정 (2026-05-11)

v0.3은 신규 EXPENSE_CLAIM 양식을 추가하는 이중 양식 구조였으나, **2026-05-11 사용자 결정으로 EXPENSE 양식 단일화로 변경**되었습니다.

| 양식 | 용도 | 자금 흐름 | 비고 |
|---|---|---|---|
| **지출결의서** (`code=EXPENSE`) — 단일 사용 | 회사가 외부에 지출 + 직원 경비 환급 모두 포함 | 회사 → 외부 / 회사 → 직원 | **경비정산도 이 양식으로 통합** |
| ~~경비정산~~ (`code=EXPENSE_CLAIM`) — **폐기** | (v0.3 명세) | - | seed 미등록, 폐기 |

**변경 사유**:
- 회계상 동일 처리 흐름 (FINANCE_FORWARD → 재무팀 큐) 이므로 양식 분리 실익 적음
- EXPENSE 양식의 `items_table_config` 가 경비정산 거래 표시에 충분
- 사용자/관리자 UI 양식 선택 부담 감소
- 재무팀 처리 큐 단일화

### 6.1 EXPENSE 양식 — 경비정산 자동 상신 (현재 구현)

expense-service의 `approval-client.ts` 가 결재 상신 시 호출하는 payload (`POST /internal/documents`, `x-internal-token`):

```typescript
// services/expense/src/infrastructure/approval-client.ts:40-68
{
  templateCode: "EXPENSE",                  // ✅ 일원화 (EXPENSE_CLAIM 아님)
  title: input.title,
  requestedBy: input.userId,
  fields: {
    project: input.projectName ?? null,
    paymentMethod: "개인정산"                // 경비정산 식별자 (지출결의서와 구분)
  },
  richBody: input.body ?? undefined,
  submitImmediately: true,                  // 정산은 expense에서 SUBMITTED 직진
  items: input.items.map(it => ({
    description: `${merchantName} (${categoryName}) — ${memo}`,
    unitPrice: it.amount,
    quantity:  1,
    subtotal:  it.amount,
    vat:       0,
    evidence:  it.receiptFileName ?? null,  // 영수증 파일명
    receiptId: it.receiptId       ?? null   // 영수증 다운로드 링크용
  })),
  totalAmount: input.totalAmount,
  referenceType: "EXPENSE_SETTLEMENT",      // 🔑 settlement 식별자
  referenceId:   input.settlementId         // 🔑 webhook routing 키
}
```

**핵심 식별자**: `referenceType = "EXPENSE_SETTLEMENT"` + `referenceId = settlementId` 조합으로 경비정산 결재 문서를 구분합니다. 일반 지출결의서는 `referenceType` 미설정 또는 다른 값.

### 6.2 EXPENSE 양식 — 일반 지출결의서 수기 작성 (변경 없음)

- 거래처 결제·운영비·외주비 등 폭넓은 지출용으로 수기 작성 허용
- `referenceType` 미설정 (또는 다른 값)
- approval UI 에서 일반 사용자도 양식 선택 가능
- 후속 흐름(post_approval_action=FINANCE_FORWARD)은 동일 — 재무팀이 처리

### 6.3 동일 양식 내 분기 처리

approval 측은 EXPENSE 단일 양식이지만 `referenceType` 으로 후속 routing 결정:

| referenceType | 후속 처리 |
|---|---|
| `EXPENSE_SETTLEMENT` | 결재 완료/반려 시 expense-service `/internal/settlements/from-approval` webhook 호출 (settlement 동기화) |
| (그 외 / 미설정) | 일반 지출결의서 — 재무팀 큐에만 노출, expense-service 호출 없음 |

수기 작성 차단 로직 불필요 (양식이 하나뿐). frontend dropdown 필터링도 불필요 (v0.3 잔여 EXPENSE_CLAIM 분기 코드는 dead code — 정리 권장).

### 6.4 settlement.approvalDocumentId 의미 (갱신)

- `ExpenseSettlement.approvalDocumentId` 는 EXPENSE 양식 결재 문서의 `documents.id` 를 참조
- 양식 코드로 구분하지 않고 **`referenceType = "EXPENSE_SETTLEMENT"`** 로 구분
- 결재 webhook(`/internal/settlements/from-approval`)이 `approvalDocumentId` 키로 settlement 조회 → 상태 동기화

---

## 7. UI Wireframes

### 7.1 페이지 구성 (`apps/web/src/app/expense/`)

```
/expense                     ─ 대시보드
/expense/transactions        ─ 거래 리스트 + 명세서 import
/expense/receipts            ─ 영수증 리스트 + 업로드
/expense/matches             ─ 매칭 confirm UI
/expense/settlements         ─ 정산 목록
/expense/settlements/[id]    ─ 정산 상세 + 결재 상신/추적
/expense/categories          ─ 카테고리 관리 (표준 read-only + 개인)
/expense/finance             ─ 재무팀 큐 (역할 제한)
```

### 7.2 핵심 와이어프레임 (텍스트)

#### `/expense/settlements/[id]` — 정산 상세

```
┌──────────────────────────────────────────────────────────────────┐
│  ← 정산 목록     2026년 4월 정산                                  │
│  ╭────────────────────────────────────────────────────────────╮  │
│  │ 상태: [SUBMITTED 결재진행]  결재 1/3 ▸ 부서장               │  │
│  │ 기간: 2026-04-01 ~ 2026-04-30                              │  │
│  │ 총액: 2,345,600원  (12 카테고리, 47 거래)                   │  │
│  │ 결재서류 #DOC-202604-001  [결재 보기]                        │  │
│  ╰────────────────────────────────────────────────────────────╯  │
│                                                                  │
│  진행 추적                                                       │
│  ───────────────────────────────────────────────────────────────  │
│  ✅ 작성 완료 (04/30 18:00)                                      │
│  ✅ 결재 상신 (05/01 09:00)                                       │
│  ◐  결재 진행 중                                                  │
│      └─ ✅ 부서장 승인 (05/01 14:30)                              │
│      └─ ◐  회계팀 검토 중                                         │
│  ⬜ 재무팀 접수                                                   │
│  ⬜ 입금 완료                                                     │
│                                                                  │
│  [Excel 다운로드]  [DRAFT 복귀]  (DRAFT일 때만)                   │
│                                                                  │
│  거래 목록 (47)                                                   │
│  ───────────────────────────────────────────────────────────────  │
│  카테고리       │ 일시         │ 가맹점     │ 금액    │ 메모      │
│  식대 (10)     │ 04/01 12:30  │ 김밥천국    │ 8,500   │ 점심      │
│  ...                                                              │
└──────────────────────────────────────────────────────────────────┘
```

#### `/expense/finance` — 재무팀 큐

```
┌──────────────────────────────────────────────────────────────────┐
│  재무팀 처리 큐                                                  │
│  [APPROVED 8건]  [RECEIVED 3건]                                  │
│                                                                  │
│  신청자  │ 부서      │ 정산 기간       │ 총액      │ 상태   │ 액션 │
│  심윤송  │ 기술팀    │ 2026-04         │ 2,345K   │ 결재OK │ 접수 │
│  강성화  │ 영업2팀   │ 2026-04         │ 1,820K   │ 결재OK │ 접수 │
│  ...                                                              │
│  김대현  │ 경영지원   │ 2026-04         │ 5,200K   │ 접수됨 │ 입금 │
└──────────────────────────────────────────────────────────────────┘
```

#### 내대시보드 — 경비 카드

```
┌─────────────────────────────────────┐
│ 💳 경비                              │
│ ───────────────────────────────────  │
│ 미정산 거래       12 건              │
│ 결재 진행 중      2 건               │
│ 입금 대기         1 건  (1,820K)     │
│ ───────────────────────────────────  │
│              [경비정산 →]            │
└─────────────────────────────────────┘
```

---

## 8. Card Parsers (어댑터 패턴)

```typescript
// services/expense/src/infrastructure/card-parsers/parser.interface.ts
export interface ICardParser {
  type: SourceType;
  parse(buffer: Buffer): Promise<{
    rows: ParsedTransaction[];
    periodStart?: Date;
    periodEnd?: Date;
    parserVersion: string;
  }>;
}

export interface ParsedTransaction {
  transactedAt: Date;
  merchantName: string;
  amount: Decimal;
  approvalNo?: string;
  paymentType?: string;
  installmentMonths?: number;
  isCanceled: boolean;
}
```

3개 구현 (V1에서 검증된 로직 이식):
- `shinhan.parser.ts` — 신한카드 xlsx
- `hyundai.parser.ts` — 현대카드 xlsx
- `kb.parser.ts` — 국민카드 xlsx

`statementService.import()` 흐름:
1. `sourceId` 로 `source.type` 조회
2. 해당 type의 parser 선택
3. `parse()` → ParsedTransaction[]
4. 트랜잭션 내 `createMany({ skipDuplicates: true })` (idempotent)
5. statement 메타 저장 (parsedRows, errorRows)

---

## 9. Permissions

### 9.1 권한 매트릭스

| 액션 | 본인 | 부서장 (결재 시) | 재무팀 | ADMIN |
|---|:--:|:--:|:--:|:--:|
| 자기 거래/영수증 CRUD | ✅ | ❌ | ❌ | ✅(read) |
| 자기 정산 작성/상신 | ✅ | ❌ | ❌ | ✅(read) |
| 결재 승인/반려 | ❌ | ✅ (approval-line) | ❌ | ❌ |
| 재무팀 큐 / 접수 / 입금 | ❌ | ❌ | ✅ | ✅ |
| 표준 카테고리 CRUD | ❌ | ❌ | ❌ | ✅ |
| 전사 정산 감사 조회 | ❌ | ❌ | ❌ | ✅ |

### 9.2 미들웨어 (v0.4 — 실제 구현 반영)

`ownsResource` 명시 미들웨어는 미구현. 각 service 레이어에서 `WHERE userId = req.userId` 인라인 패턴으로 동등 처리. `requireFinanceTeam` 은 `financeRoutes` 의 `onRequest` hook + `authClient.isFinanceTeam` 호출로 인라인 구현.

```typescript
// 1. 본인 데이터 격리 (인라인 패턴) — services/expense/src/application/*.service.ts
//    모든 조회/수정 쿼리에 WHERE userId = req.userId 직접 포함
const tx = await prisma.expenseTransaction.findFirst({
  where: { id, userId: req.userId },   // 본인 데이터만
});
if (!tx) throw notFound();

// 2. 재무팀 권한 — services/expense/src/api/routes/finance.routes.ts (onRequest hook)
app.addHook("onRequest", async (req, reply) => {
  const ok = await authClient.isFinanceTeam(req.userId);
  if (!ok && req.userRole !== "ADMIN") {
    return reply.code(403).send({ error: { code: "FORBIDDEN", message: "재무팀 권한 필요" } });
  }
});

// 3. Internal 라우트 (webhook) — x-internal-token 검증
app.addHook("onRequest", async (req, reply) => {
  if (req.headers["x-internal-token"] !== internalToken) {
    return reply.code(403).send({ error: "Forbidden" });
  }
});
```

**미들웨어 vs 인라인 트레이드오프**:
- 미들웨어: 코드 재사용 ↑, 추상화로 흐름 추적 어려움 ↓
- 인라인: Clean Architecture 4계층 명확, 각 use-case의 권한 요구를 그 자리에서 가독 ↑ (현재 선택)

---

## 10. File Storage

`services/expense/src/infrastructure/storage.ts` — `services/auth/src/infrastructure/attachment-storage.ts` 패턴 복사:

```typescript
const DEFAULT_DIR = "/app/uploads";  // expense_uploads volume mount

class LocalFsStorage implements IFileStorage {
  async save(buffer: Buffer, fileName: string): Promise<{ storageKey: string; diskPath: string }>;
  read(storageKey: string): NodeJS.ReadableStream;
  remove(storageKey: string): Promise<void>;
}
```

저장 경로 규칙: `{YYYY-MM}/{cuid}.{ext}` (월별 분산, auth와 동일).

env:
```
EXPENSE_ATTACHMENT_DIR=/app/uploads
EXPENSE_ATTACHMENT_MAX_SIZE=10485760    # 10MB
```

허용 확장자/MIME: `.png .jpg .jpeg .gif .webp .pdf` (영수증 위주).

---

## 11. Testing Strategy

| 레벨 | 도구 | 대상 |
|---|---|---|
| 단위 (unit) | vitest | card-parsers (fixture xlsx 3종) |
| 통합 (integration) | supertest + test postgres | route → service → repo |
| E2E | Playwright (light) | 정산 작성 → 상신 → mock approval 승인 → 재무팀 접수/입금 |
| Zero Script QA | Docker 로그 | 첫 사용자 시연 (게시판/수리관리 패턴 따름) |

---

## 12. Migration / Rollout

V1 → V2 전환은 **drop & rebuild** (V1 데이터 마이그 안 함, 사용자 결정).

### 12.1 진입 시점 작업 (v0.4 — 완료됨)

> **상태**: 2026-05-07 ~ 05-12 완료 (commit fb8a184). V1 폴더는 2026-05-15 완전 제거됨.

1. 기존 EXPENSE 양식 테스트 데이터 8건 삭제 (`approval.approval_documents WHERE template.code = 'EXPENSE'`)
2. ~~신규 EXPENSE_CLAIM 양식 INSERT~~ — **폐기 (2026-05-11 결정)**. EXPENSE 양식 일원화로 변경
3. expense schema 신규 migration (`erp_ot.expense` schema, 8 테이블)
4. expense-service 컨테이너 가동 (port 3008)
5. apps/web에 NAV + 라우트 추가 (7 페이지)
6. approval-service `/internal/documents` 라우트 + expense `/internal/settlements/from-approval` webhook 결선
7. 재무 송금 모듈 ↔ expense `/internal/settlements/from-payment` webhook 결선 (2026-05-12 신규)
8. V1 (`E:/claude/Expense/`) 완전 제거 (2026-05-15) — 폴더 777MB + `expense_db` 데이터베이스 + `expense_user` role

### 12.2 출시 후
- V1 컨테이너 정지 (포트 3100/3101 회수)
- V1 git repo는 보존 (히스토리)
- V1 stub plan(`docs/01-plan/features/개인경비정산.plan.md`) 업데이트 → V2 통합 완료 명시

---

## 13. Risks Revisited

Plan §5에서 식별한 리스크 + Design 시점 추가:

| Risk | 완화 |
|---|---|
| 순환 의존 (approval ↔ expense) | HTTP는 expense → approval 단방향. approval은 documentBody의 settlementId만 보유 (HTTP 호출 X). |
| RabbitMQ 메시지 유실 | Dead-letter 큐 + 정기 reconcile cron (settlement.status vs approval.status 비교, 불일치 시 polling으로 보정) |
| 카드 명세서 양식 변경 | parser 단위테스트 + fixture 회귀. 변경 시 parserVersion bump |
| OCR 인식률 낮음 | 매칭 confirm UI에서 사용자 보정. 자동 매칭은 confidence ≥ 0.7 만 제안 |
| 영수증 첨부 GC | settlement 삭제 시 receipts 분리 (file 자체는 30일 후 cron 삭제) |
| 표준 카테고리 코드 충돌 | `code @unique` 제약. seed 시 conflict 처리 |
| 재무팀 부서명 오타 | "재무팀" 정확 매칭 — 부서 마스터 검증 (admin 가이드) |
| 결재라인 미설정 | EXPENSE 양식의 default_approval_line_rule 사전 등록 필요 (P4 출시 전) |

---

## 14. Open Issues (Design 단계 식별)

### O1. 재무팀 식별 방식
- 현재: `auth_user_profiles.departmentName === "재무팀"` 매칭
- 더 robust: 별도 role `FINANCE` 신설? 또는 `auth.permissions` 시스템 활용?
- **결정**: V2는 부서명 매칭으로 시작. 권한 체계 정비 시 role 분리 고려.

### O2. 영수증 첨부 미리보기
- 정산 결재 화면에서 영수증을 어떻게 보여줄지
  - A. 결재 화면에 thumbnail 모음
  - B. 정산 상세 페이지에서만 보고 결재화면은 "총액·항목"만
- **결정**: B 시작. A는 Phase 6에서 검토 (UI 부담↑).

### O3. 정산 묶음 분할
- 같은 기간 내 여러 정산 묶음 허용?
  - 현재 `@@unique([userId, periodStart, periodEnd])` → 기간 동일 시 1개만
- **결정**: 시작은 1개 제한. 사용자 요구 시 unique 제약 완화.

### O4. 통화 (KRW 외)
- foreignAmount 필드는 V1에 있지만 처리 로직 없음
- **결정**: V2 KRW 단일. foreignAmount 필드는 보존하되 미사용.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-08 | 초기 Draft. Architecture / Data Model / State Machine / API / UI / Permissions / Approval Template 재정의 / Migration 계획 / Open Issues 4건 식별 | yunsim + Claude |
| 0.2 | 2026-05-08 | §6.2 수기 작성 차단에 ADMIN 예외 허용 명시 (3중 조건: internal token / ADMIN role / 그 외 403) + 감사 로그 metadata.bypassRoute | yunsim + Claude |
| 0.3 | 2026-05-08 | **개념 분리**: 경비정산(직원 환급) vs 지출결의서(회사 외부 지출). §6 전면 재작성 — 신규 양식 EXPENSE_CLAIM 추가 + 기존 EXPENSE 그대로 유지 + 차단은 EXPENSE_CLAIM에만 적용. §12.1 진입 작업 갱신 | yunsim + Claude |
| **0.4** | **2026-05-15** | **구현 후속 결정 반영 (analyze Match 88% → 95%+ 회복 목적)**: ① §6 전면 재작성 — **EXPENSE_CLAIM 폐기, EXPENSE 양식 일원화** (2026-05-11 결정). `referenceType=EXPENSE_SETTLEMENT` 로 분기 처리. ② §5.5 전면 재작성 — **RabbitMQ Subscriber 폐기, HTTP webhook 전환** (`/internal/settlements/from-approval`, `/from-payment`, 2026-05-12 결정). ③ §4 FSM 갱신 — **APPROVED → PAID 직접 전이 추가** (재무 송금 모듈 통합) + PAID → APPROVED 회귀 (송금 해제). ④ §2.1 Component Diagram + §2.3 Dependencies 통신 방향 갱신. ⑤ §9.2 — `ownsResource` 인라인 패턴으로 실제 구현 반영. ⑥ §12.1 — V1 제거 완료 표기 (2026-05-15) | yunsim + Claude |
