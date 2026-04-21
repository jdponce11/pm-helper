import { useEffect, useState, type FormEvent } from "react";
import type { Project } from "../types";
import { ACTION_FLAGS, emptyProject } from "../types";

type Mode = "create" | "edit";

export function ProjectFormModal(props: {
  open: boolean;
  mode: Mode;
  initial: Project | null;
  onClose: () => void;
  onSaved: () => void;
  createProject: (
    body: Omit<Project, "id" | "createdAt" | "updatedAt">
  ) => Promise<Project>;
  updateProject: (
    id: number,
    body: Omit<Project, "id" | "createdAt" | "updatedAt">
  ) => Promise<Project>;
}) {
  const [values, setValues] = useState(() => emptyProject());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setError(null);
    if (props.mode === "edit" && props.initial) {
      const p = props.initial;
      setValues({
        parentProjectName: p.parentProjectName,
        finalCustomer: p.finalCustomer,
        country: p.country,
        startDate: p.startDate,
        projectId: p.projectId,
        latestUpdate: p.latestUpdate,
        nextAction: p.nextAction,
        nextStepDeadline: p.nextStepDeadline,
        wholesaleCustomer: p.wholesaleCustomer,
        actionFlag: p.actionFlag,
        status: p.status,
      });
    } else {
      setValues(emptyProject());
    }
  }, [props.open, props.mode, props.initial]);

  if (!props.open) return null;

  function set<K extends keyof typeof values>(key: K, v: (typeof values)[K]) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      ...values,
      latestUpdate: values.latestUpdate?.trim() || null,
      nextAction: values.nextAction?.trim() || null,
    };
    try {
      if (props.mode === "create") {
        await props.createProject(payload);
      } else if (props.initial) {
        await props.updateProject(props.initial.id, payload);
      }
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <h2 id="project-form-title">
            {props.mode === "create" ? "New project" : "Edit project"}
          </h2>
          <button type="button" className="btn btn--ghost" onClick={props.onClose}>
            Close
          </button>
        </header>
        <form className="modal__body" onSubmit={submit}>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="form-grid">
            <label>
              Parent project name *
              <input
                required
                value={values.parentProjectName}
                onChange={(e) => set("parentProjectName", e.target.value)}
              />
            </label>
            <label>
              Final customer *
              <input
                required
                value={values.finalCustomer}
                onChange={(e) => set("finalCustomer", e.target.value)}
              />
            </label>
            <label>
              Country *
              <input
                required
                value={values.country}
                onChange={(e) => set("country", e.target.value)}
              />
            </label>
            <label>
              Start date *
              <input
                required
                type="date"
                value={values.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
            </label>
            <label>
              Project ID *
              <input
                required
                value={values.projectId}
                onChange={(e) => set("projectId", e.target.value)}
              />
            </label>
            <label>
              Wholesale customer *
              <input
                required
                value={values.wholesaleCustomer}
                onChange={(e) => set("wholesaleCustomer", e.target.value)}
              />
            </label>
            <label>
              Next step deadline *
              <input
                required
                type="date"
                value={values.nextStepDeadline}
                onChange={(e) => set("nextStepDeadline", e.target.value)}
              />
            </label>
            <label>
              Action flag *
              <select
                value={values.actionFlag}
                onChange={(e) =>
                  set("actionFlag", e.target.value as typeof values.actionFlag)
                }
              >
                {ACTION_FLAGS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-grid__full">
              Latest update
              <textarea
                rows={3}
                value={values.latestUpdate ?? ""}
                onChange={(e) =>
                  set("latestUpdate", e.target.value || null)
                }
              />
            </label>
            <label className="form-grid__full">
              Next action
              <textarea
                rows={3}
                value={values.nextAction ?? ""}
                onChange={(e) => set("nextAction", e.target.value || null)}
              />
            </label>
          </div>
          <footer className="modal__footer">
            <button type="button" className="btn btn--ghost" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
