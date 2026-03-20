# infra/ — Infrastructure

## Overview

This project uses **Docker Compose** for local and on-premise deployment.

## Structure

```
infra/
└── docker/               # Per-service Dockerfile templates and build context
```

## Key Files (root level)

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Full stack local orchestration |
| `.env.example` | Environment variable template |
| `scripts/init-db.sql` | PostgreSQL schema initialization |

## Services in docker-compose.yml

| Service | Port | Notes |
|---------|------|-------|
| postgres | 5432 | PostgreSQL 16 |
| redis | 6379 | Redis 7 |
| rabbitmq | 5672 / 15672 | RabbitMQ + Management UI |
| auth-service | 3001 | Auth microservice |
| user-service | 3002 | User microservice |
| web | 3000 | Next.js frontend |

## Common Commands

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f [service-name]

# Rebuild a specific service
docker-compose build auth-service
docker-compose up -d auth-service

# Stop all
docker-compose down

# Destroy volumes (wipe DB data)
docker-compose down -v
```

## Rules

1. NEVER hardcode secrets — always use `.env` (copy from `.env.example`)
2. All services connect via Docker network `erp-network`
3. DB data persisted in named volumes
4. Each service has its own `Dockerfile` (multi-stage build recommended)
5. Health checks defined in `docker-compose.yml` for DB-dependent services
