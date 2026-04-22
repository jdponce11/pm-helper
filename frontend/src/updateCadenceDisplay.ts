/** ISO weekday Mon=1 … Sun=7 (matches PostgreSQL ISODOW). */
function isoDowUtc(y: number, m: number, d: number): number {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

function ymdToOrd(ymd: string): number {
  const p = ymd.split("-").map(Number);
  const y = p[0];
  const m = p[1];
  const d = p[2];
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    return NaN;
  }
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function ordToYmd(ord: number): string {
  const dt = new Date(ord * 86400000);
  return dt.toISOString().slice(0, 10);
}

/** Calendar YYYY-MM-DD for an instant in IANA `tz` (same idea as Postgres AT TIME ZONE). */
export function calendarYmdInTz(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const mo = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${mo}-${d}`;
}

/** Weekdays in (anchorYmd, todayYmd] — matches pm_business_weekdays_after anchor→now. */
export function businessWeekdaysAfterYmd(anchorYmd: string, todayYmd: string): number {
  if (todayYmd <= anchorYmd) return 0;
  const startOrd = ymdToOrd(anchorYmd);
  const endOrd = ymdToOrd(todayYmd);
  if (!Number.isFinite(startOrd) || !Number.isFinite(endOrd)) return 0;
  let n = 0;
  for (let ord = startOrd + 1; ord <= endOrd; ord++) {
    const ymd = ordToYmd(ord);
    const p = ymd.split("-").map(Number);
    const y = p[0];
    const m = p[1];
    const d = p[2];
    if (
      y === undefined ||
      m === undefined ||
      d === undefined ||
      !Number.isFinite(y) ||
      !Number.isFinite(m) ||
      !Number.isFinite(d)
    ) {
      continue;
    }
    if (isoDowUtc(y, m, d) <= 5) n += 1;
  }
  return n;
}

export function businessWeekdaysAfterTimestamp(anchorIso: string, tz: string): number {
  const a = calendarYmdInTz(anchorIso, tz);
  const t = calendarYmdInTz(new Date().toISOString(), tz);
  return businessWeekdaysAfterYmd(a, t);
}

/** Human label for a single timestamp (customer/CRM), or "never" when absent. */
export function formatLastUpdateCadenceLine(iso: string | null, tz: string): string {
  if (!iso) return "never";
  const ymd = calendarYmdInTz(iso, tz);
  const bd = businessWeekdaysAfterTimestamp(iso, tz);
  const dayWord = bd === 1 ? "1 business day" : `${bd} business days`;
  if (bd === 0) return `today — ${ymd}`;
  return `${dayWord} ago — ${ymd}`;
}
