-- Phase 8 — next step deadline: calendar day vs specific instant
-- Keep in sync with db/migrations/008_next_step_deadline_timestamptz.sql
-- API startup runs an equivalent migration using URGENCY_TIMEZONE when the column is still DATE.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS next_step_deadline_has_time BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE projects
  ALTER COLUMN next_step_deadline TYPE TIMESTAMPTZ
  USING ((next_step_deadline::text || ' 00:00:00')::timestamp AT TIME ZONE 'UTC');
