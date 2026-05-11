// routes/graph.mjs — T020 Graph Fraud Analysis API.
//   GET /graph/clusters                           — список кластеров
//   GET /graph/cluster/:id                        — кластер + узлы + связи
//   GET /graph/node/:type/:id                     — узел + топ-партнёры
//   GET /graph/edges                              — список связей с фильтрами
//
// Все эндпоинты требуют авторизации (как у /tickets).

import { Router } from "express";
import { z } from "zod";
import { query } from "../lib/db.mjs";
import { requireAuth } from "../lib/auth.mjs";

export const graphRouter = Router();

// ───────────────────────────────────── CLUSTERS LIST ─────────────────
// z.coerce.boolean() в zod парсит "false" как true (Boolean("false") === true),
// поэтому фильтр suspicious=false не работал бы. Используем явный enum-парсер.
const QBool = z.preprocess((v) => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return v; // даст ошибку валидации ниже
}, z.boolean().optional());

const ClustersQuery = z.object({
  suspicious:  QBool,
  cluster_type: z.enum(["cashback_ring","driver_farm","mixed_fraud","mixed"]).optional(),
  limit:       z.coerce.number().int().min(1).max(500).default(100),
  offset:      z.coerce.number().int().min(0).default(0),
});

graphRouter.get("/clusters", requireAuth(), async (req, res) => {
  const parsed = ClustersQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_request", details: parsed.error.flatten() });
  }
  const q = parsed.data;
  const conds = [];
  const params = [];
  const push = (sql, val) => { params.push(val); conds.push(sql.replace("?", `$${params.length}`)); };

  if (q.suspicious === true)  push("is_suspicious = ?", true);
  if (q.suspicious === false) push("is_suspicious = ?", false);
  if (q.cluster_type)         push("cluster_type = ?", q.cluster_type);

  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  params.push(q.limit, q.offset);

  const r = await query(
    `SELECT cluster_id, nodes_count, drivers_count, clients_count,
            total_orders, total_gmv, total_noncash_gmv,
            total_cashback_generated, total_cashback_risk,
            total_collusion_loss_risk, avg_risk_score, max_risk_score,
            is_suspicious, cluster_type, reason,
            window_from, window_to, updated_at
       FROM graph_clusters
       ${where}
      ORDER BY is_suspicious DESC, total_collusion_loss_risk DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const totalR = await query(
    `SELECT COUNT(*)::int AS total FROM graph_clusters ${where}`,
    params.slice(0, params.length - 2),
  );

  res.json({ ok: true, total: totalR.rows[0].total, items: r.rows });
});

// ───────────────────────────────────── CLUSTER DETAIL ────────────────
graphRouter.get("/cluster/:id", requireAuth(), async (req, res) => {
  const id = String(req.params.id);
  const head = await query(
    `SELECT * FROM graph_clusters WHERE cluster_id = $1`,
    [id],
  );
  if (head.rows.length === 0) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }
  const cluster = head.rows[0];

  const nodes = await query(
    `SELECT entity_id, entity_type, total_orders, total_gmv, total_noncash_gmv,
            total_connections, unique_partners, risk_score_avg, risk_score_max,
            total_cashback_generated, total_cashback_risk
       FROM graph_nodes
      WHERE cluster_id = $1
      ORDER BY entity_type, risk_score_max DESC`,
    [id],
  );

  const drivers = nodes.rows.filter((n) => n.entity_type === "driver").map((n) => n.entity_id);
  const clients = nodes.rows.filter((n) => n.entity_type === "client").map((n) => n.entity_id);

  let edges = { rows: [] };
  if (drivers.length > 0 && clients.length > 0) {
    // Один LATERAL за все ml-поля: по PK (entity_type, id_a, id_b, date)
    // ровно одно последнее предсказание в окне.
    edges = await query(
      `WITH agg AS (
         SELECT e.driver_id, e.client_id,
                SUM(e.orders_count)::int            AS orders_count,
                SUM(e.noncash_orders)::int          AS noncash_orders,
                SUM(e.short_trip_count)::int        AS short_trip_count,
                SUM(e.fast_arrival_count)::int      AS fast_arrival_count,
                SUM(e.total_gmv)::numeric           AS total_gmv,
                SUM(e.noncash_gmv)::numeric         AS noncash_gmv,
                SUM(e.cashback_generated_byn)::numeric AS cashback_generated_byn,
                SUM(e.cashback_loss_risk_byn)::numeric  AS cashback_loss_risk_byn,
                MAX(e.repeat_ratio)::numeric        AS repeat_ratio,
                MAX(e.pair_risk_score)::numeric     AS pair_risk_score,
                MAX(e.edge_strength)::numeric       AS edge_strength,
                MIN(e.first_seen_date)              AS first_seen_date,
                MAX(e.last_seen_date)               AS last_seen_date,
                SUM(CASE WHEN e.date BETWEEN $3::date AND $4::date THEN 1 ELSE 0 END)::int AS days_in_window
           FROM graph_edges e
          WHERE e.driver_id = ANY($1) AND e.client_id = ANY($2)
            AND e.date BETWEEN $3::date AND $4::date
          GROUP BY e.driver_id, e.client_id
       )
       SELECT agg.*,
              ml.score        AS ml_score,
              ml.disagreement AS ml_disagreement,
              ml.model_version AS ml_model_version
         FROM agg
         LEFT JOIN LATERAL (
           SELECT m.score, m.disagreement, m.model_version
             FROM ml_predictions m
            WHERE m.entity_type = 'pair'
              AND m.entity_id_a = agg.driver_id
              AND m.entity_id_b = agg.client_id
              AND m.date BETWEEN $3::date AND $4::date
            ORDER BY m.date DESC
            LIMIT 1
         ) ml ON TRUE
        ORDER BY agg.edge_strength DESC`,
      [drivers, clients, cluster.window_from, cluster.window_to],
    );
  }

  res.json({
    ok: true,
    cluster,
    nodes: nodes.rows,
    edges: edges.rows,
  });
});

// ───────────────────────────────────── NODE DETAIL ───────────────────
graphRouter.get("/node/:type/:id", requireAuth(), async (req, res) => {
  const type = String(req.params.type);
  if (type !== "driver" && type !== "client") {
    return res.status(400).json({ ok: false, error: "bad_type" });
  }
  const id = String(req.params.id);
  const node = await query(
    `SELECT * FROM graph_nodes WHERE entity_type = $1 AND entity_id = $2`,
    [type, id],
  );
  if (node.rows.length === 0) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  const partnerCol = type === "driver" ? "client_id" : "driver_id";
  const selfCol    = type === "driver" ? "driver_id" : "client_id";

  // Для ML-скоринга нам нужны driver_id/client_id отдельно, поэтому
  // проецируем партнёрские колонки в driver_id/client_id перед LATERAL.
  const driverExpr = type === "driver" ? "$1"      : "agg.partner_id";
  const clientExpr = type === "driver" ? "agg.partner_id" : "$1";

  const partners = await query(
    `WITH agg AS (
       SELECT ${partnerCol} AS partner_id,
              SUM(orders_count)::int               AS orders_count,
              SUM(noncash_orders)::int             AS noncash_orders,
              SUM(total_gmv)::numeric              AS total_gmv,
              SUM(noncash_gmv)::numeric            AS noncash_gmv,
              SUM(cashback_generated_byn)::numeric AS cashback_generated_byn,
              SUM(cashback_loss_risk_byn)::numeric AS cashback_loss_risk_byn,
              MAX(edge_strength)::numeric          AS edge_strength,
              MAX(pair_risk_score)::numeric        AS pair_risk_score,
              MIN(first_seen_date)                 AS first_seen_date,
              MAX(last_seen_date)                  AS last_seen_date
         FROM graph_edges
        WHERE ${selfCol} = $1
        GROUP BY ${partnerCol}
     )
     SELECT agg.*,
            ml.score        AS ml_score,
            ml.disagreement AS ml_disagreement,
            ml.model_version AS ml_model_version,
            ml.date         AS ml_date
       FROM agg
       LEFT JOIN LATERAL (
         SELECT m.score, m.disagreement, m.model_version, m.date
           FROM ml_predictions m
          WHERE m.entity_type = 'pair'
            AND m.entity_id_a = ${driverExpr}
            AND m.entity_id_b = ${clientExpr}
          ORDER BY m.date DESC
          LIMIT 1
       ) ml ON TRUE
      ORDER BY agg.edge_strength DESC, agg.orders_count DESC
      LIMIT 50`,
    [id],
  );

  res.json({ ok: true, node: node.rows[0], partners: partners.rows });
});

// ───────────────────────────────────── EDGES LIST ────────────────────
const EdgesQuery = z.object({
  date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_from:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  driver_id:     z.string().optional(),
  client_id:     z.string().optional(),
  min_strength:  z.coerce.number().min(0).max(1).optional(),
  limit:         z.coerce.number().int().min(1).max(500).default(100),
  offset:        z.coerce.number().int().min(0).default(0),
});

graphRouter.get("/edges", requireAuth(), async (req, res) => {
  const parsed = EdgesQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_request", details: parsed.error.flatten() });
  }
  const q = parsed.data;
  const conds = [];
  const params = [];
  const push = (sql, val) => { params.push(val); conds.push(sql.replace("?", `$${params.length}`)); };

  if (q.date)         push("date = ?",         q.date);
  if (q.date_from)    push("date >= ?",        q.date_from);
  if (q.date_to)      push("date <= ?",        q.date_to);
  if (q.driver_id)    push("driver_id = ?",    q.driver_id);
  if (q.client_id)    push("client_id = ?",    q.client_id);
  if (q.min_strength != null) push("edge_strength >= ?", q.min_strength);

  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  params.push(q.limit, q.offset);

  const r = await query(
    `SELECT driver_id, client_id, date,
            orders_count, completed_orders, noncash_orders,
            total_gmv, noncash_gmv,
            short_trip_count, fast_arrival_count,
            repeat_ratio, pair_risk_score,
            cashback_generated_byn, cashback_loss_risk_byn,
            days_seen, first_seen_date, last_seen_date,
            edge_strength
       FROM graph_edges
       ${where}
      ORDER BY edge_strength DESC, total_gmv DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  res.json({ ok: true, items: r.rows });
});
