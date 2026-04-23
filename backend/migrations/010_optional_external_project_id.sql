-- Optional external project_id: multiple "unassigned" rows per owner; real IDs stay unique per owner.
-- Keep in sync with db/migrations/010_optional_external_project_id.sql (applied at API startup via ensureSchema).

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_owner_id_project_id_key;

DROP INDEX IF EXISTS idx_projects_owner_project_id;

UPDATE projects
SET project_id = NULL
WHERE LENGTH(TRIM(COALESCE(project_id, ''))) = 0;

ALTER TABLE projects ALTER COLUMN project_id DROP NOT NULL;

-- Uniqueness only when an external ID is present (NULL and all-blank are excluded).
CREATE UNIQUE INDEX idx_projects_owner_project_id ON projects (owner_id, project_id)
WHERE project_id IS NOT NULL AND LENGTH(TRIM(project_id)) > 0;
