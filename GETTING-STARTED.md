# 로컬 개발 환경 시작 가이드

## 1. Docker Desktop 설치

1. [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) 다운로드
2. 설치 후 **재부팅**
3. Docker Desktop 실행 → 트레이에 고래 아이콘 확인

## 2. 첫 실행

```bash
# 프로젝트 디렉터리에서
cd E:\claude\ERP_OT

# 로컬 개발용 compose로 전체 빌드 + 실행
docker compose -f docker-compose.local.yml up --build
```

처음 빌드는 10~15분 소요됩니다 (npm 패키지 다운로드).

## 3. 실행 확인

브라우저 또는 curl로 각 서비스 헬스체크:

| 서비스 | URL | 설명 |
|--------|-----|------|
| auth-service | http://localhost:3001/health | 인증 서비스 |
| user-service | http://localhost:3002/health | 사용자 서비스 |
| project-service | http://localhost:3003/health | 프로젝트 서비스 |
| RabbitMQ 관리 UI | http://localhost:15672 | ID: erp_user / PW: erp_password |

```bash
# PowerShell 또는 Git Bash에서
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
```

정상 응답 예시:
```json
{"status":"ok","service":"auth-service","timestamp":"2026-03-17T..."}
```

## 4. 자주 쓰는 명령어

```bash
# 백그라운드 실행
docker compose -f docker-compose.local.yml up -d --build

# 로그 보기
docker compose -f docker-compose.local.yml logs -f

# 특정 서비스 로그
docker compose -f docker-compose.local.yml logs -f project-service

# 중지
docker compose -f docker-compose.local.yml down

# 완전 초기화 (DB 포함)
docker compose -f docker-compose.local.yml down -v
docker compose -f docker-compose.local.yml up --build
```

## 5. DB 직접 접속 (선택)

```bash
# PostgreSQL 접속
docker exec -it erp-ot-postgres psql -U erp_user -d erp_ot

# 스키마 확인
\dn

# project 스키마 테이블 확인
\dt project.*
```

## 현재 구현 상태

| 서비스 | 상태 | 설명 |
|--------|------|------|
| auth-service | 스켈레톤 | 서버 기동만, 라우트 구현 예정 |
| user-service | 스켈레톤 | 서버 기동만, 라우트 구현 예정 |
| project-service | 구현 완료 | Clean Arch, CPM, Gantt API |
| attendance-service | 미구현 | 설계 완료, 구현 예정 |
| apps/web | 미구현 | Next.js, 구현 예정 |
