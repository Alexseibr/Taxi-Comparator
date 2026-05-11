// routes/workbench.mjs — рабочее место антифродера (production-ready).
//
//   GET  /workbench/kpi                   — открытые/решённые сегодня + деньги под риском
//   GET  /workbench/cases                 — очередь с cursor pagination (date_from/date_to, priority, money, status)
//   GET  /workbench/cases/:id             — детальная карточка + ML + WHY + MONEY
//   POST /workbench/cases/:id/decision    — confirm/false_positive/monitor + авто-label (идемпотентно)
//   GET  /workbench/pair-context          — история риска + заказы + тикеты + граф + hidden links
//   GET  /workbench/suspicious-orders     — конкретные поездки с флагами риска (evidence layer)

import { Router } from "express";
import { z } from "zod";
import { query, withTx } from "../lib/db.mjs";
import { requireAuth } from "../lib/auth.mjs";

export const workbenchRouter = Router();

// ─────────────────────────────────── GET /workbench/kpi ─────────────────────

workbenchRouter.get("/kpi", requireAuth(), async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  try {
    const [main, labels, decisions] = await Promise.all([
      query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('new','in_review'))::int            AS open_cases,
           COUNT(*) FILTER (WHERE priority = 'high'
                              AND status IN ('new','in_review'))::int             AS high_priority,
           COALESCE(SUM(CASE WHEN status IN ('new','in_review')
                              THEN money_at_risk_byn ELSE 0 END), 0)::float      AS money_at_risk_byn,
           COALESCE(SUM(money_saved_byn), 0)::float                              AS money_saved_byn
         FROM fraud_tickets
         WHERE date = $1::date`,
        [date],
      ),
      query(
        `SELECT COUNT(*)::int AS labels_today
           FROM fraud_training_labels
          WHERE reviewed_at::date = $1::date OR created_at::date = $1::date`,
        [date],
      ),
      // Решения, принятые за сегодня (updated_at сегодня, статус terminal)
      query(
        `SELECT COUNT(*)::int AS decisions_today
           FROM fraud_tickets
          WHERE updated_at::date = $1::date
            AND status IN ('confirmed_fraud','false_positive','monitor')`,
        [date],
      ),
    ]);
    res.json({
      ok: true,
      date,
      ...main.rows[0],
      labels_today:    labels.rows[0]?.labels_today    ?? 0,
      decisions_today: decisions.rows[0]?.decisions_today ?? 0,
      // backward-compat alias
      new_tickets: main.rows[0]?.open_cases ?? 0,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "db_error", detail: String(err?.message || err) });
  }
});

// ─────────────────────────────────── GET /workbench/cases ───────────────────
// Cursor pagination: cursor=<ticket_id> — следующая страница начинается после этого id.
// Defaults: status=new,in_review  priority=high,medium  min_money=5  date_from=yesterday

const CasesQuery = z.object({
  date_from:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),  // legacy single-date
  status:      z.string().optional(),
  priority:    z.string().optional(),
  entity_type: z.string().optional(),
  min_money:   z.coerce.number().min(0).optional(),
  limit:       z.coerce.number().int().min(1).max(200).optional(),
  cursor:      z.coerce.number().int().min(0).optional(),  // last ticket_id of prev page
}).strict();

function isoYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

workbenchRouter.get("/cases", requireAuth(), async (req, res) => {
  const parsed = CasesQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_query", details: parsed.error.flatten() });
  }
  const q = parsed.data;

  // Date range — по умолчанию: от вчера до сегодня
  const dateFrom   = q.date_from || q.date || isoYesterday();
  const dateTo     = q.date_to   || q.date || isoToday();
  const statuses   = (q.status   || "new,in_review").split(",").map((s) => s.trim()).filter(Boolean);
  const priorities = (q.priority || "high,medium").split(",").map((s) => s.trim()).filter(Boolean);
  const minMoney   = q.min_money ?? 5;
  const limit      = q.limit ?? 50;
  const cursor     = q.cursor ?? 0;  // ticket_id > cursor  (0 = first page)

  const entityFilter = q.entity_type
    ? `AND ft.entity_type = '${q.entity_type.replace(/'/g, "")}'`
    : "";
  const cursorFilter = cursor > 0 ? `AND ft.ticket_id > ${cursor}` : "";

  try {
    const r = await query(
      `SELECT
         ft.ticket_id,
         ft.entity_type,
         ft.risk_type,
         ft.priority,
         ft.status,
         ft.driver_id,
         ft.client_id,
         ft.date::text              AS date,
         ft.risk_score::float       AS rule_score,
         ft.money_at_risk_byn::float AS money_at_risk_byn,
         ft.signals,
         ft.label_status,
         ft.label_value,
         d.name                     AS driver_name,
         mp.score::float            AS ml_score_raw,
         mp.top_features            AS top_features
       FROM fraud_tickets ft
       LEFT JOIN drivers d   ON d.id = ft.driver_id
       LEFT JOIN LATERAL (
         SELECT score, top_features
           FROM ml_predictions
          WHERE entity_type = 'pair'
            AND entity_id_a = ft.driver_id
            AND entity_id_b = ft.client_id
            AND date = ft.date
          ORDER BY predicted_at DESC
          LIMIT 1
       ) mp ON ft.entity_type = 'pair'
       WHERE ft.date BETWEEN $1::date AND $2::date
         AND ft.status = ANY($3::text[])
         AND ft.priority = ANY($4::text[])
         AND ft.money_at_risk_byn >= $5
         ${entityFilter}
         ${cursorFilter}
       ORDER BY
         CASE ft.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         ft.money_at_risk_byn DESC,
         ft.created_at ASC
       LIMIT $6`,
      [dateFrom, dateTo, statuses, priorities, minMoney, limit + 1],
    );

    const hasMore = r.rows.length > limit;
    const rows    = hasMore ? r.rows.slice(0, limit) : r.rows;
    const nextCursor = hasMore ? rows[rows.length - 1].ticket_id : null;

    const items = rows.map((row) => {
      const mlRaw = row.ml_score_raw;
      const ml    = mlRaw != null ? Math.round(mlRaw * 100) : null;
      const rule  = Number(row.rule_score) || 0;
      return {
        ...row,
        ml_score:     ml,
        ml_score_raw: undefined,
        delta:        ml != null ? Math.round(ml - rule) : null,
        final_score:  ml != null ? Math.max(ml, rule) : rule,
        why:          _buildWhy(row),
      };
    });

    res.json({
      ok: true,
      count:      items.length,
      has_more:   hasMore,
      next_cursor: nextCursor,
      date_from:  dateFrom,
      date_to:    dateTo,
      items,
    });
  } catch (err) {
    req.log.error({ err: String(err) }, "workbench /cases failed");
    res.status(500).json({ ok: false, error: "db_error", detail: String(err?.message || err) });
  }
});

// ─────────────────────────────────── GET /workbench/cases/:id ───────────────

workbenchRouter.get("/cases/:id", requireAuth(), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "bad_id" });
  }
  try {
    const r = await query(
      `SELECT
         ft.*,
         ft.date::text              AS date_str,
         d.name                     AS driver_name,
         mp.score::float            AS ml_score_raw,
         mp.top_features            AS ml_top_features,
         prd.total_risk::float      AS prd_rule_score,
         prd.collusion_loss_risk_byn::float AS prd_money_at_risk,
         prd.signals                AS prd_signals,
         NULL::float                AS gmv,
         prd.noncash_gmv::float     AS noncash_gmv,
         NULL::float                    AS cashback_risk_byn,
         NULL::float                    AS guarantee_risk_byn,
         NULL::float                    AS noncash_ratio,
         NULL::float                    AS short_trip_ratio,
         NULL::float                    AS fast_arrival_ratio,
         prd.repeat_ratio::float        AS repeat_ratio
       FROM fraud_tickets ft
       LEFT JOIN drivers d   ON d.id = ft.driver_id
       LEFT JOIN LATERAL (
         SELECT score, top_features
           FROM ml_predictions
          WHERE entity_type = 'pair'
            AND entity_id_a = ft.driver_id
            AND entity_id_b = ft.client_id
            AND date = ft.date
          ORDER BY predicted_at DESC
          LIMIT 1
       ) mp ON ft.entity_type = 'pair'
       LEFT JOIN pair_risk_daily prd
         ON prd.driver_id = ft.driver_id
        AND prd.client_id = ft.client_id
        AND prd.date = ft.date
        AND ft.entity_type = 'pair'
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int                                                          AS total_orders,
           COUNT(*) FILTER (WHERE o.km    IS NOT NULL AND o.km    < 3)::int      AS cnt_short_trip,
           COUNT(*) FILTER (WHERE o.arrival_minutes IS NOT NULL AND o.arrival_minutes < 5)::int AS cnt_fast_arrival,
           COUNT(*) FILTER (WHERE o.payment_type = 'noncash')::int               AS cnt_noncash,
           COUNT(*) FILTER (WHERE o.status = 'taken_cancelled')::int             AS cnt_cancel_after_accept
           FROM orders o
          WHERE o.driver_id = ft.driver_id
            AND o.client_id = ft.client_id
            AND o.order_date = ft.date
       ) oflags ON true
       WHERE ft.ticket_id = $1`,
      [id],
    );
    if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
    const row = r.rows[0];
    const mlScore   = row.ml_score_raw != null ? Math.round(row.ml_score_raw * 100) : null;
    const ruleScore = Number(row.risk_score) || 0;
    const delta     = mlScore != null ? mlScore - ruleScore : null;

    const suspFlagCounts = {
      short_trip:          Number(row.cnt_short_trip)          || 0,
      fast_arrival:        Number(row.cnt_fast_arrival)        || 0,
      noncash:             Number(row.cnt_noncash)             || 0,
      repeat_pair:         Number(row.total_orders) >= 4 ? 1 : 0,
      cancel_after_accept: Number(row.cnt_cancel_after_accept) || 0,
      total_orders:        Number(row.total_orders)            || 0,
    };

    const item = {
      ticket_id:   row.ticket_id,
      entity_type: row.entity_type,
      risk_type:   row.risk_type,
      priority:    row.priority,
      status:      row.status,
      decision:    row.decision,
      driver_id:   row.driver_id,
      driver_name: row.driver_name,
      client_id:   row.client_id,
      date:        row.date_str,
      rule_score:  ruleScore,
      ml_score:    mlScore,
      delta,
      final_score: mlScore != null ? Math.max(mlScore, ruleScore) : ruleScore,
      money_at_risk_byn: Number(row.money_at_risk_byn) || 0,
      money_saved_byn:   Number(row.money_saved_byn)   || 0,
      label_status: row.label_status,
      label_value:  row.label_value,
      comment:      row.comment,
      created_at:   row.created_at,
      updated_at:   row.updated_at,
      money: {
        gmv:            row.gmv ?? null,
        noncash_gmv:    row.noncash_gmv ?? null,
        cashback_risk:  row.cashback_risk_byn ?? Number(row.signals?.cashback_money_byn) ?? null,
        guarantee_risk: row.guarantee_risk_byn ?? Number(row.signals?.guarantee_money_byn) ?? null,
        total_at_risk:  Number(row.money_at_risk_byn) || 0,
      },
      why: _buildWhy({
        ...row,
        ml_score_raw: row.ml_score_raw,
        rule_score:   ruleScore,
        noncash_ratio:      row.noncash_ratio,
        short_trip_ratio:   row.short_trip_ratio,
        fast_arrival_ratio: row.fast_arrival_ratio,
        repeat_ratio:       row.repeat_ratio,
        suspicious_flag_counts: suspFlagCounts,
      }),
      signals:              row.signals,
      suspicious_orders:    row.suspicious_orders,
      suspicious_flag_counts: suspFlagCounts,
      top_features:         row.ml_top_features,
    };
    res.json({ ok: true, item });
  } catch (err) {
    req.log.error({ err: String(err) }, "workbench /cases/:id failed");
    res.status(500).json({ ok: false, error: "db_error", detail: String(err?.message || err) });
  }
});

// ───────────────────────── POST /workbench/cases/:id/decision ───────────────

const DecisionBody = z.object({
  action:         z.enum(["confirm_fraud", "false_positive", "monitor"]),
  deny_guarantee: z.boolean().optional(),
  block_cashback: z.boolean().optional(),
  flag_pair:      z.boolean().optional(),
  comment:        z.string().trim().max(2000).optional(),
}).strict();

workbenchRouter.post("/cases/:id/decision", requireAuth(["admin", "antifraud"]), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "bad_id" });
  }
  const parsed = DecisionBody.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_body", details: parsed.error.flatten() });
  }
  const { action, deny_guarantee, block_cashback, comment } = parsed.data;
  const userLogin = req.user.login;
  const userId    = req.user.id;

  try {
    const r = await query(`SELECT * FROM fraud_tickets WHERE ticket_id = $1`, [id]);
    if (!r.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
    const ticket = r.rows[0];

    // Идемпотентность: если уже решён тем же action — вернуть текущий статус без ошибки.
    if (!["new", "in_review"].includes(ticket.status)) {
      const autoLabel = ticket.status === "confirmed_fraud" ? 1
                      : ticket.status === "false_positive"  ? 0 : null;
      return res.json({
        ok: true,
        ticket_id: id,
        action,
        decision:   ticket.decision,
        new_status: ticket.status,
        auto_label: autoLabel,
        idempotent: true,
      });
    }

    let newStatus, decision, moneySavedDelta = 0, extraMeta = {};

    if (action === "false_positive") {
      newStatus = "false_positive";
      decision  = "allow";
    } else if (action === "monitor") {
      newStatus = "in_review";
      decision  = "monitor";
    } else {
      // confirm_fraud
      newStatus       = "confirmed_fraud";
      decision        = "confirm_fraud";
      moneySavedDelta = Number(ticket.money_at_risk_byn) || 0;

      await withTx(async (c) => {
        if (deny_guarantee && (ticket.entity_type === "driver" || (ticket.entity_type === "pair" && ticket.driver_id))) {
          const upd = await c.query(
            `UPDATE driver_shift_attendance
                SET payout_byn = 0
              WHERE driver_id = $1 AND date = $2 AND qualified = true AND payout_byn > 0
             RETURNING payout_byn`,
            [ticket.driver_id, ticket.date],
          );
          decision = "deny_payout";
          moneySavedDelta = ticket.entity_type === "driver"
            ? (Number(ticket.signals?.guarantee_money_byn) || 0)
            : (Number(ticket.signals?.collusion_loss_risk_byn) || 0);
          extraMeta.attendance_rows_zeroed = upd.rowCount;
        }
        if (block_cashback && (ticket.entity_type === "client" || (ticket.entity_type === "pair" && ticket.client_id))) {
          await c.query(
            `UPDATE clients
                SET cashback_blocked = true, cashback_blocked_at = now(), cashback_blocked_by = $2
              WHERE id = $1`,
            [ticket.client_id, userLogin],
          );
          decision = decision === "deny_payout" ? "deny_payout+block_cashback" : "block_cashback";
          if (decision !== "deny_payout+block_cashback") {
            moneySavedDelta = ticket.entity_type === "client"
              ? (Number(ticket.signals?.cashback_money_byn) || 0)
              : (Number(ticket.signals?.collusion_loss_risk_byn) || 0);
          }
          extraMeta.client_cashback_blocked = ticket.client_id;
        }
      });
    }

    await query(
      `UPDATE fraud_tickets
          SET status          = $2,
              decision        = $3,
              money_saved_byn = COALESCE($4, money_saved_byn),
              comment         = COALESCE($5, comment),
              assigned_to     = COALESCE(assigned_to, $6),
              updated_at      = now()
        WHERE ticket_id = $1`,
      [id, newStatus, decision, moneySavedDelta, comment ?? null, userLogin],
    );

    await query(
      `INSERT INTO fraud_ticket_events (ticket_id, action, old_status, new_status, decision, comment, meta, user_id)
       VALUES ($1, 'decision', $2, $3, $4, $5, $6::jsonb, $7)`,
      [id, ticket.status, newStatus, decision, comment ?? null,
       JSON.stringify({ workbench: true, money_saved_byn: moneySavedDelta, ...extraMeta }), userId ?? null],
    );

    // Авто-label (идемпотентно через ON CONFLICT DO UPDATE)
    const autoLabel = newStatus === "confirmed_fraud" ? 1
                    : newStatus === "false_positive"  ? 0 : null;
    if (autoLabel !== null) {
      const entityKey = ticket.entity_type === "pair"
        ? `${ticket.driver_id}:${ticket.client_id}`
        : ticket.entity_type === "driver"
          ? String(ticket.driver_id)
          : String(ticket.client_id);
      if (entityKey) {
        await query(
          `INSERT INTO fraud_training_labels
             (entity_type, entity_key, date, label, comment, source_ticket_id,
              rule_score_at_label, final_score_at_label)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
           ON CONFLICT (entity_type, entity_key, date)
           DO UPDATE SET label = EXCLUDED.label,
                         comment = COALESCE(EXCLUDED.comment, fraud_training_labels.comment),
                         source_ticket_id = EXCLUDED.source_ticket_id,
                         labeled_at = NOW()`,
          [ticket.entity_type, entityKey, ticket.date, autoLabel,
           comment ?? `workbench:${action}`, id, ticket.risk_score ?? null],
        ).catch(() => {});
      }
    }

    req.log.info({ ticket_id: id, action, decision, new_status: newStatus, by: userLogin }, "workbench decision");
    res.json({ ok: true, ticket_id: id, action, decision, new_status: newStatus, auto_label: autoLabel });
  } catch (err) {
    req.log.error({ err: String(err) }, "workbench /decision failed");
    res.status(500).json({ ok: false, error: "decision_failed", detail: String(err?.message || err) });
  }
});

// ─────────────────────────── GET /workbench/pair-context ────────────────────

workbenchRouter.get("/pair-context", requireAuth(), async (req, res) => {
  const { driver_id, client_id, date } = req.query;
  if (!driver_id || !client_id) {
    return res.status(400).json({ ok: false, error: "driver_id and client_id required" });
  }
  const refDate = date || isoToday();

  try {
    const [riskRows, ordersRows, ticketsRows] = await Promise.all([
      // 7-дневная история риска (trend_7d)
      query(
        `SELECT
           date::text, total_risk::float AS rule_score,
           collusion_loss_risk_byn::float AS money_at_risk_byn,
           NULL::float AS cashback_risk_byn, NULL::float AS guarantee_risk_byn,
           NULL::float AS gmv,
           NULL::float AS noncash_ratio, repeat_ratio::float, NULL::float AS short_trip_ratio
         FROM pair_risk_daily
         WHERE driver_id = $1 AND client_id = $2
           AND date <= $3::date
         ORDER BY date DESC LIMIT 7`,
        [driver_id, client_id, refDate],
      ),
      // Последние 20 заказов пары
      query(
        `SELECT
           o.order_id,
           o.created_at::text AS order_date,
           o.status,
           o.payment_type,
           o.gmv::float,
           o.km::float,
           o.arrival_minutes::float,
           o.trip_minutes::float
         FROM orders o
         WHERE o.driver_id = $1
           AND o.client_id = $2
           AND o.created_at >= now() - interval '30 days'
         ORDER BY o.created_at DESC
         LIMIT 20`,
        [driver_id, client_id],
      ),
      // Последние 5 тикетов пары
      query(
        `SELECT
           ticket_id, date::text, risk_score::float, risk_type,
           status, decision, priority, money_at_risk_byn::float
         FROM fraud_tickets
         WHERE entity_type = 'pair' AND driver_id = $1 AND client_id = $2
         ORDER BY date DESC LIMIT 5`,
        [driver_id, client_id],
      ),
    ]);

    // Graph summary — степень водителя и клиента
    const [driverDeg, clientDeg] = await Promise.all([
      query(
        `SELECT COUNT(DISTINCT client_id)::int AS degree
           FROM pair_risk_daily
          WHERE driver_id = $1
            AND date >= now() - interval '30 days'`,
        [driver_id],
      ).catch(() => ({ rows: [{ degree: null }] })),
      query(
        `SELECT COUNT(DISTINCT driver_id)::int AS degree
           FROM pair_risk_daily
          WHERE client_id = $1
            AND date >= now() - interval '30 days'`,
        [client_id],
      ).catch(() => ({ rows: [{ degree: null }] })),
    ]);

    // Hidden links через device_fingerprints + ip_links
    const [devRows, ipRows] = await Promise.all([
      query(
        `SELECT df.fingerprint, COUNT(*) OVER (PARTITION BY df.fingerprint) AS shared_count
           FROM device_fingerprints df
          WHERE df.client_id = $1
            AND EXISTS (
              SELECT 1 FROM device_fingerprints df2
               WHERE df2.fingerprint = df.fingerprint AND df2.client_id != $1
            )
          LIMIT 5`,
        [client_id],
      ).catch(() => ({ rows: [] })),
      query(
        `SELECT il.ip, il.client_id_a, il.client_id_b, il.shared_count
           FROM ip_links il
          WHERE (il.client_id_a = $1 OR il.client_id_b = $1)
            AND il.shared_count > 2
          ORDER BY il.shared_count DESC
          LIMIT 10`,
        [client_id],
      ).catch(() => ({ rows: [] })),
    ]);

    const deviceMap = {};
    for (const row of devRows.rows) {
      if (!deviceMap[row.fingerprint]) {
        deviceMap[row.fingerprint] = { fingerprint: row.fingerprint, shared_count: row.shared_count, shared_clients: [] };
      }
    }

    const linkedViaIp = ipRows.rows.map((r) => ({
      ip:           r.ip,
      other_client: r.client_id_a === String(client_id) ? r.client_id_b : r.client_id_a,
      shared_count: r.shared_count,
    }));

    res.json({
      ok: true,
      driver_id,
      client_id,
      trend_7d:       riskRows.rows,   // alias для фронта (то же что risk_history)
      risk_history:   riskRows.rows,
      recent_orders:  ordersRows.rows,
      recent_tickets: ticketsRows.rows,
      graph_summary: {
        driver_degree: driverDeg.rows[0]?.degree ?? null,
        client_degree: clientDeg.rows[0]?.degree ?? null,
      },
      hidden_links: {
        shared_device_count: Object.keys(deviceMap).length,
        device_clusters:     Object.values(deviceMap),
        linked_via_ip:       linkedViaIp,
      },
      // backward-compat
      shared_devices: Object.values(deviceMap),
      linked_via_ip:  linkedViaIp,
    });
  } catch (err) {
    req.log.error({ err: String(err) }, "workbench /pair-context failed");
    res.status(500).json({ ok: false, error: "db_error", detail: String(err?.message || err) });
  }
});

// ─────────────────────────────────────── helpers ────────────────────────────

// ─────────────────────── GET /workbench/suspicious-orders v2 ─────────────────
//
// Evidence layer v2: флаги, primary_orders, patterns, evidence_confidence,
// suggested_action, hidden links. Используется в карточке кейса Workbench.
//
// Флаги и веса:
//   is_short_trip          (km < shortKm)       → +10
//   is_fast_arrival        (arr < fastMin мин)   → +10
//   is_noncash             (payment=noncash)      → +15
//   is_repeat_pair         (≥4 заказов/день)      → +20
//   is_cancel_after_accept (status=taken_cancelled)→ +40
//
// primary_flag priority: cancel_after_accept → repeat_pair+noncash → max_weight
// evidence_confidence: +40 cancel, +30 shared_device, +20 repeat_ratio>70%, +10 count≥5

const SuspiciousOrdersQuery = z.object({
  driver_id: z.string().min(1).max(64),
  client_id: z.string().min(1).max(64),
  date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  limit:     z.coerce.number().int().min(1).max(50).optional(),
}).strict();

function _primaryFlag(row) {
  if (row.is_cancel_after_accept) return { flag: "cancel_after_accept", weight: 40 };
  if (row.is_repeat_pair && row.is_noncash) return { flag: "repeat_noncash", weight: 35 };
  if (row.is_repeat_pair)  return { flag: "repeat_pair",  weight: 20 };
  if (row.is_noncash)      return { flag: "noncash",      weight: 15 };
  if (row.is_short_trip)   return { flag: "short_trip",   weight: 10 };
  if (row.is_fast_arrival) return { flag: "fast_arrival", weight: 10 };
  return { flag: null, weight: 0 };
}

function _buildPatterns(items, fc) {
  const patterns = [];

  // pattern: cancel_after_accept
  const cancelOrders = items.filter((o) => o.is_cancel_after_accept);
  if (cancelOrders.length > 0) {
    patterns.push({
      type:          "cancel_after_accept",
      count:         cancelOrders.length,
      sample_orders: cancelOrders.slice(0, 3).map((o) => o.order_id),
    });
  }

  // pattern: short_noncash (короткая безналичная поездка)
  const shortNoncash = items.filter((o) => o.is_short_trip && o.is_noncash);
  if (shortNoncash.length > 0) {
    patterns.push({
      type:          "short_noncash",
      count:         shortNoncash.length,
      sample_orders: shortNoncash.slice(0, 3).map((o) => o.order_id),
    });
  }

  // pattern: repeat_pair (если пара вообще repeat — берём все заказы дня)
  if (fc.repeat_pair > 0) {
    patterns.push({
      type:          "repeat_pair",
      count:         items.length,
      sample_orders: items.slice(0, 3).map((o) => o.order_id),
    });
  }

  return patterns;
}

function _suggestedAction(confidence, fc, sharedDeviceCount) {
  if (fc.cancel_after_accept > 0 && confidence >= 60) {
    return { action: "confirm_fraud", reason: "cancel abuse" };
  }
  if (sharedDeviceCount > 0 && confidence >= 60) {
    return { action: "confirm_fraud", reason: "multi account" };
  }
  if (confidence >= 40) {
    return { action: "monitor", reason: "mixed signals" };
  }
  return { action: "false_positive", reason: "weak signal" };
}

workbenchRouter.get("/suspicious-orders", requireAuth(), async (req, res) => {
  const parsed = SuspiciousOrdersQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_query", details: parsed.error.flatten() });
  }
  const { driver_id, client_id, date } = parsed.data;
  const limit = parsed.data.limit ?? 20;

  // Thresholds
  const thr = await query(
    `SELECT COALESCE((value->>'short_trip_km')::numeric, 3)     AS short_km,
            COALESCE((value->>'fast_arrival_min')::numeric, 5)  AS fast_min
       FROM settings WHERE key = 'risk_thresholds'
       LIMIT 1`,
  );
  const shortKm  = Number(thr.rows[0]?.short_km  ?? 3);
  const fastMin  = Number(thr.rows[0]?.fast_min  ?? 5);
  const REPEAT_PAIR_MIN = 4;

  try {
    // ── 1. Основные поездки ──────────────────────────────────────────────────
    const r = await query(
      `WITH pair_orders AS (
         SELECT
           o.order_id,
           to_char(o.order_date, 'YYYY-MM-DD')    AS date,
           o.driver_id,
           o.client_id,
           o.status,
           o.gmv::float                            AS gmv,
           o.km::float                             AS km,
           o.trip_minutes::float                   AS trip_minutes,
           o.arrival_minutes::float                AS arrival_minutes,
           o.payment_type,
           o.created_at,
           (o.km IS NOT NULL AND o.km < $3)::bool                          AS is_short_trip,
           (o.arrival_minutes IS NOT NULL AND o.arrival_minutes < $4)::bool AS is_fast_arrival,
           (o.payment_type = 'noncash')::bool                              AS is_noncash,
           (o.status = 'taken_cancelled')::bool                            AS is_cancel_after_accept,
           (SELECT COUNT(*) FROM orders o2
             WHERE o2.driver_id = $1 AND o2.client_id = $2
               AND o2.order_date = $5::date)::int                          AS pair_orders_day
         FROM orders o
         WHERE o.driver_id = $1
           AND o.client_id = $2
           AND o.order_date = $5::date
       ),
       scored AS (
         SELECT
           *,
           (pair_orders_day >= $6)::bool AS is_repeat_pair,
           (
             CASE WHEN (km IS NOT NULL AND km < $3) THEN 10 ELSE 0 END
             + CASE WHEN (arrival_minutes IS NOT NULL AND arrival_minutes < $4) THEN 10 ELSE 0 END
             + CASE WHEN payment_type = 'noncash' THEN 15 ELSE 0 END
             + CASE WHEN pair_orders_day >= $6 THEN 20 ELSE 0 END
             + CASE WHEN status = 'taken_cancelled' THEN 40 ELSE 0 END
           ) AS risk_score
         FROM pair_orders
       )
       SELECT
         order_id, date, driver_id, client_id,
         status, gmv, km, trip_minutes, arrival_minutes, payment_type, created_at,
         is_short_trip, is_fast_arrival, is_noncash, is_repeat_pair, is_cancel_after_accept,
         risk_score,
         jsonb_build_object(
           'is_short_trip',          is_short_trip,
           'is_fast_arrival',        is_fast_arrival,
           'is_noncash',             is_noncash,
           'is_repeat_pair',         is_repeat_pair,
           'is_cancel_after_accept', is_cancel_after_accept
         ) AS flags
       FROM scored
       ORDER BY risk_score DESC, is_cancel_after_accept DESC, is_noncash DESC
       LIMIT $7`,
      [driver_id, client_id, shortKm, fastMin, date, REPEAT_PAIR_MIN, limit],
    );

    // ── 2. Hidden links (device_fingerprints) ────────────────────────────────
    const devR = await query(
      `SELECT
           df.fingerprint,
           COUNT(*) OVER (PARTITION BY df.fingerprint) AS shared_count,
           df2.client_id                               AS related_client
         FROM device_fingerprints df
         JOIN device_fingerprints df2
              ON df2.fingerprint = df.fingerprint AND df2.client_id != $1
        WHERE df.client_id = $1
        LIMIT 20`,
      [client_id],
    ).catch(() => ({ rows: [] }));

    const deviceMap = {};
    const relatedClientsSet = new Set();
    for (const row of devR.rows) {
      if (!deviceMap[row.fingerprint]) {
        deviceMap[row.fingerprint] = { fingerprint: row.fingerprint, shared_count: Number(row.shared_count) };
      }
      if (row.related_client) relatedClientsSet.add(String(row.related_client));
    }
    const sharedDeviceCount  = Object.keys(deviceMap).length;
    const deviceClusterSize  = sharedDeviceCount > 0
      ? Math.max(...Object.values(deviceMap).map((d) => d.shared_count))
      : 0;
    const relatedClients     = [...relatedClientsSet].slice(0, 10);

    // ── 3. Обогащаем items primary_flag ─────────────────────────────────────
    const items = r.rows.map((row) => {
      const { flag, weight } = _primaryFlag(row);
      return { ...row, primary_flag: flag, primary_reason_weight: weight };
    });

    // ── 4. Flag counts ────────────────────────────────────────────────────────
    const flag_counts = items.reduce(
      (acc, row) => {
        if (row.is_short_trip)          acc.short_trip++;
        if (row.is_fast_arrival)        acc.fast_arrival++;
        if (row.is_noncash)             acc.noncash++;
        if (row.is_repeat_pair)         acc.repeat_pair++;
        if (row.is_cancel_after_accept) acc.cancel_after_accept++;
        return acc;
      },
      { short_trip: 0, fast_arrival: 0, noncash: 0, repeat_pair: 0, cancel_after_accept: 0, total_orders: items.length },
    );

    // ── 5. Primary orders (top-2 по priority) ───────────────────────────────
    const primarySorted = [...items].sort((a, b) => {
      // cancel_after_accept всегда первые
      if (a.is_cancel_after_accept && !b.is_cancel_after_accept) return -1;
      if (!a.is_cancel_after_accept && b.is_cancel_after_accept) return 1;
      return b.primary_reason_weight - a.primary_reason_weight;
    });
    const primary_orders = primarySorted.slice(0, 2);

    // ── 6. Patterns ───────────────────────────────────────────────────────────
    const patterns = _buildPatterns(items, flag_counts);

    // device_cluster pattern если есть
    if (sharedDeviceCount > 0) {
      patterns.push({
        type:          "device_cluster",
        count:         sharedDeviceCount,
        sample_orders: [],
      });
    }

    // ── 7. Evidence confidence ────────────────────────────────────────────────
    let confidence = 0;
    if (flag_counts.cancel_after_accept > 0)                confidence += 40;
    if (sharedDeviceCount > 0)                              confidence += 30;
    if (items.length > 0 && flag_counts.repeat_pair / items.length > 0.7) confidence += 20;
    if (items.length >= 5)                                  confidence += 10;
    confidence = Math.min(100, confidence);

    // ── 8. Suggested action ───────────────────────────────────────────────────
    const suggested = _suggestedAction(confidence, flag_counts, sharedDeviceCount);

    res.json({
      ok: true,
      driver_id,
      client_id,
      date,
      count: items.length,
      flag_counts,
      primary_orders,
      patterns,
      evidence_confidence: confidence,
      suggested_action:    suggested.action,
      suggested_reason:    suggested.reason,
      hidden_links: {
        shared_device_count: sharedDeviceCount,
        device_cluster_size: deviceClusterSize,
        related_clients:     relatedClients,
      },
      items,
    });
  } catch (err) {
    req.log.error({ err: String(err) }, "workbench /suspicious-orders failed");
    res.status(500).json({ ok: false, error: "db_error", detail: String(err?.message || err) });
  }
});

function _buildWhy(row) {
  const reasons = [];
  const signals = row.signals || {};
  const mlRaw   = row.ml_score_raw;
  const mlScore   = mlRaw != null ? Math.round(mlRaw * 100) : null;
  const ruleScore = Number(row.rule_score) || 0;

  // 1. ML высокий score
  if (mlScore != null && mlScore >= 70) {
    reasons.push({ key: "ml_high", label: "ML: высокий риск", value: `score ${mlScore}`, severity: "high" });
  }

  // 2. Сильное расхождение ML vs правила
  const delta = mlScore != null ? mlScore - ruleScore : null;
  if (delta != null && Math.abs(delta) >= 25) {
    const sign = delta > 0 ? "+" : "";
    reasons.push({
      key: "strong_delta",
      label: delta > 0 ? "ML видит больше правил" : "Правила видят больше ML",
      value: `delta ${sign}${delta}`,
      severity: Math.abs(delta) >= 40 ? "high" : "medium",
    });
  }

  // 3. Повторный фрод
  const prevFlags = Number(row.previous_flags_count) || Number(signals.previous_confirmed_fraud_count) || 0;
  if (prevFlags > 0) {
    reasons.push({
      key: "repeat_fraud",
      label: "Ранее подтверждён фрод",
      value: `${prevFlags} раз`,
      severity: "high",
    });
  }

  // 4. repeat_ratio (подозрительно высокая доля повторов пары)
  const repeatRatio = Number(row.repeat_ratio) || Number(signals.repeat_ratio) || 0;
  if (repeatRatio >= 0.6) {
    reasons.push({
      key: "repeat_ratio",
      label: "Высокая доля повторных поездок",
      value: `${Math.round(repeatRatio * 100)}%`,
      severity: repeatRatio >= 0.8 ? "high" : "medium",
    });
  }

  // 5. Suspicious ratio — комбо noncash/short/fast
  const noncashR = Number(row.noncash_ratio)      || Number(signals.noncash_ratio)      || 0;
  const shortR   = Number(row.short_trip_ratio)   || Number(signals.short_trip_ratio)   || 0;
  const fastR    = Number(row.fast_arrival_ratio)  || Number(signals.fast_arrival_ratio) || 0;
  const suspicious = [
    noncashR >= 0.7 ? `безнал ${Math.round(noncashR * 100)}%` : null,
    shortR   >= 0.6 ? `короткие ${Math.round(shortR   * 100)}%` : null,
    fastR    >= 0.7 ? `быстрый подъезд ${Math.round(fastR * 100)}%` : null,
  ].filter(Boolean);
  if (suspicious.length >= 2) {
    reasons.push({
      key: "suspicious_ratio",
      label: "Подозрительная структура поездок",
      value: suspicious.join(", "),
      severity: "medium",
    });
  }

  // 6. Cashback risk
  const cashbackMoney = Number(signals.cashback_money_byn) || Number(signals.cashback_risk_byn) || Number(row.cashback_risk_byn) || 0;
  if (cashbackMoney > 5) {
    reasons.push({
      key: "cashback_risk",
      label: "Риск кэшбэка",
      value: `${cashbackMoney.toFixed(2)} BYN`,
      severity: cashbackMoney > 20 ? "high" : "medium",
    });
  }

  // 7. Guarantee risk
  const guaranteeMoney = Number(signals.guarantee_money_byn) || Number(signals.guarantee_risk_byn) || Number(row.guarantee_risk_byn) || 0;
  if (guaranteeMoney > 0 && reasons.length < 4) {
    reasons.push({
      key: "guarantee_risk",
      label: "Риск гарантийной выплаты",
      value: `${guaranteeMoney.toFixed(2)} BYN`,
      severity: "medium",
    });
  }

  // 8. Источник обнаружения
  const src = signals.disagreement_type || signals.source || signals.risk_type;
  if (src === "ML_DISCOVERY" && reasons.length < 5) {
    reasons.push({ key: "ml_only", label: "Только ML, правила не сработали", value: null, severity: "medium" });
  }

  // 6b. Evidence: cancel after accept (из suspicious_flag_counts)
  const sfc = row.suspicious_flag_counts;
  if (sfc && sfc.cancel_after_accept > 0) {
    reasons.push({
      key: "cancel_after_accept",
      label: `Отмены после принятия (${sfc.cancel_after_accept} шт.)`,
      value: `из ${sfc.total_orders} заказов`,
      severity: sfc.cancel_after_accept >= 2 ? "high" : "medium",
    });
  }

  // 6c. Evidence: короткие поездки + безнал из orders (если нет из ratios)
  if (sfc && sfc.total_orders > 0 && reasons.length < 4) {
    const hasShort  = sfc.short_trip > 0;
    const hasNoncash = sfc.noncash > 0;
    if (hasShort && !reasons.find((r) => r.key === "suspicious_ratio")) {
      reasons.push({
        key: "evidence_short",
        label: `Короткие поездки (${sfc.short_trip} из ${sfc.total_orders})`,
        value: `${Math.round(sfc.short_trip / sfc.total_orders * 100)}%`,
        severity: "medium",
      });
    }
    if (hasNoncash && sfc.noncash >= sfc.total_orders * 0.7 && !reasons.find((r) => r.key === "suspicious_ratio")) {
      reasons.push({
        key: "evidence_noncash",
        label: `Безналичные поездки (${sfc.noncash} из ${sfc.total_orders})`,
        value: `${Math.round(sfc.noncash / sfc.total_orders * 100)}%`,
        severity: "medium",
      });
    }
  }

  // 9. Top ML features (если мало причин)
  if (reasons.length < 3) {
    const topFeatures = row.top_features || signals.top_features;
    if (Array.isArray(topFeatures) && topFeatures.length > 0) {
      const top = topFeatures.slice(0, 3);
      reasons.push({
        key: "ml_features",
        label: "Ключевые ML-признаки",
        value: top.map((f) => (typeof f === "object" ? (f.feature_name || f.name || JSON.stringify(f)) : String(f))).join(", "),
        severity: "info",
      });
    }
  }

  return reasons.slice(0, 6);
}
