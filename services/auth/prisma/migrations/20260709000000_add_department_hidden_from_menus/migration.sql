-- 부서 정리: 메뉴에서만 숨김 상태 추가
-- 관리 화면에는 계속 노출되고, 일반 픽커/드롭다운에서는 제외되는 플래그
ALTER TABLE "departments" ADD COLUMN "hidden_from_menus" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "departments_hidden_from_menus_idx" ON "departments"("hidden_from_menus");

-- 초기 정리 대상: 회장단(CHAIRMAN), ERP테스트(ERPTEST) → 메뉴에서 숨김
UPDATE "departments" SET "hidden_from_menus" = true WHERE "code" IN ('CHAIRMAN', 'ERPTEST');
