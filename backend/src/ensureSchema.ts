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
