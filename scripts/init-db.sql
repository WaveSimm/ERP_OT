-- ─────────────────────────────────────────────────────────────────────────────
-- erp-ot-platform Database Initialization
-- Source of Truth for DB schema (1st Priority)
-- ─────────────────────────────────────────────────────────────────────────────

-- Create schemas per service (schema separation)
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS users;
CREATE SCHEMA IF NOT EXISTS project;
CREATE SCHEMA IF NOT EXISTS attendance;

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Grant schema permissions
GRANT ALL ON SCHEMA auth TO erp_user;
GRANT ALL ON SCHEMA users TO erp_user;
GRANT ALL ON SCHEMA project TO erp_user;
GRANT ALL ON SCHEMA attendance TO erp_user;

-- ─────────────────────────────────────────────────────────────────────────────
-- Attendance default policy (attendance-service baseline)
-- ─────────────────────────────────────────────────────────────────────────────
-- Note: Attendance tables are created by Prisma migrations.
-- This section seeds default data after migrations run.
-- Default policy INSERT is handled in attendance-service startup seed.
