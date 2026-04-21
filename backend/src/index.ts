import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { pool } from "./db.js";
import { ensurePhase7Schema } from "./ensureSchema.js";
import { requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { projectsRouter } from "./routes/projects.js";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use("/api/projects", requireAuth, projectsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

async function main() {
  await ensurePhase7Schema();
  app.listen(port, "0.0.0.0", () => {
    console.log(`API listening on ${port}`);
  });
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
