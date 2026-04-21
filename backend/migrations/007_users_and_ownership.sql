-- Phase 7 — users, JWT auth foundation, project ownership
-- Keep in sync with db/migrations/007_users_and_ownership.sql (applied at API startup if missing)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION set_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_users_updated_at();

-- Default admin (password: ChangeMeSecure2026! — change after first login)
INSERT INTO users (email, password_hash, full_name)
VALUES (
  'admin@example.com',
  crypt('ChangeMeSecure2026!', gen_salt('bf')),
  'Administrator'
);

ALTER TABLE projects ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

UPDATE projects SET owner_id = (SELECT id FROM users WHERE email = 'admin@example.com' LIMIT 1)
WHERE owner_id IS NULL;

ALTER TABLE projects ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX idx_projects_owner_id ON projects(owner_id);

-- Per-owner project_id uniqueness (same id string allowed for different users)
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_project_id_key;

CREATE UNIQUE INDEX idx_projects_owner_project_id ON projects(owner_id, project_id);
