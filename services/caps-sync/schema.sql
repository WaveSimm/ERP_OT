-- CAPS 동기화용 스키마 추가 (additive, 되돌리기 쉬움)
-- 1) 출퇴근 출처 추적 (출근/퇴근 독립). 기본 'CAPS' = 캡스가 갱신 가능. 사람이 수정하면 'MANUAL'로 고정.
ALTER TABLE attendance.attendance_records ADD COLUMN IF NOT EXISTS "checkInSource"  text NOT NULL DEFAULT 'CAPS';
ALTER TABLE attendance.attendance_records ADD COLUMN IF NOT EXISTS "checkOutSource" text NOT NULL DEFAULT 'CAPS';

-- 2) 캡스 e_id ↔ ERP 사용자 매핑 (다대일: 한 사람이 e_id 여러개 가능)
CREATE TABLE IF NOT EXISTS attendance.caps_user_map (
  "eId"       integer PRIMARY KEY,
  "userId"    text    NOT NULL,
  "capsName"  text,
  "active"    boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS caps_user_map_user_idx ON attendance.caps_user_map("userId");

-- 3) 동기화 워터마크(증분): 마지막으로 처리한 e_uptime 저장
CREATE TABLE IF NOT EXISTS attendance.caps_sync_state (
  id          integer PRIMARY KEY,
  "lastUptime" varchar(14) NOT NULL DEFAULT '00000000000000',
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
INSERT INTO attendance.caps_sync_state (id, "lastUptime") VALUES (1, '00000000000000')
  ON CONFLICT (id) DO NOTHING;
