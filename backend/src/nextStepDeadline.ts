import { z } from "zod";
import type { Pool } from "pg";
import { getUrgencyTimezone } from "./urgencyTimezone.js";

/**
 * API: YYYY-MM-DD = calendar day only (no wall-clock time).
 * ISO 8601 with time (e.g. …T14:30:00Z or offset) = specific instant (meetings/visits).
 */
export const nextStepDeadlineFieldSchema = z.string().trim().superRefine((val, ctx) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid calendar date",
      });
    }
    return;
  }
  const t = Date.parse(val);
  if (Number.isNaN(t)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expected YYYY-MM-DD or ISO 8601 datetime",
    });
  }
});

export function isDateOnlyNextStepDeadline(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

/** Map DB row to JSON string (date-only vs full ISO). */
export function formatProjectNextStepDeadline(
  isoFromPg: string,
  includesTime: boolean
): string {
  if (!includesTime) {
    const d = new Date(isoFromPg);
    const tz = getUrgencyTimezone();
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }
  return new Date(isoFromPg).toISOString();
}

export type ResolvedNextStepDeadline = { ts: Date; includesTime: boolean };

/** Persist: date-only → start of that calendar day in URGENCY_TIMEZONE; datetime → instant. */
export async function resolveNextStepDeadlineForDb(
  pool: Pool,
  raw: string
): Promise<ResolvedNextStepDeadline> {
  const s = raw.trim();
  if (isDateOnlyNextStepDeadline(s)) {
    const r = await pool.query<{ t: Date }>(
      `SELECT (($1::text || ' 00:00:00')::timestamp AT TIME ZONE $2::text) AS t`,
      [s, getUrgencyTimezone()]
    );
    const row = r.rows[0];
    if (!row?.t) {
      throw new Error("Could not resolve next-step deadline");
    }
    return { ts: row.t, includesTime: false };
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid next-step deadline datetime");
  }
  return { ts: d, includesTime: true };
}
