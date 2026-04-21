-- Phase 6 — project lifecycle: ACTIVE vs CLOSED
-- Apply to existing databases only (fresh installs use db/init.sql with status already).

CREATE TYPE project_status_enum AS ENUM ('ACTIVE', 'CLOSED');

ALTER TABLE projects ADD COLUMN status project_status_enum;

UPDATE projects SET status = 'ACTIVE' WHERE status IS NULL;

ALTER TABLE projects ALTER COLUMN status SET NOT NULL;
ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
