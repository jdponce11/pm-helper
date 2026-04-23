-- FOC acknowledgment: PM confirms FOC date was shared with customer and registered in CRM.
-- Keep in sync with db/migrations/012_foc_registered_in_crm.sql

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS foc_registered_in_crm BOOLEAN NOT NULL DEFAULT false;
