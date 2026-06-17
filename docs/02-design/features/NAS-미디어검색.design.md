# NAS 미디어 검색 설계 — 사진 우선 / 영상 후속

> 작성 2026-06-13 · 갱신 2026-06-16(§7 NAS 변경반영 하이브리드 추가) · 대상: ot-brain(NAS 통합검색)
> 상태: 설계 / §7 정합·신선도 스크립트 스캐폴드 완료(reconcile_nas.py·poll_changes.py)
> 목적: 현재 텍스트 중심 검색에서 **동영상·사진·폴더**까지 찾도록 확장. 단계는 **① 사진 → ② 영상**.

---

## 1. 배경 / 문제
- 현재 검색은 **텍스트 내용(nas_chunk) 중심**. 비텍스트 파일(SKIPPED ~762만: 사진·영상 등)은 청킹 안 됨 → **사실상 검색 불가**.
- **폴더는 검색 결과로 반환 안 됨**(nas_folder는 점수 보정 신호로만 사용).
- 사진/영상 이름이 **숫자·코드뿐**인 경우 많아(`IMG_1234`, `ISAW0568.MP4`) 파일명 임베딩도 무력.

## 2. 확정 결정
- ✅ **사진 EXIF**(촬영일·GPS) 채택 — 고가치, GPU 불필요.
- ❌ **영상 STT(음성)** 제외 — 가성비·의미 낮음.
- ✅ **영상 프레임→비전 캡션**은 채택하되 **2차(GPU 도입 후)**.
- 미디어 검색 단위는 **폴더 중심**. **숫자뿐인 이름은 개별 임베딩 안 함**.

## 3. 공통 기반 — 폴더 의미검색
- `nas_folder`(24.5만) 폴더명+상위경로를 **임베딩**(`name_embedding vector(1024)` + HNSW).
- 검색 후보에 `folder_vec` 추가 → **폴더를 결과로 반환**, 그 안의 미디어를 묶어 노출.
- 숫자 이름 미디어는 **소속 폴더의 의미로 검색**됨.

---

## Phase 1 — 사진 (먼저, CPU만)

규모: 이미지 **~259만 장** (jpg 258만·jpeg·heic·tiff·raw 등). png 14만(스크린샷)은 제외.

### 1-1. EXIF 추출 패스 (신규)
- 대상: jpg/jpeg/heic/tiff/raw 등.
- 방식: 파이썬(Pillow/piexif/exifread)으로 **헤더만 읽기**(픽셀 3.7TB 아님, 파일당 수 KB) → **GPU 불필요, NAS I/O 위주**.
- 추출 필드: `DateTimeOriginal`(촬영일), `GPS(위경도)`, `Make/Model`(기기).
- 텍스트 추출기와 같은 **분산 워커**(claim 기반) 패턴 — 서버·개발PC 병렬.

### 1-2. 저장 스키마
```sql
ALTER TABLE knowledge.nas_document
  ADD COLUMN taken_at timestamptz,
  ADD COLUMN gps_lat double precision,
  ADD COLUMN gps_lon double precision,
  ADD COLUMN place   text,
  ADD COLUMN camera  text,
  ADD COLUMN exif_status text;   -- PENDING/DONE/NO_EXIF
```

### 1-3. GPS → 장소 (오프라인 역지오코딩)
- 위경도 → 시/군/구·항만명 등 **한국어 장소**(오프라인 DB, 인터넷 불필요).
- 현장 점검 사진은 GPS 보유 多 → "영덕대진항", "부산항신항" 등으로 검색 가능.

### 1-4. 검색 통합
- **날짜 필터/정렬**: "2024년 4월 사진", 기간 범위.
- **장소 검색**: 역지오코딩 장소 + 폴더 문맥.
- **폴더 묶음 + 패싯**: 매칭 폴더 안 사진을 **날짜·장소 패싯**으로 노출.
- 결과: 숫자 이름이어도 **언제·어디서·어느 폴더**로 검색됨.

### 1-5. 비용/자원/일정
| 항목 | 값 |
|------|-----|
| 자원 | **CPU + NAS I/O** (GPU 불필요) |
| 시간 | NAS 파일 여는 속도에 좌우 — 수 시간~하루 |
| DB | 컬럼 추가(구조화 메타, 벡터 아님) — 가벼움 |
| 착수 | **지금 가능**(텍스트 청킹 종료 후 NAS I/O 여유 시) |

---

## Phase 2 — 영상 (후, GPU 필요)

규모: 동영상 **~2.5만 개**(mp4·avi·mov·wmv·mkv).

### 2-1. 프레임 추출
- **ffmpeg**로 영상당 **균등 10프레임(또는 키프레임)** 추출 → 전체 디코드 아님(빠름).
- 비용: NAS에서 영상 탐색 읽기(영상이 커서 I/O). 총 **~25만 프레임**.

### 2-2. 비전 분석 (택1)
| 방식 | 내용 | 특성 |
|------|------|------|
| **A. VLM 캡션(권장)** | Qwen2-VL 등으로 프레임 **한국어 장면설명** → bge-m3 임베딩 → **기존 검색에 합류** | 한국어·파이프라인 재사용, 느림(~0.5~2s/프레임) |
| B. CLIP 임베딩 | 프레임 CLIP 벡터 → 텍스트→이미지 검색 | 빠름, 다국어 CLIP 필요, 별도 경로 |

### 2-3. 검색 통합
- 캡션 텍스트에 **EXIF/폴더의 날짜·장소를 합성**해 임베딩 → "언제·어디서·무슨 장면"으로 검색.

### 2-4. 의존성/일정
- **GPU 필수**(A6000 적합 / 5060 시범 가능하나 25만 프레임은 느림).
- 착수: **A6000 도입 후**. 단 **추출 파이프라인 골격은 미리** 잡아두면 도입 즉시 가동.

---

## 4. 통합 검색 결과 모델
하나의 검색에 **타입 혼합** 반환: `문서(텍스트)` · `폴더` · `사진(날짜·장소 메타)` · `영상(캡션)`. 결과 카드에 타입·날짜·장소·소속폴더 표시. 타입 필터/패싯 제공.

## 5. 단계 요약
| 단계 | 범위 | 자원 | 시점 |
|------|------|------|------|
| 기반 | 폴더 의미검색 | GPU(임베딩, 소량) | 1차와 함께 |
| **1차** | **사진 EXIF(날짜·GPS→장소)** | **CPU·I/O** | **지금~** |
| **2차** | **영상 10프레임→VLM 캡션** | **GPU(A6000)** | A6000 후 |

## 6. 리스크 / 메모
- NAS I/O: 259만 사진·2.5만 영상 파일 열기 — 분산 워커·야간 분산.
- GPS 미보유 사진은 날짜·폴더로만 검색(부분 커버리지).
- VLM 캡션이 점검 영상에서 일반화될 수 있음 → 날짜·장소·폴더 메타로 보완.
- 신규 파일은 스캔 시 EXIF/프레임 처리 자동 enqueue.

---

## 7. NAS 변경 반영 아키텍처 — 정합(reconcile) + 신선도(poll) 하이브리드
> 추가 2026-06-16. 배경: 메타 임포트(2026-06-02) 후 NAS 대량 이동(KIOST `0. old` 아카이빙)으로
> DB 경로가 죽어 EXIF FAILED 23.3만 발생. "시놀로지가 변경을 통보 → 준실시간 반영" 원안을 검토했으나
> DSM 실측 결과 아래와 같이 **freshness(신선도)와 correctness(정합성)를 분리한 폴링 하이브리드**로 확정.

### 7-1. 왜 push(통보)가 아니라 polling인가 — DSM 실측(2026-06-16)
- DSM API 592개 조사 결과 **앱이 파일 변경을 구독하는 web API는 없음**. `SYNO.Core.Notification.*`/
  `Push.Webhook`/`DSM.PushNotification` 은 전부 **시스템 경보**(디스크·로그인 등)용, 파일 단위 아님.
  `SYNO.FileStation.Notify` 는 복사/이동 작업 토스트용.
- 진짜 push 는 **NAS 측 코드**(`SYNO.Core.EventScheduler` + inotify → 웹훅)만 가능 → 읽기전용 최소권한
  계정 방향과 충돌·운영 취약(이벤트 1건 누락 = 영구 drift). **비채택.**
- **본질적 이유**: 우리가 겪은 문제는 **이동·삭제**. 이동·삭제는 mtime/이벤트 증분이 **가장 못 잡는** 케이스
  (폴더 옮겨도 파일 mtime 불변, 삭제는 흔적 없음). "사라진 경로"는 **현재상태 전체 열거 vs DB 집합 차분**
  으로만 신뢰성 있게 검출 → reconcile 이 구조적으로 필요.

### 7-2. 두 축으로 분리
| 축 | 도구 | 역할 | 주기 | PRUNE(삭제권위) |
|----|------|------|------|------|
| **정합(권위)** | `reconcile_nas.py` | 전체 열거 vs DB 차분 → INSERT/UPDATE/**PRUNE**. 멱등·자가치유 | 야간(전체) / 수시(scoped) | **O** |
| **신선도** | `poll_changes.py` | 최근 N분 mtime 변경분만 **UPSERT-only** → 새 파일 수분 내 검색 노출 | 5~15분 | **X** |

- 신선도 poll 은 **PRUNE 안 함**(추가/변경만 인지, 삭제 권위 아님) → 삭제·이동은 reconcile 이 교정.
- 신규 INSERT 는 `exif_status=NULL`/`text_status=PENDING` 로 들어가 기존 워커가 자동 재추출(§1-1).

### 7-3. 실측 성능 & 전제 (DSM API, CIFS 부하 0)
- **열거 속도 ~234 파일/초** (KIOST `0. old` 252,160 파일 / 1,075초, 단일 스레드). CIFS stat-walk(867/s)
  보다 느리나 **CIFS 마운트를 안 거쳐 6/15 행·서버동결 위험을 원천 제거**(채택 핵심 이유).
  → 전체 NAS walk 은 **야간 배치** 성격, 기관 1곳 scoped 는 수 분.
- `SYNO.FileStation.Search` 는 `mtime_greater` 필터를 **정확히 적용**(since=2010→전체, 미래→0 실측).
- **단 전제**: `oceantech` 공유가 현재 **Universal Search 비색인**(`has_not_index_share=True`) →
  Search 가 색인 즉답이 아니라 **라이브 재귀 스캔(=walk 비용)** 으로 동작. 비색인 스캔은 finished=True 가
  완료 전 먼저 오는 **콜드스타트 레이스**도 있음(poll 스크립트가 연속 안정 확인으로 처리).

### 7-4. 결정 / 로드맵
- **[결정필요·관리자]** DSM 제어판에서 `oceantech` 공유 **Universal Search 색인 ON** →
  그래야 `poll --mode search` 가 **전역·즉답**으로 동작해 진짜 "준실시간 freshness" 달성.
  색인 OFF 동안에는 `poll --mode walk`(scoped 범위)로만 운용(=walk 비용, 좁은 폴더 한정).
- **단계**:
  1. (지금) `reconcile_nas.py` 로 KIOST 등 변경기관 1차 정합 → FAILED 23만 해소.
  2. (지금) `poll_changes.py --mode walk` scoped 폴링으로 신규 사진 freshness PoC.
  3. (관리자 후) 공유 색인 ON → `poll --mode search` 전역 5~15분 주기 cron 승격.
  4. reconcile 전체 walk 은 야간 cron(주 1회~매일) 으로 정합 백본 유지.
- 스크립트: `ot-brain/services/ingestion/loaders/{reconcile_nas.py, poll_changes.py}`
  (DSM API urllib + Postgres, ot-extractor 컨테이너 실행, .env `SYNO_*` 자격증명).
