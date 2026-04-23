import type { ActivityLogEntry } from "../types";
import { ActionFlagBadge } from "./ActionFlagBadge";

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return iso;
  }
}

export function ActivityHistoryList(props: {
  entries: ActivityLogEntry[];
  loading: boolean;
  error: string | null;
}) {
  if (props.loading) {
    return <p className="muted activity-history__empty">Loading…</p>;
  }
  if (props.error) {
    return (
      <p className="form-error" role="alert">
        {props.error}
      </p>
    );
  }
  if (props.entries.length === 0) {
    return (
      <p className="muted activity-history__empty">
        No archived updates yet. History appears when you replace an existing “Latest update”
        note.
      </p>
    );
  }
  return (
    <ul className="activity-history__list">
      {props.entries.map((e) => (
        <li key={e.id} className="activity-history__item">
          <div className="activity-history__meta">
            <time dateTime={e.timestamp}>{formatTimestamp(e.timestamp)}</time>
            {e.actionFlagSnapshot ? (
              <ActionFlagBadge value={e.actionFlagSnapshot} />
            ) : (
              <span className="badge badge--passive" title="No snapshot">
                —
              </span>
            )}
          </div>
          <p className="activity-history__note">{e.note}</p>
        </li>
      ))}
    </ul>
  );
}
