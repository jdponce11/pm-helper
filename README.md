# PM Helper — Phase 1 (Foundation & CRUD)

Container-ready stack: **PostgreSQL 15** (Compose), **Express** REST API, **React + TypeScript** UI with **TanStack Table** for the project grid.

## Quick start (Docker)

Configuration is driven by a **`.env` file in the project root** (not committed). Copy the example and adjust database credentials:

```bash
cd /path/to/pm-helper
cp .env.example .env
```

**Build and run everything (foreground, logs in the terminal):**

```bash
docker compose up --build
```

If your system requires root for the Docker socket:

```bash
sudo docker compose up --build
```

**Run in the background:**

```bash
docker compose up --build -d
```

**Stop and remove containers and networks** (Postgres data in the `postgres_data` named volume is kept):

```bash
docker compose down
```

**Same, but delete volumes** (wipes the database—only when you want a fresh DB):

```bash
docker compose down -v
```

**URLs**

- **Web UI:** http://localhost (Nginx serves the SPA and proxies `/api` to the backend)
- **API (direct):** http://localhost:5000 (default host port; override with `BACKEND_PORT` in `.env`; CORS enabled)
- **PostgreSQL:** `localhost:5432` — user, password, and database name come from `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in `.env`

First boot applies `db/init.sql` to an empty data volume. Rebuilds can leave **untagged** old images until you prune (see below).

### Docker: reclaim disk space after many rebuilds

Rebuilds leave **untagged** old images and **build cache** on disk. Safe cleanup when containers are stopped:

```bash
# Remove dangling images (old layers no longer tagged)
docker image prune -f

# Remove build cache (BuildKit / legacy builder)
docker builder prune -f
```

More aggressive (removes unused images, not just dangling—**read the prompt carefully**):

```bash
docker system prune -f
```

To also remove unused images (not attached to a container):

```bash
docker system prune -a -f
```

**Do not** run `docker volume prune` unless you intend to delete named volumes such as `pm-helper_postgres_data` (your database files).

## Local development (no Docker for Node)

1. Start PostgreSQL and create a database matching `DATABASE_URL`, or run only the `db` service (with `.env` present):

   ```bash
   docker compose up db
   ```

2. **Backend** (`backend/.env` from `backend/.env.example`):

   ```bash
   cd backend && npm install && npm run dev
   ```

3. **Frontend** (Vite proxies `/api` → `http://127.0.0.1:3000`):

   ```bash
   cd frontend && npm install && npm run dev
   ```

Open http://localhost:5173

---

## 1. Database schema (PostgreSQL)

Defined in [`db/init.sql`](db/init.sql).

| Column | Type | Notes |
|--------|------|--------|
| `id` | `SERIAL` | Primary key |
| `parent_project_name` | `TEXT` | Required |
| `final_customer` | `TEXT` | Required |
| `country` | `TEXT` | Required |
| `start_date` | `DATE` | Required |
| `project_id` | `TEXT` | Required, **unique** (business ID) |
| `latest_update` | `TEXT` | Optional |
| `next_action` | `TEXT` | Optional |
| `next_step_deadline` | `TIMESTAMPTZ` | Required; calendar day or specific instant |
| `next_step_deadline_has_time` | `BOOLEAN` | Required; `false` = date-only semantics |
| `wholesale_customer` | `TEXT` | Required |
| `action_flag` | `action_flag_enum` | Required |
| `status` | `project_status_enum` | Required, default `ACTIVE` |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | Auto |

**Enum `action_flag_enum`:** `PASSIVE_MONITOR`, `OPTIMIZATION_NEEDED`, `ACTION_PENDING`, `CRITICAL_BLOCKER`

**Enum `project_status_enum`:** `ACTIVE`, `CLOSED`

Indexes: `action_flag`, `next_step_deadline`, `project_id`, `status`.

Existing databases: apply [`db/migrations/006_project_status.sql`](db/migrations/006_project_status.sql) once (new installs use `db/init.sql` which already includes `status`). For `next_step_deadline` still `DATE`, the API migrates it at startup using `URGENCY_TIMEZONE` (see `ensureNextStepDeadlineSchema`). You can also run [`db/migrations/008_next_step_deadline_timestamptz.sql`](db/migrations/008_next_step_deadline_timestamptz.sql) manually (defaults to UTC in the `USING` clause; edit if needed).

---

## 2. REST API (JSON)

`startDate` uses **ISO 8601 date** `YYYY-MM-DD`. `nextStepDeadline` is either that same date form (no wall-clock time) or a full **ISO 8601 datetime** (instant). Other timestamps are ISO with timezone.

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects` | Create a project |
| `GET` | `/api/projects` | List projects (search, filters, sort, pagination) |
| `GET` | `/api/projects/:id` | Get one project by database `id` |
| `PUT` | `/api/projects/:id` | Replace project fields (full body) |
| `PATCH` | `/api/projects/:id` | Partial update (not allowed when project is `CLOSED`) |
| `PATCH` | `/api/projects/:id/status` | Set `status` to `ACTIVE` or `CLOSED` (body: `{ "status": "CLOSED" }`) |
| `DELETE` | `/api/projects/:id` | Delete project |

**`GET /api/projects` query parameters**

| Parameter | Description |
|-----------|-------------|
| `page` | Page number (default `1`) |
| `limit` | Page size (default `50`, max `200`) |
| `sortBy` | Column id (camelCase or snake_case), e.g. `nextStepDeadline`, `project_id` |
| `sortOrder` | `asc` or `desc` |
| `search` | Global `ILIKE` across text fields |
| `country` | Partial match on country |
| `finalCustomer` | Partial match on final customer |
| `wholesaleCustomer` | Partial match on wholesale customer |
| `actionFlag` | Exact enum value |
| `status` | `active` (default), `closed`, or `all` |
| `urgentOnly` | `true` — due today, not passive, **and** `ACTIVE` only |

**List response**

```json
{
  "data": [ { "...project fields camelCase..." } ],
  "meta": {
    "total": 0,
    "page": 1,
    "limit": 50,
    "totalPages": 1,
    "sortBy": "next_step_deadline",
    "sortOrder": "asc"
  }
}
```

**Project JSON shape (camelCase)**

- `parentProjectName`, `finalCustomer`, `country`, `startDate`, `projectId`
- `latestUpdate`, `nextAction`, `nextStepDeadline`, `wholesaleCustomer`, `actionFlag`, `status`
- `id`, `createdAt`, `updatedAt` on read responses

**Other**

- `GET /health` — `{ "ok": true }`

---

## 3. Frontend grid (`ProjectTable`)

- **TanStack Table** with **server-side** sorting, pagination, and filtering (backed by `GET /api/projects`).
- **Global search** (debounced) across all searchable text columns.
- **Per-column filters:** country (text), action flag (select), final customer, wholesale customer.
- **Column visibility** toggles (row actions column always visible).
- **Sortable** headers (server-side); default client default is next step deadline ascending (overridable in Phase 2).
- **Truncation:** “Latest update” and “Next action” show a shortened preview with full text in `title`.
- **Action flag** column uses **color-coded badges**.
- **Row actions:** Edit (modal form), Delete (confirm).
- **Create:** “New project” opens the same form in create mode.

---

## Troubleshooting

- **Trigger / init SQL on older PostgreSQL:** If `CREATE TRIGGER ... EXECUTE FUNCTION` fails, replace with `EXECUTE PROCEDURE set_updated_at();` for PostgreSQL 13 and below.

---

## Repository layout

- `db/init.sql` — schema
- `backend/` — Express API
- `frontend/` — Vite + React app
- `docker-compose.yml` — `db`, `backend`, `frontend`; root `.env.example` / `.env`
