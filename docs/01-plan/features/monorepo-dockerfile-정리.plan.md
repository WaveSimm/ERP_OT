# monorepo-dockerfile-정리 Plan

> **PDCA Phase**: Plan
> **Status**: Draft
> **Created**: 2026-04-30
> **Author**: 오션테크 (yunsim@gmail.com) + Claude
> **Methodology**: Plan Plus
> **Related**: `prod-빌드-정리` (Match 92%, §D2에서 본 PDCA 분리 결정), `프로젝트-마일스톤-재설계` (Match 93%, 빌드 실패로 로컬 dev 우회 사례)

---

## 1. Overview

### 1.1 배경

`docker compose build` 명령이 **모든 백엔드 서비스 + 프런트엔드에서 실패**:

```
RUN cd /app/services/project && node /app/node_modules/typescript/bin/tsc
> Error: Cannot find module '/app/node_modules/typescript/bin/tsc'
> code: 'MODULE_NOT_FOUND'
```

원인: pnpm workspace 환경에서 `node_modules/typescript/bin/tsc`는 직접 경로가 아니라 `node_modules/.pnpm/typescript@5.x/...` 심볼릭링크 구조. 8개 Dockerfile(7 services + 1 web)이 모두 같은 잘못된 패턴 사용.

영향:
- PR-1 마일스톤 PDCA에서 docker rebuild 못 해서 로컬 `pnpm dev`로 우회
- "프로젝트가 사라졌어" 오해 발생 (docker container 정지 + network 격리)
- 운영 이관 시 회사 서버에서 docker compose만으로 가동 불가
- CI/CD 도입의 선결 조건

### 1.2 목표

8개 Dockerfile (services 7개 + web 1개)을 **Shared base image** 패턴으로 재작성하여:
1. `docker compose build` 성공
2. 이미지 크기·빌드 시간 효율화
3. 운영 이관 운영 표준 (HEALTHCHECK + non-root user)

### 1.3 비목표 (Out of This PDCA)

- CI/CD 자동화 (GHA 워크플로) — 별도 PDCA "ci-cd-기반"
- multi-arch (ARM/x64) 빌드
- Docker registry 푸시 자동화
- ocr-engine (Python Dockerfile, 다른 패턴) 재작성
- ocr-test-ui (nginx static), db-backup, ollama, postgres, redis, rabbitmq (외부 이미지)
- secrets management (security PDCA 영역)

---

## 2. User Intent Discovery (Plan Plus)

### Q1. 핵심 목적
"빌드 + 이미지 최적화" — `docker compose build` 성공 + 이미지 크기·빌드 시간 효율화

### Q2. 주 사용자
개발자 (현재) + 운영자 (이관 후)

### Q3. 성공 기준 (도출)
1. 8개 컨테이너 모두 docker compose build 성공
2. docker compose up 후 8개 모두 health check 통과
3. 마일스톤 PDCA 데이터 (2 milestones, 12 dependencies) 보존
4. PR-1/PR-2/PR-3 신규 코드 정상 동작
5. 이미지 크기 -10~20%, 빌드 시간 -30% 목표 (재빌드 시 캐시 활용)

### Q4. 제약
- 운영 중인 외부 이미지(ollama, postgres, redis, rabbitmq) 영향 0
- 마이그레이션 적용된 DB schema 보존 (project-service entrypoint의 `prisma db push`가 revert 시도하지 않도록)
- pnpm workspace symlink 처리 (node-linker 정책 결정)

---

## 3. Alternatives Explored (Plan Plus)

| 옵션 | 평가 | 선택 |
|------|------|:---:|
| (A) pnpm exec 패턴 (보수적) | 가장 빠른 unblock, 8 Dockerfile 동일 패턴 반복 (DRY 낮음), 최적화 효과 적음 | 기각 |
| **(B) Shared base image** | 빌드 통과 + 일관성 + 효율화, 변경 위치 1곳 + 서비스별 단순화 | ⭐ 채택 |
| (C) Turborepo prune 패턴 | 이미지 크기 -30~50%, 표준적이지만 학습·구조 변경 비용 큼 | 후속 (CI/CD 도입 시) |

---

## 4. YAGNI Review (Plan Plus)

### 4.1 In Scope (1차 릴리즈)

#### [A] Base image
- [ ] A1. `infra/docker/base.Dockerfile` 생성 (node:20-alpine + pnpm + corepack + non-root user 베이스)
- [ ] A2. base 이미지 빌드 단계 (docker-compose에 service로 추가 또는 build-all 스크립트)

#### [B] 8개 서비스 Dockerfile 재작성
- [ ] B1. services/auth/Dockerfile
- [ ] B2. services/user/Dockerfile
- [ ] B3. services/project/Dockerfile (Prisma 포함, 가장 복잡)
- [ ] B4. services/attendance/Dockerfile
- [ ] B5. services/equipment/Dockerfile
- [ ] B6. services/approval/Dockerfile
- [ ] B7. services/ocr/Dockerfile (PaddleOCR 의존성 확인)
- [ ] B8. apps/web/Dockerfile (Next.js standalone)

#### [C] 빌드 명령 통일
- [ ] C1. `pnpm install --frozen-lockfile`
- [ ] C2. `pnpm exec tsc` / `pnpm exec prisma generate` 패턴
- [ ] C3. runner stage에서 `pnpm install --prod` (production deps only)

#### [D] 빌드 검증
- [ ] D1. 8개 컨테이너 모두 `docker compose build` 성공
- [ ] D2. 8개 컨테이너 `docker compose up -d` 후 health 통과
- [ ] D3. PR-1 마일스톤 코드·데이터 정상 작동 확인

#### [E] 정리
- [ ] E1. .dockerignore 표준화 (node_modules, .git, dist, .next, .pnpm-store 등)
- [ ] E2. docker-compose.yml 정합 (build context, depends_on)

#### [F] 운영 표준
- [ ] F1. HEALTHCHECK 명령 8개 추가
- [ ] F2. non-root user 적용 (base에 정의)
- [ ] F3. 이미지 크기 측정·비교 (before/after 메트릭 기록)

### 4.2 Deferred (후속 PDCA)

- BuildKit cache mount (`RUN --mount=type=cache`) — 효과 좋지만 우선 단순 빌드부터
- multi-arch 빌드 — 회사 서버 아키텍처 결정 후
- 이미지 tag 정책 (latest, version, sha) — registry 도입 시점
- build-all.sh 스크립트 — 운영 후 패턴 잡힌 뒤
- CI/CD (GHA) — 별도 PDCA "ci-cd-기반"

### 4.3 Out of Scope

- ocr-engine (Python Dockerfile)
- ocr-test-ui (nginx)
- db-backup, ollama, postgres, redis, rabbitmq (외부 이미지)
- secrets management
- runtime monitoring

---

## 5. Functional Requirements

### FR-1. Base image 정의
- node:20-alpine 기반
- pnpm + corepack 활성화
- 공통 환경변수 (NODE_ENV, TZ)
- non-root user `app` (UID 1001)

### FR-2. 서비스별 Dockerfile 표준 패턴 (3-stage)
- `AS deps`: workspace package.json + lockfile만 복사 → install
- `AS builder`: 소스 복사 + 빌드 (tsc, prisma generate, next build)
- `AS runner`: dist + production deps + USER app + HEALTHCHECK

### FR-3. 빌드 명령 통일
- `pnpm install --frozen-lockfile` (deps stage)
- `pnpm exec <command>` 패턴 (tsc, prisma, next)
- `pnpm install --prod` (runner stage pruning)

### FR-4. HEALTHCHECK 명령
- 모든 backend service: `wget -q -O- http://localhost:<PORT>/health`
- web: `wget -q -O- http://localhost:3000/`
- interval 30s, timeout 5s, retries 3

### FR-5. .dockerignore 표준화
- node_modules, .git, dist, .next, .pnpm-store, *.log, .env*, README.md
- 모든 서비스 같은 패턴

### FR-6. project-service entrypoint 호환
- 기존 `entrypoint.sh`의 `prisma db push --skip-generate` 호환
- 신규 schema 적용된 DB는 schema 일치 → push 무동작 (검증 필수)

### FR-7. docker-compose.yml 갱신
- build context 정리
- depends_on에 db / redis / 다른 service 의존성 명시
- healthcheck 정의 (Dockerfile + compose 양쪽)

### FR-8. 이미지 크기·빌드 시간 메트릭
- before/after 측정값 docs에 기록

### FR-9. 회귀 검증
- 마일스톤 PDCA: 2 milestones, 12 deps 보존
- PR-1/PR-2/PR-3 코드 정상 동작
- 다른 PDCA(부하테스트, 검색개선 등) 영향 없음

---

## 6. Non-Functional Requirements

### NFR-1. 이미지 크기
- 목표: 8개 합계 -10~20% (현재 약 4~5GB 추정)
- 측정: `docker images | grep erp-ot`

### NFR-2. 빌드 시간
- 첫 빌드: 기존 대비 ±10% 이내 (base layer 추가 비용)
- 재빌드 (캐시 활용): -30% (공통 layer 캐시)
- 측정: `time docker compose build`

### NFR-3. 회귀 안전
- 모든 기존 PDCA 영향 0
- DB schema·data 보존
- 8개 컨테이너 부팅·health 통과

### NFR-4. 보안
- non-root user 모두 적용
- alpine 최신 패치 (openssl, libc6-compat 외 최소)
- 이미지 layer에 secrets 노출 없음 (.env는 runtime mount)

### NFR-5. 유지보수성
- 8개 Dockerfile 동일한 3-stage 구조
- base 변경 시 1곳 수정으로 전 서비스 적용

---

## 7. Technical Approach

### 7.1 Base image 구조

```dockerfile
# infra/docker/base.Dockerfile
FROM node:20-alpine

RUN apk add --no-cache openssl libc6-compat curl

RUN corepack enable && corepack prepare pnpm@latest --activate

# non-root user
RUN addgroup -g 1001 -S app && adduser -S app -G app -u 1001

WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Seoul

# pnpm 설정 — node-linker isolated (workspace 호환)
RUN pnpm config set store-dir /home/app/.pnpm-store \
 && pnpm config set node-linker isolated

# 기본 권한
RUN chown -R app:app /app
```

### 7.2 서비스 Dockerfile 표준 (project 예시)

```dockerfile
# services/project/Dockerfile
ARG BASE_IMAGE=erp-ot-base:latest

FROM ${BASE_IMAGE} AS deps
COPY pnpm-workspace.yaml .npmrc pnpm-lock.yaml package.json ./
COPY packages/config/package.json ./packages/config/
COPY services/shared/package.json ./services/shared/
COPY services/project/package.json ./services/project/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY packages/config ./packages/config
COPY services/shared ./services/shared
COPY services/project ./services/project
RUN pnpm --filter @erp-ot/shared build
RUN cd services/project && pnpm exec prisma generate
RUN pnpm --filter @erp-ot/project-service build

FROM ${BASE_IMAGE} AS runner
COPY --from=builder --chown=app:app /app/services/project/dist ./dist
COPY --from=builder --chown=app:app /app/services/project/prisma ./prisma
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app services/project/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER app
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O- http://localhost:3003/health || exit 1
ENTRYPOINT ["./entrypoint.sh"]
```

### 7.3 docker-compose.yml 변경

```yaml
services:
  base:
    build:
      context: .
      dockerfile: infra/docker/base.Dockerfile
    image: erp-ot-base:latest
    profiles: [build]   # `docker compose --profile build build base`로만 빌드

  project-service:
    build:
      context: .
      dockerfile: services/project/Dockerfile
      args:
        BASE_IMAGE: erp-ot-base:latest
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_started }
    healthcheck:
      test: ["CMD", "wget", "-q", "-O-", "http://localhost:3003/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

### 7.4 빌드 절차

```bash
# 1. base 빌드 (1회)
docker compose --profile build build base

# 2. 8개 서비스 빌드 (base layer 재사용)
docker compose build

# 3. 부팅
docker compose up -d

# 4. health 확인
docker compose ps   # STATUS = healthy
```

### 7.5 영향 받는 파일 (예상)

| 영역 | 파일 |
|------|------|
| 신규 | `infra/docker/base.Dockerfile` |
| 수정 | `services/auth/Dockerfile`, `user/`, `project/`, `attendance/`, `equipment/`, `approval/`, `ocr/Dockerfile` (7개) |
| 수정 | `apps/web/Dockerfile` |
| 수정 | `docker-compose.yml` (base profile + healthcheck + depends_on) |
| 수정·신규 | `.dockerignore` (8개 또는 root 1개) |

---

## 8. Acceptance Criteria

- [ ] AC-1: 8개 컨테이너 `docker compose build` 모두 성공
- [ ] AC-2: 8개 컨테이너 `docker compose up -d` 후 health 통과 (30s 내)
- [ ] AC-3: 마일스톤 PDCA 데이터 보존 (2 milestones, 12 dependencies)
- [ ] AC-4: PR-1/PR-2/PR-3 신규 코드 정상 동작 (curl 시나리오)
- [ ] AC-5: 이미지 크기 측정·기록 (before/after)
- [ ] AC-6: HEALTHCHECK 명령 8개 모두 동작 (`docker compose ps` STATUS=healthy)
- [ ] AC-7: non-root user `app` 8개 모두 적용
- [ ] AC-8: 회귀 — 다른 PDCA 영향 없음 (부하테스트, 검색개선, 게시판 등 sanity)
- [ ] AC-9: Match Rate ≥ 90%

---

## 9. Risks & Mitigations

| Risk | 영향 | 완화 |
|------|:---:|------|
| project-service entrypoint의 `prisma db push`가 새 schema revert | 高 | 마이그레이션 적용된 DB는 schema 일치 → no-op 검증, 첫 부팅 dry-run |
| pnpm workspace symlink 호환성 | 中 | base에서 `node-linker isolated` 설정, 빌드 검증 |
| ocr-service의 PaddleOCR 의존성 | 中 | base 적합성 확인 후 별도 패턴 가능 |
| 이미지 빌드 8회 시간 | 低 | base 캐시로 재빌드 시 -50% 기대 |
| 외부 이미지(ollama, redis 등) 영향 | 低 | 변경 없음 — 영향 0 |
| pnpm install 시 .npmrc 차이 | 中 | base에 통일 설정, .npmrc 검토 |

---

## 10. Brainstorming Log

### Q1 핵심 목적
- (a) 단순 빌드 vs (b) 빌드+최적화 vs (c) 빌드+운영표준 vs (d) 빌드+CI/CD
- 사용자: **(b) 빌드 + 이미지 최적화** 채택

### Approach 선택
- A pnpm exec / B Shared base / C Turbo prune 비교
- 사용자: **B Shared base** 채택 (빌드 + 최적화 의도와 정합)

### YAGNI 분류
- 사용자: 권장 분류 채택 — A+B+C+D+E + F1/F2/F3 In Scope, G+H Deferred

---

## 11. Next Steps

1. **Plan 검토 후** → `/pdca design monorepo-dockerfile-정리`
2. **Design 단계**: services/ocr 별도 패턴 검토, .dockerignore 패턴 결정, base의 pnpm 설정 정밀화
3. **Do 단계**: Step 1~9 순서대로 진행 (Plan §7.4 참조)
4. **Check 단계**: gap-detector → AC-1~AC-9 측정 → Match Rate 산출
5. **후속 PDCA 후보**:
   - `ci-cd-기반` (GHA + Docker registry)
   - `dockerfile-cache-mount` (BuildKit `--mount=type=cache`)
   - `multi-arch-빌드` (회사 서버 ARM 도입 시)
