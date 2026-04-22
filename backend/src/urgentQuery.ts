import type { Pool } from "pg";
import type { ProjectRow } from "./types.js";
import { getUrgencyTimezone } from "./urgencyTimezone.js";

/**
 * Deadline is “today” in the configured zone and action is not passive monitor.
 * For both date-only (stored as start-of-day in that zone) and datetimes, “today” means
 * the scheduled instant’s calendar date in URGENCY_TIMEZONE equals today’s date there.
 */
export async function queryUrgentProjects(
  pool: Pool,
  ownerId: number
): Promise<ProjectRow[]> {
  const tz = getUrgencyTimezone();
  const result = await pool.query<ProjectRow>(
    `SELECT * FROM projects
     WHERE owner_id = $1
       AND status = 'ACTIVE'::project_status_enum
       AND (next_step_deadline AT TIME ZONE $2::text)::date =
           (CURRENT_TIMESTAMP AT TIME ZONE $2::text)::date
       AND action_flag <> 'PASSIVE_MONITOR'::action_flag_enum
     ORDER BY
       CASE action_flag::text
         WHEN 'CRITICAL_BLOCKER' THEN 0
         WHEN 'ACTION_PENDING' THEN 1
         WHEN 'OPTIMIZATION_NEEDED' THEN 2
         WHEN 'PASSIVE_MONITOR' THEN 3
       END ASC,
       next_step_deadline ASC NULLS LAST,
       start_date ASC`,
    [ownerId, tz]
  );
  return result.rows;
}

export function appendUrgentConditions(
  conditions: string[],
  params: unknown[],
  p: number
): number {
  const tz = getUrgencyTimezone();
  conditions.push(`status = 'ACTIVE'::project_status_enum`);
  conditions.push(
    `(next_step_deadline AT TIME ZONE $${p}::text)::date = (CURRENT_TIMESTAMP AT TIME ZONE $${p}::text)::date`
  );
  params.push(tz);
  p++;
  conditions.push(`action_flag <> 'PASSIVE_MONITOR'::action_flag_enum`);
  return p;
}
