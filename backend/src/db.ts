import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://pmhelper:pmhelper@localhost:5432/pmhelper";

export const pool = new Pool({ connectionString });
