import type { Pool } from "pg";
import type { ProjectRow } from "./types.js";
import { getUrgencyTimezone } from "./urgencyTimezone.js";

const urgentOrderSql = `ORDER BY
  CASE action_flag::text
    WHEN 'CRITICAL_BLOCKER' THEN 0
    WHEN 'ACTION_PENDING' THEN 1
    WHEN 'OPTIMIZATION_NEEDED' THEN 2
    WHEN 'PASSIVE_MONITOR' THEN 3
  END ASC,
  next_step_deadline ASC NULLS LAST,
  start_date ASC`;

/**
 * “Urgent queue” for ACTIVE projects:
 *
 * - Non-passive: next step deadline calendar date equals today in URGENCY_TIMEZONE (same
 *   date rules as before). PASSIVE_MONITOR is excluded from this branch so arbitrary
 *   calendar deadlines do not drive passive the same as active next-step work.
 *
 * - Passive only when both customer and CRM update anchors are stale vs the user’s
 *   `update_reminder_business_days` threshold (same `pm_business_weekdays_after` test as
 *   `/reminders` and `customerUpdateStale` / `crmUpdateStale` in JSON). Both must be
 *   stale — one dimension alone does not surface passive here.
 */
export async function queryUrgentProjects(
  pool: Pool,
  ownerId: number,
  reminderThresholdBusinessDays: number
): Promise<ProjectRow[]> {
  const tz = getUrgencyTimezone();
  const result = await pool.query<ProjectRow>(
    `SELECT * FROM projects
     WHERE owner_id = $1
       AND status = 'ACTIVE'::project_status_enum
       AND (
         (
           (next_step_deadline AT TIME ZONE $2::text)::date =
             (CURRENT_TIMESTAMP AT TIME ZONE $2::text)::date
           AND action_flag <> 'PASSIVE_MONITOR'::action_flag_enum
         )
         OR (
           action_flag = 'PASSIVE_MONITOR'::action_flag_enum
           AND pm_business_weekdays_after(COALESCE(last_customer_update_at, created_at), $2::text) >= $3
           AND pm_business_weekdays_after(COALESCE(last_crm_update_at, created_at), $2::text) >= $3
         )
       )
     ${urgentOrderSql}`,
    [ownerId, tz, reminderThresholdBusinessDays]
  );
  return result.rows;
}

export function appendUrgentConditions(
  conditions: string[],
  params: unknown[],
  p: number,
  reminderThresholdBusinessDays: number
): number {
  const tz = getUrgencyTimezone();
  const tzIdx = p;
  const thIdx = p + 1;
  conditions.push(`status = 'ACTIVE'::project_status_enum`);
  conditions.push(`(
    (
      (next_step_deadline AT TIME ZONE $${tzIdx}::text)::date =
        (CURRENT_TIMESTAMP AT TIME ZONE $${tzIdx}::text)::date
      AND action_flag <> 'PASSIVE_MONITOR'::action_flag_enum
    )
    OR (
      action_flag = 'PASSIVE_MONITOR'::action_flag_enum
      AND pm_business_weekdays_after(COALESCE(last_customer_update_at, created_at), $${tzIdx}::text) >= $${thIdx}
      AND pm_business_weekdays_after(COALESCE(last_crm_update_at, created_at), $${tzIdx}::text) >= $${thIdx}
    )
  )`);
  params.push(tz, reminderThresholdBusinessDays);
  return p + 2;
}

const staleOrderSql = urgentOrderSql;

/**
 * Active projects stale on customer updates or CRM updates vs `thresholdBusinessDays`
 * (weekdays in (anchor_date, today] in URGENCY_TIMEZONE). Lists each axis separately for
 * `/reminders`; passive dual-axis surfacing in the attention queue uses the same
 * `pm_business_weekdays_after` comparison in `queryUrgentProjects`.
 */
export async function queryStaleUpdateProjects(
  pool: Pool,
  ownerId: number,
  thresholdBusinessDays: number
): Promise<{ customerStale: ProjectRow[]; crmStale: ProjectRow[] }> {
  const tz = getUrgencyTimezone();
  const [customer, crm] = await Promise.all([
    pool.query<ProjectRow>(
      `SELECT * FROM projects
       WHERE owner_id = $1
         AND status = 'ACTIVE'::project_status_enum
         AND pm_business_weekdays_after(COALESCE(last_customer_update_at, created_at), $2::text) >= $3
       ${staleOrderSql}`,
      [ownerId, tz, thresholdBusinessDays]
    ),
    pool.query<ProjectRow>(
      `SELECT * FROM projects
       WHERE owner_id = $1
         AND status = 'ACTIVE'::project_status_enum
         AND pm_business_weekdays_after(COALESCE(last_crm_update_at, created_at), $2::text) >= $3
       ${staleOrderSql}`,
      [ownerId, tz, thresholdBusinessDays]
    ),
  ]);
  return { customerStale: customer.rows, crmStale: crm.rows };
}
