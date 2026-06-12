# Planner → ERP 마이그레이션 플레이북

> **상태**: Living document — 디버깅·개선 사항 누적
> **첫 작성**: 2026-05-01
> **사용 처**: Microsoft Teams Planner / Project for the Web 에서 export한 Excel을 ERP 프로젝트로 import
> **현재 적용 사례**: `[기술팀] 선박-온바다호-2026`, `[기술팀] KHOA 해양관측부이 차세대 데이터로거 물품 제작`

---

## 1. 매핑 정책 (D1~D8 결정)

| # | 항목 | 정책 | 비고 |
|---|------|------|------|
| **D1** | 버킷 (Bucket) | **무시** | WBS(개요번호)가 같은 정보를 더 풍부하게 표현 |
| **D2** | 비고(J) + 메모(R) | **각각 별도 WorkLog row** | content 앞에 `[비고]` / `[작업일지]` 라벨 |
| **D3** | 사용자 매핑 | **이름 reverse + exact match** | "재엽 김" → split → reverse → "김재엽" → ERP `Resource.name` 검색 |
| **D4** | 우선순위/레이블/스프린트 | **무시** | ERP에 도메인 컬럼 없음, "중요"·"백로그" 의미 약함 |
| **D5** | 체크리스트 항목 (T) | **WorkLog 1건으로 통합** | "[체크리스트] ☐ a / ☐ b" 형식, 세미콜론(`;`) 구분 파싱 |
| **D6** | 시간 (작업/완료/남은) | **무시** | % 완료(H)가 같은 정보, 정확 매핑 어려움 |
| **D7** | 종속 대상 (K) | **자동 정규식 파싱 → Dependency** | `^(\d+)(FS|SS|FF|SF)?$` 패턴, 작업번호로 lookup, default FS, lag=0 |
| **D8** | 마일스톤 (Q="예") | **Task `isMilestone=true`로 통합** | 단일 segment(start=end=마침일), 자식 task 불가, segment 1개만 허용. (이전: 별도 Milestone 모델 → 2026-05-01 `마일스톤-시점태스크-회귀` PDCA에서 reverse). **자식 가드**: 자식이 있는 마일스톤은 자동으로 일반 task 변환 + 경고 (§5.12) |
| **D9** | 플랜 소유자 (Excel 메타 B3) | **`auth_user.id`로 매핑하여 `Project.ownerId`** | 매핑 흐름: `planner_name` → `reverse_name()` → `resources.name` lookup → `resources.userId` (이메일) → `auth_users.email` → `auth_users.id`. fallback: auth_users name 직접 매칭 (동명이인 위험). `resolve_owner_id()` 함수가 처리 (§5.13) |

---

## 2. 처리 흐름 (8 Pass — 2026-05-01 갱신)

스크립트 `scripts/import-planner.py`가 다음 순서로 실행:

```
Pass 0. 로그인 (auth-service /api/v1/auth/login) → JWT 토큰
Pass 0. Resource 전체 lookup (사용자 매핑용 캐시)

[파일별 반복]
Pass 1. Project 생성 (POST /projects)
Pass 2. Task 생성 (parentId 없이, 시점 task 포함 — `isMilestone` 플래그 전달)
        ↳ overview→taskId, taskNumber→taskId 맵 구축
Pass 3. parentId 설정 (PATCH) — 개요번호 1.2.3 → parent 1.2 (시점 task도 동일 규칙)
Pass 4. Segment 생성 (시점 task: 단일 segment, start=end=마침일)
Pass 5. Assignment 생성 (담당자 → SegmentAssignment, allocationMode=PERCENT 100, 시점 task 포함)
Pass 6. (폐기) Milestone 별도 생성 — Task isMilestone=true로 통합
Pass 7. WorkLog 생성 (D2 비고+메모 + D5 체크리스트, 시점 task 포함)
Pass 8. Dependency 생성 (D7, taskNumber lookup, Task↔Task만)
Pass 9. Segment progressPercent 실제값으로 update (% 완료 적용)
```

**중요한 순서 원칙**:
- WorkLog는 progressPercent 업데이트 **이전**에 생성 — 100% 도달 시 "완료-작업일지-필수" 규칙 차단 회피
- Dependency는 모든 task 생성 **이후** (작업번호 lookup 가능)
- 시점 task는 일반 task tree 안에 들어감 (parent로 일반 task 가능, 자식은 못 가짐 — 백엔드 거부)

---

## 3. 사용 방법

### 3.1 사전 조건

- [ ] **로컬 백엔드 가동**: `cd services/project && pnpm dev` (port 3003)
- [ ] **Auth 서비스 가동**: docker `auth-service` 정상 (port 3001)
- [ ] **dev 계정 사용 가능**: `dev@oceant.com / dev1234`
- [ ] **사용자 사전 등록**: Planner의 모든 담당자가 ERP `Resource` 테이블에 "성+이름" 형태로 존재 (확인 쿼리 §6.1)
- [ ] **Excel 파일**: `References/planner/` 폴더에 위치 (UTF-8 BOM 없는 .xlsx)

### 3.2 새 파일 추가 (스크립트 수정 불필요)

`import-planner.py`는 이제 `References/planner/*.xlsx` 를 **자동 인식**합니다.
새 플랜은 **`[팀명] 프로젝트명.xlsx` 규칙으로 `References/planner/` 에 넣기만** 하면 됩니다 — `FILES` 리스트 수정 불필요.

```python
# import-planner.py (자동 인식)
FILES = sorted(glob.glob("References/planner/*.xlsx"))
```

> 폴더 규칙은 `References/<스크립트별>/` (contracts·planner·phones·inventory) 입니다. 각 폴더 README 참고.

### 3.3 실행

```bash
cd E:/claude/ERP_OT
python -u scripts/import-planner.py
```

출력:
- 각 Pass 진행 상황 (`✓ Tasks created: 30` 등)
- 매핑 실패 경고 (`⚠ unmapped name: 홍길동`)
- 완료된 project ID 표시

### 3.4 Progress 보완 (필수)

import 직후 work log 없는 task의 100% 진입이 차단되어 누락. 보완:

```bash
# scripts/fix-planner-progress.py 의 TARGETS 에 (project_id, excel_path) 추가
python -u scripts/fix-planner-progress.py
```

이 스크립트:
- work log 0건 task에 system placeholder work log 자동 생성
- segment progressPercent를 Excel 값으로 다시 update

---

## 4. Excel 구조 (참고)

Planner Web "Export plan to Excel" 결과:

```
A1:B7  메타 (이름·소유자·시작·완료·기간·진척률·내보낸 날짜)
A9:W9  헤더 (23 컬럼)
A10:.. task rows
```

**23 컬럼**:
| Col | 헤더 | 매핑 |
|:---:|------|------|
| A | 작업 번호 | (lookup용 키) |
| B | 개요 번호 | parentId 추정 (1.2.3 → 1.2) |
| C | 이름 | Task.name |
| D | 할당 대상 | SegmentAssignment (D3) |
| E | 시작 | TaskSegment.startDate |
| F | 마침 | TaskSegment.endDate |
| G | 기간 | (계산값, 무시) |
| H | % 완료 | overallProgress (×100, 0~1 비율 처리) |
| I | 우선 순위 | 무시 (D4) |
| **J** | **비고** | **WorkLog `[비고] ...`** (D2) |
| **K** | **종속 대상** | **Dependency** (D7) |
| L | 버킷 | 무시 (D1) |
| M | 참조(이후) | (무시) |
| N | 작업 | 무시 (D6) |
| O | 작업 완료 | 무시 (D6) |
| P | 남은 작업 | 무시 (D6) |
| **Q** | **마일스톤** | **Task `isMilestone=true`** (D8, "예"일 때) — 단일 segment(start=end) |
| **R** | **메모** | **WorkLog `[작업일지] ...`** (D2) |
| S | 완료됨 | (무시, status는 H로 추정) |
| **T** | **체크리스트 항목** | **WorkLog `[체크리스트] ...`** (D5) |
| U | 레이블 | 무시 (D4) |
| V | 스프린트 | 무시 (D4) |
| W | Goal | 무시 |

---

## 5. 알려진 이슈 + 대응 (Living)

### 5.1 ⚠ Bash heredoc 한글 → Content-Length 오류
- **증상**: `curl -d '{"name":"한글..."}'`이 `FST_ERR_CTP_INVALID_CONTENT_LENGTH` 반환
- **원인**: bash가 한글 문자열의 byte 수 잘못 계산
- **대응**: Python `requests.post(json=...)` 사용 (현 import 스크립트가 이 방식)

### 5.2 ⚠ 100% 진입 시 작업일지 필수 규칙 차단
- **증상**: progress update 단계에서 `WORK_LOG_REQUIRED_FOR_COMPLETION` 다수 발생
- **원인**: Planner의 비고·메모가 없는 task인데 % 완료=100인 경우. ERP 비즈니스 규칙(2026-04-30 도입)이 차단
- **대응**: `fix-planner-progress.py`가 system work log 1건 자동 추가 후 재시도. **import 후 반드시 실행**.
- **개선 후보**: import 스크립트에 통합 (Pass 7과 9 사이에 placeholder work log 보강)

### 5.3 ⚠ Excel 진척률 vs ERP 진척률 차이
- **증상**: Excel 메타 "% 완료 = 26%"인데 ERP project 진척률은 72.7%
- **원인**: Excel은 **모든 task (parent 포함) 평균**, ERP는 **leaf task만 평균** (`aggregate.service.ts`)
- **대응**: 그대로 둠 — ERP 방식이 의미적으로 더 정확 (parent는 children 합이라 중복 계수 안 함). PM이 익숙해지도록 안내.

### 5.4 ⚠ Docker network 격리로 web 컨테이너 → 로컬 dev 백엔드 미연결
- **증상**: Web UI에서 새 프로젝트 안 보임 (project list empty)
- **원인**: docker `web` 컨테이너가 docker network 내부의 `project-service:3003`을 호출 — 정지된 docker project-service 향함
- **대응**: docker web도 정지하고 로컬 `cd apps/web && pnpm dev`로 가동
- **근본 해결**: `monorepo-dockerfile-정리` PDCA에서 처리

### 5.5 ⚠ 작업 일지 검증 timing
- import 흐름: **WorkLog 먼저 생성 → progress update**
- 만약 순서 바뀌면 progress=100 진입 시 work log 없어 차단됨
- 스크립트가 항상 이 순서 유지 — 변경 시 주의

### 5.6 ✅ 마일스톤 task의 다른 컬럼 처리 (2026-05-01 해결)
- 이전: 마일스톤이 별도 Milestone 모델로 만들어져 비고/메모/체크리스트가 무시됨
- 현재: `마일스톤-시점태스크-회귀` PDCA에서 시점 task로 통합 → 비고/메모/체크리스트 모두 일반 task와 동일 처리

### 5.7 ⚠ Excel 한글 깨짐 (cp949)
- Windows 환경에서 Python stdout encoding이 cp949로 잡혀 한글 emoji ✅ 등 출력 시 UnicodeEncodeError
- **대응**: 스크립트 상단에서 `sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')` 강제

### 5.8 ⚠ Background subprocess output 비어있음
- Bash background `pnpm`/python 실행 시 첫 1분간 output file 0 byte
- **원인**: stdout 버퍼링
- **대응**: `python -u` (unbuffered) 옵션 사용. line_buffering=True 설정.

### 5.9 ⚠ Task sortOrder 누락 → 갠트 task 순서 무작위 (2026-05-01)
- **증상**: 갠트에서 root task가 Excel과 다른 순서. KHOA에서 "납품"이 "PCB 제작"보다 먼저 표시
- **원인**: import 스크립트가 createTask에 sortOrder 전달 안 함 → 모두 `sortOrder=0` → ERP 정렬 비결정적
- **대응**:
  1. import 스크립트 Pass 2에 `sortOrder = 작업번호 (A 컬럼)` 전달 추가 (코드 수정 완료)
  2. 기존 데이터: `scripts/fix-planner-sortorder.py` 실행 (이름 매칭 PATCH)
- **원리**: Excel "작업 번호"는 1부터 자연스럽게 트리 순서(1, 1.1, 1.1.1, 1.2, ..., 2, 2.1, ...) 매김 → sortOrder로 그대로 사용 시 같은 parent 안에서 ASC 정렬 자연스러움
- **검증 쿼리**:
```sql
SELECT "sortOrder", name FROM project.tasks
WHERE "projectId" = '{PID}' AND "parentId" IS NULL
ORDER BY "sortOrder";
```
- **연관 파일**: `scripts/fix-planner-sortorder.py`

### 5.11 ⚠ Gantt 의존선이 FF/SF 타입을 FS로 잘못 그림 (2026-05-01)
- **증상**: KHOA "단종부품 검토" → "회로부품 발주" (Excel: 3FF) 의존성이 갠트에서 일반 FS처럼 그려져 의미 왜곡
- **원인**: `apps/web/src/components/GanttChart.tsx:422` 분기가 SS와 FS 두 가지만 처리, FF/SF는 else 분기로 들어가 FS와 동일하게 그려짐
- **대응**:
  1. switch 문으로 4타입 모두 endpoint 계산 (predLeftX/predRightX/succLeftX/succRightX)
  2. **Planner 스타일 외부 진입 라우팅** 추가 — FF/SF는 우측 외부로 빠져나갔다 우측 끝에서 ← 진입, SS는 좌측 외부 우회
- **타입별 endpoint + 라우팅**:
  - FS: pred 우측 → succ 좌측 (default, simple elbow / 역방향 시 중간 가로지르기)
  - SS: pred 좌측 → succ 좌측 (좌측 외부 우회, 화살표 →)
  - FF: pred 우측 → succ 우측 (우측 외부 우회, 화살표 **←** "동시 완료" 의미)
  - SF: pred 좌측 → succ 우측 (우측 외부 우회, 화살표 **←**)
- **arrowhead marker**: `orient="auto"` 활용 — 마지막 세그먼트 방향에 자동 회전 (별도 marker 추가 불필요)
- **import 영향**: 없음 — DB는 처음부터 정확히 저장됨. 갠트 시각화만 문제였음
- **연관 파일**: `apps/web/src/components/GanttChart.tsx`

### 5.12 ⚠ 시점 task인데 자식이 있는 케이스 (2026-05-01)
- **증상**: import 중 Pass 3 (parentId 설정) 단계에서 백엔드 `MILESTONE_CANNOT_HAVE_CHILDREN` (HTTP 409)로 거부
- **원인**: Planner에서 "5. 준공" 같은 그룹 task에 마일스톤 표시(Q="예")를 했는데 그 아래 "결과보고서 작성" 등 자식 task 존재. 마일스톤-시점태스크-회귀 PDCA의 정의("시점 = 0-duration 단일 이벤트")와 충돌
- **대응**: `import_file()` Pass 2 직전 사전 분석:
  ```python
  all_ovs = {r.개요번호 for r in raw_tasks}
  has_children_set = {ov for ov in all_ovs if any(o.startswith(ov+'.') for o in all_ovs)}
  if is_milestone_raw and overview in has_children_set:
      print(f"⚠ 마일스톤 '{name}'은 자식이 있어 일반 task로 변환")
      is_milestone = False
  ```
- **결과**: 자식이 있는 마일스톤은 일반 task로 자동 다운그레이드. 사용자가 진짜 시점 마일스톤을 원하면 Excel에서 자식을 다른 위치로 이동 후 재 import
- **연관 파일**: `scripts/import-planner.py:153~`

### 5.13 ⚠ 플랜 소유자 매핑이 Resource ID로 잘못 저장됨 (2026-05-01)
- **증상**: import 후 프로젝트 목록에서 소유자 이름 안 보임 (`ownerName=null`)
- **원인**: 초기 코드가 `resolve_resource_id()` 사용 → Resource ID 반환 (`cmmyp0css...`). 그러나 `Project.ownerId`는 Auth User ID 자리 (`cmmyo003e...`). 두 ID 체계가 다름
- **3중 정체성 시스템**:
  - `auth.users` (auth-service): 로그인 계정
  - `project.resources` (project-service): 자원 배정 대상 (사람 + 장비 + 외부)
  - 매핑 키: `resources.userId` (이메일) ↔ `auth_users.email`
- **대응**:
  1. `resolve_owner_id(planner_name, token)` 신규 함수 — auth_user.id 반환
  2. `import_file()` Project 생성 시 `resolve_owner_id` 사용
  3. 기존 잘못 import된 프로젝트는 직접 UPDATE로 백필
- **검증 쿼리**:
```sql
SELECT p.name, p."ownerId",
  CASE WHEN au.id IS NOT NULL THEN '✓ auth_user' WHEN r.id IS NOT NULL THEN '✗ resource (잘못)' ELSE '✗ unknown' END AS status
FROM project.projects p
LEFT JOIN public.auth_users au ON au.id = p."ownerId"
LEFT JOIN project.resources r ON r.id = p."ownerId";
```
- **연관 파일**: `scripts/import-planner.py::resolve_owner_id`

### 5.14 ⚠ requests 라이브러리 매 호출 새 connection — import 200배 느림 (2026-05-01)
- **증상**: 188개 task import 시 segment 생성이 ~2초당 1개로 진행 (개별 응답시간은 23ms)
- **원인**: `requests.post()` 직접 호출은 Session 미사용 → keep-alive 안 됨 → 매번 TCP handshake. Windows에서 30~100ms overhead/req
- **대응**: 모듈 전역에 `SESSION = requests.Session()` + `HTTPAdapter(pool_connections=20)` mount, 모든 helper에서 SESSION.{post,patch,get} 사용
- **결과**: 80~100배 빨라짐 (188 task = 5분 → ~1분)
- **연관 파일**: `scripts/import-planner.py:25~`

### 5.10 ✅ Milestone sortOrder + displayParentId 누락 (2026-05-01 → 2026-05-01 reverse)
- **이전 증상**: KHOA의 ◆ "현장 납품" 마일스톤이 PCB 제작보다 위에 표시됨 (Excel 작업번호 31, 개요 5.3 → "납품" 아래여야 함)
- **이전 대응**: Milestone 생성에 sortOrder + displayParentId 추가
- **현재 상태**: `마일스톤-시점태스크-회귀` PDCA에서 Milestone 모델 자체가 폐기되고 시점 task(isMilestone=true)로 통합되어 일반 task의 sortOrder/parentId 메커니즘을 그대로 사용 → 별도 displayParentId 개념 불필요
- **검증 쿼리** (시점 task용):
```sql
SELECT t."sortOrder", t.name, p.name AS parent_task
FROM project.tasks t
LEFT JOIN project.tasks p ON p.id = t."parentId"
WHERE t."projectId" = '{PID}' AND t."isMilestone" = true;
```
- **연관 파일**: `scripts/fix-planner-sortorder.py` (시점 task의 parent 보정 포함)

---

## 6. 검증 쿼리

### 6.1 사용자 매핑 사전 확인
Planner의 담당자 이름들을 reverse(성+이름)로 변환 후 ERP에 존재 여부 확인:

```sql
SELECT id, name, "userId" FROM project.resources
WHERE name IN (
  '심윤송','김재엽','현지윤','김진수','김창온',
  -- 새 파일에서 추가된 이름들 ...
)
ORDER BY name;
```

### 6.2 import 직후 데이터 카운트

```sql
SELECT
  p.name,
  (SELECT COUNT(*) FROM project.tasks WHERE "projectId" = p.id) AS tasks,
  (SELECT COUNT(*) FROM project.tasks WHERE "projectId" = p.id AND "parentId" IS NOT NULL) AS with_parent,
  (SELECT COUNT(*) FROM project.task_segments WHERE "taskId" IN (SELECT id FROM project.tasks WHERE "projectId" = p.id)) AS segments,
  (SELECT COUNT(*) FROM project.segment_assignments WHERE "segmentId" IN (SELECT id FROM project.task_segments WHERE "taskId" IN (SELECT id FROM project.tasks WHERE "projectId" = p.id))) AS assignments,
  (SELECT COUNT(*) FROM project.work_logs WHERE task_id IN (SELECT id FROM project.tasks WHERE "projectId" = p.id) AND is_deleted = false) AS work_logs,
  (SELECT COUNT(*) FROM project.milestones WHERE "projectId" = p.id) AS milestones,
  (SELECT COUNT(*) FROM project.dependencies WHERE "predecessorTaskId" IN (SELECT id FROM project.tasks WHERE "projectId" = p.id)) AS deps
FROM project.projects p
WHERE p.id = '{PROJECT_ID}';
```

### 6.3 진척률 검증
```sql
SELECT
  p.name,
  COUNT(*) FILTER (WHERE t."overallProgress" >= 100) AS done,
  COUNT(*) FILTER (WHERE t."overallProgress" > 0 AND t."overallProgress" < 100) AS in_prog,
  COUNT(*) FILTER (WHERE t."overallProgress" = 0) AS not_started,
  ROUND(p.overall_progress::numeric, 1) AS project_pct
FROM project.projects p
LEFT JOIN project.tasks t ON t."projectId" = p.id
WHERE p.id = '{PROJECT_ID}'
GROUP BY p.id, p.name, p.overall_progress;
```

### 6.4 의존성 정합성 (KHOA 같은 의존성 있는 프로젝트)
```sql
SELECT d.id, t1.name AS predecessor, t2.name AS successor, d."dependencyType", d.lag
FROM project.dependencies d
LEFT JOIN project.tasks t1 ON t1.id = d."predecessorTaskId"
LEFT JOIN project.tasks t2 ON t2.id = d."successorTaskId"
WHERE t1."projectId" = '{PROJECT_ID}' OR t2."projectId" = '{PROJECT_ID}'
ORDER BY d."createdAt";
```

### 6.5 system 자동 work log 식별
```sql
SELECT t.name, COUNT(*) AS system_logs
FROM project.work_logs wl
JOIN project.tasks t ON t.id = wl.task_id
WHERE wl.author_id = 'dev-admin-001' AND wl.content LIKE '[system]%'
  AND t."projectId" = '{PROJECT_ID}'
GROUP BY t.id, t.name
ORDER BY t.name;
```

→ PM이 실제 일지로 교체할지 결정

---

## 7. 향후 개선 후보 (TODO)

### 우선
- [ ] **placeholder work log를 import 흐름에 통합** — 현재 fix 스크립트로 분리되어 2-step. 1-step으로 통합
- [x] ~~**마일스톤 행의 비고/메모 보존**~~ — 시점 task 통합으로 해결 (2026-05-01)
- [ ] **idempotent import** — 같은 파일 재실행 시 이미 있는 project 감지 (이름·생성일 기준) + skip 또는 재 import 옵션
- [ ] **dry-run 모드** — 실제 생성 없이 매핑 결과만 보여주기

### 차후
- [ ] **체크리스트 → 별도 ChecklistItem 모델** — 현재 WorkLog 1건. 사용자가 체크리스트 기능 만들지 여부 결정 후
- [x] ~~**마일스톤 자동 status 자동 추적 도입**~~ — 시점 task는 일반 task의 status를 따르므로 별도 메커니즘 불필요 (2026-05-01)
- [ ] **여러 파일 한 번에 진단** — 매핑 실패·이상 데이터 사전 보고서
- [ ] **Excel "그룹화"·"필터"·"색상" 보존** — 현재 무시
- [ ] **Microsoft Graph API 연동** — Excel export 대신 직접 fetch (Planner Premium 한정)

---

## 8. 변경 이력

| 날짜 | 변경 | 비고 |
|------|------|------|
| 2026-05-01 | 초안 작성 — 8 매핑 결정, 9 Pass 흐름, 5 알려진 이슈, 검증 쿼리 5종 | `[기술팀] 선박-온바다호-2026`, `[기술팀] KHOA ...` 2 파일 적용 검증 |
| 2026-05-01 | §5.9 추가 — sortOrder 누락 이슈. Pass 2에 sortOrder=작업번호 전달, fix-planner-sortorder.py 추가 | KHOA "납품" 순서 디버깅 결과 |
| 2026-05-01 | §5.10 추가 — Milestone sortOrder/displayParentId 누락. Milestone 생성에 sortOrder + displayParentId 추가, fix 스크립트가 milestone도 보정 | KHOA "현장 납품" 마일스톤 위치 디버깅 결과 |
| 2026-05-01 | §5.11 추가 — GanttChart가 FF/SF 의존선을 FS로 잘못 그림. 4타입 switch 분기로 수정 | KHOA "단종부품 검토 → 회로부품 발주" FF (동시 완료) 디버깅 결과. import 무관, 갠트 코드 버그 |
| 2026-05-01 | §5.11 보강 — Planner 스타일 외부 진입 라우팅 (FF/SF는 우측 외부 우회 후 ← 진입, SS는 좌측 외부 우회) | 시각화 자연스러움 개선 |
| 2026-05-01 | **D8 정책 reverse** — Milestone 모델 폐기, Task isMilestone=true로 통합. Pass 6 폐기, Pass 2/3/4/5/7/8/9 모두 시점 task 포함 처리. §5.6/§5.10 해결됨 표시. fix 스크립트는 시점 task parent 보정만 수행 | `마일스톤-시점태스크-회귀` PDCA — 마일스톤이 부모 task와 기능 중첩되는 문제 해결, "시점 확인" 의미 회복 |
| 2026-05-01 | **D9 신설 + §5.13** — 플랜 소유자 매핑 추가 (Excel B3 → resource.email → auth_user.id → Project.ownerId). 초기에 Resource ID로 잘못 저장된 케이스 발견 후 `resolve_owner_id()` 함수로 교체. ID 체계 분리 명확화 | `[사업1팀] KHOA 2026년 해양관측부이 유지관리` import 디버깅 결과. 이메일 매핑 154/158 (97.5%) 성공률 |
| 2026-05-01 | **§5.12 신설** — 자식이 있는 마일스톤 사전 가드. Pass 2 직전 `has_children_set` 분석 후 자동 일반 task 다운그레이드 + 경고 | "5. 준공" 마일스톤이 결과보고서 등 자식을 가지는 케이스 디버깅 결과 |
| 2026-05-01 | **§5.14 신설** — requests Session(keep-alive) 패턴으로 import 80~100배 가속 (188 task 5분 → ~1분) | KHOA 2026 import 모니터링에서 segment 생성률 ~2초/건 발견 |
| 2026-05-01 | **CLI 인자 지원** — `python scripts/import-planner.py <file>` 형식 지원 (인자 없으면 기본 FILES 사용). 새 파일 추가가 코드 수정 없이 가능 | 운영 편의성 |

---

## 9. 관련 파일

| 파일 | 용도 |
|------|------|
| `scripts/import-planner.py` | 메인 import 스크립트 (9 Pass) |
| `scripts/fix-planner-progress.py` | progress 보완 (system work log + retry) |
| `scripts/fix-planner-sortorder.py` | task sortOrder 보정 (이름 매칭) |
| `services/project/src/application/task.service.ts` | 완료-작업일지-필수 검증 로직 |
| `docs/04-operation/migration-playbook-마일스톤-재설계.md` | 비슷한 패턴의 다른 마이그레이션 (참고) |

## 10. 운영 메모

- **import는 1회성** — 정식 PDCA 거치지 않음 (사용자 승인)
- 단 본 문서는 다른 Planner 파일에도 그대로 적용되도록 작성
- 디버깅 사항 발견 시 §5(알려진 이슈)에 추가
- 주요 매핑 결정 변경 시 §1 갱신 + §8 변경 이력 추가
