-- Informative FOC calendar date (reference only; urgency still uses foc_registered_in_crm + window).
-- Keep in sync with backend/migrations/013_foc_date.sql

ALTER TABLE projects ADD COLUMN IF NOT EXISTS foc_date DATE;
