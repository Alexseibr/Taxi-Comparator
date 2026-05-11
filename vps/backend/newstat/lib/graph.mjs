// lib/graph.mjs — T020: Graph Fraud Analysis.
//
// Слой графа поверх существующих risk-моделей. Только наполняет
// graph_edges / graph_nodes / graph_clusters; формулы и daily-таблицы
// risk не меняются.
//
// Хук в etl.mjs вызывает:
//   1) upsertGraphEdgesForDate(c, date, thr, cashbackPct)
//   2) recomputeGraphNodesAndClusters(c, log, opts)
// первый — за конкретную дату (как pair_risk_daily), второй — глобальный
// пересчёт узлов и кластеров за окно последних N дней (по умолчанию 30).

const DEFAULT_WINDOW_DAYS = 30;
// После нормализации repeat_ratio (мигр. 011) реальный max edge_strength
// в текущих данных ≈ 0.6. Порог 0.5 даёт разумный отбор сильных связей.
const DEFAULT_EDGE_STRENGTH_THRESHOLD = 0.5;

// Эвристики §10 — пороги подобраны под наши объёмы (см. project_goal).
const SUSPICIOUS_MIN_NODES        = 3;
const SUSPICIOUS_MIN_LOSS_RISK    = 5;   // BYN
const SUSPICIOUS_MIN_AVG_RISK     = 40;
// repeat_ratio в pair_risk_daily/graph_edges уже масштабирован 0..100
// (см. pair_risk.mjs: ramp(orders,3,10)*100). Порог §9 «> 0.6» означает 60%.
const SUSPICIOUS_MIN_REPEAT_RATIO = 60;

// ── 1. EDGES ──────────────────────────────────────────────────────────────

// Перестраивает graph_edges для одной даты: пары (driver, client) с
// заказами за дату. Источники: orders + pair_risk_daily.
export async function upsertGraphEdgesForDate(c, date, thr, cashbackPct) {
  await c.query("DELETE FROM graph_edges WHERE date = $1", [date]);

  await c.query(
    `INSERT INTO graph_edges(
       driver_id, client_id, date,
       orders_count, completed_orders, noncash_orders,
       total_gmv, noncash_gmv,
       short_trip_count, fast_arrival_count,
       repeat_ratio, pair_risk_score,
       cashback_generated_byn, cashback_loss_risk_byn,
       days_seen, first_seen_date, last_seen_date, updated_at)
     SELECT
       o.driver_id, o.client_id, o.order_date,
       COUNT(*)::int,
       COUNT(*) FILTER (WHERE o.status = 'completed')::int,
       COUNT(*) FILTER (WHERE o.payment_type = 'noncash')::int,
       COALESCE(SUM(o.gmv), 0),
       COALESCE(SUM(o.gmv) FILTER (WHERE o.payment_type = 'noncash'), 0),
       COUNT(*) FILTER (WHERE o.km IS NOT NULL AND o.km < $2 AND o.status = 'completed')::int,
       COUNT(*) FILTER (WHERE o.arrival_minutes IS NOT NULL AND o.arrival_minutes < $3 AND o.status = 'completed')::int,
       COALESCE(prd.repeat_ratio, 0),
       COALESCE(prd.total_risk, 0),
       ROUND(
         COALESCE(SUM(o.gmv) FILTER (WHERE o.payment_type = 'noncash' AND o.status = 'completed'), 0)
           * $4 / 100.0,
         2
       ),
       COALESCE(prd.collusion_loss_risk_byn, 0),
       1, o.order_date, o.order_date, now()
     FROM orders o
     LEFT JOIN pair_risk_daily prd
       ON prd.driver_id = o.driver_id
      AND prd.client_id = o.client_id
      AND prd.date = o.order_date
     WHERE o.order_date = $1
       AND o.driver_id IS NOT NULL
       AND o.client_id IS NOT NULL
     GROUP BY o.driver_id, o.client_id, o.order_date,
              prd.repeat_ratio, prd.total_risk, prd.collusion_loss_risk_byn`,
    [date, thr.short_trip_km, thr.fast_arrival_min, cashbackPct],
  );

  // days_seen / first_seen_date / last_seen_date — окно DEFAULT_WINDOW_DAYS
  // (30 дней) от текущей даты. Считаем только для пар, затронутых этой датой.
  // Старая реализация считала по всей истории, что искажало метрики давности.
  await c.query(
    `WITH stat AS (
       SELECT driver_id, client_id,
              COUNT(DISTINCT date)::int AS cnt,
              MIN(date) AS first_d, MAX(date) AS last_d
         FROM graph_edges
        WHERE date BETWEEN ($1::date - ($2::int - 1)) AND $1::date
          AND (driver_id, client_id) IN (
            SELECT driver_id, client_id FROM graph_edges WHERE date = $1
          )
        GROUP BY driver_id, client_id
     )
     UPDATE graph_edges ge
        SET days_seen       = stat.cnt,
            first_seen_date = stat.first_d,
            last_seen_date  = stat.last_d
       FROM stat
      WHERE ge.driver_id = stat.driver_id
        AND ge.client_id = stat.client_id
        AND ge.date BETWEEN ($1::date - ($2::int - 1)) AND $1::date`,
    [date, DEFAULT_WINDOW_DAYS],
  );
}

// ── 2. NODES + CLUSTERS ──────────────────────────────────────────────────

// Пересчитывает graph_nodes и graph_clusters за окно последних N дней.
// Сделано in-memory: для наших объёмов (~3k orders/day, ~280 водителей,
// ~1k клиентов) это уверенно укладывается в секунды.
export async function recomputeGraphNodesAndClusters(c, log, opts = {}) {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const threshold  = opts.edgeStrengthThreshold ?? DEFAULT_EDGE_STRENGTH_THRESHOLD;

  // Берём окно по самой свежей дате в graph_edges (а не по now()),
  // чтобы исторические импорты не оставляли пустые окна.
  const maxR = await c.query("SELECT MAX(date) AS d FROM graph_edges");
  const maxDate = maxR.rows[0]?.d;
  if (!maxDate) {
    log?.info({ component: "graph" }, "no graph_edges yet — skip nodes/clusters");
    return { nodes: 0, clusters: 0, suspicious: 0 };
  }

  const windowR = await c.query(
    `SELECT to_char($1::date - ($2::int - 1), 'YYYY-MM-DD') AS from_d,
            to_char($1::date, 'YYYY-MM-DD') AS to_d`,
    [maxDate, windowDays],
  );
  const windowFrom = windowR.rows[0].from_d;
  const windowTo   = windowR.rows[0].to_d;

  // Окно edges: агрегаты на пару + список рёбер для BFS.
  const edgesR = await c.query(
    `SELECT driver_id, client_id,
            SUM(orders_count)::int            AS orders_count,
            SUM(noncash_orders)::int          AS noncash_orders,
            SUM(short_trip_count)::int        AS short_trip_count,
            SUM(fast_arrival_count)::int      AS fast_arrival_count,
            SUM(total_gmv)::numeric           AS total_gmv,
            SUM(noncash_gmv)::numeric         AS noncash_gmv,
            SUM(cashback_generated_byn)::numeric AS cashback_generated,
            SUM(cashback_loss_risk_byn)::numeric AS cashback_risk,
            AVG(repeat_ratio)::numeric        AS repeat_ratio_avg,
            MAX(repeat_ratio)::numeric        AS repeat_ratio_max,
            AVG(pair_risk_score)::numeric     AS risk_avg,
            MAX(pair_risk_score)::numeric     AS risk_max,
            MAX(edge_strength)::numeric       AS strength_max,
            COUNT(*)::int                     AS days_present
       FROM graph_edges
      WHERE date BETWEEN $1::date AND $2::date
      GROUP BY driver_id, client_id`,
    [windowFrom, windowTo],
  );

  if (edgesR.rows.length === 0) {
    await c.query("UPDATE graph_nodes SET cluster_id = NULL");
    await c.query("DELETE FROM graph_clusters");
    log?.info({ component: "graph" }, "empty window — cleared nodes/clusters");
    return { nodes: 0, clusters: 0, suspicious: 0 };
  }

  // Узлы: агрегаты по edges за окно.
  const nodes = new Map(); // key = type:id → node-aggregate
  function nk(type, id) { return type + ":" + id; }
  function ensureNode(type, id) {
    const k = nk(type, id);
    let n = nodes.get(k);
    if (!n) {
      n = {
        type, id,
        orders: 0, gmv: 0, noncashGmv: 0,
        connections: 0, partners: new Set(),
        riskSum: 0, riskMax: 0, riskCnt: 0,
        cashbackGenerated: 0, cashbackRisk: 0,
        clusterId: null,
      };
      nodes.set(k, n);
    }
    return n;
  }

  // Список «сильных» рёбер для BFS.
  const strong = []; // {a:nk, b:nk, riskMax, repeatMax}

  for (const e of edgesR.rows) {
    const d = ensureNode("driver", e.driver_id);
    const cl = ensureNode("client", e.client_id);

    d.orders += Number(e.orders_count);
    d.gmv += Number(e.total_gmv);
    d.noncashGmv += Number(e.noncash_gmv);
    d.partners.add(nk("client", e.client_id));
    d.connections += 1;
    d.cashbackGenerated += Number(e.cashback_generated);
    d.cashbackRisk += Number(e.cashback_risk);
    d.riskSum += Number(e.risk_avg) * Number(e.days_present);
    d.riskCnt += Number(e.days_present);
    if (Number(e.risk_max) > d.riskMax) d.riskMax = Number(e.risk_max);

    cl.orders += Number(e.orders_count);
    cl.gmv += Number(e.total_gmv);
    cl.noncashGmv += Number(e.noncash_gmv);
    cl.partners.add(nk("driver", e.driver_id));
    cl.connections += 1;
    cl.cashbackGenerated += Number(e.cashback_generated);
    cl.cashbackRisk += Number(e.cashback_risk);
    cl.riskSum += Number(e.risk_avg) * Number(e.days_present);
    cl.riskCnt += Number(e.days_present);
    if (Number(e.risk_max) > cl.riskMax) cl.riskMax = Number(e.risk_max);

    if (Number(e.strength_max) > threshold) {
      strong.push({
        a: nk("driver", e.driver_id),
        b: nk("client", e.client_id),
        riskAvg: Number(e.risk_avg),
        riskMax: Number(e.risk_max),
        daysPresent: Number(e.days_present),
        repeatMax: Number(e.repeat_ratio_max),
        ordersCount: Number(e.orders_count),
        noncashOrders: Number(e.noncash_orders),
        shortTripCount: Number(e.short_trip_count),
        fastArrivalCount: Number(e.fast_arrival_count),
        cashbackGenerated: Number(e.cashback_generated),
        cashbackRisk: Number(e.cashback_risk),
        gmv: Number(e.total_gmv),
        noncashGmv: Number(e.noncash_gmv),
      });
    }
  }

  // BFS по сильным рёбрам — каждая компонента → cluster_id.
  const adj = new Map(); // key → Set(key)
  for (const s of strong) {
    if (!adj.has(s.a)) adj.set(s.a, new Set());
    if (!adj.has(s.b)) adj.set(s.b, new Set());
    adj.get(s.a).add(s.b);
    adj.get(s.b).add(s.a);
  }

  const visited = new Set();
  const clusters = []; // {id, members:[node-key], edges:[strong-edge]}
  let nextCid = 1;
  function newClusterId() { return "cl-" + windowTo + "-" + (nextCid++); }

  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const queue = [start];
    visited.add(start);
    const members = [];
    while (queue.length) {
      const cur = queue.shift();
      members.push(cur);
      for (const nb of adj.get(cur)) {
        if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
      }
    }
    const memSet = new Set(members);
    const cEdges = strong.filter((e) => memSet.has(e.a) && memSet.has(e.b));
    const cid = newClusterId();
    for (const k of members) {
      const n = nodes.get(k);
      if (n) n.clusterId = cid;
    }
    clusters.push({ id: cid, members, edges: cEdges });
  }

  // Запись graph_nodes (полный rewrite — окно меняется, проще пересоздать).
  await c.query("UPDATE graph_nodes SET cluster_id = NULL");
  if (nodes.size > 0) {
    const ids = [], types = [], orders = [], gmv = [], noncashGmv = [];
    const conn = [], partners = [], rAvg = [], rMax = [];
    const cbGen = [], cbRisk = [], cIds = [];
    for (const n of nodes.values()) {
      ids.push(n.id); types.push(n.type);
      orders.push(n.orders); gmv.push(n.gmv); noncashGmv.push(n.noncashGmv);
      conn.push(n.connections); partners.push(n.partners.size);
      const avg = n.riskCnt > 0 ? n.riskSum / n.riskCnt : 0;
      rAvg.push(Number(avg.toFixed(2))); rMax.push(Number(n.riskMax.toFixed(2)));
      cbGen.push(n.cashbackGenerated); cbRisk.push(n.cashbackRisk);
      cIds.push(n.clusterId);
    }
    await c.query(
      `INSERT INTO graph_nodes(
         entity_id, entity_type, total_orders, total_gmv, total_noncash_gmv,
         total_connections, unique_partners, risk_score_avg, risk_score_max,
         total_cashback_generated, total_cashback_risk, cluster_id, updated_at)
       SELECT *, now() FROM unnest(
         $1::text[], $2::text[], $3::int[], $4::numeric[], $5::numeric[],
         $6::int[],  $7::int[],  $8::numeric[], $9::numeric[],
         $10::numeric[], $11::numeric[], $12::text[]
       ) AS u(entity_id, entity_type, total_orders, total_gmv, total_noncash_gmv,
              total_connections, unique_partners, risk_score_avg, risk_score_max,
              total_cashback_generated, total_cashback_risk, cluster_id)
       ON CONFLICT (entity_id, entity_type) DO UPDATE SET
         total_orders             = EXCLUDED.total_orders,
         total_gmv                = EXCLUDED.total_gmv,
         total_noncash_gmv        = EXCLUDED.total_noncash_gmv,
         total_connections        = EXCLUDED.total_connections,
         unique_partners          = EXCLUDED.unique_partners,
         risk_score_avg           = EXCLUDED.risk_score_avg,
         risk_score_max           = EXCLUDED.risk_score_max,
         total_cashback_generated = EXCLUDED.total_cashback_generated,
         total_cashback_risk      = EXCLUDED.total_cashback_risk,
         cluster_id               = EXCLUDED.cluster_id,
         updated_at               = now()`,
      [ids, types, orders, gmv, noncashGmv, conn, partners, rAvg, rMax, cbGen, cbRisk, cIds],
    );
  }

  // Запись graph_clusters — полный rewrite за окно.
  await c.query("DELETE FROM graph_clusters");
  let suspiciousCount = 0;
  if (clusters.length > 0) {
    const cids = [], nc = [], dc = [], cc = [], oc = [];
    const tg = [], tng = [], tcg = [], tcr = [], tlr = [];
    const ar = [], mr = [], sus = [], ctype = [], reasons = [];
    const wfrom = [], wto = [];
    for (const cl of clusters) {
      const drivers = cl.members.filter((k) => k.startsWith("driver:"));
      const clients = cl.members.filter((k) => k.startsWith("client:"));
      let totalOrders = 0, totalGmv = 0, totalNoncashGmv = 0;
      let totalCbGen = 0, totalCbRisk = 0, totalLossRisk = 0;
      // avgRisk — взвешенное среднее risk_avg ребра по числу его дней в окне
      // (а не среднее riskMax: иначе §9 порог avgRisk>40 срабатывает завышенно).
      let riskSum = 0, riskWeight = 0, riskMax = 0;
      let maxRepeat = 0, totalShort = 0, totalNoncashOrders = 0;
      for (const e of cl.edges) {
        totalOrders += e.ordersCount;
        totalGmv += e.gmv;
        totalNoncashGmv += e.noncashGmv;
        totalCbGen += e.cashbackGenerated;
        totalCbRisk += e.cashbackRisk;
        totalLossRisk += e.cashbackRisk;
        riskSum    += e.riskAvg * e.daysPresent;
        riskWeight += e.daysPresent;
        if (e.riskMax > riskMax) riskMax = e.riskMax;
        if (e.repeatMax > maxRepeat) maxRepeat = e.repeatMax;
        totalShort += e.shortTripCount;
        totalNoncashOrders += e.noncashOrders;
      }
      const avgRisk = riskWeight > 0 ? riskSum / riskWeight : 0;

      // §9 — критерии подозрительности
      const suspicious =
        cl.members.length >= SUSPICIOUS_MIN_NODES &&
        totalLossRisk > SUSPICIOUS_MIN_LOSS_RISK &&
        avgRisk > SUSPICIOUS_MIN_AVG_RISK &&
        maxRepeat > SUSPICIOUS_MIN_REPEAT_RATIO;
      if (suspicious) suspiciousCount++;

      // §10 — типизация схемы
      const noncashShare = totalOrders > 0 ? totalNoncashOrders / totalOrders : 0;
      const shortShare   = totalOrders > 0 ? totalShort / totalOrders : 0;
      let cType = "mixed";
      if (drivers.length <= 2 && clients.length >= 3 &&
          noncashShare > 0.7 && totalCbGen > 50) {
        cType = "cashback_ring";
      } else if (clients.length <= 3 && totalOrders >= 30 && shortShare > 0.5) {
        cType = "driver_farm";
      } else if (drivers.length >= 2 && clients.length >= 2) {
        cType = "mixed_fraud";
      }

      const reason = {
        // maxRepeat уже в % (0..100) — не умножаем.
        reason: `${drivers.length} водителей и ${clients.length} клиентов, повтор до ${maxRepeat.toFixed(0)}%`,
        money: `${totalLossRisk.toFixed(2)} BYN под риском`,
        pattern: cType,
      };

      cids.push(cl.id);
      nc.push(cl.members.length); dc.push(drivers.length); cc.push(clients.length);
      oc.push(totalOrders);
      tg.push(Number(totalGmv.toFixed(2))); tng.push(Number(totalNoncashGmv.toFixed(2)));
      tcg.push(Number(totalCbGen.toFixed(2))); tcr.push(Number(totalCbRisk.toFixed(2)));
      tlr.push(Number(totalLossRisk.toFixed(2)));
      ar.push(Number(avgRisk.toFixed(2))); mr.push(Number(riskMax.toFixed(2)));
      sus.push(suspicious); ctype.push(cType); reasons.push(JSON.stringify(reason));
      wfrom.push(windowFrom); wto.push(windowTo);
    }

    await c.query(
      `INSERT INTO graph_clusters(
         cluster_id, nodes_count, drivers_count, clients_count, total_orders,
         total_gmv, total_noncash_gmv, total_cashback_generated, total_cashback_risk,
         total_collusion_loss_risk, avg_risk_score, max_risk_score,
         is_suspicious, cluster_type, reason, window_from, window_to, created_at, updated_at)
       SELECT *, now(), now() FROM unnest(
         $1::text[], $2::int[], $3::int[], $4::int[], $5::int[],
         $6::numeric[], $7::numeric[], $8::numeric[], $9::numeric[],
         $10::numeric[], $11::numeric[], $12::numeric[],
         $13::bool[], $14::text[], $15::jsonb[], $16::date[], $17::date[]
       ) AS u(cluster_id, nodes_count, drivers_count, clients_count, total_orders,
              total_gmv, total_noncash_gmv, total_cashback_generated, total_cashback_risk,
              total_collusion_loss_risk, avg_risk_score, max_risk_score,
              is_suspicious, cluster_type, reason, window_from, window_to)`,
      [cids, nc, dc, cc, oc, tg, tng, tcg, tcr, tlr, ar, mr, sus, ctype, reasons, wfrom, wto],
    );
  }

  log?.info(
    { component: "graph", nodes: nodes.size, clusters: clusters.length,
      suspicious: suspiciousCount, window: `${windowFrom}..${windowTo}` },
    "graph nodes/clusters recomputed",
  );

  return { nodes: nodes.size, clusters: clusters.length, suspicious: suspiciousCount };
}
