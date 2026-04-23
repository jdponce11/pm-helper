export type ActionFlag =
  | "PASSIVE_MONITOR"
  | "OPTIMIZATION_NEEDED"
  | "ACTION_PENDING"
  | "CRITICAL_BLOCKER";

export type ProjectStatus = "ACTIVE" | "CLOSED";

export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  /** Customer status update cadence (business days, same DB column name legacy). */
  updateReminderBusinessDays: number;
  crmUpdateReminderBusinessDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: number;
  parentProjectName: string;
  finalCustomer: string;
  country: string;
  startDate: string;
  /** External id; null when not assigned (UI shows “Pending”). */
  projectId: string | null;
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

/** Archived “Latest update” snapshot (Phase 3) */
export interface ActivityLogEntry {
  id: number;
  projectId: number;
  timestamp: string;
  actionFlagSnapshot: ActionFlag | null;
  note: string;
  createdBy: string;
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  sortBy: string;
  sortOrder: string;
  /** Present when the list is ordered by action-flag priority, then deadline */
  sort?: "priority";
}

export const ACTION_FLAGS: ActionFlag[] = [
  "PASSIVE_MONITOR",
  "OPTIMIZATION_NEEDED",
  "ACTION_PENDING",
  "CRITICAL_BLOCKER",
];

/** Display / priority order: most urgent first */
export const ACTION_FLAGS_BY_PRIORITY: ActionFlag[] = [
  "CRITICAL_BLOCKER",
  "ACTION_PENDING",
  "OPTIMIZATION_NEEDED",
  "PASSIVE_MONITOR",
];

export function emptyProject(): Omit<Project, "id" | "createdAt" | "updatedAt"> {
  const today = new Date().toISOString().slice(0, 10);
  return {
    parentProjectName: "",
    finalCustomer: "",
    country: "",
    startDate: today,
    projectId: null,
    latestUpdate: null,
    nextAction: null,
    nextStepDeadline: today,
    wholesaleCustomer: "",
    actionFlag: "PASSIVE_MONITOR",
    status: "ACTIVE",
    lastCustomerUpdateAt: null,
    lastCrmUpdateAt: null,
    customerUpdateStale: false,
    crmUpdateStale: false,
  };
}
