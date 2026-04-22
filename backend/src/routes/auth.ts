import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../db.js";
import { AUTH_COOKIE_NAME, getJwtSecret } from "../authConfig.js";
import {
  authCookieOptions,
  clearAuthCookieOptions,
  readAuthToken,
  verifyAuthToken,
} from "../middleware/auth.js";
import type { SafeUserRow, UserRow } from "../types.js";

const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().trim().min(1, "Name is required"),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }
  const { email, password, fullName } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const inserted = await pool.query<SafeUserRow>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, full_name, update_reminder_business_days, created_at, updated_at`,
      [email.toLowerCase(), passwordHash, fullName]
    );
    const user = inserted.rows[0];
    const token = jwt.sign(
      { sub: user.id, email: user.email },
      getJwtSecret(),
      { expiresIn: "7d" }
    );
    res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        updateReminderBusinessDays: user.update_reminder_business_days,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    });
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === "23505") {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Registration failed" });
  }
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }
  const { email, password } = parsed.data;
  try {
    const result = await pool.query<UserRow>(
      `SELECT id, email, password_hash, full_name, created_at, updated_at FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const token = jwt.sign(
      { sub: user.id, email: user.email },
      getJwtSecret(),
      { expiresIn: "7d" }
    );
    res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        updateReminderBusinessDays: user.update_reminder_business_days,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Login failed" });
  }
});

authRouter.post("/logout", (req, res) => {
  if (readAuthToken(req)) {
    res.clearCookie(AUTH_COOKIE_NAME, clearAuthCookieOptions());
  }
  res.status(204).send();
});

authRouter.get("/me", async (req, res) => {
  const token = readAuthToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const session = verifyAuthToken(token);
    if (!session) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }
    const result = await pool.query<SafeUserRow>(
      `SELECT id, email, full_name, update_reminder_business_days, created_at, updated_at FROM users WHERE id = $1`,
      [session.id]
    );
    const user = result.rows[0];
    if (!user) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }
    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        updateReminderBusinessDays: user.update_reminder_business_days,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    });
  } catch {
    res.status(401).json({ error: "Invalid or expired session" });
  }
});
