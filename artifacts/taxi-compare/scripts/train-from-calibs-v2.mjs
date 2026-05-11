#!/usr/bin/env node
// v2: расширенная модель с piecewise-linear km, time-pulses, погодой.
//
// Фичи (13):
//   intercept, km, is_short(<1.5km), km_excess(>1.5km),
//   is_red, is_yellow,
//   hour_sin, hour_cos,
//   is_morning_peak (h7-9), is_evening_rush (h15-19), is_night (h22-5),
//   eta_excess, is_rain
//
// Что отличается от v1:
//   • km² → piecewise-linear (is_short + km_excess) — лечит «длинные перезавышены, короткие занижены»
//   • Жёсткий sanity-фильтр: km/etaMin > 60 км/ч → etaMin игнорируется (физический мусор)
//   • Минимальная цена floor: 5 BYN (E) / 6 BYN (C) — реальная минималка Yandex
//   • Bucket-фичи времени (точечные пики), а не только circular
//   • is_rain из Open-Meteo, по дате+часу
//
// Запуск: node scripts/train-from-calibs-v2.mjs --calib-dir /tmp/calibs-work/calibs --weather /tmp/calibs-work/weather.json

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const argv = (k, def) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const CALIB_DIR = argv("--calib-dir", "/tmp/calib");
const WEATHER = argv("--weather", "");
const OUT = join(ROOT, "src/data/pricing-model.json");
const SKIP_LOO = args.includes("--no-loo");

mkdirSync(dirname(OUT), { recursive: true });

const weather = WEATHER ? JSON.parse(readFileSync(WEATHER, "utf8")) : {};
function isRainFor(date, hour) {
  if (!weather) return 0;
  const key = `${date}T${String(hour).padStart(2, "0")}:00`;
  const w = weather[key];
  return w && (w.precip || 0) > 0.05 ? 1 : 0;
}

function haversineKm(la1, lo1, la2, lo2) {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(la2 - la1), dLng = toRad(lo2 - lo1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

function lstsq(X, y) {
  const n = X.length, k = X[0].length;
  if (n < k) return null;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let i = 0; i < n; i++) for (let r = 0; r < k; r++) {
    A[r][k] += X[i][r] * y[i];
    for (let c = 0; c < k; c++) A[r][c] += X[i][r] * X[i][c];
  }
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let c = 0; c <= k; c++) A[col][c] /= d;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let c = 0; c <= k; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map(row => row[k]);
}
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// ─── load + sanity-filter calibs ─────────────────────────────────────────
const files = readdirSync(CALIB_DIR).filter(f => f.startsWith("calib-") && f.endsWith(".json"));
console.log(`[train v2] read ${files.length} calib-*.json from ${CALIB_DIR}`);

let stats = { totalRead: 0, noFact: 0, highAnom: 0, badGeo: 0, badKm: 0, etaImpossible: 0, kept: 0 };
const records = [];
for (const f of files) {
  let j;
  try { j = JSON.parse(readFileSync(join(CALIB_DIR, f), "utf8")); } catch { continue; }
  stats.totalRead++;
  if (typeof j.factE !== "number" || typeof j.factC !== "number") { stats.noFact++; continue; }
  if (j.anomaly && j.anomaly.severity === "high") { stats.highAnom++; continue; }
  const lat1 = +j.fromLat, lng1 = +j.fromLng, lat2 = +j.toLat, lng2 = +j.toLng;
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) { stats.badGeo++; continue; }
  const km = haversineKm(lat1, lng1, lat2, lng2);
  if (!Number.isFinite(km) || km < 0.3 || km > 60) { stats.badKm++; continue; }

  const tripMin = typeof j.tripMin === "number" && j.tripMin >= 1 && j.tripMin <= 240 ? j.tripMin : null;
  let etaSrc = typeof j.etaMin === "number" && j.etaMin >= 1 && j.etaMin <= 240 ? j.etaMin : tripMin;
  // sanity: > 60 км/ч в Минске нереально → eta распознан с ошибкой, считаем etaExcess=0
  if (etaSrc != null && (km / etaSrc) * 60 > 60) {
    stats.etaImpossible++;
    etaSrc = null;
  }
  const idealMin = (km * 60) / 24;
  const etaExcess = etaSrc != null && idealMin > 0 ? Math.max(0, etaSrc / idealMin - 1) : 0;

  const h = ((j.hour ?? 0) % 24 + 24) % 24;
  const demand = (j.demand || j.demandColor || "").toLowerCase();
  const date = j.date || (j.receivedAt ? j.receivedAt.slice(0, 10) : "");
  records.push({
    file: f, fromAddress: j.fromAddress || "", toAddress: j.toAddress || "",
    km, etaExcess, hour: h, date,
    isRed: demand === "red" ? 1 : 0,
    isYellow: demand === "yellow" ? 1 : 0,
    isShort: km < 1.5 ? 1 : 0,
    kmExcess: Math.max(0, km - 1.5),
    isMorningPeak: h >= 7 && h <= 9 ? 1 : 0,
    isEveningRush: h >= 15 && h <= 19 ? 1 : 0,
    isNight: (h >= 22 || h <= 5) ? 1 : 0,
    isRain: isRainFor(date, h),
    factE: j.factE, factC: j.factC,
  });
  stats.kept++;
}
console.log(`[train v2] фильтр:`, stats);
console.log(`[train v2] осталось ${records.length} записей`);
console.log(`[train v2]   is_short=1:        ${records.filter(r => r.isShort).length}`);
console.log(`[train v2]   morning_peak=1:    ${records.filter(r => r.isMorningPeak).length}`);
console.log(`[train v2]   evening_rush=1:    ${records.filter(r => r.isEveningRush).length}`);
console.log(`[train v2]   night=1:           ${records.filter(r => r.isNight).length}`);
console.log(`[train v2]   rain=1:            ${records.filter(r => r.isRain).length}`);
console.log(`[train v2]   eta_excess>0:      ${records.filter(r => r.etaExcess > 0.01).length}`);

const FEATURE_NAMES = [
  "intercept", "km", "is_short", "km_excess",
  "is_red", "is_yellow",
  "hour_sin", "hour_cos",
  "is_morning_peak", "is_evening_rush", "is_night",
  "eta_excess", "is_rain",
];
function featuresOf(r) {
  const a = (2 * Math.PI * r.hour) / 24;
  return [
    1, r.km, r.isShort, r.kmExcess,
    r.isRed, r.isYellow,
    Math.sin(a), Math.cos(a),
    r.isMorningPeak, r.isEveningRush, r.isNight,
    r.etaExcess, r.isRain,
  ];
}

function filterOutliers(rs, target) {
  return rs.filter(r => {
    const v = r[target];
    if (v == null || v < 1 || v > 200) return false;
    const perKm = v / r.km;
    if (perKm > 30 || perKm < 0.5) return false;
    return true;
  });
}

function trainOne(records, target, label) {
  const ds0 = filterOutliers(records, target);
  const X0 = ds0.map(featuresOf);
  const y0 = ds0.map(r => r[target]);
  const w0 = lstsq(X0, y0);
  if (!w0) { console.log(`[train ${label}] ⚠ singular matrix`); return null; }

  const RATIO_LO = 0.5, RATIO_HI = 2.0;
  const keep = [];
  let removed = 0;
  for (let i = 0; i < ds0.length; i++) {
    const pred = Math.max(0.5, dot(w0, X0[i]));
    const ratio = y0[i] / pred;
    if (ratio >= RATIO_LO && ratio <= RATIO_HI) keep.push(i);
    else removed++;
  }
  let ds = ds0, X = X0, y = y0, w = w0;
  if (removed > 0 && keep.length >= FEATURE_NAMES.length + 5) {
    ds = keep.map(i => ds0[i]);
    X = keep.map(i => X0[i]);
    y = keep.map(i => y0[i]);
    const w2 = lstsq(X, y);
    if (w2) w = w2;
    console.log(`[train ${label}] pass-2: убрано ${removed} (ratio ∉ [${RATIO_LO}, ${RATIO_HI}]), переобучено на ${ds.length}`);
  }

  const errs = [], pcts = [];
  for (let i = 0; i < ds.length; i++) {
    const pred = dot(w, X[i]);
    const err = pred - y[i];
    errs.push(Math.abs(err));
    pcts.push(Math.abs(err) / Math.max(1, y[i]));
  }
  const mae = mean(errs), mape = mean(pcts);
  const hit10 = pcts.filter(p => p <= 0.10).length / pcts.length;
  const hit25 = pcts.filter(p => p <= 0.25).length / pcts.length;

  let mapeLoo = null, hit10Loo = null, hit25Loo = null;
  if (!SKIP_LOO && ds.length > 30) {
    const pcts2 = [];
    for (let i = 0; i < ds.length; i++) {
      const Xi = X.filter((_, j) => j !== i);
      const yi = y.filter((_, j) => j !== i);
      const wi = lstsq(Xi, yi);
      if (!wi) continue;
      const pred = dot(wi, X[i]);
      pcts2.push(Math.abs(pred - y[i]) / Math.max(1, y[i]));
    }
    mapeLoo = mean(pcts2);
    hit10Loo = pcts2.filter(p => p <= 0.10).length / pcts2.length;
    hit25Loo = pcts2.filter(p => p <= 0.25).length / pcts2.length;
  }

  console.log(
    `[train ${label}] n=${ds.length}  MAE=${mae.toFixed(2)}  MAPE=${(mape * 100).toFixed(1)}%  hit±10=${(hit10 * 100).toFixed(0)}%  hit±25=${(hit25 * 100).toFixed(0)}%` +
    (mapeLoo != null ? `  ║ LOO: MAPE=${(mapeLoo * 100).toFixed(1)}%  hit±10=${(hit10Loo * 100).toFixed(0)}%  hit±25=${(hit25Loo * 100).toFixed(0)}%` : "")
  );

  return { weights: w, n: ds.length, metrics: { mae, mape, hit10, hit25, mapeLoo, hit10Loo, hit25Loo } };
}

console.log("");
const E = trainOne(records, "factE", "E");
const C = trainOne(records, "factC", "C");
if (!E || !C) { console.error("[train v2] ✗ обучение не удалось"); process.exit(1); }

// ─── per-bucket bias (sanity check) ──────────────────────────────────────
function bucketBias(label, w) {
  const buckets = [["<1.5km", r => r.km < 1.5], ["1.5-3", r => r.km >= 1.5 && r.km < 3], ["3-7", r => r.km >= 3 && r.km < 7], ["7-15", r => r.km >= 7 && r.km < 15], ["15+", r => r.km >= 15]];
  const ds = filterOutliers(records, label === "E" ? "factE" : "factC");
  console.log(`\n[bucket ${label}]  bucket   n    medFact    medPred    bias%   MAPE%`);
  for (const [name, fn] of buckets) {
    const sub = ds.filter(fn);
    if (!sub.length) { console.log(`             ${name.padEnd(8)} 0`); continue; }
    const target = label === "E" ? "factE" : "factC";
    const fact = sub.map(r => r[target]);
    const pred = sub.map(r => Math.max(label === "E" ? 5 : 6, dot(w, featuresOf(r))));
    const bias = sub.reduce((s, _, i) => s + (pred[i] - fact[i]) / fact[i], 0) / sub.length * 100;
    const mp = sub.reduce((s, _, i) => s + Math.abs(pred[i] - fact[i]) / fact[i], 0) / sub.length * 100;
    console.log(`             ${name.padEnd(8)} ${String(sub.length).padStart(3)}  ${median(fact).toFixed(2).padStart(8)}  ${median(pred).toFixed(2).padStart(8)}  ${bias.toFixed(1).padStart(7)}  ${mp.toFixed(1).padStart(6)}`);
  }
}
bucketBias("E", E.weights);
bucketBias("C", C.weights);

// ─── save ────────────────────────────────────────────────────────────────
const out = {
  version: 2,
  trainedAt: new Date().toISOString(),
  trainedFrom: CALIB_DIR,
  nTotal: records.length,
  features: FEATURE_NAMES,
  floors: { E: 5.0, C: 6.0 },  // минималка Yandex
  weatherSource: WEATHER ? "open-meteo" : null,
  filterStats: stats,
  E: { weights: E.weights, n: E.n, metrics: E.metrics },
  C: { weights: C.weights, n: C.n, metrics: C.metrics },
};
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`\n[train v2] ✓ saved → ${OUT.replace(ROOT, ".")}`);

console.log("\n[train v2] коэффициенты:");
console.log(`  ${"feature".padEnd(18)}  ${"E".padStart(8)}  ${"C".padStart(8)}`);
for (let i = 0; i < FEATURE_NAMES.length; i++) {
  console.log(`  ${FEATURE_NAMES[i].padEnd(18)}  ${E.weights[i].toFixed(3).padStart(8)}  ${C.weights[i].toFixed(3).padStart(8)}`);
}
