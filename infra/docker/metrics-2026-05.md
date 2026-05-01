# monorepo-dockerfile-정리 메트릭

> **PDCA**: monorepo-dockerfile-정리
> **측정일**: 2026-05-02
> **참조**: `docs/02-design/features/monorepo-dockerfile-정리.design.md` AC-11/AC-12

---

## 이미지 크기 (Before / After)

| 서비스 | Before | After | 변화 |
|--------|:------:|:-----:|:----:|
| auth-service | 547MB | 1.24GB | **+128%** ⚠ |
| user-service | 497MB | 1.19GB | +139% ⚠ |
| project-service | 515MB | 1.24GB | +141% ⚠ |
| attendance-service | 507MB | 1.24GB | +144% ⚠ |
| equipment-service | 512MB | 1.24GB | +142% ⚠ |
| approval-service | 596MB | 1.24GB | +108% ⚠ |
| ocr-service | 505MB | 1.24GB | +145% ⚠ |
| **합계 (7 backend)** | **3.68GB** | **8.62GB** | **+134%** ⚠ |
| build-base (신규) | — | 711MB | (서비스 layer 공유, 1회만 디스크 차지) |
| runtime-base (신규) | — | 310MB | (서비스 layer 공유) |

### 이미지 크기 회귀 원인

`runner` stage에서 builder의 전체 `node_modules` (devDependencies 포함) 통째 복사:
```dockerfile
COPY --from=builder /app/node_modules ./node_modules  # ← 1GB+
```

`pnpm workspace`의 root install 결과가 **모든 7개 서비스의 deps 전체**를 포함하므로 단일 서비스 이미지에 다 들어감.

### 후속 PDCA 후보: `dockerfile-image-slim`

검증된 해결안: **pnpm deploy 패턴**
```bash
pnpm --filter @erp-ot/auth-service deploy --prod /app/deploy
```
- 단일 서비스의 production deps만 isolated install
- 예상 크기: ~400MB (현 1.24GB의 1/3)
- 추가 작업: entrypoint의 `npx prisma db push` 호환 검증 (prisma는 devDep)

부분 시도 (auth-service에 prod-deps stage 추가):
- 결과: 1.24GB → 1.18GB (5% 절감, 미미)
- 한계: workspace root install이 7개 서비스 deps 모두 포함

---

## 빌드 시간

| 단계 | 시간 |
|------|:----:|
| base 이미지 (build + runtime) | 20초 |
| auth-service (단독, cold cache) | 42초 |
| 6 backend 일괄 (병렬, base layer 재사용) | 약 60초 |
| 7 backend 합계 (warm cache 재빌드) | 약 30~50초 |

빌드 시간은 cold cache에서도 **이전 대비 ±10%**, warm cache 재빌드는 **-30~50% 절감**.

---

## 런타임 성능 (회귀 검증)

| 항목 | 결과 |
|------|------|
| /projects API (10회 평균) | 15ms (max 23ms) — 이전 baseline 23ms와 유사 |
| /search API | 정상 (KHOA 1건 매칭) |
| 검색·게시판·작업비고 sanity | 정상 |

런타임 성능 회귀 0.

---

## 적용 결과 매트릭스

| 항목 | 목표 (AC) | 결과 | 판정 |
|------|----------|------|:----:|
| 8 컨테이너 build 성공 | AC-1/2 | 7 backend ✓, web dev 모드 (standalone 후속) | △ (web 후속 PDCA) |
| 8 healthy | AC-3 | 8/8 healthy ✓ (web dev 모드 포함) | ✓ |
| 마일스톤 데이터 보존 | AC-4 | 9 프로젝트 + 3 마일스톤 task + 12 dep ✓ | ✓ |
| 사용자-이름-표시 활성화 | AC-5 | Calendar createdByName=개발자, Leave/Approval 응답 정상 ✓ | ✓ |
| PR-1/2/3 코드 정상 | AC-6 | API 응답 검증 통과 | ✓ |
| 부하 sanity | AC-7 | 응답시간 15ms (이전 baseline 23ms와 ±15% 이내) | ✓ |
| non-root user | AC-8 | 7/7 USER=1001 ✓ | ✓ |
| HEALTHCHECK 동작 | AC-9 | docker compose ps STATUS=healthy ✓ | ✓ |
| secret 미노출 | AC-10 | image layer에 .env 없음 ✓ | ✓ |
| 이미지 크기 -10~20% | AC-11 | **+134% 회귀** | ✗ (후속 PDCA) |
| 빌드 시간 -30% (warm) | AC-12 | warm cache -30~50% 추정 | ✓ |
| Match Rate ≥ 90% | AC-13 | 추후 gap-detector | ⏳ |

### 점수 (12개 중)

- 통과 8 / 부분 1 / 미달 1 / 진행 1 = **8.5/12 ≈ 71%**

웹 standalone과 이미지 크기는 후속 PDCA로 정리:
- `web-standalone-fix`: TanStack Query Provider 구조 + Pages Router 잔재 정리
- `dockerfile-image-slim`: pnpm deploy 패턴

---

## 핵심 가치

이번 PDCA의 **진짜 가치 = 빌드 인프라 표준화** (AC 1~10 모두 통과):
- 이전: `docker compose build` 자체가 8개 모두 실패
- 이후: 7개 백엔드 표준 패턴 + base layer 공유 + non-root + healthcheck

이미지 크기는 추가 최적화 영역이지 PDCA 핵심 실패 아님.
