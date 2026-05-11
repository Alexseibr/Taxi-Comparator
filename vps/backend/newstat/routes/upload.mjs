// routes/upload.mjs — POST /upload (массив заказов в JSON), POST /recompute
// Импорт: ON CONFLICT DO UPDATE по order_id (идемпотентно по order_id),
// после — ETL по уникальным датам.
import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { query, withTx } from "../lib/db.mjs";
import { requireAuth } from "../lib/auth.mjs";
import { recomputeForDates } from "../lib/etl.mjs";

export const uploadRouter = Router();

// Схема одного заказа. Все поля кроме order_id, order_date, status —
// необязательны: партнёрские источники дают разные форматы, мы лояльны.
const Order = z.object({
  order_id: z.string().trim().min(1),
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  status: z.string().trim().min(1),
  created_at: z.string().nullish(),
  cancelled_at: z.string().nullish(),
  payment_type: z.enum(["cash", "noncash"]).nullish(),
  payment_type2: z.string().nullish(),
  car_class_create: z.string().nullish(),
  car_class_appoint: z.string().nullish(),
  driver_id: z.string().nullish(),
  driver_name: z.string().nullish(),
  client_id: z.string().nullish(),
  client_phone: z.string().nullish(),
  gmv: z.number().nullish(),
  km: z.number().nullish(),
  arrival_minutes: z.number().nullish(),
  trip_minutes: z.number().nullish(),
  lat_in: z.number().nullish(),
  lng_in: z.number().nullish(),
  lat_out: z.number().nullish(),
  lng_out: z.number().nullish(),
  is_now: z.boolean().nullish(),
  // Hidden Links (T019): опциональные device/IP поля
  ip_address: z.string().max(64).nullish(),
  user_agent: z.string().max(512).nullish(),
  platform:   z.enum(["ios","android","web","unknown"]).nullish(),
  device_id:  z.string().max(128).nullish(),
}).passthrough();

const UploadBody = z.object({
  source: z.string().trim().min(1).max(64).default("manual"),
  orders: z.array(Order).min(1).max(50_000),
});

uploadRouter.post("/upload", requireAuth(["admin", "antifraud"]), async (req, res) => {
  try {
    await handleUpload(req, res);
  } catch (e) {
    req.log.error({ err: { msg: e?.message, code: e?.code, stack: e?.stack } }, "upload failed");
    res.status(500).json({ ok: false, error: "upload_failed", detail: e?.message || "unknown" });
  }
});

async function handleUpload(req, res) {
  const parsed = UploadBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_request", details: parsed.error.flatten() });
  }
  const { source, orders } = parsed.data;
  const batchId = "b_" + crypto.randomUUID();
  const dates = new Set();
  let inserted = 0;
  let updated = 0;
  let dupSkipped = 0;

  await withTx(async (c) => {
    await c.query(
      `INSERT INTO upload_batches(id, uploaded_by, source, total_rows, meta)
       VALUES ($1,$2,$3,$4,$5)`,
      [batchId, req.user.login, source, orders.length, JSON.stringify({})],
    );

    // Сначала справочники (drivers, clients) одним пакетом.
    const driverIds = new Set();
    const clientIds = new Set();
    for (const o of orders) {
      if (o.driver_id) driverIds.add(String(o.driver_id));
      if (o.client_id) clientIds.add(String(o.client_id));
    }
    for (const id of driverIds) {
      await c.query(
        `INSERT INTO drivers(id, name) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET name = COALESCE(EXCLUDED.name, drivers.name)`,
        [id, orders.find((x) => String(x.driver_id) === id)?.driver_name ?? null],
      );
    }
    for (const id of clientIds) {
      const clientPhone = orders.find((x) => String(x.client_id) === id)?.client_phone ?? null;
      await c.query(
        `INSERT INTO clients(id, phone) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET phone = COALESCE(EXCLUDED.phone, clients.phone)`,
        [id, clientPhone],
      );
      // PII: дублируем телефон в защищённое хранилище
      if (clientPhone) {
        await c.query(
          `INSERT INTO user_contacts_secure (entity_type, entity_id, phone)
           VALUES ('client', $1, $2)
           ON CONFLICT (entity_type, entity_id) DO UPDATE SET phone = EXCLUDED.phone, updated_at = NOW()`,
          [id, clientPhone],
        ).catch(() => {}); // не ломаем загрузку если таблица ещё не мигрирована
      }
    }

    // Hidden Links (T019): device fingerprints + IP links из поля заказов
    // Группируем по client_id чтобы не делать дубли
    const clientDeviceMap = new Map(); // client_id → { device_hash, user_agent, platform, ip_address, date }
    for (const o of orders) {
      if (!o.client_id) continue;
      const cid = String(o.client_id);
      const existing = clientDeviceMap.get(cid);
      const hasDevice = o.device_id || o.user_agent || o.platform;
      const hasIp = !!o.ip_address;
      if (!existing || hasDevice || hasIp) {
        const dHash = o.device_id
          ? crypto.createHash("sha256").update(o.device_id).digest("hex").slice(0, 32)
          : (o.user_agent || o.platform)
            ? crypto.createHash("sha256").update((o.user_agent || "") + "|" + (o.platform || "")).digest("hex").slice(0, 32)
            : null;
        clientDeviceMap.set(cid, {
          device_hash: dHash ?? existing?.device_hash ?? null,
          user_agent:  o.user_agent ?? existing?.user_agent ?? null,
          platform:    o.platform ?? existing?.platform ?? null,
          ip_address:  o.ip_address ?? existing?.ip_address ?? null,
          date:        o.order_date,
        });
      }
    }
    for (const [cid, fp] of clientDeviceMap.entries()) {
      if (fp.device_hash) {
        await c.query(
          `INSERT INTO device_fingerprints
             (entity_type, entity_id, device_hash, user_agent, platform, first_seen, last_seen)
           VALUES ('client',$1,$2,$3,$4,$5,$5)
           ON CONFLICT (entity_type, entity_id, device_hash)
           DO UPDATE SET last_seen = GREATEST(device_fingerprints.last_seen, EXCLUDED.last_seen),
                         user_agent = COALESCE(EXCLUDED.user_agent, device_fingerprints.user_agent)`,
          [cid, fp.device_hash, fp.user_agent, fp.platform, fp.date],
        ).catch(() => {}); // таблица может отсутствовать до миграции 015
      }
      if (fp.ip_address) {
        await c.query(
          `INSERT INTO ip_links (entity_type, entity_id, ip_address, first_seen, last_seen)
           VALUES ('client',$1,$2,$3,$3)
           ON CONFLICT (entity_type, entity_id, ip_address)
           DO UPDATE SET last_seen = GREATEST(ip_links.last_seen, EXCLUDED.last_seen)`,
          [cid, fp.ip_address, fp.date],
        ).catch(() => {}); // таблица может отсутствовать до миграции 015
      }
    }

    // Перед upsert считываем СТАРЫЕ order_date для тех же order_id —
    // если заказ переехал с даты A на дату B, обе даты должны попасть в ETL,
    // иначе на дате A останутся stale-агрегаты.
    const incomingIds = orders.map((o) => o.order_id);
    const existing = await c.query(
      `SELECT order_id, to_char(order_date, 'YYYY-MM-DD') AS d
         FROM orders WHERE order_id = ANY($1::text[])`,
      [incomingIds],
    );
    for (const row of existing.rows) {
      dates.add(row.d);
    }

    // Теперь сами заказы.
    for (const o of orders) {
      dates.add(o.order_date);
      const r = await c.query(
        `INSERT INTO orders(
           order_id, order_date, created_at, cancelled_at, gmv, km,
           client_id, driver_id, status, payment_type, payment_type2,
           car_class_create, car_class_appoint, is_now,
           arrival_minutes, trip_minutes,
           lat_in, lng_in, lat_out, lng_out, batch_id, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         ON CONFLICT (order_id) DO UPDATE SET
           order_date = EXCLUDED.order_date,
           created_at = EXCLUDED.created_at,
           cancelled_at = EXCLUDED.cancelled_at,
           gmv = EXCLUDED.gmv,
           km = EXCLUDED.km,
           client_id = EXCLUDED.client_id,
           driver_id = EXCLUDED.driver_id,
           status = EXCLUDED.status,
           payment_type = EXCLUDED.payment_type,
           payment_type2 = EXCLUDED.payment_type2,
           car_class_create = EXCLUDED.car_class_create,
           car_class_appoint = EXCLUDED.car_class_appoint,
           is_now = EXCLUDED.is_now,
           arrival_minutes = EXCLUDED.arrival_minutes,
           trip_minutes = EXCLUDED.trip_minutes,
           lat_in = EXCLUDED.lat_in,
           lng_in = EXCLUDED.lng_in,
           lat_out = EXCLUDED.lat_out,
           lng_out = EXCLUDED.lng_out,
           batch_id = EXCLUDED.batch_id,
           raw = EXCLUDED.raw,
           imported_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [
          o.order_id, o.order_date, o.created_at ?? null, o.cancelled_at ?? null,
          o.gmv ?? null, o.km ?? null,
          o.client_id ?? null, o.driver_id ?? null,
          o.status, o.payment_type ?? null, o.payment_type2 ?? null,
          o.car_class_create ?? null, o.car_class_appoint ?? null, o.is_now ?? null,
          o.arrival_minutes ?? null, o.trip_minutes ?? null,
          o.lat_in ?? null, o.lng_in ?? null, o.lat_out ?? null, o.lng_out ?? null,
          batchId, JSON.stringify(o),
        ],
      );
      if (r.rows[0]?.inserted) inserted++;
      else updated++;
    }

    await c.query(
      `UPDATE upload_batches SET inserted_rows = $1, duplicate_rows = $2 WHERE id = $3`,
      [inserted, updated, batchId],
    );
  });

  // ETL — ПОСЛЕ транзакции импорта. Если он упадёт, заказы уже сохранены —
  // отдельно сообщаем клиенту, что импорт ОК, а ETL надо перезапустить /recompute.
  const dateList = [...dates].sort();
  let etlResult = null;
  let etlError = null;
  try {
    etlResult = await recomputeForDates(dateList, req.log);
  } catch (e) {
    req.log.error(
      { err: { msg: e?.message, code: e?.code, stack: e?.stack }, dates: dateList },
      "etl failed after import — orders saved, attendance/stats stale",
    );
    etlError = e?.message || "etl_failed";
  }

  req.log.info(
    { batchId, total: orders.length, inserted, updated, dates: dateList.length, etl_ok: !etlError },
    "upload done",
  );
  res.status(etlError ? 207 : 200).json({
    ok: !etlError,
    batch_id: batchId,
    total: orders.length,
    inserted,
    updated,
    dates: dateList,
    import_ok: true,
    etl_ok: !etlError,
    etl: etlResult,
    etl_error: etlError,
  });
}

// Принудительный пересчёт ETL для указанных дат (на случай если поменяли cashback и хотим обновить exposure).
const RecomputeBody = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(366),
});

uploadRouter.post("/recompute", requireAuth(["admin"]), async (req, res) => {
  const parsed = RecomputeBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_request", details: parsed.error.flatten() });
  }
  try {
    const r = await recomputeForDates(parsed.data.dates, req.log);
    res.json({ ok: true, ...r });
  } catch (e) {
    req.log.error({ err: { msg: e?.message, code: e?.code, stack: e?.stack } }, "recompute failed");
    res.status(500).json({ ok: false, error: "recompute_failed", detail: e?.message || "unknown" });
  }
});

uploadRouter.get("/batches", requireAuth(), async (_req, res) => {
  const r = await query(
    `SELECT id, uploaded_at, uploaded_by, source, total_rows, inserted_rows, duplicate_rows
       FROM upload_batches ORDER BY uploaded_at DESC LIMIT 100`,
  );
  res.json({ ok: true, batches: r.rows });
});

uploadRouter.get("/orders/sample", requireAuth(), async (req, res) => {
  const date = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: "bad_date" });
  }
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const r = await query(
    `SELECT order_id, order_date, status, payment_type, gmv, km,
            driver_id, client_id, arrival_minutes, trip_minutes
       FROM orders WHERE order_date = $1 ORDER BY created_at DESC NULLS LAST LIMIT $2`,
    [date, limit],
  );
  res.json({ ok: true, orders: r.rows });
});

// GET /pairs/context?driver_id&client_id[&date] — полный контекст пары для PairDrawer.
// Возвращает: rule/ml скоры, последние заказы, тикеты, device-сигналы для client.
uploadRouter.get("/pairs/context", requireAuth(), async (req, res) => {
  const driverId = String(req.query.driver_id || "").trim();
  const clientId = String(req.query.client_id || "").trim();
  if (!driverId || !clientId) {
    return res.status(400).json({ ok: false, error: "driver_id and client_id required" });
  }

  const [riskRow, mlRow, orders, tickets, deviceSigs] = await Promise.all([
    // pair_risk_daily — последняя доступная дата
    query(
      `SELECT date, total_risk AS rule_score, repeat_ratio, suspicious_ratio,
              cashback_dependency, collusion_loss_risk_byn AS money_at_risk, signals
         FROM pair_risk_daily
        WHERE driver_id = $1 AND client_id = $2
        ORDER BY date DESC LIMIT 1`,
      [driverId, clientId],
    ),
    // ml_predictions — последний ml_score
    query(
      `SELECT score * 100 AS ml_score, date
         FROM ml_predictions
        WHERE entity_type = 'pair' AND entity_id_a = $1 AND entity_id_b = $2
        ORDER BY date DESC LIMIT 1`,
      [driverId, clientId],
    ),
    // последние 15 заказов пары
    query(
      `SELECT order_id, order_date, status, payment_type, gmv, km,
              arrival_minutes, trip_minutes
         FROM orders
        WHERE driver_id = $1 AND client_id = $2
        ORDER BY order_date DESC LIMIT 15`,
      [driverId, clientId],
    ),
    // последние 5 тикетов по этой паре
    query(
      `SELECT ticket_id, date, risk_score, risk_type, status, decision,
              priority, money_at_risk_byn
         FROM fraud_tickets
        WHERE entity_type = 'pair' AND driver_id = $1 AND client_id = $2
        ORDER BY date DESC LIMIT 5`,
      [driverId, clientId],
    ),
    // device/IP shared_signals для client (сколько других клиентов с тем же device)
    query(
      `SELECT signal_type, count(*)::int AS count, MAX(strength) AS max_strength
         FROM shared_signals
        WHERE (entity_a_id = $1 AND entity_a_type = 'client')
           OR (entity_b_id = $1 AND entity_b_type = 'client')
        GROUP BY signal_type`,
      [clientId],
    ),
  ]);

  const risk = riskRow.rows[0] ?? null;
  const ml   = mlRow.rows[0] ?? null;
  const deviceSignals = Object.fromEntries(
    deviceSigs.rows.map((r) => [r.signal_type, { count: r.count, max_strength: r.max_strength }]),
  );

  return res.json({
    ok: true,
    driver_id: driverId,
    client_id: clientId,
    rule_score:     risk ? Number(risk.rule_score) : null,
    ml_score:       ml   ? Number(ml.ml_score)     : null,
    money_at_risk:  risk ? Number(risk.money_at_risk) : null,
    repeat_ratio:   risk ? Number(risk.repeat_ratio) : null,
    suspicious_ratio: risk ? Number(risk.suspicious_ratio) : null,
    cashback_dependency: risk ? Number(risk.cashback_dependency) : null,
    last_date: risk?.date ?? null,
    orders: orders.rows,
    tickets: tickets.rows,
    device_signals: deviceSignals,
    shared_device_count: deviceSignals.device?.count ?? 0,
    shared_ip_count:     deviceSignals.ip?.count ?? 0,
  });
});

uploadRouter.get("/daily/drivers", requireAuth(), async (req, res) => {
  const date = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: "bad_date" });
  }
  const r = await query(
    `SELECT s.*, d.name AS driver_name
       FROM daily_driver_stats s
       LEFT JOIN drivers d ON d.id = s.driver_id
      WHERE s.date = $1
      ORDER BY s.total_orders DESC LIMIT 500`,
    [date],
  );
  res.json({ ok: true, rows: r.rows });
});

uploadRouter.get("/daily/clients", requireAuth(), async (req, res) => {
  const date = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: "bad_date" });
  }
  const r = await query(
    `SELECT s.*
       FROM daily_client_stats s
      WHERE s.date = $1
      ORDER BY s.cashback_earned DESC LIMIT 500`,
    [date],
  );
  res.json({ ok: true, rows: r.rows });
});

uploadRouter.get("/daily/attendance", requireAuth(), async (req, res) => {
  const date = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: "bad_date" });
  }
  const r = await query(
    `SELECT a.driver_id, d.name AS driver_name,
            a.shift_id, sh.name AS shift_name,
            sh.start_hour, sh.end_hour,
            a.shift_hours, a.covered_hours, a.attendance_pct,
            a.orders_in_shift, a.qualified, a.payout_byn
       FROM driver_shift_attendance a
       LEFT JOIN drivers d ON d.id = a.driver_id
       LEFT JOIN shifts  sh ON sh.id = a.shift_id
      WHERE a.date = $1
      ORDER BY a.qualified DESC, a.payout_byn DESC, a.attendance_pct DESC
      LIMIT 1000`,
    [date],
  );
  res.json({ ok: true, rows: r.rows });
});

uploadRouter.get("/daily/summary", requireAuth(), async (req, res) => {
  const date = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: "bad_date" });
  }
  // Один запрос → все агрегаты главного экрана.
  const r = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM orders WHERE order_date = $1) AS orders_total,
       (SELECT COUNT(*)::int FROM orders WHERE order_date = $1 AND status='completed') AS orders_completed,
       (SELECT COALESCE(SUM(total_gmv),0) FROM daily_driver_stats WHERE date = $1) AS gmv_total,
       (SELECT COALESCE(SUM(noncash_gmv),0) FROM daily_driver_stats WHERE date = $1) AS gmv_noncash,
       (SELECT COUNT(DISTINCT driver_id)::int FROM daily_driver_stats WHERE date = $1) AS drivers_active,
       (SELECT COUNT(DISTINCT client_id)::int FROM daily_client_stats WHERE date = $1) AS clients_active,
       (SELECT COALESCE(SUM(payout_byn),0) FROM driver_shift_attendance
          WHERE date = $1 AND qualified = true) AS guarantee_payout,
       (SELECT COUNT(*)::int FROM driver_shift_attendance
          WHERE date = $1 AND qualified = true) AS qualified_count,
       (SELECT COALESCE(SUM(cashback_earned),0) FROM daily_client_stats WHERE date = $1) AS cashback_total,
       (SELECT COALESCE(SUM(money_at_risk_byn),0)   FROM driver_risk_daily WHERE date = $1) AS risk_money_total,
       (SELECT COALESCE(SUM(guarantee_money_byn),0) FROM driver_risk_daily WHERE date = $1) AS risk_money_guarantee,
       (SELECT COALESCE(SUM(earnings_money_byn),0)  FROM driver_risk_daily WHERE date = $1) AS risk_money_earnings,
       (SELECT COALESCE(SUM(collusion_money_byn),0) FROM driver_risk_daily WHERE date = $1) AS risk_money_collusion,
       (SELECT COUNT(*)::int FROM driver_risk_daily WHERE date = $1 AND total_risk >= 30) AS risky_drivers_count,
       -- T007: клиентский риск (cashback).
       (SELECT COALESCE(SUM(money_at_risk_byn),0)   FROM client_risk_daily WHERE date = $1) AS cashback_loss_total,
       (SELECT COUNT(*)::int FROM client_risk_daily WHERE date = $1 AND total_risk >= 30) AS risky_clients_count,
       -- T008: pair-collusion. Эти деньги — переплаченный cashback из-за сговора
       -- пары "водитель-клиент"; пересекается с client_risk, но детализирует кто-с-кем.
       (SELECT COALESCE(SUM(collusion_loss_risk_byn),0) FROM pair_risk_daily WHERE date = $1) AS collusion_loss_total,
       (SELECT COUNT(*)::int FROM pair_risk_daily WHERE date = $1 AND total_risk >= 30) AS risky_pairs_count,
       -- T015: KPI тикетной системы
       (SELECT COUNT(*)::int FROM fraud_tickets WHERE date = $1) AS tickets_created,
       (SELECT COUNT(*)::int FROM fraud_tickets WHERE date = $1 AND status = 'confirmed_fraud') AS tickets_confirmed,
       (SELECT COUNT(*)::int FROM fraud_tickets WHERE date = $1 AND status = 'new') AS tickets_open,
       (SELECT COALESCE(SUM(money_at_risk_byn),0) FROM fraud_tickets WHERE date = $1) AS tickets_money_at_risk_total,
       (SELECT COALESCE(SUM(money_saved_byn),0)   FROM fraud_tickets WHERE date = $1 AND status = 'confirmed_fraud') AS money_saved_total,
       (SELECT COALESCE(SUM(money_saved_byn),0)   FROM fraud_tickets WHERE date = $1 AND status = 'confirmed_fraud') AS money_prevented`,
    [date],
  );
  res.json({ ok: true, summary: r.rows[0] });
});

uploadRouter.get("/daily/driver-risks", requireAuth(["admin", "antifraud"]), async (req, res) => {
  const date = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: "bad_date" });
  }
  // Clamp в [1..1000]: отрицательный/нулевой limit ронял SQL.
  const rawLimit = Number(req.query.limit);
  const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 200, 1000));
  // Сортируем по money_at_risk_byn — это бизнес-приоритет ("где денег теряем больше").
  // Тянем driver_name для UI и пробрасываем signals целиком — карточка кейса
  // (T010) рендерит из них без новых запросов.
  const r = await query(
    `SELECT r.driver_id, d.name AS driver_name,
            r.guarantee_risk, r.earnings_risk, r.collusion_risk, r.total_risk,
            r.guarantee_money_byn, r.earnings_money_byn, r.collusion_money_byn,
            r.money_at_risk_byn,
            r.signals,
            r.recomputed_at
       FROM driver_risk_daily r
       LEFT JOIN drivers d ON d.id = r.driver_id
      WHERE r.date = $1
      ORDER BY r.money_at_risk_byn DESC, r.total_risk DESC
      LIMIT $2`,
    [date, limit],
  );
  res.json({ ok: true, rows: r.rows });
});

uploadRouter.get("/daily/client-risks", requireAuth(["admin", "antifraud"]), async (req, res) => {
  // T007: лимит 500 — клиентов в день у нас в разы меньше, чем заказов;
  // 500 — потолок UI-таблицы и защита от выгрузки всей БД через query string.
  const date = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: "bad_date" });
  }
  const rawLimit = Number(req.query.limit);
  const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 200, 500));
  // Сортируем по money_at_risk_byn (= кэшбэк под риском). Для топа нужны
  // оба score'а (cashback + repeat_driver_dependency) — последний без денег,
  // но красным маркером в UI.
  const r = await query(
    `SELECT r.client_id,
            r.total_orders,
            r.cashback_exposure, r.repeat_driver_dependency, r.suspicious_activity, r.total_risk,
            r.cashback_money_byn, r.money_at_risk_byn,
            r.signals,
            r.recomputed_at
       FROM client_risk_daily r
      WHERE r.date = $1
      ORDER BY r.money_at_risk_byn DESC, r.total_risk DESC
      LIMIT $2`,
    [date, limit],
  );
  res.json({ ok: true, rows: r.rows });
});

uploadRouter.get("/daily/pair-risks", requireAuth(["admin", "antifraud"]), async (req, res) => {
  // T008: топ pair-collusion. Лимит 500 — UI-таблица, защита от выгрузки всего.
  const date = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: "bad_date" });
  }
  const rawLimit = Number(req.query.limit);
  const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 200, 500));
  const r = await query(
    `SELECT r.driver_id, d.name AS driver_name,
            r.client_id,
            r.orders_count, r.noncash_gmv,
            r.repeat_ratio, r.suspicious_ratio, r.cashback_dependency, r.total_risk,
            r.collusion_loss_risk_byn,
            r.signals,
            r.recomputed_at
       FROM pair_risk_daily r
       LEFT JOIN drivers d ON d.id = r.driver_id
      WHERE r.date = $1
      ORDER BY r.collusion_loss_risk_byn DESC, r.total_risk DESC
      LIMIT $2`,
    [date, limit],
  );
  res.json({ ok: true, rows: r.rows });
});

uploadRouter.get("/daily/pairs", requireAuth(), async (req, res) => {
  const date = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: "bad_date" });
  }
  const r = await query(
    `SELECT s.*, d.name AS driver_name
       FROM daily_pair_stats s
       LEFT JOIN drivers d ON d.id = s.driver_id
      WHERE s.date = $1
      ORDER BY s.orders_count DESC LIMIT 500`,
    [date],
  );
  res.json({ ok: true, rows: r.rows });
});
