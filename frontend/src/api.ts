import type {
  ActivityLogEntry,
  AuthUser,
  ListMeta,
  Project,
  ProjectStatus,
} from "./types";

export interface ListParams {
  page: number;
  limit: number;
  /** When set, server sorts by action-flag priority then next-step deadline */
  sort?: "priority";
  sortBy: string;
  sortOrder: "asc" | "desc";
  search: string;
  country: string;
  actionFlag: string;
  finalCustomer: string;
  wholesaleCustomer: string;
  /** active (default on server), closed, or all */
  status?: "active" | "closed" | "all";
  /** Deadline today (server timezone) and not PASSIVE_MONITOR */
  urgentOnly?: boolean;
}

export interface ListResponse {
  data: Project[];
  meta: ListMeta;
}

function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: "include" });
}

async function readError(res: Response): Promise<string> {
  const err = await res.json().catch(() => ({}));
  return (err as { error?: string }).error ?? res.statusText;
}

export async function fetchMe(): Promise<AuthUser | null> {
  const res = await apiFetch("/api/auth/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { user: AuthUser };
  return body.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { user: AuthUser };
  return body.user;
}

export async function register(
  email: string,
  password: string,
  fullName: string
): Promise<AuthUser> {
  const res = await apiFetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, fullName }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { user: AuthUser };
  return body.user;
}

export async function logout(): Promise<void> {
  const res = await apiFetch("/api/auth/logout", { method: "POST" });
  if (res.status === 204 || res.ok) return;
  throw new Error(await readError(res));
}

function buildQuery(p: ListParams): string {
  const q = new URLSearchParams();
  q.set("page", String(p.page));
  q.set("limit", String(p.limit));
  if (p.sort === "priority") {
    q.set("sort", "priority");
  } else {
    q.set("sortBy", p.sortBy);
    q.set("sortOrder", p.sortOrder);
  }
  if (p.search.trim()) q.set("search", p.search.trim());
  if (p.country.trim()) q.set("country", p.country.trim());
  if (p.actionFlag) q.set("actionFlag", p.actionFlag);
  if (p.finalCustomer.trim()) q.set("finalCustomer", p.finalCustomer.trim());
  if (p.wholesaleCustomer.trim())
    q.set("wholesaleCustomer", p.wholesaleCustomer.trim());
  if (p.status) q.set("status", p.status);
  if (p.urgentOnly) q.set("urgentOnly", "true");
  return q.toString();
}

export async function fetchUrgentSummary(): Promise<{
  count: number;
  data: Project[];
}> {
  const res = await apiFetch("/api/projects/urgent");
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return res.json() as Promise<{ count: number; data: Project[] }>;
}

export interface MeSettings {
  updateReminderBusinessDays: number;
  urgencyTimezone: string;
}

export async function fetchMeSettings(): Promise<MeSettings> {
  const res = await apiFetch("/api/me/settings");
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<MeSettings>;
}

export async function patchMeSettings(
  body: Pick<MeSettings, "updateReminderBusinessDays">
): Promise<MeSettings> {
  const res = await apiFetch("/api/me/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<MeSettings>;
}

export interface UpdateRemindersResponse {
  urgencyTimezone: string;
  customerStale: { count: number; data: Project[] };
  crmStale: { count: number; data: Project[] };
}

export async function fetchUpdateReminders(): Promise<UpdateRemindersResponse> {
  const res = await apiFetch("/api/projects/reminders");
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<UpdateRemindersResponse>;
}

export async function fetchProjects(params: ListParams): Promise<ListResponse> {
  const qs = buildQuery(params);
  const res = await apiFetch(`/api/projects?${qs}`);
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return res.json() as Promise<ListResponse>;
}

/** Distinct portfolio values for form autocomplete; server caps each array (see meta.limitPerField). */
export interface ProjectFieldSuggestions {
  parentProjectNames: string[];
  finalCustomers: string[];
  countries: string[];
  wholesaleCustomers: string[];
  meta: { limitPerField: number; note?: string };
}

export async function fetchProjectFieldSuggestions(): Promise<ProjectFieldSuggestions> {
  const res = await apiFetch("/api/projects/suggestions");
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return res.json() as Promise<ProjectFieldSuggestions>;
}

export async function fetchProject(id: number): Promise<Project> {
  const res = await apiFetch(`/api/projects/${id}`);
  if (!res.ok) throw new Error("Failed to load project");
  return res.json() as Promise<Project>;
}

export async function fetchActivityLog(projectId: number): Promise<ActivityLogEntry[]> {
  const res = await apiFetch(`/api/projects/${projectId}/activity`);
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const body = (await res.json()) as { data: ActivityLogEntry[] };
  return body.data;
}

export type ProjectWriteBody = Omit<Project, "id" | "createdAt" | "updatedAt"> & {
  markCustomerUpdated?: boolean;
  markCrmUpdated?: boolean;
};

function stripReadOnlyProjectFields(body: ProjectWriteBody): Record<string, unknown> {
  const {
    status: _s,
    lastCustomerUpdateAt: _lc,
    lastCrmUpdateAt: _lr,
    customerUpdateStale: _cs,
    crmUpdateStale: _cr,
    ...payload
  } = body;
  return payload;
}

export async function createProject(body: ProjectWriteBody): Promise<Project> {
  const payload = stripReadOnlyProjectFields(body);
  const res = await apiFetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return res.json() as Promise<Project>;
}

export async function updateProject(id: number, body: ProjectWriteBody): Promise<Project> {
  const payload = stripReadOnlyProjectFields(body);
  const res = await apiFetch(`/api/projects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return res.json() as Promise<Project>;
}

export type ProjectPatch = Partial<Omit<Project, "id" | "createdAt" | "updatedAt">> & {
  markCustomerUpdated?: boolean;
  markCrmUpdated?: boolean;
};

export async function patchProject(id: number, body: ProjectPatch): Promise<Project> {
  const { status: _s, lastCustomerUpdateAt: _lc, lastCrmUpdateAt: _lr, customerUpdateStale: _cs, crmUpdateStale: _cr, ...rest } =
    body;
  const res = await apiFetch(`/api/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rest),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return res.json() as Promise<Project>;
}

export async function deleteProject(id: number): Promise<void> {
  const res = await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res));
}

export async function patchProjectStatus(id: number, status: ProjectStatus): Promise<Project> {
  const res = await apiFetch(`/api/projects/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return res.json() as Promise<Project>;
}
