-- PM Helper — PostgreSQL schema (Phases 1–7)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE action_flag_enum AS ENUM (
  'PASSIVE_MONITOR',
  'OPTIMIZATION_NEEDED',
  'ACTION_PENDING',
  'CRITICAL_BLOCKER'
);

CREATE TYPE project_status_enum AS ENUM ('ACTIVE', 'CLOSED');

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

CREATE TABLE projects (
  id                     SERIAL PRIMARY KEY,
  owner_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_project_name    TEXT NOT NULL,
  final_customer         TEXT NOT NULL,
  country                TEXT NOT NULL,
  start_date             DATE NOT NULL,
  project_id             TEXT NOT NULL,
  latest_update          TEXT,
  next_action            TEXT,
  next_step_deadline     DATE NOT NULL,
  wholesale_customer     TEXT NOT NULL,
  action_flag            action_flag_enum NOT NULL,
  status                 project_status_enum NOT NULL DEFAULT 'ACTIVE',
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (owner_id, project_id)
);

CREATE INDEX idx_projects_action_flag ON projects(action_flag);
CREATE INDEX idx_projects_next_step_deadline ON projects(next_step_deadline);
CREATE INDEX idx_projects_owner_project_id ON projects(owner_id, project_id);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_owner_id ON projects(owner_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Phase 3 — immutable activity log (archived “Latest update” values)
CREATE TABLE activity_log (
  id                     SERIAL PRIMARY KEY,
  project_id             INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  timestamp              TIMESTAMPTZ DEFAULT NOW(),
  action_flag_snapshot   action_flag_enum,
  note                   TEXT NOT NULL,
  created_by             TEXT DEFAULT 'system'
);

CREATE INDEX idx_activity_log_project_id ON activity_log(project_id);
