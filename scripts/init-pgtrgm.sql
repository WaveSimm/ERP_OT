-- 검색개선 PDCA — pg_trgm extension + GIN trigram 인덱스
-- 적용:
--   docker cp scripts/init-pgtrgm.sql erp-ot-postgres:/tmp/
--   docker exec erp-ot-postgres psql -U erp_user -d erp_ot -f /tmp/init-pgtrgm.sql
-- 신규 컨테이너용 자동 적용은 init-db.sql 끝에 \i include 추가.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 게시글 제목 (정확 매칭 가중치 큼)
CREATE INDEX IF NOT EXISTS board_posts_title_trgm_idx
  ON public.board_posts USING gin (title gin_trgm_ops);

-- 게시글 본문
CREATE INDEX IF NOT EXISTS board_posts_content_trgm_idx
  ON public.board_posts USING gin (content gin_trgm_ops);

-- 작업비고 본문 (WorkLog는 title 없음)
CREATE INDEX IF NOT EXISTS work_logs_content_trgm_idx
  ON project.work_logs USING gin (content gin_trgm_ops);
