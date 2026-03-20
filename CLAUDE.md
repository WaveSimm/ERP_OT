# erp-ot-platform — Enterprise Monorepo

## Project Overview

**Level**: Enterprise
**Stack**: TypeScript (Full-stack), Node.js microservices, Next.js frontend
**Infra**: Docker Compose (local/on-premise)
**Architecture**: Turborepo monorepo, Clean Architecture, Domain-Driven Design

## Monorepo Structure

```
erp-ot-platform/
├── apps/           # Frontend applications (Next.js)
│   ├── web/        # Main ERP/OT web app
│   └── admin/      # Admin panel
├── packages/       # Shared packages
│   ├── ui/         # Shared UI components (shadcn/ui based)
│   ├── api-client/ # Generated API client
│   └── config/     # Shared ESLint, TS, Tailwind config
├── services/       # Backend microservices (Node.js/TypeScript)
│   ├── auth/       # Authentication & authorization
│   ├── user/       # User management
│   └── shared/     # Shared utilities, types, interfaces
├── infra/          # Infrastructure code
│   └── docker/     # Docker configs per service
├── docs/           # PDCA documentation
│   ├── 00-requirement/
│   ├── 01-development/
│   ├── 02-scenario/
│   ├── 03-refactoring/
│   └── 04-operation/
└── scripts/        # Utility scripts
```

## Tech Stack

### Frontend (apps/)
- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State**: TanStack Query + Zustand
- **Components**: shadcn/ui + packages/ui

### Backend (services/)
- **Runtime**: Node.js 20 LTS
- **Framework**: Fastify (preferred) or Express
- **Language**: TypeScript
- **ORM**: Prisma
- **Auth**: JWT (Access 1h / Refresh 7d)
- **Validation**: Zod

### Infrastructure
- **Container**: Docker + Docker Compose
- **DB**: PostgreSQL (per-service schema separation)
- **Cache**: Redis
- **Message Queue**: RabbitMQ
- **Reverse Proxy**: Nginx or Traefik

## Clean Architecture (4-Layer per Service)

```
API Layer       → routes/, controllers/, DTOs
Application     → services/, use-cases/
Domain          → entities/, repository interfaces
Infrastructure  → repositories/, db/, external clients
```

Dependency direction: API → Application → Domain ← Infrastructure

## Naming Conventions

- **Files**: kebab-case (`user-service.ts`, `auth-controller.ts`)
- **Classes**: PascalCase (`UserService`, `AuthController`)
- **Variables/Functions**: camelCase (`getUserById`, `createToken`)
- **DB Tables**: snake_case (`user_profiles`, `audit_logs`)
- **Env Variables**: SCREAMING_SNAKE_CASE (`DATABASE_URL`, `JWT_SECRET`)
- **API Routes**: `/api/v1/resource-name` (kebab-case, versioned)

## Development Rules

1. **Document-First**: Write docs/01-development/ design doc BEFORE implementation
2. **PR-Based**: Every feature via feature branch → PR → merge
3. **PDCA**: Plan → Design → Do → Analyze (gap ≥ 90%) → Report
4. **Secrets**: Always use `.env` files, NEVER hardcode secrets
5. **Types**: Shared types live in `packages/config/types/` or `services/shared/`

## Environment

| Environment | Command | Notes |
|-------------|---------|-------|
| Local Dev | `docker-compose up -d` | All services + DBs |
| Service Dev | `pnpm dev` (in service dir) | Hot reload |
| Build | `pnpm build` | Turborepo cache |
| Test | `pnpm test` | Runs all tests |

## Source of Truth Priority

1. **Code** (`services/*/src/`, `apps/*/src/`) — always wins
2. **CLAUDE.md files** (this file + sub-area CLAUDE.md)
3. **docs/** design documents — for intent understanding

## Sub-area CLAUDE.md

- `apps/CLAUDE.md` — Frontend-specific conventions
- `services/CLAUDE.md` — Backend microservice conventions
- `infra/CLAUDE.md` — Docker/infra conventions
