// routes/hidden_links.mjs — Hidden Links: device/IP shared signals
// Выявление мульти-аккаунтов по общим устройствам и IP-адресам.
import { Router } from "express";
import { z }      from "zod";
import { createHash } from "crypto";
import { query }  from "../lib/db.mjs";
import { requireAuth } from "../lib/auth.mjs";

export const hiddenLinksRouter = Router();

// ── helpers ─────────────────────────────────────────────────────────────────

function deviceHash(userAgent, platform) {
  if (!userAgent && !platform) return null;
  return createHash("sha256")
    .update((userAgent || "") + "|" + (platform || ""))
    .digest("hex")
    .slice(0, 32);
}

// ── recompute shared_signals ─────────────────────────────────────────────────
// Вычисляет все shared_signals заново по device_fingerprints и ip_links.
async function recomputeSharedSignals() {
  // 1. Общие устройства: клиент↔клиент
  await query(`
    DELETE FROM shared_signals WHERE signal_type = 'device'
  `);
  await query(`
    INSERT INTO shared_signals
      (entity_a_type, entity_a_id, entity_b_type, entity_b_id, signal_type, signal_value, strength)
    SELECT
      'client', a.entity_id,
      'client', b.entity_id,
      'device', a.device_hash,
      LEAST(10, 1 + COUNT(*))::numeric
    FROM device_fingerprints a
    JOIN device_fingerprints b
      ON b.device_hash = a.device_hash
     AND b.entity_id   > a.entity_id   -- avoid duplicates (a < b)
     AND b.entity_type = 'client'
    WHERE a.entity_type = 'client'
    GROUP BY a.entity_id, b.entity_id, a.device_hash
    ON CONFLICT (entity_a_type, entity_a_id, entity_b_type, entity_b_id, signal_type, signal_value)
    DO UPDATE SET strength = EXCLUDED.strength, updated_at = NOW()
  `);

  // 2. Общие IP: клиент↔клиент
  await query(`DELETE FROM shared_signals WHERE signal_type = 'ip'`);
  await query(`
    INSERT INTO shared_signals
      (entity_a_type, entity_a_id, entity_b_type, entity_b_id, signal_type, signal_value, strength)
    SELECT
      'client', a.entity_id,
      'client', b.entity_id,
      'ip', a.ip_address,
      LEAST(10, 1 + COUNT(*))::numeric
    FROM ip_links a
    JOIN ip_links b
      ON b.ip_address  = a.ip_address
     AND b.entity_id   > a.entity_id
     AND b.entity_type = 'client'
    WHERE a.entity_type = 'client'
    GROUP BY a.entity_id, b.entity_id, a.ip_address
    ON CONFLICT (entity_a_type, entity_a_id, entity_b_type, entity_b_id, signal_type, signal_value)
    DO UPDATE SET strength = EXCLUDED.strength, updated_at = NOW()
  `);

  const cnt = await query(`SELECT count(*)::int AS n FROM shared_signals`);
  return cnt.rows[0].n;
}

// ── POST /hidden-links/ingest ─────────────────────────────────────────────────
// Сохраняет device/IP данные для одного entity.
const IngestBody = z.object({
  entity_type: z.enum(["driver", "client"]),
  entity_id:   z.string().min(1).max(64),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ip_address:  z.string().ip().optional(),
  user_agent:  z.string().max(512).optional(),
  platform:    z.enum(["ios","android","web","unknown"]).optional(),
  device_id:   z.string().max(128).optional(),
});

hiddenLinksRouter.post("/ingest", requireAuth(["admin", "antifraud"]), async (req, res) => {
  const parsed = IngestBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });
  const { entity_type, entity_id, date, ip_address, user_agent, platform, device_id } = parsed.data;

  const dHash = device_id
    ? createHash("sha256").update(device_id).digest("hex").slice(0, 32)
    : deviceHash(user_agent, platform);

  if (dHash) {
    await query(
      `INSERT INTO device_fingerprints (entity_type, entity_id, device_hash, user_agent, platform, first_seen, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$6)
       ON CONFLICT (entity_type, entity_id, device_hash)
       DO UPDATE SET last_seen = GREATEST(device_fingerprints.last_seen, EXCLUDED.last_seen),
                     user_agent = COALESCE(EXCLUDED.user_agent, device_fingerprints.user_agent)`,
      [entity_type, entity_id, dHash, user_agent ?? null, platform ?? null, date],
    );
  }
  if (ip_address) {
    await query(
      `INSERT INTO ip_links (entity_type, entity_id, ip_address, first_seen, last_seen)
       VALUES ($1,$2,$3,$4,$4)
       ON CONFLICT (entity_type, entity_id, ip_address)
       DO UPDATE SET last_seen = GREATEST(ip_links.last_seen, EXCLUDED.last_seen)`,
      [entity_type, entity_id, ip_address, date],
    );
  }
  return res.json({ ok: true, device_hash: dHash ?? null });
});

// ── POST /hidden-links/recompute ─────────────────────────────────────────────
hiddenLinksRouter.post("/recompute", requireAuth(["admin"]), async (req, res) => {
  try {
    const n = await recomputeSharedSignals();
    return res.json({ ok: true, shared_signals: n });
  } catch (e) {
    req.log.error({ err: String(e) }, "recompute shared_signals failed");
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── GET /hidden-links/signals ─────────────────────────────────────────────────
// Возвращает список скрытых связей с фильтром.
hiddenLinksRouter.get("/signals", requireAuth(), async (req, res) => {
  const signal_type = req.query.signal_type;
  const entity_id   = req.query.entity_id;
  const limit       = Math.min(Number(req.query.limit) || 200, 500);

  const conds  = [];
  const params = [];

  if (signal_type && ["device","ip"].includes(signal_type)) {
    params.push(signal_type);
    conds.push(`signal_type = $${params.length}`);
  }
  if (entity_id) {
    params.push(String(entity_id));
    conds.push(`(entity_a_id = $${params.length} OR entity_b_id = $${params.length})`);
  }

  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  params.push(limit);

  const r = await query(
    `SELECT id, entity_a_type, entity_a_id, entity_b_type, entity_b_id,
            signal_type, signal_value, strength, updated_at
       FROM shared_signals
       ${where}
       ORDER BY strength DESC, updated_at DESC
       LIMIT $${params.length}`,
    params,
  );
  return res.json({ ok: true, count: r.rowCount, signals: r.rows });
});

// ── GET /hidden-links/clusters ────────────────────────────────────────────────
// Возвращает кластеры клиентов, связанных через общее устройство.
// Кластер: >= 2 клиента → один device_hash.
hiddenLinksRouter.get("/clusters", requireAuth(), async (req, res) => {
  const min_size  = Math.max(2, Number(req.query.min_size) || 2);
  const type      = req.query.signal_type || "device";
  const limit     = Math.min(Number(req.query.limit) || 100, 500);

  const r = await query(
    `SELECT
       signal_value,
       signal_type,
       count(DISTINCT entity_a_id)::int +
         count(DISTINCT entity_b_id)::int -
         count(DISTINCT entity_a_id)::int   AS cluster_size,
       array_agg(DISTINCT entity_a_id) ||
         array_agg(DISTINCT entity_b_id)   AS client_ids,
       MAX(strength)                        AS max_strength,
       MAX(updated_at)                      AS last_seen
     FROM shared_signals
     WHERE signal_type = $1
     GROUP BY signal_value, signal_type
     HAVING count(DISTINCT entity_a_id) + count(DISTINCT entity_b_id) >= $2
     ORDER BY cluster_size DESC, max_strength DESC
     LIMIT $3`,
    [type, min_size, limit],
  );
  return res.json({ ok: true, count: r.rowCount, clusters: r.rows });
});

// ── GET /hidden-links/entity/:type/:id ───────────────────────────────────────
// Все hidden links для конкретного entity.
hiddenLinksRouter.get("/entity/:type/:id", requireAuth(), async (req, res) => {
  const { type, id } = req.params;
  if (!["driver","client"].includes(type)) {
    return res.status(400).json({ ok: false, error: "bad_type" });
  }

  const [signals, devices, ips] = await Promise.all([
    query(
      `SELECT entity_a_id, entity_b_id, signal_type, signal_value, strength, updated_at
         FROM shared_signals
        WHERE (entity_a_id = $1 AND entity_a_type = $2)
           OR (entity_b_id = $1 AND entity_b_type = $2)
        ORDER BY strength DESC`,
      [id, type],
    ),
    query(
      `SELECT device_hash, user_agent, platform, first_seen, last_seen
         FROM device_fingerprints
        WHERE entity_type = $1 AND entity_id = $2`,
      [type, id],
    ),
    query(
      `SELECT ip_address, first_seen, last_seen
         FROM ip_links
        WHERE entity_type = $1 AND entity_id = $2`,
      [type, id],
    ),
  ]);

  return res.json({
    ok: true,
    entity_type: type,
    entity_id: id,
    signals: signals.rows,
    device_fingerprints: devices.rows,
    ip_links: ips.rows,
  });
});

// ── POST /hidden-links/create-cluster-tickets ─────────────────────────────────
// Для кластеров (device, >=3 клиентов) ищем связанных водителей и создаём тикеты.
hiddenLinksRouter.post("/create-cluster-tickets", requireAuth(["admin"]), async (req, res) => {
  // Находим все device-кластеры >=3 клиентов
  const clusters = await query(`
    SELECT
      signal_value AS device_hash,
      array_agg(DISTINCT entity_a_id || ':' || entity_b_id) AS pairs,
      (array_agg(DISTINCT entity_a_id) || array_agg(DISTINCT entity_b_id)) AS all_clients
    FROM shared_signals
    WHERE signal_type = 'device'
    GROUP BY signal_value
    HAVING count(DISTINCT entity_a_id) + count(DISTINCT entity_b_id) >= 3
  `);

  let created = 0;
  for (const cluster of clusters.rows) {
    const clientIds = [...new Set(cluster.all_clients)];

    // Находим водителей, которые работали с >=2 клиентами из кластера
    const drivers = await query(`
      SELECT driver_id, count(DISTINCT client_id)::int AS client_count
        FROM orders
       WHERE client_id = ANY($1::text[])
         AND driver_id IS NOT NULL
       GROUP BY driver_id
      HAVING count(DISTINCT client_id) >= 2
    `, [clientIds]);

    for (const drv of drivers.rows) {
      // Создаём один тикет на водителя+кластер
      const existing = await query(`
        SELECT ticket_id FROM fraud_tickets
         WHERE entity_type = 'pair'
           AND driver_id = $1
           AND signals->>'source' = 'multi_account_device'
           AND signals->>'device_hash' = $2
      `, [drv.driver_id, cluster.device_hash]);

      if (existing.rows[0]) continue;

      // Берём последнюю дату поездки с этими клиентами
      const lastDate = await query(`
        SELECT order_date FROM orders
         WHERE driver_id = $1 AND client_id = ANY($2::text[])
         ORDER BY order_date DESC LIMIT 1
      `, [drv.driver_id, clientIds]);

      if (!lastDate.rows[0]) continue;
      const date = lastDate.rows[0].order_date;

      await query(`
        INSERT INTO fraud_tickets
          (entity_type, driver_id, date, risk_score, risk_type,
           priority, signals, suspicious_orders, previous_flags_count, created_by)
        VALUES ('pair', $1, $2, 75, 'collusion', 'high', $3::jsonb, '[]'::jsonb, 0, $4)
        ON CONFLICT DO NOTHING
      `, [
        drv.driver_id,
        date,
        JSON.stringify({
          source: "multi_account_device",
          device_hash: cluster.device_hash,
          client_ids: clientIds,
          client_count: drv.client_count,
          reason: "MULTI_ACCOUNT_DEVICE",
        }),
        req.user.login,
      ]);
      created++;
    }
  }

  return res.json({ ok: true, tickets_created: created });
});

// ── GET /hidden-links/stats ───────────────────────────────────────────────────
hiddenLinksRouter.get("/stats", requireAuth(), async (req, res) => {
  const r = await query(`
    SELECT
      (SELECT count(*) FROM device_fingerprints)::int AS device_fingerprints,
      (SELECT count(*) FROM ip_links)::int             AS ip_links_total,
      (SELECT count(*) FROM shared_signals WHERE signal_type='device')::int AS device_signals,
      (SELECT count(*) FROM shared_signals WHERE signal_type='ip')::int     AS ip_signals,
      (SELECT count(*) FROM shared_signals)::int                            AS total_signals
  `);
  return res.json({ ok: true, ...r.rows[0] });
});
