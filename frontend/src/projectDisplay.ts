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
