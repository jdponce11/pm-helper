-- Phase 8 — next step deadline: calendar day vs specific instant
-- For existing volumes still on DATE. Default below uses UTC midnight → matches compose default URGENCY_TIMEZONE=UTC.
-- If this DB used another URGENCY_TIMEZONE before upgrade, edit AT TIME ZONE to that zone before running manually,
-- or rely on API startup migration (backend ensureSchema) which uses the current URGENCY_TIMEZONE env value.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS next_step_deadline_has_time BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE projects
  ALTER COLUMN next_step_deadline TYPE TIMESTAMPTZ
  USING ((next_step_deadline::text || ' 00:00:00')::timestamp AT TIME ZONE 'UTC');
