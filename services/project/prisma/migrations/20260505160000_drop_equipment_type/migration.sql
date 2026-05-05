-- 공용자산 정리 (2026-05-05): EquipmentType enum에서 EQUIPMENT 값 제거.
-- 공용자산은 시설/차량만 관리, 프로젝트 미연계. "장비"는 /equipment의 Equipment 모델로 이동.
--
-- 사전 검증:
--   project.equipment_resources WHERE type='EQUIPMENT' = 0 rows (확인됨, 2026-05-05)
--   따라서 데이터 변환 없음, enum 재정의만.

-- 1. 새 enum 타입 생성
CREATE TYPE project."EquipmentType_new" AS ENUM ('VEHICLE', 'FACILITY');

-- 2. equipment_resources.type을 새 enum으로 캐스팅 (default 일시 제거 후 변경)
ALTER TABLE project.equipment_resources
  ALTER COLUMN type DROP DEFAULT,
  ALTER COLUMN type TYPE project."EquipmentType_new"
    USING type::text::project."EquipmentType_new",
  ALTER COLUMN type SET DEFAULT 'VEHICLE'::project."EquipmentType_new";

-- 3. 기존 enum 삭제, 새 enum 이름으로 변경
DROP TYPE project."EquipmentType";
ALTER TYPE project."EquipmentType_new" RENAME TO "EquipmentType";
