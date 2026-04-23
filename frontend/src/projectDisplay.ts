import type { Project } from "./types";

/** Shown for rows with no external / CRM project id yet (stored as null). */
export const PENDING_EXTERNAL_PROJECT_ID_LABEL = "Pending";

export function formatExternalProjectId(externalId: string | null | undefined): string {
  const t = (externalId ?? "").trim();
  return t.length > 0 ? t : PENDING_EXTERNAL_PROJECT_ID_LABEL;
}

export function formatUrgentReminderLine(
  externalId: string | null | undefined,
  parentName: string
): string {
  const parent = parentName.trim();
  return `${formatExternalProjectId(externalId)} — ${parent.length > 0 ? parent : "—"}`;
}

/** Bell / reminder list: passive dual-stale rows get cadence context (not next-step due today). */
export function formatUrgentBellLine(p: Project): string {
  const base = formatUrgentReminderLine(p.projectId, p.parentProjectName);
  const hints: string[] = [];
  if (
    p.actionFlag === "PASSIVE_MONITOR" &&
    p.customerUpdateStale &&
    p.crmUpdateStale
  ) {
    hints.push("passive — customer and CRM cadences each exceed their thresholds");
  }
  if (p.urgencyReasons?.includes("FOC_NOT_REGISTERED_IN_CRM")) {
    hints.push("FOC not registered in CRM yet");
  }
  return hints.length > 0 ? `${base} · ${hints.join(" · ")}` : base;
}
