# NAS검색 날짜·항만 라우팅 + 예시칩 (Report)

**일자**: 2026-06-26 | **대상**: ot-brain knowledge-api, ERP web(board/knowledge)

## 배경
의미검색(bge-m3 벡터)은 "최근 N개·특정날짜" 같은 메타데이터 질의를 못 함(모델 무관, 임베딩 한계). 또 역지오 place가 행정구역명("축산면")이라 항만명("축산항") 검색이 안 맞음.

## 구현
### ① 날짜/최근 라우팅 (server.ts `/api/v1/documents/search`)
- 의도(동사)로 날짜 컬럼 분기: 올린/추가/등록/업로드/받은/최근 → **created_at**, 찍은/촬영 → **taken_at**, 작성/만든/발행 → **doc_date**, 동사없음(맨 날짜) → `COALESCE(doc_date,taken_at,폴더날짜,created_at)`(파일 자체날짜 우선→색인일 폴백).
- 날짜파싱: 절대(2026-06-24·6월24일)/상대(오늘·어제·지난주·이번주·최근N일)/개수(20개). 날짜+내용+확장자 결합.
- KST 함정: `TIMESTAMP '..' AT TIME ZONE 'Asia/Seoul'`(DATE AT TIME ZONE은 UTC캐스팅으로 9h오차). COALESCE는 to_char YYYYMMDD 텍스트비교(to_date 미사용).
- 인덱스 `idx_nasdoc_created_at` 추가(정렬 1.6s→0.2ms). 불용어 강화(상대날짜어·개수·의도어 누수 방지).

### ② 항만명 지오 어간매칭
- 토큰이 '항' 끝 3글자↑면 '항' 뗀 어간으로도 place 매칭(축산항→축산→축산면, 구룡포항→구룡포읍). 2글자(장항)는 어간 안 뗌. SQL `left()`로 파라미터 추가없이 처리.

### ③ 예시 칩 (board/knowledge/page.tsx)
- 검증된 예시 검색어를 클릭형 칩 2줄(내용검색/날짜·최근)로 추가, 클릭 시 즉시 검색.

## 검증
- "가장 최근 추가 20개"/"6월24일 올린 파일"/"어제 올린 사진"/"2024년 6월28일 작성 견적서"/"축산항 사진"(축산면 GPS 상위) 모두 정상. 일반 의미검색 회귀 없음.

## 잔여
- 폴더날짜 best-effort 정규식만. 항만↔행정 정식 별칭사전(현재 어간규칙). taken/doc 날짜질의 함수인덱스. (CC메모리 nas-search-date-place-routing.md 기록)
