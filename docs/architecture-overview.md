# ERP-OT 프로젝트 아키텍처 개요

> 작성일: 2026-03-19  
> 대상: `E:\claude\ERP_OT`

---

## 1. 전체 아키텍처 개요

```
[브라우저]
    │ HTTP/WebSocket
    ▼
[apps/web]  ← Next.js 14 (Node.js 기반, Docker 컨테이너)
    │ HTTP API 호출
    ▼
[services/]  ← Fastify 마이크로서비스들 (각각 별도 Docker 컨테이너)
    │
    ├── auth-service    :3001  (JWT 인증/인가)
    ├── user-service    :3002  (사용자 관리)
    └── project-service :3003  (프로젝트/태스크, 구현 완료)
    │
    ▼
[인프라 레이어] — 모두 Docker 컨테이너
    ├── PostgreSQL :5432  (메인 DB)
    ├── Redis      :6379  (캐시/세션)
    └── RabbitMQ   :5672  (메시지 큐)
```

---

## 2. 모노레포 구조 (Turborepo + pnpm workspace)

```
ERP_OT/
├── apps/           ← 프론트엔드 앱
│   └── web/        ← Next.js 14 (포트 3000)
│
├── services/       ← 백엔드 마이크로서비스 (Node.js/TypeScript)
│   ├── auth/       ← 인증 서비스 (스켈레톤)
│   ├── user/       ← 사용자 서비스 (스켈레톤)
│   ├── project/    ← 프로젝트 서비스 (구현 완료)
│   └── shared/     ← 공통 유틸리티/타입
│
├── packages/       ← 공유 패키지
│   ├── ui/         ← shadcn/ui 기반 공통 컴포넌트
│   ├── api-client/ ← 자동 생성 API 클라이언트
│   └── config/     ← ESLint, TypeScript, Tailwind 공통 설정
│
├── docs/           ← PDCA 문서
├── scripts/        ← 유틸리티 스크립트
├── docker-compose.yml         ← 프로덕션
└── docker-compose.local.yml   ← 로컬 개발용
```

`pnpm-workspace.yaml`이 `apps/*`, `packages/*`, `services/*`를 모두 하나의 워크스페이스로 묶고,
**Turborepo**가 빌드/테스트/린트를 병렬 캐시 처리한다.

---

## 3. 프론트엔드: `apps/web` (Next.js 14)

```
apps/web/
├── src/
│   ├── app/        ← App Router (서버/클라이언트 컴포넌트 혼용)
│   ├── components/ ← UI 컴포넌트
│   └── lib/        ← 유틸리티, API 클라이언트
├── next.config.mjs
└── Dockerfile
```

**기술 스택:**

| 항목 | 기술 |
|------|------|
| 프레임워크 | Next.js 14 (App Router) |
| 언어 | TypeScript |
| 스타일 | Tailwind CSS |
| 서버 상태 | TanStack Query |
| 클라이언트 상태 | Zustand |
| 컴포넌트 | shadcn/ui |

Docker 컨테이너 안에서 `next start`가 Node.js HTTP 서버로 실행 → 포트 3000

---

## 4. 백엔드: `services/` (Fastify 마이크로서비스)

각 서비스는 독립 Node.js 프로세스로 Docker 컨테이너 안에서 실행된다.

### project-service (현재 가장 완성된 서비스)

등록된 라우트 모듈:

```
/api/v1/projects          ← 프로젝트 CRUD
/api/v1/projects/:id/tasks ← 태스크 관리
/api/v1/groups            ← 그룹
/api/v1/projects/:id/cpm  ← CPM(Critical Path Method) 계산
/api/v1/resources         ← 자원 관리
/api/v1/notifications     ← 알림
WebSocket (Socket.io)     ← 실시간 협업
```

### Clean Architecture 4레이어

```
services/project/src/
├── api/            ← 라우트, 컨트롤러, DTO (입력 검증)
├── application/    ← 서비스, 유스케이스 (비즈니스 로직)
├── domain/         ← 엔티티, 리포지토리 인터페이스
└── infrastructure/ ← Prisma 리포지토리, Redis 캐시, Socket.io 게이트웨이
```

의존성 방향: `API → Application → Domain ← Infrastructure`

---

## 5. Docker 구성 상세

| 컨테이너 | 이미지 | 포트 | 역할 |
|----------|--------|------|------|
| `erp-ot-postgres` | postgres:16-alpine | 5432 | 메인 DB |
| `erp-ot-redis` | redis:7-alpine | 6379 | 캐시 |
| `erp-ot-rabbitmq` | rabbitmq:3.13 | 5672 / 15672 | 메시지 큐 |
| `erp-ot-auth` | 빌드 | 3001 | 인증 서비스 |
| `erp-ot-user` | 빌드 | 3002 | 사용자 서비스 |
| `erp-ot-project` | 빌드 | 3003 | 프로젝트 서비스 |
| `erp-ot-web` | 빌드 | 3000 | 프론트엔드 |

모든 컨테이너는 `erp-network` (bridge)로 연결되어 서비스명으로 서로 통신한다.  
예: `http://auth-service:3001`

**서비스 의존성:**
```
web → project-service → auth-service → postgres, redis
                      → user-service  → postgres, redis, rabbitmq
```

---

## 6. bkit의 역할

`.bkit-memory.json`이 PDCA 사이클 상태를 관리한다.

```json
{
  "pdca": {
    "feature": "프로젝트-관리",
    "currentPhase": "check",
    "matchRate": 87,
    "completedPhases": ["plan", "design", "do"]
  }
}
```

Claude Code와 bkit이 함께 **Plan → Design → Do → Check → Act** 사이클로 개발을 진행하는 구조다.

---

## 7. 현재 구현 상태

| 서비스 | 상태 | 설명 |
|--------|------|------|
| `project-service` | ✅ 구현 완료 | CPM, Gantt, WebSocket 포함 |
| `auth-service` | 🔧 스켈레톤 | 서버 기동만, 라우트 구현 예정 |
| `user-service` | 🔧 스켈레톤 | 서버 기동만, 라우트 구현 예정 |
| `attendance-service` | ⏳ 미구현 | 설계 완료, 구현 예정 |
| `apps/web` | ⏳ 미구현 | Next.js, 구현 예정 |

---

## 8. Node.js와 Next.js 개념 정리

### JavaScript의 한계와 Node.js

원래 JavaScript는 **브라우저 안에서만** 실행되는 언어였다.

```
[브라우저] → JavaScript 실행 가능  (원래부터)
[서버/PC]  → JavaScript 실행 불가  (Python, Java 등만 가능)
```

**Node.js (2009년)**는 JavaScript를 서버/PC에서도 실행할 수 있게 해주는 런타임(실행 환경)이다.

```
[브라우저] → JavaScript 실행 가능  (원래부터)
[서버/PC]  → JavaScript 실행 가능  (Node.js 덕분에)
```

덕분에 백엔드도 JavaScript(TypeScript), 프론트엔드도 JavaScript → 같은 언어로 전체 개발이 가능해졌다.  
이 프로젝트의 Fastify 서비스들이 Node.js 위에서 돌아가는 백엔드다.

### Next.js

**React + 서버 기능을 합친 프레임워크**다.

React만 사용하면:
- 브라우저에서 JS를 다 받아서 화면을 그리므로 첫 로딩이 느림
- 검색엔진이 내용을 못 읽음 (SEO 불리)
- API 키 같은 민감한 정보도 브라우저에 노출될 수 있음

Next.js는 서버에서 HTML을 미리 만들어서 이 문제를 해결한다:

```
[순수 React]
브라우저 → "빈 HTML + JS 파일 주세요" → 서버
브라우저 ← 빈 HTML + 큰 JS 파일      ← 서버
브라우저에서 JS 실행 → 화면 완성 (느림)

[Next.js]
브라우저 → "페이지 주세요"    → Next.js 서버 (Node.js)
브라우저 ← 이미 완성된 HTML  ← Next.js 서버 (빠름)
이후 상호작용은 브라우저에서 처리
```

### Node.js vs Next.js 비교

| | Node.js | Next.js |
|---|---|---|
| 정체 | JavaScript 실행 환경 | React 기반 웹 프레임워크 |
| 비유 | Java의 JVM 같은 것 | Spring Boot 같은 것 |
| 역할 | JS를 서버에서 돌릴 수 있게 함 | 프론트엔드 + 서버 기능 통합 |
| 관계 | Next.js는 Node.js 위에서 실행됨 | Node.js 없이 Next.js 불가 |

**한 줄 요약:**  
Node.js = JS를 서버에서 실행하는 엔진 / Next.js = 그 위에서 돌아가는 풀스택 웹 프레임워크

---

## 9. 개발 명령어 요약

```bash
# 전체 Docker 환경 시작 (로컬 개발)
docker compose -f docker-compose.local.yml up --build

# 백그라운드 실행
docker compose -f docker-compose.local.yml up -d --build

# 로그 확인
docker compose -f docker-compose.local.yml logs -f project-service

# 중지
docker compose -f docker-compose.local.yml down

# 완전 초기화 (DB 포함)
docker compose -f docker-compose.local.yml down -v

# 헬스체크
curl http://localhost:3001/health   # auth
curl http://localhost:3002/health   # user
curl http://localhost:3003/health   # project

# Turborepo 전체 빌드
pnpm build

# 개발 모드 (핫 리로드)
pnpm dev
```
