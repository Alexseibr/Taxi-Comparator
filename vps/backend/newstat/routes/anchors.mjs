// routes/anchors.mjs — T013. Эндпоинты якорной сетки и распределения по дистанциям.
//
//   GET  /anchors/list          — массив якорей (id,name,type,address,lat,lng) для UI
//   GET  /anchors/meta          — диагностика: count, loaded_at, source_path, MKAD-фильтр
//   GET  /anchors/distance-breakdown?date=YYYY-MM-DD
//                                — агрегаты по 4 категориям дистанций за день
//   POST /anchors/reload        — ручной reload файла (только admin) — для тестов
import { Router } from "express";
import { requireAuth } from "../lib/auth.mjs";
import { query } from "../lib/db.mjs";
import { getAnchors, getAnchorsMeta, reloadAnchorsNow } from "../lib/anchors.mjs";

export const anchorsRouter = Router();

anchorsRouter.get("/list", requireAuth(), (_req, res) => {
  res.json({ ok: true, anchors: getAnchors() });
});

anchorsRouter.get("/meta", requireAuth(), (_req, res) => {
  res.json({ ok: true, meta: getAnchorsMeta() });
});

anchorsRouter.post("/reload", requireAuth(["admin"]), (_req, res) => {
  const changed = reloadAnchorsNow();
  res.json({ ok: true, changed, meta: getAnchorsMeta() });
});

anchorsRouter.get("/distance-breakdown", requireAuth(), async (req, res) => {
  const date = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: "bad_date" });
  }
  const r = await query(
    `SELECT dist_category,
            orders_count, noncash_orders, noncash_gmv, total_gmv,
            template_orders, template_noncash_gmv
       FROM daily_distance_breakdown
      WHERE date = $1`,
    [date],
  );
  // Гарантируем все 4 ключа в ответе, даже если для каких-то не было заказов.
  const map = new Map(r.rows.map((row) => [row.dist_category, row]));
  const out = ["short", "medium", "long", "outside"].map((k) => ({
    dist_category: k,
    orders_count: Number(map.get(k)?.orders_count ?? 0),
    noncash_orders: Number(map.get(k)?.noncash_orders ?? 0),
    noncash_gmv: Number(map.get(k)?.noncash_gmv ?? 0),
    total_gmv: Number(map.get(k)?.total_gmv ?? 0),
    template_orders: Number(map.get(k)?.template_orders ?? 0),
    template_noncash_gmv: Number(map.get(k)?.template_noncash_gmv ?? 0),
  }));
  res.json({ ok: true, date, breakdown: out });
});
