import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";
import { getUrgencyTimezone } from "./urgencyTimezone.js";

const MIGRATION_FILE = "007_users_and_ownership.sql";

function escapeForSqlStringLiteral(tz: string): string {
  const t = tz.trim();
  if (!/^[A-Za-z0-9_/+\-]+$/.test(t)) {
    throw new Error(
      "URGENCY_TIMEZONE must be a simple IANA id (letters, digits, _ / + -) for automatic DB migration"
    );
  }
  return t.replace(/'/g, "''");
}

/**
 * Older Docker volumes were initialized before Phase 7; `docker-entrypoint-initdb.d` does not re-run.
 * If `users` is missing, apply the bundled migration once.
 */
export async function ensurePhase7Schema(): Promise<void> {
  const check = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    ) AS exists`
  );
  if (check.rows[0]?.exists) {
    return;
  }

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const path = join(__dirname, "..", "migrations", MIGRATION_FILE);

  let sql: string;
  try {
    sql = readFileSync(path, "utf8");
  } catch (e) {
    console.error("[schema] Could not read migration file:", path, e);
    throw new Error(
      "Database is missing the users table and the migration file could not be loaded."
    );
  }

  console.log("[schema] Applying Phase 7 migration (users + project ownership)…");
  await pool.query(sql);
  console.log("[schema] Phase 7 migration applied.");
}

/**
 * Older volumes: `next_step_deadline` was DATE. Convert to TIMESTAMPTZ using start-of-day in
 * URGENCY_TIMEZONE for each legacy calendar date (matches new date-only write path).
 */
export async function ensureNextStepDeadlineSchema(): Promise<void> {
  const tbl = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'projects'
    ) AS exists`
  );
  if (!tbl.rows[0]?.exists) return;

  const hasTimeCol = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects'
        AND column_name = 'next_step_deadline_has_time'
    ) AS exists`
  );
  if (!hasTimeCol.rows[0]?.exists) {
    await pool.query(
      `ALTER TABLE projects ADD COLUMN next_step_deadline_has_time BOOLEAN NOT NULL DEFAULT false`
    );
  }

  const dt = await pool.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'next_step_deadline'`
  );
  if (dt.rows[0]?.data_type !== "date") return;

  const tz = escapeForSqlStringLiteral(getUrgencyTimezone());
  console.log(
    "[schema] Migrating projects.next_step_deadline from DATE to TIMESTAMPTZ (00:00 in URGENCY_TIMEZONE)…"
  );
  await pool.query(`
    ALTER TABLE projects
      ALTER COLUMN next_step_deadline TYPE TIMESTAMPTZ
      USING ((next_step_deadline::text || ' 00:00:00')::timestamp AT TIME ZONE '${tz}')
  `);
  console.log("[schema] next_step_deadline column migration applied.");
}

const PM_BUSINESS_WEEKDAYS_AFTER_SQL = `
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
`;

/**
 * Older volumes: customer/CRM update timestamps, per-user reminder threshold, and business-day helper.
 */
export async function ensureUpdateCadenceSchema(): Promise<void> {
  const usersTbl = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    ) AS exists`
  );
  if (!usersTbl.rows[0]?.exists) return;

  const hasReminderCol = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
        AND column_name = 'update_reminder_business_days'
    ) AS exists`
  );
  if (!hasReminderCol.rows[0]?.exists) {
    console.log("[schema] Adding users.update_reminder_business_days…");
    await pool.query(
      `ALTER TABLE users ADD COLUMN update_reminder_business_days INTEGER NOT NULL DEFAULT 2`
    );
  }

  await pool.query(`
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
  `);

  const hasCrmReminderCol = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
        AND column_name = 'crm_update_reminder_business_days'
    ) AS exists`
  );
  if (!hasCrmReminderCol.rows[0]?.exists) {
    console.log("[schema] Adding users.crm_update_reminder_business_days…");
    await pool.query(`ALTER TABLE users ADD COLUMN crm_update_reminder_business_days INTEGER`);
    await pool.query(
      `UPDATE users SET crm_update_reminder_business_days = update_reminder_business_days
       WHERE crm_update_reminder_business_days IS NULL`
    );
    await pool.query(
      `ALTER TABLE users ALTER COLUMN crm_update_reminder_business_days SET NOT NULL`
    );
    await pool.query(
      `ALTER TABLE users ALTER COLUMN crm_update_reminder_business_days SET DEFAULT 2`
    );
  }

  await pool.query(`
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
  `);

  const projTbl = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'projects'
    ) AS exists`
  );
  if (!projTbl.rows[0]?.exists) return;

  const hasCust = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects'
        AND column_name = 'last_customer_update_at'
    ) AS exists`
  );
  if (!hasCust.rows[0]?.exists) {
    console.log("[schema] Adding projects.last_customer_update_at…");
    await pool.query(`ALTER TABLE projects ADD COLUMN last_customer_update_at TIMESTAMPTZ`);
  }

  const hasCrm = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects'
        AND column_name = 'last_crm_update_at'
    ) AS exists`
  );
  if (!hasCrm.rows[0]?.exists) {
    console.log("[schema] Adding projects.last_crm_update_at…");
    await pool.query(`ALTER TABLE projects ADD COLUMN last_crm_update_at TIMESTAMPTZ`);
  }

  console.log("[schema] Ensuring pm_business_weekdays_after()…");
  await pool.query(PM_BUSINESS_WEEKDAYS_AFTER_SQL);
}

/**
 * External project_id optional: NULL = unassigned; uniqueness only for non-empty IDs (partial index).
 */
export async function ensureOptionalExternalProjectIdSchema(): Promise<void> {
  const tbl = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'projects'
    ) AS exists`
  );
  if (!tbl.rows[0]?.exists) return;

  const col = await pool.query<{ is_nullable: string }>(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'project_id'`
  );
  const idx = await pool.query<{ indexdef: string | null }>(
    `SELECT indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_projects_owner_project_id'`
  );
  const def = idx.rows[0]?.indexdef ?? "";
  if (col.rows[0]?.is_nullable === "YES" && /\bWHERE\b/i.test(def)) {
    return;
  }

  console.log(
    "[schema] Applying optional external project_id migration (partial unique index + NULL unassigned)…"
  );
  await pool.query(`ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_owner_id_project_id_key`);
  await pool.query(`DROP INDEX IF EXISTS idx_projects_owner_project_id`);
  await pool.query(
    `UPDATE projects SET project_id = NULL WHERE LENGTH(TRIM(COALESCE(project_id, ''))) = 0`
  );
  await pool.query(`ALTER TABLE projects ALTER COLUMN project_id DROP NOT NULL`);
  await pool.query(`
    CREATE UNIQUE INDEX idx_projects_owner_project_id ON projects (owner_id, project_id)
    WHERE project_id IS NOT NULL AND LENGTH(TRIM(project_id)) > 0
  `);
  console.log("[schema] Optional external project_id migration applied.");
}

/**
 * FOC acknowledgment flag on projects (FOC date shared with customer and registered in CRM).
 */
export async function ensureFocRegisteredInCrmSchema(): Promise<void> {
  const tbl = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'projects'
    ) AS exists`
  );
  if (!tbl.rows[0]?.exists) return;

  const col = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects'
        AND column_name = 'foc_registered_in_crm'
    ) AS exists`
  );
  if (col.rows[0]?.exists) return;

  console.log("[schema] Adding projects.foc_registered_in_crm…");
  await pool.query(
    `ALTER TABLE projects ADD COLUMN foc_registered_in_crm BOOLEAN NOT NULL DEFAULT false`
  );
  console.log("[schema] foc_registered_in_crm column added.");
}

/** Optional informative FOC calendar date (set together with CRM registration acknowledgment). */
export async function ensureFocDateSchema(): Promise<void> {
  const tbl = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'projects'
    ) AS exists`
  );
  if (!tbl.rows[0]?.exists) return;

  const col = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects'
        AND column_name = 'foc_date'
    ) AS exists`
  );
  if (col.rows[0]?.exists) return;

  console.log("[schema] Adding projects.foc_date…");
  await pool.query(`ALTER TABLE projects ADD COLUMN foc_date DATE`);
  console.log("[schema] foc_date column added.");
}
