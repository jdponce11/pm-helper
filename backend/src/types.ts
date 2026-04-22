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
  created_at: string;
  updated_at: string;
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
}

export function rowToJson(row: ProjectRow): ProjectJson {
  return {
    id: row.id,
    parentProjectName: row.parent_project_name,
    finalCustomer: row.final_customer,
    country: row.country,
    startDate: row.start_date,
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
