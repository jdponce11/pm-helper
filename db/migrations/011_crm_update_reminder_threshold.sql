-- Independent CRM vs customer update reminder thresholds (1–30 business days each).
-- Keep in sync with backend/migrations/011_crm_update_reminder_threshold.sql
-- (ensureSchema also applies this for older Docker volumes.)

ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_update_reminder_business_days INTEGER;

UPDATE users
SET crm_update_reminder_business_days = update_reminder_business_days
WHERE crm_update_reminder_business_days IS NULL;

ALTER TABLE users ALTER COLUMN crm_update_reminder_business_days SET NOT NULL;
ALTER TABLE users ALTER COLUMN crm_update_reminder_business_days SET DEFAULT 2;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_crm_update_reminder_business_days_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_crm_update_reminder_business_days_check
      CHECK (crm_update_reminder_business_days BETWEEN 1 AND 30);
  END IF;
END
$$;
