import type { PoolClient } from "pg";
import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import {
  appendUrgentConditions,
  queryStaleUpdateProjects,
  queryUrgentProjects,
} from "../urgentQuery.js";
import { fetchProjectStaleBusinessDayCounts, fetchUserReminderThreshold } from "../projectStaleCounts.js";
import {
  nextStepDeadlineFieldSchema,
  resolveNextStepDeadlineForDb,
} from "../nextStepDeadline.js";
import { getUrgencyTimezone } from "../urgencyTimezone.js";
import type { ActionFlag, ActivityLogRow, ProjectRow, ProjectStatus } from "../types.js";
import { activityLogRowToJson, rowToJson } from "../types.js";

const actionFlagSchema = z.enum([
  "PASSIVE_MONITOR",
  "OPTIMIZATION_NEEDED",
  "ACTION_PENDING",
  "CRITICAL_BLOCKER",
]);

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date YYYY-MM-DD");

const trimmedParentProjectName = z.string().transform((s) => s.trim());

const trimmedExternalProjectId = z.preprocess(
  (v) => (v === undefined || v === null ? "" : v),
  z
    .string()
    .transform((s) => s.trim())
    .transform((s) => (s.length === 0 ? null : s))
);

const projectBodySchema = z.object({
  parentProjectName: trimmedParentProjectName,
  finalCustomer: z.string().min(1),
  country: z.string().min(1),
  startDate: dateString,
  projectId: trimmedExternalProjectId,
  latestUpdate: z.string().nullable().optional(),
  nextAction: z.string().nullable().optional(),
  nextStepDeadline: nextStepDeadlineFieldSchema,
  wholesaleCustomer: z.string().min(1),
  actionFlag: actionFlagSchema,
  markCustomerUpdated: z.boolean().optional(),
  markCrmUpdated: z.boolean().optional(),
});

const patchBodySchema = projectBodySchema.partial().refine(
  (obj) => {
    const keys = Object.keys(obj);
    if (keys.length === 0) return false;
    if (obj.markCustomerUpdated === true || obj.markCrmUpdated === true) return true;
    return keys.some((k) => k !== "markCustomerUpdated" && k !== "markCrmUpdated");
  },
  { message: "At least one field is required" }
);

const sortColumns = [
  "parent_project_name",
  "final_customer",
  "country",
  "start_date",
  "project_id",
  "latest_update",
  "next_action",
  "next_step_deadline",
  "wholesale_customer",
  "action_flag",
  "status",
  "id",
  "created_at",
  "updated_at",
] as const;

type SortColumn = (typeof sortColumns)[number];

function parseSortColumn(raw: string | undefined): SortColumn {
  if (!raw) return "next_step_deadline";
  const aliases: Record<string, SortColumn> = {
    parentProjectName: "parent_project_name",
    finalCustomer: "final_customer",
    country: "country",
    startDate: "start_date",
    projectId: "project_id",
    latestUpdate: "latest_update",
    nextAction: "next_action",
    nextStepDeadline: "next_step_deadline",
    wholesaleCustomer: "wholesale_customer",
    actionFlag: "action_flag",
    status: "status",
    id: "id",
    createdAt: "created_at",
    updatedAt: "updated_at",
    parent_project_name: "parent_project_name",
    final_customer: "final_customer",
    start_date: "start_date",
    project_id: "project_id",
    latest_update: "latest_update",
    next_action: "next_action",
    next_step_deadline: "next_step_deadline",
    wholesale_customer: "wholesale_customer",
    action_flag: "action_flag",
    created_at: "created_at",
    updated_at: "updated_at",
  };
  if (aliases[raw]) return aliases[raw];
  if ((sortColumns as readonly string[]).includes(raw)) return raw as SortColumn;
  return "next_step_deadline";
}

/** Trimmed comparison for “latest update” overwrite detection */
function normalizeLatestUpdate(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/**
 * Archive the previous note when it had content and the new value differs (after trim).
 */
function shouldArchiveOverwrittenLatestUpdate(
  current: string | null,
  incoming: string | null
): boolean {
  const oldN = normalizeLatestUpdate(current);
  const newN = normalizeLatestUpdate(incoming ?? null);
  return oldN !== newN && oldN !== "";
}

async function insertLatestUpdateArchive(
  client: PoolClient,
  projectId: number,
  actionFlagSnapshot: ActionFlag,
  note: string
): Promise<void> {
  await client.query(
    `INSERT INTO activity_log (project_id, action_flag_snapshot, note, created_by)
     VALUES ($1, $2::action_flag_enum, $3, 'system')`,
    [projectId, actionFlagSnapshot, note]
  );
}

async function insertUserActivityLog(
  client: PoolClient,
  projectId: number,
  actionFlagSnapshot: ActionFlag,
  note: string,
  createdBy: string
): Promise<void> {
  await client.query(
    `INSERT INTO activity_log (project_id, action_flag_snapshot, note, created_by)
     VALUES ($1, $2::action_flag_enum, $3, $4)`,
    [projectId, actionFlagSnapshot, note, createdBy]
  );
}

export const projectsRouter = Router();

function ownerId(req: Request): number {
  return req.user!.id;
}

projectsRouter.post("/", async (req, res) => {
  const parsed = projectBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  const markCustomer = b.markCustomerUpdated === true;
  const markCrm = b.markCrmUpdated === true;
  const createdBy = req.user!.email;
  try {
    const deadline = await resolveNextStepDeadlineForDb(pool, b.nextStepDeadline);
    const client = await pool.connect();
    let inserted: ProjectRow;
    try {
      await client.query("BEGIN");
      const rows = await client.query<ProjectRow>(
        `INSERT INTO projects (
          owner_id,
          parent_project_name, final_customer, country, start_date, project_id,
          latest_update, next_action, next_step_deadline, next_step_deadline_has_time,
          wholesale_customer, action_flag,
          last_customer_update_at, last_crm_update_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::action_flag_enum,
          CASE WHEN $13 THEN NOW() ELSE NULL END,
          CASE WHEN $14 THEN NOW() ELSE NULL END
        )
        RETURNING *`,
        [
          ownerId(req),
          b.parentProjectName,
          b.finalCustomer,
          b.country,
          b.startDate,
          b.projectId,
          b.latestUpdate ?? null,
          b.nextAction ?? null,
          deadline.ts,
          deadline.includesTime,
          b.wholesaleCustomer,
          b.actionFlag as ActionFlag,
          markCustomer,
          markCrm,
        ]
      );
      inserted = rows.rows[0];
      if (markCustomer) {
        await insertUserActivityLog(
          client,
          inserted.id,
          inserted.action_flag,
          "Customer update sent",
          createdBy
        );
      }
      if (markCrm) {
        await insertUserActivityLog(
          client,
          inserted.id,
          inserted.action_flag,
          "CRM delivery system updated",
          createdBy
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }
    const th = await fetchUserReminderThreshold(pool, ownerId(req));
    const staleMap = await fetchProjectStaleBusinessDayCounts(pool, [inserted.id]);
    const c = staleMap.get(inserted.id) ?? { customer: 0, crm: 0 };
    res.status(201).json(rowToJson(inserted, { ...c, reminderThreshold: th }));
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === "23505") {
      res.status(409).json({ error: "projectId must be unique" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Failed to create project" });
  }
});

projectsRouter.get("/", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const sortPriority = req.query.sort === "priority";
  const sortBy = parseSortColumn(
    typeof req.query.sortBy === "string" ? req.query.sortBy : undefined
  );
  const sortOrder =
    String(req.query.sortOrder).toLowerCase() === "desc" ? "DESC" : "ASC";
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";

  const country =
    typeof req.query.country === "string" ? req.query.country.trim() : "";
  const finalCustomer =
    typeof req.query.finalCustomer === "string"
      ? req.query.finalCustomer.trim()
      : "";
  const wholesaleCustomer =
    typeof req.query.wholesaleCustomer === "string"
      ? req.query.wholesaleCustomer.trim()
      : "";
  let actionFlag: ActionFlag | "" = "";
  if (typeof req.query.actionFlag === "string" && req.query.actionFlag) {
    const af = actionFlagSchema.safeParse(req.query.actionFlag);
    if (af.success) actionFlag = af.data;
    else {
      res.status(400).json({ error: "Invalid actionFlag filter" });
      return;
    }
  }

  const conditions: string[] = ["owner_id = $1"];
  const params: unknown[] = [ownerId(req)];
  let p = 2;

  if (search) {
    conditions.push(`(
      parent_project_name ILIKE $${p} OR final_customer ILIKE $${p} OR country ILIKE $${p}
      OR (project_id IS NOT NULL AND project_id ILIKE $${p}) OR COALESCE(latest_update, '') ILIKE $${p}
      OR COALESCE(next_action, '') ILIKE $${p} OR wholesale_customer ILIKE $${p}
    )`);
    params.push(`%${search}%`);
    p++;
  }
  if (country) {
    conditions.push(`country ILIKE $${p}`);
    params.push(`%${country}%`);
    p++;
  }
  if (finalCustomer) {
    conditions.push(`final_customer ILIKE $${p}`);
    params.push(`%${finalCustomer}%`);
    p++;
  }
  if (wholesaleCustomer) {
    conditions.push(`wholesale_customer ILIKE $${p}`);
    params.push(`%${wholesaleCustomer}%`);
    p++;
  }
  if (actionFlag) {
    conditions.push(`action_flag = $${p}::action_flag_enum`);
    params.push(actionFlag);
    p++;
  }

  const statusRaw =
    typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "active";
  if (!["active", "closed", "all"].includes(statusRaw)) {
    res.status(400).json({ error: "Invalid status filter; use active, closed, or all" });
    return;
  }
  if (statusRaw === "active") {
    conditions.push(`status = 'ACTIVE'::project_status_enum`);
  } else if (statusRaw === "closed") {
    conditions.push(`status = 'CLOSED'::project_status_enum`);
  }

  const urgentOnly =
    req.query.urgentOnly === "true" || req.query.urgentOnly === "1";

  try {
    const reminderThreshold = await fetchUserReminderThreshold(pool, ownerId(req));
    if (urgentOnly) {
      p = appendUrgentConditions(conditions, params, p, reminderThreshold);
    }
    const whereSql = conditions.join(" AND ");
    const countResult = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM projects WHERE ${whereSql}`,
      params
    );
    const total = Number(countResult.rows[0]?.c ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const listParams = [...params, limit, offset];
    const limitIdx = p;
    const offsetIdx = p + 1;

    const orderSql = sortPriority
      ? `ORDER BY
          CASE action_flag::text
            WHEN 'CRITICAL_BLOCKER' THEN 0
            WHEN 'ACTION_PENDING' THEN 1
            WHEN 'OPTIMIZATION_NEEDED' THEN 2
            WHEN 'PASSIVE_MONITOR' THEN 3
          END ASC,
          next_step_deadline ASC NULLS LAST,
          start_date ASC`
      : `ORDER BY ${sortBy} ${sortOrder} NULLS LAST`;

    const dataResult = await pool.query<ProjectRow>(
      `SELECT * FROM projects WHERE ${whereSql}
       ${orderSql}
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams
    );

    const staleMap = await fetchProjectStaleBusinessDayCounts(
      pool,
      dataResult.rows.map((r) => r.id)
    );

    res.json({
      data: dataResult.rows.map((row) => {
        const c = staleMap.get(row.id) ?? { customer: 0, crm: 0 };
        return rowToJson(row, { ...c, reminderThreshold });
      }),
      meta: {
        total,
        page,
        limit,
        totalPages,
        sort: sortPriority ? "priority" : undefined,
        sortBy: sortPriority ? "priority" : sortBy,
        sortOrder: sortPriority ? "asc" : sortOrder.toLowerCase(),
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to list projects" });
  }
});

projectsRouter.get("/urgent", async (req, res) => {
  try {
    const reminderThreshold = await fetchUserReminderThreshold(pool, ownerId(req));
    const rows = await queryUrgentProjects(pool, ownerId(req), reminderThreshold);
    const staleMap = await fetchProjectStaleBusinessDayCounts(
      pool,
      rows.map((r) => r.id)
    );
    const data = rows.map((row) => {
      const c = staleMap.get(row.id) ?? { customer: 0, crm: 0 };
      return rowToJson(row, { ...c, reminderThreshold });
    });
    res.json({ count: data.length, data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load urgent projects" });
  }
});

projectsRouter.get("/reminders", async (req, res) => {
  try {
    const reminderThreshold = await fetchUserReminderThreshold(pool, ownerId(req));
    const { customerStale, crmStale } = await queryStaleUpdateProjects(
      pool,
      ownerId(req),
      reminderThreshold
    );
    const ids = [...new Set([...customerStale, ...crmStale].map((r) => r.id))];
    const staleMap = await fetchProjectStaleBusinessDayCounts(pool, ids);
    const pack = (row: ProjectRow) => {
      const c = staleMap.get(row.id) ?? { customer: 0, crm: 0 };
      return rowToJson(row, { ...c, reminderThreshold });
    };
    res.json({
      urgencyTimezone: getUrgencyTimezone(),
      customerStale: { count: customerStale.length, data: customerStale.map(pack) },
      crmStale: { count: crmStale.length, data: crmStale.map(pack) },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load update reminders" });
  }
});

/** Distinct trimmed text values per field, deduped case-insensitively (canonical = MIN trim). */
const SUGGESTIONS_PER_FIELD = 400;

projectsRouter.get("/suggestions", async (req, res) => {
  const oid = ownerId(req);
  const baseWhere = `owner_id = $1 AND LENGTH(TRIM($col)) > 0`;
  const sql = (col: string) =>
    `SELECT MIN(TRIM(${col})) AS v
     FROM projects
     WHERE ${baseWhere.replace("$col", col)}
     GROUP BY LOWER(TRIM(${col}))
     ORDER BY LOWER(MIN(TRIM(${col}))) ASC
     LIMIT ${SUGGESTIONS_PER_FIELD}`;

  try {
    const [parents, finals, countries, wholesale] = await Promise.all([
      pool.query<{ v: string }>(sql("parent_project_name"), [oid]),
      pool.query<{ v: string }>(sql("final_customer"), [oid]),
      pool.query<{ v: string }>(sql("country"), [oid]),
      pool.query<{ v: string }>(sql("wholesale_customer"), [oid]),
    ]);

    res.json({
      parentProjectNames: parents.rows.map((r) => r.v),
      finalCustomers: finals.rows.map((r) => r.v),
      countries: countries.rows.map((r) => r.v),
      wholesaleCustomers: wholesale.rows.map((r) => r.v),
      meta: {
        limitPerField: SUGGESTIONS_PER_FIELD,
        note:
          "Distinct non-empty trimmed values from your projects; capped per field. Client may filter while typing.",
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load field suggestions" });
  }
});

const setStatusBodySchema = z.object({
  status: z.enum(["ACTIVE", "CLOSED"]),
});

projectsRouter.patch("/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = setStatusBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }
  const nextStatus: ProjectStatus = parsed.data.status;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query<ProjectRow>(
      "SELECT * FROM projects WHERE id = $1 AND owner_id = $2 FOR UPDATE",
      [id, ownerId(req)]
    );
    if ((lock.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Not found" });
      return;
    }
    const current = lock.rows[0];
    if (current.status === nextStatus) {
      await client.query("COMMIT");
      const reminderThreshold = await fetchUserReminderThreshold(pool, ownerId(req));
      const staleMap = await fetchProjectStaleBusinessDayCounts(pool, [current.id]);
      const c = staleMap.get(current.id) ?? { customer: 0, crm: 0 };
      res.json(rowToJson(current, { ...c, reminderThreshold }));
      return;
    }

    const result = await client.query<ProjectRow>(
      `UPDATE projects SET status = $1::project_status_enum WHERE id = $2 RETURNING *`,
      [nextStatus, id]
    );
    const updated = result.rows[0];

    if (current.status === "ACTIVE" && nextStatus === "CLOSED") {
      await insertLatestUpdateArchive(
        client,
        id,
        current.action_flag,
        "Project marked as closed."
      );
    } else if (current.status === "CLOSED" && nextStatus === "ACTIVE") {
      await insertLatestUpdateArchive(
        client,
        id,
        current.action_flag,
        "Project reopened."
      );
    }

    await client.query("COMMIT");
    const reminderThreshold = await fetchUserReminderThreshold(pool, ownerId(req));
    const staleMap = await fetchProjectStaleBusinessDayCounts(pool, [updated.id]);
    const c = staleMap.get(updated.id) ?? { customer: 0, crm: 0 };
    res.json(rowToJson(updated, { ...c, reminderThreshold }));
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.error(e);
    res.status(500).json({ error: "Failed to update status" });
  } finally {
    client.release();
  }
});

projectsRouter.get("/:id/activity", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const exists = await pool.query(
      "SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2",
      [id, ownerId(req)]
    );
    if ((exists.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const result = await pool.query<ActivityLogRow>(
      `SELECT id, project_id, timestamp, action_flag_snapshot, note, created_by
       FROM activity_log
       WHERE project_id = $1
       ORDER BY timestamp DESC`,
      [id]
    );
    res.json({ data: result.rows.map(activityLogRowToJson) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load activity log" });
  }
});

projectsRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const result = await pool.query<ProjectRow>(
      "SELECT * FROM projects WHERE id = $1 AND owner_id = $2",
      [id, ownerId(req)]
    );
    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const row = result.rows[0];
    const reminderThreshold = await fetchUserReminderThreshold(pool, ownerId(req));
    const staleMap = await fetchProjectStaleBusinessDayCounts(pool, [row.id]);
    const c = staleMap.get(row.id) ?? { customer: 0, crm: 0 };
    res.json(rowToJson(row, { ...c, reminderThreshold }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load project" });
  }
});

projectsRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = patchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;

  let resolvedDeadline: Awaited<ReturnType<typeof resolveNextStepDeadlineForDb>> | undefined;
  if (b.nextStepDeadline !== undefined) {
    resolvedDeadline = await resolveNextStepDeadlineForDb(pool, b.nextStepDeadline);
  }

  const assignments: string[] = [];
  const values: unknown[] = [];
  let n = 1;

  function push(fieldSql: string, val: unknown) {
    assignments.push(`${fieldSql} = $${n}`);
    values.push(val);
    n++;
  }

  if (b.parentProjectName !== undefined) push("parent_project_name", b.parentProjectName);
  if (b.finalCustomer !== undefined) push("final_customer", b.finalCustomer);
  if (b.country !== undefined) push("country", b.country);
  if (b.startDate !== undefined) push("start_date", b.startDate);
  if (b.projectId !== undefined) push("project_id", b.projectId);
  if (b.latestUpdate !== undefined) push("latest_update", b.latestUpdate);
  if (b.nextAction !== undefined) push("next_action", b.nextAction);
  if (resolvedDeadline !== undefined) {
    push("next_step_deadline", resolvedDeadline.ts);
    push("next_step_deadline_has_time", resolvedDeadline.includesTime);
  }
  if (b.wholesaleCustomer !== undefined) push("wholesale_customer", b.wholesaleCustomer);
  if (b.actionFlag !== undefined) {
    assignments.push(`action_flag = $${n}::action_flag_enum`);
    values.push(b.actionFlag);
    n++;
  }

  if (b.markCustomerUpdated === true) {
    assignments.push(`last_customer_update_at = NOW()`);
  }
  if (b.markCrmUpdated === true) {
    assignments.push(`last_crm_update_at = NOW()`);
  }

  if (assignments.length === 0) {
    res.status(400).json({ error: "At least one field is required" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query<ProjectRow>(
      "SELECT * FROM projects WHERE id = $1 AND owner_id = $2 FOR UPDATE",
      [id, ownerId(req)]
    );
    if ((lock.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Not found" });
      return;
    }
    const current = lock.rows[0];

    if (current.status === "CLOSED") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Project is closed; reopen to edit" });
      return;
    }

    if (
      b.latestUpdate !== undefined &&
      shouldArchiveOverwrittenLatestUpdate(current.latest_update, b.latestUpdate)
    ) {
      await insertLatestUpdateArchive(
        client,
        id,
        current.action_flag,
        current.latest_update ?? ""
      );
    }

    values.push(id);
    const idParam = n;

    const result = await client.query<ProjectRow>(
      `UPDATE projects SET ${assignments.join(", ")}
       WHERE id = $${idParam}
       RETURNING *`,
      values
    );
    const updated = result.rows[0];
    const createdBy = req.user!.email;
    if (b.markCustomerUpdated === true) {
      await insertUserActivityLog(
        client,
        id,
        updated.action_flag,
        "Customer update sent",
        createdBy
      );
    }
    if (b.markCrmUpdated === true) {
      await insertUserActivityLog(
        client,
        id,
        updated.action_flag,
        "CRM delivery system updated",
        createdBy
      );
    }
    await client.query("COMMIT");
    const reminderThreshold = await fetchUserReminderThreshold(pool, ownerId(req));
    const staleMap = await fetchProjectStaleBusinessDayCounts(pool, [updated.id]);
    const c = staleMap.get(updated.id) ?? { customer: 0, crm: 0 };
    res.json(rowToJson(updated, { ...c, reminderThreshold }));
  } catch (e: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const err = e as { code?: string };
    if (err.code === "23505") {
      res.status(409).json({ error: "projectId must be unique" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Failed to update project" });
  } finally {
    client.release();
  }
});

projectsRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = projectBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  const markCustomer = b.markCustomerUpdated === true;
  const markCrm = b.markCrmUpdated === true;
  const newLatest = b.latestUpdate ?? null;
  const deadline = await resolveNextStepDeadlineForDb(pool, b.nextStepDeadline);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query<ProjectRow>(
      "SELECT * FROM projects WHERE id = $1 AND owner_id = $2 FOR UPDATE",
      [id, ownerId(req)]
    );
    if ((lock.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Not found" });
      return;
    }
    const current = lock.rows[0];

    if (current.status === "CLOSED") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Project is closed; reopen to edit" });
      return;
    }

    if (shouldArchiveOverwrittenLatestUpdate(current.latest_update, newLatest)) {
      await insertLatestUpdateArchive(
        client,
        id,
        current.action_flag,
        current.latest_update ?? ""
      );
    }

    const result = await client.query<ProjectRow>(
      `UPDATE projects SET
        parent_project_name = $1,
        final_customer = $2,
        country = $3,
        start_date = $4,
        project_id = $5,
        latest_update = $6,
        next_action = $7,
        next_step_deadline = $8,
        next_step_deadline_has_time = $9,
        wholesale_customer = $10,
        action_flag = $11::action_flag_enum,
        last_customer_update_at = CASE WHEN $12 THEN NOW() ELSE last_customer_update_at END,
        last_crm_update_at = CASE WHEN $13 THEN NOW() ELSE last_crm_update_at END
      WHERE id = $14
      RETURNING *`,
      [
        b.parentProjectName,
        b.finalCustomer,
        b.country,
        b.startDate,
        b.projectId,
        newLatest,
        b.nextAction ?? null,
        deadline.ts,
        deadline.includesTime,
        b.wholesaleCustomer,
        b.actionFlag as ActionFlag,
        markCustomer,
        markCrm,
        id,
      ]
    );
    const updated = result.rows[0];
    const createdBy = req.user!.email;
    if (markCustomer) {
      await insertUserActivityLog(
        client,
        id,
        updated.action_flag,
        "Customer update sent",
        createdBy
      );
    }
    if (markCrm) {
      await insertUserActivityLog(
        client,
        id,
        updated.action_flag,
        "CRM delivery system updated",
        createdBy
      );
    }
    await client.query("COMMIT");
    const reminderThreshold = await fetchUserReminderThreshold(pool, ownerId(req));
    const staleMap = await fetchProjectStaleBusinessDayCounts(pool, [updated.id]);
    const c = staleMap.get(updated.id) ?? { customer: 0, crm: 0 };
    res.json(rowToJson(updated, { ...c, reminderThreshold }));
  } catch (e: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const err = e as { code?: string };
    if (err.code === "23505") {
      res.status(409).json({ error: "projectId must be unique" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Failed to update project" });
  } finally {
    client.release();
  }
});

projectsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const result = await pool.query("DELETE FROM projects WHERE id = $1 AND owner_id = $2", [
      id,
      ownerId(req),
    ]);
    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete project" });
  }
});
