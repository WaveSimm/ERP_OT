-- 공용자산예약 (2026-05-05): EquipmentReservation 신규
-- 단발/반복 통합 모델. 충돌 검사는 transaction에서.

-- 1. enum
CREATE TYPE project."ReservationStatus" AS ENUM ('CONFIRMED', 'CANCELED');

-- 2. 테이블
CREATE TABLE project.equipment_reservations (
    "id"                  TEXT NOT NULL PRIMARY KEY,
    "resourceId"          TEXT NOT NULL,
    "userId"              TEXT NOT NULL,
    "title"               TEXT NOT NULL,
    "description"         TEXT,
    "startAt"             TIMESTAMP(3) NOT NULL,
    "endAt"               TIMESTAMP(3) NOT NULL,
    "isAllDay"            BOOLEAN NOT NULL DEFAULT false,
    "recurrence"          JSONB,
    "recurrenceParentId"  TEXT,
    "status"              project."ReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "cancelReason"        TEXT,
    "canceledAt"          TIMESTAMP(3),
    "canceledBy"          TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_reservations_resourceId_fkey"
      FOREIGN KEY ("resourceId")
      REFERENCES project.equipment_resources("id")
      ON UPDATE CASCADE ON DELETE RESTRICT
);

-- 3. 인덱스
CREATE INDEX "equipment_reservations_resourceId_startAt_idx"
  ON project.equipment_reservations("resourceId", "startAt");

CREATE INDEX "equipment_reservations_userId_startAt_idx"
  ON project.equipment_reservations("userId", "startAt" DESC);

CREATE INDEX "equipment_reservations_status_idx"
  ON project.equipment_reservations("status");

CREATE INDEX "equipment_reservations_recurrenceParentId_idx"
  ON project.equipment_reservations("recurrenceParentId");
