# 부하테스트 실행 가이드

> 부하테스트 PDCA로 도입된 k6 기반 부하 측정 스크립트.
> 자세한 설계는 `docs/02-design/features/부하테스트.design.md` 참고.

## 사전 준비 (1회)

```bash
# 1. 부하 사용자 시드 (90명)
docker exec erp-ot-auth node prisma/seed-load-test.ts
docker exec erp-ot-project node prisma/seed-load-test.ts

# 2. k6용 인증 정보 생성
node scripts/load-test/generate-users-json.mjs > scripts/load-test/users.json

# 3. 격리 검증 (UI 확인)
#    HIDE_LOAD_TEST=true 상태에서 /admin/users에 부하 사용자가 안 보여야 함

# 4. 권한 부여
chmod +x scripts/load-test/*.sh scripts/cleanup-load-test.sh
```

## Round 실행

```bash
# Round 1-3: dev 모드 (현재 컨테이너 그대로)
LABEL=round-1-dev-burst   bash scripts/load-test/run-round.sh scenario-a-morning-burst.js
LABEL=round-2-dev-mix     DURATION=720 bash scripts/load-test/run-round.sh scenario-b-mixed.js
LABEL=round-3-dev-search  DURATION=360 bash scripts/load-test/run-round.sh scenario-c-search-burst.js

# Round 4-6: production 빌드 (web 재빌드 필요)
docker compose -f docker-compose.yml -f docker-compose.prod-test.yml up -d --build web
# 또는: cd apps/web && pnpm build && NODE_ENV=production pnpm start &

LABEL=round-4-prod-burst  bash scripts/load-test/run-round.sh scenario-a-morning-burst.js
LABEL=round-5-prod-stress STRESS=true DURATION=720 bash scripts/load-test/run-round.sh scenario-b-mixed.js
LABEL=round-6-prod-search bash scripts/load-test/run-round.sh scenario-c-search-burst.js
```

## 결과 위치

```
docs/04-operation/load-test-results/
└── round-1-dev-burst/
    ├── stats.csv             # docker 리소스 시계열
    ├── pg_active.csv         # DB 활성 커넥션
    ├── k6-results.json       # k6 raw 결과
    ├── k6-summary.json       # k6 요약
    └── k6.log                # k6 로그
```

## Cleanup (테스트 후)

```bash
# 삭제 대상 미리 확인
bash scripts/cleanup-load-test.sh --dry-run

# 실제 삭제 (yes 입력 필요)
bash scripts/cleanup-load-test.sh
```

## 환경변수

| 변수 | 기본값 | 용도 |
|------|--------|------|
| `STRESS` | `false` | true: 90 VU, false: 60 VU |
| `DURATION` | `720` | 메트릭 캡처 시간(초) |
| `LABEL` | `default` | round 식별자 (출력 폴더명) |
| `BASE_URL` | `http://host.docker.internal:3000` | 대상 URL |
| `LOAD_TEST_USER_COUNT` | `90` | 시드 생성 사용자 수 |
| `LOAD_TEST_PASSWORD` | `loadtest123!` | 부하 사용자 공통 비밀번호 |
| `LOAD_TEST_DOMAIN` | `@erp-ot.load` | 격리용 도메인 |
| `HIDE_LOAD_TEST` | `true` | 일반 화면에 부하 사용자 노출 toggle |

## 시나리오 요약

| 시나리오 | VU | 시간 | 행동 |
|---------|:---:|:---:|------|
| A 출근 burst | 60(90) | 90s | 로그인 + 홈 6 API |
| B 평상 mix | 60(90) | 10분 | 게시판/검색 30% + 비고 25% + 결재 20% + 프로젝트 15% + 대시보드 10% |
| C 검색 burst | 30(60) | 5분 | 자연어검색 60% + posts 20% + worklogs 20% |

## 임계값

| 지표 | 60명 | 90명 (스트레스) |
|------|:---:|:---:|
| p95 응답 | < 500ms | < 1500ms |
| p99 응답 | < 2000ms | (보고만) |
| 에러율 | < 0.5% | < 5% |
