// lib/etl.mjs — пересчёт дневных метрик после импорта.
// Идея: импорт пишет orders, потом ETL для каждого затронутого DATE
// делает DELETE + INSERT в daily_driver_stats / daily_client_stats / daily_pair_stats.
//
// Все агрегаты считаются одним SQL — БД быстро это сделает на нашем объёме.

import { query, withTx } from "./db.mjs";
import { computeDriverRisk } from "./risk.mjs";
import { computeClientRisk } from "./client_risk.mjs";
import { computePairRisk } from "./pair_risk.mjs";
// T015: Fraud Decision Workflow — авто-создание тикетов из *_risk_daily.
// Хук подключён в самом конце withTx, не меняет ни одной существующей формулы.
import { recomputeFraudTickets } from "./fraud_tickets.mjs";
// T020: Graph Fraud Analysis. Дополнительный слой графа поверх pair_risk.
// Не меняет существующие formulas/daily-таблицы.
import { upsertGraphEdgesForDate, recomputeGraphNodesAndClusters } from "./graph.mjs";
import { predictAndPersistForDates } from "./ml.mjs";

async function getRiskThresholds() {
  const r = await query("SELECT value FROM settings WHERE key = 'risk_thresholds'");
  const v = r.rows[0]?.value || {};
  return {
    short_trip_km: Number(v.short_trip_km ?? 2),
    fast_arrival_min: Number(v.fast_arrival_min ?? 3),
    min_attendance_pct: Number(v.min_attendance_pct ?? 80),
    high_repeat_ratio: Number(v.high_repeat_ratio ?? 0.6),
  };
}

// Default cashback percent — соответствует project_goal (30%).
// БД может быть пустая на свежей инсталляции — деньги под риском не должны
// обнуляться из-за отсутствия записи settings.cashback.
const DEFAULT_CASHBACK_PCT = 30;

async function getCashbackPct() {
  const r = await query("SELECT value FROM settings WHERE key = 'cashback'");
  const v = r.rows[0]?.value?.percent_of_noncash;
  return v == null ? DEFAULT_CASHBACK_PCT : Number(v);
}

// Главный метод: пересчитать метрики для набора дат.
// dates: массив строк YYYY-MM-DD.
export async function recomputeForDates(dates, log) {
  if (!dates || !dates.length) return { dates: 0 };
  const thr = await getRiskThresholds();
  const cashbackPct = await getCashbackPct();
  let total = 0;

  for (const d of dates) {
    await withTx(async (c) => {
      // Сериализуем пересчёт по конкретной дате: два параллельных импорта
      // одного дня встанут в очередь, а не упадут на конфликте PK при INSERT.
      // pg_advisory_xact_lock сам отпускается в конце транзакции.
      await c.query("SELECT pg_advisory_xact_lock(hashtext('newstat_etl_' || $1))", [d]);
      await c.query("DELETE FROM daily_driver_stats WHERE date = $1", [d]);
      await c.query("DELETE FROM daily_client_stats WHERE date = $1", [d]);
      await c.query("DELETE FROM daily_pair_stats WHERE date = $1", [d]);

      // ── водители ──
      await c.query(
        `INSERT INTO daily_driver_stats(
           driver_id, date,
           total_orders, completed_orders, cancelled_orders,
           noncash_orders, cash_orders,
           noncash_gmv, cash_gmv, total_gmv,
           short_trip_orders, fast_arrival_orders,
           unique_clients, max_orders_with_one_client, repeat_client_ratio,
           avg_arrival_minutes, avg_trip_minutes,
           first_order_at, last_order_at, active_hours_mask, recomputed_at)
         SELECT
           o.driver_id,
           o.order_date,
           COUNT(*)::int,
           COUNT(*) FILTER (WHERE o.status = 'completed')::int,
           COUNT(*) FILTER (WHERE o.status = 'cancelled')::int,
           COUNT(*) FILTER (WHERE o.payment_type = 'noncash')::int,
           COUNT(*) FILTER (WHERE o.payment_type = 'cash')::int,
           COALESCE(SUM(o.gmv) FILTER (WHERE o.payment_type = 'noncash'), 0),
           COALESCE(SUM(o.gmv) FILTER (WHERE o.payment_type = 'cash'), 0),
           COALESCE(SUM(o.gmv), 0),
           COUNT(*) FILTER (WHERE o.km IS NOT NULL AND o.km < $2 AND o.status = 'completed')::int,
           COUNT(*) FILTER (WHERE o.arrival_minutes IS NOT NULL AND o.arrival_minutes < $3 AND o.status = 'completed')::int,
           COUNT(DISTINCT o.client_id) FILTER (WHERE o.client_id IS NOT NULL)::int,
           COALESCE((
             SELECT MAX(c) FROM (
               SELECT COUNT(*) AS c FROM orders o2
                WHERE o2.driver_id = o.driver_id AND o2.order_date = o.order_date AND o2.client_id IS NOT NULL
                GROUP BY o2.client_id
             ) t
           ), 0)::int,
           CASE WHEN COUNT(*) FILTER (WHERE o.client_id IS NOT NULL) > 0
                THEN ROUND(
                  (COUNT(*) FILTER (WHERE o.client_id IS NOT NULL) - COUNT(DISTINCT o.client_id) FILTER (WHERE o.client_id IS NOT NULL))::numeric
                  / NULLIF(COUNT(*) FILTER (WHERE o.client_id IS NOT NULL), 0), 4)
                ELSE 0 END,
           ROUND(AVG(o.arrival_minutes)::numeric, 2),
           ROUND(AVG(o.trip_minutes)::numeric, 2),
           MIN(o.created_at),
           MAX(o.created_at),
           COALESCE(SUM(DISTINCT (1 << EXTRACT(HOUR FROM o.created_at)::int)) FILTER (WHERE o.created_at IS NOT NULL), 0)::int,
           now()
         FROM orders o
         WHERE o.order_date = $1 AND o.driver_id IS NOT NULL
         GROUP BY o.driver_id, o.order_date`,
        [d, thr.short_trip_km, thr.fast_arrival_min],
      );

      // ── клиенты ──
      // T007: добавлены cash_gmv и fast_arrival_orders — нужны клиентским
      // моделям (быстрая подача от водителя — индикатор сговора).
      await c.query(
        `INSERT INTO daily_client_stats(
           client_id, date,
           total_orders, completed_orders, cancelled_orders,
           noncash_orders, noncash_gmv, cash_gmv, total_gmv,
           unique_drivers, max_orders_with_one_driver, repeat_driver_ratio,
           short_trip_orders, fast_arrival_orders,
           cashback_earned, recomputed_at)
         SELECT
           o.client_id,
           o.order_date,
           COUNT(*)::int,
           COUNT(*) FILTER (WHERE o.status = 'completed')::int,
           COUNT(*) FILTER (WHERE o.status = 'cancelled')::int,
           COUNT(*) FILTER (WHERE o.payment_type = 'noncash')::int,
           COALESCE(SUM(o.gmv) FILTER (WHERE o.payment_type = 'noncash'), 0),
           COALESCE(SUM(o.gmv) FILTER (WHERE o.payment_type = 'cash'), 0),
           COALESCE(SUM(o.gmv), 0),
           COUNT(DISTINCT o.driver_id) FILTER (WHERE o.driver_id IS NOT NULL)::int,
           COALESCE((
             SELECT MAX(c) FROM (
               SELECT COUNT(*) AS c FROM orders o2
                WHERE o2.client_id = o.client_id AND o2.order_date = o.order_date AND o2.driver_id IS NOT NULL
                GROUP BY o2.driver_id
             ) t
           ), 0)::int,
           CASE WHEN COUNT(*) FILTER (WHERE o.driver_id IS NOT NULL) > 0
                THEN ROUND(
                  (COUNT(*) FILTER (WHERE o.driver_id IS NOT NULL) - COUNT(DISTINCT o.driver_id) FILTER (WHERE o.driver_id IS NOT NULL))::numeric
                  / NULLIF(COUNT(*) FILTER (WHERE o.driver_id IS NOT NULL), 0), 4)
                ELSE 0 END,
           COUNT(*) FILTER (WHERE o.km IS NOT NULL AND o.km < $2 AND o.status = 'completed')::int,
           COUNT(*) FILTER (WHERE o.arrival_minutes IS NOT NULL AND o.arrival_minutes < $4 AND o.status = 'completed')::int,
           ROUND(COALESCE(SUM(o.gmv) FILTER (WHERE o.payment_type = 'noncash' AND o.status = 'completed'), 0) * $3 / 100.0, 2),
           now()
         FROM orders o
         WHERE o.order_date = $1 AND o.client_id IS NOT NULL
         GROUP BY o.client_id, o.order_date`,
        [d, thr.short_trip_km, cashbackPct, thr.fast_arrival_min],
      );

      // ── пары ──
      await c.query(
        `INSERT INTO daily_pair_stats(
           driver_id, client_id, date,
           orders_count, noncash_orders, noncash_gmv, total_gmv,
           short_trip_orders, fast_arrival_orders, recomputed_at)
         SELECT
           o.driver_id, o.client_id, o.order_date,
           COUNT(*)::int,
           COUNT(*) FILTER (WHERE o.payment_type = 'noncash')::int,
           COALESCE(SUM(o.gmv) FILTER (WHERE o.payment_type = 'noncash'), 0),
           COALESCE(SUM(o.gmv), 0),
           COUNT(*) FILTER (WHERE o.km IS NOT NULL AND o.km < $2 AND o.status = 'completed')::int,
           COUNT(*) FILTER (WHERE o.arrival_minutes IS NOT NULL AND o.arrival_minutes < $3 AND o.status = 'completed')::int,
           now()
         FROM orders o
         WHERE o.order_date = $1 AND o.driver_id IS NOT NULL AND o.client_id IS NOT NULL
         GROUP BY o.driver_id, o.client_id, o.order_date`,
        [d, thr.short_trip_km, thr.fast_arrival_min],
      );

      // ── гарантия по сменам ──
      // Берём активные смены, чей weekday_mask покрывает этот день.
      // Для каждой пары (водитель × смена) считаем сколько часов смены
      // имели хотя бы один заказ (по active_hours_mask из daily_driver_stats),
      // дальше — qualified и payout_byn.
      await c.query("DELETE FROM driver_shift_attendance WHERE date = $1", [d]);
      await c.query(
        `WITH active_shifts AS (
           SELECT id, start_hour, end_hour, payout_byn
             FROM shifts
            WHERE active = true
              AND (weekday_mask & (1 << (EXTRACT(ISODOW FROM $1::date)::int - 1))) <> 0
         ),
         combos AS (
           SELECT
             ds.driver_id,
             ds.active_hours_mask,
             s.id AS shift_id,
             s.start_hour, s.end_hour, s.payout_byn,
             (s.end_hour - s.start_hour) AS shift_hours
           FROM daily_driver_stats ds
           CROSS JOIN active_shifts s
           WHERE ds.date = $1
         ),
         -- Один скан orders с агрегацией по часам — заменяет коррелированные подзапросы
         -- (N+1 на каждую (driver, shift) пару). TZ берётся из сессии (Europe/Minsk),
         -- что согласуется с active_hours_mask в daily_driver_stats.
         hours_per_driver AS (
           SELECT o.driver_id,
                  EXTRACT(HOUR FROM o.created_at)::int AS h,
                  COUNT(*)::int AS cnt
             FROM orders o
            WHERE o.order_date = $1
              AND o.created_at IS NOT NULL
            GROUP BY o.driver_id, h
         ),
         orders_per_combo AS (
           SELECT c.driver_id, c.shift_id,
                  COALESCE(SUM(h.cnt), 0)::int AS orders_in_shift
             FROM combos c
             LEFT JOIN hours_per_driver h
               ON h.driver_id = c.driver_id
              AND h.h >= c.start_hour
              AND h.h <  c.end_hour
            GROUP BY c.driver_id, c.shift_id
         ),
         covered AS (
           SELECT
             c.*,
             (SELECT COUNT(*)::int
                FROM generate_series(c.start_hour, c.end_hour - 1) AS h
               WHERE (c.active_hours_mask & (1 << h)) <> 0) AS covered_hours,
             ops.orders_in_shift
           FROM combos c
           JOIN orders_per_combo ops USING (driver_id, shift_id)
         )
         INSERT INTO driver_shift_attendance(
           driver_id, date, shift_id, shift_hours, covered_hours,
           attendance_pct, orders_in_shift, qualified, payout_byn, recomputed_at)
         SELECT
           driver_id,
           $1::date,
           shift_id,
           shift_hours,
           covered_hours,
           ROUND(covered_hours::numeric * 100 / NULLIF(shift_hours, 0), 2),
           orders_in_shift,
           (covered_hours::numeric * 100 / NULLIF(shift_hours, 0)) >= $2,
           CASE
             WHEN (covered_hours::numeric * 100 / NULLIF(shift_hours, 0)) >= $2
               THEN payout_byn
             ELSE 0
           END,
           now()
         FROM covered`,
        [d, thr.min_attendance_pct],
      );

      // ── риск по водителям ──
      // Считаем после attendance, чтобы знать qualified/payout. Сами модели
      // живут в lib/risk.mjs, чтобы их легко тестировать и дёргать руками.
      await recomputeDriverRisk(c, d);

      // ── риск по клиентам ──
      // Не зависит от attendance, считаем сразу после daily_client_stats.
      // Модели живут в lib/client_risk.mjs (см. T007).
      await recomputeClientRisk(c, d);

      // ── риск по парам (collusion) ──
      // Должен идти ПОСЛЕ client/driver, потому что модель использует
      // их noncash_orders и total_orders как знаменатель concentration.
      // Модель в lib/pair_risk.mjs (см. T008).
      await recomputePairRisk(c, d);

      // ── T020: graph_edges за дату ──
      // Идёт ПОСЛЕ pair_risk_daily, чтобы взять оттуда repeat_ratio,
      // pair_risk_score и collusion_loss_risk_byn. Только наполняет
      // graph_edges, не трогает risk-формулы.
      await upsertGraphEdgesForDate(c, d, thr, cashbackPct);

      // ── T015: автогенерация тикетов из *_risk_daily ──
      // Идёт ПОСЛЕДНЕЙ операцией внутри withTx, чтобы тикеты гарантированно
      // видели свежие риски, и при провале откатывался весь день целиком.
      // Не меняет ни daily-таблицы, ни формулы — только наполняет fraud_tickets.
      await recomputeFraudTickets(c, d, log);
    });

    total++;
    log?.info({ date: d }, "etl day recomputed");
  }

  // ── T020: пересчёт graph_nodes / graph_clusters один раз за прогон ──
  // Окно — последние 30 дней по самой свежей дате в graph_edges.
  // Снаружи withTx: операция глобальная (полный rewrite кластеров),
  // не должна откатывать пересчёт конкретного дня при ошибке.
  try {
    await withTx(async (c) => {
      await recomputeGraphNodesAndClusters(c, log);
    });
  } catch (err) {
    log?.error({ err: String(err) }, "graph nodes/clusters recompute failed");
  }

  // ── T014: ML predict для пар за каждую обработанную дату ──
  // Вызов в Python-сервис изолирован: при сбое только логируем и идём дальше,
  // ETL не должен падать из-за ML.
  try {
    const mlResults = await predictAndPersistForDates(dates, log);
    log?.info({ mlResults }, "ml predictions done");
  } catch (err) {
    log?.warn({ err: String(err) }, "ml predict batch failed (skip)");
  }

  return { dates: total };
}

// Перечитываем агрегаты по водителям + qualified/payout из attendance,
// прогоняем модели риска в JS и пишем одним INSERT через unnest().
// Объёмы дневные (десятки–сотни водителей), in-memory считается мгновенно.
async function recomputeDriverRisk(c, date) {
  await c.query("DELETE FROM driver_risk_daily WHERE date = $1", [date]);

  const r = await c.query(
    `SELECT
       ds.driver_id,
       ds.total_orders, ds.completed_orders, ds.cancelled_orders,
       ds.noncash_orders, ds.cash_orders,
       ds.total_gmv, ds.noncash_gmv, ds.cash_gmv,
       ds.short_trip_orders, ds.fast_arrival_orders,
       ds.unique_clients, ds.max_orders_with_one_client, ds.repeat_client_ratio,
       ds.avg_arrival_minutes, ds.avg_trip_minutes,
       COALESCE(BOOL_OR(dsa.qualified), false)               AS qualified,
       COALESCE(SUM(dsa.payout_byn), 0)::numeric             AS payout_byn,
       -- shift_hours_total и orders_in_qualified_shifts считаются на одном скоупе
       -- (только qualified-смены), чтобы orders/hour в guarantee-модели не вышел
       -- завышенным из-за заказов вне оплачиваемых смен.
       COALESCE(SUM(dsa.shift_hours)     FILTER (WHERE dsa.qualified), 0)::int
                                                             AS shift_hours_total,
       COALESCE(SUM(dsa.orders_in_shift) FILTER (WHERE dsa.qualified), 0)::int
                                                             AS orders_in_qualified_shifts
     FROM daily_driver_stats ds
     LEFT JOIN driver_shift_attendance dsa
            ON dsa.driver_id = ds.driver_id AND dsa.date = ds.date
     WHERE ds.date = $1
     GROUP BY ds.driver_id, ds.total_orders, ds.completed_orders, ds.cancelled_orders,
              ds.noncash_orders, ds.cash_orders,
              ds.total_gmv, ds.noncash_gmv, ds.cash_gmv,
              ds.short_trip_orders, ds.fast_arrival_orders,
              ds.unique_clients, ds.max_orders_with_one_client, ds.repeat_client_ratio,
              ds.avg_arrival_minutes, ds.avg_trip_minutes`,
    [date],
  );

  if (r.rows.length === 0) return;

  const rows = r.rows.map((row) => computeDriverRisk(row));

  await c.query(
    `INSERT INTO driver_risk_daily(
       driver_id, date,
       guarantee_risk, earnings_risk, collusion_risk, total_risk,
       guarantee_money_byn, earnings_money_byn, collusion_money_byn, money_at_risk_byn,
       signals, recomputed_at)
     SELECT *, now() FROM unnest(
       $1::text[], $2::date[],
       $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[],
       $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[],
       $11::jsonb[]
     ) AS u(driver_id, date,
            guarantee_risk, earnings_risk, collusion_risk, total_risk,
            guarantee_money_byn, earnings_money_byn, collusion_money_byn, money_at_risk_byn,
            signals)`,
    [
      rows.map((x) => x.driver_id),
      rows.map(() => date),
      rows.map((x) => x.guarantee_risk),
      rows.map((x) => x.earnings_risk),
      rows.map((x) => x.collusion_risk),
      rows.map((x) => x.total_risk),
      rows.map((x) => x.guarantee_money_byn),
      rows.map((x) => x.earnings_money_byn),
      rows.map((x) => x.collusion_money_byn),
      rows.map((x) => x.money_at_risk_byn),
      rows.map((x) => JSON.stringify(x.signals)),
    ],
  );
}

// Аналог recomputeDriverRisk, только для клиентов (T007). Не зависит от
// attendance — читает из daily_client_stats напрямую.
async function recomputeClientRisk(c, date) {
  await c.query("DELETE FROM client_risk_daily WHERE date = $1", [date]);

  const r = await c.query(
    `SELECT client_id,
            total_orders, completed_orders, cancelled_orders,
            noncash_orders, noncash_gmv, cash_gmv, total_gmv,
            unique_drivers, max_orders_with_one_driver, repeat_driver_ratio,
            short_trip_orders, fast_arrival_orders, cashback_earned
       FROM daily_client_stats
      WHERE date = $1`,
    [date],
  );

  if (r.rows.length === 0) return;

  const rows = r.rows.map((row) => computeClientRisk(row));

  // total_orders берём прямо из daily_client_stats (а не из signals) — так
  // INSERT заполняет одноимённую колонку без round-trip через jsonb (миграция 006).
  await c.query(
    `INSERT INTO client_risk_daily(
       client_id, date, total_orders,
       cashback_exposure, repeat_driver_dependency, suspicious_activity, total_risk,
       cashback_money_byn, money_at_risk_byn,
       signals, recomputed_at)
     SELECT *, now() FROM unnest(
       $1::text[], $2::date[], $3::int[],
       $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[],
       $8::numeric[], $9::numeric[],
       $10::jsonb[]
     ) AS u(client_id, date, total_orders,
            cashback_exposure, repeat_driver_dependency, suspicious_activity, total_risk,
            cashback_money_byn, money_at_risk_byn,
            signals)`,
    [
      rows.map((x) => x.client_id),
      rows.map(() => date),
      r.rows.map((row) => Number(row.total_orders) || 0),
      rows.map((x) => x.cashback_exposure),
      rows.map((x) => x.repeat_driver_dependency),
      rows.map((x) => x.suspicious_activity),
      rows.map((x) => x.total_risk),
      rows.map((x) => x.cashback_money_byn),
      rows.map((x) => x.money_at_risk_byn),
      rows.map((x) => JSON.stringify(x.signals)),
    ],
  );
}

// T008: pair-collusion risk.
// Один SELECT с JOIN'ом к daily_client_stats / daily_driver_stats, чтобы
// модель знала знаменатели (concentration). Cashback% — из settings.cashback.
async function recomputePairRisk(c, date) {
  await c.query("DELETE FROM pair_risk_daily WHERE date = $1", [date]);

  const cbR = await c.query(
    "SELECT value FROM settings WHERE key = 'cashback'",
  );
  const cbVal = cbR.rows[0]?.value?.percent_of_noncash;
  const cashbackPct = cbVal == null ? DEFAULT_CASHBACK_PCT : Number(cbVal);

  const r = await c.query(
    `SELECT p.driver_id, p.client_id,
            p.orders_count, p.noncash_orders, p.noncash_gmv,
            p.short_trip_orders, p.fast_arrival_orders,
            COALESCE(cs.noncash_orders, 0) AS client_noncash_orders,
            COALESCE(cs.total_orders, 0)   AS client_total_orders,
            COALESCE(ds.total_orders, 0)   AS driver_total_orders
       FROM daily_pair_stats p
       LEFT JOIN daily_client_stats cs ON cs.client_id = p.client_id AND cs.date = p.date
       LEFT JOIN daily_driver_stats ds ON ds.driver_id = p.driver_id AND ds.date = p.date
      WHERE p.date = $1`,
    [date],
  );

  if (r.rows.length === 0) return;

  const rows = r.rows.map((row) =>
    computePairRisk(row, {
      cashbackPct,
      clientNoncashOrders: row.client_noncash_orders,
      clientTotalOrders: row.client_total_orders,
      driverTotalOrders: row.driver_total_orders,
    }),
  );

  await c.query(
    `INSERT INTO pair_risk_daily(
       driver_id, client_id, date,
       orders_count, noncash_gmv,
       repeat_ratio, suspicious_ratio, cashback_dependency, total_risk,
       collusion_loss_risk_byn,
       signals, recomputed_at)
     SELECT *, now() FROM unnest(
       $1::text[], $2::text[], $3::date[],
       $4::int[],  $5::numeric[],
       $6::numeric[], $7::numeric[], $8::numeric[], $9::numeric[],
       $10::numeric[],
       $11::jsonb[]
     ) AS u(driver_id, client_id, date,
            orders_count, noncash_gmv,
            repeat_ratio, suspicious_ratio, cashback_dependency, total_risk,
            collusion_loss_risk_byn,
            signals)`,
    [
      rows.map((x) => x.driver_id),
      rows.map((x) => x.client_id),
      rows.map(() => date),
      rows.map((x) => x.orders_count),
      rows.map((x) => x.noncash_gmv),
      rows.map((x) => x.repeat_ratio),
      rows.map((x) => x.suspicious_ratio),
      rows.map((x) => x.cashback_dependency),
      rows.map((x) => x.total_risk),
      rows.map((x) => x.collusion_loss_risk_byn),
      rows.map((x) => JSON.stringify(x.signals)),
    ],
  );
}
