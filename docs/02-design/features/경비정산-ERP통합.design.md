# 경비정산-ERP통합 Design Document

> **Summary**: V1(`E:/claude/Expense/`) 도메인을 ERP `services/expense/`로 흡수하여 멀티 사용자 + 결재 통합 + 재무팀 처리 흐름을 한 시스템으로 구축
>
> **Project**: erp-ot-platform
> **Version**: V2 (Design v0.1)
> **Author**: 오션테크 + Claude
> **Date**: 2026-05-08
> **Status**: Draft
> **Planning Doc**: [경비정산-ERP통합.plan.md](../01-plan/features/경비정산-ERP통합.plan.md)
> **V1 참조**: `E:/claude/Expense/docs/02-design/features/개인경비정산.design.md`

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
                        │   /expense/* (8 pages, 신규)                    │
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
                │        │  ├──────────────────────────────┤  │            │
                │        │  │ application/services         │  │            │
                │        │  ├──────────────────────────────┤  │            │
                │        │  │ infrastructure/              │  │            │
                │        │  │  prisma repositories          │  │            │
                │        │  │  card-parsers (3종)           │  │            │
                │        │  │  ocr-client                   │  │            │
                │        │  │  approval-client              │  │            │
                │        │  │  auth-client                  │  │            │
                │        │  │  storage (LocalFsStorage)     │  │            │
                │        │  └──────────────────────────────┘  │            │
                │        └────┬─────────────┬─────────┬────────┘            │
                │             │             │         │                    │
                │      HTTP   │       HTTP  │   AMQP  │ subscribe          │
                │             ▼             ▼         ▼                    │
                │   ┌─────────────┐  ┌──────────┐  ┌──────────┐            │
                │   │ ocr-service │  │ approval │  │ RabbitMQ │            │
                │   │  (3007)     │  │  (3006)  │  │  (5672)  │            │
                │   └─────────────┘  └────┬─────┘  └────┬─────┘            │
                │                         │             │ publish          │
                │                         ▼             │                  │
                │                   ┌──────────┐        │                  │
                │                   │ auth     │ ◀──────┘                  │
                │                   │ (3001)   │  (FINANCE_FORWARD)         │
                │                   └──────────┘                            │
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

### 2.3 Dependencies

| 의존 | 방향 | 통신 | 목적 |
|---|---|---|---|
| expense → auth | HTTP | `/internal/users/*` | 사용자/부서 검증, 결재라인 조회 |
| expense → ocr | HTTP | `/api/v1/ocr/scan` | 영수증 OCR |
| expense → approval | HTTP | `POST /api/v1/approval/documents` | 결재 자동 상신 |
| approval → expense | AMQP | `approval.document.{approved,rejected}` | 결재 결과 sync |
| approval → expense | (없음) | - | 결재 본문에 settlementId만 참조, HTTP 호출 X (순환 방지) |

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

### 4.1 상태 전이도

```
        ┌──────────┐
        │  DRAFT   │  ◀── createSettlement
        └────┬─────┘
             │ submit (POST /settlements/:id/submit)
             │ → approval-service에 문서 생성, 결재 진행 시작
             ▼
        ┌──────────────┐
        │  SUBMITTED   │
        └──┬─────────┬─┘
           │         │
   approve │         │ reject
   (AMQP)  │         │ (AMQP)
           ▼         ▼
   ┌────────────┐  ┌────────────┐
   │  APPROVED  │  │  REJECTED  │
   └─────┬──────┘  └────────────┘
         │ receive (재무팀 액션)
         ▼
   ┌────────────┐
   │  RECEIVED  │
   └─────┬──────┘
         │ pay (재무팀 액션)
         ▼
   ┌────────────┐
   │   PAID     │  ◀── 종착
   └────────────┘
```

### 4.2 전이 규칙

| from | to | 트리거 | 권한 | 부수효과 |
|---|---|---|---|---|
| (없음) | DRAFT | 사용자가 settlement 생성 | 신청자 | items 채워짐 |
| DRAFT | SUBMITTED | 사용자 "결재 상신" 클릭 | 신청자(본인) | approval-service 호출, approvalDocumentId 저장, submittedAt 기록 |
| DRAFT | (삭제) | 사용자 settlement 삭제 | 신청자(본인) | items 모두 분리 (transaction.status=CATEGORIZED 복원) |
| SUBMITTED | APPROVED | RabbitMQ `approval.document.approved` | 시스템 | approvedAt 기록, 재무팀 큐 노출 |
| SUBMITTED | REJECTED | RabbitMQ `approval.document.rejected` | 시스템 | rejectedAt + rejectReason 기록, 신청자 알림 |
| APPROVED | RECEIVED | 재무팀 "접수" | 재무팀 | receivedAt/By 기록, 신청자 알림 |
| RECEIVED | PAID | 재무팀 "지출 완료" | 재무팀 | paidAt/By/Amount 기록, 신청자 알림 |
| REJECTED | DRAFT | 사용자가 재작성 결정 | 신청자 | (선택사항 — V3 후보) |

**역방향 금지**: PAID/RECEIVED 상태에서 이전으로 되돌리는 액션 없음. 정정은 신규 settlement로.

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

### 5.5 RabbitMQ Subscriber (expense-service 측)

```
queue: expense.approval-result-listener
  → approval.document.approved   { documentId, approverIds, approvedAt }
  → approval.document.rejected   { documentId, rejectedBy, reason, rejectedAt }
```

처리: documentId로 settlement 조회 → 상태 전이 + 감사 로그 + 신청자 알림.

---

## 6. Approval Template 구조 — 양식 분리 (v0.3)

### 6.0 개념 정리

| 양식 | 용도 | 자금 흐름 |
|---|---|---|
| **경비정산** (`code=EXPENSE_CLAIM`) — **신규** | 직원이 회사 일로 자기 돈 쓴 것 환급 청구 | 회사 → 직원 |
| **지출결의서** (`code=EXPENSE`) — 기존 유지 | 회사가 외부에 지출 (거래처 결제·운영비·임대료 등) | 회사 → 외부 |

→ 두 양식 모두 결재·재무팀 처리 흐름을 가지지만 **입력 경로·수신자가 다름**. 회계상 별도 처리.

### 6.1 신규 양식: 경비정산 (`EXPENSE_CLAIM`)

```typescript
// approval.approval_templates 신규 INSERT
{
  code: "EXPENSE_CLAIM",
  name: "경비정산",
  category: "EXPENSE",
  related_service: "expense-service",     // expense-service만 자동 상신
  default_approval_line_rule: "DEPARTMENT_LINE",
  post_approval_action: "FINANCE_FORWARD",  // 재무팀 이관
  fields: [
    { key: "settlementId",   type: "hidden", label: "정산 ID" },
    { key: "title",          type: "text",   label: "제목" },
    { key: "periodStart",    type: "date",   label: "정산 시작일" },
    { key: "periodEnd",      type: "date",   label: "정산 종료일" },
    { key: "totalAmount",    type: "money",  label: "총 금액" },
    { key: "categoryStats",  type: "json",   label: "카테고리별 합계" }
  ],
  items_table_config: {
    columns: [
      { key: "transactedAt",  label: "거래일시", width: 120 },
      { key: "merchantName",  label: "가맹점",   width: 200 },
      { key: "categoryName",  label: "카테고리", width: 120 },
      { key: "amount",        label: "금액",     width: 120, align: "right" },
      { key: "memo",          label: "메모",     width: 200 }
    ],
    sumRow: ["amount"]
  },
  sort_order: 6   // 지출결의서 다음 위치
}
```

### 6.2 기존 양식: 지출결의서 (`EXPENSE`) — 변경 없음

- 기존 그대로 수기 작성 허용 (거래처 결제·운영비·외주비 등 폭넓은 지출용)
- approval UI에서 일반 사용자도 양식 선택 가능
- 후속 흐름(post_approval_action=FINANCE_FORWARD)은 그대로 — 재무팀이 처리

### 6.3 EXPENSE_CLAIM 양식 수기 작성 차단 (ADMIN 예외)

**경비정산 양식만** expense-service 자동 상신으로 단일화. 지출결의서 양식은 자유 작성 유지.

approval UI (`apps/web/src/app/approval/new/page.tsx`):
- 양식 선택 dropdown에서 **EXPENSE_CLAIM** 항목 hide (일반 사용자)
- `currentUser.role === "ADMIN"` 인 경우만 EXPENSE_CLAIM 노출 + ⚠ 배지 ("일반 경로 아님 — 경비정산 메뉴 권장")
- `template.related_service` 가 설정된 양식은 자동 hide (ADMIN 분기 포함) — 다른 서비스 연동 양식(휴가·OT 등)도 동일 패턴 적용 가능
- **EXPENSE 양식은 모든 사용자에게 노출 그대로**

백엔드 보호 (이중 안전망):
- `POST /api/v1/approval/documents` 라우트:
  - `template.code === "EXPENSE_CLAIM"` 일 때 다음 중 하나만 허용:
    1. `x-internal-token` 헤더 (expense-service 호출)
    2. `req.user.role === "ADMIN"` (수기 작성 ADMIN 예외)
    3. 그 외 → 403 FORBIDDEN ("경비정산은 경비정산 메뉴를 통해 작성")
  - 다른 양식(`EXPENSE`, `LEAVE`, `TRIP` 등)은 기존 권한 그대로
- 활동 로그: ADMIN이 EXPENSE_CLAIM 수기 작성 시 metadata `bypassRoute: true` 표기

### 6.4 settlement.approvalDocumentId 의미

- expense-service의 settlement는 **EXPENSE_CLAIM** 양식의 결재 문서로만 연결
- 일반 EXPENSE 양식 결재는 settlement와 무관 (수기 작성된 거래처 결제 등)
- DB FK는 `approval.documents.id`로 동일하지만 의미가 다름 (양식 코드로 구분)

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

### 9.2 미들웨어

```typescript
// services/expense/src/api/middleware/auth.ts
export const ownsResource = (extractor: (req) => string) =>
  async (req, reply) => {
    const ownerId = await extractor(req);
    if (req.user.id !== ownerId && req.user.role !== "ADMIN") {
      return reply.code(403).send({ error: { code: "FORBIDDEN" } });
    }
  };

export const requireFinanceTeam = async (req, reply) => {
  if (req.user.role === "ADMIN") return;
  const profile = await fetchUserProfile(req.user.id);
  if (profile.departmentName !== "재무팀") {
    return reply.code(403).send({ error: { code: "FORBIDDEN", message: "재무팀 권한 필요" } });
  }
};
```

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

### 12.1 진입 시점 작업
1. 기존 EXPENSE 양식 테스트 데이터 8건 삭제 (`approval.approval_documents WHERE template.code = 'EXPENSE'`)
2. **신규 EXPENSE_CLAIM 양식 INSERT** (지출결의서 EXPENSE는 변경 없이 보존)
3. expense schema 신규 migration
4. expense-service 컨테이너 가동
5. apps/web에 NAV + 라우트 추가
6. V1 (`E:/claude/Expense/`) 폴더 archive

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
