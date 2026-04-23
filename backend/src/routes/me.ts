import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { getUrgencyTimezone } from "../urgencyTimezone.js";

/** PATCH requires both thresholds (no partial updates). */
const patchSettingsSchema = z.object({
  updateReminderBusinessDays: z
    .number({ message: "updateReminderBusinessDays must be a number" })
    .int("updateReminderBusinessDays must be an integer")
    .min(1, "updateReminderBusinessDays must be at least 1")
    .max(30, "updateReminderBusinessDays must be at most 30"),
  crmUpdateReminderBusinessDays: z
    .number({ message: "crmUpdateReminderBusinessDays must be a number" })
    .int("crmUpdateReminderBusinessDays must be an integer")
    .min(1, "crmUpdateReminderBusinessDays must be at least 1")
    .max(30, "crmUpdateReminderBusinessDays must be at most 30"),
});

export const meRouter = Router();

meRouter.get("/settings", async (req, res) => {
  try {
    const r = await pool.query<{
      update_reminder_business_days: number;
      crm_update_reminder_business_days: number;
    }>(
      `SELECT update_reminder_business_days, crm_update_reminder_business_days FROM users WHERE id = $1`,
      [req.user!.id]
    );
    const row = r.rows[0];
    if (!row) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }
    res.json({
      updateReminderBusinessDays: row.update_reminder_business_days,
      crmUpdateReminderBusinessDays: row.crm_update_reminder_business_days,
      urgencyTimezone: getUrgencyTimezone(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load settings" });
  }
});

meRouter.patch("/settings", async (req, res) => {
  const parsed = patchSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }
  try {
    const r = await pool.query<{
      update_reminder_business_days: number;
      crm_update_reminder_business_days: number;
    }>(
      `UPDATE users SET
         update_reminder_business_days = $1,
         crm_update_reminder_business_days = $2
       WHERE id = $3
       RETURNING update_reminder_business_days, crm_update_reminder_business_days`,
      [
        parsed.data.updateReminderBusinessDays,
        parsed.data.crmUpdateReminderBusinessDays,
        req.user!.id,
      ]
    );
    const row = r.rows[0];
    if (!row) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }
    res.json({
      updateReminderBusinessDays: row.update_reminder_business_days,
      crmUpdateReminderBusinessDays: row.crm_update_reminder_business_days,
      urgencyTimezone: getUrgencyTimezone(),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update settings" });
  }
});
