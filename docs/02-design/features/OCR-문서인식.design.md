# [Design] OCR 문서인식 (OCR Document Recognition)

> **Feature**: OCR-문서인식
> **Phase**: Design
> **Created**: 2026-04-15
> **Updated**: 2026-04-15
> **Status**: Design v1.0
> **Plan Reference**: `docs/01-plan/features/OCR-문서인식.plan.md` (v1.0)

---

## 1. 아키텍처 결정

### 1.1 서비스 구성

2개 컨테이너로 구성 — OCR 엔진(Python)과 API 서버(Node.js) 분리:

| 컴포넌트 | 런타임 | 포트 | 역할 |
|----------|--------|------|------|
| ocr-service | Node.js + Fastify | 3007 | API 서버, 템플릿 관리, 매핑 로직, ERP 연동 |
| ocr-engine | Python + FastAPI | 8000 | PaddleOCR 래퍼, 이미지→텍스트+좌표 추출 |

> **포트 변경**: 3006은 향후 approval-service 예약 (구매-재고-결재 Design 참조) → ocr-service는 3007

```
erp-ot-platform/
├── services/
│   └── ocr/                          ★ 신규
│       ├── prisma/
│       │   └── schema.prisma         # OCR 전용 스키마
│       ├── src/                      # Node.js API 서버
│       │   ├── api/
│       │   │   ├── routes/
│       │   │   │   ├── ocr.routes.ts
│       │   │   │   ├── template.routes.ts
│       │   │   │   └── correction.routes.ts
│       │   │   └── dtos/
│       │   │       ├── ocr.dto.ts
│       │   │       └── template.dto.ts
│       │   ├── application/
│       │   │   ├── ocr.service.ts           # OCR 파이프라인 오케스트레이션
│       │   │   ├── mapping.service.ts       # 필드 매핑 엔진
│       │   │   ├── template.service.ts      # 문서 템플릿 CRUD
│       │   │   └── correction.service.ts    # 수정 이력 관리
│       │   ├── domain/
│       │   │   └── entities/
│       │   │       ├── ocr-result.entity.ts
│       │   │       ├── document-template.entity.ts
│       │   │       └── ocr-correction.entity.ts
│       │   ├── infrastructure/
│       │   │   ├── engines/
│       │   │   │   ├── engine.interface.ts  # 공통 인터페이스
│       │   │   │   └── paddle-ocr.client.ts # Python sidecar HTTP 클라이언트
│       │   │   └── erp/
│       │   │       └── equipment.client.ts  # equipment-service 연동
│       │   ├── config/
│       │   │   └── env.ts                   # 환경변수 Zod 검증
│       │   └── index.ts
│       ├── engine/                    # Python OCR 엔진
│       │   ├── main.py                # FastAPI 엔트리포인트
│       │   ├── ocr_handler.py         # PaddleOCR 래퍼
│       │   ├── preprocessor.py        # 이미지 전처리
│       │   ├── requirements.txt
│       │   └── Dockerfile
│       ├── uploads/                   # 업로드 이미지 (volume mount)
│       ├── models/                    # PaddleOCR 모델 (volume mount)
│       │   ├── base/
│       │   └── custom/
│       ├── Dockerfile                 # Node.js 서버
│       ├── package.json
│       └── tsconfig.json
└── apps/web/src/app/ocr/             ★ OCR UI (향후)
    ├── page.tsx                       # OCR 처리 이력 목록
    ├── scan/page.tsx                  # 스캔 + 확인/수정 화면
    └── templates/page.tsx             # 템플릿 관리 (관리자)
```

### 1.2 DB 스키마 배치

- `ocr` 스키마 신규 생성 (기존 PostgreSQL 인스턴스 내)
- equipment 스키마와 별도 — OCR 서비스의 독립성 보장

### 1.3 서비스 간 통신

```
┌─────────────┐    HTTP     ┌─────────────┐
│  apps/web   │ ──────────→ │ ocr-service │ (port 3007)
│  (Next.js)  │             │ (Node.js)   │
└─────────────┘             └──────┬──────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │ HTTP         │ HTTP         │
                    ▼              ▼              ▼
            ┌────────────┐  ┌───────────┐  ┌──────────┐
            │ ocr-engine │  │ equipment │  │   auth   │
            │ (Python)   │  │ -service  │  │ -service │
            │ port 8000  │  │ port 3005 │  │ port 3001│
            └────────────┘  └───────────┘  └──────────┘
             이미지→텍스트    ERP 데이터 저장   인증 검증
```

| From | To | 경로 | 용도 |
|------|----|------|------|
| ocr-service | ocr-engine | `POST /ocr/scan` | 이미지 OCR 처리 |
| ocr-service | equipment-service | `POST /api/v1/import-costs` | 수입원가정산 저장 |
| ocr-service | equipment-service | `POST /api/v1/overseas-orders` | 발주 저장 |
| ocr-service | equipment-service | `POST /api/v1/inventory` | 재고 입고 |
| ocr-service | auth-service | `GET /internal/users/me` | 사용자 인증 |

### 1.4 next.config.mjs 리라이트 추가

```javascript
// 기존 리라이트에 추가
{ source: '/api/v1/ocr/:path*', destination: 'http://ocr-service:3007/api/v1/ocr/:path*' }
```

---

## 2. DB 스키마 (Prisma)

### 2.1 Enum 정의

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["ocr"]
}

enum OcrResultStatus {
  PROCESSING        // OCR 처리 중
  PENDING_REVIEW    // 사용자 확인 대기
  CONFIRMED         // 사용자 확인 완료
  APPLIED           // ERP 반영 완료
  FAILED            // OCR 처리 실패

  @@schema("ocr")
}

enum FieldType {
  STRING
  NUMBER
  DATE
  BIZ_NO            // 사업자번호 (000-00-00000)
  CURRENCY          // 통화 금액
  PHONE             // 전화번호

  @@schema("ocr")
}

enum ConfidenceLevel {
  HIGH              // >= 0.95 (녹색)
  MEDIUM            // 0.80 ~ 0.94 (노란)
  LOW               // < 0.80 (빨간)

  @@schema("ocr")
}
```

### 2.2 모델 정의

```prisma
// ─── 문서 템플릿 ───────────────────────────────
model DocumentTemplate {
  id          String   @id @default(cuid())
  code        String   @unique                // IMPORT_DECLARATION, TAX_INVOICE, ...
  name        String                          // 수입면장, 세금계산서, ...
  description String?
  isActive    Boolean  @default(true) @map("is_active")

  // ERP 연동 설정
  targetService  String  @map("target_service")    // equipment-service
  targetEndpoint String  @map("target_endpoint")   // /api/v1/import-costs

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  fields  TemplateField[]
  results OcrResult[]

  @@map("document_templates")
  @@schema("ocr")
}

model TemplateField {
  id         String    @id @default(cuid())
  templateId String    @map("template_id")
  key        String                          // declarationNo, supplyAmount, ...
  label      String                          // 면장번호, 공급가액, ...
  aliases    String[]  @default([])          // 대체 라벨 ["신고번호", "면장No"]
  type       FieldType @default(STRING)
  required   Boolean   @default(false)
  sortOrder  Int       @default(0) @map("sort_order")

  // ERP 필드 매핑
  erpFieldName String? @map("erp_field_name")  // ERP API body의 필드명

  // 검증 규칙
  validation  String?                         // regex 패턴 (옵션)
  minValue    Decimal? @map("min_value")      // 숫자 최소값
  maxValue    Decimal? @map("max_value")      // 숫자 최대값

  template    DocumentTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@unique([templateId, key])
  @@index([templateId])
  @@map("template_fields")
  @@schema("ocr")
}

// ─── OCR 처리 결과 ─────────────────────────────
model OcrResult {
  id           String          @id @default(cuid())
  templateId   String?         @map("template_id")
  templateCode String?         @map("template_code")
  status       OcrResultStatus @default(PROCESSING)

  // 원본 이미지
  originalFileName String  @map("original_file_name")
  storedFilePath   String  @map("stored_file_path")
  fileSize         Int     @map("file_size")
  mimeType         String  @map("mime_type")

  // 처리 결과 메타
  overallConfidence Float?  @map("overall_confidence")  // 전체 평균 신뢰도
  processingTimeMs  Int?    @map("processing_time_ms")  // 처리 소요 시간(ms)
  rawOcrOutput      Json?   @map("raw_ocr_output")      // PaddleOCR 원본 결과

  // ERP 연동 결과
  erpAppliedAt   DateTime? @map("erp_applied_at")
  erpResponseId  String?   @map("erp_response_id")       // ERP에서 생성된 레코드 ID

  // 감사
  createdBy String   @map("created_by")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  template    DocumentTemplate? @relation(fields: [templateId], references: [id])
  fields      OcrFieldResult[]
  corrections OcrCorrection[]

  @@index([templateId])
  @@index([status])
  @@index([createdAt])
  @@map("ocr_results")
  @@schema("ocr")
}

model OcrFieldResult {
  id          String          @id @default(cuid())
  resultId    String          @map("result_id")
  fieldKey    String          @map("field_key")      // 템플릿 필드 key

  // OCR 인식 결과
  ocrValue       String?     @map("ocr_value")       // OCR이 인식한 원본 텍스트
  parsedValue    String?     @map("parsed_value")     // 타입 변환 후 값
  confirmedValue String?     @map("confirmed_value")  // 사용자 확인/수정 후 최종값
  isModified     Boolean     @default(false) @map("is_modified")

  // 신뢰도
  confidence      Float      @default(0)
  confidenceLevel ConfidenceLevel @default(LOW) @map("confidence_level")

  // 이미지 좌표 (하이라이트용)
  boundingBox Json? @map("bounding_box")  // { x, y, width, height }

  result OcrResult @relation(fields: [resultId], references: [id], onDelete: Cascade)

  @@index([resultId])
  @@map("ocr_field_results")
  @@schema("ocr")
}

// ─── 수정 이력 (학습 데이터) ───────────────────
model OcrCorrection {
  id            String   @id @default(cuid())
  resultId      String   @map("result_id")
  fieldKey      String   @map("field_key")
  templateCode  String   @map("template_code")

  originalValue String   @map("original_value")    // OCR 원본값
  correctedValue String  @map("corrected_value")   // 사용자 수정값
  confidence    Float                               // 원본 신뢰도
  boundingBox   Json?    @map("bounding_box")       // 이미지 영역

  createdBy String   @map("created_by")
  createdAt DateTime @default(now()) @map("created_at")

  result OcrResult @relation(fields: [resultId], references: [id], onDelete: Cascade)

  @@index([resultId])
  @@index([templateCode])
  @@index([createdAt])
  @@map("ocr_corrections")
  @@schema("ocr")
}
```

### 2.3 ER 다이어그램

```
[DocumentTemplate] 1 ──── N [TemplateField]
        │
        1
        │
        N
[OcrResult] 1 ──── N [OcrFieldResult]
        │
        1
        │
        N
[OcrCorrection]
```

---

## 3. Python OCR 엔진 (ocr-engine)

### 3.1 FastAPI 엔드포인트

```python
# engine/main.py

@app.post("/ocr/scan")
async def scan_image(file: UploadFile) -> OcrScanResponse:
    """이미지 → 텍스트 + 좌표 + 신뢰도 추출"""

@app.post("/ocr/scan-region")
async def scan_region(file: UploadFile, region: Region) -> OcrScanResponse:
    """이미지 특정 영역만 OCR"""

@app.get("/health")
async def health_check():
    """헬스체크 + 모델 로드 상태"""
```

### 3.2 응답 스키마

```python
class TextBlock(BaseModel):
    text: str
    confidence: float           # 0.0 ~ 1.0
    bounding_box: BoundingBox   # { x, y, width, height } (정규화 0~1)

class OcrScanResponse(BaseModel):
    texts: list[TextBlock]
    image_width: int
    image_height: int
    processing_time_ms: int
```

### 3.3 이미지 전처리 (preprocessor.py)

```python
class ImagePreprocessor:
    def process(self, image: np.ndarray) -> np.ndarray:
        """OCR 정확도를 높이기 위한 전처리 파이프라인"""
        # 1. 자동 회전 보정 (기울기 감지)
        # 2. 노이즈 제거 (가우시안 블러)
        # 3. 대비 향상 (CLAHE)
        # 4. 이진화 (adaptive threshold)  — 스크린샷은 skip
        # 5. 해상도 정규화 (DPI 조정)
```

### 3.4 Dockerfile (ocr-engine)

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y libgl1-mesa-glx libglib2.0-0
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# PaddleOCR 모델 사전 다운로드 (빌드 시 캐시)
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(lang='korean', use_gpu=False)"

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 4. API 명세 (ocr-service, Node.js)

### 4.1 엔드포인트 목록

| Method | Path | 설명 | 인증 |
|--------|------|------|------|
| **OCR 처리** |
| POST | `/api/v1/ocr/scan` | 이미지 업로드 + OCR 처리 + 자동 매핑 | Required |
| GET | `/api/v1/ocr/results` | 처리 이력 목록 (필터/페이징) | Required |
| GET | `/api/v1/ocr/results/:id` | 처리 결과 상세 (필드 포함) | Required |
| PATCH | `/api/v1/ocr/results/:id/fields` | 필드값 수정 (확인/수정) | Required |
| POST | `/api/v1/ocr/results/:id/confirm` | 확인 완료 처리 | Required |
| POST | `/api/v1/ocr/results/:id/apply` | ERP 반영 (confirm 후) | ADMIN, MANAGER |
| DELETE | `/api/v1/ocr/results/:id` | 결과 삭제 | ADMIN |
| **템플릿 관리** |
| GET | `/api/v1/ocr/templates` | 문서 유형 목록 | Required |
| GET | `/api/v1/ocr/templates/:code` | 템플릿 상세 (필드 포함) | Required |
| POST | `/api/v1/ocr/templates` | 템플릿 생성 | ADMIN |
| PUT | `/api/v1/ocr/templates/:code` | 템플릿 수정 | ADMIN |
| **통계/학습** |
| GET | `/api/v1/ocr/stats` | 정확도/수정률 통계 | ADMIN, MANAGER |
| GET | `/api/v1/ocr/corrections/export` | 학습 데이터 내보내기 | ADMIN |

### 4.2 핵심 API 상세

#### `POST /api/v1/ocr/scan`

이미지 업로드 → OCR → 문서 유형 판별 → 필드 매핑까지 한 번에 수행.

**Request (multipart/form-data):**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| file | File | ✅ | 이미지 파일 (PNG/JPG/PDF) |
| templateCode | string | | 문서 유형 코드 (생략 시 자동 판별) |

**Response (201):**

```json
{
  "id": "clx...",
  "status": "PENDING_REVIEW",
  "templateCode": "IMPORT_DECLARATION",
  "templateName": "수입면장",
  "overallConfidence": 0.89,
  "processingTimeMs": 1850,
  "fields": [
    {
      "fieldKey": "declarationNo",
      "label": "면장번호",
      "type": "STRING",
      "ocrValue": "12345-26-0012345",
      "parsedValue": "12345-26-0012345",
      "confidence": 0.97,
      "confidenceLevel": "HIGH",
      "boundingBox": { "x": 0.15, "y": 0.08, "width": 0.25, "height": 0.03 },
      "required": true
    },
    {
      "fieldKey": "supplyAmount",
      "label": "공급가액",
      "type": "NUMBER",
      "ocrValue": "45,230,000",
      "parsedValue": "45230000",
      "confidence": 0.72,
      "confidenceLevel": "LOW",
      "boundingBox": { "x": 0.60, "y": 0.45, "width": 0.15, "height": 0.03 },
      "required": true
    }
  ],
  "imageUrl": "/api/v1/ocr/results/clx.../image"
}
```

#### `PATCH /api/v1/ocr/results/:id/fields`

사용자가 확인/수정한 필드값 저장.

**Request:**

```json
{
  "fields": [
    { "fieldKey": "supplyAmount", "confirmedValue": "45230000" },
    { "fieldKey": "vat", "confirmedValue": "4523000" }
  ]
}
```

수정된 필드는 자동으로 `OcrCorrection` 레코드 생성.

#### `POST /api/v1/ocr/results/:id/apply`

확인 완료된 데이터를 ERP에 반영.

**처리 흐름:**
1. OcrResult 상태가 `CONFIRMED`인지 확인
2. 템플릿의 `targetService` + `targetEndpoint` 조회
3. confirmedValue → ERP API body 변환 (erpFieldName 매핑)
4. equipment-service HTTP 호출
5. 성공 시 상태를 `APPLIED`로 변경, erpResponseId 저장

**Response (200):**

```json
{
  "status": "APPLIED",
  "erpResponseId": "clx...",
  "appliedAt": "2026-04-15T10:30:00Z"
}
```

---

## 5. 필드 매핑 엔진 (mapping.service.ts)

### 5.1 매핑 파이프라인

```typescript
class MappingService {
  async mapFields(
    ocrTexts: TextBlock[],       // OCR 원본 결과
    template: DocumentTemplate   // 문서 템플릿
  ): Promise<MappedField[]> {

    // Step 1: 키-값 쌍 추출
    const pairs = this.extractKeyValuePairs(ocrTexts);

    // Step 2: 라벨 매칭 (label + aliases)
    const mapped = this.matchLabelsToFields(pairs, template.fields);

    // Step 3: 타입 변환
    const parsed = this.parseFieldValues(mapped);

    // Step 4: 검증
    const validated = this.validateFields(parsed, template.fields);

    return validated;
  }
}
```

### 5.2 키-값 쌍 추출 알고리즘

```
OCR 텍스트 블록들에서 인접한 블록을 쌍으로 묶는 로직:

1. 모든 텍스트 블록을 Y좌표로 정렬 → 같은 줄 그룹핑 (Y 차이 < threshold)
2. 같은 줄에서 왼쪽 블록 = 라벨 후보, 오른쪽 블록 = 값 후보
3. 라벨 후보가 템플릿의 label/aliases에 포함되면 → 키-값 쌍 확정
4. 테이블 구조 감지: 위-아래 관계의 헤더-값도 매칭

예시:
  블록 A: { text: "공급가액", y: 0.45, x: 0.40 }
  블록 B: { text: "45,230,000", y: 0.45, x: 0.60 }
  → 같은 줄, A가 왼쪽 → { key: "공급가액", value: "45,230,000" }
  → "공급가액"이 supplyAmount의 label → 매칭 성공
```

### 5.3 타입 변환 규칙

| 타입 | 변환 규칙 | 예시 |
|------|-----------|------|
| NUMBER | 콤마/공백 제거, 숫자만 추출 | "45,230,000원" → 45230000 |
| DATE | 다양한 날짜 포맷 파싱 | "2026.04.15" / "2026-04-15" / "26/04/15" → "2026-04-15" |
| BIZ_NO | 사업자번호 형식 정규화 | "1234567890" → "123-45-67890" |
| CURRENCY | 통화 기호 제거 + 소수점 유지 | "$1,200.50" → 1200.50 |
| STRING | 앞뒤 공백 제거 | " 오션테크(주) " → "오션테크(주)" |

### 5.4 문서 유형 자동 판별

```typescript
detectDocumentType(ocrTexts: TextBlock[]): string | null {
  const fullText = ocrTexts.map(t => t.text).join(' ');

  const detectionRules = [
    { code: 'IMPORT_DECLARATION', keywords: ['수입신고필증', '수입면장', '신고번호', '관세'] },
    { code: 'TAX_INVOICE', keywords: ['세금계산서', '공급가액', '세액', '공급받는자'] },
    { code: 'QUOTATION', keywords: ['견적서', '견적번호', '유효기간'] },
    { code: 'INVOICE', keywords: ['Invoice', 'Invoice No', 'Total Amount'] },
    { code: 'DELIVERY_NOTE', keywords: ['거래명세서', '명세서번호'] },
    { code: 'PURCHASE_ORDER', keywords: ['발주서', '발주번호', 'Purchase Order'] },
  ];

  // 키워드 매칭 점수 계산 → 최고 점수 문서 유형 반환
}
```

---

## 6. ERP 필드 매핑 상세

### 6.1 수입면장 → ImportCostSettlement

| OCR 필드 (key) | 라벨 | 타입 | ERP 필드 (erpFieldName) | ERP 모델 |
|----------------|------|------|------------------------|----------|
| declarationNo | 면장번호 | STRING | declarationNo | ImportCostSettlement |
| declarationDate | 신고일자 | DATE | declarationDate | ImportCostSettlement |
| supplier | 공급자 | STRING | supplier | ImportCostSettlement |
| currency | 통화 | STRING | currency | ImportCostSettlement |
| totalImportCost | 수입원가 | NUMBER | totalImportCost | ImportCostSettlement |
| supplyAmount | 공급가액 | NUMBER | supplyAmount | ImportCostSettlement |
| vat | 부가세 | NUMBER | vat | ImportCostSettlement |
| customsDuty | 관세 | NUMBER | amount (type=CUSTOMS_DUTY) | CostDuty |
| domesticTransport | 국내운반비 | NUMBER | amount (type=DOMESTIC_TRANSPORT) | CostDuty |
| overseasTransport | 국외운반비 | NUMBER | amount (type=OVERSEAS_TRANSPORT) | CostDuty |
| brokerageFee | 통관수수료 | NUMBER | amount (type=BROKERAGE_FEE) | CostDuty |
| itemName | 품목명 | STRING | name | CostItem |
| itemQty | 수량 | NUMBER | quantity | CostItem |
| itemUnitPrice | 단가 | NUMBER | unitPrice | CostItem |
| itemAmount | 금액 | NUMBER | amount | CostItem |

### 6.2 세금계산서 → 참조 데이터

| OCR 필드 (key) | 라벨 | 타입 | 용도 |
|----------------|------|------|------|
| invoiceNo | 계산서번호 | STRING | CostDuty 매칭 참조 |
| issueDate | 작성일자 | DATE | 날짜 교차 검증 |
| supplierName | 공급자 | STRING | supplier 매칭 |
| bizNumber | 사업자번호 | BIZ_NO | 거래처 자동 매칭 |
| supplyAmount | 공급가액 | NUMBER | 금액 교차 검증 |
| taxAmount | 세액 | NUMBER | VAT 교차 검증 |
| totalAmount | 합계금액 | NUMBER | 합계 검증 |

### 6.3 인보이스 → OverseasOrder 매칭

| OCR 필드 (key) | 라벨 | 타입 | 용도 |
|----------------|------|------|------|
| invoiceNo | Invoice No. | STRING | OverseasOrder.invoiceNo 매칭 |
| invoiceDate | Date | DATE | 참조 |
| supplierName | Supplier | STRING | manufacturer 매칭 |
| currency | Currency | STRING | OverseasOrder.currency 검증 |
| totalAmount | Total | CURRENCY | 금액 검증 |
| items[].name | Item | STRING | OverseasOrderItem 매칭 |
| items[].qty | Qty | NUMBER | 수량 검증 |
| items[].unitPrice | Unit Price | CURRENCY | 단가 검증 |

---

## 7. UI/UX 설계

### 7.1 화면 목록

| 화면 | 경로 | 접근 권한 | 설명 |
|------|------|----------|------|
| OCR 이력 | `/ocr` | 전체 | 처리 이력 목록, 필터, 상태 |
| 스캔/확인 | `/ocr/scan` | 전체 | 업로드 + OCR + 확인/수정 |
| 템플릿 관리 | `/ocr/templates` | ADMIN | 문서 유형/필드 관리 |

### 7.2 스캔/확인 화면 상세

```
┌─────────────────────────────────────────────────────────────────┐
│ ← OCR 문서 스캔          문서 유형: [수입면장 ▼]   신뢰도: 89% │
├───────────────────────────┬─────────────────────────────────────┤
│                           │                                     │
│                           │ ── 수입면장 필드 ──────────────────  │
│                           │                                     │
│  ┌─────────────────────┐  │ 면장번호     [12345-26-001234 ] ✓  │
│  │                     │  │ 신고일자     [2026-04-15      ] ✓  │
│  │   원본 이미지 뷰어   │  │ 공급자       [ABC Corp.       ] ✓  │
│  │                     │  │ 통화         [USD             ] ✓  │
│  │   ┌───────────┐     │  │                                     │
│  │   │ 하이라이트 │     │  │ ── 금액 ──                          │
│  │   │  영역     │     │  │ 수입원가     [52,350,000      ] ✓  │
│  │   └───────────┘     │  │ 공급가액     [45,230,000      ] △  │
│  │                     │  │ 부가세       [4,523,00⬜      ] ✗  │
│  │   [확대][축소][회전] │  │                                     │
│  └─────────────────────┘  │ ── 부대비용 ──                      │
│                           │ 관세         [3,600,000       ] ✓  │
│  ┌─────────────────────┐  │ 국내운반비    [250,000         ] ✓  │
│  │ 드래그 앤 드롭       │  │ 통관수수료    [180,000         ] ✓  │
│  │ 또는 클릭하여 업로드  │  │                                     │
│  └─────────────────────┘  │ ── 품목 ──                          │
│                           │ #1 해양센서 A-100  50개  $1,200.00  │
│                           │ #2 커넥터 B-200    100개 $85.00     │
│                           │                                     │
│                           │ [+ 품목 추가]                        │
├───────────────────────────┴─────────────────────────────────────┤
│            [임시저장]      [확인 완료]      [ERP 반영]            │
└─────────────────────────────────────────────────────────────────┘

범례: ✓ = 신뢰도 HIGH (녹색)  △ = MEDIUM (노란)  ✗ = LOW (빨간, 수동확인)
```

**인터랙션 규칙:**
- 우측 필드 클릭 → 좌측 이미지에서 해당 영역 하이라이트 (boundingBox)
- ✗ 필드는 자동 포커스 (첫 번째 LOW 필드로 커서 이동)
- 숫자 필드: 입력 시 자동 콤마 포맷팅
- Tab 키: 다음 필드로 이동 (LOW → MEDIUM → HIGH 순서)

### 7.3 OCR 이력 화면

```
┌────────────────────────────────────────────────────────────────┐
│ OCR 처리 이력                              [+ 새 스캔]         │
├────────────────────────────────────────────────────────────────┤
│ 필터: [문서유형 ▼] [상태 ▼] [날짜범위] [검색...]              │
├─────┬──────────┬──────────┬──────┬────────┬────────┬─────────┤
│  #  │ 문서유형  │ 파일명    │ 신뢰 │ 상태   │ 처리일  │ 작업   │
├─────┼──────────┼──────────┼──────┼────────┼────────┼─────────┤
│  1  │ 수입면장  │ scan1.jpg│ 94%  │ 반영됨  │ 04-15  │ [보기] │
│  2  │ 세금계산서│ tax2.pdf │ 87%  │ 확인대기│ 04-15  │ [수정] │
│  3  │ 인보이스  │ inv3.png │ 91%  │ 처리중  │ 04-14  │ [대기] │
└─────┴──────────┴──────────┴──────┴────────┴────────┴─────────┘
│  페이지: [< 1 2 3 >]                     총 47건              │
└────────────────────────────────────────────────────────────────┘
```

### 7.4 컴포넌트 구조

```
apps/web/src/app/ocr/
├── page.tsx                          # 이력 목록
├── scan/
│   └── page.tsx                      # 스캔 + 확인/수정
├── templates/
│   └── page.tsx                      # 템플릿 관리
└── components/
    ├── OcrImageViewer.tsx            # 이미지 뷰어 + 하이라이트
    ├── OcrFieldForm.tsx              # 필드 양식 (우측 패널)
    ├── OcrFieldRow.tsx               # 개별 필드 행 (신뢰도 표시)
    ├── OcrResultList.tsx             # 이력 목록 테이블
    ├── OcrUploader.tsx               # 파일 업로드 (드래그&드롭)
    ├── DocumentTypeSelector.tsx      # 문서 유형 선택
    └── ConfidenceBadge.tsx           # 신뢰도 뱃지 (✓/△/✗)
```

---

## 8. 환경 변수

### 8.1 ocr-service (Node.js)

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `PORT` | 서비스 포트 | 3007 |
| `DATABASE_URL` | PostgreSQL 연결 (ocr 스키마) | - |
| `OCR_ENGINE_URL` | Python 엔진 URL | http://ocr-engine:8000 |
| `EQUIPMENT_SERVICE_URL` | equipment-service URL | http://equipment-service:3005 |
| `AUTH_SERVICE_URL` | auth-service URL | http://auth-service:3001 |
| `INTERNAL_API_TOKEN` | 내부 서비스 통신 토큰 | - |
| `UPLOAD_DIR` | 이미지 저장 경로 | /app/uploads |
| `MAX_FILE_SIZE_MB` | 최대 파일 크기 | 10 |
| `JWT_SECRET` | JWT 검증용 | - |

### 8.2 ocr-engine (Python)

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `PORT` | 엔진 포트 | 8000 |
| `USE_GPU` | GPU 사용 여부 | false |
| `MODEL_DIR` | 모델 저장 경로 | /app/models |
| `LANG` | OCR 언어 | korean |
| `DET_MODEL` | 텍스트 감지 모델 | base/det | 
| `REC_MODEL` | 텍스트 인식 모델 | base/rec |

---

## 9. Docker Compose 추가

```yaml
# docker-compose.yml에 추가
ocr-engine:
  build:
    context: ./services/ocr/engine
    dockerfile: Dockerfile
  ports:
    - "8000:8000"
  environment:
    - USE_GPU=false
    - LANG=korean
  volumes:
    - ./services/ocr/models:/app/models
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
    interval: 30s
    timeout: 10s
    retries: 3

ocr-service:
  build:
    context: ./services/ocr
    dockerfile: Dockerfile
  ports:
    - "3007:3007"
  environment:
    - PORT=3007
    - DATABASE_URL=postgresql://erp:erp@postgres:5432/erp_equipment?schema=ocr
    - OCR_ENGINE_URL=http://ocr-engine:8000
    - EQUIPMENT_SERVICE_URL=http://equipment-service:3005
    - AUTH_SERVICE_URL=http://auth-service:3001
    - INTERNAL_API_TOKEN=${INTERNAL_API_TOKEN}
    - JWT_SECRET=${JWT_SECRET}
    - UPLOAD_DIR=/app/uploads
  volumes:
    - ocr-uploads:/app/uploads
  depends_on:
    ocr-engine:
      condition: service_healthy
    postgres:
      condition: service_started

volumes:
  ocr-uploads:
```

---

## 10. 에러 처리

### 10.1 에러 코드

| 코드 | 메시지 | 원인 | 처리 |
|------|--------|------|------|
| 400 | INVALID_FILE_TYPE | 지원하지 않는 파일 형식 | "PNG, JPG, PDF만 지원합니다" |
| 400 | FILE_TOO_LARGE | 파일 크기 초과 | "최대 10MB까지 업로드 가능합니다" |
| 400 | TEMPLATE_NOT_FOUND | 문서 유형 없음 | "문서 유형을 선택해주세요" |
| 400 | RESULT_NOT_CONFIRMED | 미확인 상태에서 ERP 반영 시도 | "먼저 확인 완료해주세요" |
| 422 | OCR_ENGINE_FAILED | Python 엔진 오류 | "OCR 처리 실패. 이미지를 확인해주세요" |
| 502 | ERP_SERVICE_UNAVAILABLE | equipment-service 불가 | "ERP 서비스에 연결할 수 없습니다" |
| 502 | ERP_APPLY_FAILED | ERP 저장 실패 | "ERP 반영 실패: {상세 메시지}" |

### 10.2 에러 응답 형식

```json
{
  "error": {
    "code": "OCR_ENGINE_FAILED",
    "message": "OCR 처리에 실패했습니다. 이미지 품질을 확인해주세요.",
    "details": { "engineError": "Image too small for detection" }
  }
}
```

---

## 11. 보안

- 이미지 파일 검증: magic bytes 확인 (확장자 위조 방지)
- 파일 저장 시 원본 파일명 제거 → UUID로 저장
- uploads 디렉토리: 웹 직접 접근 불가 (API 통해서만 서빙)
- OCR 결과에 개인정보 포함 가능 → 로그에 필드값 미출력
- 모든 API: JWT 인증 필수
- ERP 반영: ADMIN/MANAGER 권한만

---

## 12. 구현 순서

### Phase 1: 기반 구축 (독립 동작)
1. [ ] `services/ocr` Node.js 프로젝트 초기화 (Fastify + Prisma)
2. [ ] `services/ocr/engine` Python 프로젝트 초기화 (FastAPI + PaddleOCR)
3. [ ] Docker Compose에 ocr-engine, ocr-service 추가
4. [ ] DB 스키마 생성 (`prisma migrate`)
5. [ ] `POST /api/v1/ocr/scan` — 이미지 업로드 → OCR 원본 결과 반환
6. [ ] 헬스체크 + 환경변수 검증

### Phase 2: 템플릿 + 매핑 엔진
7. [ ] DocumentTemplate / TemplateField CRUD API
8. [ ] 수입면장 템플릿 초기 데이터 (seed)
9. [ ] 키-값 쌍 추출 로직 (인접 텍스트 그룹핑)
10. [ ] 라벨-필드 매칭 엔진 (label + aliases)
11. [ ] 타입 변환 (NUMBER, DATE, BIZ_NO 등)
12. [ ] 문서 유형 자동 판별
13. [ ] 세금계산서, 견적서 등 추가 템플릿

### Phase 3: 확인/수정 UI
14. [ ] `/ocr` 이력 목록 페이지
15. [ ] `/ocr/scan` 업로드 + 스캔 화면
16. [ ] OcrImageViewer 컴포넌트 (확대/축소/회전)
17. [ ] OcrFieldForm 컴포넌트 (필드 양식 + 신뢰도 뱃지)
18. [ ] 필드 클릭 ↔ 이미지 하이라이트 연동
19. [ ] 필드 수정 + 확인 완료 API 연동
20. [ ] 임시저장 기능

### Phase 4: ERP 연동
21. [ ] equipment-service 클라이언트 (`equipment.client.ts`)
22. [ ] `POST /api/v1/ocr/results/:id/apply` — ERP 반영
23. [ ] 수입면장 → ImportCostSettlement 매핑 완성
24. [ ] 인보이스 → OverseasOrder 매칭
25. [ ] 연동 성공/실패 UI 피드백

### Phase 5: 학습 데이터 + 통계
26. [ ] OcrCorrection 자동 저장 (수정 시)
27. [ ] 학습 데이터 내보내기 API (PaddleOCR 형식)
28. [ ] 통계 대시보드 (문서 유형별 정확도, 수정률)
29. [ ] `/ocr/templates` 관리자 화면

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-04-15 | 초기 Design 작성 | AI + Team |
