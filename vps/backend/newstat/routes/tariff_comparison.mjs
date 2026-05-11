// routes/tariff_comparison.mjs — T013: Сравнение тарифов Yandex (скрины) vs WB (orders).
//
//   GET /parsing/tariff-comparison?from=YYYY-MM-DD&to=YYYY-MM-DD
//   Auth: requireAuth(["admin","antifraud"]).
//
// Метод честного сравнения:
//   1. Нормализация к ставке BYN/км и BYN/мин (не к абсолютной сумме).
//   2. Только status='completed', gmv>0, km>0 для WB; не-suspicious для Yandex.
//   3. Маппинг WB-классов: car_class_create=644 → Эконом, 645 → Комфорт.
//   4. Время в Europe/Minsk (UTC+3 фиксировано для РБ).
//   5. Бакеты: час суток (0..23) × дист.корзина (0-3, 3-10, 10-25, 25+).
//   6. Метрика: median, P25, P75, count. Δ% = (Y.med - WB.med)/WB.med*100.
//   7. Бакеты с count<5 помечаются low_data:true и значения null.

import { Router } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { query } from "../lib/db.mjs";
import { requireAuth } from "../lib/auth.mjs";

export const tariffComparisonRouter = Router();

const CALIB_DIR = process.env.CALIB_DIR || "/var/www/rwbtaxi/data/calib";
const MAX_DAYS = 31;
const MAX_FILES = 30000;
const MIN_BUCKET_COUNT = 5;
const MINSK_OFFSET_MS = 3 * 60 * 60 * 1000;

const DIST_BUCKETS = [
  { key: "0-3", min: 0, max: 3 },
  { key: "3-10", min: 3, max: 10 },
  { key: "10-25", min: 10, max: 25 },
  { key: "25+", min: 25, max: Infinity },
];

const QuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function daysBetweenInclusive(from, to) {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / 86400000) + 1;
}

function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function distBucketKey(km) {
  if (!Number.isFinite(km) || km <= 0) return null;
  for (const b of DIST_BUCKETS) {
    if (km >= b.min && km < b.max) return b.key;
  }
  return null;
}

// Median/P25/P75. Возвращает {median, p25, p75, count}.
function quantStats(arr) {
  const n = arr.length;
  if (n === 0) return { median: null, p25: null, p75: null, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const q = (p) => {
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  return {
    median: +q(0.5).toFixed(3),
    p25: +q(0.25).toFixed(3),
    p75: +q(0.75).toFixed(3),
    count: n,
  };
}

function deltaPct(yMed, wbMed) {
  if (yMed == null || wbMed == null || wbMed === 0) return null;
  return +(((yMed - wbMed) / wbMed) * 100).toFixed(1);
}

// Загрузка WB-заказов из БД, агрегация по тарифу × часу × дист.корзине.
// Возвращает { econom: { byHourBucket, all }, comfort: { byHourBucket, all } }
// где byHourBucket — Map "h|bucket" → { byn_per_km: [], byn_per_min: [] }
async function loadWbAggregates(from, to) {
  const rows = await query(
    `
    SELECT
      EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Europe/Minsk'))::int AS h,
      gmv::float AS gmv,
      km::float AS km,
      trip_minutes::float AS tmin,
      car_class_create AS klass
    FROM orders
    WHERE order_date BETWEEN $1 AND $2
      AND status = 'completed'
      AND gmv > 0
      AND km > 0
      AND car_class_create IN ('644', '645')
      AND created_at IS NOT NULL
    `,
    [from, to],
  );

  const result = {
    econom: { byHourBucket: new Map(), allKm: [], allMin: [] },
    comfort: { byHourBucket: new Map(), allKm: [], allMin: [] },
  };

  for (const r of rows.rows) {
    const tier = r.klass === "644" ? "econom" : "comfort";
    const bucket = distBucketKey(r.km);
    if (!bucket) continue;
    const ratePerKm = r.gmv / r.km;
    if (!Number.isFinite(ratePerKm) || ratePerKm <= 0 || ratePerKm > 100)
      continue; // отбрасываем явные выбросы (>100 BYN/км это мусор)
    result[tier].allKm.push(ratePerKm);
    const key = `${r.h}|${bucket}`;
    if (!result[tier].byHourBucket.has(key)) {
      result[tier].byHourBucket.set(key, { km: [], min: [] });
    }
    result[tier].byHourBucket.get(key).km.push(ratePerKm);
    if (r.tmin != null && r.tmin > 0) {
      const ratePerMin = r.gmv / r.tmin;
      if (Number.isFinite(ratePerMin) && ratePerMin > 0 && ratePerMin < 100) {
        result[tier].byHourBucket.get(key).min.push(ratePerMin);
        result[tier].allMin.push(ratePerMin);
      }
    }
  }
  return result;
}

// Загрузка Yandex-скринов из calib-*.json в окне дат, агрегация так же.
async function loadYandexAggregates(from, to) {
  let names = [];
  try {
    names = await fs.readdir(CALIB_DIR);
  } catch (e) {
    return {
      econom: { byHourBucket: new Map(), allKm: [], allMin: [] },
      comfort: { byHourBucket: new Map(), allKm: [], allMin: [] },
      scanned: 0,
      used: 0,
    };
  }
  // Имена calib-YYYY-MM-DD-h..-…json — фильтруем по подстроке даты
  // быстрый фильтр: дата в имени должна быть в окне
  const fromMs = Date.parse(from + "T00:00:00Z");
  const toMs = Date.parse(to + "T23:59:59Z");

  const result = {
    econom: { byHourBucket: new Map(), allKm: [], allMin: [] },
    comfort: { byHourBucket: new Map(), allKm: [], allMin: [] },
    scanned: 0,
    used: 0,
  };
  let processed = 0;
  for (const name of names) {
    if (!name.startsWith("calib-") || !name.endsWith(".json")) continue;
    // calib-YYYY-MM-DD-...
    const dateInName = name.slice(6, 16);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInName)) continue;
    const dMs = Date.parse(dateInName + "T00:00:00Z");
    if (!Number.isFinite(dMs) || dMs < fromMs - 86400000 || dMs > toMs)
      continue;
    if (processed++ >= MAX_FILES) break;
    let d;
    try {
      d = JSON.parse(await fs.readFile(path.join(CALIB_DIR, name), "utf8"));
    } catch {
      continue;
    }
    result.scanned++;
    if (d?.anomaly?.suspicious === true) continue;
    // Дата в Минске
    const dateLocal = d.date || dateInName;
    if (dateLocal < from || dateLocal > to) continue;
    // Час
    let h = typeof d.hour === "number" ? d.hour : null;
    if (h == null && typeof d.screenLocalTime === "string") {
      const m = /^(\d{1,2}):/.exec(d.screenLocalTime);
      if (m) h = +m[1];
    }
    if (h == null || h < 0 || h > 23) continue;
    // Дистанция
    let km = +d?.matchedRecommendation?.expectedDistanceKm;
    if (!Number.isFinite(km) || km <= 0) {
      if (
        Number.isFinite(d.fromLat) &&
        Number.isFinite(d.fromLng) &&
        Number.isFinite(d.toLat) &&
        Number.isFinite(d.toLng)
      ) {
        km = haversineKm(d.fromLat, d.fromLng, d.toLat, d.toLng) * 1.35;
      }
    }
    const bucket = distBucketKey(km);
    if (!bucket) continue;
    const tmin = Number.isFinite(+d.tripMin) && +d.tripMin > 0 ? +d.tripMin : null;
    // Эконом
    const factE = +d.factE;
    if (Number.isFinite(factE) && factE > 0) {
      const rkm = factE / km;
      if (Number.isFinite(rkm) && rkm > 0 && rkm <= 100) {
        result.econom.allKm.push(rkm);
        const key = `${h}|${bucket}`;
        if (!result.econom.byHourBucket.has(key))
          result.econom.byHourBucket.set(key, { km: [], min: [] });
        result.econom.byHourBucket.get(key).km.push(rkm);
        if (tmin) {
          const rmin = factE / tmin;
          if (Number.isFinite(rmin) && rmin > 0 && rmin < 100) {
            result.econom.byHourBucket.get(key).min.push(rmin);
            result.econom.allMin.push(rmin);
          }
        }
      }
    }
    // Комфорт
    const factC = +d.factC;
    if (Number.isFinite(factC) && factC > 0) {
      const rkm = factC / km;
      if (Number.isFinite(rkm) && rkm > 0 && rkm <= 100) {
        result.comfort.allKm.push(rkm);
        const key = `${h}|${bucket}`;
        if (!result.comfort.byHourBucket.has(key))
          result.comfort.byHourBucket.set(key, { km: [], min: [] });
        result.comfort.byHourBucket.get(key).km.push(rkm);
        if (tmin) {
          const rmin = factC / tmin;
          if (Number.isFinite(rmin) && rmin > 0 && rmin < 100) {
            result.comfort.byHourBucket.get(key).min.push(rmin);
            result.comfort.allMin.push(rmin);
          }
        }
      }
    }
    result.used++;
  }
  return result;
}

// Сборка финального ответа: на каждый (tier, h, bucket) — wb/y stats + delta_pct.
function buildBucketReport(wbT, yT) {
  const cells = [];
  for (let h = 0; h < 24; h++) {
    for (const b of DIST_BUCKETS) {
      const key = `${h}|${b.key}`;
      const wb = wbT.byHourBucket.get(key) || { km: [], min: [] };
      const y = yT.byHourBucket.get(key) || { km: [], min: [] };
      const wbKm = quantStats(wb.km);
      const yKm = quantStats(y.km);
      const wbMin = quantStats(wb.min);
      const yMin = quantStats(y.min);
      const lowKm = wbKm.count < MIN_BUCKET_COUNT || yKm.count < MIN_BUCKET_COUNT;
      const lowMin = wbMin.count < MIN_BUCKET_COUNT || yMin.count < MIN_BUCKET_COUNT;
      cells.push({
        hour: h,
        bucket: b.key,
        byn_per_km: {
          wb: wbKm,
          yandex: yKm,
          delta_pct: lowKm ? null : deltaPct(yKm.median, wbKm.median),
          low_data: lowKm,
        },
        byn_per_min: {
          wb: wbMin,
          yandex: yMin,
          delta_pct: lowMin ? null : deltaPct(yMin.median, wbMin.median),
          low_data: lowMin,
        },
      });
    }
  }
  return cells;
}

// Mix-adjusted Δ%: взвешенная средняя дельт по «общим» (h,bucket)-ячейкам,
// где обе стороны имеют ≥MIN_BUCKET_COUNT, веса = WB.count в ячейке.
// Это устраняет Simpson/mix bias: «при той же структуре час×дист как у WB,
// насколько Я был бы дороже». Если общих ячеек нет — null.
function mixAdjustedDelta(cells, rateKey) {
  let wsum = 0;
  let dsum = 0;
  let overlap = 0;
  for (const c of cells) {
    const r = c[rateKey];
    if (r.low_data || r.delta_pct == null) continue;
    const w = r.wb.count || 0;
    if (w <= 0) continue;
    wsum += w;
    dsum += r.delta_pct * w;
    overlap++;
  }
  if (wsum === 0) return { delta_pct: null, overlap_cells: 0, wb_orders_in_overlap: 0 };
  return {
    delta_pct: +(dsum / wsum).toFixed(1),
    overlap_cells: overlap,
    wb_orders_in_overlap: wsum,
  };
}

function buildOverall(wbT, yT, cells) {
  const wbKm = quantStats(wbT.allKm);
  const yKm = quantStats(yT.allKm);
  const wbMin = quantStats(wbT.allMin);
  const yMin = quantStats(yT.allMin);
  return {
    byn_per_km: {
      wb: wbKm,
      yandex: yKm,
      delta_pct: deltaPct(yKm.median, wbKm.median),
      mix_adjusted: mixAdjustedDelta(cells, "byn_per_km"),
    },
    byn_per_min: {
      wb: wbMin,
      yandex: yMin,
      delta_pct: deltaPct(yMin.median, wbMin.median),
      mix_adjusted: mixAdjustedDelta(cells, "byn_per_min"),
      // Источники несимметричны: WB.tmin = trip_minutes (факт),
      // Yandex.tmin = tripMin из скрина (оценка перед поездкой).
      // BYN/мин — справочный показатель, основной — BYN/км.
      note: "wb_source=trip_minutes(actual), yandex_source=tripMin(estimate_from_screen)",
    },
  };
}

// In-memory кэш: устраняет повторный full scan calib-каталога
// для одного и того же диапазона при rapid-обновлении страницы.
// TTL 60s, ключ from|to.
const CACHE_TTL_MS = 60_000;
const _cache = new Map(); // key → { ts, payload }
function cacheGet(key) {
  const v = _cache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > CACHE_TTL_MS) {
    _cache.delete(key);
    return null;
  }
  return v.payload;
}
function cacheSet(key, payload) {
  // ограничим размер: не более 64 ключей
  if (_cache.size >= 64) {
    const firstKey = _cache.keys().next().value;
    _cache.delete(firstKey);
  }
  _cache.set(key, { ts: Date.now(), payload });
}

tariffComparisonRouter.get(
  "/tariff-comparison",
  requireAuth(["admin", "antifraud"]),
  async (req, res) => {
    try {
      const parsed = QuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ ok: false, error: "bad_query", details: parsed.error.flatten() });
      }
      const { from, to } = parsed.data;
      const span = daysBetweenInclusive(from, to);
      if (!Number.isFinite(span) || span <= 0) {
        return res.status(400).json({ ok: false, error: "bad_range" });
      }
      if (span > MAX_DAYS) {
        return res
          .status(400)
          .json({ ok: false, error: "range_too_wide", max_days: MAX_DAYS });
      }

      const cacheKey = `${from}|${to}`;
      const cached = cacheGet(cacheKey);
      if (cached) {
        res.set("Cache-Control", "private, max-age=60");
        res.set("X-Cache", "HIT");
        return res.json({ ...cached, cached: true });
      }

      const t0 = Date.now();
      const [wb, y] = await Promise.all([
        loadWbAggregates(from, to),
        loadYandexAggregates(from, to),
      ]);

      const econCells = buildBucketReport(wb.econom, y.econom);
      const comfCells = buildBucketReport(wb.comfort, y.comfort);

      const result = {
        ok: true,
        from,
        to,
        span_days: span,
        generated_at: new Date().toISOString(),
        duration_ms: 0,
        method: {
          rates: ["byn_per_km", "byn_per_min"],
          wb_filter: "status=completed AND gmv>0 AND km>0",
          wb_class_map: { 644: "econom", 645: "comfort" },
          yandex_filter: "anomaly.suspicious != true",
          dist_buckets_km: DIST_BUCKETS.map((b) => b.key),
          min_bucket_count: MIN_BUCKET_COUNT,
          timezone: "Europe/Minsk",
          outlier_cap_byn_per_unit: 100,
          mix_adjusted_note:
            "overall.mix_adjusted.delta_pct = взвешенная средняя cell.delta_pct по WB.count в общих ячейках, устраняет Simpson bias",
        },
        summary: {
          wb: {
            econom_count: wb.econom.allKm.length,
            comfort_count: wb.comfort.allKm.length,
          },
          yandex: {
            scanned: y.scanned,
            used: y.used,
            econom_count: y.econom.allKm.length,
            comfort_count: y.comfort.allKm.length,
          },
        },
        tariffs: {
          econom: {
            overall: buildOverall(wb.econom, y.econom, econCells),
            cells: econCells,
          },
          comfort: {
            overall: buildOverall(wb.comfort, y.comfort, comfCells),
            cells: comfCells,
          },
        },
      };
      result.duration_ms = Date.now() - t0;

      cacheSet(cacheKey, result);
      res.set("Cache-Control", "private, max-age=60");
      res.set("X-Cache", "MISS");
      return res.json(result);
    } catch (e) {
      try {
        req.log?.error?.(
          { err: e?.message, stack: e?.stack },
          "tariff-comparison failed",
        );
      } catch {
        /* */
      }
      return res
        .status(500)
        .json({ ok: false, error: "internal", message: e?.message || String(e) });
    }
  },
);
