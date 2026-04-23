import { useCallback, useEffect, useRef, useState } from "react";
import { fetchUpdateReminders, fetchUrgentSummary } from "../api";
import type { Project } from "../types";
import { formatUrgentBellLine, formatUrgentReminderLine } from "../projectDisplay";

const POLL_MS = 5 * 60 * 1000;

export function UrgentBell(props: {
  urgentOnly: boolean;
  onToggleUrgent: () => void;
  /** Increment to refetch count (e.g. after saves) */
  refreshToken: number;
}) {
  const { urgentOnly, onToggleUrgent, refreshToken } = props;
  const [open, setOpen] = useState(false);
  const [urgentCount, setUrgentCount] = useState<number | null>(null);
  const [urgentRows, setUrgentRows] = useState<Project[]>([]);
  const [remCustomer, setRemCustomer] = useState<Project[]>([]);
  const [remCrm, setRemCrm] = useState<Project[]>([]);
  const [error, setError] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [urgent, rem] = await Promise.all([fetchUrgentSummary(), fetchUpdateReminders()]);
      setUrgentCount(urgent.count);
      setUrgentRows(urgent.data);
      setRemCustomer(rem.customerStale.data);
      setRemCrm(rem.crmStale.data);
      setError(false);
    } catch {
      setError(true);
      setUrgentCount(null);
      setUrgentRows([]);
      setRemCustomer([]);
      setRemCrm([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const el = wrapRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const urgentIds = new Set(urgentRows.map((p) => p.id));
  const uniqueReminderIds = new Set<number>();
  for (const p of remCustomer) uniqueReminderIds.add(p.id);
  for (const p of remCrm) uniqueReminderIds.add(p.id);
  let combinedUnique = 0;
  for (const id of uniqueReminderIds) {
    if (!urgentIds.has(id)) combinedUnique += 1;
  }
  // Badge = urgent + stale-only (do not double-count projects that are both urgent and stale)
  const badgeCount =
    urgentCount === null ? null : urgentCount + combinedUnique;

  const label =
    badgeCount === null
      ? error
        ? "Reminders (unavailable)"
        : "Reminders"
      : `${badgeCount} reminders`;

  return (
    <div className="urgent-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`urgent-bell${urgentOnly ? " urgent-bell--active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Open reminders"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
      >
        <span className="urgent-bell__icon" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2Z"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="urgent-bell__text">
          {badgeCount === null && !error ? "…" : error ? "—" : badgeCount}{" "}
          <span className="urgent-bell__word">reminders</span>
        </span>
      </button>
      {open ? (
        <div className="urgent-bell__popover" role="dialog" aria-label="Reminder list">
          <div className="urgent-bell__popover-actions">
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => {
                onToggleUrgent();
                setOpen(false);
              }}
            >
              {urgentOnly ? "Show all projects" : "Show attention queue only"}
            </button>
          </div>
          {error ? (
            <p className="muted urgent-bell__popover-empty">Could not load reminders.</p>
          ) : (
            <>
              <h3 className="urgent-bell__sub">Attention queue</h3>
              <p className="muted urgent-bell__subnote">
                Next step due today (non-passive), passive when the customer anchor and CRM
                anchor each exceed their own reminder threshold, or FOC not registered in CRM
                within the first 10 business weekdays after the project start date.
              </p>
              {urgentRows.length === 0 ? (
                <p className="muted urgent-bell__popover-empty">None</p>
              ) : (
                <ul className="urgent-bell__list">
                  {urgentRows.map((p) => (
                    <li key={`u-${p.id}`}>{formatUrgentBellLine(p)}</li>
                  ))}
                </ul>
              )}
              <h3 className="urgent-bell__sub">Needs update — customer</h3>
              {remCustomer.length === 0 ? (
                <p className="muted urgent-bell__popover-empty">None</p>
              ) : (
                <ul className="urgent-bell__list">
                  {remCustomer.map((p) => (
                    <li key={`c-${p.id}`}>
                      {formatUrgentReminderLine(p.projectId, p.parentProjectName)}
                    </li>
                  ))}
                </ul>
              )}
              <h3 className="urgent-bell__sub">Needs update — CRM</h3>
              {remCrm.length === 0 ? (
                <p className="muted urgent-bell__popover-empty">None</p>
              ) : (
                <ul className="urgent-bell__list">
                  {remCrm.map((p) => (
                    <li key={`r-${p.id}`}>
                      {formatUrgentReminderLine(p.projectId, p.parentProjectName)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
