import type { Project } from "../types";
import { useModalBackdropDismiss } from "../useModalBackdropDismiss";
import { useActivityLog } from "../useActivityLog";
import { formatExternalProjectId } from "../projectDisplay";
import { ActivityHistoryList } from "./ActivityHistoryList";

export function ActivityHistoryModal(props: {
  open: boolean;
  project: Project | null;
  onClose: () => void;
}) {
  const enabled = Boolean(props.open && props.project);
  const projectId = props.project?.id ?? null;
  const { entries, loading, error } = useActivityLog(projectId, enabled);

  const backdropDismiss = useModalBackdropDismiss(props.onClose);

  if (!props.open || !props.project) return null;

  const title = formatExternalProjectId(props.project.projectId);

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
          <ActivityHistoryList entries={entries} loading={loading} error={error} />
        </div>
      </div>
    </div>
  );
}
