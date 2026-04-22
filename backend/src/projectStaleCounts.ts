import type { Pool } from "pg";
import { getUrgencyTimezone } from "./urgencyTimezone.js";

export type StaleCountRow = { id: number; customer_bd: number; crm_bd: number };

/**
 * Business weekdays in (anchor_date, today_date] in `tz`, matching pm_business_weekdays_after().
 */
export async function fetchProjectStaleBusinessDayCounts(
  pool: Pool,
  projectIds: number[],
  tz: string = getUrgencyTimezone()
): Promise<Map<number, { customer: number; crm: number }>> {
  const map = new Map<number, { customer: number; crm: number }>();
  if (projectIds.length === 0) return map;
  const result = await pool.query<StaleCountRow>(
    `SELECT id,
      pm_business_weekdays_after(COALESCE(last_customer_update_at, created_at), $1::text) AS customer_bd,
      pm_business_weekdays_after(COALESCE(last_crm_update_at, created_at), $1::text) AS crm_bd
     FROM projects WHERE id = ANY($2::int[])`,
    [tz, projectIds]
  );
  for (const r of result.rows) {
    map.set(r.id, { customer: r.customer_bd, crm: r.crm_bd });
  }
  return map;
}

export async function fetchUserReminderThreshold(pool: Pool, userId: number): Promise<number> {
  const r = await pool.query<{ update_reminder_business_days: number }>(
    `SELECT update_reminder_business_days FROM users WHERE id = $1`,
    [userId]
  );
  const v = r.rows[0]?.update_reminder_business_days;
  if (typeof v === "number" && Number.isInteger(v)) return v;
  return 2;
}
