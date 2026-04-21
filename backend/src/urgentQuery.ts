import type { Pool } from "pg";
import type { ProjectRow } from "./types.js";

export function getUrgencyTimezone(): string {
  return process.env.URGENCY_TIMEZONE?.trim() || "UTC";
}

/** Deadline is “today” in the configured zone and action is not passive monitor. */
export async function queryUrgentProjects(
  pool: Pool,
  ownerId: number
): Promise<ProjectRow[]> {
  const tz = getUrgencyTimezone();
  const result = await pool.query<ProjectRow>(
    `SELECT * FROM projects
     WHERE owner_id = $1
       AND status = 'ACTIVE'::project_status_enum
       AND next_step_deadline = (CURRENT_TIMESTAMP AT TIME ZONE $2::text)::date
       AND action_flag <> 'PASSIVE_MONITOR'::action_flag_enum
     ORDER BY
       CASE action_flag::text
         WHEN 'CRITICAL_BLOCKER' THEN 0
         WHEN 'ACTION_PENDING' THEN 1
         WHEN 'OPTIMIZATION_NEEDED' THEN 2
         WHEN 'PASSIVE_MONITOR' THEN 3
       END ASC,
       next_step_deadline ASC NULLS LAST`,
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
    `next_step_deadline = (CURRENT_TIMESTAMP AT TIME ZONE $${p}::text)::date`
  );
  params.push(tz);
  p++;
  conditions.push(`action_flag <> 'PASSIVE_MONITOR'::action_flag_enum`);
  return p;
}
