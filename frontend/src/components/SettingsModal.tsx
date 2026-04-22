import { useEffect, useState, type FormEvent } from "react";
import { fetchMeSettings, patchMeSettings } from "../api";
import { useModalBackdropDismiss } from "../useModalBackdropDismiss";

export function SettingsModal(props: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [days, setDays] = useState("2");
  const [tz, setTz] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backdropDismiss = useModalBackdropDismiss(props.onClose);

  useEffect(() => {
    if (!props.open) return;
    setError(null);
    setLoading(true);
    void fetchMeSettings()
      .then((s) => {
        setDays(String(s.updateReminderBusinessDays));
        setTz(s.urgencyTimezone);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load settings");
      })
      .finally(() => setLoading(false));
  }, [props.open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      setError("Enter a whole number from 1 to 30.");
      setSaving(false);
      return;
    }
    try {
      await patchMeSettings({ updateReminderBusinessDays: n });
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!props.open) return null;

  return (
    <div className="modal-backdrop" role="presentation" {...backdropDismiss}>
      <div
        className="modal modal--narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="btn btn--ghost" onClick={props.onClose}>
            Close
          </button>
        </header>
        <form className="modal__body" onSubmit={submit}>
          {error ? <p className="form-error">{error}</p> : null}
          {loading ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <label>
                Remind if no customer update or CRM update for (business days)
                <input
                  type="number"
                  min={1}
                  max={30}
                  required
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </label>
              {tz ? (
                <p className="settings-tz-hint muted">
                  Business days follow Mon–Fri in <code>{tz}</code> (same as due-today urgency).
                </p>
              ) : null}
              <footer className="modal__footer">
                <button type="button" className="btn btn--ghost" onClick={props.onClose}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary" disabled={saving || loading}>
                  {saving ? "Saving…" : "Save"}
                </button>
              </footer>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
