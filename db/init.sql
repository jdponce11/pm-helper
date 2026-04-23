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
  update_reminder_business_days INTEGER NOT NULL DEFAULT 2
    CHECK (update_reminder_business_days BETWEEN 1 AND 30),
  crm_update_reminder_business_days INTEGER NOT NULL DEFAULT 2
    CHECK (crm_update_reminder_business_days BETWEEN 1 AND 30),
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
  project_id             TEXT,
  latest_update          TEXT,
  next_action            TEXT,
  next_step_deadline         TIMESTAMPTZ NOT NULL,
  next_step_deadline_has_time BOOLEAN NOT NULL DEFAULT false,
  wholesale_customer     TEXT NOT NULL,
  action_flag            action_flag_enum NOT NULL,
  status                 project_status_enum NOT NULL DEFAULT 'ACTIVE',
  last_customer_update_at TIMESTAMPTZ,
  last_crm_update_at     TIMESTAMPTZ,
  foc_registered_in_crm BOOLEAN NOT NULL DEFAULT false,
  foc_date               DATE,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_projects_owner_project_id ON projects (owner_id, project_id)
WHERE project_id IS NOT NULL AND LENGTH(TRIM(project_id)) > 0;

CREATE INDEX idx_projects_action_flag ON projects(action_flag);
CREATE INDEX idx_projects_next_step_deadline ON projects(next_step_deadline);
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

CREATE OR REPLACE FUNCTION pm_business_weekdays_after(anchor timestamptz, tz text)
RETURNS integer
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  d_start date;
  d_end date;
  i int;
  n int := 0;
  d date;
BEGIN
  d_start := (anchor AT TIME ZONE tz)::date;
  d_end := (CURRENT_TIMESTAMP AT TIME ZONE tz)::date;
  IF d_end <= d_start THEN
    RETURN 0;
  END IF;
  FOR i IN 1..(d_end - d_start) LOOP
    d := d_start + i;
    IF EXTRACT(ISODOW FROM d) <= 5 THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;
