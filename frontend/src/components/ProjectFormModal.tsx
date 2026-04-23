import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { fetchMeSettings, fetchProjectFieldSuggestions, type ProjectWriteBody } from "../api";
import {
  datetimeLocalToIso,
  isDateOnlyDeadline,
  isoToDatetimeLocalValue,
} from "../nextStepDeadline";
import { formatExternalProjectId } from "../projectDisplay";
import type { Project } from "../types";
import { ACTION_FLAGS, emptyProject } from "../types";
import { useActivityLog } from "../useActivityLog";
import { useModalBackdropDismiss } from "../useModalBackdropDismiss";
import { formatLastUpdateCadenceLine } from "../updateCadenceDisplay";
import { ActivityHistoryList } from "./ActivityHistoryList";

const SUGGESTION_DROPDOWN_MAX = 50;
const SUGGESTION_IDLE_PREVIEW = 40;

/** API may send DATE as YYYY-MM-DD or as an ISO string; <input type="date"> needs the former. */
function startDateForDateInput(s: string): string {
  const v = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m?.[1] ?? "";
}

function filterSuggestions(all: string[], typed: string): string[] {
  const t = typed.trim().toLowerCase();
  if (!t) return all.slice(0, SUGGESTION_IDLE_PREVIEW);
  return all.filter((s) => s.toLowerCase().includes(t)).slice(0, SUGGESTION_DROPDOWN_MAX);
}

type Mode = "create" | "edit";

export function ProjectFormModal(props: {
  open: boolean;
  mode: Mode;
  initial: Project | null;
  onClose: () => void;
  onSaved: () => void;
  createProject: (body: ProjectWriteBody) => Promise<Project>;
  updateProject: (id: number, body: ProjectWriteBody) => Promise<Project>;
}) {
  const [values, setValues] = useState(() => emptyProject());
  /** Date-only uses YYYY-MM-DD; date+time uses datetime-local then ISO on submit. */
  const [deadlineMode, setDeadlineMode] = useState<"date" | "datetime">("date");
  const [deadlineDatetimeLocal, setDeadlineDatetimeLocal] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markCustomerToday, setMarkCustomerToday] = useState(false);
  const [markCrmToday, setMarkCrmToday] = useState(false);
  const [urgencyTimezone, setUrgencyTimezone] = useState("UTC");
  const [suggestionLists, setSuggestionLists] = useState<{
    parentProjectNames: string[];
    finalCustomers: string[];
    countries: string[];
    wholesaleCustomers: string[];
  }>({ parentProjectNames: [], finalCustomers: [], countries: [], wholesaleCustomers: [] });
  const listIdBase = useId();

  const historyProjectId =
    props.mode === "edit" && props.initial ? props.initial.id : null;
  const historyEnabled = props.open && props.mode === "edit" && props.initial != null;
  const { entries: activityEntries, loading: activityLoading, error: activityError } =
    useActivityLog(historyProjectId, historyEnabled);

  useEffect(() => {
    if (!props.open) return;
    setError(null);
    setMarkCustomerToday(false);
    setMarkCrmToday(false);
    void fetchMeSettings()
      .then((s) => setUrgencyTimezone(s.urgencyTimezone))
      .catch(() => setUrgencyTimezone("UTC"));
    if (props.mode === "edit" && props.initial) {
      const p = props.initial;
      const dtMode = !isDateOnlyDeadline(p.nextStepDeadline);
      setDeadlineMode(dtMode ? "datetime" : "date");
      setDeadlineDatetimeLocal(dtMode ? isoToDatetimeLocalValue(p.nextStepDeadline) : "");
      setValues({
        parentProjectName: p.parentProjectName,
        finalCustomer: p.finalCustomer,
        country: p.country,
        startDate: startDateForDateInput(p.startDate) || p.startDate.trim().slice(0, 10),
        projectId: p.projectId ?? "",
        latestUpdate: p.latestUpdate,
        nextAction: p.nextAction,
        nextStepDeadline: dtMode ? p.nextStepDeadline : p.nextStepDeadline.slice(0, 10),
        wholesaleCustomer: p.wholesaleCustomer,
        actionFlag: p.actionFlag,
        status: p.status,
        lastCustomerUpdateAt: p.lastCustomerUpdateAt,
        lastCrmUpdateAt: p.lastCrmUpdateAt,
        customerUpdateStale: p.customerUpdateStale,
        crmUpdateStale: p.crmUpdateStale,
        focRegisteredInCrm: p.focRegisteredInCrm,
        focDate: p.focDate ? startDateForDateInput(p.focDate) : null,
      });
    } else {
      setDeadlineMode("date");
      setDeadlineDatetimeLocal("");
      setValues(emptyProject());
    }
  }, [props.open, props.mode, props.initial]);

  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    void fetchProjectFieldSuggestions()
      .then((data) => {
        if (cancelled) return;
        setSuggestionLists({
          parentProjectNames: data.parentProjectNames,
          finalCustomers: data.finalCustomers,
          countries: data.countries,
          wholesaleCustomers: data.wholesaleCustomers,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSuggestionLists({
          parentProjectNames: [],
          finalCustomers: [],
          countries: [],
          wholesaleCustomers: [],
        });
      });
    return () => {
      cancelled = true;
    };
  }, [props.open]);

  const parentListId = `${listIdBase}-parent`;
  const finalListId = `${listIdBase}-final`;
  const countryListId = `${listIdBase}-country`;
  const wholesaleListId = `${listIdBase}-wholesale`;

  const parentOptions = useMemo(
    () => filterSuggestions(suggestionLists.parentProjectNames, values.parentProjectName),
    [suggestionLists.parentProjectNames, values.parentProjectName]
  );
  const finalOptions = useMemo(
    () => filterSuggestions(suggestionLists.finalCustomers, values.finalCustomer),
    [suggestionLists.finalCustomers, values.finalCustomer]
  );
  const countryOptions = useMemo(
    () => filterSuggestions(suggestionLists.countries, values.country),
    [suggestionLists.countries, values.country]
  );
  const wholesaleOptions = useMemo(
    () =>
      filterSuggestions(suggestionLists.wholesaleCustomers, values.wholesaleCustomer),
    [suggestionLists.wholesaleCustomers, values.wholesaleCustomer]
  );

  const backdropDismiss = useModalBackdropDismiss(props.onClose);

  if (!props.open) return null;

  const editWithHistory = props.mode === "edit" && props.initial != null;

  function set<K extends keyof typeof values>(key: K, v: (typeof values)[K]) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    let nextStepDeadline: string;
    try {
      nextStepDeadline =
        deadlineMode === "date"
          ? values.nextStepDeadline.trim().slice(0, 10)
          : datetimeLocalToIso(deadlineDatetimeLocal);
    } catch {
      setError("Enter a valid date and time for the next step.");
      setSaving(false);
      return;
    }
    const startDate =
      startDateForDateInput(values.startDate) || values.startDate.trim().slice(0, 10);
    const extId = (values.projectId ?? "").trim();
    let focDateOut: string | null = null;
    if (values.focRegisteredInCrm) {
      const fd =
        startDateForDateInput(values.focDate ?? "") ||
        (values.focDate ?? "").trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fd)) {
        setError("Select the FOC calendar date when confirming CRM registration.");
        setSaving(false);
        return;
      }
      focDateOut = fd;
    }
    const payload: ProjectWriteBody = {
      ...values,
      parentProjectName: values.parentProjectName.trim(),
      projectId: extId.length === 0 ? null : extId,
      startDate,
      nextStepDeadline,
      latestUpdate: values.latestUpdate?.trim() || null,
      nextAction: values.nextAction?.trim() || null,
      focDate: focDateOut,
      focRegisteredInCrm: values.focRegisteredInCrm,
      ...(markCustomerToday ? { markCustomerUpdated: true } : {}),
      ...(markCrmToday ? { markCrmUpdated: true } : {}),
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
    <div
      className="modal-backdrop"
      role="presentation"
      {...backdropDismiss}
    >
      <div
        className={`modal modal--project-form${editWithHistory ? " modal--project-form--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <h2 id="project-form-title">
              {props.mode === "create" ? "New project" : "Edit project"}
            </h2>
            {props.mode === "edit" && props.initial ? (
              <p className="modal__subtitle mono">{formatExternalProjectId(props.initial.projectId)}</p>
            ) : null}
          </div>
          <button type="button" className="btn btn--ghost" onClick={props.onClose}>
            Close
          </button>
        </header>
        <form className="modal__body" onSubmit={submit}>
          {error ? <p className="form-error">{error}</p> : null}
          <datalist id={parentListId}>
            {parentOptions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id={finalListId}>
            {finalOptions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id={countryListId}>
            {countryOptions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id={wholesaleListId}>
            {wholesaleOptions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <div
            className={
              editWithHistory
                ? "modal-form-layout modal-form-layout--with-history"
                : "modal-form-layout"
            }
          >
            <div className="modal-form-layout__main">
              <div className="form-grid">
                <label>
                  Parent project name
                  <input
                    value={values.parentProjectName}
                    onChange={(e) => set("parentProjectName", e.target.value)}
                    list={parentListId}
                    autoComplete="off"
                  />
                </label>
                <label>
                  Final customer *
                  <input
                    required
                    value={values.finalCustomer}
                    onChange={(e) => set("finalCustomer", e.target.value)}
                    list={finalListId}
                    autoComplete="off"
                  />
                </label>
                <label>
                  Country *
                  <input
                    required
                    value={values.country}
                    onChange={(e) => set("country", e.target.value)}
                    list={countryListId}
                    autoComplete="off"
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
                  Project ID
                  <input
                    value={values.projectId ?? ""}
                    onChange={(e) => set("projectId", e.target.value)}
                    placeholder="Leave blank until assigned"
                    autoComplete="off"
                  />
                </label>
                <label>
                  Wholesale customer *
                  <input
                    required
                    value={values.wholesaleCustomer}
                    onChange={(e) => set("wholesaleCustomer", e.target.value)}
                    list={wholesaleListId}
                    autoComplete="off"
                  />
                </label>
                <label className="form-grid__full">
                  Next step deadline *
                  <div className="deadline-mode">
                    <div className="deadline-mode__opt">
                      <input
                        id={`${listIdBase}-dl-date`}
                        type="radio"
                        name="deadline-mode"
                        checked={deadlineMode === "date"}
                        onChange={() => {
                          setDeadlineMode("date");
                          const d =
                            deadlineDatetimeLocal.slice(0, 10) ||
                            values.nextStepDeadline.slice(0, 10);
                          set("nextStepDeadline", d);
                        }}
                      />
                      <label htmlFor={`${listIdBase}-dl-date`}>Date only</label>
                    </div>
                    <div className="deadline-mode__opt">
                      <input
                        id={`${listIdBase}-dl-dt`}
                        type="radio"
                        name="deadline-mode"
                        checked={deadlineMode === "datetime"}
                        onChange={() => {
                          setDeadlineMode("datetime");
                          const base =
                            values.nextStepDeadline.slice(0, 10) ||
                            deadlineDatetimeLocal.slice(0, 10);
                          const nextLocal =
                            deadlineDatetimeLocal || `${base}T09:00`;
                          setDeadlineDatetimeLocal(nextLocal);
                        }}
                      />
                      <label htmlFor={`${listIdBase}-dl-dt`}>Date and time</label>
                    </div>
                  </div>
                  {deadlineMode === "date" ? (
                    <input
                      required
                      type="date"
                      value={
                        isDateOnlyDeadline(values.nextStepDeadline)
                          ? values.nextStepDeadline
                          : values.nextStepDeadline.slice(0, 10)
                      }
                      onChange={(e) => set("nextStepDeadline", e.target.value)}
                    />
                  ) : (
                    <input
                      required
                      type="datetime-local"
                      value={deadlineDatetimeLocal}
                      onChange={(e) => setDeadlineDatetimeLocal(e.target.value)}
                    />
                  )}
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
                <div className="form-grid__full update-cadence-box">
                  <p className="update-cadence-box__title">PM update cadence</p>
                  <div className="update-cadence-group" role="group" aria-label="Check-ins for today">
                    <label className="update-cadence-row">
                      <input
                        type="checkbox"
                        checked={markCustomerToday}
                        onChange={(e) => setMarkCustomerToday(e.target.checked)}
                      />
                      <span className="update-cadence-row__body">
                        <span className="update-cadence-row__action">Customer update sent today</span>
                        <span className="update-cadence-row__meta muted">
                          Last recorded:{" "}
                          {formatLastUpdateCadenceLine(
                            props.mode === "edit" && props.initial
                              ? props.initial.lastCustomerUpdateAt
                              : values.lastCustomerUpdateAt,
                            urgencyTimezone
                          )}
                        </span>
                      </span>
                    </label>
                    <label className="update-cadence-row">
                      <input
                        type="checkbox"
                        checked={markCrmToday}
                        onChange={(e) => setMarkCrmToday(e.target.checked)}
                      />
                      <span className="update-cadence-row__body">
                        <span className="update-cadence-row__action">CRM delivery system updated today</span>
                        <span className="update-cadence-row__meta muted">
                          Last recorded:{" "}
                          {formatLastUpdateCadenceLine(
                            props.mode === "edit" && props.initial
                              ? props.initial.lastCrmUpdateAt
                              : values.lastCrmUpdateAt,
                            urgencyTimezone
                          )}
                        </span>
                      </span>
                    </label>
                  </div>
                  <div
                    className="update-cadence-group update-cadence-group--foc"
                    role="group"
                    aria-label="FOC and CRM registration"
                  >
                    <label className="update-cadence-field">
                      <span className="update-cadence-field__label">FOC date</span>
                      <span className="update-cadence-field__hint muted">
                        Reference when you confirm CRM registration; editable later.
                      </span>
                      <input
                        type="date"
                        value={values.focDate ? startDateForDateInput(values.focDate) : ""}
                        onChange={(e) =>
                          set("focDate", e.target.value ? e.target.value : null)
                        }
                      />
                    </label>
                    <label className="update-cadence-row update-cadence-row--tight">
                      <input
                        type="checkbox"
                        checked={values.focRegisteredInCrm}
                        disabled={props.mode === "edit" && Boolean(props.initial?.focRegisteredInCrm)}
                        onChange={(e) => {
                          const next = e.target.checked;
                          set("focRegisteredInCrm", next);
                          if (!next) set("focDate", null);
                        }}
                      />
                      <span className="update-cadence-row__body">
                        <span className="update-cadence-row__action">
                          FOC shared with customer and registered in CRM
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          {editWithHistory ? (
            <aside
              className="modal-form-layout__aside"
              aria-labelledby="project-form-history-title"
            >
              <h3 className="modal-form-history__title" id="project-form-history-title">
                Latest update history
              </h3>
              <div
                className="modal-form-history__scroll activity-history"
                role="region"
                aria-label="Archived latest update notes"
              >
                <ActivityHistoryList
                  entries={activityEntries}
                  loading={activityLoading}
                  error={activityError}
                />
              </div>
            </aside>
          ) : null}
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
