// routes/shifts.mjs — CRUD рабочих смен с выплатами по гарантии.
import { Router } from "express";
import { z } from "zod";
import { query } from "../lib/db.mjs";
import { requireAuth, loadOptionalUser } from "../lib/auth.mjs";

export const shiftsRouter = Router();

const ShiftBody = z.object({
  name: z.string().trim().min(1).max(64),
  start_hour: z.number().int().min(0).max(23),
  end_hour: z.number().int().min(1).max(24),
  payout_byn: z.number().min(0).max(100000),
  weekday_mask: z.number().int().min(0).max(127).default(127),
  active: z.boolean().default(true),
}).refine((s) => s.end_hour > s.start_hour, {
  message: "end_hour must be greater than start_hour",
});

// Список смен — публично (нужен для отрисовки)
shiftsRouter.get("/", loadOptionalUser, async (_req, res) => {
  const r = await query(
    "SELECT id, name, start_hour, end_hour, payout_byn, weekday_mask, active, created_at, updated_at FROM shifts ORDER BY start_hour, id",
  );
  res.json({ ok: true, shifts: r.rows });
});

shiftsRouter.post("/", requireAuth(["admin"]), async (req, res) => {
  const parsed = ShiftBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_request", details: parsed.error.flatten() });
  }
  const { name, start_hour, end_hour, payout_byn, weekday_mask, active } = parsed.data;
  const r = await query(
    `INSERT INTO shifts(name, start_hour, end_hour, payout_byn, weekday_mask, active)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, name, start_hour, end_hour, payout_byn, weekday_mask, active`,
    [name, start_hour, end_hour, payout_byn, weekday_mask, active],
  );
  req.log.info({ id: r.rows[0].id, by: req.user.login }, "shift created");
  res.status(201).json({ ok: true, shift: r.rows[0] });
});

shiftsRouter.put("/:id", requireAuth(["admin"]), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "bad_id" });
  const parsed = ShiftBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_request", details: parsed.error.flatten() });
  }
  const { name, start_hour, end_hour, payout_byn, weekday_mask, active } = parsed.data;
  const r = await query(
    `UPDATE shifts SET name=$1, start_hour=$2, end_hour=$3, payout_byn=$4,
       weekday_mask=$5, active=$6, updated_at=now()
     WHERE id=$7
     RETURNING id, name, start_hour, end_hour, payout_byn, weekday_mask, active`,
    [name, start_hour, end_hour, payout_byn, weekday_mask, active, id],
  );
  if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
  req.log.info({ id, by: req.user.login }, "shift updated");
  res.json({ ok: true, shift: r.rows[0] });
});

shiftsRouter.delete("/:id", requireAuth(["admin"]), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "bad_id" });
  const r = await query("DELETE FROM shifts WHERE id = $1 RETURNING id", [id]);
  if (!r.rowCount) return res.status(404).json({ ok: false, error: "not_found" });
  req.log.info({ id, by: req.user.login }, "shift deleted");
  res.json({ ok: true });
});
