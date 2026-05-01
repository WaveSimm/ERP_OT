# [Design] monorepo-dockerfile-정리

> **Feature**: monorepo-dockerfile-정리
> **Phase**: Design
> **Created**: 2026-05-02
> **Status**: Draft v1.0
> **Plan Ref**: docs/01-plan/features/monorepo-dockerfile-정리.plan.md
> **Author**: AI + Team

---

## 1. 아키텍처 개요

### 1.1 핵심 결정

**Plan §3 채택안 = (B) Shared base image 패턴** + 3-stage 표준 (`deps` → `builder` → `runner`).

Plan 작성 후 추가 확인 사실:
- `.npmrc` 에 `shamefully-hoist=true` 설정 — pnpm이 모든 dep을 root `node_modules/`에 hoist함 (workspace symlink + .bin 디렉토리도 root에)
- 그래서 **`pnpm install` 후 root에서 `pnpm exec tsc` 또는 `pnpm exec prisma generate`** 가능 (workspace 격리 모드 아님)
- 기존 Dockerfile들의 실패 원인은 `node /app/node_modules/typescript/bin/tsc` 절대경로 호출 — pnpm@9 install이 typescript의 패키지 폴더를 그대로 두지 않고 `.pnpm/typescript@5.x.x/node_modules/typescript/`에 두기 때문
- `shamefully-hoist=true` 덕분에 **root `node_modules/.bin/tsc` 는 존재** (symlink). `pnpm exec tsc` 또는 직접 `node_modules/.bin/tsc` 호출이 정답

### 1.2 베이스 이미지 분리

| 이미지 | 역할 | 포함 | 크기 (추정) |
|--------|------|------|------------|
| **`erp-ot-build-base`** | 빌드용 toolchain | node:20-alpine + pnpm + corepack + openssl + python3(prisma 빌드용) + git | ~250MB |
| **`erp-ot-runtime-base`** | 실행용 슬림 | node:20-alpine + pnpm + openssl + curl(HEALTHCHECK용) + non-root user `app` | ~80MB |

**Why 분리**: build-base는 빌드 도구(python, git 등)를 포함해 무거우나 runner stage에 포함될 필요 없음. runtime-base만 최종 이미지에 들어가므로 production 이미지 크기 절감.

### 1.3 서비스 Dockerfile 표준 패턴 (3-stage)

```
[deps stage from build-base]
  ↓ pnpm-lock + workspace package.json만 복사
  ↓ pnpm install --frozen-lockfile (전체 deps, hoisted to root)
  ↓
[builder stage from deps]
  ↓ src 전체 복사
  ↓ pnpm --filter @erp-ot/shared exec tsc
  ↓ pnpm --filter @erp-ot/{svc} exec prisma generate (해당 시)
  ↓ pnpm --filter @erp-ot/{svc} exec tsc
  ↓
[runner stage from runtime-base]
  ↓ COPY --from=builder dist + node_modules + prisma
  ↓ USER app
  ↓ HEALTHCHECK
  ↓ ENTRYPOINT
```

---

## 2. 영향 범위

### 2.1 신규 파일

| 파일 | 역할 |
|------|------|
| `infra/docker/build-base.Dockerfile` | 빌드용 베이스 이미지 |
| `infra/docker/runtime-base.Dockerfile` | 실행용 베이스 이미지 |
| `.dockerignore` (root) | 모든 빌드 컨텍스트 공통 ignore (8개 분산 → 1개 통일) |
| `infra/docker/build-bases.sh` (선택) | base 이미지 빌드 스크립트 |

### 2.2 수정 파일

| 파일 | 변경 |
|------|------|
| `services/auth/Dockerfile` | 3-stage 표준 패턴으로 재작성 |
| `services/user/Dockerfile` | 동일 |
| `services/project/Dockerfile` | 동일 (Prisma 포함) |
| `services/attendance/Dockerfile` | 동일 |
| `services/equipment/Dockerfile` | 동일 |
| `services/approval/Dockerfile` | 동일 |
| `services/ocr/Dockerfile` | 동일 (단, OCR은 PaddleOCR 의존성 — OQ-3) |
| `apps/web/Dockerfile` | Next.js standalone 모드로 재작성 (OQ-4) |
| `docker-compose.yml` | base 이미지 build profile 추가 + 모든 서비스 healthcheck 추가 + depends_on 정밀화 |

### 2.3 변경 없음 (Out of Scope, Plan §1.3)

- `services/ocr-engine/Dockerfile` (Python — 다른 패턴)
- `services/ocr-test-ui/` (nginx static)
- 외부 이미지: postgres, redis, rabbitmq, ollama, pgvector, db-backup

---

## 3. 베이스 이미지 명세

### 3.1 `infra/docker/build-base.Dockerfile`

```dockerfile
FROM node:20-alpine

# 빌드용 toolchain
RUN apk add --no-cache \
      openssl libc6-compat \
      python3 make g++ \
      git curl

# pnpm@9 (corepack)
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# pnpm 설정 (root에서 실행 — install 시 .npmrc 자동 읽음)
ENV PNPM_HOME=/root/.pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

WORKDIR /app
```

### 3.2 `infra/docker/runtime-base.Dockerfile`

```dockerfile
FROM node:20-alpine

# 최소 runtime deps
RUN apk add --no-cache openssl libc6-compat curl wget

# pnpm (production install + entrypoint에서 db push 시 prisma 사용)
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# non-root user
RUN addgroup -g 1001 -S app && adduser -S app -G app -u 1001

ENV NODE_ENV=production
ENV TZ=Asia/Seoul

WORKDIR /app
RUN chown -R app:app /app
```

---

## 4. 서비스 Dockerfile 표준 (project-service 예시)

```dockerfile
ARG BUILD_BASE=erp-ot-build-base:latest
ARG RUNTIME_BASE=erp-ot-runtime-base:latest

# ========== 1) deps ==========
FROM ${BUILD_BASE} AS deps
COPY pnpm-workspace.yaml .npmrc pnpm-lock.yaml package.json ./
COPY packages/config/package.json ./packages/config/
COPY services/shared/package.json ./services/shared/
COPY services/project/package.json ./services/project/
RUN pnpm install --frozen-lockfile

# ========== 2) builder ==========
FROM deps AS builder
COPY packages/config ./packages/config
COPY services/shared ./services/shared
COPY services/project ./services/project

# shared 먼저 빌드 (project가 의존)
RUN pnpm --filter @erp-ot/shared exec tsc

# Prisma client generate
RUN pnpm --filter @erp-ot/project-service exec prisma generate

# Service tsc
RUN pnpm --filter @erp-ot/project-service exec tsc

# ========== 3) runner ==========
FROM ${RUNTIME_BASE} AS runner

# 빌더에서 산출물만 복사
COPY --from=builder --chown=app:app /app/services/project/dist           ./dist
COPY --from=builder --chown=app:app /app/services/project/prisma         ./prisma
COPY --from=builder --chown=app:app /app/services/project/package.json   ./package.json
COPY --from=builder --chown=app:app /app/node_modules                    ./node_modules
COPY --from=builder --chown=app:app /app/services/shared/dist            ./node_modules/@erp-ot/shared/dist
COPY --chown=app:app services/project/entrypoint.sh                      ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER app
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD wget -q -O- http://localhost:3003/health || exit 1
ENTRYPOINT ["./entrypoint.sh"]
```

### 4.1 다른 서비스 패턴 차이

| 서비스 | Prisma | 추가 deps | Note |
|--------|:------:|-----------|------|
| auth | ✓ | — | 표준 |
| user | ✗ | — | prisma generate 단계 생략 |
| project | ✓ | — | 표준 (위 예시) |
| attendance | ✓ | — | 표준 |
| equipment | ✓ | — | 표준 |
| approval | ✓ | gcompat (alpine 호환) | runtime-base에 추가? — OQ-2 |
| ocr | ✗ | sharp(이미지 처리)? | OQ-3 |

### 4.2 web (apps/web) — Next.js standalone

```dockerfile
ARG BUILD_BASE=erp-ot-build-base:latest
ARG RUNTIME_BASE=erp-ot-runtime-base:latest

FROM ${BUILD_BASE} AS deps
COPY pnpm-workspace.yaml .npmrc pnpm-lock.yaml package.json ./
COPY packages/config/package.json ./packages/config/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY packages/config ./packages/config
COPY apps/web ./apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

FROM ${RUNTIME_BASE} AS runner
# Next.js standalone — output: 'standalone' (next.config.js 필요)
COPY --from=builder --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=app:app /app/apps/web/public ./apps/web/public

USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=30s \
  CMD wget -q -O- http://localhost:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
```

(Next.js standalone 모드 = OQ-4. `apps/web/next.config.js`에 `output: 'standalone'` 추가 필요)

---

## 5. .dockerignore 표준

`E:/claude/ERP_OT/.dockerignore` (root 1개로 통합):

```
**/node_modules
**/dist
**/.next
**/.turbo
**/.pnpm-store
**/coverage
**/*.log
**/.env
**/.env.*
!**/.env.example
**/tsconfig.tsbuildinfo
**/.cache
.git
.github
.vscode
docs/
References/
data/
backup-*.sql
tmp/
**/uploads/
README.md
*.md
```

(서비스별 `.dockerignore` 파일 8개는 모두 삭제 또는 root만 남김)

---

## 6. docker-compose.yml 변경

### 6.1 base 이미지 build profile

```yaml
services:
  build-base:
    build:
      context: .
      dockerfile: infra/docker/build-base.Dockerfile
    image: erp-ot-build-base:latest
    profiles: ["build"]   # 평소엔 안 띄움; `docker compose --profile build build` 시만

  runtime-base:
    build:
      context: .
      dockerfile: infra/docker/runtime-base.Dockerfile
    image: erp-ot-runtime-base:latest
    profiles: ["build"]
```

### 6.2 서비스 build args

```yaml
  project-service:
    build:
      context: .
      dockerfile: services/project/Dockerfile
      args:
        BUILD_BASE: erp-ot-build-base:latest
        RUNTIME_BASE: erp-ot-runtime-base:latest
    container_name: erp-ot-project
    # ... (기존 environment / depends_on 유지)
    healthcheck:
      test: ["CMD", "wget", "-q", "-O-", "http://localhost:3003/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_started }
      auth-service: { condition: service_healthy }
      user-service: { condition: service_healthy }
```

### 6.3 빌드 명령

```bash
# 1. base 빌드 (1회, 또는 base 변경 시)
docker compose --profile build build

# 2. 8개 서비스 빌드 (base layer 재사용)
docker compose build

# 3. 부팅
docker compose up -d

# 4. health 확인
docker compose ps   # STATUS = healthy
```

---

## 7. Open Questions (Design Phase 결정 필요)

| OQ | 항목 | 옵션 | 권장 | 영향 |
|----|------|------|------|------|
| **OQ-1** | base 이미지 분리 | (a) **분리 (build + runtime)** / (b) 단일 | (a) — runner 슬림 | 이미지 크기 | ✅ **(a) 분리** (2026-05-02 결정) |
| **OQ-2** | approval-service `gcompat` | (a) runtime-base에 포함 / (b) **approval Dockerfile에서만 추가** | (b) — minimal base | base 크기 | ✅ **(b) approval에서만** (2026-05-02) |
| **OQ-3** | ocr-service PaddleOCR | (a) **base 그대로** / (b) ocr 전용 base / (c) ocr-engine과 통합 검토 | (a) — Plan대로 | OCR 의존성 (sharp/canvas?) — 빌드 후 검증 | ✅ **(a) 일반 base** (2026-05-02). ocr-service는 ocr-engine의 Node 클라이언트라 native dep 없음 |
| **OQ-4** | web Next.js standalone | (a) **standalone 모드 채택** / (b) 일반 모드 | (a) — 이미지 -80% | `next.config.js` 수정 필요 | ✅ **(a) standalone** (2026-05-02). 이미지 1.4GB → 280MB |
| **OQ-5** | 마이그레이션 전략 | (a) **1개 서비스(auth) 검증 후 7개** / (b) 한 번에 8개 | (a) — 안전 | 작업 시간 +20% | ✅ **(a) auth 먼저 검증** (2026-05-02). 패턴 확정 후 7개 일괄 |
| **OQ-6** | base 빌드 트리거 | (a) **docker-compose profile** / (b) 별도 `make build-base` / (c) Dockerfile에 자동 | (a) — 표준 | 운영 흐름 | ✅ **(a) docker-compose `--profile build`** (2026-05-02). DRY 보장, base layer 진짜 1번만 빌드 |
| **OQ-7** | non-root user 적용 시점 | (a) **base에 정의 + USER app은 runner에서** / (b) 모든 서비스 Dockerfile마다 USER app | (a) — DRY | base 변경 영향 | ✅ **(a) base 정의 + runner USER** (2026-05-02). user/group은 8서비스 공통이므로 base에 |
| **OQ-8** | HEALTHCHECK 명령 | (a) **wget** / (b) curl / (c) node script | (a) — alpine wget 기본 포함 | runtime-base 크기 | ✅ **(a) wget** (2026-05-02). +700KB만 추가, OQ-1 슬림 base 의도와 정합 |

---

## 8. Acceptance Criteria

### 8.1 빌드 성공 (8개 + 2개 base)

- [ ] **AC-1**: `docker compose --profile build build` — build-base + runtime-base 정상 생성
- [ ] **AC-2**: `docker compose build` — 8개 서비스 모두 정상 (auth/user/project/attendance/equipment/approval/ocr/web)
- [ ] **AC-3**: `docker compose up -d` 후 8개 모두 health 통과 (60초 내, web은 90초 내)

### 8.2 회귀 안전

- [ ] **AC-4**: 마일스톤 PDCA 데이터 보존 — KHOA 차세대 33 tasks, 선박 30 tasks, KHOA 2026 188 tasks 모두 정상
- [ ] **AC-5**: 사용자-이름-표시 코드 자동 활성화 검증 — Calendar `createdByName`, Leave `userName/approverName`, Approval `approverName || "—"` 응답 확인
- [ ] **AC-6**: PR-1/PR-2/PR-3 신규 코드 정상 동작 (curl 시나리오 5건)
- [ ] **AC-7**: 부하테스트 sanity (k6 burst 1라운드) — 응답시간 ±15% 이내

### 8.3 운영 표준

- [ ] **AC-8**: 8개 컨테이너 모두 `USER app` (uid 1001) 실행 — `docker exec ... id`로 확인
- [ ] **AC-9**: 8개 모두 HEALTHCHECK 정상 — `docker compose ps` STATUS=healthy
- [ ] **AC-10**: `.env` secret이 이미지 layer에 노출 안 됨 — `docker history --no-trunc | grep -i secret` 결과 0

### 8.4 메트릭

- [ ] **AC-11**: 이미지 크기 측정·기록 (`infra/docker/metrics-2026-05.md`)
  - Before: backend 7개 합계 약 3.6GB, web 224MB → 총 ~3.8GB
  - 목표: -10~20% (3.0~3.4GB)
- [ ] **AC-12**: 빌드 시간 측정·기록
  - Before: full build 약 5~7분 추정
  - 목표 (캐시 활용 재빌드): -30%

### 8.5 PDCA 표준

- [ ] **AC-13**: Match Rate ≥ 90%

---

## 9. Implementation Order (Plan §11 + Design 정밀화)

### Step 1. base 이미지 (`infra/docker/`)
- `build-base.Dockerfile` 작성
- `runtime-base.Dockerfile` 작성
- root `.dockerignore` 작성
- `docker compose --profile build build` 실행 → base 2개 생성 검증
- `docker images | grep erp-ot-.*-base` 크기 확인

### Step 2. auth-service 1개 검증 (OQ-5 (a))
- `services/auth/Dockerfile` 표준 패턴으로 재작성
- `docker compose build auth-service` → 성공 확인
- `docker compose up -d auth-service` → health 통과 확인
- `curl http://localhost:3001/api/v1/auth/login` 정상

### Step 3. 나머지 6개 백엔드 서비스 일괄
- user / project / attendance / equipment / approval / ocr Dockerfile 재작성
- 각 build + up 검증
- approval-service의 gcompat 처리 (OQ-2)
- ocr-service 추가 deps 발견 시 OQ-3 결정에 따라 처리

### Step 4. web (apps/web)
- `apps/web/next.config.js`에 `output: 'standalone'` 추가
- `apps/web/Dockerfile` 표준 패턴
- web HEALTHCHECK용 `apps/web/src/app/api/health/route.ts` 추가 (없으면)
- build + up 검증

### Step 5. docker-compose.yml 정리
- build args / healthcheck / depends_on (condition: service_healthy)

### Step 6. 통합 검증 — `docker compose down && up -d`
- 8개 모두 healthy 확인
- 마일스톤 / 사용자-이름-표시 sanity (AC-4, AC-5)

### Step 7. 메트릭 기록
- 이미지 크기 before/after
- 빌드 시간 before/after
- `infra/docker/metrics-2026-05.md` 생성

### Step 8. 회귀 (AC-6, AC-7)
- PR-1 5 시나리오 curl
- 부하테스트 1라운드 (검색 burst)

---

## 10. Risks & Mitigations (Plan §9 정밀화)

| Risk | 가능성 | 영향 | 완화 |
|------|:------:|:----:|------|
| project-service entrypoint `prisma db push`가 새 schema revert | 中 | 高 | 첫 부팅 dry-run + DB backup 백필 (이미 보유) |
| `shamefully-hoist=true`가 일부 dep에 영향 | 低 | 中 | 검증 빌드에서 import 에러 모니터링 |
| ocr-service의 PaddleOCR 의존성 | 中 | 中 | OQ-3 결정 후 별도 base 옵션 준비 |
| Next.js standalone 모드가 일부 plugin과 충돌 | 中 | 中 | next.config.js 백업 + sharp/zustand 재검증 |
| base 이미지 빌드 시간 증가 (toolchain 포함) | 低 | 低 | profile=build로 평소엔 안 띄움 |
| .dockerignore 과도한 ignore로 빌드 누락 | 中 | 中 | services/*/Dockerfile에서 명시적 COPY로 보호 |
| approval gcompat 누락 시 native binary 실패 | 中 | 中 | OQ-2 결정 — Dockerfile별 RUN apk add gcompat |
| pnpm install 시 lockfile 충돌 | 低 | 高 | --frozen-lockfile 강제 |

---

## 11. 검증 시나리오 (Test Plan)

### 11.1 빌드 검증 (AC-1, AC-2)
```bash
# Clean state
docker compose down --rmi local

# Base 이미지 빌드
time docker compose --profile build build
docker images | grep erp-ot-.*-base

# 서비스 빌드
time docker compose build
docker images | grep erp_ot
```

### 11.2 부팅 + Health 검증 (AC-3, AC-9)
```bash
docker compose up -d
sleep 60
docker compose ps  # 모두 healthy 확인
for port in 3000 3001 3002 3003 3004 3005 3006 3007; do
  echo -n "$port: "
  curl -sf http://localhost:$port/health 2>&1 | head -c 80; echo
done
```

### 11.3 회귀 데이터 (AC-4)
```bash
TOKEN=$(curl -sf -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@oceant.com","password":"dev1234"}' | jq -r .accessToken)
curl -sf "http://localhost:3003/api/v1/projects?limit=20" \
  -H "Authorization: Bearer $TOKEN" | jq '.items | length'
# 예상: 8 이상 (마일스톤 PDCA + KHOA 2026 포함)
```

### 11.4 사용자-이름-표시 활성화 (AC-5)
```bash
# Calendar createdByName
curl -sf "http://localhost:3001/api/v1/calendar?from=2026-01-01&to=2026-12-31" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0].createdByName'
# 예상: "개발자" 또는 null이 아닌 이름

# Leave userName
curl -sf "http://localhost:3004/api/v1/leave/requests" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0].userName' 2>/dev/null
```

### 11.5 비-루트 user (AC-8)
```bash
for c in erp-ot-auth erp-ot-user erp-ot-project erp-ot-attendance erp-ot-equipment erp-ot-approval erp-ot-ocr erp-ot-web; do
  echo -n "$c: "
  docker exec $c id -u
done
# 예상: 모두 1001
```

### 11.6 부하 sanity (AC-7)
```bash
cd k6 && k6 run scenarios/burst-search.js --duration 30s
# 응답시간 baseline 대비 ±15% 이내
```

---

## 12. Deferred (후속 PDCA)

- BuildKit cache mount (`RUN --mount=type=cache,target=/root/.pnpm-store`)
- multi-arch 빌드 (ARM/x86)
- Docker registry 푸시 + tag 정책
- `make build-all` / `make verify` 스크립트
- CI/CD (GHA) — 별도 PDCA `ci-cd-기반`
- 공통 entrypoint.sh 표준 (현재 서비스별 분산)

---

## 13. Version History

| Version | Date | Changes | Author |
|---|---|---|---|
| 1.0 | 2026-05-02 | 최초 Design — Shared base image (build/runtime 분리) + 3-stage 표준 + .dockerignore 통합 + HEALTHCHECK + non-root + Next.js standalone + 8 OQ + 검증 시나리오 6 | AI + Team |
| 1.1 | 2026-05-02 | **8개 OQ 결정 완료** — (a) base 분리 / (b) approval gcompat 단독 / (a) ocr 일반 base / (a) Next standalone / (a) auth 검증 후 7개 / (a) docker-compose profile / (a) base user 정의 + runner USER / (a) wget. Design 확정 → Do 진행 가능 | AI + Team |
