// routes/settings.mjs — GET всех + PUT отдельных ключей с валидацией.
import { Router } from "express";
import { z } from "zod";
import { query } from "../lib/db.mjs";
import { requireAuth, loadOptionalUser } from "../lib/auth.mjs";
import { invalidateMlWorkflowCache } from "../lib/settings.mjs";

export const settingsRouter = Router();

// Чтение всех настроек — публично (нужно фронту до логина для отрисовки).
settingsRouter.get("/all", loadOptionalUser, async (_req, res) => {
  const r = await query("SELECT key, value, updated_at, updated_by FROM settings ORDER BY key");
  res.json({ ok: true, settings: r.rows });
});

settingsRouter.get("/:key", loadOptionalUser, async (req, res) => {
  const r = await query(
    "SELECT key, value, updated_at, updated_by FROM settings WHERE key = $1",
    [req.params.key],
  );
  if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
  res.json({ ok: true, setting: r.rows[0] });
});

// Запись — только админ.
const KnownKeys = {
  cashback: z.object({
    percent_of_noncash: z.number().min(0).max(100),
  }),
  risk_thresholds: z.object({
    short_trip_km: z.number().min(0).max(50),
    fast_arrival_min: z.number().min(0).max(60),
    min_attendance_pct: z.number().min(0).max(100),
    high_repeat_ratio: z.number().min(0).max(1),
  }),
  shifts_default: z.object({
    shifts: z.array(z.unknown()),
  }),
  // T016/T017: правила автосоздания тикетов и поведение labeling queue.
  ml_workflow: z.object({
    ml_mode:                            z.enum(["SAFE", "BALANCED", "AGGRESSIVE", "TRAINING"]).optional(),
    disagreement_delta_threshold:       z.number().min(0).max(100),
    ml_discovery_min_score:             z.number().min(0).max(100),
    ml_discovery_max_rule_score:        z.number().min(0).max(100),
    ticket_min_money_at_risk_byn:       z.number().min(0),
    ticket_max_per_day:                 z.number().int().min(0).max(10000),
    ticket_max_per_rescore:             z.number().int().min(0).max(50000),
    enable_strong_disagreement_tickets: z.boolean(),
    enable_rule_overkill_tickets:       z.boolean(),
  }).strict(),
};

settingsRouter.put("/:key", requireAuth(["admin"]), async (req, res) => {
  const key = req.params.key;
  const schema = KnownKeys[key];
  if (!schema) return res.status(400).json({ ok: false, error: "unknown_key" });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_request", details: parsed.error.flatten() });
  }
  await query(
    `INSERT INTO settings(key, value, updated_at, updated_by)
       VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(parsed.data), req.user.login],
  );
  if (key === "ml_workflow") invalidateMlWorkflowCache();
  req.log.info({ key, by: req.user.login }, "setting updated");
  res.json({ ok: true });
});
