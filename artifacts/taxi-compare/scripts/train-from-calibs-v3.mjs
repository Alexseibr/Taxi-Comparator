#!/usr/bin/env node
// v3: двухслойная формула «тариф × surge_mult» с использованием tripMin.
//
// Слой A — тариф (фиксированный для города/класса):
//   tariff_E(km, min) = base + per_km·km + per_min·min
//   tariff_C(km, min) = base + per_km·km + per_min·min
//
//   Обучается ОДИН РАЗ на «чистых» yellow-калибровках без anomaly с tripMin.
//   Там нет surge — это и есть базовый тариф Yandex (≈ 2.5 + 0.4·km + 0.7·min).
//
// Слой B — surge multiplier (зависит от условий):
//   surge_E(features) = w0 + w1·is_red + w2·is_yellow + w3·morn + w4·eve +
//                       w5·night + w6·is_weekend + w7·dow_sin + w8·dow_cos +
//                       w9·eta_excess + w10·is_short
//
//   target_mult = fact / max(floor, tariff_pred)
//   OLS на этом target — получаем мультипликатор от 0.8 до 2.0+
//
// Финал: predict = max(floor, tariff(km, min) · surge(features))
//
// Что отличается от v2:
//   • tripMin как главный сигнал (раньше use только etaMin → eta_excess)
//   • red/yellow — мультипликаторы, а не аддитивные слагаемые
//   • day_of_week (выходные ≠ будни) — новый сигнал
//   • двухслойная композиция → меньше переобучения
//
// Запуск:
//   node scripts/train-from-calibs-v3.mjs --calib-dir /tmp/calib-data/calib

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
const CALIB_DIR = argv("--calib-dir", "/tmp/calib-data/calib");
const OUT = join(ROOT, "src/data/pricing-model.json");
const SKIP_LOO = args.includes("--no-loo");
const VERBOSE = args.includes("--verbose");

mkdirSync(dirname(OUT), { recursive: true });

const FLOOR_E = 5.0, FLOOR_C = 6.0;

// ─── helpers ─────────────────────────────────────────────────────────────
function haversineKm(la1, lo1, la2, lo2) {
  const R = 6371, toRad = x => (x * Math.PI) / 180;
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

function dayOfWeek(dateStr) {
  // YYYY-MM-DD → 0=Sun, 1=Mon, ..., 6=Sat
  const d = new Date(dateStr + "T00:00:00Z");
  return d.getUTCDay();
}

// ─── load + sanity-filter calibs ─────────────────────────────────────────
const files = readdirSync(CALIB_DIR).filter(f => f.startsWith("calib-") && f.endsWith(".json"));
console.log(`[train v3] read ${files.length} calib-*.json from ${CALIB_DIR}`);

let stats = { totalRead: 0, noFact: 0, highAnom: 0, anyAnom: 0, badGeo: 0, badKm: 0, etaImpossible: 0, noTime: 0, kept: 0 };
const records = [];
for (const f of files) {
  let j;
  try { j = JSON.parse(readFileSync(join(CALIB_DIR, f), "utf8")); } catch { continue; }
  stats.totalRead++;
  if (typeof j.factE !== "number" || typeof j.factC !== "number") { stats.noFact++; continue; }
  // в v3 исключаем ВСЕ anomaly (не только high) — у нас 1349 чистых записей хватит
  if (j.anomaly && j.anomaly.suspicious === true) {
    stats.anyAnom++;
    if (j.anomaly.severity === "high") stats.highAnom++;
    continue;
  }
  const lat1 = +j.fromLat, lng1 = +j.fromLng, lat2 = +j.toLat, lng2 = +j.toLng;
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) { stats.badGeo++; continue; }
  const km = haversineKm(lat1, lng1, lat2, lng2);
  if (!Number.isFinite(km) || km < 0.3 || km > 60) { stats.badKm++; continue; }

  const tripMin = typeof j.tripMin === "number" && j.tripMin >= 1 && j.tripMin <= 240 ? j.tripMin : null;
  let etaMin = typeof j.etaMin === "number" && j.etaMin >= 1 && j.etaMin <= 240 ? j.etaMin : null;
  // sanity: > 60 км/ч в Минске нереально
  if (etaMin != null && (km / etaMin) * 60 > 60) { stats.etaImpossible++; etaMin = null; }
  // primary signal — tripMin, fallback — etaMin
  const minutes = tripMin ?? etaMin;
  if (minutes == null) { stats.noTime++; continue; }

  const idealMin = (km * 60) / 24;
  const etaExcess = Math.max(0, minutes / idealMin - 1);

  const h = ((j.hour ?? 0) % 24 + 24) % 24;
  const demand = (j.demand || j.demandColor || "").toLowerCase();
  const date = j.date || (j.receivedAt ? j.receivedAt.slice(0, 10) : "");
  const dow = date ? dayOfWeek(date) : 0;

  records.push({
    file: f,
    km, minutes, etaExcess,
    hour: h, dow, date,
    demand,
    isRed: demand === "red" ? 1 : 0,
    isYellow: demand === "yellow" ? 1 : 0,
    isShort: km < 1.5 ? 1 : 0,
    isMorn: h >= 7 && h <= 9 ? 1 : 0,
    isEve: h >= 15 && h <= 19 ? 1 : 0,
    isNight: (h >= 22 || h <= 5) ? 1 : 0,
    isWeekend: dow === 0 || dow === 6 ? 1 : 0,
    factE: j.factE, factC: j.factC,
  });
  stats.kept++;
}
console.log(`[train v3] фильтр:`, stats);
console.log(`[train v3] осталось ${records.length} записей`);
console.log(`[train v3]   demand: red=${records.filter(r => r.isRed).length}, yellow=${records.filter(r => r.isYellow).length}, green=${records.filter(r => !r.isRed && !r.isYellow).length}`);
console.log(`[train v3]   weekend=${records.filter(r => r.isWeekend).length}, weekday=${records.filter(r => !r.isWeekend).length}`);

// ─── СЛОЙ A: фит тарифа на чистых yellow без surge ───────────────────────
//   target = factE/factC, features = [1, km, minutes]
//   используем только yellow + дневные часы (10-14, 19-22) — там surge ≈ 1
function fitTariff(records, target, label) {
  // строгая фильтрация: yellow, дневные часы, без короткой поездки (там floor доминирует)
  const calm = records.filter(r =>
    r.isYellow &&
    !r.isMorn && !r.isEve && !r.isNight &&
    r.km >= 1.5 &&  // floor исключаем
    !r.isWeekend
  );
  console.log(`[tariff ${label}] обучаемся на ${calm.length} «спокойных» точках (yellow, weekday, day-hours, km≥1.5)`);
  if (calm.length < 50) {
    console.log(`[tariff ${label}] ⚠ мало точек — берём весь yellow с km≥1.5`);
    const all = records.filter(r => r.isYellow && r.km >= 1.5);
    return fitTariffOn(all, target);
  }
  return fitTariffOn(calm, target);
}
function fitTariffOn(rs, target) {
  const X = rs.map(r => [1, r.km, r.minutes]);
  const y = rs.map(r => r[target]);
  const w = lstsq(X, y);
  return w ? { base: w[0], per_km: w[1], per_min: w[2], n: rs.length } : null;
}

const tariffE = fitTariff(records, "factE", "E");
const tariffC = fitTariff(records, "factC", "C");
if (!tariffE || !tariffC) { console.error("[train v3] ✗ tariff не сошёлся"); process.exit(1); }
console.log(`\n[tariff E]  ${tariffE.base.toFixed(3)} + ${tariffE.per_km.toFixed(3)}·km + ${tariffE.per_min.toFixed(3)}·min  (floor ${FLOOR_E})  n=${tariffE.n}`);
console.log(`[tariff C]  ${tariffC.base.toFixed(3)} + ${tariffC.per_km.toFixed(3)}·km + ${tariffC.per_min.toFixed(3)}·min  (floor ${FLOOR_C})  n=${tariffC.n}`);

// ─── СЛОЙ B: surge multiplier ────────────────────────────────────────────
//   target_mult = fact / max(floor, tariff_pred)
//   фичи: [1, is_red, is_yellow, is_short, is_morn, is_eve, is_night,
//          is_weekend, dow_sin, dow_cos, eta_excess]
const SURGE_FEATURES = [
  "intercept", "is_red", "is_yellow", "is_short",
  "is_morn", "is_eve", "is_night", "is_weekend",
  "dow_sin", "dow_cos", "eta_excess",
];
function surgeFeaturesOf(r) {
  const dowAng = (2 * Math.PI * r.dow) / 7;
  return [
    1, r.isRed, r.isYellow, r.isShort,
    r.isMorn, r.isEve, r.isNight, r.isWeekend,
    Math.sin(dowAng), Math.cos(dowAng),
    r.etaExcess,
  ];
}

function tariffPred(t, r, floor) {
  return Math.max(floor, t.base + t.per_km * r.km + t.per_min * r.minutes);
}

function fitSurge(records, target, tariff, floor, label) {
  // считаем target_mult, отфильтровываем экстремумы (vision-ошибки которые прошли)
  const data = records.map(r => ({
    r,
    fact: r[target],
    tp: tariffPred(tariff, r, floor),
  })).map(d => ({ ...d, mult: d.fact / d.tp }));

  const before = data.length;
  const filtered = data.filter(d => d.mult >= 0.5 && d.mult <= 3.0);
  console.log(`[surge ${label}] target_mult diapason: убрано ${before - filtered.length}/${before} (mult ∉ [0.5, 3.0])`);

  const X = filtered.map(d => surgeFeaturesOf(d.r));
  const y = filtered.map(d => d.mult);
  const w = lstsq(X, y);
  if (!w) return null;

  // финальная оценка ошибки на тех же данных + LOO
  const errs = [], pcts = [];
  for (let i = 0; i < filtered.length; i++) {
    const d = filtered[i];
    const surgeMult = dot(w, X[i]);
    const pred = Math.max(floor, d.tp * surgeMult);
    errs.push(Math.abs(pred - d.fact));
    pcts.push(Math.abs(pred - d.fact) / d.fact);
  }
  const mae = mean(errs), mape = mean(pcts);
  const hit10 = pcts.filter(p => p <= 0.10).length / pcts.length;
  const hit25 = pcts.filter(p => p <= 0.25).length / pcts.length;

  let mapeLoo = null, hit10Loo = null, hit25Loo = null;
  if (!SKIP_LOO && filtered.length > 30) {
    const pcts2 = [];
    for (let i = 0; i < filtered.length; i++) {
      const Xi = X.filter((_, j) => j !== i);
      const yi = y.filter((_, j) => j !== i);
      const wi = lstsq(Xi, yi);
      if (!wi) continue;
      const surgeMult = dot(wi, X[i]);
      const pred = Math.max(floor, filtered[i].tp * surgeMult);
      pcts2.push(Math.abs(pred - filtered[i].fact) / filtered[i].fact);
    }
    mapeLoo = mean(pcts2);
    hit10Loo = pcts2.filter(p => p <= 0.10).length / pcts2.length;
    hit25Loo = pcts2.filter(p => p <= 0.25).length / pcts2.length;
  }

  console.log(
    `[surge ${label}] n=${filtered.length}  MAE=${mae.toFixed(2)}  MAPE=${(mape * 100).toFixed(1)}%  hit±10=${(hit10 * 100).toFixed(0)}%  hit±25=${(hit25 * 100).toFixed(0)}%` +
    (mapeLoo != null ? `  ║ LOO: MAPE=${(mapeLoo * 100).toFixed(1)}%  hit±10=${(hit10Loo * 100).toFixed(0)}%  hit±25=${(hit25Loo * 100).toFixed(0)}%` : "")
  );
  return { weights: w, n: filtered.length, metrics: { mae, mape, hit10, hit25, mapeLoo, hit10Loo, hit25Loo } };
}

console.log("");
const surgeE = fitSurge(records, "factE", tariffE, FLOOR_E, "E");
const surgeC = fitSurge(records, "factC", tariffC, FLOOR_C, "C");
if (!surgeE || !surgeC) { console.error("[train v3] ✗ surge не сошёлся"); process.exit(1); }

// ─── per-bucket bias ─────────────────────────────────────────────────────
function bucketBias(label, tariff, surge, floor) {
  const buckets = [["<1.5km", r => r.km < 1.5], ["1.5-3", r => r.km >= 1.5 && r.km < 3], ["3-7", r => r.km >= 3 && r.km < 7], ["7-15", r => r.km >= 7 && r.km < 15], ["15+", r => r.km >= 15]];
  const target = label === "E" ? "factE" : "factC";
  console.log(`\n[bucket ${label}]  bucket   n    medFact    medPred    bias%   MAPE%`);
  for (const [name, fn] of buckets) {
    const sub = records.filter(fn);
    if (!sub.length) { console.log(`             ${name.padEnd(8)} 0`); continue; }
    const fact = sub.map(r => r[target]);
    const pred = sub.map(r => Math.max(floor, tariffPred(tariff, r, floor) * dot(surge.weights, surgeFeaturesOf(r))));
    const bias = sub.reduce((s, _, i) => s + (pred[i] - fact[i]) / fact[i], 0) / sub.length * 100;
    const mp = sub.reduce((s, _, i) => s + Math.abs(pred[i] - fact[i]) / fact[i], 0) / sub.length * 100;
    console.log(`             ${name.padEnd(8)} ${String(sub.length).padStart(3)}  ${median(fact).toFixed(2).padStart(8)}  ${median(pred).toFixed(2).padStart(8)}  ${bias.toFixed(1).padStart(7)}  ${mp.toFixed(1).padStart(6)}`);
  }
}
bucketBias("E", tariffE, surgeE, FLOOR_E);
bucketBias("C", tariffC, surgeC, FLOOR_C);

// ─── per-demand metrics ──────────────────────────────────────────────────
function demandMetrics(label, tariff, surge, floor) {
  const target = label === "E" ? "factE" : "factC";
  console.log(`\n[demand ${label}]  demand    n    MAPE%   hit±10%   hit±25%`);
  for (const d of ["yellow", "red", "green"]) {
    const sub = records.filter(r => r.demand === d);
    if (!sub.length) continue;
    const pcts = sub.map(r => {
      const pred = Math.max(floor, tariffPred(tariff, r, floor) * dot(surge.weights, surgeFeaturesOf(r)));
      return Math.abs(pred - r[target]) / r[target];
    });
    const mp = mean(pcts);
    const h10 = pcts.filter(p => p <= 0.10).length / pcts.length;
    const h25 = pcts.filter(p => p <= 0.25).length / pcts.length;
    console.log(`              ${d.padEnd(8)} ${String(sub.length).padStart(4)}  ${(mp * 100).toFixed(1).padStart(5)}  ${(h10 * 100).toFixed(0).padStart(7)}  ${(h25 * 100).toFixed(0).padStart(7)}`);
  }
}
demandMetrics("E", tariffE, surgeE, FLOOR_E);
demandMetrics("C", tariffC, surgeC, FLOOR_C);

// ─── save ────────────────────────────────────────────────────────────────
const out = {
  version: 3,
  trainedAt: new Date().toISOString(),
  trainedFrom: CALIB_DIR,
  nTotal: records.length,
  surgeFeatures: SURGE_FEATURES,
  floors: { E: FLOOR_E, C: FLOOR_C },
  tariff: {
    E: { base: tariffE.base, per_km: tariffE.per_km, per_min: tariffE.per_min, n: tariffE.n },
    C: { base: tariffC.base, per_km: tariffC.per_km, per_min: tariffC.per_min, n: tariffC.n },
  },
  filterStats: stats,
  E: { surgeWeights: surgeE.weights, n: surgeE.n, metrics: surgeE.metrics },
  C: { surgeWeights: surgeC.weights, n: surgeC.n, metrics: surgeC.metrics },
};
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`\n[train v3] ✓ saved → ${OUT.replace(ROOT, ".")}`);

console.log("\n[train v3] surge weights:");
console.log(`  ${"feature".padEnd(15)}  ${"E".padStart(8)}  ${"C".padStart(8)}`);
for (let i = 0; i < SURGE_FEATURES.length; i++) {
  console.log(`  ${SURGE_FEATURES[i].padEnd(15)}  ${surgeE.weights[i].toFixed(3).padStart(8)}  ${surgeC.weights[i].toFixed(3).padStart(8)}`);
}
