-- 보안 일괄패치 PDCA Layer 3 (C5 + NEW-7 + reuse detection)
--
-- 변경:
--   1. token (평문) → token_hash (SHA-256 hex 64자)
--   2. device_id, user_agent, ip_address (NEW-7 다기기)
--   3. last_used_at (refresh 시점 audit)
--   4. rotated_at, rotated_to_id (reuse detection)
--
-- 영향:
--   - 모든 활성 refresh 무효화 (전사 배포 전이라 사용자 영향 없음, 본인만 1회 재로그인 필요)
--   - 기존 평문 token은 해시화하지 않고 모두 삭제 (노출 기간 길어 보안 가치 없음)
--
-- Rollback (수동):
--   ALTER TABLE public.auth_refresh_tokens
--     DROP COLUMN token_hash, DROP COLUMN device_id, DROP COLUMN user_agent,
--     DROP COLUMN ip_address, DROP COLUMN last_used_at,
--     DROP COLUMN rotated_at, DROP COLUMN rotated_to_id,
--     ADD COLUMN token TEXT NOT NULL;
--   추가: pg_dump 시작점 백업 복원 (docs/04-operation/backups/2026-05-02-pre-security-pdca.sql.gz)

BEGIN;

-- 1. 신규 컬럼 추가 (NULL 허용 → 데이터 wipe 후 NOT NULL 전환)
ALTER TABLE public.auth_refresh_tokens
  ADD COLUMN token_hash    VARCHAR(64),
  ADD COLUMN device_id     VARCHAR(64),
  ADD COLUMN user_agent    TEXT,
  ADD COLUMN ip_address    VARCHAR(45),
  ADD COLUMN last_used_at  TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  ADD COLUMN rotated_at    TIMESTAMP(3),
  ADD COLUMN rotated_to_id VARCHAR(30);

-- 2. 기존 평문 토큰 모두 삭제 (해시화 안 함)
--    이유: 평문이 DB에 있던 기간(2026-04-x ~ 2026-05-02)이 길어 해시 처리해도
--          유출 위험 낮추는 효과 없음. 어차피 사용자 모두 재로그인 필요.
DELETE FROM public.auth_refresh_tokens;

-- 3. token (평문) 컬럼 제거 + token_hash NOT NULL 전환
ALTER TABLE public.auth_refresh_tokens
  DROP COLUMN token;

ALTER TABLE public.auth_refresh_tokens
  ALTER COLUMN token_hash SET NOT NULL;

-- 4. 인덱스
CREATE UNIQUE INDEX auth_refresh_tokens_token_hash_key ON public.auth_refresh_tokens(token_hash);
CREATE INDEX auth_refresh_tokens_user_id_device_id_idx ON public.auth_refresh_tokens(user_id, device_id);

COMMIT;

-- 검증:
--   SELECT count(*) FROM public.auth_refresh_tokens; -- 0
--   \d public.auth_refresh_tokens -- token_hash NOT NULL UNIQUE 확인
