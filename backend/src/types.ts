import { formatProjectNextStepDeadline } from "./nextStepDeadline.js";

export type ActionFlag =
  | "PASSIVE_MONITOR"
  | "OPTIMIZATION_NEEDED"
  | "ACTION_PENDING"
  | "CRITICAL_BLOCKER";

export type ProjectStatus = "ACTIVE" | "CLOSED";

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  full_name: string;
  update_reminder_business_days: number;
  created_at: string;
  updated_at: string;
}

/** User row without password (e.g. RETURNING after insert). */
export type SafeUserRow = Omit<UserRow, "password_hash">;

export interface ProjectRow {
  id: number;
  owner_id: number;
  parent_project_name: string;
  final_customer: string;
  country: string;
  start_date: string;
  project_id: string;
  latest_update: string | null;
  next_action: string | null;
  next_step_deadline: string;
  next_step_deadline_has_time: boolean;
  wholesale_customer: string;
  action_flag: ActionFlag;
  status: ProjectStatus;
  last_customer_update_at: string | null;
  last_crm_update_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ProjectStaleCounts = { customer: number; crm: number };

/**
 * Postgres DATE / pg may yield a JS Date or an ISO string with a time part.
 * Clients (e.g. <input type="date">) need a strict calendar YYYY-MM-DD without
 * timezone-dependent shifts: use the UTC calendar day for Date instances.
 */
function formatStartDateForJson(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return value.toISOString().slice(0, 10);
  }
  const s = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : "";
}

export interface ProjectJson {
  id: number;
  parentProjectName: string;
  finalCustomer: string;
  country: string;
  startDate: string;
  projectId: string;
  latestUpdate: string | null;
  nextAction: string | null;
  nextStepDeadline: string;
  wholesaleCustomer: string;
  actionFlag: ActionFlag;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  lastCustomerUpdateAt: string | null;
  lastCrmUpdateAt: string | null;
  customerUpdateStale: boolean;
  crmUpdateStale: boolean;
}

export function rowToJson(row: ProjectRow, stale?: ProjectStaleCounts & { reminderThreshold: number }): ProjectJson {
  const customerBd = stale?.customer ?? 0;
  const crmBd = stale?.crm ?? 0;
  const th = stale?.reminderThreshold ?? 999;
  const customerUpdateStale = row.status === "ACTIVE" && customerBd >= th;
  const crmUpdateStale = row.status === "ACTIVE" && crmBd >= th;
  return {
    id: row.id,
    parentProjectName: row.parent_project_name,
    finalCustomer: row.final_customer,
    country: row.country,
    startDate: formatStartDateForJson(row.start_date as unknown),
    projectId: row.project_id,
    latestUpdate: row.latest_update,
    nextAction: row.next_action,
    nextStepDeadline: formatProjectNextStepDeadline(
      row.next_step_deadline,
      row.next_step_deadline_has_time ?? false
    ),
    wholesaleCustomer: row.wholesale_customer,
    actionFlag: row.action_flag,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCustomerUpdateAt: row.last_customer_update_at ?? null,
    lastCrmUpdateAt: row.last_crm_update_at ?? null,
    customerUpdateStale,
    crmUpdateStale,
  };
}

export interface ActivityLogRow {
  id: number;
  project_id: number;
  timestamp: string;
  action_flag_snapshot: ActionFlag | null;
  note: string;
  created_by: string;
}

export interface ActivityLogJson {
  id: number;
  projectId: number;
  timestamp: string;
  actionFlagSnapshot: ActionFlag | null;
  note: string;
  createdBy: string;
}

export function activityLogRowToJson(row: ActivityLogRow): ActivityLogJson {
  return {
    id: row.id,
    projectId: row.project_id,
    timestamp: row.timestamp,
    actionFlagSnapshot: row.action_flag_snapshot,
    note: row.note,
    createdBy: row.created_by,
  };
}
