#!/usr/bin/env node
// Сравнение качества surge-регрессии: v7 (TomTom ttMult) vs v8 (Google gMult).
// Не модифицирует learn.mjs — берёт готовый dataset.json (n=306) и обогащает
// его данными backfill (n=318 с Google typical traffic). На пересечении считает
// LOO MAE/MAPE/within±N% surge multiplier для двух наборов фич:
//   v7  = [1, km, freeMin, ttMult - 1]            ← TomTom (mean 1.06, range 1.00-1.50, корреляция с surge = 0.03)
//   v8a = [1, km, freeMin, gMult - 1]             ← Google (typical traffic by day/hour)
//   v8b = [1, km, googleFreeMin, gMult - 1]       ← Google (км и freeMin тоже Google)
//
// Peer filter тот же что в learn.mjs: same day + same slot, n_peers >= 4.
// Target: o.sC (surge Comfort), реальный мультипликатор Я.Такси.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const DS_PATH = "scripts/learned/dataset.json";
const BF_DIR = "scripts/orders";
const OUT = "scripts/learned/eval-v8.json";

// --- утилиты ---
const mean = a => a.reduce((s,x) => s+x, 0) / a.length;
const median = a => { const s=[...a].sort((x,y)=>x-y); return s.length%2 ? s[(s.length-1)/2] : (s[s.length/2-1]+s[s.length/2])/2; };

// Скопировано из learn.mjs (Gauss-Jordan OLS)
function lstsqN(X, y) {
  const n = X.length;
  if (!n) return null;
  const k = X[0].length;
  if (n < k) return null;
  const A = Array.from({length: k}, () => new Array(k+1).fill(0));
  for (let i = 0; i < n; i++) {
    const xi = X[i];
    for (let r = 0; r < k; r++) {
      A[r][k] += xi[r] * y[i];
      for (let c = 0; c < k; c++) A[r][c] += xi[r] * xi[c];
    }
  }
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col+1; r < k; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    }
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    if (piv !== col) [A[col], A[piv]] = [A[piv], A[col]];
    const inv = 1 / A[col][col];
    for (let c = col; c <= k; c++) A[col][c] *= inv;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (f === 0) continue;
      for (let c = col; c <= k; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map(row => row[k]);
}

// --- 1. Загрузить dataset (готовый v7) ---
const ds = JSON.parse(readFileSync(DS_PATH, "utf8")).orders;
console.log(`Dataset (v7): ${ds.length} точек`);

// --- 2. Загрузить весь backfill, построить map по id ---
const bfFiles = readdirSync(BF_DIR).filter(f => f.endsWith(".google-backfill.json"));
const bfMap = new Map();
for (const f of bfFiles) {
  const j = JSON.parse(readFileSync(join(BF_DIR, f), "utf8"));
  for (const r of (j.results || [])) {
    if (r.err || !r.googleTrafficMin) continue;
    bfMap.set(r.id, {
      googleKm: r.googleKm,
      googleFreeMin: r.googleFreeMin,
      googleTrafficMin: r.googleTrafficMin,
      gMult: r.gMult,
    });
  }
}
console.log(`Backfill (v8): ${bfMap.size} точек с Google typical traffic`);

// --- 3. Обогатить dataset Google полями ---
let enrichedCount = 0;
for (const o of ds) {
  const bf = bfMap.get(o.id);
  if (bf) {
    o.googleKm = bf.googleKm;
    o.googleFreeMin = bf.googleFreeMin;
    o.googleTrafficMin = bf.googleTrafficMin;
    o.gMult = bf.gMult;
    enrichedCount++;
  }
}
console.log(`Пересечение dataset ∩ backfill: ${enrichedCount}/${ds.length} (${(enrichedCount/ds.length*100).toFixed(0)}%)\n`);

// --- 4. Eligible для регрессии: есть sC, km, freeMin ---
const eligible = ds.filter(o =>
  o.sC != null && Number.isFinite(o.sC) &&
  o.km != null && o.km > 0 &&
  o.freeMin != null && o.freeMin > 0
);
const eligibleWithGoogle = eligible.filter(o => o.gMult != null);
console.log(`Точек для LOO: ${eligible.length} всего / ${eligibleWithGoogle.length} с Google`);

// --- 5. LOO регрессия ---
function loopLOO(label, points, featuresFn, sample = points) {
  // points = train pool, sample = что предсказываем (позволяет prediction только для подмножества)
  const errors = [];
  for (const t of sample) {
    const peers = points.filter(o => o.id !== t.id && o.day === t.day && o.slot === t.slot);
    if (peers.length < 4) continue;
    const X = peers.map(featuresFn);
    const y = peers.map(o => o.sC);
    const beta = lstsqN(X, y);
    if (!beta) continue;
    const xt = featuresFn(t);
    const pred = beta.reduce((s, b, i) => s + b * xt[i], 0);
    const err = pred - t.sC;
    const errPct = (Math.abs(err) / Math.max(0.05, t.sC)) * 100;
    errors.push({ id: t.id, sC: t.sC, pred: +pred.toFixed(3), err: +err.toFixed(3), errPct: +errPct.toFixed(1), km: t.km, hasGoogle: !!t.gMult });
  }
  return { label, errors };
}

function summarize({ label, errors }) {
  if (!errors.length) return { label, n: 0 };
  const errs = errors.map(e => Math.abs(e.err));
  const pcts = errors.map(e => e.errPct);
  const mae = mean(errs);
  const mape = mean(pcts);
  const w10 = pcts.filter(p => p <= 10).length;
  const w20 = pcts.filter(p => p <= 20).length;
  const w30 = pcts.filter(p => p <= 30).length;
  return {
    label,
    n: errors.length,
    mae_surge: +mae.toFixed(3),
    mape: +mape.toFixed(1),
    within10pct: w10,
    within20pct: w20,
    within30pct: w30,
    pct10: +(w10/errors.length*100).toFixed(1),
    pct20: +(w20/errors.length*100).toFixed(1),
    pct30: +(w30/errors.length*100).toFixed(1),
  };
}

// Фичи
const fV7  = o => [1, o.km, o.freeMin, (o.ttMult ?? 1) - 1];
const fV8a = o => [1, o.km, o.freeMin, (o.gMult ?? o.ttMult ?? 1) - 1];
const fV8b = o => [1, o.km, o.googleFreeMin ?? o.freeMin, (o.gMult ?? o.ttMult ?? 1) - 1];

// --- A. На ВСЁМ датасете (v7 берёт ttMult, v8 — gMult если есть, иначе ttMult) ---
console.log(`\n========== A. На всём eligible (n=${eligible.length}, peers all eligible) ==========`);
const Av7  = summarize(loopLOO("A.v7  TomTom (все точки)", eligible, fV7));
const Av8a = summarize(loopLOO("A.v8a Google gMult (все точки, fallback на TomTom)", eligible, fV8a));
const Av8b = summarize(loopLOO("A.v8b Google gMult+freeMin (все точки)", eligible, fV8b));
console.table([Av7, Av8a, Av8b]);

// --- B. Только на пересечении (sample = только точки с Google), peers — те же ---
console.log(`\n========== B. Только Google-subset (sample n=${eligibleWithGoogle.length}, peers — все eligible) ==========`);
const Bv7  = summarize(loopLOO("B.v7  TomTom (только with-google)", eligible, fV7,  eligibleWithGoogle));
const Bv8a = summarize(loopLOO("B.v8a Google gMult", eligible, fV8a, eligibleWithGoogle));
const Bv8b = summarize(loopLOO("B.v8b Google gMult+freeMin", eligible, fV8b, eligibleWithGoogle));
console.table([Bv7, Bv8a, Bv8b]);

// --- C. ЧИСТЫЙ Google-pool: и train, и test только с Google ---
console.log(`\n========== C. ЧИСТЫЙ Google (peers и target оба с Google, n=${eligibleWithGoogle.length}) ==========`);
const Cv7  = summarize(loopLOO("C.v7  TomTom-only (на google-subset)", eligibleWithGoogle, fV7));
const Cv8a = summarize(loopLOO("C.v8a Google gMult", eligibleWithGoogle, fV8a));
const Cv8b = summarize(loopLOO("C.v8b Google gMult+freeMin", eligibleWithGoogle, fV8b));
console.table([Cv7, Cv8a, Cv8b]);

// --- D. По km-бакетам (для C) ---
console.log(`\n========== D. По km-бакетам (на чистом Google-пуле, v7 vs v8a) ==========`);
const buckets = [
  { label: "<1 км",  test: o => o.km < 1 },
  { label: "1-2 км", test: o => o.km >= 1 && o.km < 2 },
  { label: "2-3 км", test: o => o.km >= 2 && o.km < 3 },
  { label: "3-5 км", test: o => o.km >= 3 && o.km < 5 },
  { label: "≥5 км",  test: o => o.km >= 5 },
];
const bucketRows = [];
for (const b of buckets) {
  const sub = eligibleWithGoogle.filter(b.test);
  if (sub.length < 4) { bucketRows.push({ bucket: b.label, n: sub.length, note: "недостаточно" }); continue; }
  const v7 = summarize(loopLOO("v7", eligibleWithGoogle, fV7, sub));
  const v8 = summarize(loopLOO("v8", eligibleWithGoogle, fV8a, sub));
  bucketRows.push({
    bucket: b.label, n: sub.length,
    v7_mae: v7.mae_surge, v7_mape: v7.mape, v7_pct20: v7.pct20,
    v8_mae: v8.mae_surge, v8_mape: v8.mape, v8_pct20: v8.pct20,
    Δmape_pp: v8.mape != null && v7.mape != null ? +(v8.mape - v7.mape).toFixed(1) : null,
  });
}
console.table(bucketRows);

// --- E. По слотам (для C) ---
console.log(`\n========== E. По слотам day-slot (v7 vs v8a) ==========`);
const slotRows = [];
const slots = [...new Set(eligibleWithGoogle.map(o => `${o.day}-${o.slot}`))].sort();
for (const sl of slots) {
  const [day, slot] = sl.split("-");
  const sub = eligibleWithGoogle.filter(o => o.day === day && o.slot === slot);
  if (sub.length < 4) continue;
  const v7 = summarize(loopLOO("v7", eligibleWithGoogle, fV7, sub));
  const v8 = summarize(loopLOO("v8", eligibleWithGoogle, fV8a, sub));
  slotRows.push({
    slot: sl, n: sub.length,
    v7_mape: v7.mape, v7_pct20: v7.pct20,
    v8_mape: v8.mape, v8_pct20: v8.pct20,
    Δmape_pp: v8.mape != null && v7.mape != null ? +(v8.mape - v7.mape).toFixed(1) : null,
  });
}
console.table(slotRows);

// --- F. Корреляция surge ↔ traffic для двух источников (на чистом Google subset) ---
console.log(`\n========== F. Корреляция surge ↔ traffic (на n=${enrichedCount} с Google) ==========`);
function corr(xs, ys) {
  const xm = mean(xs), ym = mean(ys);
  const num = xs.reduce((s, x, i) => s + (x - xm) * (ys[i] - ym), 0);
  const den = Math.sqrt(
    xs.reduce((s, x) => s + (x - xm) ** 2, 0) *
    ys.reduce((s, y) => s + (y - ym) ** 2, 0)
  );
  return den > 1e-9 ? num / den : 0;
}
const subset = eligible.filter(o => o.gMult != null && o.sC != null);
const ttArr = subset.map(o => o.ttMult ?? 1);
const gMArr = subset.map(o => o.gMult);
const sCArr = subset.map(o => o.sC);
console.log(`TomTom ttMult: mean=${mean(ttArr).toFixed(3)}, range [${Math.min(...ttArr).toFixed(2)}..${Math.max(...ttArr).toFixed(2)}], corr(ttMult, sC) = ${corr(ttArr, sCArr).toFixed(3)}`);
console.log(`Google gMult:  mean=${mean(gMArr).toFixed(3)}, range [${Math.min(...gMArr).toFixed(2)}..${Math.max(...gMArr).toFixed(2)}], corr(gMult,  sC) = ${corr(gMArr, sCArr).toFixed(3)}`);

// --- G. Сравнение freeMin: OSRM vs Google ---
console.log(`\n========== G. freeMin: OSRM vs Google (n=${enrichedCount}) ==========`);
const osrmF = subset.map(o => o.freeMin);
const ggF = subset.map(o => o.googleFreeMin);
const dF = subset.map(o => (o.googleFreeMin - o.freeMin) / o.freeMin * 100);
console.log(`OSRM   freeMin: mean=${mean(osrmF).toFixed(2)}, median=${median(osrmF).toFixed(2)}`);
console.log(`Google freeMin: mean=${mean(ggF).toFixed(2)}, median=${median(ggF).toFixed(2)}`);
console.log(`Δ freeMin (Google vs OSRM): mean=${mean(dF).toFixed(1)}%, median=${median([...dF].sort((a,b)=>a-b)).toFixed(1)}%`);

// --- Сохраняем отчёт ---
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  v7_baseline: { source: "TomTom ttMult", note: "ttMean=1.065, range=[1.00,1.50], corr(ttMult,sC)=0.03" },
  v8_source: { source: "Google Routes API typical traffic", n: enrichedCount, fixed_timezone: "Europe/Minsk UTC+3" },
  scenarioA_all: { v7: Av7, v8a: Av8a, v8b: Av8b },
  scenarioB_subset_predicted_with_full_peers: { v7: Bv7, v8a: Bv8a, v8b: Bv8b },
  scenarioC_pure_google: { v7: Cv7, v8a: Cv8a, v8b: Cv8b },
  buckets: bucketRows,
  slots: slotRows,
  correlation: {
    ttMult_sC: +corr(ttArr, sCArr).toFixed(3),
    gMult_sC: +corr(gMArr, sCArr).toFixed(3),
    n: subset.length,
  },
}, null, 2));
console.log(`\n✓ Отчёт: ${OUT}`);
