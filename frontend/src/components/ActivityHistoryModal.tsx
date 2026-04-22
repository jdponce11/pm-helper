import { useEffect, useState } from "react";
import type { ActivityLogEntry, Project } from "../types";
import { fetchActivityLog } from "../api";
import { useModalBackdropDismiss } from "../useModalBackdropDismiss";
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

export function ActivityHistoryModal(props: {
  open: boolean;
  project: Project | null;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open || !props.project) {
      setEntries([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void fetchActivityLog(props.project.id)
      .then(setEntries)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load history")
      )
      .finally(() => setLoading(false));
  }, [props.open, props.project]);

  const backdropDismiss = useModalBackdropDismiss(props.onClose);

  if (!props.open || !props.project) return null;

  const title = props.project.projectId;

  return (
    <div className="modal-backdrop" role="presentation" {...backdropDismiss}>
      <div
        className="modal modal--history"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <h2 id="activity-history-title">Latest update history</h2>
            <p className="modal__subtitle mono">{title}</p>
          </div>
          <button type="button" className="btn btn--ghost" onClick={props.onClose}>
            Close
          </button>
        </header>
        <div className="modal__body activity-history">
          {loading ? (
            <p className="muted activity-history__empty">Loading…</p>
          ) : error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : entries.length === 0 ? (
            <p className="muted activity-history__empty">
              No archived updates yet. History appears when you replace an existing
              “Latest update” note.
            </p>
          ) : (
            <ul className="activity-history__list">
              {entries.map((e) => (
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
          )}
        </div>
      </div>
    </div>
  );
}
