# OT-Brain Design Document

> **Summary**: 회사 전체 디지털 자산(NAS 30.4TB·8.04M 파일 + ERP + 미래 메일/Teams)을 "마스터 자산 + 사용처 매핑(N:M)" 가상 계층으로 구조화하는 별도 독립 Enterprise Knowledge Platform. Phase 0~1(NAS 흡수 + RAG 검색 + PoC 3종) 상세 설계.
>
> **Project**: OT-Brain (OceanTech-Brain) — *별도 repo·docker·인프라*
> **Relation to**: erp-ot-platform (source + consumer 양방향)
> **Version**: V0.2 (Design — 사용자 결정 5건 D1~D5 확정 반영)
> **Author**: 오션테크 (yunsim@gmail.com) + Claude (CTO Lead Mode, Council 패턴)
> **Date**: 2026-06-01
> **Status**: Confirmed — ✅ 사용자 결정 5건 모두 확정 (§9), Do(M1) 진입 준비 완료
> **Planning Doc**: [OT-Brain.plan.md](../../01-plan/features/OT-Brain.plan.md)
> **Council**: enterprise-expert(아키텍처·스택) · security-architect(인증·LLM·NAS) · infra-architect(docker·pgvector·배포)

### Pipeline References

| Phase | Document | Status |
|-------|----------|--------|
| Plan | [OT-Brain.plan.md](../../01-plan/features/OT-Brain.plan.md) | ✅ (8개 결정 확정) |
| NAS 카탈로그 v5 | docs/04-operation/nas-스캔-카탈로그-20260526.md | ✅ (입력 자료) |
| 현 NAS 스캐너 | scripts/nas-scan/ (Python + DuckDB) | ✅ (이관 대상) |

---

## 1. Overview

### 1.1 Design Goals

본 Design은 Plan에서 확정된 8개 결정(운영 모델 C, PoC 3종, G1~G6)을 **구현 가능한 명세**로 전환한다.

- **G-1 운영 모델 C 구체화**: 자산(Asset) / 사용처 매핑(AssetUsage, N:M) / 버전(AssetVersion) / 다중 태그(AssetTag) / NAS 사본 메타(NasCopy) 데이터 모델 + pgvector 스키마
- **G-2 NAS 흡수 파이프라인**: 매주 스캔 → 중복 hash 그룹화 → AI 마스터 후보 → 사람 승인 → 임베딩 → 검색 인덱스 (현 nas-scan 이관 포함)
- **G-3 PoC P1 알고리즘**: 선박 자산 마스터 자동 도출 (파일명 패턴 추출 + 선박명 정규화 + hash 클러스터링)
- **G-4 기술 스택 결정 확정 (D1~D5, §9)**: 백엔드 언어 = ingestion(Python)/api(Node) 분리 · 인증 = 자체→Phase3 SSO · LLM = 하이브리드(PoC 검색-only/로컬) · NAS 스캔 = 현 정책 계승 · Ollama = ERP 공유
- **G-5 별도 시스템 경계 확정**: ERP-OT와 source+consumer 양방향, 별도 repo·docker·인프라

### 1.2 Design Principles

- **정보 축적 우선 (불변 원칙)**: NAS 원본은 **절대 건드리지 않는다**. OT-Brain은 그 위의 가상 계층(read-only ingestion). [[project_nas_scan_purpose_information_first]]
- **마스터 1회 임베딩**: 같은 hash → 마스터 1개로 수렴, 임베딩 1회 (비용 절감, 모델 C 핵심 가설).
- **다중 분류**: 단일 분류 강제 금지. 자산은 N개 태그·N개 사용처를 가진다.
- **사람 최종 결정 (HITL)**: AI는 후보만 제안, 마스터 등록·갱신 승인은 부서 책임자 (G1·G3).
- **검증 자산 재사용**: ERP에서 검증된 bge-m3·pgvector(HNSW)·pg_trgm·Docker Compose 패턴 재사용. 신규 발명 최소화.
- **Clean Architecture**: ingestion / knowledge-core / search-api 3개 논리 경계, 각 4계층.

---

## 2. Architecture

### 2.1 시스템 경계 (Component Diagram)

```
┌──────────────────────────────────────────────────────────────────────┐
│  OT-Brain  (별도 repo: ot-brain / 별도 docker-compose / 별도 인프라)     │
│                                                                        │
│  ┌─ ingestion ──────────────┐      ┌─ knowledge-core ───────────────┐ │
│  │ (Python — nas-scan 이관)   │      │ (API 백엔드 — Node/TS, D1)       │ │
│  │  scanner (walk+record)    │      │  Asset / AssetUsage / Version   │ │
│  │  pdf/hwp 파서             │      │  Tag / NasCopy 도메인            │ │
│  │  hash·중복 탐지 (head 1MB)  │─────▶│  마스터 후보 도출 (P1 알고리즘)   │ │
│  │  텍스트 추출 (PaddleOCR)   │ 인입  │  승인 워크플로우 (HITL)          │ │
│  └───────────────────────────┘      └────────────┬───────────────────┘ │
│         │ DuckDB(스캔 캐시)                       │ Prisma/SQLAlchemy     │
│         ▼                                         ▼                      │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │  PostgreSQL 16 + pgvector  (별도 인스턴스, OT-Brain 전용)            │ │
│  │   schema: knowledge  (asset / asset_usage / asset_version /         │ │
│  │     asset_tag / nas_copy / asset_embedding[vector])                 │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│         ▲                                         ▲                      │
│  ┌─ embedding ─────────┐          ┌─ search-api / llm ────────────────┐ │
│  │ Ollama bge-m3        │          │ 하이브리드 검색 (벡터 + pg_trgm)    │ │
│  │ (ERP 공유, D5)        │          │ RAG 답변 (하이브리드 LLM, D3 —     │ │
│  │ 마스터 1회 임베딩     │          │   PoC는 검색-only/로컬 우선)        │ │
│  └─────────────────────┘          └───────────────┬───────────────────┘ │
└────────────────────────────────────────────────────┼────────────────────┘
                          source ↑ (스캔 시 NAS read) │ ↓ consumer (Phase 3)
        ┌──────────────────────────────────┐  ┌──────┴───────────────────┐
        │  NAS \\192.168.0.220\oceantech     │  │  erp-ot-platform          │
        │  (read-only, 원본 불변)            │  │  (자동첨부·위젯·SSO Phase 3)│
        └──────────────────────────────────┘  └───────────────────────────┘
```

### 2.2 논리 모듈 경계

| 모듈 | 책임 | 언어 (D1 확정) | 비고 |
|------|------|----------------|------|
| **ingestion** | NAS walk·hash·중복·파서·OCR | **Python** (현 nas-scan 자산 계승) | DuckDB 스캔 캐시 → knowledge DB로 적재 |
| **knowledge-core** | 자산 도메인·매핑·버전·승인 워크플로우 | **Node/TS** (ERP 스택 재사용) | HITL 승인 API |
| **embedding** | 마스터 자산 임베딩 | Python (Ollama 호출) | bge-m3 (ERP Ollama 공유, D5), 마스터 1회 |
| **search-api** | 하이브리드 검색·RAG 답변·ERP 연동 API | **Node/TS** (ERP 스택 재사용) | Phase 3에서 ERP consumer 연동 |

> **D1 경계 확정**: ingestion(Python)과 api(Node/TS)의 경계는 **DuckDB 스캔 캐시 → PostgreSQL knowledge DB 적재 지점**이다. ingestion은 스캔·hash·텍스트 추출 결과를 knowledge DB에 적재하고, Node 측 knowledge-core/search-api는 그 DB를 SoR로 읽는다. 두 런타임 간 코드 의존 없음(공유 DB 계약만). 적재 어댑터는 M2에서 구현.

### 2.3 Data Flow — NAS 흡수 파이프라인 (Phase 1 핵심)

```
[① 매주 스캔 (G5)] ── scheduler (cron/systemd timer)
   nas-scan walk → DuckDB files 테이블 (path, size, mtime, ext)
        ↓
[② 텍스트 추출] ── PDF 텍스트 레이어 우선 → PaddleOCR 폴백 (비용 0)
        ↓
[③ head-1MB hash + 중복 그룹화] ── size-group 1차 필터 → SHA-256
        ↓  같은 hash + 같은 size → 중복 후보 그룹
[④ NAS 사본 메타 부여 (G2)] ── 각 물리 경로 = nas_copy 레코드 (원본 불변)
        ↓
[⑤ AI 마스터 후보 도출] ── 다맥락 N회+ / 파일명 패턴 / 이름·hash 클러스터링 (G4)
        ↓
[⑥ 부서 책임자 승인 (G1 HITL)] ── 승인 UI → asset 등록 + 다중 태그
        ↓
[⑦ 마스터 1회 임베딩] ── bge-m3 → asset_embedding (vector)
        ↓
[⑧ 검색 인덱스] ── HNSW(pgvector) + GIN(pg_trgm) 갱신
        ↓
[⑨ 갱신 감지 (G3)] ── 새 hash 발견 → asset_version 자동 추가 → 책임자 검토
```

### 2.4 Dependencies

| 컴포넌트 | 의존 | 목적 |
|----------|------|------|
| ingestion | NAS (SMB read-only) | 원본 스캔 |
| ingestion | DuckDB | 스캔 중간 캐시 (대용량 walk 결과) |
| knowledge-core | PostgreSQL+pgvector | 자산·매핑·버전·임베딩 영속 |
| embedding | Ollama (bge-m3) | 임베딩 생성 |
| search-api | knowledge-core DB | 검색·RAG |
| search-api | LLM (하이브리드, D3) | RAG 답변 생성 — PoC는 검색-only/로컬, 민감 본문 외부 전송 금지 |
| (Phase 3) ERP | search-api | 자동첨부·위젯 consumer |

---

## 3. Data Model

### 3.1 핵심 엔티티 (운영 모델 C)

```
[Asset] (마스터 자산) ──1:N── [AssetVersion] (증서 연차 등 G3 버전)
   │                              │
   │ N:M                          └── 각 버전이 NasCopy 가리킴 (canonical hash)
   ├──── [AssetUsage] ────N:M──── (프로젝트/업무/부서 — ERP 측 식별자)
   │
   ├──1:N── [AssetTag] (다중 태그: 도메인·업무·유형·부서)
   │
   ├──1:N── [NasCopy] (물리 사본 경로 — G2, 원본 불변)
   │
   └──1:1── [AssetEmbedding] (마스터 1회 임베딩, vector)
```

### 3.2 Entity 정의 (D1 확정: knowledge-core=Node/TS → Prisma 모델로 구현, ingestion=Python → 적재 시 동일 스키마 사용)

```typescript
// 마스터 자산 — 같은 hash 그룹의 대표 1개
interface Asset {
  id: string;                 // uuid
  canonicalHash: string;      // head-1MB SHA-256 (중복 그룹 대표)
  assetType: AssetType;       // VESSEL | CERTIFICATE | CONTRACT | BUOY_PART | MANUAL | ...
  title: string;              // 정규화된 표시명 (예: "만성호 선적증서")
  status: AssetStatus;        // CANDIDATE | APPROVED | ARCHIVED  (G1 HITL)
  approvedBy?: string;        // 승인 부서 책임자 (auth_users.id, Phase 3 연동)
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// 버전 (G3 — 검사증서 연차 갱신 등)
interface AssetVersion {
  id: string;
  assetId: string;            // → Asset
  versionLabel: string;       // 예: "2025년차", "v2"
  hash: string;               // 이 버전의 head-1MB hash
  isLatest: boolean;          // 책임자 승인된 최신본
  detectedAt: Date;           // 새 hash 자동 감지 시각
  confirmedBy?: string;       // 책임자 검토 (G3 HITL)
}

// 사용처 매핑 (N:M — 자산 ↔ 프로젝트/업무/부서)
interface AssetUsage {
  id: string;
  assetId: string;            // → Asset
  usageType: UsageType;       // PROJECT | TASK | DEPARTMENT | CUSTOMER
  externalRefId: string;      // ERP 측 식별자 (project.id, dept.id 등 — 느슨한 결합)
  externalRefLabel: string;   // 캐시된 표시명 (ERP 미연동 시에도 의미 유지)
  occurrenceCount: number;    // 등장 횟수 (반복 업무 발자국 — 통찰 정량화)
}

// 다중 태그
interface AssetTag {
  id: string;
  assetId: string;
  dimension: TagDimension;    // DOMAIN | WORK | TYPE | DEPARTMENT
  value: string;              // 예: domain=선박자산, work=선박특별검사신청
}

// NAS 물리 사본 (G2 — 원본 불변, 메타만 부여)
interface NasCopy {
  id: string;
  assetId: string;            // → Asset (마스터로 수렴)
  nasPath: string;            // \\192.168.0.220\oceantech\... (read-only ref)
  fileName: string;           // 원본 파일명 (정규화 전)
  size: number;
  mtime: Date;
  hash: string;               // head-1MB SHA-256
  firstSeenScanId: string;    // 최초 발견 스캔
  lastSeenScanId: string;     // 최근 확인 스캔 (삭제 감지용)
}

// 임베딩 (마스터 1회)
interface AssetEmbedding {
  assetId: string;            // → Asset (1:1)
  embedding: number[];        // bge-m3 1024-dim vector
  sourceText: string;         // 임베딩 대상 텍스트 (제목+태그+추출본문 요약)
  embeddedAt: Date;
}
```

### 3.3 Database Schema (pgvector)

```sql
-- OT-Brain 전용 PostgreSQL 16 + pgvector 인스턴스, schema: knowledge
CREATE SCHEMA IF NOT EXISTS knowledge;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE knowledge.asset (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_hash  TEXT NOT NULL,
  asset_type      TEXT NOT NULL,           -- VESSEL | CERTIFICATE | CONTRACT | ...
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'CANDIDATE',  -- CANDIDATE|APPROVED|ARCHIVED
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_asset_title_trgm ON knowledge.asset USING gin (title gin_trgm_ops);
CREATE INDEX idx_asset_type ON knowledge.asset (asset_type);

CREATE TABLE knowledge.asset_version (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      UUID NOT NULL REFERENCES knowledge.asset(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL,
  hash          TEXT NOT NULL,
  is_latest     BOOLEAN NOT NULL DEFAULT false,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by  TEXT
);

CREATE TABLE knowledge.asset_usage (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id           UUID NOT NULL REFERENCES knowledge.asset(id) ON DELETE CASCADE,
  usage_type         TEXT NOT NULL,        -- PROJECT|TASK|DEPARTMENT|CUSTOMER
  external_ref_id    TEXT NOT NULL,        -- ERP 식별자 (느슨한 결합, FK 아님)
  external_ref_label TEXT NOT NULL,
  occurrence_count   INTEGER NOT NULL DEFAULT 1,
  UNIQUE (asset_id, usage_type, external_ref_id)
);

CREATE TABLE knowledge.asset_tag (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id  UUID NOT NULL REFERENCES knowledge.asset(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,                 -- DOMAIN|WORK|TYPE|DEPARTMENT
  value     TEXT NOT NULL,
  UNIQUE (asset_id, dimension, value)
);

CREATE TABLE knowledge.nas_copy (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id           UUID REFERENCES knowledge.asset(id) ON DELETE SET NULL,
  nas_path           TEXT NOT NULL UNIQUE,
  file_name          TEXT NOT NULL,
  size               BIGINT NOT NULL,
  mtime              TIMESTAMPTZ,
  hash               TEXT NOT NULL,
  first_seen_scan_id TEXT NOT NULL,
  last_seen_scan_id  TEXT NOT NULL
);
CREATE INDEX idx_nas_copy_hash ON knowledge.nas_copy (hash);
CREATE INDEX idx_nas_copy_asset ON knowledge.nas_copy (asset_id);

CREATE TABLE knowledge.asset_embedding (
  asset_id    UUID PRIMARY KEY REFERENCES knowledge.asset(id) ON DELETE CASCADE,
  embedding   vector(1024),                -- bge-m3 dim
  source_text TEXT,
  embedded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- HNSW 인덱스 (ERP 자연어검색에서 검증된 패턴)
CREATE INDEX idx_asset_embedding_hnsw
  ON knowledge.asset_embedding USING hnsw (embedding vector_cosine_ops);
```

> **느슨한 결합 (D2 확정 반영)**: `asset_usage.external_ref_id`는 ERP DB FK가 아니라 텍스트 식별자다. D2 확정대로 OT-Brain은 자체 인증·별도 인스턴스로 시작하고 JWT_SECRET을 공유하지 않으므로, ERP와 cross-DB FK를 두지 않는다. `external_ref_label` 캐시로 ERP 미연동 상태(Phase 1)에서도 의미를 보존하며, Phase 3 SSO introspection 연동 시 ref_id를 ERP 실제 식별자와 매핑한다.

---

## 4. API Specification

### 4.1 Endpoint List (Phase 1 — OT-Brain 단독)

| Method | Path | 설명 | Auth |
|--------|------|------|------|
| POST | /api/v1/ingestion/scan | 스캔 트리거 (수동/스케줄러) | 관리자 |
| GET | /api/v1/assets/candidates | AI 마스터 후보 목록 (G1 승인 대기) | 책임자 |
| POST | /api/v1/assets/:id/approve | 마스터 후보 승인 (HITL) | 책임자 |
| GET | /api/v1/assets/:id/versions | 버전 이력 (G3) | 책임자 |
| POST | /api/v1/assets/:id/versions/:vid/confirm | 최신 버전 승인 | 책임자 |
| GET | /api/v1/search | 하이브리드 검색 (벡터+키워드) | 사용자 |
| POST | /api/v1/ask | RAG LLM 답변 | 사용자 |
| GET | /api/v1/assets/:id/usages | 사용처 매핑 조회 (N:M) | 사용자 |

### 4.2 ERP 연동 API (Phase 3 — consumer)

| Method | Path | 설명 |
|--------|------|------|
| GET | /api/v1/erp/suggest-attachments | 프로젝트/계약 컨텍스트 → 추천 첨부물 (P1~P3 자동첨부 핵심) |
| POST | /api/v1/erp/usage | ERP에서 자산 사용 이벤트 기록 (occurrence_count 증가) |

### 4.3 상세 — 마스터 후보 승인

```
POST /api/v1/assets/:id/approve
Request:  { approvedBy: string, tags?: AssetTag[], title?: string }   // 책임자가 태그·제목 보정 가능
Response 200: { id, status: "APPROVED", approvedAt }
Error 409: 이미 승인됨 / 403: 권한 없음
```

### 4.4 상세 — 하이브리드 검색

```
GET /api/v1/search?q=만성호+선적증서&type=VESSEL&topK=20
처리: q → bge-m3 임베딩 → HNSW cosine + pg_trgm 키워드 → RRF(Reciprocal Rank Fusion) 결합
Response 200: { results: [{ assetId, title, score, usages[], latestVersion }] }
```

---

## 5. 핵심 알고리즘 — P1 선박 자산 마스터 자동 도출

PoC 1순위. 만성호(13부서·229회)·일진호·씨로드호 등 임대 작업선의 선적증서·어선검사증서가 프로젝트마다 반복 첨부되는 패턴을 마스터로 수렴한다. [[project_special_vessel_inspection]]

### 5.1 단계

```
[1) 파일명 패턴 추출]
  정규식 매칭 (NFC 정규화 후):
    선적증서  : r'선적증서\s*[\(（]([^\)）]+)[\)）]'
    어선검사증서: r'어선검사증서\s*[\(（]([^\)）]+)[\)）]'
    선박서류  : r'선박서류\s*[\(（]([^\)）]+)[\)）]'
  → 괄호 안 선박명 캡처 (예: "선적증서(만성호).pdf" → "만성호")

[2) 선박명 정규화]
  - 괄호/공백/접미사 제거: "(스피드호)" → "스피드호", "스피드 호" → "스피드호"
  - 별칭 사전 (사람 관리, 점진 확장): {"만성": "만성호", ...}
  - 정규화 키 = vesselNameNormalize(raw)

[3) hash 클러스터링 (G4 자동 클러스터링)]
  같은 정규화 선박명 + 같은 head-1MB hash → 동일 자산 사본 그룹
  같은 선박명 + 다른 hash → 버전 후보 (G3 — 연차 갱신 가능성)

[4) 마스터 후보 생성]
  클러스터별 대표 1개 → Asset(status=CANDIDATE, assetType=VESSEL)
  occurrenceCount = 사본 수 (다맥락 발자국 정량화)
  태그 자동 부여: domain=선박자산, work=선박특별검사신청, type=증명서

[5) 후보 정밀도 점수 (사람 승인 전)]
  score = w1·(파일명 패턴 일치) + w2·(occurrence ≥ N) + w3·(hash 클러스터 응집도)
  목표: 정밀도 ≥ 90% (Plan 성공 지표)

[6) 부서 책임자 승인 (G1 HITL)]
  GET /assets/candidates → 책임자 검토 → approve (태그·제목 보정)
```

### 5.2 정규화 난이도 대응 (R2)

- "스피드호" vs "(스피드호)" vs "스피드 호" → 정규화 함수로 흡수
- 애매한 케이스는 **자동 확정하지 않고** 클러스터 후보로 사람에게 노출 (G1·G4 혼합)
- 별칭 사전은 승인 과정에서 책임자가 추가 → 점진 학습

### 5.3 G3 버전 감지 (검사증서 연차)

```
매주 스캔 시 같은 선박명 + 새 hash 발견
  → asset_version 자동 추가 (is_latest=false, detected_at=now)
  → 책임자 검토 → confirm 시 is_latest=true 전환 (이전 latest는 false)
```

---

## 6. Security Considerations (security-architect 관점)

### 6.1 NAS 접근 보안 (정보 축적 원칙 직결)

- **read-only 마운트 강제**: ingestion은 SMB read-only 계정으로만 접근. 쓰기 권한 부여 금지 → R4(원본 훼손) 구조적 차단.
- **경로 제외 정책 (D4 확정)**: 현 nas-scan의 `EXCLUDE_TOP_DIRS`·`EXCLUDE_PATTERNS`(소프트웨어 폴더, `~$` 잠금파일, Thumbs.db 등) **그대로 계승**. 추가 제외 폴더 없음. 향후 민감 영역 제외가 필요하면 동일 화이트/블랙리스트 메커니즘으로 확장 가능(이번 범위 외).
- **DuckDB 스캔 캐시**: 사내 디스크에만 존재, 외부 미전송.

### 6.2 LLM 데이터 보안 (D3 확정: 하이브리드)

- **확정 정책 (D3)**: 하이브리드. **PoC 단계는 검색-only 또는 로컬 우선**으로 시작.
- **민감 본문 외부 전송 금지**: 계약서·증서 등 민감 본문은 **반드시 로컬 처리 또는 검색-only**로 한정한다. 외부 API로 전송하지 않는다.
- **외부 API 허용 범위**: 민감 분류가 아닌 일반 질의에 한해 외부 LLM API 활용 가능. 이때도 (a) 민감 태그 자산 본문 제외, (b) 가능하면 요약/메타만 전송, (c) DLP 정책 적용.
- **민감 분류 기준**: `asset_tag` 또는 `asset_type`(CONTRACT/CERTIFICATE 등)으로 민감 여부 판정 → search-api의 rag-service가 LLM 라우팅 시 분기.
- 임베딩(bge-m3)은 로컬 Ollama이므로 임베딩 단계 유출 없음 (확정). 비용 0 OCR 원칙([[project_nas_rag_ocr_policy]])과 일관.

### 6.3 인증·인가 (D2 확정: 자체 인증 → Phase3 SSO introspection)

- **Phase 1 (확정)**: OT-Brain **자체 인증**(사내 한정, 외부 미노출 — ERP와 동일 운영 단계). ERP JWT_SECRET 공유 안 함(별도 보안 경계 유지).
- 마스터 승인·버전 confirm은 **부서 책임자 role** 필요 (G1·G3 HITL).
- **Phase 3 (확정)**: ERP SSO를 **introspection 엔드포인트 방식**으로 연동(토큰을 ERP에 질의해 검증). JWT_SECRET 직접 공유 방식은 채택하지 않음.

### 6.4 체크리스트

- [ ] NAS read-only 계정 (쓰기 차단)
- [ ] 검색 API 입력 검증 (벡터 쿼리 인젝션·과도 topK 제한)
- [ ] LLM 전송 데이터 정책 (D3 확정: 민감 본문 로컬/검색-only, 외부 API는 비민감 일반 질의만)
- [ ] 마스터 승인 권한 검증 (책임자 role)
- [ ] 사내 네트워크 한정 바인딩 (127.0.0.1 / 내부 IP)

---

## 7. Infrastructure (infra-architect 관점)

### 7.1 별도 docker-compose (ERP와 분리)

```yaml
# ot-brain/docker-compose.yml (개념)
services:
  ot-postgres:          # 별도 pgvector 인스턴스 (project_nas_rag_vector_db)
    image: pgvector/pgvector:pg16
    volumes: [ot_pg_data:/var/lib/postgresql/data]
    # ERP postgres와 포트·볼륨 분리
  ot-ingestion:         # Python 스캐너 (nas-scan 이관)
    # NAS SMB read-only 마운트
  ot-knowledge-api:     # knowledge-core + search-api (Node/TS, D1)
  # ot-embedding:       # D5 확정: Phase1은 ERP Ollama bge-m3 공유 (별도 컨테이너 없음)
  #                       → Phase2 부하 평가 후 별도 인스턴스 분리 결정
  # ot-llm:             # D3 하이브리드: PoC는 검색-only/로컬 우선 (민감 본문 외부 금지)
volumes:
  ot_pg_data:
```

### 7.2 ERP 자산 재사용 vs 별도

| 자원 | 권장 | 근거 |
|------|------|------|
| PostgreSQL+pgvector | **별도 인스턴스** | [[project_nas_rag_vector_db]] — 30.4TB 스캔 부하를 ERP DB와 격리. 운영 독립성. |
| Ollama bge-m3 | **ERP 공유 (D5 확정)** | Phase1 PoC는 ERP Ollama 재사용(소량·1회성). Phase2 부하 평가 후 별도 분리 결정. |
| Docker Compose 패턴 | **재사용** | ERP 운영 방식 검증됨, GPU 불필요 |
| 백업·헬스체크 | ERP 패턴 계승 | db-backup 컨테이너 패턴 |

### 7.3 스캔 부하 관리 (R1)

- 30.4TB / 8.04M 파일 → 매주 전체 스캔은 비현실적. **증분 스캔**: mtime > last_scan 파일만 hash 재계산.
- 현 nas-scan의 size-group 1차 필터(hash 대상 70~85% 감소) + 12 워커 병렬 계승.
- 마스터만 임베딩 → 임베딩 비용 O(마스터 수) ≪ O(전체 파일).

### 7.4 별도 repo 구조 (Phase 0)

```
ot-brain/                  (별도 git repo)
├── services/
│   ├── ingestion/         (Python — nas-scan 이관, D1)
│   ├── knowledge-api/     (Node/TS — knowledge-core + search-api, D1)
│   └── embedding/         (Python — Ollama bge-m3 호출, ERP Ollama 공유 D5)
├── apps/
│   └── console/           (Next.js — 마스터 승인 UI + 검색 UI, ERP 스택 재사용)
├── infra/docker/
├── docs/                  (자체 PDCA)
└── docker-compose.yml
```

---

## 8. 검색·승인 UI (frontend — 범위 경량)

Phase 1 UI는 2개 화면으로 최소화 (PoC 검증 목적):

| 화면 | 책임 | 비고 |
|------|------|------|
| 마스터 승인 콘솔 | 후보 목록 → 태그·제목 보정 → 승인 (G1 HITL) | 책임자 전용 |
| 통합 검색 | 하이브리드 검색 + RAG 답변 + 사용처 표시 | ERP 검색 UI 패턴 재사용 가능 |

> D1 확정으로 콘솔은 Next.js(ERP 프론트 스택 재사용). ERP 공통 컴포넌트(`<DateInput>`·`<TimeInput>` 등)는 별도 repo이므로 직접 import는 불가하나, 동일 구현·동일 규칙(24h 표기, `<input type="date">` 금지)을 패키지 복제 또는 공유 패키지로 계승한다.

---

## 9. ✅ 기술 스택 결정 (D1~D5 — 2026-06-01 사용자 확정)

> Council 3인이 옵션·트레이드오프를 정리하고, 사용자가 5건 모두 확정했다. 본 섹션은 확정 결정의 근거 기록(Decision Log)이다.

| # | 항목 | ✅ 확정 결정 | 근거 |
|---|------|-------------|------|
| **D1** | 백엔드 언어 | **C — ingestion=Python(nas-scan 계승) / api=Node(ERP 스택 재사용)** | nas-scan은 검증된 Python 자산(ML/OCR 생태계), API·검색·연동은 ERP Node/TS 패턴 재사용. 경계 = DuckDB→PostgreSQL 적재 지점 (깨끗한 분리, 코드 의존 없음) |
| **D2** | 인증 | **A — 자체 인증 → Phase3 ERP SSO introspection** | Phase1 단독 완성·사내 한정. JWT_SECRET 공유 안 함(별도 보안 경계 유지). Phase3은 introspection 방식 |
| **D3** | LLM | **C — 하이브리드 (단 PoC는 검색-only/로컬 우선)** | 계약서·증서 등 민감 본문은 로컬·검색-only로 한정(외부 API 금지), 비민감 일반 질의만 외부 API 허용. 비용 0 OCR 원칙과 일관 |
| **D4** | NAS 스캔 범위 | **현 nas-scan 제외 정책 계승 (추가 제외 없음)** | EXCLUDE_TOP_DIRS·EXCLUDE_PATTERNS(임시·캐시·소프트웨어 등) 그대로. 향후 필요 시 동일 메커니즘으로 확장 |
| **D5** | Ollama 인스턴스 | **A — Phase1 ERP Ollama bge-m3 공유 → Phase2 부하 평가 후 별도** | PoC 임베딩은 1회성·소량, ERP Ollama 재사용. [[project_nas_rag_vector_db]] "Phase2 평가 후" 원칙과 동일 패턴 |

### 9.1 D1 분리 경계 (구현 계약)

```
ingestion (Python)                         knowledge-core / search-api (Node/TS)
  walk·hash·dedup·텍스트추출        적재     Prisma 모델 (asset / nas_copy / ... )
  → DuckDB(스캔 캐시)         ──────────▶   → PostgreSQL knowledge schema (SoR)
                              [M2 적재 어댑터]      ↑ Node 측은 이 DB를 읽기만
```

- **SoR**: PostgreSQL `knowledge` 스키마. ingestion이 적재(write), knowledge-core/search-api가 소비(read+승인 write).
- **두 런타임 간 코드 의존 없음** — 공유는 DB 스키마 계약뿐. 적재 어댑터(M2)가 유일한 인터페이스.
- Prisma는 Node 측 knowledge-core가 schema 마이그레이션 소유. Python ingestion은 동일 테이블에 raw SQL/psycopg로 적재.

### 9.2 D3 LLM 라우팅 정책 (구현 가이드)

```
검색 쿼리 / RAG 요청
  → 대상 자산 민감 분류 판정 (asset_type ∈ {CONTRACT, CERTIFICATE, ...} 또는 민감 태그)
     ├─ 민감       → 검색-only 결과 또는 로컬 LLM (외부 API 전송 금지)
     └─ 비민감 일반 → 외부 LLM API 허용 (요약/메타 우선, DLP 적용)
  ※ PoC 단계 기본값: 전체 검색-only로 시작, 답변 생성은 점진 도입
```

---

## 10. Clean Architecture

### 10.1 모듈별 4계층

| 모듈 | Presentation | Application | Domain | Infrastructure |
|------|-------------|-------------|--------|----------------|
| ingestion | (CLI/scheduler) | scan-orchestrator, dedup-service | File, ScanRun, HashGroup | nas-reader, duckdb, paddleocr |
| knowledge-core | 승인 콘솔 API | asset-service, approval-service, candidate-deriver(P1) | Asset, AssetUsage, AssetVersion, Tag | prisma/sqlalchemy repo |
| search-api | search/ask routes | search-service, rag-service | SearchQuery, RagAnswer | pgvector-client, ollama-client, llm-client |

### 10.2 의존 규칙

- Domain은 외부 의존 없음 (순수 엔티티/규칙).
- `asset_usage.external_ref_id`는 ERP FK가 아닌 텍스트 식별자 → 느슨한 결합 (별도 인스턴스 경계 보존).
- ingestion → knowledge-core는 DB 적재(단방향), 코드 의존 없음.

---

## 11. Test Plan

| Type | Target | Tool |
|------|--------|------|
| Unit | 선박명 정규화·파일명 패턴 추출 (§5) | pytest |
| Unit | hash 클러스터링·후보 점수 | pytest |
| Integration | 스캔 → 후보 도출 → 승인 → 임베딩 → 검색 e2e (소량 fixture) | pytest + testcontainers(pg) |
| 정밀도 | P1 후보 정밀도 ≥ 90% (Plan 성공 지표) | 라벨링 샘플 평가 |

### 11.1 핵심 테스트 케이스

- [ ] "선적증서(만성호).pdf" → 선박명 "만성호" 추출
- [ ] "(스피드호)" / "스피드 호" / "스피드호" → 동일 정규화 키
- [ ] 같은 선박명 + 새 hash → asset_version 자동 추가 (G3)
- [ ] 같은 hash 다중 경로 → nas_copy N개 + asset 1개 (모델 C)
- [ ] 마스터 미승인(CANDIDATE) 자산은 검색 결과 제외/구분

---

## 12. Implementation Guide (Phase 1 — Plan §7.1 마일스톤)

### 12.1 구현 순서

1. [ ] **M1**: 별도 repo `ot-brain` 생성 + docker-compose(ot-postgres pgvector) + schema 마이그레이션 (§3.3)
2. [ ] **M2**: nas-scan ingestion 이관 (scripts/nas-scan/ → ot-brain/services/ingestion/) + DuckDB→PG 적재 어댑터
3. [ ] **M3**: P1 선박 자산 자동 도출 (§5 알고리즘) — 파일명 패턴 + 정규화 + 클러스터링
4. [ ] **M4**: 마스터 승인 콘솔 (G1 HITL) + candidate API
5. [ ] **M5**: 마스터 임베딩 + 하이브리드 검색 API + 검색 UI
6. [ ] **M6**: ERP 자동첨부 API (P1→P2→P3) — Phase 3 진입 시

> **선결 조건 — ✅ 전부 충족 (2026-06-01)**: M1 착수에 필요한 D1(언어)·D4(스캔 범위) 확정 완료. M4~M5 관련 D2(인증)·D3(LLM)·D5(Ollama)도 확정 완료. **Do(M1) 진입 가능.**

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-06-01 | 초안 (Council 패턴: enterprise/security/infra 종합). 운영 모델 C 데이터 모델 + P1 알고리즘 + 미해결 5건(§9) | 오션테크 + Claude (CTO Lead) |
| 0.2 | 2026-06-01 | 사용자 결정 D1~D5 확정 반영 (D1 Python/Node 분리, D2 자체→SSO, D3 하이브리드 LLM, D4 현 제외정책, D5 ERP Ollama 공유). §9 확정 Decision Log + D1 경계 계약 §9.1 + D3 라우팅 정책 §9.2. Status Confirmed | 오션테크 + Claude (CTO Lead) |
