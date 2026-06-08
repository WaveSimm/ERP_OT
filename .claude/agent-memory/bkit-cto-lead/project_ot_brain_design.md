---
name: project-ot-brain-design
description: OT-Brain Design v0.2 Confirmed — D1~D5 5건 확정 반영, Do(M1) 진입 준비 완료
metadata:
  type: project
---

# OT-Brain Design v0.2 Confirmed — 2026-06-01

## 사용자 확정 결정 D1~D5 (2026-06-01) — Design 문서 §9 Decision Log로 전환됨
- **D1 백엔드 언어 = C**: ingestion=Python(nas-scan 계승) / api=Node·TS(ERP 스택 재사용). 경계 = DuckDB→PostgreSQL `knowledge` schema 적재 지점(M2 어댑터). 두 런타임 코드 의존 없음(DB 계약만). Prisma는 Node 측 소유, Python은 raw SQL 적재. 콘솔 UI=Next.js.
- **D2 인증 = A**: 자체 인증 → Phase3 ERP SSO introspection. JWT_SECRET 공유 안 함(별도 보안 경계).
- **D3 LLM = C 하이브리드**: PoC는 검색-only/로컬 우선. 민감 본문(CONTRACT/CERTIFICATE 등 asset_type/태그)은 외부 API 전송 금지, 비민감 일반 질의만 API 허용.
- **D4 NAS 스캔 = 현 정책 계승**: EXCLUDE_TOP_DIRS·EXCLUDE_PATTERNS 그대로, 추가 제외 없음.
- **D5 Ollama = A 공유**: Phase1 ERP Ollama bge-m3 공유 → Phase2 부하 평가 후 별도.

## M1 진행 (2026-06-01, swarm 패턴)
- **별도 repo 생성**: `E:\claude\ot-brain` (ERP_OT 형제, settings.local.json additionalDirectories에 등록). 마이그레이션 방식 **A 하이브리드(Prisma + raw SQL)** 확정.
- **생성 파일** (14개): README/.gitignore/.env.example/docker-compose.yml + services/{ingestion,embedding}/README(스텁) + apps/console/README + infra/docker/README + docs/README + services/knowledge-api/{package.json,tsconfig.json,prisma/schema.prisma + prisma/migrations/20260601000000_init_knowledge/migration.sql + migration_lock.toml}
- **ot-postgres**: pgvector/pgvector:pg16, `127.0.0.1:5433:5432`, POSTGRES_DB=otbrain, 볼륨 ot_pg_data. Ollama 신규 컨테이너 없음(ERP 11434 공유, 주석 명시).
- **schema.prisma**: 6 엔티티, asset_embedding.embedding=`Unsupported("vector(1024)")`, datasource schemas=["knowledge"], extensions=[vector,pg_trgm].
- **migration.sql**: 스키마+확장(vector,pg_trgm) → 6테이블 → vector(1024) ALTER ADD → HNSW(vector_cosine_ops) → GIN trgm(title). Design §3.3 정확 반영.
- **⚠️ 미실행(권한)**: Bash 거부로 `git init`·`docker compose up`·`prisma migrate deploy` 미수행 → 사용자 직접 실행 대기. Write/Edit는 ot-brain 경로 허용됨, Bash는 여전히 거부.

**다음 단계**: 사용자가 docker/마이그레이션 실행 → 6테이블·확장·인덱스 확인 후 **M2**(nas-scan 이관 + DuckDB→PG 적재 어댑터). 이후 M3(P1 선박 자동도출)·M4(승인 콘솔)·M5(임베딩+검색).

---

# (이력) Design v0.1 작성 (Council 패턴) — 2026-06-01

OT-Brain(별도 독립 Enterprise Knowledge Platform, NAS 30.4TB + ERP + 미래 메일/Teams 흡수)의 PDCA Design 단계를 CTO-Led Council 패턴으로 진행. Design v0.1 작성 완료.

- **Plan 문서**: `docs/01-plan/features/OT-Brain.plan.md` (8개 결정 확정: 운영모델 C, PoC 3종, G1~G6)
- **Design 문서**: `docs/02-design/features/OT-Brain.design.md`
- **PDCA status**: OT-Brain feature 추가, phase=design, primaryFeature=OT-Brain

**Why:** Plan에서 사용자가 운영 모델 C·PoC·거버넌스를 이미 확정했고, Design은 이를 구현 명세(데이터 모델·P1 알고리즘·인프라)로 전환하는 단계. 미해결 4개 기술 결정(언어·인증·LLM·인프라)은 임의 확정 금지 원칙([[feedback_review_before_execute]])에 따라 옵션으로 표면화함.

**How to apply:** Design 후속(사용자 결정 → Do 진입) 시 Design 문서 §9의 D1~D5 결정 결과를 반영. M1(별도 repo 생성) 착수 전 D1(언어)·D4(스캔범위) 확정 필요.

## 작성한 Design 핵심
- 운영 모델 C 데이터 모델: Asset / AssetVersion / AssetUsage(N:M) / AssetTag(다중) / NasCopy(G2 원본불변) / AssetEmbedding(마스터 1회) + pgvector schema `knowledge`
- P1 선박 자산 자동 도출 알고리즘 (§5): 파일명 패턴 추출 → 선박명 정규화("(스피드호)"→"스피드호") → hash 클러스터링 → 후보 점수 ≥90% → G1 HITL 승인
- NAS 흡수 파이프라인 9단계 (매주 스캔 → 사본메타 → AI후보 → 승인 → 마스터 임베딩)

## ⚠️ 사용자 결정 필요 5건 (Design §9, council 권장안)
- **D1 백엔드 언어**: 권장 **C(ingestion=Python / api=Node)**. nas-scan 보존 + ERP 스택 재사용
- **D2 인증**: 권장 **A(자체→Phase3 SSO introspection)**. JWT_SECRET 직접 공유는 비권장
- **D3 LLM**: 권장 **C(하이브리드)/PoC는 검색-only 또는 로컬 우선**. 계약서·증서 본문 외부 API 전송 민감
- **D4 NAS 스캔 범위**: 권장 **B 검토(개인/인사/급여 폴더 제외)**. 사용자가 제외 폴더 지정 필요
- **D5 Ollama 인스턴스**: 권장 **A(ERP 공유)→Phase2 부하평가 후 별도**

관련: [[project_oceantech_knowledge_platform]] [[project_knowledge_platform_operation_model]] [[project_special_vessel_inspection]] [[project_nas_repeat_pattern]] [[project_nas_rag_ocr_policy]] [[project_nas_rag_vector_db]]
