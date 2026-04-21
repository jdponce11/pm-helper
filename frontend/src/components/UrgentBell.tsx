import { useCallback, useEffect, useState } from "react";
import { fetchUrgentSummary } from "../api";

const POLL_MS = 5 * 60 * 1000;

export function UrgentBell(props: {
  urgentOnly: boolean;
  onToggleUrgent: () => void;
  /** Increment to refetch count (e.g. after saves) */
  refreshToken: number;
}) {
  const { urgentOnly, onToggleUrgent, refreshToken } = props;
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetchUrgentSummary();
      setCount(res.count);
      setError(false);
    } catch {
      setError(true);
      setCount(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const label =
    count === null
      ? error
        ? "Urgent projects (unavailable)"
        : "Urgent projects"
      : `${count} urgent`;

  return (
    <button
      type="button"
      className={`urgent-bell${urgentOnly ? " urgent-bell--active" : ""}`}
      onClick={onToggleUrgent}
      title={
        urgentOnly
          ? "Showing urgent only — click to show all projects"
          : "Due today (non-passive) — click to filter"
      }
      aria-pressed={urgentOnly}
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
        {count === null && !error ? "…" : error ? "—" : count}{" "}
        <span className="urgent-bell__word">urgent</span>
      </span>
    </button>
  );
}
