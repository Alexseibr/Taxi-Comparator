#!/usr/bin/env node
// Обучение data-driven модели цены Yandex по 234+ калибровкам со скринов.
// Простая линейная регрессия БЕЗ "слоёв" v3/v6/⚡-таблицы:
//
//   factE = wE · features
//   factC = wC · features
//
// Где features = [1, km, min, is_red, is_yellow, is_weekend, sin(2πh/24), cos(2πh/24), km²]
//
// На выходе — src/data/pricing-model.json с весами и метриками.
// Применяется фронтом через src/lib/pricing-model.ts (predictE/predictC).
//
// Запуск:  node scripts/train-from-calibs.mjs [--calib-dir /tmp/calib] [--no-loo]

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const argv = (k, def) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const CALIB_DIR = argv("--calib-dir", "/tmp/calib");
const OUT = join(ROOT, "src/data/pricing-model.json");
const SKIP_LOO = args.includes("--no-loo");

mkdirSync(dirname(OUT), { recursive: true });

// ─── helpers ──────────────────────────────────────────────────────────────
function haversineKm(la1, lo1, la2, lo2) {
  const R = 6371, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(la2 - la1), dLng = toRad(lo2 - lo1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

// Решает X·w = y методом нормальных уравнений (Gauss-Jordan).
function lstsq(X, y) {
  const n = X.length, k = X[0].length;
  if (n < k) return null;
  // A = X^T·X | X^T·y  (k × (k+1))
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < k; r++) {
      A[r][k] += X[i][r] * y[i];
      for (let c = 0; c < k; c++) A[r][c] += X[i][r] * X[i][c];
    }
  }
  // Gauss-Jordan
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++)
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
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
  return A.map((row) => row[k]);
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// ─── load calibs ──────────────────────────────────────────────────────────
const files = readdirSync(CALIB_DIR).filter((f) => f.startsWith("calib-") && f.endsWith(".json"));
console.log(`[train] read ${files.length} calib-*.json from ${CALIB_DIR}`);

const records = [];
for (const f of files) {
  let j;
  try { j = JSON.parse(readFileSync(join(CALIB_DIR, f), "utf8")); } catch { continue; }
  const lat1 = +j.fromLat, lng1 = +j.fromLng, lat2 = +j.toLat, lng2 = +j.toLng;
  if (!Number.isFinite(lat1) || !Number.isFinite(lat2)) continue;
  const km = haversineKm(lat1, lng1, lat2, lng2);
  if (!Number.isFinite(km) || km < 0.1 || km > 60) continue;
  const tripMin = typeof j.tripMin === "number" && j.tripMin >= 1 && j.tripMin <= 240 ? j.tripMin : null;
  // оценка времени из км если со скрина не пришло (24 км/ч в среднем по городу)
  const min = tripMin ?? Math.max(3, km * 60 / 24);
  // etaMin — прогноз времени поездки со скрина Yandex. Используем его как
  // основной сигнал «пробка/час пик» (он доступен в момент прогноза, в
  // отличие от tripMin, который известен только постфактум). Если etaMin
  // нет — fallback на tripMin (тоже минуты в пути), иначе 0.
  const etaSrc = typeof j.etaMin === "number" && j.etaMin >= 1 && j.etaMin <= 240
    ? j.etaMin
    : tripMin;
  const idealMin = (km * 60) / 24;
  const etaExcess = etaSrc != null && idealMin > 0
    ? Math.max(0, etaSrc / idealMin - 1)
    : 0;
  const t = new Date(j.receivedAt || Date.now());
  const hour = t.getUTCHours() + 3; // Минск UTC+3
  const h = ((hour % 24) + 24) % 24;
  const wd = (t.getUTCDay() + (hour >= 21 ? 1 : 0)) % 7; // 0=вс, 6=сб
  const isWeekend = wd === 0 || wd === 6 ? 1 : 0;
  const demand = (j.demand || j.demandColor || "").toLowerCase();
  const isRed = demand === "red" ? 1 : 0;
  const isYellow = demand === "yellow" ? 1 : 0;
  records.push({
    file: f,
    fromAddress: j.fromAddress || j.fromAddressGeo || "",
    toAddress: j.toAddress || j.toAddressGeo || "",
    km, min, tripMinSource: tripMin != null ? "screen" : "estimate",
    etaSrcSource: typeof j.etaMin === "number" ? "etaMin" : (tripMin != null ? "tripMin" : "none"),
    etaExcess,
    hour: h, isWeekend, isRed, isYellow,
    factE: typeof j.factE === "number" ? j.factE : null,
    factC: typeof j.factC === "number" ? j.factC : null,
    receivedAt: j.receivedAt,
  });
}
console.log(`[train] valid records: ${records.length}`);
console.log(`[train]   с tripMin: ${records.filter(r => r.tripMinSource === "screen").length}`);
console.log(`[train]   с factE:   ${records.filter(r => r.factE != null).length}`);
console.log(`[train]   с factC:   ${records.filter(r => r.factC != null).length}`);

// ─── outlier filter (factE > 60 BYN/км или < 0.5 BYN/км — явно ошибка Vision) ─
function filterOutliers(rs, target) {
  return rs.filter((r) => {
    const v = r[target];
    if (v == null || v < 1 || v > 200) return false;
    const perKm = v / r.km;
    if (perKm > 30 || perKm < 0.5) return false;
    return true;
  });
}

// ─── feature builder ──────────────────────────────────────────────────────
// `min` (tripMin) исключён, потому что у 88% записей он = km·60/24 (estimate),
// что делает `min` линейно зависимым от `km` (singular matrix). Когда tripMin
// будет приходить со скрина в 80%+ случаев — стоит добавить как отдельный
// предиктор. Сейчас же зависимость цены от времени в пути ловится через
// нелинейность km² (дальние = с пробками = дороже на BYN/км) и hour_sin/cos
// (в часы пик город медленнее → выше тариф).
const FEATURE_NAMES = [
  "intercept", "km", "km_sq", "is_red", "is_yellow",
  "hour_sin", "hour_cos", "eta_excess",
];
function featuresOf(r) {
  const angle = (2 * Math.PI * r.hour) / 24;
  return [
    1,
    r.km,
    r.km * r.km,
    r.isRed,
    r.isYellow,
    Math.sin(angle),
    Math.cos(angle),
    r.etaExcess,
  ];
}
// NB: is_weekend временно убран — все 234 текущих калибровки приходятся на
// будни (пн-ср), колонка получалась нулевой → singular. Когда соберём данные
// за сб/вс, добавим обратно.

// ─── train one tariff ─────────────────────────────────────────────────────
// Двухпроходная регрессия:
//   pass 1: фитим на всех точках (с грубым perKm-фильтром)
//   pass 2: считаем ratio = factual / predicted, выкидываем строки с
//           ratio ∉ [0.5, 2.0] (явные surge ×6 или OCR-баги типа 15км
//           за 10₽), переобучаем на чистом наборе.
// Это «робастная» регрессия в духе LMS — без неё 1-2 диких выбросов
// перетягивают веса и MAPE деградирует на 5-10 п.п.
function trainOne(records, target, label) {
  const ds0 = filterOutliers(records, target);
  const X0 = ds0.map(featuresOf);
  const y0 = ds0.map((r) => r[target]);
  const w0 = lstsq(X0, y0);
  if (!w0) {
    console.log(`[train ${label}] ⚠ singular matrix — abort`);
    return null;
  }
  // Pass 2: ratio-based outlier filter
  const RATIO_LO = 0.5, RATIO_HI = 2.0;
  const keep = [];
  let removed = 0;
  for (let i = 0; i < ds0.length; i++) {
    const pred = Math.max(0.5, dot(w0, X0[i]));
    const ratio = y0[i] / pred;
    if (ratio >= RATIO_LO && ratio <= RATIO_HI) keep.push(i);
    else removed++;
  }
  let ds, X, y, w;
  if (removed > 0 && keep.length >= FEATURE_NAMES.length + 5) {
    ds = keep.map((i) => ds0[i]);
    X = keep.map((i) => X0[i]);
    y = keep.map((i) => y0[i]);
    const w2 = lstsq(X, y);
    w = w2 ?? w0;
    console.log(
      `[train ${label}] pass-2: убрано ${removed} выбросов (ratio ∉ [${RATIO_LO}, ${RATIO_HI}]), переобучено на ${ds.length}`,
    );
  } else {
    ds = ds0;
    X = X0;
    y = y0;
    w = w0;
  }
  // in-sample metrics (на чистом наборе)
  const errs = [], pcts = [];
  for (let i = 0; i < ds.length; i++) {
    const pred = dot(w, X[i]);
    const err = pred - y[i];
    errs.push(Math.abs(err));
    pcts.push(Math.abs(err) / Math.max(1, y[i]));
  }
  const mae = mean(errs), mape = mean(pcts);
  const hit10 = pcts.filter((p) => p <= 0.10).length / pcts.length;
  const hit25 = pcts.filter((p) => p <= 0.25).length / pcts.length;

  // out-of-sample — leave-one-out (≈секунды для 234 точек)
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
    hit10Loo = pcts2.filter((p) => p <= 0.10).length / pcts2.length;
    hit25Loo = pcts2.filter((p) => p <= 0.25).length / pcts2.length;
  }

  console.log(
    `[train ${label}] n=${ds.length}  MAE=${mae.toFixed(2)}  MAPE=${(mape * 100).toFixed(1)}%  ` +
    `hit±10=${(hit10 * 100).toFixed(0)}%  hit±25=${(hit25 * 100).toFixed(0)}%` +
    (mapeLoo != null
      ? `  ║ LOO: MAPE=${(mapeLoo * 100).toFixed(1)}%  hit±10=${(hit10Loo * 100).toFixed(0)}%  hit±25=${(hit25Loo * 100).toFixed(0)}%`
      : ""),
  );

  return {
    weights: w,
    n: ds.length,
    metrics: {
      mae,
      mape,
      hit10,
      hit25,
      mapeLoo,
      hit10Loo,
      hit25Loo,
    },
  };
}

console.log("");
const E = trainOne(records, "factE", "E");
const C = trainOne(records, "factC", "C");

if (!E || !C) {
  console.error("[train] ✗ обучение не удалось");
  process.exit(1);
}

// ─── save ─────────────────────────────────────────────────────────────────
const out = {
  version: 1,
  trainedAt: new Date().toISOString(),
  trainedFrom: CALIB_DIR,
  nTotal: records.length,
  nWithTripMin: records.filter((r) => r.tripMinSource === "screen").length,
  features: FEATURE_NAMES,
  E: { weights: E.weights, n: E.n, metrics: E.metrics },
  C: { weights: C.weights, n: C.n, metrics: C.metrics },
};
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`\n[train] ✓ saved → ${OUT.replace(ROOT, ".")}`);

// ─── pretty-print weights ─────────────────────────────────────────────────
console.log("\n[train] коэффициенты:");
console.log(`  ${"feature".padEnd(12)}  ${"E".padStart(8)}  ${"C".padStart(8)}`);
for (let i = 0; i < FEATURE_NAMES.length; i++) {
  console.log(
    `  ${FEATURE_NAMES[i].padEnd(12)}  ${E.weights[i].toFixed(3).padStart(8)}  ${C.weights[i].toFixed(3).padStart(8)}`,
  );
}
console.log("\n  пример: E ≈ a + b·km + c·min + ... (intercept, km, min ...)");
