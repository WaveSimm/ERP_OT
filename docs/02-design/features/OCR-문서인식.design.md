# [Design] OCR 문서인식 (OCR Document Recognition)

> **Feature**: OCR-문서인식
> **Phase**: Design
> **Created**: 2026-04-15
> **Updated**: 2026-04-20
> **Status**: Design v2.1
> **Plan Reference**: `docs/01-plan/features/OCR-문서인식.plan.md` (v1.0)

---

> ⚠️ **중요 변경사항 (2026-04-20)**
> - **dots-ocr (GPU VLM) 완전 제거**: 하드웨어(GPU) 요구사항으로 현 환경에서 개발 불가 판단
> - 아래 문서 내 `dots-ocr`, `rednote-hilab/dots.ocr`, `vLLM`, `port 8100`, `dots_ocr_models` 관련 모든 내용은 **DEPRECATED** — 유지만 참고용으로 남겨둠
> - 현재 운영 엔진: **PaddleOCR (로컬) + Claude Vision + CLOVA OCR (Cloud API)**
> - 복원 필요 시: `git log --oneline -- services/ocr/dots-ocr` 참고

---

## 1. 아키텍처 결정

### 1.1 서비스 구성

2개 컨테이너 + 선택적 Cloud API — 멀티 OCR 엔진(Python), API 서버(Node.js):

| 컴포넌트 | 런타임 | 포트 | 역할 |
|----------|--------|------|------|
| ocr-service | Node.js + Fastify | 3007 | API 서버, 템플릿 관리, 매핑 로직, ERP 연동 |
| ocr-engine | Python + FastAPI | 8000 | 멀티 엔진 OCR (PaddleOCR + Cloud Fallback), 이미지→텍스트+좌표 추출 |

> **포트**: 3006은 approval-service → ocr-service는 3007
> **제거 이력** (2026-04-20): GPU 기반 dots-ocr VLM(8100)은 하드웨어 요구사항으로 삭제. 고품질 인식은 Claude Vision / CLOVA OCR API 사용

```
erp-ot-platform/
├── services/
│   └── ocr/                          ★ 구현 완료 (Phase 1-2)
│       ├── prisma/
│       │   ├── schema.prisma         # OCR 전용 스키마
│       │   └── seed.ts               # 6종 문서 템플릿 + 필드 + aliases 초기 데이터
│       ├── src/                      # Node.js API 서버
│       │   ├── api/
│       │   │   ├── middleware/
│       │   │   │   └── auth.middleware.ts    # JWT 인증 미들웨어
│       │   │   └── routes/
│       │   │       ├── ocr.routes.ts         # OCR 스캔/결과/엔진 라우트
│       │   │       └── template.routes.ts    # 템플릿 CRUD 라우트
│       │   ├── application/
│       │   │   ├── ocr.service.ts           # OCR 파이프라인 오케스트레이션
│       │   │   ├── mapping.service.ts       # 필드 매핑 엔진 (퍼지 매칭 포함)
│       │   │   ├── template.service.ts      # 문서 템플릿 CRUD
│       │   │   └── correction.service.ts    # 수정 이력 관리
│       │   ├── infrastructure/
│       │   │   ├── engines/
│       │   │   │   ├── engine.interface.ts  # OcrEngine + EngineInfo 인터페이스
│       │   │   │   └── paddle-ocr.client.ts # Python sidecar 멀티엔진 클라이언트
│       │   │   └── erp/
│       │   │       └── equipment.client.ts  # equipment-service 연동
│       │   ├── config/
│       │   │   └── env.ts                   # 환경변수 Zod 검증
│       │   └── index.ts
│       ├── engine/                    # Python 멀티 OCR 엔진
│       │   ├── main.py                # FastAPI v2.0 (엔진 선택 지원)
│       │   ├── ocr_handler.py         # 멀티 엔진 핸들러 (9종)
│       │   ├── preprocessor.py        # 이미지 전처리 (CLAHE, PDF 지원)
│       │   ├── requirements.txt       # paddleocr, easyocr, pytesseract, httpx
│       │   └── Dockerfile             # tesseract-ocr 패키지 포함
│       ├── test-ui/                   # 개발용 테스트 UI
│       │   └── index.html             # 싱글 스캔 + 엔진 비교 모드
│       ├── uploads/                   # 업로드 이미지 (volume mount)
│       ├── Dockerfile                 # Node.js 서버
│       ├── package.json
│       └── tsconfig.json
└── apps/web/src/app/ocr/             ★ ERP UI (Phase 3 예정)
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
            └─────┬──────┘  └───────────┘  └──────────┘
                  │ HTTP (선택적)
                  ▼
            ┌────────────┐
            │  dots-ocr  │  GPU VLM 1.7B (프로파일: gpu)
            │  port 8100 │  rednote-hilab/dots.ocr via vLLM
            └────────────┘
```

### 1.4 멀티 엔진 아키텍처 (v2.0 신규)

ocr-engine(Python FastAPI)이 9종 엔진을 멀티플렉싱:

| 엔진 ID | 그룹 | 언어 | 런타임 | 비고 |
|----------|------|------|--------|------|
| paddle-ko | PaddleOCR | 한국어 | CPU (in-process) | 기본 엔진 |
| paddle-en | PaddleOCR | 영어 | CPU (in-process) | |
| paddle-ja | PaddleOCR | 일본어 | CPU (in-process) | |
| paddle-zh | PaddleOCR | 중국어 | CPU (in-process) | |
| easy-ko | EasyOCR | 한+영 | CPU (in-process) | |
| easy-en | EasyOCR | 영어 | CPU (in-process) | |
| tess-ko | Tesseract | 한+영 | CPU (in-process) | |
| tess-en | Tesseract | 영어 | CPU (in-process) | |
| claude-vision | Claude Vision | 다국어 | Cloud API | Anthropic API 키 필요 |
| clova-ocr | CLOVA OCR | 한/영/일 | Cloud API | Naver CLOVA 키 필요 |

**엔진 선택 전략:**
- 기본값: `paddle-ko` (한글 정형 문서 최적)
- 영문 인보이스: `paddle-en` 또는 `easy-en`
- 고품질 필요 시: `claude-vision` 또는 `clova-ocr` (Cloud API)
- 비교 모드: 여러 엔진 병렬 실행 후 최고 신뢰도 선택
- ~~GPU VLM (dots-ocr)~~: 2026-04-20 제거 (하드웨어 요구사항)

| From | To | 경로 | 용도 |
|------|----|------|------|
| ocr-service | ocr-engine | `POST /ocr/scan?engine={id}` | 이미지 OCR 처리 (엔진 선택) |
| ocr-service | ocr-engine | `GET /engines` | 사용 가능 엔진 목록 |
| ocr-engine | dots-ocr | `POST /v1/chat/completions` | VLM OCR (OpenAI 호환 API) |
| ocr-service | equipment-service | `POST /api/v1/import-costs` | 수입원가정산 저장 |
| ocr-service | equipment-service | `POST /api/v1/overseas-orders` | 발주 저장 |
| ocr-service | equipment-service | `POST /api/v1/inventory` | 재고 입고 |
| ocr-service | auth-service | `GET /internal/users/me` | 사용자 인증 |

### 1.5 next.config.mjs 리라이트 추가

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

## 3. Python OCR 엔진 (ocr-engine) — 멀티 엔진 v2.0

### 3.1 FastAPI 엔드포인트

```python
# engine/main.py (v2.0)

@app.post("/ocr/scan")
async def scan_image(file: UploadFile, engine: str = "paddle-ko") -> OcrScanResponse:
    """이미지 → 텍스트 + 좌표 + 신뢰도 추출 (엔진 선택 가능)"""

@app.get("/engines")
async def list_engines() -> list[EngineInfo]:
    """사용 가능한 OCR 엔진 목록 (ready 상태 포함)"""

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
    engine_id: str              # 사용된 엔진 ID
    texts: list[TextBlock]
    image_width: int
    image_height: int
    processing_time_ms: int

class EngineInfo(BaseModel):
    id: str                     # "paddle-ko", "easy-en", "dots-ocr"
    name: str                   # "PaddleOCR Korean"
    group: str                  # "PaddleOCR", "EasyOCR", "Tesseract", "dots.ocr"
    lang: str                   # "korean", "en", "multi-100+"
    ready: bool                 # 현재 사용 가능 여부
```

### 3.3 멀티 엔진 핸들러 (ocr_handler.py)

```python
class OcrHandler:
    """멀티 엔진/모델 OCR 핸들러 — lazy-loaded engine cache"""

    def __init__(self, model_dir: str = "/app/models"):
        self._engines: dict = {}  # 엔진별 인스턴스 캐시

    def get_available_engines(self) -> list[dict]:
        """PaddleOCR(항상) + EasyOCR(import 확인) + Tesseract(바이너리 확인) + dots.ocr(HTTP 헬스체크)"""

    def detect(self, image: np.ndarray, engine_id: str = "paddle-ko") -> list:
        """엔진 디스패치 → 통일된 포맷 [box_coords, (text, confidence)]"""

    # 결과 정규화: 모든 엔진이 PaddleOCR 형식으로 통일
    # EasyOCR: [(bbox, text, conf)] → [[bbox, (text, conf)]]
    # Tesseract: word-level data → 4점 좌표 변환
    # dots.ocr: VLM 텍스트 → 줄별 가상 바운딩박스 생성
```

**엔진별 특성:**

| 엔진 | 장점 | 단점 | 적합 용도 |
|------|------|------|-----------|
| PaddleOCR | 한글 우수, 빠름 | 영문 약간 약함 | 한글 정형 문서 (기본) |
| EasyOCR | 다국어 안정적 | PaddleOCR보다 느림 | 혼합 언어 문서 |
| Tesseract | 가볍고 빠름 | 한글 정확도 낮음 | 영문 위주 문서 |
| dots.ocr | 최고 품질 (VLM) | GPU 필수, 느림 | 고품질 필요 시, 복잡 레이아웃 |

### 3.4 이미지 전처리 (preprocessor.py)

```python
class ImagePreprocessor:
    def process(self, image_bytes: bytes) -> np.ndarray:
        """OCR 정확도를 높이기 위한 전처리 파이프라인"""
        # 1. 파일 형식 감지 (PNG/JPEG/PDF)
        # 2. PDF → 첫 페이지 이미지 변환 (pdf2image)
        # 3. 대비 향상 (CLAHE — clipLimit=2.0)
        # 4. RGB → OpenCV 배열 변환
```

### 3.5 Dockerfile (ocr-engine)

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libgomp1 curl poppler-utils \
    tesseract-ocr tesseract-ocr-kor tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**requirements.txt:**
```
fastapi==0.111.0
uvicorn[standard]==0.30.1
python-multipart==0.0.9
paddleocr==2.8.1
paddlepaddle==2.6.2
opencv-python-headless==4.10.0.84
Pillow==10.4.0
numpy==1.26.4
pdf2image==1.17.0
easyocr==1.7.2
pytesseract==0.3.13
httpx==0.28.1
```

### 3.6 dots.ocr GPU 컨테이너 (선택적)

```dockerfile
# services/ocr/dots-ocr/Dockerfile
FROM vllm/vllm-openai:latest

ENV HF_HOME=/app/models
ENV VLLM_WORKER_MULTIPROC_METHOD=spawn

EXPOSE 8100

CMD ["--model", "rednote-hilab/dots.ocr", \
     "--served-model-name", "dots-ocr", \
     "--host", "0.0.0.0", \
     "--port", "8100", \
     "--tensor-parallel-size", "1", \
     "--gpu-memory-utilization", "0.85", \
     "--max-model-len", "4096", \
     "--chat-template-content-format", "string", \
     "--trust-remote-code"]
```

**특징:**
- rednote-hilab/dots.ocr: 1.7B VLM, 100+ 언어 지원
- OpenAI 호환 Chat Completion API (`/v1/chat/completions`)
- 첫 실행 시 ~3.5GB 모델 자동 다운로드 (이후 캐시)
- NVIDIA GPU 필요 (RTX 5060 이상 권장, VRAM 8GB+)
- Docker Compose `profiles: [gpu]`로 선택적 기동

---

## 4. API 명세 (ocr-service, Node.js)

### 4.1 엔드포인트 목록

| Method | Path | 설명 | 인증 |
|--------|------|------|------|
| **OCR 처리** |
| POST | `/api/v1/ocr/scan` | 이미지 업로드 + OCR 처리 + 자동 매핑 (DB 저장) | Required |
| POST | `/api/v1/ocr/scan/raw` | 이미지 → OCR 원본 결과만 반환 (DB 미저장) | Required |
| GET | `/api/v1/ocr/engines` | 사용 가능 OCR 엔진 목록 | Public |
| GET | `/api/v1/ocr/results` | 처리 이력 목록 (필터/페이징) | Required |
| GET | `/api/v1/ocr/results/:id` | 처리 결과 상세 (필드 포함) | Required |
| GET | `/api/v1/ocr/results/:id/image` | 원본 이미지 서빙 | Required |
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
| file | File | ✅ | 이미지 파일 (PNG/JPG/PDF, 최대 10MB) |
| templateCode | string | | 문서 유형 코드 (생략 시 자동 판별) |
| engineId | string | | OCR 엔진 ID (기본: `paddle-ko`) |

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

### 5.1 매핑 파이프라인 (2-pass 전략)

```typescript
class MappingService {
  mapFields(
    ocrTexts: TextBlock[],
    templateFields: TemplateFieldDef[]
  ): MappedField[] {

    // Pass 1: 라벨 근접 매칭 (Primary)
    //   - 모든 텍스트 블록에서 label/aliases 매칭 라벨 탐색
    //   - 라벨 발견 시, 오른쪽/아래 근접 블록을 값으로 추출
    //   - 퍼지 매칭 (70% 임계) 으로 OCR 오인식 대응
    //   - 사용된 블록 추적 → 중복 방지

    // Pass 2: 키-값 쌍 추출 (Fallback)
    //   - Pass 1에서 매핑 안 된 필드에 대해
    //   - 전체 텍스트에서 패턴 기반 매칭 시도
    //   - 타입별 검증 (DATE: 날짜 패턴, NUMBER: 숫자 패턴)

    // 신뢰도 계산: 매칭 방법 + OCR 신뢰도 + 검증 결과 종합
    return mappedFields;
  }
}
```

### 5.2 라벨 근접 매칭 알고리즘 (구현 완료)

```
1. 전처리: OCR 블록 텍스트에서 선행 숫자/기호 제거
   "5부가가치세과" → "부가가치세과"
   "12. 관세" → "관세"

2. 라벨 탐색: 각 블록을 label + aliases와 매칭
   - 정확 매칭 (includes): 우선
   - 퍼지 매칭 (70% 임계): OCR 오인식 대응
   - 가장 긴 매칭 우선 (matchLen 기준) → "Total Invoice Amount" > "Total"

3. 값 추출: 라벨 블록 기준 근접 블록 탐색
   - 오른쪽 근접 (같은 줄): X거리 < threshold
   - 아래 근접 (테이블 구조): Y거리 < threshold
   - 값 검증: 타입별 유효성 확인

4. 값 검증 (isValidValue):
   - DATE: 2자리 이상 연속 숫자 필요 ("Page 1 of 1" 거부)
   - NUMBER: HS 코드 패턴(^\d+-\d+-\d+) 거부
   - 공통: 라벨과 동일 텍스트 거부

5. 중복 방지: 사용된 블록(usedBlocks Set)은 재사용 불가
```

### 5.3 퍼지 매칭 (fuzzyMatch)

```typescript
// OCR 오인식 보정용 — 70% 문자 일치율 기준
private fuzzyMatch(a: string, b: string): number {
  if (a.includes(b) || b.includes(a)) return 1.0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < longer.length * 0.5) return 0;
  // 슬라이딩 윈도우: shorter를 longer 위에서 이동하며 최대 일치 탐색
  let bestMatch = 0;
  for (let offset = 0; offset <= longer.length - shorter.length; offset++) {
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (shorter[i] === longer[offset + i]) matches++;
    }
    bestMatch = Math.max(bestMatch, matches / shorter.length);
  }
  return bestMatch;
}
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
| `USE_GPU` | PaddleOCR GPU 사용 여부 | false |
| `MODEL_DIR` | 모델 저장 경로 | /app/models |
| `LANG` | 기본 OCR 언어 | korean |
| `DOTS_OCR_URL` | dots.ocr VLM 서비스 URL | (빈 값 = 비활성) |

### 8.3 dots-ocr (GPU VLM, 선택적)

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `HF_HOME` | HuggingFace 모델 캐시 | /app/models |
| `VLLM_WORKER_MULTIPROC_METHOD` | vLLM 프로세스 방식 | spawn |

---

## 9. Docker Compose 구성 (구현 완료)

```yaml
# docker-compose.yml — 실제 구성

ocr-engine:
  build:
    context: ./services/ocr/engine
    dockerfile: Dockerfile
  container_name: erp-ot-ocr-engine
  environment:
    USE_GPU: "false"
    LANG: korean
    MODEL_DIR: /app/models
    DOTS_OCR_URL: http://dots-ocr:8100    # VLM 엔진 연결
  ports:
    - "8000:8000"
  volumes:
    - ocr_models:/app/models
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
    interval: 30s
    timeout: 10s
    retries: 5
    start_period: 60s

# dots.ocr — GPU 기반 VLM (선택적, --profile gpu)
dots-ocr:
  build:
    context: services/ocr/dots-ocr
  container_name: erp-ot-dots-ocr
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
  environment:
    HF_HOME: /app/models
  ports:
    - "8100:8100"
  volumes:
    - dots_ocr_models:/app/models
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8100/health"]
    interval: 30s
    timeout: 10s
    retries: 10
    start_period: 180s              # 모델 로딩 시간
  profiles:
    - gpu                           # docker compose --profile gpu up 으로만 기동

ocr-service:
  build:
    context: .
    dockerfile: services/ocr/Dockerfile
  container_name: erp-ot-ocr
  environment:
    PORT: 3007
    DATABASE_URL: postgresql://...?schema=ocr
    OCR_ENGINE_URL: http://ocr-engine:8000
    DOTS_OCR_URL: http://dots-ocr:8100
    EQUIPMENT_SERVICE_URL: http://equipment-service:3005
    AUTH_SERVICE_URL: http://auth-service:3001
    INTERNAL_API_TOKEN: ${INTERNAL_API_TOKEN}
    CORS_ORIGIN: "*"
    UPLOAD_DIR: /app/uploads
    MAX_FILE_SIZE_MB: "10"
  ports:
    - "3007:3007"
  volumes:
    - ocr_uploads:/app/uploads
  depends_on:
    ocr-engine:
      condition: service_healthy
    postgres:
      condition: service_started
    auth-service:
      condition: service_started

volumes:
  ocr_uploads:
  ocr_models:
  dots_ocr_models:
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

## 12. 구현 순서 및 진행 상태

### Phase 1: 기반 구축 (독립 동작) ✅ 완료
1. [x] `services/ocr` Node.js 프로젝트 초기화 (Fastify + Prisma)
2. [x] `services/ocr/engine` Python 프로젝트 초기화 (FastAPI + PaddleOCR)
3. [x] Docker Compose에 ocr-engine, ocr-service, dots-ocr 추가
4. [x] DB 스키마 생성 (`prisma migrate`) — ocr 스키마
5. [x] `POST /api/v1/ocr/scan` — 이미지 업로드 → OCR 원본 결과 반환
6. [x] 헬스체크 + 환경변수 검증
7. [x] 테스트 UI (test-ui/index.html) — localhost:9090

### Phase 2: 템플릿 + 매핑 + 멀티 엔진 ✅ 완료
8. [x] DocumentTemplate / TemplateField CRUD API
9. [x] 6종 문서 템플릿 초기 데이터 (seed.ts)
10. [x] 라벨 근접 매칭 엔진 (2-pass 전략)
11. [x] 퍼지 매칭 (70% 임계) — OCR 오인식 대응
12. [x] 타입 변환 (NUMBER, DATE, BIZ_NO, CURRENCY 등)
13. [x] 문서 유형 자동 판별 (키워드 기반)
14. [x] 멀티 OCR 엔진 통합 (PaddleOCR 4종 + EasyOCR 2종 + Tesseract 2종)
15. [x] dots.ocr VLM 통합 (GPU 컨테이너, 선택적)
16. [x] `GET /engines` — 엔진 목록 API
17. [x] `POST /scan/raw` — DB 미저장 직접 스캔 API
18. [x] 엔진 비교 테스트 UI (Compare Models 탭)
19. [x] 수입면장 실문서 검증 (10/14 필드 정확 매핑)
20. [x] 인보이스 실문서 검증 (7~8/9 필드 정확 매핑)

### Phase 3: 확인/수정 UI (ERP 통합) — 미착수
21. [ ] `/ocr` 이력 목록 페이지
22. [ ] `/ocr/scan` 업로드 + 스캔 화면
23. [ ] OcrImageViewer 컴포넌트 (확대/축소/회전)
24. [ ] OcrFieldForm 컴포넌트 (필드 양식 + 신뢰도 뱃지)
25. [ ] 필드 클릭 ↔ 이미지 하이라이트 연동
26. [ ] 필드 수정 + 확인 완료 API 연동
27. [ ] 임시저장 기능

### Phase 4: ERP 연동 — 미착수
28. [ ] equipment-service 클라이언트 (`equipment.client.ts`)
29. [ ] `POST /api/v1/ocr/results/:id/apply` — ERP 반영
30. [ ] 수입면장 → ImportCostSettlement 매핑 완성
31. [ ] 인보이스 → OverseasOrder 매칭
32. [ ] 연동 성공/실패 UI 피드백

### Phase 5: 학습 데이터 + 통계 — 미착수
33. [ ] OcrCorrection 자동 저장 (수정 시)
34. [ ] 학습 데이터 내보내기 API (PaddleOCR 형식)
35. [ ] 통계 대시보드 (문서 유형별 정확도, 수정률)
36. [ ] `/ocr/templates` 관리자 화면

---

## 13. 테스트 UI (개발용)

### 13.1 싱글 스캔 모드

문서 업로드 → 템플릿 선택 → 엔진 선택 → OCR 처리 → 필드 매핑 결과 표시

### 13.2 엔진 비교 모드 (Compare Models)

- 파일 업로드 + 여러 엔진 체크박스 선택
- 병렬 OCR 실행 (각 엔진별 `/scan/raw` 호출)
- 결과 비교: 인식 블록 수, 처리 시간, 평균 신뢰도
- 엔진별 상세 텍스트 결과 테이블
- 최고 성능 엔진 자동 하이라이트

**엔진 그룹 색상:**
- PaddleOCR: 파란색 (#3b82f6)
- EasyOCR: 보라색 (#a855f7)
- Tesseract: 주황색 (#f97316)
- dots.ocr: 초록색 (#10b981)

접근: `http://localhost:9090` (별도 정적 파일 서빙)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-04-15 | 초기 Design 작성 | AI + Team |
| 2.0 | 2026-04-15 | 멀티 엔진 아키텍처(9종), dots.ocr VLM, 퍼지 매칭, 비교 UI, 구현 상태 반영 | AI + Team |
