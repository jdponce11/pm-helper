import type { Pool } from "pg";
import type { ProjectRow, UrgencyReason } from "./types.js";
import { getUrgencyTimezone } from "./urgencyTimezone.js";

/** Fewer than this many business weekdays after start_date ⇒ FOC CRM acknowledgment may be urgent. */
export const FOC_URGENCY_BUSINESS_DAY_MAX_EXCLUSIVE = 10;

export type UrgentQueryMeta = {
  urgency_due_today: boolean;
  urgency_passive_dual: boolean;
  urgency_foc: boolean;
};

export type UrgentProjectQueryResult = {
  row: ProjectRow;
  urgencyReasons: readonly UrgencyReason[];
};

export function urgencyReasonsFromMeta(m: UrgentQueryMeta): UrgencyReason[] {
  const out: UrgencyReason[] = [];
  if (m.urgency_due_today) out.push("NEXT_STEP_DUE_TODAY");
  if (m.urgency_passive_dual) out.push("PASSIVE_DUAL_STALE");
  if (m.urgency_foc) out.push("FOC_NOT_REGISTERED_IN_CRM");
  return out;
}

export function splitUrgentQueryRow(
  r: ProjectRow & UrgentQueryMeta
): { row: ProjectRow; meta: UrgentQueryMeta } {
  const {
    urgency_due_today,
    urgency_passive_dual,
    urgency_foc,
    ...row
  } = r as ProjectRow & UrgentQueryMeta & Record<string, unknown>;
  return {
    row: row as ProjectRow,
    meta: {
      urgency_due_today: urgency_due_today === true,
      urgency_passive_dual: urgency_passive_dual === true,
      urgency_foc: urgency_foc === true,
    },
  };
}

/** Anchor for start_date in urgency TZ (calendar midnight local to that zone). */
function sqlPmBusinessWeekdaysAfterStartDate(tzParam: string): string {
  return `pm_business_weekdays_after((start_date::text || ' 00:00:00')::timestamp AT TIME ZONE ${tzParam}::text, ${tzParam}::text)`;
}

/**
 * Computed flags for urgency reasons; uses $2 = tz, $3 = customer threshold, $4 = CRM threshold
 * (same parameter order as appendUrgentConditions after owner $1).
 */
export function sqlUrgencyMetaSelectColumns(): string {
  const tz = "$2";
  const custTh = "$3";
  const crmTh = "$4";
  const focBd = sqlPmBusinessWeekdaysAfterStartDate(tz);
  return `
    (
      (next_step_deadline AT TIME ZONE ${tz}::text)::date =
        (CURRENT_TIMESTAMP AT TIME ZONE ${tz}::text)::date
      AND action_flag <> 'PASSIVE_MONITOR'::action_flag_enum
    ) AS urgency_due_today,
    (
      action_flag = 'PASSIVE_MONITOR'::action_flag_enum
      AND pm_business_weekdays_after(COALESCE(last_customer_update_at, created_at), ${tz}::text) >= ${custTh}
      AND pm_business_weekdays_after(COALESCE(last_crm_update_at, created_at), ${tz}::text) >= ${crmTh}
    ) AS urgency_passive_dual,
    (
      foc_registered_in_crm = false
      AND ${focBd} < ${FOC_URGENCY_BUSINESS_DAY_MAX_EXCLUSIVE}
    ) AS urgency_foc
  `;
}

const urgentOrderSql = `ORDER BY
  CASE action_flag::text
    WHEN 'CRITICAL_BLOCKER' THEN 0
    WHEN 'ACTION_PENDING' THEN 1
    WHEN 'OPTIMIZATION_NEEDED' THEN 2
    WHEN 'PASSIVE_MONITOR' THEN 3
  END ASC,
  next_step_deadline ASC NULLS LAST,
  start_date ASC`;

/** Tier sort: due today (non-passive), then passive dual-stale, then FOC-only (see queryUrgentProjects). */
export const URGENT_ATTENTION_ORDER_SQL = `ORDER BY
  CASE
    WHEN u.urgency_due_today THEN 0
    WHEN u.urgency_passive_dual THEN 1
    WHEN u.urgency_foc THEN 2
    ELSE 3
  END ASC,
  CASE u.action_flag::text
    WHEN 'CRITICAL_BLOCKER' THEN 0
    WHEN 'ACTION_PENDING' THEN 1
    WHEN 'OPTIMIZATION_NEEDED' THEN 2
    WHEN 'PASSIVE_MONITOR' THEN 3
  END ASC,
  u.next_step_deadline ASC NULLS LAST,
  u.start_date ASC`;

/**
 * “Urgent queue” for ACTIVE projects:
 *
 * - Non-passive: next step deadline calendar date equals today in URGENCY_TIMEZONE (same
 *   date rules as before). PASSIVE_MONITOR is excluded from this branch so arbitrary
 *   calendar deadlines do not drive passive the same as active next-step work.
 *
 * - Passive only when both customer and CRM update anchors are stale vs their
 *   respective user thresholds (`update_reminder_business_days` vs customer anchor,
 *   `crm_update_reminder_business_days` vs CRM anchor; same `pm_business_weekdays_after`
 *   test as `/reminders` and JSON flags). Both axes must exceed their thresholds —
 *   one dimension alone does not surface passive here.
 *
 * - FOC: strictly fewer than 10 business weekdays in (start_date, today] in urgency TZ
 *   (`pm_business_weekdays_after` on start-of-day anchor) and `foc_registered_in_crm` is false.
 *   These rows sort after due-today and passive dual-stale rows.
 */
export async function queryUrgentProjects(
  pool: Pool,
  ownerId: number,
  customerReminderBusinessDays: number,
  crmReminderBusinessDays: number
): Promise<UrgentProjectQueryResult[]> {
  const tz = getUrgencyTimezone();
  const focBd = sqlPmBusinessWeekdaysAfterStartDate("$2");
  const result = await pool.query<ProjectRow & UrgentQueryMeta>(
    `SELECT * FROM (
       SELECT
         projects.*,
         (
           (next_step_deadline AT TIME ZONE $2::text)::date =
             (CURRENT_TIMESTAMP AT TIME ZONE $2::text)::date
           AND action_flag <> 'PASSIVE_MONITOR'::action_flag_enum
         ) AS urgency_due_today,
         (
           action_flag = 'PASSIVE_MONITOR'::action_flag_enum
           AND pm_business_weekdays_after(COALESCE(last_customer_update_at, created_at), $2::text) >= $3
           AND pm_business_weekdays_after(COALESCE(last_crm_update_at, created_at), $2::text) >= $4
         ) AS urgency_passive_dual,
         (
           foc_registered_in_crm = false
           AND ${focBd} < ${FOC_URGENCY_BUSINESS_DAY_MAX_EXCLUSIVE}
         ) AS urgency_foc
       FROM projects
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
             AND pm_business_weekdays_after(COALESCE(last_crm_update_at, created_at), $2::text) >= $4
           )
           OR (
             foc_registered_in_crm = false
             AND ${focBd} < ${FOC_URGENCY_BUSINESS_DAY_MAX_EXCLUSIVE}
           )
         )
     ) AS u
     ${URGENT_ATTENTION_ORDER_SQL}`,
    [ownerId, tz, customerReminderBusinessDays, crmReminderBusinessDays]
  );
  return result.rows.map((raw) => {
    const { row, meta } = splitUrgentQueryRow(raw);
    return { row, urgencyReasons: urgencyReasonsFromMeta(meta) };
  });
}

export function appendUrgentConditions(
  conditions: string[],
  params: unknown[],
  p: number,
  customerReminderBusinessDays: number,
  crmReminderBusinessDays: number
): number {
  const tz = getUrgencyTimezone();
  const tzIdx = p;
  const custThIdx = p + 1;
  const crmThIdx = p + 2;
  const focBd = sqlPmBusinessWeekdaysAfterStartDate(`$${tzIdx}`);
  conditions.push(`status = 'ACTIVE'::project_status_enum`);
  conditions.push(`(
    (
      (next_step_deadline AT TIME ZONE $${tzIdx}::text)::date =
        (CURRENT_TIMESTAMP AT TIME ZONE $${tzIdx}::text)::date
      AND action_flag <> 'PASSIVE_MONITOR'::action_flag_enum
    )
    OR (
      action_flag = 'PASSIVE_MONITOR'::action_flag_enum
      AND pm_business_weekdays_after(COALESCE(last_customer_update_at, created_at), $${tzIdx}::text) >= $${custThIdx}
      AND pm_business_weekdays_after(COALESCE(last_crm_update_at, created_at), $${tzIdx}::text) >= $${crmThIdx}
    )
    OR (
      foc_registered_in_crm = false
      AND ${focBd} < ${FOC_URGENCY_BUSINESS_DAY_MAX_EXCLUSIVE}
    )
  )`);
  params.push(tz, customerReminderBusinessDays, crmReminderBusinessDays);
  return p + 3;
}

const staleOrderSql = urgentOrderSql;

/**
 * Active projects stale on customer vs `customerThresholdBusinessDays` or CRM vs
 * `crmThresholdBusinessDays` (weekdays in (anchor_date, today] in URGENCY_TIMEZONE).
 * Lists each axis separately for `/reminders`; passive dual-axis surfacing in the
 * attention queue uses the same `pm_business_weekdays_after` comparison in
 * `queryUrgentProjects`, with each axis compared to its own threshold.
 */
export async function queryStaleUpdateProjects(
  pool: Pool,
  ownerId: number,
  customerThresholdBusinessDays: number,
  crmThresholdBusinessDays: number
): Promise<{ customerStale: ProjectRow[]; crmStale: ProjectRow[] }> {
  const tz = getUrgencyTimezone();
  const [customer, crm] = await Promise.all([
    pool.query<ProjectRow>(
      `SELECT * FROM projects
       WHERE owner_id = $1
         AND status = 'ACTIVE'::project_status_enum
         AND pm_business_weekdays_after(COALESCE(last_customer_update_at, created_at), $2::text) >= $3
       ${staleOrderSql}`,
      [ownerId, tz, customerThresholdBusinessDays]
    ),
    pool.query<ProjectRow>(
      `SELECT * FROM projects
       WHERE owner_id = $1
         AND status = 'ACTIVE'::project_status_enum
         AND pm_business_weekdays_after(COALESCE(last_crm_update_at, created_at), $2::text) >= $3
       ${staleOrderSql}`,
      [ownerId, tz, crmThresholdBusinessDays]
    ),
  ]);
  return { customerStale: customer.rows, crmStale: crm.rows };
}
