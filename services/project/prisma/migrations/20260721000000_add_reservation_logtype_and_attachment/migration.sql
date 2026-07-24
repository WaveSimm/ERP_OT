-- 예약 유형(대여/차량정비) + 주행거리 (2026-07-21)
ALTER TABLE "project"."equipment_reservations" ADD COLUMN "logType" TEXT NOT NULL DEFAULT 'RENTAL';
ALTER TABLE "project"."equipment_reservations" ADD COLUMN "mileage" INTEGER;

-- 예약 첨부 (차량정비 영수증·사진 등) — 태스크 첨부 방식을 복제한 독립 테이블
CREATE TABLE "project"."reservation_attachments" (
    "id"                   TEXT NOT NULL,
    "reservationId"        TEXT NOT NULL,
    "fileName"             TEXT NOT NULL,
    "fileSize"             INTEGER NOT NULL,
    "mimeType"             TEXT NOT NULL,
    "category"             TEXT NOT NULL DEFAULT 'FILE',
    "storagePath"          TEXT NOT NULL,
    "resourceNameSnapshot" TEXT,
    "uploadedBy"           TEXT NOT NULL,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservation_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reservation_attachments_reservationId_idx" ON "project"."reservation_attachments"("reservationId");

ALTER TABLE "project"."reservation_attachments"
  ADD CONSTRAINT "reservation_attachments_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "project"."equipment_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
