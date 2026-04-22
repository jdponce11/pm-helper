/** Local calendar day at midnight (no UTC shift for DATE-only semantics). */
function parseYmdLocal(ymd: string): Date | null {
  const head = ymd.trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(head);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return new Date(y, mo, d);
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Mon–Fri days in [start, end] inclusive; local calendar; 0 if end < start. */
export function countInclusiveBusinessDays(start: Date, end: Date): number {
  const s = startOfLocalDay(start);
  const e = startOfLocalDay(end);
  if (e < s) return 0;
  let n = 0;
  const cur = new Date(s);
  while (cur <= e) {
    const wd = cur.getDay();
    if (wd !== 0 && wd !== 6) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

/** Business days from project start through today (local), Mon–Fri only. */
export function businessDaysOpenFromStart(startDate: string, now = new Date()): number | null {
  const start = parseYmdLocal(startDate);
  if (!start) return null;
  return countInclusiveBusinessDays(start, now);
}

/**
 * Grill tiers: longer-open projects read “more cooked” (no black — text stays readable).
 */
export type GrillTier = 0 | 1 | 2 | 3 | 4;

export function grillTierFromBusinessDays(bd: number): GrillTier {
  if (bd <= 4) return 0;
  if (bd <= 14) return 1;
  if (bd <= 29) return 2;
  if (bd <= 59) return 3;
  return 4;
}
