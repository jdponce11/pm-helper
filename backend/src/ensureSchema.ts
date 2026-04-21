import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";

const MIGRATION_FILE = "007_users_and_ownership.sql";

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
