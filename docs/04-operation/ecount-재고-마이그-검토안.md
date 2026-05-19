# ecount → ERP 재고 마이그레이션 검토안

> **Status**: 검토안 (Phase 분리 계획 + 결정 사항 반영)
> **작성일**: 2026-05-18
> **대상 파일**:
> - `data/sources/구매현황(26.01.01~26.04.30).xlsx` (337 행)
> - `data/sources/판매현황(26.01.01~26.04.30).xlsx` (366 행)
> - `data/sources/창고이동현황(26.01.01~26.04.30).xlsx` (235 행)
> - `data/sources/거래처리스트.xlsx` (1126 거래처)
> **결정 근거**: 사용자 인터뷰 11회 + Python 검증 (2026-05-18)

---

## 1. 목표

ecount(외부 회계 시스템)의 2026-01-01 ~ 2026-04-30 4개월 트랜잭션 938건 + 거래처 마스터 1126건을 ERP `services/equipment` 도메인으로 흡수. **재고 / 고객사 자산 / AS 수리 / 발주·계약**이 단일 자산 마스터로 연결되는 흐름을 완성한다.

```
ProductMaster (품목 SKU, v1.6)
       ↓
InventoryItem (오션테크 보유 재고) — inventory_no = 재고번호
       ↓ (판매·납품 시)
CustomerAsset (고객사 자산) — otInventoryNo cross-ref
       ↓ (AS 요청 시)
RepairOrder (수리 이력)
```

---

## 2. 데이터 통계 (실측)

### 2.1 ecount 4개월 트랜잭션 938건
| 파일 | 행 | unique 시리얼 | unique 적요(재고번호) | unique 품목 |
|---|---:|---:|---:|---:|
| 구매현황 | 337 | 248 | 319 | 179 |
| 판매현황 | 366 | 274 | 350 | 178 |
| 창고이동현황 | 235 | 160 | 107 | (품목코드 171) |
| **통합 unique** | **938** | **474** | **521** | ~368 |

### 2.2 ERP 현황 (5/18 시점)
| 모델 | row | 비고 |
|---|---:|---|
| `inventory_items` | **1572** | 과거 마이그(ecount 1401건 `E#####_#`, 그룹웨어 162건 `NNNNN`) + 신규 5건 `INV-YYMM-NNNN` |
| `inventory_transactions` | 2983 | |
| `customer_assets` | 331 | `otInventoryNo` 203건 사용 (`#E#####_#` 101 / `#NNNNN` 94 / 기타) |
| `customers` | 157 | ecount 1126 거래처 중 일부만 |
| `contracts` | 495 | |
| `repair_orders` | (AS 운영) | `customerAssetId` + `otInventoryNo` 양쪽 매칭 가능 |

### 2.3 시리얼·재고번호 교집합
| 기준 | 결과 |
|---|---|
| ecount 474 시리얼 ↔ ERP `inventory_items` | 95 (20%) |
| ecount 474 시리얼 ↔ ERP `customer_assets` | 10 (2%) |
| ecount 521 적요(해시 정규화) ↔ ERP `inventory_items.inventory_no` | **143 (27%)** |
| └ 시리얼 일치 | 83 |
| └ 한쪽 빈값 | 60 |
| └ 시리얼 불일치 | **0** ✅ |
| ecount 521 적요 ↔ ERP `customer_assets.otInventoryNo` | 0 |

**결론**: ecount 521 중 **378 신규 / 143 update** (`inventory_items`만). `customer_assets` 와는 직접 매칭 0건이라 별도 cross-link 작업 필요.

---

## 3. 핵심 결정 사항 (사용자 승인)

| # | 결정 | 채택 |
|---|---|---|
| 1 | 재고번호 표기 통일 | **`#` 포함** (해시 prefix 유지) |
| 2 | 중복 143건 처리 | **자동 update** — 시리얼 불일치 0건이라 안전 |
| 3 | 시리얼 매칭 | **(시리얼 + 품목명) 복합키** — 시리얼 단독 충돌 방지 |
| 4 | 창고명 | ERP `Location` 마스터에 **모두 등록 필수** (사전 검증) |
| 5 | 단가·금액 | 재고 트랜잭션에는 저장 X. **Order/지출결의서가 single source of truth** |
| 6 | 적요(#E####_#) | `InventoryItem.inventory_no` 의 주키 (재고번호) |
| 7 | 거래처 통합 마스터 | 1126 거래처 풀에서 Customer/Supplier/Manufacturer 역할 분리 |
| 8 | AS·고객 자산 연동 | `CustomerAsset.otInventoryNo` cross-ref 활용 |
| 9 | 창고이동 단독 자산 (59/107) | **모두 진짜 자산** (4개월 외 과거 구매). InventoryItem 생성, 구매 메타 nullable |
| 10 | 카테고리 도메인 | ecount는 카테고리 별도 운영 안 함. 품목명 자체로 분류 |

---

## 4. 매핑 표 (전체)

### 4.1 구매현황 (17 컬럼)
| ecount 컬럼 | ERP 모델·컬럼 | 비고 |
|---|---|---|
| 일자-No. | `inventory_transactions.transactedAt` + sequence | |
| 품목명(규격) | `ProductMaster.name` lookup → `inventory_items.product_master_id` | |
| 수량 | `inventory_transactions.quantity`, `inventory_items.quantity` (벌크 시) | |
| **공급사** | `Supplier` (회계·계산서·발주 대상) | 거래처리스트 사업자번호 lookup |
| **거래처명** (구매) | `Manufacturer` (제조사) | `ProductMaster.manufacturer` |
| 창고명 | `Location` | ERP 마스터에 사전 등록 필수 |
| 시리얼/로트No. | `inventory_items.serial_number` | 보조 식별 |
| 거래처명(중복 col7) | (무시 — 위 거래처명과 동일 정보) | |
| 프로젝트명 | `Contract.contractNumber` 또는 `Contract.name` lookup | `#YY-NNN` 패턴 |
| 담당자명 | `Order.orderedBy` (User lookup, name 매칭) | fallback "—" |
| 단가·공급가액·합계 | (재고 X) — Order/지출결의서 참조 | legacy 보존 시 별도 필드 |
| 장문형식1·문자형식1 | `inventory_transactions.remarks` (통합) | |
| **적요** (`#E####_#`) | **`inventory_items.inventory_no`** (재고번호, `#` 포함 유지) | 주키 |
| 구매No. (`E#####`) | `inventory_items.inventory_no`의 주번호 부분 (적요와 중복 정보) | |

### 4.2 판매현황 (15 컬럼)
구매와 동일한 컬럼 + 차이점:
| ecount 컬럼 | ERP 모델·컬럼 | 비고 |
|---|---|---|
| **거래처명** (판매) | **`Customer`** (우리에게 구매한 업체) | 거래처리스트 lookup |
| 단가·공급가액·부가세·합계 | (재고 X — 매핑 안 함) | 매출 도메인 별도 |
| 기타정보 | `inventory_transactions.remarks` (출고 비고) | 다른 재고번호 참조 cross-ref 가능 (`#E02219_1`) |
| 판매No. (`E#####`) | (legacy 메타) | 적요 주번호와 동일 |
| **적요** (`#E####_#`) | **`inventory_items.inventory_no`** — 출고할 자산 식별 | OUT 트랜잭션 키 |

### 4.3 창고이동현황 (12 컬럼)
| ecount 컬럼 | ERP 모델·컬럼 | 비고 |
|---|---|---|
| 일자-No. | `inventory_transactions.transactedAt` | |
| **출고창고명** | `inventory_transactions.fromLocation` | |
| **입고창고명** | `inventory_transactions.toLocation` | 외부면 임시 Location 또는 CustomerAsset 일시 매핑 |
| 품목명[규격] | (참조 확인용) | inventory_items 통해 매핑 |
| 수량 | `inventory_transactions.quantity` | |
| 금액(수량*입고단가) | (재고 X) | |
| **적요** | `inventory_items.inventory_no` 매칭 | |
| 기타정보 | `inventory_transactions.remarks` | |
| 시리얼/로트No. | (검증용) | |
| **품목코드** (171 unique) | `ProductMaster.legacyEcountCode` 또는 `masterCode` cross-ref | 구매·판매엔 없어 보강 키 |
| 프로젝트명 | `Contract` | |
| 담당자명 | `User` | |

### 4.4 거래처리스트 (8 컬럼)
| ecount 컬럼 | ERP 모델·컬럼 |
|---|---|
| 거래처코드 (사업자등록번호) | `Customer.businessNo` (자연키, unique) |
| 거래처명 | `Customer.name` |
| 대표자명 | `Customer.contactPerson` (legacy) 또는 별도 |
| 전화번호 / 핸드폰번호 | `Customer.phone` |
| 검색창내용 | (참고) |
| 사용구분 (YES/NO) | `Customer.isActive` |
| 이체정보 (등록/미등록) | `Customer.hasBankInfo` 또는 무시 |

---

## 5. Phase 계획

### Phase A — 표기 통일 (전처리, 본 마이그 전)

**목적**: ERP 기존 데이터의 `inventory_no` 표기를 `#` 포함 통일

| 작업 | 영향 |
|---|---|
| `inventory_items.inventory_no` UPDATE: `E#####_#` → `#E#####_#` | 1401 row |
| `inventory_items.inventory_no` UPDATE: `NNNNN` → `#NNNNN` | 162 row |
| `cost_items.inventory_no` 동일 변환 | 약 590 row |
| `repair_orders.otInventoryNo` 점검·정규화 | row 수 확인 필요 |
| `inbound_requests.code` 점검 | 27 row |
| `customer_assets.otInventoryNo` (이미 대부분 `#` 있음) | 8건 예외(`#ENNNNN` seq 누락) 별도 점검 |
| `INV-YYMM-NNNN` 형식 (5+1건) | 제외 — 신규 ERP 자체 부여 |
| 기타 4건 (`무통관`, `미생성`, `E01403`) | 수동 검토 |

**선행 조건**: DB dump 백업 (이미 `backups/full-backup-20260518-082604.dump` 있음)
**검증 후 SQL 일괄 트랜잭션 실행**

### Phase B — 본 마이그 (ecount 4개월 데이터)

**B-1. 기준 마스터 갱신**
1. **거래처 마스터** — 1126 거래처 → ERP `customers` (157 → 1126). 사업자등록번호 자연키 매칭. role flag로 supplier/customer/manufacturer 구분
2. **창고 마스터** — 135 unique 창고 → ERP `Location` 사전 등록 검증. 누락분 추가
3. **품목 마스터** — 약 368 unique 품목 → ERP `ProductMaster` 매칭 (퍼지). 누락분 신규 생성. 창고이동의 171 unique `품목코드`를 `legacyEcountCode` cross-ref로 보강

**B-2. 트랜잭션 import (타임라인 정렬)**
- 938건 트랜잭션을 `일자-No.` 기준 정렬
- 순서: **구매 → 창고이동 → 판매**
- 각 트랜잭션 idempotency key: `(일자-No., 적요)` 조합
- 구매 → `InventoryItem.create` + IN 트랜잭션
- 판매 → 기존 `InventoryItem` lookup → OUT 트랜잭션 + `CustomerAsset.create` (`otInventoryNo` 동일)
- 창고이동 → `InventoryItem` location 변경 + MOVE 트랜잭션

**B-3. 중복 143건 자동 update**
- ecount 적요와 ERP `inventory_no` 매칭된 143건
- **자동 update**: `current_status` (IN_STOCK→RELEASED 등), `current_location`, 거래처·시리얼 보강
- 시리얼 불일치 0건 검증 후 진행
- 변경 이력은 `inventory_transactions` 에 기록

**B-4. 신규 378 InventoryItem 생성**
- ecount 적요 중 ERP에 없는 378건
- `inventory_no = #E####_#` (해시 포함)
- `current_status` 는 마지막 트랜잭션에 따라 결정 (구매만 있으면 IN_STOCK, 판매까지 있으면 RELEASED)
- `current_location` 도 마지막 위치

### Phase C — Cross-link 복구

**목적**: `inventory_items` ↔ `customer_assets` 매핑 동기화 (현재 매칭 0건 = 끊김)

| 작업 | 영향 |
|---|---|
| `customer_assets.serialNumber` 기준 `inventory_items` 매칭 | 282 customer_assets |
| 매칭되면 `customer_assets.otInventoryNo` 갱신 | (현재 비어있는 127건 + 형식 다른 8건) |
| 매칭된 RepairOrder의 `customerAssetId` 정합성 검증 | AS 운영 중인 데이터 보호 |
| 백로그 — Phase B 완료 후 정리 작업으로 진행 | 메모리 백로그 등록 |

---

## 6. 정합성 검증 체크리스트

### 사전 검증 (마이그 전)
- [ ] DB dump 백업 (5/18 dump 활용 가능, 필요 시 갱신)
- [ ] 거래처리스트 1126건 사업자번호 unique 확인
- [ ] 창고명 135 unique → ERP Location 마스터 대조, 누락분 식별
- [ ] 품목명 368 unique → ProductMaster 퍼지 매칭, 누락분 식별
- [ ] 일자별 "계" row 필터 (집계 row skip)
- [ ] 시리얼 "없음" 행 분류 (벌크 처리 후보)

### 마이그 중 검증
- [ ] 143 update 시리얼 일치율 모니터링 (예상 83/143 명확 일치)
- [ ] 신규 378건 idempotency 확인 (재실행 시 중복 X)
- [ ] 트랜잭션 일자별 순서 정렬 검증
- [ ] 외부 거래처가 Location으로도 등장 시 정합성 (Customer vs Location 분리)

### 마이그 후 검증
- [ ] 수량 잔액: 구매 IN - 판매 OUT + 이동 = 현재 보유 (재고수불부 대조 가능)
- [ ] 적요별 흐름 일관성 (구매 → 이동 → 판매 순)
- [ ] InventoryItem.current_status / current_location 갱신 결과 리포트
- [ ] CustomerAsset 신규 등록 건수 vs 판매 트랜잭션 건수 일치
- [ ] AS RepairOrder의 customerAssetId 깨진 link 0건

---

## 7. 리스크·롤백

### 주요 리스크
| 리스크 | 완화 |
|---|---|
| Phase A 대량 UPDATE 실수 | DB dump 백업 + 트랜잭션 단위 실행. 실패 시 ROLLBACK |
| 거래처 매칭 실수 (1126 → 157) | 사업자번호 자연키. 거짓 매칭 확률 낮음 |
| 외부 거래처가 Location으로 등록되면 운영 혼동 | 별도 prefix 또는 `Location.type` 구분 |
| AS RepairOrder가 inventory_no 갱신으로 link 깨짐 | Phase A 동시 갱신 + 자동 검증 |
| 사용자 동의 없이 자동 update가 의도와 다른 케이스 | 143건 사전 dry-run 리포트 (변경 전후 비교 csv) 권장 |

### 롤백 전략
- DB dump (5/18 `backups/full-backup-20260518-082604.dump`) 로 전체 복원
- 또는 마이그 스크립트별 `BEGIN; ... ROLLBACK;` 트랜잭션 단위
- 메모리: `feedback_seed_preserve` (실수 시 백업에서 즉시 복구)

---

## 8. 다음 단계

| 단계 | 작업 | 작업량 |
|---|---|---|
| **1** | 이 검토안 사용자 승인 | 즉시 |
| 2 | Phase A 사전 dry-run 스크립트 작성 (변경 전후 diff csv) | 1~2시간 |
| 3 | Phase A 실행 + 검증 (DB dump 후) | 30분 |
| 4 | Phase B-1 마스터 갱신 (거래처·창고·품목 누락분) | 1~2시간 |
| 5 | Phase B-2~B-4 트랜잭션 import 스크립트 (Python) | 4~6시간 |
| 6 | Phase B 실행 + 검증 리포트 | 1~2시간 |
| 7 | Phase C cross-link 복구 (별도 작업 또는 백로그) | 2~3시간 |
| **합계** | | ~12~18시간 (실제 사용자 검토 시간 별도) |

---

## 9. 참고

- 메모리: `project_inventory_sku_v1_6_2026_05_13` — SKU v1.6 plan
- 메모리: `project_repair_migration_pattern` — 수리관리 엑셀 이관 패턴 (재사용 자산)
- 메모리: `project_planner_to_erp_migration` — Planner→ERP migration playbook
- 메모리: `project_customer_cleanup_rules` — 거래처·담당자 정리 규칙
- 메모리: `feedback_review_before_execute` — 코드 수정 전 검토안 필수
- 메모리: `feedback_seed_preserve` — 실수 삭제 시 백업에서 즉시 복구
- 데이터: `data/sources/출력보고서_재고수불부(2025).xlsx` — 2025년 재고수불부 (마이그 후 잔액 검증 자료 활용 가능)
- 스크립트 작성 위치 권장: `scripts/import-ecount-inventory.py` (`scripts/import-planner.py` 패턴 재사용)
