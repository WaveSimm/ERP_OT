# [Plan] OCR 문서인식 (OCR Document Recognition)

> **Feature**: OCR-문서인식
> **Phase**: Plan
> **Created**: 2026-04-15
> **Updated**: 2026-04-15
> **Status**: Plan v1.0
> **Author**: AI + Team

---

## 1. 개요 (Overview)

재무/구매 업무에서 사용하는 정형 문서(수입면장, 세금계산서, 견적서, 거래명세서 등)를 OCR로 자동 인식하여, 미리 정의된 양식 필드에 매핑한 뒤 사용자가 확인/수정 후 ERP에 반영하는 시스템.

### 배경 (Background)

현재 문제:
- 수입면장, 세금계산서 등의 데이터를 **수동 타이핑**하여 ERP에 입력
- 금액, 수량, 날짜 등 숫자 데이터에서 **입력 오류 빈번**
- 동일 데이터를 여러 화면에 중복 입력하는 비효율
- 모니터에 띄운 문서를 보면서 다른 화면에 타이핑하는 작업 방식

해결 방향:
- 문서 이미지/스크린샷 → OCR 자동 인식 → 정의된 필드에 자동 매핑
- 사용자는 **빨간색(저신뢰) 필드만 집중 확인/수정** → ERP 반영
- 수정 이력이 학습 데이터로 축적 → 시간이 지날수록 정확도 향상

### 개발 방식

- **단독 개발**: 1인 개발, 모노레포 내 독립 서비스(`services/ocr`)
- **독립 우선, 연동 고려**: 초기에는 OCR 엔진 + 확인 UI를 독립적으로 완성한 뒤, 기존 ERP(구매-재고-결재 등)와 연동
- **ERP 참조**: 개발 과정에서 기존 ERP의 필드 구조, API 규격을 참조하여 매핑 설계

---

## 2. 범위 (Scope)

### 2.1 In Scope

- [ ] OCR 엔진 통합 (PaddleOCR 로컬 처리)
- [ ] 문서 유형별 템플릿/필드 정의 시스템
- [ ] OCR 결과 → ERP 필드 자동 매핑 (키-값 추출 + 템플릿 매칭)
- [ ] 이미지 뷰어 + 필드 확인/수정 UI (좌: 원본, 우: 필드 양식)
- [ ] 신뢰도 표시 (✓ 녹색 / △ 노란 / ✗ 빨간)
- [ ] 사용자 수정 이력 저장 (학습 데이터 축적)
- [ ] 문서 유형 자동/수동 판별
- [ ] ERP API 연동 인터페이스 (equipment-service 등)
- [ ] Docker Compose 서비스 추가 (ocr-service)

### 2.2 Out of Scope (v1.0)

- 오프라인 영수증 (비정형) 인식
- Fine-tuning 자동화 파이프라인 (v2.0에서 수동 → 자동)
- 클라우드 OCR API 연동 (향후 엔진 추가로 대응)
- 모바일 카메라 촬영 연동
- 결재 워크플로우 (기존 ERP 결재 시스템 활용)

---

## 3. 요구사항 (Requirements)

### 3.1 기능 요구사항

| ID | 요구사항 | 우선순위 | 상태 |
|----|----------|----------|------|
| FR-01 | 이미지 업로드 (PNG/JPG/PDF) → OCR 텍스트+좌표 추출 | High | Pending |
| FR-02 | 문서 유형별 필드 템플릿 정의/관리 | High | Pending |
| FR-03 | OCR 결과 → 템플릿 필드 자동 매핑 (라벨-값 매칭) | High | Pending |
| FR-04 | 확인/수정 UI (좌: 이미지 뷰어, 우: 필드 양식) | High | Pending |
| FR-05 | 필드별 신뢰도 표시 (≥0.95 녹색, 0.80~0.95 노란, <0.80 빨간) | High | Pending |
| FR-06 | 필드 클릭 시 원본 이미지 해당 영역 하이라이트 | Medium | Pending |
| FR-07 | 확인 완료 시 ERP API 호출 (데이터 저장) | High | Pending |
| FR-08 | 사용자 수정 이력 저장 (원본값, 수정값, 이미지 좌표) | Medium | Pending |
| FR-09 | 문서 유형 자동 판별 (키워드 기반) | Medium | Pending |
| FR-10 | 임시저장 기능 (확인 전 중간 저장) | Low | Pending |
| FR-11 | 처리 이력 조회 (날짜, 문서 유형, 상태별 필터) | Medium | Pending |

### 3.2 비기능 요구사항

| 카테고리 | 기준 | 측정 방법 |
|----------|------|-----------|
| 성능 | 이미지 1장 OCR 처리 ≤ 3초 (CPU) | 서버 로그 |
| 정확도 | 정형 문서 필드 매핑 정확도 ≥ 85% (초기) | 수정률 통계 |
| 확장성 | 새 문서 유형 추가 = 설정 파일 1개 추가 (코드 수정 없음) | 템플릿 추가 테스트 |
| 보안 | 이미지 데이터 로컬 처리만, 외부 전송 없음 | 네트워크 모니터링 |
| 학습 | 수정 데이터 300건 축적 후 Fine-tuning 가능 | 학습 DB 카운트 |

---

## 4. 핵심 도메인 개념

### 4.1 문서 유형 및 필드 정의

**지원 문서 유형 (v1.0)**:

| 문서 유형 | 코드 | 주요 필드 | ERP 연동 대상 |
|-----------|------|-----------|---------------|
| 수입면장 | IMPORT_DECLARATION | 면장번호, 신고일, 수입자, 품목, 수량, 단가(USD), 총액, 환율, 관세, 부가세 | ImportCostSettlement |
| 세금계산서 | TAX_INVOICE | 계산서번호, 작성일, 공급자, 사업자번호, 공급가액, 세액, 합계 | ImportCostSettlement.expenses |
| 견적서 | QUOTATION | 견적번호, 일자, 공급자, 품목, 수량, 단가, 합계, 유효기간 | OverseasOrder 참조 |
| 거래명세서 | DELIVERY_NOTE | 명세서번호, 일자, 공급자, 품목, 수량, 단가, 합계 | InventoryItem 입고 |
| 인보이스 | INVOICE | Invoice#, Date, Supplier, Items, Qty, Unit Price, Total, Currency | OverseasOrder.invoiceNo |
| 발주서 | PURCHASE_ORDER | 발주번호, 일자, 발주처, 품목, 수량, 단가, 합계 | OverseasOrder |

### 4.2 문서 템플릿 구조

```
DocumentTemplate (문서 템플릿)
├── id
├── code: 'IMPORT_DECLARATION' | 'TAX_INVOICE' | ...
├── name: '수입면장'
├── fields[]: TemplateField[]
│   ├── key: 'declarationNo'
│   ├── label: '면장번호'          ← OCR 라벨 매칭 키워드
│   ├── aliases: ['신고번호', '면장No']  ← 대체 라벨
│   ├── type: 'string' | 'number' | 'date' | 'bizNo' | 'currency'
│   ├── required: true/false
│   └── validation: regex 또는 범위
├── targetService: 'equipment-service'
├── targetEndpoint: '/api/v1/import-costs'
└── fieldMapping: { declarationNo → ERP필드명 }
```

### 4.3 OCR 처리 결과

```
OcrResult (OCR 처리 결과)
├── id
├── templateCode: 문서 유형
├── originalImage: 원본 이미지 경로
├── status: PENDING | CONFIRMED | SAVED_TO_ERP
├── fields[]: OcrFieldResult[]
│   ├── key: 'declarationNo'
│   ├── ocrValue: OCR 인식 원본값
│   ├── confirmedValue: 사용자 확인/수정값
│   ├── confidence: 0.0~1.0
│   ├── boundingBox: { x, y, width, height }  ← 이미지 좌표
│   └── isModified: boolean
├── createdAt
├── confirmedAt
└── confirmedBy
```

### 4.4 학습 데이터

```
OcrCorrection (수정 이력 = 학습 데이터)
├── id
├── ocrResultId: FK
├── fieldKey: 수정된 필드
├── originalValue: OCR 원본값
├── correctedValue: 사용자 수정값
├── confidence: 원본 신뢰도
├── boundingBox: 이미지 영역
├── templateCode: 문서 유형
└── createdAt
```

---

## 5. 아키텍처 (Architecture)

### 5.1 서비스 위치

```
erp-ot-platform/
├── services/
│   ├── auth/           (기존)
│   ├── user/           (기존)
│   ├── equipment/      (기존 — 구매/재고)
│   └── ocr/            ★ 신규
│       ├── prisma/
│       │   └── schema.prisma     ← OCR 전용 DB 스키마
│       ├── src/
│       │   ├── api/
│       │   │   ├── routes/
│       │   │   └── dtos/
│       │   ├── application/
│       │   │   ├── ocr.service.ts
│       │   │   ├── template.service.ts
│       │   │   └── correction.service.ts
│       │   ├── domain/
│       │   │   └── entities/
│       │   ├── infrastructure/
│       │   │   └── engines/
│       │   │       ├── engine.interface.ts   ← 공통 인터페이스
│       │   │       ├── paddle-ocr.engine.ts  ← PaddleOCR 래퍼
│       │   │       └── (향후 추가 엔진)
│       │   └── config/
│       │       └── templates/               ← 문서 유형별 필드 정의 JSON
│       ├── uploads/                         ← 업로드 이미지 저장
│       ├── models/                          ← PaddleOCR 모델 파일
│       │   ├── base/                        ← 기본 모델
│       │   └── custom/                      ← Fine-tuning 모델
│       ├── Dockerfile
│       ├── package.json
│       └── tsconfig.json
└── apps/web/src/app/ocr/                    ★ OCR UI (향후 연동)
```

### 5.2 엔진 인터페이스 (교체 가능 설계)

```typescript
// engine.interface.ts
interface OcrEngine {
  scan(image: Buffer, options?: ScanOptions): Promise<OcrRawResult>
}

interface OcrRawResult {
  texts: Array<{
    text: string
    confidence: number
    boundingBox: { x: number, y: number, width: number, height: number }
  }>
}
```

모든 엔진이 동일 인터페이스를 구현 → 설정 변경만으로 엔진 교체 가능.

### 5.3 처리 파이프라인

```
[이미지 업로드]
    │
    ▼
[전처리] 이미지 보정 (회전, 노이즈 제거, 이진화)
    │
    ▼
[OCR 엔진] PaddleOCR → 텍스트 + 좌표 + 신뢰도 추출
    │
    ▼
[키-값 추출] 인접 텍스트 그룹핑 → { label: value } 쌍 생성
    │
    ▼
[문서 유형 판별] 키워드 기반 자동 판별 (또는 사용자 선택)
    │
    ▼
[필드 매핑] 문서 템플릿의 label/aliases와 매칭 → ERP 필드에 매핑
    │
    ▼
[타입 변환] string→number, 날짜 포맷 통일, 사업자번호 형식 검증
    │
    ▼
[확인/수정 UI] 사용자 검증 → 수정 시 correction 데이터 저장
    │
    ▼
[ERP 반영] equipment-service API 호출 → DB 저장
```

### 5.4 ERP 연동 방식

```
ocr-service (Port: 3006)
    │
    ├── 독립 API: POST /api/v1/ocr/scan (이미지 → OCR 결과)
    ├── 독립 API: GET  /api/v1/ocr/templates (문서 유형 목록)
    ├── 독립 API: GET  /api/v1/ocr/results/:id (처리 결과 조회)
    │
    └── ERP 연동 API: POST /api/v1/ocr/results/:id/apply
         │
         └── 내부 HTTP 호출 → equipment-service (Port: 3005)
              ├── POST /api/v1/import-costs (수입원가정산)
              ├── POST /api/v1/purchase-orders (발주)
              └── POST /api/v1/inventory (재고 입고)
```

**핵심**: ocr-service는 OCR + 매핑만 담당. 실제 데이터 저장은 기존 ERP 서비스가 수행.

### 5.5 Docker Compose 추가

```yaml
# docker-compose.yml에 추가
ocr-service:
  build: ./services/ocr
  ports:
    - "3006:3006"
  environment:
    - DATABASE_URL=postgresql://...?schema=ocr
    - EQUIPMENT_SERVICE_URL=http://equipment-service:3005
  volumes:
    - ./services/ocr/uploads:/app/uploads
    - ./services/ocr/models:/app/models
  depends_on:
    - postgres
```

### 5.6 PaddleOCR 기술 스택

```
ocr-service 내부:
├── Node.js + Fastify (API 서버)        ← 기존 ERP와 동일 패턴
├── Python + PaddleOCR (OCR 엔진)       ← 자식 프로세스 또는 gRPC
└── Prisma (OCR 전용 DB)               ← 기존 패턴 동일
```

**Node.js ↔ PaddleOCR(Python) 통신 방식**:

| 방식 | 장점 | 단점 | 추천 |
|------|------|------|------|
| child_process | 단순, 추가 서비스 없음 | 매 호출마다 Python 기동 오버헤드 | 초기 프로토타입 |
| Python FastAPI sidecar | 안정적, 모델 메모리 상주 | 서비스 하나 더 관리 | **v1.0 추천** |
| gRPC | 고성능, 타입 안전 | 구현 복잡 | v2.0 고려 |

**추천**: Python FastAPI를 sidecar로 두고, Node.js에서 HTTP 호출.

```
Docker Compose:
  ocr-service (Node.js:3006)  ──HTTP──→  ocr-engine (Python FastAPI:8000)
```

---

## 6. 구현 Phase 계획

### Phase 1: 기반 구축
- [ ] `services/ocr` 프로젝트 초기화 (Fastify + Prisma)
- [ ] PaddleOCR Python sidecar 설정 (FastAPI + Docker)
- [ ] 기본 OCR API: 이미지 업로드 → 텍스트+좌표 반환
- [ ] DB 스키마: OcrResult, OcrFieldResult

### Phase 2: 템플릿 + 필드 매핑
- [ ] 문서 유형 템플릿 시스템 구현 (JSON 기반)
- [ ] 키-값 추출 로직 (인접 텍스트 그룹핑)
- [ ] 라벨-필드 매칭 엔진 (label + aliases 매칭)
- [ ] 타입 변환/검증 (number, date, bizNo 등)
- [ ] 수입면장 템플릿 정의 (첫 번째 문서 유형)

### Phase 3: 확인/수정 UI
- [ ] OCR 결과 확인 페이지 (좌: 이미지, 우: 필드 양식)
- [ ] 신뢰도별 색상 표시 (녹/노/빨)
- [ ] 필드 클릭 ↔ 이미지 영역 하이라이트 연동
- [ ] 임시저장 기능
- [ ] 처리 이력 목록/필터

### Phase 4: ERP 연동
- [ ] equipment-service API 호출 연동
- [ ] 수입면장 → ImportCostSettlement 매핑 완성
- [ ] 세금계산서, 견적서 등 추가 문서 유형 템플릿
- [ ] 연동 성공/실패 처리

### Phase 5: 학습 데이터 + 개선
- [ ] 수정 이력(OcrCorrection) 저장 로직
- [ ] 학습 데이터 내보내기 (PaddleOCR Fine-tuning 형식)
- [ ] 통계 대시보드 (문서 유형별 정확도, 수정률)
- [ ] Fine-tuning 가이드 문서 (개인 PC GPU 사용)

---

## 7. 리스크 및 완화

| 리스크 | 영향 | 가능성 | 완화 방안 |
|--------|------|--------|-----------|
| PaddleOCR 한글 정확도 부족 | High | Medium | 정형 양식은 라벨 위치 보조 활용, 저신뢰 필드 강조 |
| Python sidecar 관리 복잡 | Medium | Low | Docker Compose로 일괄 관리, 헬스체크 |
| 문서 양식 변경 시 매핑 깨짐 | Medium | Medium | aliases 목록으로 대응, 관리자 화면에서 템플릿 수정 |
| GPU 없는 서버에서 느린 처리 | Medium | Low | CPU 추론 충분 (1~2초/장), 배치 처리 지원 |
| 기존 ERP API 변경 시 연동 깨짐 | Medium | Low | 매핑을 설정으로 분리, API 버전 고정 |

---

## 8. 성공 지표

| 지표 | 목표값 | 측정 방법 |
|------|--------|-----------|
| 정형 문서 필드 인식 정확도 | ≥ 85% (초기), ≥ 95% (학습 후) | 수정률 통계 |
| OCR 처리 시간 | ≤ 3초/장 (CPU) | 서버 로그 |
| 데이터 입력 시간 절감 | 기존 대비 60% 단축 | 사용자 피드백 |
| 지원 문서 유형 | 6종 (v1.0) | 템플릿 수 |
| 사용자 수정 없이 통과율 | ≥ 70% (초기) | 무수정 확인 비율 |

---

## 9. 기술 결정 요약

| 결정 항목 | 선택 | 근거 |
|-----------|------|------|
| 프로젝트 구조 | 모노레포 내 `services/ocr` | 공유 타입/인프라 활용, 기존 패턴 일관성 |
| OCR 엔진 | PaddleOCR (로컬) | 무료, 한글 지원, Fine-tuning 가능, 보안(외부 전송 없음) |
| 엔진 래퍼 | Python FastAPI sidecar | 모델 메모리 상주, 안정적 |
| API 서버 | Node.js + Fastify | 기존 ERP 서비스와 동일 패턴 |
| ORM | Prisma | 기존 ERP와 동일 |
| DB | PostgreSQL (ocr 스키마) | 기존 인프라 활용 |
| UI | Next.js (apps/web 내) | 기존 ERP UI에 메뉴 추가 |
| 학습 환경 | 개인 PC (GPU) | 서비스 서버와 분리, Fine-tuning 전용 |
| 엔진 교체 | 인터페이스 기반 교체 가능 | 향후 CLOVA/Claude Vision 추가 대비 |

---

## 10. 다음 단계

1. [ ] Design 문서 작성 (`OCR-문서인식.design.md`)
2. [ ] `services/ocr` 프로젝트 초기화
3. [ ] PaddleOCR Docker 이미지 준비
4. [ ] 수입면장 샘플로 PoC 테스트

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-04-15 | 초기 Plan 작성 | AI + Team |
