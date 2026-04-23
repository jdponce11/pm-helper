import {
  flexRender,
  getCoreRowModel,
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createProject,
  deleteProject,
  fetchProjects,
  patchProject,
  patchProjectStatus,
  updateProject,
  type ProjectPatch,
} from "../api";
import type { ActionFlag, ListMeta, Project } from "../types";
import { ACTION_FLAGS, ACTION_FLAGS_BY_PRIORITY } from "../types";
import { ActionFlagBadge } from "./ActionFlagBadge";
import { ActivityHistoryModal } from "./ActivityHistoryModal";
import { ProjectFormModal } from "./ProjectFormModal";
import { useModalBackdropDismiss } from "../useModalBackdropDismiss";
import {
  businessDaysOpenFromStart,
  grillTierFromBusinessDays,
} from "../businessDaysOpen";
import {
  datetimeLocalToIso,
  displayDeadline,
  isDateOnlyDeadline,
  isDeadlinePast,
  isoToDatetimeLocalValue,
} from "../nextStepDeadline";
import { formatExternalProjectId } from "../projectDisplay";

function trunc(s: string | null, n = 56): string {
  if (s == null || s === "") return "—";
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function BusinessDaysGrillCell(props: { project: Project }) {
  const bd = businessDaysOpenFromStart(props.project.startDate);
  if (bd === null) {
    return <span className="muted">—</span>;
  }
  const tier = grillTierFromBusinessDays(bd);
  const closed = props.project.status === "CLOSED";
  return (
    <span
      className={`bd-age bd-age--t${tier}${closed ? " bd-age--closed" : ""}`}
      title="Business days since project start (Mon–Fri, local calendar)"
      aria-label={`${bd} business days since project start`}
    >
      {bd} bd
    </span>
  );
}

function rowClassName(p: Project): string {
  const parts: string[] = [];
  if (p.status === "CLOSED") parts.push("row--closed");
  switch (p.actionFlag) {
    case "CRITICAL_BLOCKER":
      parts.push("row-flag--critical");
      break;
    case "ACTION_PENDING":
      parts.push("row-flag--pending");
      break;
    case "OPTIMIZATION_NEEDED":
      parts.push("row-flag--optimization");
      break;
    default:
      break;
  }
  if (isDeadlinePast(p.nextStepDeadline)) parts.push("row--deadline-past");
  return parts.join(" ");
}

type ToastState = { type: "success" | "error"; message: string } | null;

type InlineSaving = {
  id: number;
  field: "actionFlag" | "nextStepDeadline";
} | null;

function InlineActionFlagCell(props: {
  project: Project;
  saving: boolean;
  readOnly?: boolean;
  onSave: (id: number, patch: ProjectPatch) => Promise<void>;
}) {
  const { project, saving, readOnly, onSave } = props;
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setEditing(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  if (readOnly) {
    return <ActionFlagBadge value={project.actionFlag} />;
  }

  if (saving) {
    return <span className="inline-edit__saving">Saving…</span>;
  }

  if (editing) {
    return (
      <select
        className="inline-edit__control"
        autoFocus
        defaultValue={project.actionFlag}
        aria-label="Action flag"
        onChange={(e) => {
          const next = e.target.value as ActionFlag;
          setEditing(false);
          if (next === project.actionFlag) return;
          void onSave(project.id, { actionFlag: next });
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
      >
        {ACTION_FLAGS_BY_PRIORITY.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    );
  }

  return (
    <span
      className="inline-edit__hit"
      title="Double-click to edit"
      onDoubleClick={() => setEditing(true)}
    >
      <ActionFlagBadge value={project.actionFlag} />
    </span>
  );
}

function InlineDeadlineCell(props: {
  project: Project;
  saving: boolean;
  readOnly?: boolean;
  onSave: (id: number, patch: ProjectPatch) => Promise<void>;
}) {
  const { project, saving, readOnly, onSave } = props;
  const [editing, setEditing] = useState(false);
  const [draftDate, setDraftDate] = useState(() =>
    isDateOnlyDeadline(project.nextStepDeadline)
      ? project.nextStepDeadline
      : project.nextStepDeadline.slice(0, 10)
  );
  const [draftDatetimeLocal, setDraftDatetimeLocal] = useState(() =>
    isDateOnlyDeadline(project.nextStepDeadline)
      ? ""
      : isoToDatetimeLocalValue(project.nextStepDeadline)
  );

  useEffect(() => {
    if (isDateOnlyDeadline(project.nextStepDeadline)) {
      setDraftDate(project.nextStepDeadline);
      setDraftDatetimeLocal("");
    } else {
      setDraftDate(project.nextStepDeadline.slice(0, 10));
      setDraftDatetimeLocal(isoToDatetimeLocalValue(project.nextStepDeadline));
    }
  }, [project.nextStepDeadline, project.id]);

  useEffect(() => {
    if (!editing) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (isDateOnlyDeadline(project.nextStepDeadline)) {
          setDraftDate(project.nextStepDeadline);
          setDraftDatetimeLocal("");
        } else {
          setDraftDate(project.nextStepDeadline.slice(0, 10));
          setDraftDatetimeLocal(isoToDatetimeLocalValue(project.nextStepDeadline));
        }
        setEditing(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, project.nextStepDeadline]);

  function deadlinePayloadFromDrafts(): string {
    if (isDateOnlyDeadline(project.nextStepDeadline)) {
      return draftDate;
    }
    return datetimeLocalToIso(draftDatetimeLocal);
  }

  async function commit() {
    const next = deadlinePayloadFromDrafts();
    setEditing(false);
    if (next === project.nextStepDeadline) return;
    await onSave(project.id, { nextStepDeadline: next });
  }

  if (readOnly) {
    return <span>{displayDeadline(project.nextStepDeadline)}</span>;
  }

  if (saving) {
    return <span className="inline-edit__saving">Saving…</span>;
  }

  if (editing) {
    return isDateOnlyDeadline(project.nextStepDeadline) ? (
      <input
        className="inline-edit__control"
        type="date"
        autoFocus
        value={draftDate}
        aria-label="Next step deadline"
        onChange={(e) => setDraftDate(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          }
        }}
      />
    ) : (
      <input
        className="inline-edit__control"
        type="datetime-local"
        autoFocus
        value={draftDatetimeLocal}
        aria-label="Next step deadline"
        onChange={(e) => setDraftDatetimeLocal(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          }
        }}
      />
    );
  }

  return (
    <span
      className="inline-edit__hit"
      title="Double-click to edit"
      onDoubleClick={() => setEditing(true)}
    >
      {displayDeadline(project.nextStepDeadline)}
    </span>
  );
}

const defaultPageSize = 25;

function UpdateCadenceDots(props: { project: Project }) {
  const { project: p } = props;
  return (
    <span className="update-cadence-dots" aria-label="Update cadence status">
      <span
        className={`update-cadence-dot update-cadence-dot--customer${p.customerUpdateStale ? " update-cadence-dot--stale" : ""}`}
        title={
          p.customerUpdateStale
            ? "Customer status update is overdue (vs your threshold)"
            : "Customer status update is within threshold"
        }
      />
      <span
        className={`update-cadence-dot update-cadence-dot--crm${p.crmUpdateStale ? " update-cadence-dot--stale" : ""}`}
        title={
          p.crmUpdateStale
            ? "CRM delivery update is overdue (vs your threshold)"
            : "CRM delivery update is within threshold"
        }
      />
    </span>
  );
}

export function ProjectTable(props: {
  urgentOnly?: boolean;
  onUrgentOnlyChange?: (value: boolean) => void;
  onPortfolioChanged?: () => void;
  /** Bump after cadence settings change to refetch list with new staleness */
  listRefreshToken?: number;
}) {
  const {
    urgentOnly = false,
    onUrgentOnlyChange,
    onPortfolioChanged,
    listRefreshToken = 0,
  } = props;

  const [rows, setRows] = useState<Project[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [actionFlagFilter, setActionFlagFilter] = useState("");
  const [finalCustomerFilter, setFinalCustomerFilter] = useState("");
  const [wholesaleFilter, setWholesaleFilter] = useState("");

  const [sortByPriority, setSortByPriority] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  });
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [historyFor, setHistoryFor] = useState<Project | null>(null);

  const [statusTab, setStatusTab] = useState<"active" | "closed" | "all">("active");
  const [closeConfirm, setCloseConfirm] = useState<Project | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);

  const [toast, setToast] = useState<ToastState>(null);
  const [inlineSaving, setInlineSaving] = useState<InlineSaving>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchInput), 400);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [
    debouncedSearch,
    countryFilter,
    actionFlagFilter,
    finalCustomerFilter,
    wholesaleFilter,
    urgentOnly,
    statusTab,
  ]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const sortBy = sorting[0]?.id ?? "nextStepDeadline";
  const sortOrder: "asc" | "desc" = sorting[0]?.desc ? "desc" : "asc";

  const listStatus: "active" | "closed" | "all" = urgentOnly ? "active" : statusTab;

  const handleSortingChange: OnChangeFn<SortingState> = useCallback((updater) => {
    setSortByPriority(false);
    setSorting(updater);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchProjects({
        page: pagination.pageIndex + 1,
        limit: pagination.pageSize,
        ...(sortByPriority
          ? { sort: "priority" as const, sortBy: "nextStepDeadline", sortOrder: "asc" }
          : { sortBy, sortOrder }),
        search: debouncedSearch,
        country: countryFilter,
        actionFlag: actionFlagFilter,
        finalCustomer: finalCustomerFilter,
        wholesaleCustomer: wholesaleFilter,
        status: listStatus,
        urgentOnly,
      });
      setRows(res.data);
      setMeta(res.meta);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load");
      setRows([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [
    pagination.pageIndex,
    pagination.pageSize,
    sortByPriority,
    sortBy,
    sortOrder,
    debouncedSearch,
    countryFilter,
    actionFlagFilter,
    finalCustomerFilter,
    wholesaleFilter,
    urgentOnly,
    listStatus,
    listRefreshToken,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [sorting, sortByPriority]);

  const handlePatch = useCallback(
    async (id: number, patch: ProjectPatch, field: "actionFlag" | "nextStepDeadline") => {
      setInlineSaving({ id, field });
      try {
        await patchProject(id, patch);
        setToast({ type: "success", message: "Saved" });
        await load();
        onPortfolioChanged?.();
      } catch (e) {
        setToast({
          type: "error",
          message: e instanceof Error ? e.message : "Save failed",
        });
      } finally {
        setInlineSaving(null);
      }
    },
    [load, onPortfolioChanged]
  );

  const handleDelete = useCallback(
    async (p: Project) => {
      if (
        !window.confirm(
          `Delete project "${formatExternalProjectId(p.projectId)}"? This cannot be undone.`
        )
      ) {
        return;
      }
      try {
        await deleteProject(p.id);
        await load();
        onPortfolioChanged?.();
      } catch {
        window.alert("Delete failed");
      }
    },
    [load, onPortfolioChanged]
  );

  const dismissCloseConfirm = useCallback(() => {
    if (!statusSaving) setCloseConfirm(null);
  }, [statusSaving]);

  const closeConfirmBackdropDismiss = useModalBackdropDismiss(dismissCloseConfirm);

  const confirmCloseProject = useCallback(async () => {
    if (!closeConfirm) return;
    setStatusSaving(true);
    try {
      await patchProjectStatus(closeConfirm.id, "CLOSED");
      setCloseConfirm(null);
      setToast({ type: "success", message: "Project closed" });
      await load();
      onPortfolioChanged?.();
    } catch (e) {
      setToast({
        type: "error",
        message: e instanceof Error ? e.message : "Could not close project",
      });
    } finally {
      setStatusSaving(false);
    }
  }, [closeConfirm, load, onPortfolioChanged]);

  const handleReopen = useCallback(
    async (p: Project) => {
      setStatusSaving(true);
      try {
        await patchProjectStatus(p.id, "ACTIVE");
        setToast({ type: "success", message: "Project reopened" });
        await load();
        onPortfolioChanged?.();
      } catch (e) {
        setToast({
          type: "error",
          message: e instanceof Error ? e.message : "Could not reopen",
        });
      } finally {
        setStatusSaving(false);
      }
    },
    [load, onPortfolioChanged]
  );

  const columns = useMemo<ColumnDef<Project>[]>(
    () => [
      {
        accessorKey: "parentProjectName",
        header: "Parent project",
        cell: (info) => {
          const v = info.getValue<string>().trim();
          return v.length > 0 ? v : "—";
        },
      },
      {
        accessorKey: "finalCustomer",
        header: "Final customer",
        cell: (info) => info.getValue<string>(),
      },
      {
        accessorKey: "country",
        header: "Country",
        cell: (info) => info.getValue<string>(),
      },
      {
        accessorKey: "startDate",
        header: "Start date",
        cell: (info) => info.getValue<string>(),
      },
      {
        id: "businessDaysOpen",
        header: () => (
          <abbr title="Business days open (Mon–Fri) since start date">Open (bd)</abbr>
        ),
        cell: ({ row }) => <BusinessDaysGrillCell project={row.original} />,
        enableSorting: false,
      },
      {
        accessorKey: "projectId",
        header: "Project ID",
        cell: (info) => (
          <span className={`mono${info.getValue<string | null>() ? "" : " muted"}`}>
            {formatExternalProjectId(info.getValue<string | null>())}
          </span>
        ),
      },
      {
        accessorKey: "latestUpdate",
        header: "Latest update",
        cell: (info) => (
          <span title={info.getValue<string>() ?? ""}>
            {trunc(info.getValue<string | null>())}
          </span>
        ),
      },
      {
        accessorKey: "nextAction",
        header: "Next action",
        cell: (info) => (
          <span title={info.getValue<string>() ?? ""}>
            {trunc(info.getValue<string | null>())}
          </span>
        ),
      },
      {
        accessorKey: "nextStepDeadline",
        header: "Next step deadline",
        cell: ({ row }) => (
          <InlineDeadlineCell
            project={row.original}
            readOnly={row.original.status === "CLOSED"}
            saving={
              inlineSaving?.id === row.original.id &&
              inlineSaving.field === "nextStepDeadline"
            }
            onSave={(id, patch) => handlePatch(id, patch, "nextStepDeadline")}
          />
        ),
      },
      {
        accessorKey: "wholesaleCustomer",
        header: "Wholesale customer",
        cell: (info) => info.getValue<string>(),
      },
      {
        accessorKey: "actionFlag",
        header: "Action flag",
        cell: ({ row }) => (
          <div className="flag-cell">
            <UpdateCadenceDots project={row.original} />
            <InlineActionFlagCell
              project={row.original}
              readOnly={row.original.status === "CLOSED"}
              saving={
                inlineSaving?.id === row.original.id &&
                inlineSaving.field === "actionFlag"
              }
              onSave={(id, patch) => handlePatch(id, patch, "actionFlag")}
            />
          </div>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const p = row.original;
          const closed = p.status === "CLOSED";
          return (
            <div className="row-actions">
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() => setHistoryFor(p)}
              >
                History
              </button>
              {!closed ? (
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  onClick={() => {
                    setFormMode("edit");
                    setEditProject(p);
                    setFormOpen(true);
                  }}
                >
                  Edit
                </button>
              ) : null}
              {!closed ? (
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  title="Mark as closed"
                  aria-label="Close project"
                  disabled={statusSaving}
                  onClick={() => setCloseConfirm(p)}
                >
                  Close
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  title="Reopen project"
                  aria-label="Reopen project"
                  disabled={statusSaving}
                  onClick={() => void handleReopen(p)}
                >
                  Reopen
                </button>
              )}
              <button
                type="button"
                className="btn btn--small btn--danger"
                onClick={() => void handleDelete(p)}
              >
                Delete
              </button>
            </div>
          );
        },
        enableSorting: false,
        enableHiding: false,
      },
    ],
    [handleDelete, handlePatch, handleReopen, inlineSaving, statusSaving]
  );

  const table = useReactTable({
    data: rows,
    columns,
    pageCount: meta?.totalPages ?? -1,
    state: {
      sorting,
      pagination,
      columnVisibility,
    },
    manualPagination: true,
    manualSorting: true,
    onSortingChange: handleSortingChange,
    onPaginationChange: setPagination,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  });

  const total = meta?.total ?? 0;

  return (
    <div className="project-table-wrap">
      {toast ? (
        <div
          className={`toast toast--${toast.type}`}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      ) : null}

      <div className="toolbar">
        {urgentOnly ? (
          <div className="toolbar__urgent-banner" role="status">
            <span>Due today, needs attention (not passive)</span>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => onUrgentOnlyChange?.(false)}
            >
              Show all projects
            </button>
          </div>
        ) : null}
        {!urgentOnly ? (
          <div className="toolbar__row toolbar__row--tabs">
            <div className="toolbar__tabs" role="tablist" aria-label="Project status">
              {(["active", "closed", "all"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  className={`toolbar__tab${statusTab === tab ? " toolbar__tab--active" : ""}`}
                  aria-selected={statusTab === tab}
                  onClick={() => setStatusTab(tab)}
                >
                  {tab === "active" ? "Active" : tab === "closed" ? "Closed" : "All"}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="toolbar__row">
          <label className="toolbar__search">
            <span className="sr-only">Search</span>
            <input
              type="search"
              placeholder="Search all text fields…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Global search"
            />
          </label>
          {!sortByPriority ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setSortByPriority(true);
                setSorting([]);
                setPagination((p) => ({ ...p, pageIndex: 0 }));
              }}
            >
              Sort by priority
            </button>
          ) : (
            <span className="toolbar__sort-hint">
              Sorted by action flag priority, then deadline, then start date (older first)
            </span>
          )}
          {urgentOnly || statusTab !== "closed" ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setFormMode("create");
                setEditProject(null);
                setFormOpen(true);
              }}
            >
              New project
            </button>
          ) : null}
        </div>
        <div className="toolbar__row toolbar__filters">
          <input
            placeholder="Filter country"
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
            aria-label="Filter by country"
          />
          <select
            value={actionFlagFilter}
            onChange={(e) => setActionFlagFilter(e.target.value)}
            aria-label="Filter by action flag"
          >
            <option value="">All action flags</option>
            {ACTION_FLAGS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <input
            placeholder="Filter final customer"
            value={finalCustomerFilter}
            onChange={(e) => setFinalCustomerFilter(e.target.value)}
            aria-label="Filter by final customer"
          />
          <input
            placeholder="Filter wholesale customer"
            value={wholesaleFilter}
            onChange={(e) => setWholesaleFilter(e.target.value)}
            aria-label="Filter by wholesale customer"
          />
        </div>
        <div className="toolbar__row toolbar__columns">
          <span className="toolbar__label">Columns</span>
          {table.getAllLeafColumns().map((col) => {
            if (col.id === "actions") return null;
            return (
              <label key={col.id} className="toggle">
                <input
                  type="checkbox"
                  checked={col.getIsVisible()}
                  onChange={col.getToggleVisibilityHandler()}
                />
                {typeof col.columnDef.header === "string"
                  ? col.columnDef.header
                  : col.id}
              </label>
            );
          })}
        </div>
      </div>

      {loadError ? (
        <p className="banner banner--error" role="alert">
          {loadError}
        </p>
      ) : null}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id}>
                    {h.isPlaceholder ? null : (
                      <button
                        type="button"
                        className={
                          h.column.getCanSort()
                            ? "th-sort"
                            : "th-sort th-sort--static"
                        }
                        onClick={h.column.getToggleSortingHandler()}
                        disabled={!h.column.getCanSort()}
                      >
                        {flexRender(
                          h.column.columnDef.header,
                          h.getContext()
                        )}
                        {h.column.getIsSorted() === "asc"
                          ? " ▲"
                          : h.column.getIsSorted() === "desc"
                            ? " ▼"
                            : ""}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={table.getVisibleLeafColumns().length}
                  className="muted"
                >
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={table.getVisibleLeafColumns().length}
                  className="muted"
                >
                  No projects match your filters.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className={rowClassName(row.original)}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <div className="pager__info">
          {total === 0
            ? "No rows"
            : `Showing ${pagination.pageIndex * pagination.pageSize + 1}–${Math.min(
                (pagination.pageIndex + 1) * pagination.pageSize,
                total
              )} of ${total}`}
        </div>
        <div className="pager__controls">
          <label>
            Rows per page
            <select
              value={pagination.pageSize}
              onChange={(e) =>
                setPagination({
                  pageIndex: 0,
                  pageSize: Number(e.target.value),
                })
              }
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() =>
              setPagination((p) => ({ ...p, pageIndex: Math.max(0, p.pageIndex - 1) }))
            }
            disabled={pagination.pageIndex <= 0 || loading}
          >
            Previous
          </button>
          <span className="pager__page">
            Page {pagination.pageIndex + 1}
            {meta ? ` / ${meta.totalPages}` : ""}
          </span>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() =>
              setPagination((p) => ({
                ...p,
                pageIndex:
                  meta && p.pageIndex < meta.totalPages - 1
                    ? p.pageIndex + 1
                    : p.pageIndex,
              }))
            }
            disabled={
              loading ||
              !meta ||
              pagination.pageIndex >= meta.totalPages - 1
            }
          >
            Next
          </button>
        </div>
      </div>

      <ProjectFormModal
        open={formOpen}
        mode={formMode}
        initial={editProject}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          void load().then(() => onPortfolioChanged?.());
        }}
        createProject={createProject}
        updateProject={updateProject}
      />

      {closeConfirm ? (
        <div
          className="modal-backdrop"
          role="presentation"
          {...closeConfirmBackdropDismiss}
        >
          <div
            className="modal modal--narrow"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-project-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal__header">
              <h2 id="close-project-title">Mark project as closed?</h2>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={statusSaving}
                onClick={() => setCloseConfirm(null)}
              >
                Dismiss
              </button>
            </header>
            <div className="modal__body">
              <p>
                Mark{" "}
                <strong className="mono">{formatExternalProjectId(closeConfirm.projectId)}</strong>{" "}
                as closed?
                It will be removed from the active dashboard.
              </p>
            </div>
            <footer className="modal__footer">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={statusSaving}
                onClick={() => setCloseConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={statusSaving}
                onClick={() => void confirmCloseProject()}
              >
                {statusSaving ? "Closing…" : "Close project"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      <ActivityHistoryModal
        open={historyFor !== null}
        project={historyFor}
        onClose={() => setHistoryFor(null)}
      />
    </div>
  );
}
