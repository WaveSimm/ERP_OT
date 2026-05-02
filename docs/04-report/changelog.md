# Changelog

모든 주요 변경사항이 기록되는 마스터 로그입니다. 각 PDCA 사이클 완료 후 업데이트됩니다.

---

## [2026-05-02] - 보안-일괄패치 PDCA 완료

### Security (Critical 0건 달성)

**OWASP Top 10 Critical 패치**:
- **A01 (Broken Access Control)**: C7 미들웨어 표준화 + NEW-1 folder 인가 + NEW-8 approval 자동ADMIN 제거 + NEW-3 board targetDepartmentId + NEW-2 comment IDOR
- **A02 (Cryptographic Failures)**: C5 Refresh token sha256 hash 저장 + NEW-4 JWT algorithms 명시 + INF-1/2/3 시크릿 회전 + C2 Zod env 검증
- **A07 (ID & Auth Failures)**: C2 JWT secret fallback 제거 + H1 rate-limit (login 5/min/IP, refresh 10/min/IP) + C5 hash + C8 cookie path + NEW-7 다기기+reuse detection

### Added

- **services/shared/** — 통합 미들웨어 + 에러 표준 + JWT 옵션 + rate-limit 정책
  - `middleware/{require-auth, require-internal, require-role}.ts` (C7)
  - `errors/{error-codes, error-format}.ts` (FR-32)
  - `jwt/verify-options.ts` (algorithms: ["HS256"], NEW-4)
  - `rate-limit/policies.ts` (H1)
- **Auth service**:
  - Zod env validation (JWT_ACCESS/REFRESH ≥32, INTERNAL ≥16, C2)
  - RefreshToken sha256 hash 저장 (C5)
  - Login 트랜잭션 원자화 (H5)
  - Refresh reuse detection (NEW-7)
  - Access TTL 1h (NEW-4)
  - Refresh cookie path `/` (C8)
  - Error response 통일 `{error: {code, message}}` (FR-32)
- **Web app**:
  - localStorage → httpOnly cookie (C1)
  - CSRF 더블 서브밋 토큰 (FR-09) — `apps/web/src/middleware.ts`, `/api/csrf/route.ts`
  - 프록시 헤더 forward (C6) — cookie, x-forwarded-for, x-real-ip, user-agent
  - 보안 헤더 5종 (FR-31) — HSTS, nosniff, DENY, CSP-RO, Referrer
- **Database**:
  - Refresh token hash migration (token → token_hash sha256, 기존 113건 세션 무효화)
- **Infrastructure**:
  - docker-compose `${VAR:?required}` 일괄 치환 (FR-02)
  - @fastify/helmet + @fastify/rate-limit 7개 서비스 (H1, FR-26)

### Changed

- **project/equipment/attendance/approval/user** — shared middleware 마이그레이션 (C7)
- **folder.routes.ts** — preHandler 추가, unknown fallback 제거 (NEW-1)
- **comment.routes.ts** — PATCH/DELETE preCheck owner 검증 추가 (NEW-2)
- **board-permissions.ts** — canRead에 post.targetDepartmentId 반영 (NEW-3)
- **user.routes.ts** — /users/members 응답 필드 축소 (NEW-9), errorResponse 통일
- **docker-compose.yml** — 시크릿 fallback 제거 (${VAR:?})

### Fixed

- **approval middleware** — X-Internal-Token 일치 시 자동 ADMIN 승격 제거 (NEW-8)
- **CORS origin** — Zod 배열 검증 + `*` 차단 (NEW-14)
- **console.log** — 5곳 TODO:inject-logger 마킹 (FR-29, 70%)
- **attendance/project inline hooks** — requireInternal 글로벌로 통합 (FR-06)

### Docs

- **Plan**: `docs/01-plan/features/보안-일괄패치.plan.md` (32 FR, 6 Layer, 사용자 결정 6개)
- **Design v1.1**: `docs/02-design/features/보안-일괄패치.design.md` (Layer 의존성, DB migration, test plan)
- **Analysis**: `docs/03-analysis/보안-일괄패치.analysis.md` (Match 91%, OWASP Critical 0건)
- **Report**: `docs/04-report/features/보안-일괄패치-v1.md` (완료 보고서)
- **OWASP 매핑**: `docs/04-operation/2026-05-02-OWASP-매핑.md` (14개 신규 발견 + kill-chain)

### Stats

- **Match Rate**: 91% (90%+ 달성)
- **OWASP Critical**: 0건 ✓
- 신규 파일: 8개 | 변경 파일: 42개 | Git 커밋: 11개
- 소요시간: 약 33h (초기 계획 42h 대비 6% 단축)

### Deferred (별도 PDCA)

- **G1 FR-30** — Internal JWT Big Bang (4-6h, High) — `/internal/service-token` 미구현
- **G4 FR-14** — 활성 세션 UI (2-3h, Medium) — 백엔드 OK, UI 미구현
- **G7 FR-15** — RabbitMQ security.alert (Low) — Pino warn만, publish 미발행
- **G8 FR-17** — Resource ID 통합 (Out-of-scope) — email→userId schema 변경

### Notes

- k6 baseline 재실행 미수행 (Design §8.5) — **이관 전 1회 추가 권장**
- 마이그레이션 SQL 실행으로 기존 refresh token 전부 무효화 → 1회 강제 재로그인 필요
- 다기기 동시 로그인 가능 (이전: 자동 로그아웃) — UX 개선

---

## [2026-03-19] - 프로젝트 관리 v1.0 완료

### Added
- **프로젝트 기본 관리**: CRUD, 마일스톤, WBS 계층형 구조
- **다중 세그먼트 모델**: Task(컨테이너) + TaskSegment(실행 단위) 분리
  - 세그먼트별 독립 일정(startDate, endDate) 지원
  - 진행률 자동 가중 평균 계산
- **자원 할당 (이중 모드)**: % 또는 h/day 유연한 단위 선택
  - 세그먼트별 독립 할당 (같은 자원도 세그먼트마다 다른 비율)
  - 크로스-프로젝트 배정률 실시간 집계
  - 자원 과부하 자동 경고 (>100%)
- **자원 운영 현황**: 대시보드 + 부하 히트맵
  - 자원별 가용율/활용률 표시
  - 세그먼트 기간 기반 정확한 계산
- **CPM 알고리즘**: 일정 분석 자동화
  - Kahn + Forward/Backward Pass 구현
  - 크리티컬 패스 자동 식별
  - 순환 의존성 감지
- **의존성 관리**: FS/SS/FF/SF + Lag 지원
  - 일정 변경 시 후속 태스크 영향 자동 전파
  - 프로젝트 완료 예상일 실시간 재계산
- **What-if 시뮬레이션**: 저장 없이 영향 미리보기
- **Baseline 버전 관리**: 다중 저장 (최대 5개/프로젝트)
  - 세그먼트 단위 스냅샷 (TaskBaselineSegment)
  - 현재 vs 기준선 편차 자동 계산
  - 간트 차트 Baseline 오버레이 (기준선 바 + 현재 바)
- **변경 이력 추적**: TaskScheduleHistory
  - 필드별 변경 내역 (oldValue → newValue)
  - 변경 사유 필수 기록
  - 타임라인 뷰 지원
- **템플릿 시스템**: 빠른 계획 수립
  - dayOffset 방식 (절대 날짜 → 상대 오프셋 변환)
  - 프로젝트 템플릿 저장 + 라이브러리 관리
  - 템플릿 인스턴시화 (미리보기 포함)
  - 부분 가져오기 (선택 마일스톤/태스크)
- **복사 기능**: 구조/자원/의존성 유연한 옵션
  - 태스크 복사 (같은/다른 프로젝트)
  - 마일스톤 복사 (그룹 내 의존성 보존)
  - 프로젝트 전체 복제 (시작일 재지정)
  - 완료 프로젝트 → 템플릿 생성 (역방향)
- **프로젝트 그룹 (v1.5)**: 2단계 계층
  - L1 (부서/고객사/프로그램) + L2 (세부 그룹)
  - 2단계 제한 강화 (DB 제약)
  - 롤업 집계 (예산/진행률/이슈)
  - 그룹 내 표시 순서 관리 (displayOrder)
- **협업 기능**: 팀 커뮤니케이션 통합
  - 태스크 댓글 + @멘션 + 인앱 알림
  - 파일 첨부 (Attachment, 최대 50MB)
  - 활동 피드 (ActivityLog, 실시간 변경 이력)
  - WebSocket 동기화 (Socket.io)
- **간트 차트**: 커스텀 SVG 구현
  - 다중 세그먼트 바 (세그먼트 간 Gap 점선)
  - Baseline 오버레이
  - 의존성 화살표
  - 크리티컬 패스 강조
  - 편차 컬러 코딩 (정상/지연/단축/크리티컬)
- **내 작업 페이지**: 개인 대시보드
  - 담당 태스크/세그먼트 조회
  - 진행률 업데이트
  - 알림 목록

### Changed
- **설계 문서 v2.0 갱신**:
  - Gap Analysis 반영 (D-01 ~ D-06)
  - ResourceGroup, DashboardConfig 모델 추가
  - 세그먼트 배정 API 경로 명확화
  - 간트 차트 결정: frappe-gantt → 커스텀 SVG
- **아키텍처 문서화**:
  - Clean Architecture 4-layer 명시
  - 서비스 간 의존성 다이어그램

### Fixed
- **세그먼트 순서 변경 API 구현**: `PATCH /:taskId/segments/reorder`
  - Prisma 트랜잭션 활용 일괄 업데이트
- **환경 변수 관리 개선** (2건 Warning → 처리 로드맵)
  - JWT_SECRET 하드코딩 감지
  - DB 연결 정보 환경변수 이관 예정
- **DB 제약 강화**:
  - 순환 의존성 감지 로직
  - L2 그룹 부모 검증
  - Baseline 최대 5개 제한

### Quality Metrics
- **설계 일치율**: 87% → **93%** (목표 90% 달성)
  - 데이터 모델: 95% → **98%**
  - API 엔드포인트: 87% → **95%**
  - 기능 로직: 88% → **92%**
  - 아키텍처 준수: 85% → **93%**
  - UI 구현: 82% → **90%**
- **코드 품질**: 88/100 (목표 70)
- **테스트 커버리지**: 82% (목표 75%)
- **성능**:
  - 프로젝트 목록: 150ms (목표 <300ms)
  - 간트 렌더링: 850ms (목표 <1s)
  - CPM 계산: 120ms (목표 <200ms)

### Deliverables
- **Backend**: services/project/ (20 Prisma 모델 + 62 API 엔드포인트)
- **Frontend**: apps/web/ (프로젝트/자원/내작업 페이지 + 커스텀 간트 차트)
- **Infrastructure**: docker-compose.yml + scripts/init-db.sql 업데이트
- **Documentation**: Plan v1.5 + Design v2.0 + Analysis (93%) + Report

### PDCA Cycle
- **Plan**: 2026-02-26 (v1.5, 48개 사용자 스토리)
- **Design**: 2026-02-27 (v2.0, 아키텍처 + API 스펙)
- **Do**: 2026-03-05 (구현 완료)
- **Check**: 2026-03-19 (초기 87% → 최종 93%)
- **Act**: 2026-03-19 (1회 반복으로 목표 달성)
- **소요 기간**: 22일 (4인 투입, 347% 명일)

### Known Issues
- **G-02**: 지연 리스크 자동 감지 Cron (Phase 9 예정)
- **B-01**: 비동기 프로젝트 복사 (Job Queue 미적용)
- **B-02**: 날짜 일괄 이동 UI (백로그)
- **B-03**: 템플릿 라이브러리 전용 페이지 (API 구현됨, UI 부분)
- **B-04**: 일정 히스토리 타임라인 뷰 (모델 완성, UI 부분)

### Breaking Changes
- 없음 (신규 기능)

### Migration Guide
- 초기 마이그레이션 불필요 (신규 프로젝트 구축)
- `docker-compose up -d` 재실행 필수 (project-service 추가)

### Contributors
- AI Assistant (설계 + 구현)
- Development Team (리뷰 + 피드백)

---

## Version Summary

| Version | Release Date | Focus | Status |
|---------|--------------|-------|--------|
| v1.0.0 | 2026-03-19 | 기본 기능 + 템플릿 + 그룹 계층 | ✅ Complete |
| v1.1.0 | 2026-04-03 (예정) | 비동기 처리 + 알림 Cron | 🔄 Planned |
| v2.0.0 | 2026-06-xx (예정) | 드래그 편집 + 이메일 알림 + Baseline 비교 | ⏳ Future |

---

## Next Milestones

1. **Phase 9: 지휘센터 대시보드** (2026-03-20 예정)
   - ±1주 요약, RAG 이슈, 부서/고객사 그룹핑, 발표 모드

2. **Phase 10: 프로젝트-관리 v1.1** (2026-04-03 예정)
   - 비동기 프로젝트 복사 (Job Queue)
   - 지연 리스크 자동 감지 Cron
   - 날짜 일괄 이동, 템플릿 UI 강화

3. **Phase 11: 개인 대시보드** (2026-04-10 예정)
   - Attendance FSM, 연차 계산, Kanban 보드

---

*Last Updated: 2026-03-19*
*Maintained by: AI Assistant*
