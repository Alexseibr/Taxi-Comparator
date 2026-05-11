// routes/tickets.mjs — T015 Fraud Decision Workflow.
//   GET    /tickets                 — список с фильтрами + пагинацией
//   GET    /tickets/:id             — карточка тикета + история событий
//   POST   /tickets/:id/decision    — принять решение (admin/antifraud)
//   POST   /tickets/:id/comment     — оставить комментарий без смены статуса
//   POST   /tickets/:id/label       — ручная разметка для supervised ML (T015 supervised)
//
// Все ENDPOINTS требуют авторизации. /decision, /comment, /label — admin/antifraud.

import { Router } from "express";
import { z } from "zod";
import { query, withTx } from "../lib/db.mjs";
import { requireAuth } from "../lib/auth.mjs";
import { applyDecision } from "../lib/fraud_tickets.mjs";

export const ticketsRouter = Router();

// ─────────────────────────────────────────── LIST ────────────────────
const ListQuery = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_from:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status:      z.enum(["new","in_review","confirmed_fraud","false_positive","closed"]).optional(),
  entity_type: z.enum(["driver","client","pair"]).optional(),
  priority:    z.enum(["low","medium","high"]).optional(),
  limit:       z.coerce.number().int().min(1).max(500).default(100),
});

ticketsRouter.get("/", requireAuth(), async (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_request", details: parsed.error.flatten() });
  }
  const q = parsed.data;
  const conds = [];
  const params = [];
  const push = (sql, val) => { params.push(val); conds.push(sql.replace("?", `$${params.length}`)); };

  if (q.date)        push("t.date = ?",         q.date);
  if (q.date_from)   push("t.date >= ?",        q.date_from);
  if (q.date_to)     push("t.date <= ?",        q.date_to);
  if (q.status)      push("t.status = ?",       q.status);
  if (q.entity_type) push("t.entity_type = ?",  q.entity_type);
  if (q.priority)    push("t.priority = ?",     q.priority);

  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  params.push(q.limit);
  const r = await query(
    `SELECT t.ticket_id, t.entity_type, t.driver_id, t.client_id, t.date,
            t.risk_score, t.risk_type, t.money_at_risk_byn, t.money_saved_byn,
            t.status, t.decision, t.priority,
            t.previous_flags_count, t.assigned_to, t.comment,
            t.created_at, t.updated_at,
            d.name  AS driver_name
       FROM fraud_tickets t
       LEFT JOIN drivers d ON d.id = t.driver_id
       ${where}
       ORDER BY t.money_at_risk_byn DESC, t.risk_score DESC, t.ticket_id DESC
       LIMIT $${params.length}`,
    params,
  );
  res.json({ ok: true, tickets: r.rows });
});

// ─────────────────────────────────────────── ONE ─────────────────────
ticketsRouter.get("/:id", requireAuth(), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "bad_id" });
  }
  const t = await query(
    `SELECT t.*,
            d.name  AS driver_name,
            c.cashback_blocked AS client_cashback_blocked
       FROM fraud_tickets t
       LEFT JOIN drivers d ON d.id = t.driver_id
       LEFT JOIN clients c ON c.id = t.client_id
      WHERE t.ticket_id = $1`,
    [id],
  );
  if (!t.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });

  const events = await query(
    `SELECT id, action, old_status, new_status, decision, comment, meta, user_id, created_at
       FROM fraud_ticket_events
      WHERE ticket_id = $1
      ORDER BY created_at, id`,
    [id],
  );

  // История за 7 дней по той же entity_key (для тренда).
  const ticket = t.rows[0];
  const history = await query(
    `SELECT date, risk_score, money_at_risk_byn, money_saved_byn, status, decision, priority
       FROM fraud_tickets
      WHERE entity_key = $1
        AND date BETWEEN ($2::date - 6) AND $2::date
      ORDER BY date`,
    [ticket.entity_key, ticket.date],
  );

  res.json({ ok: true, ticket, events: events.rows, history: history.rows });
});

// ─────────────────────────────────────────── DECISION ────────────────
const DecisionBody = z.object({
  decision: z.enum(["deny_payout","allow","block_cashback","monitor"]),
  comment:  z.string().trim().max(2000).optional(),
});

ticketsRouter.post("/:id/decision", requireAuth(["admin","antifraud"]), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "bad_id" });
  }
  const parsed = DecisionBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_request", details: parsed.error.flatten() });
  }
  const { decision, comment } = parsed.data;

  try {
    const updated = await withTx(async (c) => {
      const t = await c.query(
        `SELECT * FROM fraud_tickets WHERE ticket_id = $1 FOR UPDATE`,
        [id],
      );
      if (!t.rows[0]) {
        const e = new Error("not_found"); e.code = "NOT_FOUND"; throw e;
      }
      if (t.rows[0].status === "confirmed_fraud" || t.rows[0].status === "false_positive") {
        // Уже решён. Возможна замена комментария, но решение не пересматриваем
        // тут — для этого будет отдельный /reopen в будущем.
        const e = new Error("ticket_already_decided"); e.code = "ALREADY_DECIDED"; throw e;
      }
      return await applyDecision(c, t.rows[0], {
        decision,
        comment,
        userLogin: req.user.login,
        userId:    req.user.id,
      });
    });
    req.log.info({ id, decision, by: req.user.login }, "ticket decision applied");
    res.json({ ok: true, ticket: updated });
  } catch (e) {
    if (e.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: "not_found" });
    if (e.code === "ALREADY_DECIDED") return res.status(409).json({ ok: false, error: "already_decided" });
    if (["deny_payout_requires_driver","block_cashback_requires_client","bad_decision"].includes(e.message)) {
      return res.status(400).json({ ok: false, error: e.message });
    }
    req.log.error({ err: { msg: e?.message, stack: e?.stack, code: e?.code } }, "ticket decision failed");
    res.status(500).json({ ok: false, error: "decision_failed" });
  }
});

// ─────────────────────────────────────────── COMMENT ─────────────────
const CommentBody = z.object({
  comment: z.string().trim().min(1).max(2000),
});

ticketsRouter.post("/:id/comment", requireAuth(["admin","antifraud"]), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "bad_id" });
  }
  const parsed = CommentBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_request", details: parsed.error.flatten() });
  }

  const upd = await query(
    `UPDATE fraud_tickets
        SET comment = $2, updated_at = now(),
            assigned_to = COALESCE(assigned_to, $3)
      WHERE ticket_id = $1
      RETURNING ticket_id, comment, assigned_to, updated_at`,
    [id, parsed.data.comment, req.user.login],
  );
  if (!upd.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });

  await query(
    `INSERT INTO fraud_ticket_events (ticket_id, action, comment, user_id)
     VALUES ($1, 'comment', $2, $3)`,
    [id, parsed.data.comment, req.user.id],
  );
  res.json({ ok: true, ...upd.rows[0] });
});

// ─────────────────────────────────────────── LABEL (supervised ML) ────
// Ручная разметка: оператор подтверждает фрод (1) или ложное срабатывание (0).
// Запись идёт в fraud_training_labels (источник правды для supervised retrain)
// + флаг на самом тикете. Decision/status НЕ трогаем — это отдельная воркфлоу.
const LabelBody = z.object({
  label:   z.union([z.literal(0), z.literal(1)]),
  comment: z.string().trim().max(2000).optional(),
});

// entity_key для fraud_training_labels: для pair — "driver_id:client_id",
// для driver/client — соответствующий id, для cluster — cluster_id.
function labelEntityKey(t) {
  if (t.entity_type === "pair")   return `${t.driver_id}:${t.client_id}`;
  if (t.entity_type === "driver") return String(t.driver_id);
  if (t.entity_type === "client") return String(t.client_id);
  return null;
}

ticketsRouter.post("/:id/label", requireAuth(["admin", "antifraud"]), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "bad_id" });
  }
  const parsed = LabelBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_request", details: parsed.error.flatten() });
  }
  const { label, comment } = parsed.data;

  try {
    const result = await withTx(async (c) => {
      const tr = await c.query(
        `SELECT * FROM fraud_tickets WHERE ticket_id = $1 FOR UPDATE`,
        [id],
      );
      if (!tr.rows[0]) {
        const e = new Error("not_found"); e.code = "NOT_FOUND"; throw e;
      }
      const t = tr.rows[0];
      const entityKey = labelEntityKey(t);
      if (!entityKey) {
        const e = new Error("unsupported_entity"); e.code = "UNSUPPORTED"; throw e;
      }

      // Текущие скоры для аудита (snapshot на момент разметки).
      // ml_score: для пары — двухключевой LATEST из ml_predictions.
      const ml = await c.query(
        `SELECT score AS ml_score, disagreement
           FROM ml_predictions
          WHERE entity_type = $1
            AND entity_id_a = $2
            AND entity_id_b = $3
            AND date <= $4
          ORDER BY date DESC
          LIMIT 1`,
        t.entity_type === "pair"
          ? ["pair", String(t.driver_id), String(t.client_id), t.date]
          : [t.entity_type, t.entity_type === "driver" ? String(t.driver_id) : String(t.client_id), "", t.date],
      );
      const mlScore = ml.rows[0]?.ml_score ?? null;

      // rule_score: используем risk_score из самого тикета (это он и есть в нашей модели).
      const ruleScore = t.risk_score ?? null;
      const finalScore = ruleScore;
      // delta = |ml - rule/100| как индикатор расхождения (если ml есть).
      const delta = mlScore != null && ruleScore != null
        ? Math.abs(Number(mlScore) - Number(ruleScore) / 100)
        : null;

      const ins = await c.query(
        `INSERT INTO fraud_training_labels
           (entity_type, entity_key, date, label, source_ticket_id,
            ml_score, rule_score, graph_score, final_score, delta,
            reviewed_by, comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11)
         ON CONFLICT (entity_type, entity_key, date, COALESCE(source_ticket_id, 0))
         DO UPDATE SET
           label       = EXCLUDED.label,
           ml_score    = EXCLUDED.ml_score,
           rule_score  = EXCLUDED.rule_score,
           final_score = EXCLUDED.final_score,
           delta       = EXCLUDED.delta,
           reviewed_by = EXCLUDED.reviewed_by,
           reviewed_at = now(),
           comment     = EXCLUDED.comment
         RETURNING id`,
        [
          t.entity_type, entityKey, t.date, label, id,
          mlScore, ruleScore, finalScore, delta,
          req.user.login, comment ?? null,
        ],
      );

      const upd = await c.query(
        `UPDATE fraud_tickets
            SET label_status = 'labeled',
                label_value  = $2,
                labeled_at   = now(),
                labeled_by   = $3,
                updated_at   = now()
          WHERE ticket_id = $1
          RETURNING ticket_id, label_status, label_value, labeled_at, labeled_by`,
        [id, label, req.user.login],
      );

      await c.query(
        `INSERT INTO fraud_ticket_events
           (ticket_id, action, comment, meta, user_id)
         VALUES ($1, 'label', $2, $3, $4)`,
        [
          id,
          comment ?? null,
          JSON.stringify({ label, ml_score: mlScore, rule_score: ruleScore, delta }),
          req.user.id,
        ],
      );

      return { label_id: ins.rows[0].id, ticket: upd.rows[0] };
    });

    req.log.info({ id, label, by: req.user.login, label_id: result.label_id }, "ticket labeled");
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e.code === "NOT_FOUND")    return res.status(404).json({ ok: false, error: "not_found" });
    if (e.code === "UNSUPPORTED")  return res.status(400).json({ ok: false, error: "unsupported_entity_type" });
    req.log.error({ err: { msg: e?.message, stack: e?.stack, code: e?.code } }, "ticket label failed");
    res.status(500).json({ ok: false, error: "label_failed" });
  }
});
