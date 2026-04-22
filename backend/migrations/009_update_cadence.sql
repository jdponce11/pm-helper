-- Phase 9 — PM customer / CRM update cadence reminders
-- Keep in sync with db/migrations/009_update_cadence.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS update_reminder_business_days INTEGER NOT NULL DEFAULT 2;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_update_reminder_business_days_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_update_reminder_business_days_check
      CHECK (update_reminder_business_days BETWEEN 1 AND 30);
  END IF;
END
$$;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_customer_update_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_crm_update_at TIMESTAMPTZ;

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
