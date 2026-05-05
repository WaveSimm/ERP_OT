-- CreateEnum
CREATE TYPE "project"."EquipmentType" AS ENUM ('EQUIPMENT', 'VEHICLE', 'FACILITY');

-- CreateEnum
CREATE TYPE "project"."ExternalStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "project"."ResourceGroupType" AS ENUM ('PERSON', 'EXTERNAL', 'EQUIPMENT');

-- AlterTable
ALTER TABLE "project"."resource_group_members" ADD COLUMN     "equipmentResourceId" TEXT,
ADD COLUMN     "externalPersonId" TEXT,
ADD COLUMN     "personUserId" TEXT;

-- AlterTable
ALTER TABLE "project"."resource_groups" ADD COLUMN     "type" "project"."ResourceGroupType" NOT NULL DEFAULT 'PERSON';

-- AlterTable
ALTER TABLE "project"."segment_assignments" ADD COLUMN     "equipmentResourceId" TEXT,
ADD COLUMN     "externalPersonId" TEXT,
ADD COLUMN     "personUserId" TEXT,
ALTER COLUMN "resourceId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "project"."equipment_resources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "project"."EquipmentType" NOT NULL DEFAULT 'EQUIPMENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project"."external_persons" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "status" "project"."ExternalStatus" NOT NULL DEFAULT 'ACTIVE',
    "contractStart" DATE,
    "contractEnd" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_persons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equipment_resources_type_idx" ON "project"."equipment_resources"("type");

-- CreateIndex
CREATE INDEX "equipment_resources_isActive_idx" ON "project"."equipment_resources"("isActive");

-- CreateIndex
CREATE INDEX "external_persons_status_idx" ON "project"."external_persons"("status");

-- CreateIndex
CREATE INDEX "external_persons_company_idx" ON "project"."external_persons"("company");

-- CreateIndex
CREATE UNIQUE INDEX "resource_group_members_group_person_unique" ON "project"."resource_group_members"("groupId", "personUserId");

-- CreateIndex
CREATE UNIQUE INDEX "resource_group_members_group_external_unique" ON "project"."resource_group_members"("groupId", "externalPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "resource_group_members_group_equipment_unique" ON "project"."resource_group_members"("groupId", "equipmentResourceId");

-- CreateIndex
CREATE INDEX "resource_groups_type_idx" ON "project"."resource_groups"("type");

-- CreateIndex
CREATE UNIQUE INDEX "segment_assignments_segment_person_unique" ON "project"."segment_assignments"("segmentId", "personUserId");

-- CreateIndex
CREATE UNIQUE INDEX "segment_assignments_segment_external_unique" ON "project"."segment_assignments"("segmentId", "externalPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "segment_assignments_segment_equipment_unique" ON "project"."segment_assignments"("segmentId", "equipmentResourceId");

-- AddForeignKey
ALTER TABLE "project"."segment_assignments" ADD CONSTRAINT "segment_assignments_externalPersonId_fkey" FOREIGN KEY ("externalPersonId") REFERENCES "project"."external_persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project"."segment_assignments" ADD CONSTRAINT "segment_assignments_equipmentResourceId_fkey" FOREIGN KEY ("equipmentResourceId") REFERENCES "project"."equipment_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project"."resource_group_members" ADD CONSTRAINT "resource_group_members_externalPersonId_fkey" FOREIGN KEY ("externalPersonId") REFERENCES "project"."external_persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project"."resource_group_members" ADD CONSTRAINT "resource_group_members_equipmentResourceId_fkey" FOREIGN KEY ("equipmentResourceId") REFERENCES "project"."equipment_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "project"."segment_assignments_segmentId_resourceId_key" RENAME TO "segment_assignments_segment_resource_unique";

