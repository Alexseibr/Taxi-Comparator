// lib/fraud_tickets.mjs — T015 Fraud Decision Workflow.
//
// Decision-слой ПОВЕРХ существующих risk-таблиц. Не меняет формулы риска,
// не трогает daily_*-таблицы. Работает идемпотентно: один тикет на сущность
// за день, повторный пересчёт обновляет risk_score/money/signals/suspicious_orders
// только если status IN ('new','in_review').
//
// Используется из lib/etl.mjs:
//   await recomputeFraudTickets(c, date, log)
// в ТОЙ ЖЕ транзакции, где только что пересчитаны *_risk_daily,
// чтобы тикеты видели свежие риски.

const RISK_THRESHOLD = 60;          // тикет создаётся при total_risk >= 60
const HIGH_THRESHOLD = 80;          // priority=high
const MEDIUM_THRESHOLD = 60;        // priority=medium (== RISK_THRESHOLD)
const SUSPICIOUS_LIMIT = 10;        // сколько заказов класть в suspicious_orders

export function priorityFromRisk(score) {
  const x = Number(score) || 0;
  if (x >= HIGH_THRESHOLD) return "high";
  if (x >= MEDIUM_THRESHOLD) return "medium";
  return "low";
}

/**
 * Идемпотентно пересоздаёт fraud_tickets за указанную дату.
 * @param {import('pg').PoolClient} c - открытый клиент в активной транзакции
 * @param {string} date - YYYY-MM-DD
 * @param {object} [log] - pino-логгер (необязательно)
 */
export async function recomputeFraudTickets(c, date, log) {
  const counts = { driver: 0, client: 0, pair: 0 };

  counts.driver = await upsertDriverTickets(c, date);
  counts.client = await upsertClientTickets(c, date);
  counts.pair   = await upsertPairTickets(c, date);

  log?.info({ date, ...counts }, "fraud tickets recomputed");
  return counts;
}

// ───────────────────────────────────────────── DRIVER ─────────────────
// risk_type выбирается по тому, какая из трёх driver-моделей даёт максимум.
// suspicious_orders — топ-10 заказов водителя за дату по комбинации признаков
// (короткий+быстрая подача+безнал, затем по убыванию gmv).
async function upsertDriverTickets(c, date) {
  const r = await c.query(
    `
    INSERT INTO fraud_tickets (
      entity_type, driver_id, client_id, date,
      risk_score, risk_type, money_at_risk_byn,
      priority, signals, suspicious_orders, previous_flags_count,
      created_by
    )
    SELECT
      'driver',
      r.driver_id,
      NULL,
      r.date,
      r.total_risk,
      CASE
        WHEN r.guarantee_risk >= r.earnings_risk AND r.guarantee_risk >= r.collusion_risk THEN 'guarantee'
        WHEN r.earnings_risk  >= r.collusion_risk                                          THEN 'earnings'
        ELSE 'collusion'
      END,
      r.money_at_risk_byn,
      CASE WHEN r.total_risk >= $2 THEN 'high'
           WHEN r.total_risk >= $3 THEN 'medium'
           ELSE 'low' END,
      jsonb_build_object(
        'driver_name',          d.name,
        'guarantee_risk',       r.guarantee_risk,
        'earnings_risk',        r.earnings_risk,
        'collusion_risk',       r.collusion_risk,
        'guarantee_money_byn',  r.guarantee_money_byn,
        'earnings_money_byn',   r.earnings_money_byn,
        'collusion_money_byn',  r.collusion_money_byn,
        'risk_signals',         r.signals
      ),
      COALESCE(susp.orders, '[]'::jsonb),
      COALESCE(prev.cnt, 0),
      'system'
    FROM driver_risk_daily r
    LEFT JOIN drivers d ON d.id = r.driver_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt
        FROM fraud_tickets ft
       WHERE ft.entity_key = 'driver|' || r.driver_id || '|'
         AND ft.status = 'confirmed_fraud'
         AND ft.date < r.date
    ) prev ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
                'order_id',         o.order_id,
                'created_at',       o.created_at,
                'status',           o.status,
                'payment_type',     o.payment_type,
                'gmv',              o.gmv,
                'km',               o.km,
                'arrival_minutes',  o.arrival_minutes,
                'trip_minutes',     o.trip_minutes,
                'client_id',        o.client_id,
                'flags', jsonb_build_object(
                  'short',     (o.km IS NOT NULL AND o.km < 2),
                  'fast_arr',  (o.arrival_minutes IS NOT NULL AND o.arrival_minutes < 3),
                  'noncash',   (o.payment_type = 'noncash')
                )
             ) ORDER BY o.score DESC, o.gmv DESC NULLS LAST) AS orders
        FROM (
          SELECT *,
                 (CASE WHEN km IS NOT NULL AND km < 2 THEN 1 ELSE 0 END) +
                 (CASE WHEN arrival_minutes IS NOT NULL AND arrival_minutes < 3 THEN 1 ELSE 0 END) +
                 (CASE WHEN payment_type = 'noncash' THEN 1 ELSE 0 END) AS score
            FROM orders
           WHERE driver_id = r.driver_id AND order_date = r.date
           ORDER BY score DESC, gmv DESC NULLS LAST
           LIMIT $4
        ) o
    ) susp ON TRUE
    WHERE r.date = $1 AND r.total_risk >= $3
    ON CONFLICT (entity_key, date) DO UPDATE
      SET risk_score           = EXCLUDED.risk_score,
          risk_type            = EXCLUDED.risk_type,
          money_at_risk_byn    = EXCLUDED.money_at_risk_byn,
          priority             = EXCLUDED.priority,
          signals              = EXCLUDED.signals,
          suspicious_orders    = EXCLUDED.suspicious_orders,
          previous_flags_count = EXCLUDED.previous_flags_count,
          updated_at           = now()
      WHERE fraud_tickets.status IN ('new','in_review')
    RETURNING ticket_id, (xmax = 0) AS inserted
    `,
    [date, HIGH_THRESHOLD, RISK_THRESHOLD, SUSPICIOUS_LIMIT],
  );

  // Журналим только реально созданные тикеты (не каждый UPDATE).
  const created = r.rows.filter((x) => x.inserted).map((x) => x.ticket_id);
  if (created.length) await logCreated(c, created);
  return r.rowCount;
}

// ───────────────────────────────────────────── CLIENT ─────────────────
async function upsertClientTickets(c, date) {
  const r = await c.query(
    `
    INSERT INTO fraud_tickets (
      entity_type, driver_id, client_id, date,
      risk_score, risk_type, money_at_risk_byn,
      priority, signals, suspicious_orders, previous_flags_count,
      created_by
    )
    SELECT
      'client',
      NULL,
      r.client_id,
      r.date,
      r.total_risk,
      CASE
        WHEN r.cashback_exposure        >= r.repeat_driver_dependency
         AND r.cashback_exposure        >= r.suspicious_activity        THEN 'cashback'
        WHEN r.repeat_driver_dependency >= r.suspicious_activity        THEN 'collusion'
        ELSE 'earnings'
      END,
      r.money_at_risk_byn,
      CASE WHEN r.total_risk >= $2 THEN 'high'
           WHEN r.total_risk >= $3 THEN 'medium'
           ELSE 'low' END,
      jsonb_build_object(
        'client_phone',             cl.phone,
        'cashback_exposure',        r.cashback_exposure,
        'repeat_driver_dependency', r.repeat_driver_dependency,
        'suspicious_activity',      r.suspicious_activity,
        'cashback_money_byn',       r.cashback_money_byn,
        'total_orders',             r.total_orders,
        'risk_signals',             r.signals
      ),
      COALESCE(susp.orders, '[]'::jsonb),
      COALESCE(prev.cnt, 0),
      'system'
    FROM client_risk_daily r
    LEFT JOIN clients cl ON cl.id = r.client_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt
        FROM fraud_tickets ft
       WHERE ft.entity_key = 'client||' || r.client_id
         AND ft.status = 'confirmed_fraud'
         AND ft.date < r.date
    ) prev ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
                'order_id',         o.order_id,
                'created_at',       o.created_at,
                'status',           o.status,
                'payment_type',     o.payment_type,
                'gmv',              o.gmv,
                'km',               o.km,
                'arrival_minutes',  o.arrival_minutes,
                'trip_minutes',     o.trip_minutes,
                'driver_id',        o.driver_id,
                'flags', jsonb_build_object(
                  'short',     (o.km IS NOT NULL AND o.km < 2),
                  'fast_arr',  (o.arrival_minutes IS NOT NULL AND o.arrival_minutes < 3),
                  'noncash',   (o.payment_type = 'noncash')
                )
             ) ORDER BY o.score DESC, o.gmv DESC NULLS LAST) AS orders
        FROM (
          SELECT *,
                 (CASE WHEN km IS NOT NULL AND km < 2 THEN 1 ELSE 0 END) +
                 (CASE WHEN arrival_minutes IS NOT NULL AND arrival_minutes < 3 THEN 1 ELSE 0 END) +
                 (CASE WHEN payment_type = 'noncash' THEN 1 ELSE 0 END) AS score
            FROM orders
           WHERE client_id = r.client_id AND order_date = r.date
           ORDER BY score DESC, gmv DESC NULLS LAST
           LIMIT $4
        ) o
    ) susp ON TRUE
    WHERE r.date = $1 AND r.total_risk >= $3
    ON CONFLICT (entity_key, date) DO UPDATE
      SET risk_score           = EXCLUDED.risk_score,
          risk_type            = EXCLUDED.risk_type,
          money_at_risk_byn    = EXCLUDED.money_at_risk_byn,
          priority             = EXCLUDED.priority,
          signals              = EXCLUDED.signals,
          suspicious_orders    = EXCLUDED.suspicious_orders,
          previous_flags_count = EXCLUDED.previous_flags_count,
          updated_at           = now()
      WHERE fraud_tickets.status IN ('new','in_review')
    RETURNING ticket_id, (xmax = 0) AS inserted
    `,
    [date, HIGH_THRESHOLD, RISK_THRESHOLD, SUSPICIOUS_LIMIT],
  );
  const created = r.rows.filter((x) => x.inserted).map((x) => x.ticket_id);
  if (created.length) await logCreated(c, created);
  return r.rowCount;
}

// ───────────────────────────────────────────── PAIR ───────────────────
async function upsertPairTickets(c, date) {
  const r = await c.query(
    `
    INSERT INTO fraud_tickets (
      entity_type, driver_id, client_id, date,
      risk_score, risk_type, money_at_risk_byn,
      priority, signals, suspicious_orders, previous_flags_count,
      created_by
    )
    SELECT
      'pair',
      r.driver_id,
      r.client_id,
      r.date,
      r.total_risk,
      'collusion',
      r.collusion_loss_risk_byn,
      CASE WHEN r.total_risk >= $2 THEN 'high'
           WHEN r.total_risk >= $3 THEN 'medium'
           ELSE 'low' END,
      jsonb_build_object(
        'driver_name',          d.name,
        'client_phone',         cl.phone,
        'orders_count',         r.orders_count,
        'noncash_gmv',          r.noncash_gmv,
        'repeat_ratio',         r.repeat_ratio,
        'suspicious_ratio',     r.suspicious_ratio,
        'cashback_dependency',  r.cashback_dependency,
        'collusion_loss_risk_byn', r.collusion_loss_risk_byn,
        'risk_signals',         r.signals
      ),
      COALESCE(susp.orders, '[]'::jsonb),
      COALESCE(prev.cnt, 0),
      'system'
    FROM pair_risk_daily r
    LEFT JOIN drivers d  ON d.id  = r.driver_id
    LEFT JOIN clients cl ON cl.id = r.client_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS cnt
        FROM fraud_tickets ft
       WHERE ft.entity_key = 'pair|' || r.driver_id || '|' || r.client_id
         AND ft.status = 'confirmed_fraud'
         AND ft.date < r.date
    ) prev ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
                'order_id',         o.order_id,
                'created_at',       o.created_at,
                'status',           o.status,
                'payment_type',     o.payment_type,
                'gmv',              o.gmv,
                'km',               o.km,
                'arrival_minutes',  o.arrival_minutes,
                'trip_minutes',     o.trip_minutes,
                'flags', jsonb_build_object(
                  'short',     (o.km IS NOT NULL AND o.km < 2),
                  'fast_arr',  (o.arrival_minutes IS NOT NULL AND o.arrival_minutes < 3),
                  'noncash',   (o.payment_type = 'noncash')
                )
             ) ORDER BY o.score DESC, o.gmv DESC NULLS LAST) AS orders
        FROM (
          SELECT *,
                 (CASE WHEN km IS NOT NULL AND km < 2 THEN 1 ELSE 0 END) +
                 (CASE WHEN arrival_minutes IS NOT NULL AND arrival_minutes < 3 THEN 1 ELSE 0 END) +
                 (CASE WHEN payment_type = 'noncash' THEN 1 ELSE 0 END) AS score
            FROM orders
           WHERE driver_id = r.driver_id AND client_id = r.client_id AND order_date = r.date
           ORDER BY score DESC, gmv DESC NULLS LAST
           LIMIT $4
        ) o
    ) susp ON TRUE
    WHERE r.date = $1 AND r.total_risk >= $3
    ON CONFLICT (entity_key, date) DO UPDATE
      SET risk_score           = EXCLUDED.risk_score,
          risk_type            = EXCLUDED.risk_type,
          money_at_risk_byn    = EXCLUDED.money_at_risk_byn,
          priority             = EXCLUDED.priority,
          signals              = EXCLUDED.signals,
          suspicious_orders    = EXCLUDED.suspicious_orders,
          previous_flags_count = EXCLUDED.previous_flags_count,
          updated_at           = now()
      WHERE fraud_tickets.status IN ('new','in_review')
    RETURNING ticket_id, (xmax = 0) AS inserted
    `,
    [date, HIGH_THRESHOLD, RISK_THRESHOLD, SUSPICIOUS_LIMIT],
  );
  const created = r.rows.filter((x) => x.inserted).map((x) => x.ticket_id);
  if (created.length) await logCreated(c, created);
  return r.rowCount;
}

async function logCreated(c, ticketIds) {
  await c.query(
    `INSERT INTO fraud_ticket_events (ticket_id, action, new_status, user_id)
     SELECT unnest($1::bigint[]), 'created', 'new', 'system'`,
    [ticketIds],
  );
}

// ─────────────────────────── DECISION (вызывается из routes/tickets.mjs) ─
//
// Разделено по сторонним эффектам:
//   driver + deny_payout   → driver_shift_attendance.payout_byn = 0,
//                            money_saved_byn = старая сумма payout_byn,
//                            ticket.status = 'confirmed_fraud'
//   client + block_cashback → clients.cashback_blocked = true,
//                            money_saved_byn = signals.cashback_money_byn,
//                            ticket.status = 'confirmed_fraud'
//   *      + allow         → status='false_positive', money_saved=0
//   *      + monitor       → status='in_review', money_saved=0
//   pair   + любая «осуждающая» (deny_payout/block_cashback здесь нелогично) →
//                            принимаем как 'monitor' и просим использовать
//                            decision='monitor' либо подтверждать через client.
//                            Если decision='allow' → false_positive.
//
// На каждый вызов пишем fraud_ticket_events.

export async function applyDecision(c, ticket, { decision, comment, userLogin, userId }) {
  if (!ticket) throw new Error("ticket_not_found");
  if (!["deny_payout", "allow", "block_cashback", "monitor"].includes(decision)) {
    throw new Error("bad_decision");
  }

  const oldStatus = ticket.status;
  let newStatus = oldStatus;
  let moneySavedDelta = null;
  let extraMeta = {};

  if (decision === "allow") {
    newStatus = "false_positive";
    moneySavedDelta = 0;
  } else if (decision === "monitor") {
    newStatus = "in_review";
    moneySavedDelta = 0;
  } else if (decision === "deny_payout") {
    // Допустимо для driver-тикета и для pair (применяется к driver-у из пары).
    // client-тикетов сюда не пускаем — у клиента нет гарантийной выплаты.
    if (ticket.entity_type === "client" || !ticket.driver_id) {
      throw new Error("deny_payout_requires_driver");
    }
    // Снимаем выплату по гарантии: суммарно по всем сменам водителя за дату,
    // которые ещё были qualified=true.
    const upd = await c.query(
      `UPDATE driver_shift_attendance
          SET payout_byn = 0
        WHERE driver_id = $1 AND date = $2 AND qualified = true AND payout_byn > 0
       RETURNING payout_byn`,
      [ticket.driver_id, ticket.date],
    );
    // Сумму экономии берём из signals в момент создания тикета:
    //   driver → guarantee_money_byn (фактическая суточная гарантия драйвера),
    //   pair   → collusion_loss_risk_byn (переплата по сговору этой пары —
    //            используется как нижняя оценка предотвращённого убытка).
    moneySavedDelta =
      ticket.entity_type === "driver"
        ? (Number(ticket.signals?.guarantee_money_byn) || 0)
        : (Number(ticket.signals?.collusion_loss_risk_byn) || 0);
    extraMeta.attendance_rows_zeroed = upd.rowCount;
    extraMeta.applied_to_driver_id = ticket.driver_id;
    newStatus = "confirmed_fraud";
  } else if (decision === "block_cashback") {
    // Допустимо для client-тикета и для pair (применяется к client-у из пары).
    // driver-тикетов сюда не пускаем — у водителя нет кэшбэка.
    if (ticket.entity_type === "driver" || !ticket.client_id) {
      throw new Error("block_cashback_requires_client");
    }
    await c.query(
      `UPDATE clients
          SET cashback_blocked = true,
              cashback_blocked_at = now(),
              cashback_blocked_by = $2
        WHERE id = $1`,
      [ticket.client_id, userLogin || "system"],
    );
    // client → cashback_money_byn (cashback клиента за дату),
    // pair   → collusion_loss_risk_byn (переплата кэшбэка по этой паре).
    moneySavedDelta =
      ticket.entity_type === "client"
        ? (Number(ticket.signals?.cashback_money_byn) || 0)
        : (Number(ticket.signals?.collusion_loss_risk_byn) || 0);
    extraMeta.applied_to_client_id = ticket.client_id;
    newStatus = "confirmed_fraud";
  }

  // Применяем к самому тикету.
  const upd = await c.query(
    `UPDATE fraud_tickets
        SET status        = $2,
            decision      = $3,
            money_saved_byn = COALESCE($4, money_saved_byn),
            comment       = COALESCE($5, comment),
            assigned_to   = COALESCE(assigned_to, $6),
            updated_at    = now()
      WHERE ticket_id = $1
      RETURNING *`,
    [ticket.ticket_id, newStatus, decision, moneySavedDelta, comment ?? null, userLogin ?? null],
  );

  await c.query(
    `INSERT INTO fraud_ticket_events (ticket_id, action, old_status, new_status, decision, comment, meta, user_id)
     VALUES ($1, 'decision', $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      ticket.ticket_id,
      oldStatus,
      newStatus,
      decision,
      comment ?? null,
      JSON.stringify({ money_saved_byn: moneySavedDelta, ...extraMeta }),
      userId ?? null,
    ],
  );

  // Авто-разметка ML: confirmed_fraud → label=1, false_positive → label=0.
  // monitor → без метки (решение не принято окончательно).
  const autoLabel = newStatus === "confirmed_fraud" ? 1
                  : newStatus === "false_positive"  ? 0
                  : null;
  if (autoLabel !== null) {
    let entityType = ticket.entity_type;
    let entityKey  = null;
    if (entityType === "pair")   entityKey = `${ticket.driver_id}:${ticket.client_id}`;
    else if (entityType === "driver") entityKey = String(ticket.driver_id);
    else if (entityType === "client") entityKey = String(ticket.client_id);

    if (entityKey) {
      await c.query(
        `INSERT INTO fraud_training_labels
           (entity_type, entity_key, date, label, comment, source_ticket_id,
            ml_score_at_label, rule_score_at_label, final_score_at_label, delta_at_label)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $7, NULL)
         ON CONFLICT (entity_type, entity_key, date)
         DO UPDATE SET label = EXCLUDED.label,
                       comment = COALESCE(EXCLUDED.comment, fraud_training_labels.comment),
                       source_ticket_id = EXCLUDED.source_ticket_id,
                       labeled_at = NOW()`,
        [
          entityType,
          entityKey,
          ticket.date,
          autoLabel,
          comment ?? `auto:${decision}`,
          ticket.ticket_id,
          ticket.risk_score ?? null,
        ],
      ).catch(() => {}); // не ломаем decision если labels таблица недоступна
    }
  }

  return upd.rows[0];
}
