-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'RETIRED', 'SUSPENDED');

-- AlterTable
ALTER TABLE "auth_users" ADD COLUMN     "retirement_date" DATE,
ADD COLUMN     "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "auth_users_status_idx" ON "auth_users"("status");

