# services/ — Backend Microservices

## Services in this directory

| Service | Port | Description |
|---------|------|-------------|
| `auth/` | 3001 | Authentication, JWT, sessions |
| `user/` | 3002 | User management, profiles |
| `project/` | 3003 | Project management, tasks, Gantt, CPM |
| `attendance/` | 3004 | Attendance, leave, OT management |
| `shared/` | — | Shared types, utilities, interfaces |

## Tech Stack

- **Runtime**: Node.js 20 LTS
- **Framework**: Fastify (preferred) or Express
- **Language**: TypeScript (strict mode)
- **ORM**: Prisma
- **Validation**: Zod
- **Testing**: Vitest + Supertest

## Clean Architecture (4-Layer)

```
services/{name}/
├── src/
│   ├── api/              # Routers, controllers, DTOs (request/response)
│   ├── application/      # Services, use-cases (business logic)
│   ├── domain/           # Entities, repository interfaces (ABC)
│   ├── infrastructure/   # Prisma repos, external clients, Redis
│   ├── shared/           # Service-internal utils
│   └── index.ts          # Entry point
├── prisma/
│   └── schema.prisma
├── Dockerfile
├── package.json
└── tsconfig.json
```

## Dependency Rule

```
api → application → domain ← infrastructure
```

- Domain layer imports NOTHING from outer layers
- Infrastructure implements domain interfaces
- application/ orchestrates domain + infrastructure

## Naming Conventions (Backend)

- **Files**: kebab-case (`user-controller.ts`, `user-repository.ts`)
- **Classes**: PascalCase (`UserController`, `UserRepository`)
- **Interfaces**: PascalCase prefixed with `I` (`IUserRepository`)
- **DB tables**: snake_case (`user_profiles`, `refresh_tokens`)
- **API routes**: `/api/v1/resource-name` (kebab-case, versioned)

## Service Communication

```typescript
// Internal synchronous (HTTP)
const user = await fetch(`${process.env.USER_SERVICE_URL}/internal/users/${userId}`, {
  headers: { "X-Internal-Token": process.env.INTERNAL_API_TOKEN }
});

// Asynchronous (RabbitMQ)
await messageQueue.publish("user.created", { userId, email });
```

## Rules

1. Each service owns its DB schema (Prisma schema separation)
2. No direct DB access across service boundaries — use internal APIs
3. All environment variables validated at startup with Zod
4. Health check endpoint at `GET /health` required
5. Structured JSON logging (Pino)
6. All errors mapped to proper HTTP status codes + error DTOs
