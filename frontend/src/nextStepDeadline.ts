/** API shape: YYYY-MM-DD (no time) vs ISO instant string. */
export function isDateOnlyDeadline(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

/** Date-only: past if calendar day is before local today. Datetime: past if instant is before now. */
export function isDeadlinePast(s: string): boolean {
  const v = s.trim();
  if (isDateOnlyDeadline(v)) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!match) return false;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const deadline = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    deadline.setHours(0, 0, 0, 0);
    return deadline < today;
  }
  const t = Date.parse(v);
  if (Number.isNaN(t)) return false;
  return new Date(v) < new Date();
}

export function displayDeadline(s: string): string {
  if (isDateOnlyDeadline(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export function isoToDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Interpret datetime-local value as local wall time → UTC ISO for the API. */
export function datetimeLocalToIso(local: string): string {
  const d = new Date(local.trim());
  if (Number.isNaN(d.getTime())) {
    throw new RangeError("Invalid datetime-local value");
  }
  return d.toISOString();
}
