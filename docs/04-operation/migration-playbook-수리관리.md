# 수리관리 엑셀 → ERP 이관 Playbook

- **작성일**: 2026-04-24
- **기반**: 수리현황 시트(20건) 이관 완료 + 사용자 수동 보정 관찰
- **대상**: 향후 수리완료 시트(1,084건) 이관 시 동일 패턴 적용

---

## 1. 사전 준비

### 1.1 ERP 필드 확장 (1회성, 이미 적용됨)

| 필드 | 위치 | 용도 |
|---|---|---|
| `shippingAssigneeName` | RepairOrder | 운송/발주 담당자 텍스트 |
| `stockedAt` | RepairOrder | 창고 입고일 |
| `handedToTechAt` | RepairOrder | 기술팀 인계일 |
| `quoteReceivedAt` | RepairOrder | Quote 수신일 |
| `quoteApprovedAt` | RepairOrder | 견적 확정일 |
| `poIssuedAt` | RepairOrder | 발주일 |
| `deliveryDueAt` | RepairOrder | 납기 |
| `mfgQuoteNumber/Amount/Currency` | RepairOrder | 제조사 견적 상세 |
| `mfgPoNumber/Amount/Currency` | RepairOrder | 제조사 발주 상세 |
| `decision1st/2nd + Reason` | RepairOrder | 1·2차 점검 판단 |
| `rmaNumber` | Shipment | 각 선적건의 RMA |

### 1.2 매핑 파일 (이관 파서 입력)

| 파일 | 내용 |
|---|---|
| `scripts/final_customer_map.json` | 엑셀 기관명 → Customer ID (158건, 44 신규 생성 완료) |
| `scripts/final_user_map.json` | 엑셀 담당자명 → User ID (32건, 5 신규 생성 완료) |
| `scripts/final_contact_map.json` | 엑셀 고객담당자 → CustomerContact ID (174건 대기, 사용자 중단) |

### 1.3 주요 override 결정 (사용자 지시 반영 완료)

**기관**:
- `인하대학교` → `인하대`
- `오션재고` → `오션테크`
- `오션테크(데모)` → `오션테크`
- 중복 통합: `㈜해원문화재연구소` → `해원문화재연구소`, `남동해 수산연구소` → `남동해수산연구소`
- EMPTY 3건 신규 생성: `새한항업`, `해군`, `바란산업`

**담당자**:
- `이학용(xxx)` / `이학용/xxx` → `이학용` ID
- `홍` → `홍다운`
- `부산지사` → `오원진`

---

## 2. 자동 이관 스크립트

### 2.1 스크립트 파일
- `scripts/migrate-active-repairs.js` — 메인 파서 (xlsx → INSERT SQL)
- `scripts/parse-notes-extract-dates.js` — 비고 이벤트 파싱
- `scripts/apply-notes-events.js` — 파싱된 이벤트 DB 적용

### 2.2 AS 번호 규칙
- **SA-{년도}-{일련번호}** (예: SA-2026-0001)
- 수리완료 이관 시: **SC-** 또는 **SH-** 같은 별도 접두사 권장 (구분)
- 수리현황과 수리완료의 일련번호 공간 분리

### 2.3 이관 필드 매핑

| Excel 컬럼 | ERP 필드 |
|---|---|
| 재고번호 | `otInventoryNo` |
| 계약번호 | → `notes`에 포함 (별도 필드 없음) |
| 기관 | `customerId` (매핑 사전 경유) |
| 고객담당자 | `customerContactName` 텍스트 |
| 제조사 | `productMaker` |
| 장비명 | `productName` |
| SN | `productSerial` |
| 증상 | `symptom` |
| 담당자(수리진행) | `assigneeId` + `assigneeName` |
| 담당자(운송발주) | `shippingAssigneeName` |
| RMA# | `mfgReferenceNo` + Shipment.`rmaNumber` 동일값 복사 |
| 현재위치 | `currentLocation` |
| 비고(원문) | `notes` (전체 보존) |

### 2.4 비고 이벤트 파싱 라벨 사전

| Excel 라벨 | ERP 필드/동작 |
|---|---|
| `입고` / `최초 입고` / `창고 입고` | `stockedAt` (=`receivedAt`도 동기화) |
| `기술팀 인계` / `기술부 수리요청` | `handedToTechAt` |
| `제조사 발송` / `해외 발송` / `선적` | Shipment(OUTBOUND).shippedAt |
| `제조사 도착` / `제조사 입고` | Shipment(OUTBOUND).receivedAt (status=DELIVERED) |
| `본사 도착` / `반납` | Shipment(INBOUND).receivedAt (status=DELIVERED) |
| `Quote 수신` / `견적 수신` | `quoteReceivedAt` |
| `견적서 발송` / `견적 확정` | `quoteApprovedAt` |
| `PO 발송` / `발주` | `poIssuedAt` |

### 2.5 이관 기본값
- `status = RECEIVED` 일괄 (사용자가 수동 전이)
- `receivedAt = {stockedAt || placeholder}` (입고일 있으면 동기화)
- `priority = NORMAL`
- `orderType = REPAIR`

---

## 3. 사용자 수동 보정 패턴 (수리현황 20건 관찰)

### 3.1 연도 교정
**자동 이관이 놓친 연도**를 비고의 `yy/mm/dd` 힌트로 사용자가 수정:
- SA-0001 (KHOA): receivedAt = 2025-05-22 (비고 `25/05/22`)
- SA-0002~0004: receivedAt = 2025-05-22 / 2025-11-24 등 2025년으로
- SA-0005~0006: 2025-02-06 / 2025-10-14

→ **수리완료 이관에서는** 다년간 이력 건들은 비고의 yy/mm/dd 힌트를 명시적으로 파싱해 연도 교정 포함.

### 3.2 상태 수동 전이
14건 중 대부분이 `SHIPPED_TO_MFG`로 전이됨 (현재 제조사 위치). 일부(0013, 0015)는 `RECEIVED/INSPECTING_1ST` 유지.

→ 자동 이관 시 **현재위치 컬럼** 참조해 상태 초기값을 추정 가능:
- `위치="제조사"` → 초기 상태 `SHIPPED_TO_MFG`로 시작 고려 (확실하면)
- 불확실 시 기본 `RECEIVED` + 수동 전이

### 3.3 Shipment 세부 입력
사용자가 Shipment 카드에서 수정한 항목:
- 발송일/도착일 (비고 이벤트 수동 입력)
- `rmaNumber` 자동 복사 유지 (대부분 그대로)
- `carrier`, `trackingNumber` 대부분 빈값 유지 (엑셀에 없음)

### 3.4 빈 Shipment 정리 필요
SA-0017, 0020에 빈 Shipment 1건씩 추가로 존재 (PREPARING 상태, 모든 필드 빈값).
- 원인 추정: 사용자가 "발송/입고 등록" 버튼 클릭 후 저장 안 하고 close?
- **cleanup 권장**: `status=PREPARING AND shippedAt IS NULL AND carrier IS NULL` 조건으로 빈 레코드 삭제

---

## 4. 수리완료 시트 이관 시 고려사항

### 4.1 규모 차이
- 수리현황: 20건 (일괄 이관 + 사용자 검토 감당 가능)
- 수리완료: **1,084건** (사용자 개별 검토 불가능)

### 4.2 연도 미확정 707건 처리
자동 SN/재고번호 매칭으로 연도 확정 = 377건 (35%)  
미확정 707건에 대한 정책 재확인 필요:
- 이관 제외 (수리현황만 이관한 방식 연장)
- 연도 불명 상태로 일괄 이관 (receivedAt=NULL 허용 스키마 조정 필요)
- 사용자 수동 검토 대기 리스트

### 4.3 접두사 구분
- 수리현황 → `SA-` (완료됨)
- 수리완료 → `SC-` 또는 `SH-` (이관 이력) 또는 `SA-`+별도 시퀀스 공간

### 4.4 최초 상태
수리완료는 모두 완료된 건이므로 초기 상태 후보:
- `CLOSED` (완결) — 가장 자연스러움
- `COMPLETED` (완료) — 종료 처리만 남음
- 사용자 설정

### 4.5 MaintenanceRecord 자동 생성 여부
`COMPLETED` 전이 시 `type: CORRECTIVE` 레코드 자동 생성되는데, 이관 건 1084개가 한꺼번에 생성되면:
- 장비 이력 오염 우려
- 실제 수리 이력이 이미 엑셀에 있는 것
- **해결**: 이관 시 `status=CLOSED`로 직접 설정 (전이 함수 우회), MaintenanceRecord 수동 제외

### 4.6 비고 타임라인 파싱
수리현황에서 14/20 성공(70%), 나머지는 다년간 이력. 수리완료는:
- 대부분 완결된 건이라 타임라인 단순할 가능성
- 하지만 수년 걸친 건도 있음
- 샘플 100건 정도 파싱 결과 보고 임계값 조정

---

## 5. 이관 프로세스 제안 (수리완료용)

### Phase 1 — Schema & Mapping (준비)
1. 기관 매핑: 수리완료 시트의 추가 기관 확인 (수리현황 커버분 제외)
2. 담당자 매핑: 수리완료 시트의 수리진행담당자 추가 확인
3. 접두사 확정 (SA/SC/SH 등)

### Phase 2 — 샘플 이관 (검증)
1. 100건 샘플로 파서 테스트
2. 파싱 실패 패턴·엣지 케이스 수집
3. 파서 라벨 사전 확장 (필요 시)

### Phase 3 — 전체 이관
1. 연도 확정 377건 먼저 이관
2. 연도 미확정 707건 정책에 따라 처리
3. 빈 레코드·중복 정리 스크립트 병행

### Phase 4 — 사후 정리
1. 무결성 검증 (기관·담당자 FK 누락 확인)
2. 빈 Shipment 정리
3. `notes` 원문 검증 (깨진 인코딩 등)
4. 샘플 건 사용자 UI 확인

---

## 6. 재사용 가능한 스크립트 경로

| 스크립트 | 역할 |
|---|---|
| `scripts/build-matching-workbook.js` | 엑셀 추출 + 매칭 워크북 생성 |
| `scripts/finalize-customer-mapping-v2.js` | 신규 Customer 생성 + 매핑 파일 구성 |
| `scripts/create-internal-users.js` | 신규 User 생성 |
| `scripts/migrate-active-repairs.js` | RepairOrder 일괄 생성 |
| `scripts/parse-notes-extract-dates.js` | 비고 이벤트 파싱 |
| `scripts/apply-notes-events.js` | 파싱 결과 → DB 적용 |

수리완료 이관 시 **시트명 + AS번호 접두사 + 기본 상태**만 파라미터화하면 대부분 재사용 가능.

---

## 7. 추가 확인 사항 (작성 시점)

사용자가 수리현황 20건 이관 후 보완한 내역 (기록):

| AS | 주요 수정 |
|---|---|
| SA-0001 | receivedAt=2025-05-22, Shipment 2건에 실제 날짜 입력, status=RECEIVED_FROM_MFG |
| SA-0002 | 2025-05-22 수정, status=RECEIVED_FROM_MFG |
| SA-0003 | 2025-05-22, status=RECEIVED_FROM_MFG |
| SA-0004 | 2025-11-24, OUTBOUND(2025-12-28→2026-01-02), INBOUND(2026-04-14→2026-04-20), status=RECEIVED_FROM_MFG |
| SA-0005 | 2025-02-06, status=RECEIVED 유지 |
| SA-0006 | 2025-10-14, status=SHIPPED_TO_MFG |
| SA-0007~0020 | 대부분 status 수동 전이(SHIPPED_TO_MFG), Shipment 상세는 기본 유지 |
| SA-0017 | 빈 OUTBOUND 1건 추가됨 (정리 필요) |
| SA-0020 | 빈 OUTBOUND 1건 추가됨 (정리 필요) |

### 사용자가 UI에서 새로 생성한 Shipment 레코드
- SA-0001: INBOUND 추가 (2025-11-10 → 2025-11-23)
- SA-0002, 0003: INBOUND 자동 생성 (본사 입고 전이 시, receivedAt=전이 시각)
- SA-0004: INBOUND 추가 (2026-04-14 → 2026-04-20)

→ **패턴**: 사용자는 비고의 "11/23 입고" 같은 이벤트를 INBOUND Shipment로 직접 입력. 자동 파서로는 "본사 입고" 키워드 감지 안 돼 놓침 → 라벨 사전 확장 필요 (`입고` 단독도 본사 입고로 해석 시 판단 어려움, 컨텍스트 필요).

### 파서 개선 아이디어 (수리완료 시 반영)
1. **쌍 탐지**: `제조사 발송 → 제조사 도착` 이후의 `입고`는 **INBOUND(본사 입고)**로 재해석
2. **쌍 탐지2**: `제조사 발송`만 있고 그 전/후에 `입고`가 있으면 → 최초 입고는 stockedAt, 후행 입고는 INBOUND
3. **yy/mm/dd 가중치**: 명시적 연도 → row-level year override로 활용 (row의 receivedAt 교정)
