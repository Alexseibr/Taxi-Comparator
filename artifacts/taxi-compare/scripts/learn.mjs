#!/usr/bin/env node
// Обучающая система v3: анализирует ВСЕ накопленные результаты `pnpm calib`
// и автоматически выводит методологию из 4 слоёв.
//
// Использование:  pnpm learn
//
// Что делает:
//   1. Собирает все scripts/orders/*.results.json в единый dataset.
//   2. L1 SANITY (v3) — регрессия baza_Y = pickup + perKm·km + perMin·min.
//      Проверяет, что pickup/perKm/perMin сходятся к НУЛЮ — т.е.
//      Yandex baza плоская (minimum × surge), как заложено в v3.
//   3. L1 SURGE MODEL (v3) — регрессия yaSurgeC = a + b·km + c·min внутри
//      каждого (day×slot) + per-slot mean/std. Это и есть ⚡N(km, min, slot).
//   4. L2 TIME-SLOT SURGE — группирует sC и yaSurgeC по (day × slot).
//   5. L3 HIDDEN BOOST — mean(sE/sC) по слотам.
//   6. L4 TRAFFIC ADJUST — корреляция (sC, ttMult).
//
// Output → scripts/learned/:
//   - sanity-tariff.json      (проверка v3: pickup/perKm/perMin ≈ 0)
//   - surge-model.json        (⚡N(km, min, slot) — главная модель v3)
//   - surge-map.json          (sC по day × slot × cell)
//   - hidden-boost.json       (boost по day × slot)
//   - traffic-effect.json     (корреляция surge vs trafic)
//   - dataset.json            (единая база всех заказов)
//   - metrics.json            (MAE/MAPE текущей модели)
//   - changelog.md            (история обучения, append-only)

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  attachFeatures,
  loadWeather,
  loadHolidays,
  fitFactors,
  FROM_ZONE_LABEL,
} from "./factors.mjs";
import { tagFromH3Cell } from "./zoneTags.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ORDERS_DIR = join(ROOT, "scripts/orders");
const LEARNED_DIR = join(ROOT, "scripts/learned");
mkdirSync(LEARNED_DIR, { recursive: true });

// --- Текущий тариф (для diff после обучения) ----------------------------
// Восстановленный минимум Cmf по 73 замерам с открытым ⚡ Я. Используется
// и в predicted_C = ⚡N × CMF_MINIMUM_BR, и во фронтовом BASE_TARIFF.
// При смене ОБЯЗАТЕЛЬНО синхронизировать с src/lib/zones.ts.
const CMF_MINIMUM_BR = 9.86;
const CURRENT_TARIFF = {
  econom:  { pickup: 0, perKm: 0, perMin: 0, minimum: 9.39 },
  comfort: { pickup: 0, perKm: 0, perMin: 0, minimum: CMF_MINIMUM_BR },
};

// --- Слоты времени ------------------------------------------------------
// Гранулярность: 1 час. Раньше было 4 жирных слота (night/morning/midday/...),
// которые сглаживали утренний пик и обед в один midday — поэтому пиковая
// зависимость от часа терялась внутри слота. Сейчас slot = "h{hour}".
// Frontend zones.ts продолжает использовать свои 5 широких слотов для UI
// (heatmap не нужно показывать 24 кнопки). Эти два пространства живут
// независимо: learn/calib работают по часу, фронт-карта — по своим слотам.
const SLOT_HOURS = 1;
const TIME_SLOTS = (() => {
  const a = [];
  for (let h = 0; h < 24; h += SLOT_HOURS) {
    a.push({ id: `h${h}`, startHour: h, endHour: Math.min(h + SLOT_HOURS - 1, 23) });
  }
  return a;
})();
const hourToSlot = (h) => `h${Math.floor(h / SLOT_HOURS) * SLOT_HOURS}`;

// Скользящее окно соседних часов для LOO/регрессии в разреженных слотах.
// Внутри одного часа редко бывает 3+ точек (60 замеров / 24×3 = ~1 на ячейку),
// поэтому при поиске peers расширяем выборку на ±WINDOW часов того же дня.
// Это аналог 5-часового окна вокруг таргета — заметно гладче бывшего жёсткого
// 4-часового слота, плюс честно ловит utрений пик / обеденный спад.
const SLOT_PEER_WINDOW_HOURS = 2;
function neighborPeers(target, source, windowHours = SLOT_PEER_WINDOW_HOURS) {
  const h0 = (target.hour ?? 12) - windowHours;
  const h1 = (target.hour ?? 12) + windowHours;
  return source.filter(o =>
    o.id !== target.id
    && o.day === target.day
    && typeof o.hour === "number"
    && o.hour >= h0
    && o.hour <= h1
  );
}
const dateToDay = (date) => {
  const d = new Date(date).getDay(); // 0=sun, 6=sat
  if (d === 0) return "sunday";
  if (d === 6) return "saturday";
  return "weekday";
};

// --- Math ---------------------------------------------------------------
const mean = (a) => a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0;
const median = (a) => { if (!a.length) return 0; const s=[...a].sort((x,y)=>x-y); const m=s.length>>1; return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };
const std = (a, m=mean(a)) => a.length>1 ? Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1)) : 0;

// --- Solve linear system 3x3 for [pickup, perKm, perMin] -----------------
// X = [[1,km,min], ...], y = baza  →  β = (X^T X)^-1 X^T y
function lstsq3(X, y) {
  const n = X.length;
  if (n < 3) return null;
  // Build XTX (3x3) and XTy (3x1)
  const XTX = [[0,0,0],[0,0,0],[0,0,0]];
  const XTy = [0,0,0];
  for (let i = 0; i < n; i++) {
    const xi = X[i];
    for (let r = 0; r < 3; r++) {
      XTy[r] += xi[r] * y[i];
      for (let c = 0; c < 3; c++) XTX[r][c] += xi[r] * xi[c];
    }
  }
  // Solve 3x3 by Cramer's rule
  const det = (m) =>
    m[0][0]*(m[1][1]*m[2][2] - m[1][2]*m[2][1])
  - m[0][1]*(m[1][0]*m[2][2] - m[1][2]*m[2][0])
  + m[0][2]*(m[1][0]*m[2][1] - m[1][1]*m[2][0]);
  const D = det(XTX);
  if (Math.abs(D) < 1e-9) return null;
  const col = (m, c, v) => m.map((row, i) => row.map((x, j) => j===c ? v[i] : x));
  return [
    det(col(XTX, 0, XTy)) / D,
    det(col(XTX, 1, XTy)) / D,
    det(col(XTX, 2, XTy)) / D,
  ];
}

// --- Generic least-squares for arbitrary N features ----------------------
// X — n×k матрица, y — длина n. Возвращает β длины k (или null если вырожденная).
// --- Расстояние pickup от центра Минска (Площадь Победы) ---------------
// Используется как фича в surge-регрессии v5: для центральных pickup'ов
// фича ≈ 0 → bCent·centDist обнуляется → не overshoot'им surge для коротких
// центральных маршрутов (Янки Купалы, Гвардейская и т.п. с ⚡<1.0).
const MINSK_CENTER_LAT = 53.9006, MINSK_CENTER_LNG = 27.5660;
function centDist(lat, lng) {
  if (lat == null || lng == null) return 0;
  const x = (lng - MINSK_CENTER_LNG) * Math.cos((lat + MINSK_CENTER_LAT) / 2 * Math.PI/180);
  const y = lat - MINSK_CENTER_LAT;
  return 6371 * Math.PI/180 * Math.sqrt(x*x + y*y);
}

// Решает (X^T X) β = X^T y через Gauss-Jordan elimination на augmented матрице.
// Используем для surge LOO с фичами [1, km, min, isOutbound, isFar] (k=5).
function lstsqN(X, y) {
  const n = X.length;
  if (!n) return null;
  const k = X[0].length;
  if (n < k) return null;
  // XTX (k×k), XTy (k)
  const A = Array.from({length: k}, () => new Array(k+1).fill(0));
  for (let i = 0; i < n; i++) {
    const xi = X[i];
    for (let r = 0; r < k; r++) {
      A[r][k] += xi[r] * y[i];
      for (let c = 0; c < k; c++) A[r][c] += xi[r] * xi[c];
    }
  }
  // Gauss-Jordan с partial pivoting
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

// --- 1. Сбор dataset из всех .results.json -------------------------------
// Файлы вида *-B.results.json — калибровка от другого аккаунта Yandex,
// исключаем из обучения, чтобы кросс-аккаунтная персонализация
// (свой surge у каждого клиента) не загрязняла модель.
const resultFiles = readdirSync(ORDERS_DIR).filter(f => f.endsWith(".results.json") && !f.endsWith("-B.results.json"));
console.log(`Найдено результатов калибровки: ${resultFiles.length} (файлы *-B.results.json исключены — другие аккаунты)`);

const dataset = []; // {id, ts, date, day, hour, slot, fromAddr, fromLat, fromLng, toAddr, km, min, ttMult, factC, factE, sC, sE, hb, yaSurgeC, bazaYC, yaMin, spdYa, spdTT}
for (const f of resultFiles) {
  const path = join(ORDERS_DIR, f);
  let j;
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`⚠ Пропущен повреждённый файл ${f}: ${e.message}`);
    continue;
  }
  const date = j.date;
  const orders = j.orders || j.results || j;
  for (const r of (Array.isArray(orders) ? orders : [])) {
    if (!r.fromPt) continue; // skip if calibrate didn't enrich
    const hour = r.hour ?? 12;
    dataset.push({
      id: r.id,
      sourceFile: f,
      date,
      day: dateToDay(date),
      hour,
      slot: hourToSlot(hour),
      fromAddr: r.from,
      fromLat: r.fromPt[0], fromLng: r.fromPt[1],
      toAddr: r.to,
      toLat: r.toPt?.[0] ?? null, toLng: r.toPt?.[1] ?? null,
      km: r.km, min: r.min, freeMin: r.freeMin,
      ttMult: r.ttMult ?? 1.0,
      factC: r.factC, factE: r.factE,
      sC: r.sC, sE: r.sE, hb: r.hb,
      yaSurgeC: r.yaSurgeC ?? null,
      bazaYC: r.bazaYC ?? null,
      yaMin: r.yaMin ?? null,
      spdYa: r.spdYa ?? null,
      spdTT: r.spdTT ?? null,
      notes: r.notes,
    });
  }
}
console.log(`Собрано заказов в dataset: ${dataset.length}`);
writeFileSync(join(LEARNED_DIR, "dataset.json"), JSON.stringify({ generatedAt: new Date().toISOString(), count: dataset.length, orders: dataset }, null, 2));

// --- 2. L1 SANITY (v3): pickup/perKm/perMin должны сходиться к нулю -----
// В v3 предполагаем, что Yandex baza плоская: baza == minimum × surge,
// т.е. baza_Y / surge — константа. Регрессия baza_Y = pickup + perKm·km + perMin·min
// должна дать pickup ≈ minimum, perKm ≈ 0, perMin ≈ 0.
const withSurge = dataset.filter(o => o.yaSurgeC && o.bazaYC && o.km != null && o.min != null);
console.log(`\n[L1 SANITY v3] Заказов с открытым yaSurgeC: ${withSurge.length}`);

const sanityReport = {
  generatedAt: new Date().toISOString(),
  basedOn: withSurge.length,
  hypothesis: "v3: baza_Y = const (= minimum_C). Регрессия perKm/perMin должна сходиться к 0.",
  current: CURRENT_TARIFF,
  evidence: {},
  verdict: null,
  warnings: [],
};

if (withSurge.length >= 3) {
  const bazas = withSurge.map(o => o.bazaYC);
  const meanBaza = mean(bazas);
  const stdBaza = std(bazas);
  sanityReport.evidence.bazaStats = {
    n: withSurge.length, mean: +meanBaza.toFixed(2), median: +median(bazas).toFixed(2),
    std: +stdBaza.toFixed(2), min: +Math.min(...bazas).toFixed(2), max: +Math.max(...bazas).toFixed(2),
  };

  // Регрессия запускается ВСЕГДА (не пропускаем из-за маленького std) —
  // именно так мы проверяем, что perKm/perMin ≈ 0.
  const X = withSurge.map(o => [1, o.km, o.min]);
  const y = withSurge.map(o => o.bazaYC);
  const beta = lstsq3(X, y);
  if (beta) {
    const [pickup, perKm, perMin] = beta;
    const preds = X.map(xi => beta[0] + beta[1]*xi[1] + beta[2]*xi[2]);
    const resids = y.map((yi, i) => yi - preds[i]);
    const mae = mean(resids.map(Math.abs));
    const rmse = Math.sqrt(mean(resids.map(r=>r*r)));
    sanityReport.evidence.regression = {
      pickup: +pickup.toFixed(3), perKm: +perKm.toFixed(4), perMin: +perMin.toFixed(4),
      mae: +mae.toFixed(3), rmse: +rmse.toFixed(3),
    };
    // Толерантности: perKm < 0.05 br/km, perMin < 0.05 br/min — фактически шум.
    const perKmOk  = Math.abs(perKm)  < 0.05;
    const perMinOk = Math.abs(perMin) < 0.05;
    sanityReport.verdict = (perKmOk && perMinOk)
      ? `✅ v3 подтверждена: |perKm|=${Math.abs(perKm).toFixed(4)} < 0.05, |perMin|=${Math.abs(perMin).toFixed(4)} < 0.05. Baza Yandex плоская.`
      : `❌ v3 ОПРОВЕРГНУТА: perKm=${perKm.toFixed(3)}, perMin=${perMin.toFixed(3)} — есть значимая зависимость от км/мин. Возможно, тариф снова не плоский.`;
    if (!perKmOk || !perMinOk) {
      sanityReport.warnings.push("Гипотеза v3 (плоская baza) не подтверждается — нужно пересмотреть BASE_TARIFF.");
    }
  } else {
    sanityReport.warnings.push("Регрессия не сошлась (collinearity). Нужно больше разнообразных по км/мин маршрутов.");
  }
} else {
  sanityReport.warnings.push(`Недостаточно данных: только ${withSurge.length} заказов с yaSurgeC. Нужно ≥ 3.`);
}
writeFileSync(join(LEARNED_DIR, "sanity-tariff.json"), JSON.stringify(sanityReport, null, 2));
if (sanityReport.verdict) console.log(`  ${sanityReport.verdict}`);

// --- 2b. L1 SURGE MODEL (v3): ⚡N(km, min, slot) -----------------------
// Главная модель v3 — учим, как открытый сёрдж зависит от маршрута и слота.
// Внутри каждого (day×slot) с n≥3 фитим yaSurgeC = a + b·km + c·min.
// Если n<3 — только агрегаты (mean/median/std).
const surgeModel = {
  generatedAt: new Date().toISOString(),
  basedOn: withSurge.length,
  bySlot: {}, // key = `${day}-${slot}` → { n, mean, median, std, regression?, samples }
  warnings: [],
};
const slotGroups = {};
for (const o of withSurge) {
  const key = `${o.day}-${o.slot}`;
  (slotGroups[key] ??= []).push(o);
}
console.log(`\n[L1 SURGE MODEL v3] ⚡N(km, min, slot) по слотам:`);
for (const [key, arr] of Object.entries(slotGroups)) {
  const surges = arr.map(o => o.yaSurgeC);
  const m = mean(surges), s = std(surges), md = median(surges);
  const slotInfo = {
    n: arr.length,
    mean: +m.toFixed(3), median: +md.toFixed(3), std: +s.toFixed(3),
    min: +Math.min(...surges).toFixed(2), max: +Math.max(...surges).toFixed(2),
    samples: arr.map(o => ({
      id: o.id, addr: o.fromAddr, hour: o.hour,
      km: +o.km.toFixed(2), min: +o.min.toFixed(2),
      yaSurgeC: o.yaSurgeC, ttMult: o.ttMult,
    })),
  };
  // Cascading fallback: v5 (n>=6) → v4 (n>=4) → v3 (n>=3) → только агрегаты.
  // На каждом уровне если матрица вырождена (lstsq* вернул null), пробуем
  // следующий уровень — это критично, иначе слот может остаться вообще
  // без регрессии (sunday-morning регрессировал в null до этого фикса).
  let regBuilt = false;
  // v7: 7 фич — нелинейная фича outboundOnly = max(0, destD − pickupD). Это
  // расстояние "выезда из центра" (только positive part). Линейные `centD`+`destD`
  // (попытка v6) не работают из-за коллинеарности — `delta = destD - pickupD` это
  // linear combination существующих фич, регрессия даёт идентичную модель.
  // `max(0, ...)` нелинейно — реально новая информация:
  //   • центр→окраина (i16, b01, 9866): outboundOnly большой → коэф должен ↓ surge
  //   • окраина→центр: outboundOnly = 0 → не влияет
  //   • внутри зоны: outboundOnly ≈ 0 → не влияет
  if (arr.length >= 8 && arr.every(o => o.toLat != null && o.toLng != null)) {
    const X = arr.map(o => {
      const cd = centDist(o.fromLat, o.fromLng);
      const dcd = centDist(o.toLat, o.toLng);
      return [
        1, o.km, o.freeMin ?? (o.min/(o.ttMult||1)),
        (o.ttMult ?? 1) - 1, cd, o.km * cd, Math.max(0, dcd - cd),
      ];
    });
    const beta = lstsqN(X, surges);
    if (beta && beta.length === 7) {
      const [a, bKm, bFreeMin, bTt, bCent, bKmCent, bOutbound] = beta;
      const preds = X.map(xi => a + bKm*xi[1] + bFreeMin*xi[2] + bTt*xi[3] + bCent*xi[4] + bKmCent*xi[5] + bOutbound*xi[6]);
      const resids = surges.map((yi, i) => yi - preds[i]);
      const ttArr = arr.map(o => o.ttMult ?? 1).filter(Number.isFinite);
      const ttMean = ttArr.length ? +(ttArr.reduce((s,v)=>s+v,0)/ttArr.length).toFixed(3) : 1.0;
      slotInfo.regression = {
        version: 7,
        intercept: +a.toFixed(3), bKm: +bKm.toFixed(4), bFreeMin: +bFreeMin.toFixed(4),
        bTt: +bTt.toFixed(4), bCent: +bCent.toFixed(4), bKmCent: +bKmCent.toFixed(5), bOutbound: +bOutbound.toFixed(4),
        slotTtMean: ttMean,
        mae: +mean(resids.map(Math.abs)).toFixed(3),
        rmse: +Math.sqrt(mean(resids.map(r=>r*r))).toFixed(3),
        formula: `⚡N ≈ ${a.toFixed(2)} + ${bKm.toFixed(3)}·km + ${bFreeMin.toFixed(3)}·freeMin + ${bTt.toFixed(3)}·(ttMult-1) + ${bCent.toFixed(3)}·centDist + ${bKmCent.toFixed(4)}·km·centDist + ${bOutbound.toFixed(3)}·max(0, destCentDist−pickupCentDist)`,
      };
      regBuilt = true;
    }
  }
  if (!regBuilt && arr.length >= 6) {
    // v5: 6 фич — centDist + km*centDist (interaction term).
    const X = arr.map(o => {
      const cd = centDist(o.fromLat, o.fromLng);
      return [
        1, o.km, o.freeMin ?? (o.min/(o.ttMult||1)),
        (o.ttMult ?? 1) - 1, cd, o.km * cd,
      ];
    });
    const beta = lstsqN(X, surges);
    if (beta && beta.length === 6) {
      const [a, bKm, bFreeMin, bTt, bCent, bKmCent] = beta;
      const preds = X.map(xi => a + bKm*xi[1] + bFreeMin*xi[2] + bTt*xi[3] + bCent*xi[4] + bKmCent*xi[5]);
      const resids = surges.map((yi, i) => yi - preds[i]);
      const ttArr = arr.map(o => o.ttMult ?? 1).filter(Number.isFinite);
      const ttMean = ttArr.length ? +(ttArr.reduce((s,v)=>s+v,0)/ttArr.length).toFixed(3) : 1.0;
      slotInfo.regression = {
        version: 5,
        intercept: +a.toFixed(3), bKm: +bKm.toFixed(4), bFreeMin: +bFreeMin.toFixed(4),
        bTt: +bTt.toFixed(4), bCent: +bCent.toFixed(4), bKmCent: +bKmCent.toFixed(5),
        slotTtMean: ttMean,
        mae: +mean(resids.map(Math.abs)).toFixed(3),
        rmse: +Math.sqrt(mean(resids.map(r=>r*r))).toFixed(3),
        formula: `⚡N ≈ ${a.toFixed(2)} + ${bKm.toFixed(3)}·km + ${bFreeMin.toFixed(3)}·freeMin + ${bTt.toFixed(3)}·(ttMult-1) + ${bCent.toFixed(3)}·centDist + ${bKmCent.toFixed(4)}·km·centDist`,
      };
      regBuilt = true;
    }
  }
  if (!regBuilt && arr.length >= 4) {
    // v4: 4 фичи (km, freeMin, ttMult-1).
    const X = arr.map(o => [1, o.km, o.freeMin ?? (o.min/(o.ttMult||1)), (o.ttMult ?? 1) - 1]);
    const beta = lstsqN(X, surges);
    if (beta && beta.length === 4) {
      const [a, bKm, bFreeMin, bTt] = beta;
      const preds = X.map(xi => a + bKm*xi[1] + bFreeMin*xi[2] + bTt*xi[3]);
      const resids = surges.map((yi, i) => yi - preds[i]);
      const ttArr = arr.map(o => o.ttMult ?? 1).filter(Number.isFinite);
      const ttMean = ttArr.length ? +(ttArr.reduce((s,v)=>s+v,0)/ttArr.length).toFixed(3) : 1.0;
      slotInfo.regression = {
        version: 4,
        intercept: +a.toFixed(3), bKm: +bKm.toFixed(4), bFreeMin: +bFreeMin.toFixed(4), bTt: +bTt.toFixed(4),
        slotTtMean: ttMean,
        mae: +mean(resids.map(Math.abs)).toFixed(3),
        rmse: +Math.sqrt(mean(resids.map(r=>r*r))).toFixed(3),
        formula: `⚡N ≈ ${a.toFixed(2)} + ${bKm.toFixed(3)}·km + ${bFreeMin.toFixed(3)}·freeMin + ${bTt.toFixed(3)}·(ttMult-1)`,
      };
      regBuilt = true;
    }
  }
  if (!regBuilt && arr.length >= 3) {
    // v3: 2-фичная регрессия (km, min) — самый простой baseline.
    const X = arr.map(o => [1, o.km, o.min]);
    const beta = lstsq3(X, surges);
    if (beta) {
      const [a, bKm, bMin] = beta;
      const preds = X.map(xi => a + bKm*xi[1] + bMin*xi[2]);
      const resids = surges.map((yi, i) => yi - preds[i]);
      slotInfo.regression = {
        version: 3,
        intercept: +a.toFixed(3), bKm: +bKm.toFixed(4), bMin: +bMin.toFixed(4),
        mae: +mean(resids.map(Math.abs)).toFixed(3),
        rmse: +Math.sqrt(mean(resids.map(r=>r*r))).toFixed(3),
        formula: `⚡N ≈ ${a.toFixed(2)} + ${bKm.toFixed(3)}·km + ${bMin.toFixed(3)}·min`,
      };
      regBuilt = true;
    }
  }
  if (!regBuilt) {
    surgeModel.warnings.push(`${key}: n=${arr.length}, регрессия не построена (вырожденная матрица или n<3) — только агрегаты.`);
  }
  surgeModel.bySlot[key] = slotInfo;
  const reg = slotInfo.regression
    ? ` | ${slotInfo.regression.formula} (MAE=${slotInfo.regression.mae})`
    : "";
  console.log(`  ${key}: n=${slotInfo.n} mean=${slotInfo.mean} std=${slotInfo.std}${reg}`);
}
writeFileSync(join(LEARNED_DIR, "surge-model.json"), JSON.stringify(surgeModel, null, 2));

// --- 3. L2 TIME-SLOT SURGE MAP -----------------------------------------
// ВНИМАНИЕ: sC и yaSurgeC — это РАЗНЫЕ величины:
//   - sC       = factC / наша_rawC  (интерпретация Yandex-цены через НАШ тариф)
//   - yaSurgeC = открытый ⚡N со скрина = factC / Yandex_baza (истина)
// Их нельзя смешивать. Делаем ДВА слоя:
//   3a) ourSurge (sC) — для нашего heatmap-а
//   3b) yaOpenSurge (yaSurgeC) — для эталона / валидации
const slotMap = {};        // sC по нашей модели — для heatmap
const slotMapOpen = {};    // открытый ⚡N — эталон Yandex (для валидации)
for (const o of dataset) {
  if (o.sC) {
    slotMap[o.day] ??= {};
    slotMap[o.day][o.slot] ??= { surges: [], cells: [] };
    slotMap[o.day][o.slot].surges.push(o.sC);
    slotMap[o.day][o.slot].cells.push({
      id: o.id, lat: o.fromLat, lng: o.fromLng, surge: o.sC,
      addr: o.fromAddr, hour: o.hour, ttMult: o.ttMult,
    });
  }
  if (o.yaSurgeC != null) {
    slotMapOpen[o.day] ??= {};
    slotMapOpen[o.day][o.slot] ??= { surges: [], cells: [] };
    slotMapOpen[o.day][o.slot].surges.push(o.yaSurgeC);
    slotMapOpen[o.day][o.slot].cells.push({
      id: o.id, lat: o.fromLat, lng: o.fromLng, openSurge: o.yaSurgeC, ourSurge: o.sC,
      addr: o.fromAddr, hour: o.hour,
    });
  }
}
const aggSlot = (map) => {
  const out = {};
  for (const [day, slots] of Object.entries(map)) {
    out[day] = {};
    for (const [slot, data] of Object.entries(slots)) {
      out[day][slot] = {
        n: data.surges.length,
        mean: +mean(data.surges).toFixed(3),
        std: +std(data.surges).toFixed(3),
        median: +median(data.surges).toFixed(3),
        cells: data.cells,
      };
    }
  }
  return out;
};
const surgeReport = {
  generatedAt: new Date().toISOString(),
  ourModel: aggSlot(slotMap),       // sC по нашему тарифу — для heatmap
  yandexOpen: aggSlot(slotMapOpen), // открытый ⚡N — эталон
};
console.log(`\n[L2 TIME-SLOT SURGE — наша модель (sC)]`);
for (const [day, slots] of Object.entries(surgeReport.ourModel)) {
  for (const [slot, info] of Object.entries(slots)) {
    console.log(`  ${day}-${slot}: n=${info.n} mean=${info.mean} std=${info.std}`);
  }
}
console.log(`\n[L2 TIME-SLOT SURGE — открытый ⚡N со скрина]`);
for (const [day, slots] of Object.entries(surgeReport.yandexOpen)) {
  for (const [slot, info] of Object.entries(slots)) {
    console.log(`  ${day}-${slot}: n=${info.n} mean=${info.mean} std=${info.std}`);
  }
}
writeFileSync(join(LEARNED_DIR, "surge-map.json"), JSON.stringify(surgeReport, null, 2));

// --- 4. L3 HIDDEN ECONOM-BOOST -----------------------------------------
const hbReport = { generatedAt: new Date().toISOString(), bySlot: {}, overall: null };
const allHb = dataset.filter(o => o.hb).map(o => o.hb);
if (allHb.length) {
  hbReport.overall = { n: allHb.length, mean: +mean(allHb).toFixed(3), median: +median(allHb).toFixed(3), std: +std(allHb).toFixed(3) };
}
for (const o of dataset) {
  if (!o.hb) continue;
  const key = `${o.day}-${o.slot}`;
  hbReport.bySlot[key] ??= [];
  hbReport.bySlot[key].push(o.hb);
}
const hbAgg = {};
console.log(`\n[L3 HIDDEN ЭКОНОМ-BOOST]`);
console.log(`  Всего: n=${allHb.length} mean=×${mean(allHb).toFixed(3)} (Эконом дешевле Cmf на ${((1-mean(allHb))*100).toFixed(1)}%)`);
for (const [key, arr] of Object.entries(hbReport.bySlot)) {
  hbAgg[key] = { n: arr.length, mean: +mean(arr).toFixed(3), std: +std(arr).toFixed(3) };
  console.log(`  ${key}: n=${arr.length} mean=×${mean(arr).toFixed(3)} std=${std(arr).toFixed(3)}`);
}
hbReport.bySlot = hbAgg;
writeFileSync(join(LEARNED_DIR, "hidden-boost.json"), JSON.stringify(hbReport, null, 2));

// --- 5. L4 TRAFFIC ADJUST ----------------------------------------------
const trafficData = dataset.filter(o => o.ttMult && o.sC).map(o => ({ tt: o.ttMult, sC: o.sC }));
const trafficReport = { generatedAt: new Date().toISOString(), n: trafficData.length };
if (trafficData.length >= 5) {
  const ttArr = trafficData.map(d => d.tt);
  const scArr = trafficData.map(d => d.sC);
  trafficReport.ttMean = +mean(ttArr).toFixed(3);
  trafficReport.ttRange = [+Math.min(...ttArr).toFixed(2), +Math.max(...ttArr).toFixed(2)];
  // Pearson correlation
  const ttM = mean(ttArr), scM = mean(scArr);
  const num = trafficData.reduce((s,d) => s + (d.tt-ttM)*(d.sC-scM), 0);
  const den = Math.sqrt(
    trafficData.reduce((s,d) => s + (d.tt-ttM)**2, 0) *
    trafficData.reduce((s,d) => s + (d.sC-scM)**2, 0)
  );
  trafficReport.correlation = den > 1e-9 ? +(num/den).toFixed(3) : 0;
  trafficReport.note = trafficReport.ttMean < 1.05
    ? "Пробок почти нет (ttMean ≈ 1.0). Корреляция surge↔traffic не значима. Нужны замеры в час пик."
    : `ttMean=${trafficReport.ttMean.toFixed(2)}, корреляция surge↔traffic = ${trafficReport.correlation}.`;
}
writeFileSync(join(LEARNED_DIR, "traffic-effect.json"), JSON.stringify(trafficReport, null, 2));

// --- 5b. LEAVE-ONE-OUT валидация surge-model ---------------------------
// Для каждой точки с yaSurgeC: обучаем L1-регрессию (a + b·km + c·min) внутри её
// (day×slot) на ВСЕХ остальных точках, предсказываем сёрдж, считаем factC и ошибку.
// Это честная метрика — модель никогда не «видела» точку, которую предсказывает.
//
// 11-й прогон: после анализа топ-промахов 10-го прогона ввели route category.
// Промахи систематически делились на 2 группы:
//   • переоценки центр→спальник (Жилуновича, Уручье) — модель путала их с
//     более «горячими» направлениями того же слота.
//   • недооценки Минск→пригород (Гатово, Сутоки) — peers с другими
//     характеристиками тянули прогноз вниз.
// Поэтому до сегментации по дальности фильтруем peers по типу маршрута:
// intra | outbound | far. Для outbound/far ⚡ существенно выше при той же км.

// Только однозначно за-городные топонимы. Слабые keywords ("Тимирязева",
// "Луговая", "Жуковка") убраны — они есть и в Минске и давали ложные
// срабатывания. Дальние >50 км ловятся отдельно по km, без названий.
const OUTBOUND_KEYWORDS = [
  "Гатово", "Сутоки", "Морочь", "Колодищи", "Боровляны", "Логойск",
  "Заславль", "Дзержинск", "Фаниполь", "Раков", "Семков", "Атолино",
  "Скирмантово", "Хатежино", "Аэропорт", "Вилейка", "агрогородок",
  "деревня", "Радашковичи", "Ждановичи", "Ратомка",
  "Острошицкий", "Юзуфово", "Прилуки", "Валерьяново",
];

function routeCategory(o) {
  const km = o.km || 0;
  if (km > 50) return "far";
  const addr = (o.toAddr || "").toLowerCase();
  const hasOutboundWord = OUTBOUND_KEYWORDS.some(k => addr.includes(k.toLowerCase()));
  if (hasOutboundWord) return km > 30 ? "far" : "outbound";
  if (km > 30) return "far";
  // Магистральная скорость без явного outbound-слова — пограничный случай:
  // длинная городская поездка по проспекту тоже бывает быстрой, поэтому
  // только при очень высокой скорости.
  if ((o.spdYa || 0) > 65 && km > 12) return "outbound";
  return "intra";
}

// === REASON BUILDER (объясняет конкретную причину расхождения) ============
// Используется как для baseline LOO, так и для финального прогноза после
// factor adjustments. Возвращает 1-3 предложения: основной вердикт +
// конкретные причины (короткий/длинный/аэропорт/персональный дисконт/...).
function buildLooReason(it, ctx = {}) {
  const {
    routeCategory: cat = "intra",
    ttMult = 1.0,
    spdYa = null,
    spdTT = null,
    factorNote = null,     // строка "зона, час пик" — общий список активных факторов модели
    factorShiftBr = 0,     // сколько br факторы добавили/убрали к baseline (по этой точке)
    baselineC = null,      // прогноз Cmf ДО факторов (для diff)
  } = ctx;

  const km = +it.km;
  const min = +it.min;
  const fact = +it.factC;
  const ya = +it.yaSurgeC;
  const pred = +it.predictedSurge;
  const predC = +it.predictedC;
  const absPct = +it.absPct;
  const errPct = +it.errPct;
  const verdict = it.verdict;

  // Признак аэропортовой поездки (распознаём по адресам)
  const addr = `${it.from || ""} ${it.to || ""}`.toLowerCase();
  const isAirport = /аэропорт|airport|msq|национальн.*аэроп/i.test(addr);

  // Подбираем ПРИЧИНЫ расхождения (массив коротких фраз)
  const causes = [];

  if (verdict === "overshoot") {
    // Я. упёрся в свой минимум, наша линейная цена выше
    if (fact <= 9.5 && km < 4) {
      causes.push(`у Я. сработал минимум (~9 br) на короткой поездке ${km.toFixed(1)} км`);
    }
    // Персональный/реферальный дисконт Я.
    if (ya < 0.95) {
      causes.push(`Я. дал персональный дисконт ⚡${ya.toFixed(2)} (реферал/промокод/низкий локальный спрос)`);
    }
    // Пробок не было — Я. честно дал низкий surge
    if (ttMult < 1.05 && ya < 1.5) {
      causes.push("пробок не было — Я. не повышал ⚡N, наш прогноз по слотовому среднему чуть выше");
    }
    // Очень большая переоценка при наличии active factors → подозрение на over-fit
    if (absPct > 25 && factorNote && Math.abs(factorShiftBr) >= 0.3) {
      causes.push(`фактор «${factorNote}» сместил прогноз слишком сильно (${factorShiftBr >= 0 ? "+" : ""}${factorShiftBr.toFixed(2)} br) — мало данных в этой комбинации`);
    }
  } else if (verdict === "undershoot") {
    // Длинный outbound/far — Я. накручивает long-distance markup
    if (cat === "far") {
      causes.push(`дальний маршрут ${km.toFixed(0)} км: Я. наценивает long-distance, наша линейная сетка дешевле`);
    } else if (cat === "outbound") {
      causes.push(`за МКАД: пригородные направления у Я. с надбавкой, у нас этого мультипликатора нет`);
    } else if (km > 20) {
      causes.push(`длинный городской ${km.toFixed(0)} км — Я. часто включает доплату за дистанцию`);
    }
    // Зональный пик
    if (ya >= 3.0) {
      causes.push(`зональный пик ⚡${ya.toFixed(1)} в этой точке — модели не хватает соседних замеров с таким же высоким сёрджем`);
    } else if (ya >= 2.0 && pred < ya - 0.4) {
      causes.push(`Я. поднял ⚡${ya.toFixed(2)}, наш слотовый прогноз ⚡${pred.toFixed(2)} — спрос локально вырос быстрее среднего по слоту`);
    }
    // Трафик
    if (ttMult > 1.1) {
      causes.push(`трафик ×${ttMult.toFixed(2)}: время в пути растёт, Я. на это реагирует`);
    }
    // Я. сильно дольше TomTom — буферизация подачи
    if (spdYa && spdTT && spdYa < spdTT * 0.75) {
      causes.push("Я. показывает время сильно дольше TomTom — буфер на подачу/ожидание");
    }
    // Аэропорт
    if (isAirport) {
      causes.push("аэропортовая поездка — Я. использует отдельный аэропортовый коэффициент");
    }
  }

  // FALLBACK: если ни одна специфичная эвристика не сработала, но промах
  // большой (>30%), всё равно даём пользователю понятное объяснение —
  // сглаживание слотовой регрессией.
  if (causes.length === 0 && absPct >= 30) {
    if (verdict === "overshoot") {
      causes.push(
        `слотовая регрессия дала ⚡${pred.toFixed(2)}, что выше фактического ⚡${ya.toFixed(2)} на ${(pred - ya).toFixed(2)}. Скорее всего, точка попала в локальный провал спроса внутри слота — соседние замеры в эту дату/час имели более высокий ⚡N, и линейная модель сгладила прогноз вверх. Нужно больше точек именно в этой зоне+часе`
      );
    } else {
      causes.push(
        `слотовая регрессия дала ⚡${pred.toFixed(2)}, что ниже фактического ⚡${ya.toFixed(2)} на ${(ya - pred).toFixed(2)}. Скорее всего, точка попала в локальный всплеск спроса — соседние замеры в эту дату/час имели более низкий ⚡N, и модель не успела «увидеть» этот пик. Нужно больше точек именно в этой зоне+часе`
      );
    }
  }

  // Доп. инфо про активные факторы (даже для good — полезно понимать как считался прогноз)
  let factorPart = "";
  if (factorNote && Math.abs(factorShiftBr) >= 0.05 && baselineC !== null) {
    const sign = factorShiftBr >= 0 ? "+" : "";
    factorPart = ` Активные факторы Я. (${factorNote}) сместили прогноз с ${baselineC.toFixed(2)} br на ${predC.toFixed(2)} br (Δ ${sign}${factorShiftBr.toFixed(2)} br).`;
  } else if (factorNote && baselineC !== null) {
    factorPart = ` Глобально активные факторы Я. (${factorNote}) для этой точки не сработали (множитель ×1.00).`;
  }

  // Собираем итог
  if (verdict === "good") {
    return `Прогноз ${predC.toFixed(2)} br против факта ${fact} br — попали в ±10% (Δ ${errPct >= 0 ? "+" : ""}${errPct.toFixed(1)}%).${factorPart}`;
  }
  const head = verdict === "overshoot"
    ? `Переоценка на +${absPct.toFixed(1)}%: модель дала ⚡${pred.toFixed(2)}, факт ⚡${ya.toFixed(2)}.`
    : `Недооценка на ${absPct.toFixed(1)}%: модель дала ⚡${pred.toFixed(2)}, факт ⚡${ya.toFixed(2)}.`;
  const why = causes.length
    ? ` Почему не сошлось: ${causes.join("; ")}.`
    : ` Локальное отклонение спроса от слотового среднего без явной системной причины.`;
  return head + why + factorPart;
}

const looItems = [];
for (const target of withSurge) {
  const key = `${target.day}-${target.slot}`;
  // Peers — точки того же дня в часовом окне ±SLOT_PEER_WINDOW_HOURS вокруг
  // таргета. При SLOT_HOURS=1 точечная группа `slotGroups[key]` почти всегда
  // < 3 точек, поэтому регрессия не строится. Окно даёт достаточно соседей
  // для v3..v7 и правильно отражает «соседство по времени», а не жёсткое
  // 4-часовое разбиение, в котором 9-й час utрa и 14-й обед оказывались
  // внутри одного «midday».
  const allPeers = neighborPeers(target, withSurge);

  // 10-й прогон (MAPE 28%, ±10%: 25/60) остаётся базовым алгоритмом.
  // 11-й прогон попробовал две стратификации по route category — обе дали
  // ХУЖЕ из-за дефицита данных (60 точек × 4 слота × 3 категории слишком
  // разреженно). Категория сохраняется только как МЕТАДАННЫЕ для UI —
  // чтобы видеть, в каком сегменте промахи, и целенаправленно набирать.
  const cat = routeCategory(target);
  const isLong = target.km > 30;
  const peers = isLong
    ? allPeers.filter(o => o.km > 20)
    : allPeers.filter(o => o.km <= 30);

  let predSurge = null, regOK = false, fallback = null;

  // Cascading LOO regression: v5 (n>=6, +centDist+km*centDist) → v4 (n>=4, +ttMult+freeMin)
  // → v3 (n>=3, km+min). Та же логика что в slot regression выше — иначе baseline
  // MAPE не отражает реальный продакшен-предиктор и улучшения slot-модели «невидимы».
  const targetCent = centDist(target.fromLat, target.fromLng);
  const targetTt = target.ttMult ?? 1;
  const targetFreeMin = target.freeMin ?? (target.min / targetTt);

  const targetDestCent = centDist(target.toLat, target.toLng);
  const targetOutbound = Math.max(0, targetDestCent - targetCent);

  // v7 LOO: 7 фич, последняя — нелинейная max(0, destD − pickupD) ("outbound only").
  if (peers.length >= 8 && target.toLat != null && target.toLng != null && peers.every(o => o.toLat != null && o.toLng != null)) {
    const X = peers.map(o => {
      const cd = centDist(o.fromLat, o.fromLng);
      const dcd = centDist(o.toLat, o.toLng);
      return [
        1, o.km, o.freeMin ?? (o.min/(o.ttMult||1)),
        (o.ttMult ?? 1) - 1, cd, o.km * cd, Math.max(0, dcd - cd),
      ];
    });
    const beta = lstsqN(X, peers.map(o => o.yaSurgeC));
    if (beta && beta.length === 7) {
      predSurge = beta[0] + beta[1]*target.km + beta[2]*targetFreeMin
                + beta[3]*(targetTt - 1) + beta[4]*targetCent + beta[5]*(target.km * targetCent)
                + beta[6]*targetOutbound;
      regOK = true;
      fallback = isLong ? "long-distance-regression-v7" : "regression-v7";
    }
  }
  if (!regOK && peers.length >= 6) {
    const X = peers.map(o => {
      const cd = centDist(o.fromLat, o.fromLng);
      return [
        1, o.km, o.freeMin ?? (o.min/(o.ttMult||1)),
        (o.ttMult ?? 1) - 1, cd, o.km * cd,
      ];
    });
    const beta = lstsqN(X, peers.map(o => o.yaSurgeC));
    if (beta && beta.length === 6) {
      predSurge = beta[0] + beta[1]*target.km + beta[2]*targetFreeMin
                + beta[3]*(targetTt - 1) + beta[4]*targetCent + beta[5]*(target.km * targetCent);
      regOK = true;
      fallback = isLong ? "long-distance-regression-v5" : "regression-v5";
    }
  }
  if (!regOK && peers.length >= 4) {
    const X = peers.map(o => [1, o.km, o.freeMin ?? (o.min/(o.ttMult||1)), (o.ttMult ?? 1) - 1]);
    const beta = lstsqN(X, peers.map(o => o.yaSurgeC));
    if (beta && beta.length === 4) {
      predSurge = beta[0] + beta[1]*target.km + beta[2]*targetFreeMin + beta[3]*(targetTt - 1);
      regOK = true;
      fallback = isLong ? "long-distance-regression-v4" : "regression-v4";
    }
  }
  if (!regOK && peers.length >= 3) {
    const X = peers.map(o => [1, o.km, o.min]);
    const beta = lstsq3(X, peers.map(o => o.yaSurgeC));
    if (beta) {
      predSurge = beta[0] + beta[1] * target.km + beta[2] * target.min;
      regOK = true;
      fallback = isLong ? "long-distance-regression-v3" : "regression-v3";
    }
  }
  if (!regOK && peers.length) {
    predSurge = mean(peers.map(o => o.yaSurgeC));
    fallback = isLong ? "mean-by-long-segment" : "mean-by-short-segment";
  }
  if (predSurge == null && allPeers.length) {
    predSurge = mean(allPeers.map(o => o.yaSurgeC));
    fallback = "mean-by-slot";
  }
  if (predSurge == null) continue;

  if (isLong) {
    predSurge = Math.max(0.5, Math.min(35.0, predSurge));
  } else {
    predSurge = Math.max(0.5, Math.min(6.0, predSurge));
  }

  const predC = predSurge * CMF_MINIMUM_BR; // восстановленный minimum Я.
  const err = predC - target.factC;
  const errPct = (err / target.factC) * 100;
  const absPct = Math.abs(errPct);

  const verdict = absPct < 10 ? "good" : (errPct > 0 ? "overshoot" : "undershoot");

  const looItem = {
    id: target.id,
    date: target.date,
    slot: key,
    routeCategory: cat, // intra | outbound | far — для анализа дефицита данных
    from: target.fromAddr,
    to: target.toAddr,
    km: +target.km.toFixed(2),
    min: +target.min.toFixed(1),
    ttMult: +target.ttMult.toFixed(2),
    factC: target.factC,
    factE: target.factE,
    yaSurgeC: target.yaSurgeC,
    predictedSurge: +predSurge.toFixed(3),
    predictedC: +predC.toFixed(2),
    err: +err.toFixed(2),
    errPct: +errPct.toFixed(1),
    absPct: +absPct.toFixed(1),
    verdict,
    fallback,
    reason: "", // заполняется ниже общим хелпером (без factorPart на этом этапе)
  };
  looItem.reason = buildLooReason(looItem, {
    routeCategory: cat,
    ttMult: target.ttMult,
    spdYa: target.spdYa,
    spdTT: target.spdTT,
    factorNote: null, // factor adjustments ещё не применены
    factorShiftBr: 0,
    baselineC: null,
  });
  looItems.push(looItem);
}

// === FACTOR FITTING (Yandex-style multipliers поверх baseline LOO) =========
// Подмешиваем weather/peak/fromZone/holiday к каждому looItem и подбираем
// мультипликаторы greedy grid-search'ем. Активируем только если MAPE
// улучшился хотя бы на 0.2 п.п.
const _weather = loadWeather();
const _holidays = loadHolidays();
const _enriched = attachFeatures(dataset, { weather: _weather, holidays: _holidays });
const _featById = Object.fromEntries(_enriched.map(o => [o.id, {
  fromZone:    o.fromZone,
  h3Cell:      o.h3Cell,
  hour:        o.hour,
  isPeak:      o.isPeak,
  isHoliday:   o.isHoliday,
  holidayName: o.holidayName,
  weather:     o.weather,
}]));
for (const it of looItems) {
  const f = _featById[it.id] || {};
  it.fromZone    = f.fromZone    || "unknown";
  it.h3Cell      = f.h3Cell      || null;
  it.hour        = (typeof f.hour === "number") ? f.hour : null;
  it.isPeak      = !!f.isPeak;
  it.isHoliday   = !!f.isHoliday;
  it.holidayName = f.holidayName || null;
  it.weather     = f.weather     || null;
}
// === INTRA-ONLY FILTER (внутри МКАД) ====================================
// Пользовательский фокус: основные метрики и подбор факторов считаются
// только по intra-Минск. Outbound/far остаются в loo.json для справки в UI,
// но их предсказания НЕ влияют на factor fitting и не попадают в overall MAPE.
const intraItems = looItems.filter(i => (i.routeCategory || "intra") === "intra");
const excludedItems = looItems.filter(i => (i.routeCategory || "intra") !== "intra");
const _fit = fitFactors(intraItems);
// Применяем подобранные множители: обновляем predictedSurge / predictedC /
// err / errPct / absPct / verdict + reason. Сохраняем baseline для diff.
// Clamp финального surge на [0.3, 10] — защита от непредвиденных комбинаций
// факторов (множители подобраны на ограниченных данных).
const _activeFactors = _fit.factors.filter(f => f.active);
const _factorNote = _activeFactors.length
  ? _activeFactors.map(f => {
      const meta = { weather: "погода", peak: "час пик", fromZone: "зона", hour: "час суток", holiday: "праздник" };
      return meta[f.mode] || f.mode;
    }).join(", ")
  : null;
for (let i = 0; i < intraItems.length; i++) {
  const it = intraItems[i];
  let newSurge = _fit.finalPredSurges[i];
  // Soft clamp: [0.1, 30] — защита от экстремальных будущих комбинаций
  // (например, погода+праздник+час пик одновременно). Дальние маршруты
  // спокойно остаются с ⚡ до 30 (Y. иногда даёт ⚡20+ для outbound 100+ км).
  if (newSurge < 0.1) newSurge = 0.1;
  if (newSurge > 30)  newSurge = 30;
  it.baselineSurge  = it.predictedSurge;
  it.baselineC      = it.predictedC;
  it.baselineReason = it.reason;
  it.predictedSurge = +newSurge.toFixed(3);
  it.predictedC     = +(newSurge * CMF_MINIMUM_BR).toFixed(2);
  it.err            = +(it.predictedC - it.factC).toFixed(2);
  it.errPct         = +((it.predictedC - it.factC) / it.factC * 100).toFixed(1);
  it.absPct         = +Math.abs(it.errPct).toFixed(1);
  it.verdict = it.absPct < 10 ? "good" : (it.errPct >= 0 ? "overshoot" : "undershoot");
  // Пересчитываем reason под новый прогноз (избегаем рассогласования с verdict).
  // factorPart добавляется хелпером ТОЛЬКО если факторы реально сместили прогноз
  // для этой точки (Δ ≥ 0.05 br). Иначе reason врёт «сместили на +0.00» — а
  // на деле для конкретной точки множитель оказался ×1.00 (например
  // fromZone=residential при активном center×0.85). Проверка per-item.
  const factorShiftBr = +(it.predictedC - it.baselineC).toFixed(2);
  // Поднимаем оригинальные характеристики поездки, которых нет в looItem,
  // но которые нужны хелперу (spdYa/spdTT/ttMult пишутся в looItem только
  // частично — ttMult есть, спид нет). Берём из исходного dataset по id.
  const _src = dataset.find(o => o.id === it.id);
  it.reason = buildLooReason(it, {
    routeCategory: it.routeCategory || "intra",
    ttMult: it.ttMult,
    spdYa: _src?.spdYa ?? null,
    spdTT: _src?.spdTT ?? null,
    factorNote: _factorNote,
    factorShiftBr,
    baselineC: it.baselineC,
  });
}
// Обогащаем H3-ячейки семантическим ярлыком (район Минска + тип:
// bar/sleeping/industrial/...). Tag не влияет на математику — это для
// читаемости вывода и UI (driver heatmap, dashboard).
function enrichCellsWithTags(cells) {
  if (!cells) return cells;
  const out = {};
  for (const [cellId, info] of Object.entries(cells)) {
    out[cellId] = { ...info, tag: tagFromH3Cell(cellId) };
  }
  return out;
}

const factorAdjustments = _fit.factors.map(f => ({
  mode: f.mode,
  active: f.active,
  coefs: f.coefs,
  ...(f.cells   ? { cells:  enrichCellsWithTags(f.cells) }  : {}),
  ...(f.hours   ? { hours:  f.hours }  : {}),
  ...(f.scheme  ? { scheme: f.scheme } : {}),
  reason: f.reason,
  observed: f.observed,
  mapeBefore: f.mapeBefore !== null ? +f.mapeBefore.toFixed(2) : null,
  mapeAfter:  f.mapeAfter  !== null ? +f.mapeAfter.toFixed(2)  : null,
  improvedPp: f.mapeBefore !== null && f.mapeAfter !== null
    ? +(f.mapeBefore - f.mapeAfter).toFixed(2) : null,
}));
console.log(`\n[FACTORS] Yandex-style мультипликаторы:`);
for (const f of factorAdjustments) {
  const tag = f.active ? "✓ АКТИВЕН" : "○ ожидает данных";
  console.log(`  [${f.mode.padEnd(8)}] ${tag}  Δ=${f.improvedPp ?? "?"}pp  — ${f.reason}`);
}

// === CATEGORY MULTIPLIER (outbound / far) ================================
// Outbound и far маршруты (за МКАД, дальние) системно недооцениваются
// слотовой регрессией, потому что Я. наценивает long-distance markup, а
// наша модель такого не учитывает. Подбираем медианный мультипликатор
// factC/predictedC по каждой категории. Активируем, если |mult-1| > 0.15
// и улучшает MAPE этой категории на ≥ 3 п.п.
function fitCategoryMultiplier(items, label) {
  if (items.length < 4) {
    return {
      label, active: false, mult: 1.0, n: items.length,
      mapeBefore: items.length ? +mean(items.map(i => i.absPct)).toFixed(1) : null,
      mapeAfter: null, improvedPp: null,
      reason: `Мало данных (n=${items.length}, нужно ≥4)`,
    };
  }
  const ratios = items
    .map(it => it.factC / it.predictedC)
    .filter(r => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b);
  if (!ratios.length) {
    return { label, active: false, mult: 1.0, n: items.length, reason: "Нет валидных ratio" };
  }
  // Медиана устойчивее к outliers (один выброс не утащит multiplier)
  const median = ratios[Math.floor(ratios.length / 2)];
  const mult = Math.max(0.5, Math.min(8.0, median));
  const mapeBefore = mean(items.map(it => Math.abs(it.predictedC - it.factC) / it.factC * 100));
  const mapeAfter  = mean(items.map(it => Math.abs(it.predictedC * mult - it.factC) / it.factC * 100));
  const improvedPp = mapeBefore - mapeAfter;
  const active = Math.abs(mult - 1.0) > 0.15 && improvedPp > 3.0;
  return {
    label,
    active,
    mult: +mult.toFixed(2),
    n: items.length,
    mapeBefore: +mapeBefore.toFixed(1),
    mapeAfter:  +mapeAfter.toFixed(1),
    improvedPp: +improvedPp.toFixed(1),
    reason: active
      ? `${label}-multiplier ×${mult.toFixed(2)} (медиана factC/predictedC по ${items.length} замерам). Улучшил MAPE этой категории с ${mapeBefore.toFixed(1)}% до ${mapeAfter.toFixed(1)}% (Δ −${improvedPp.toFixed(1)} п.п.).`
      : `mult ×${mult.toFixed(2)} получен, но улучшение MAPE всего ${improvedPp.toFixed(1)} п.п. (порог 3 п.п.) — пока не активируем, нужно больше замеров.`,
  };
}
const _outboundFit = fitCategoryMultiplier(excludedItems.filter(i => i.routeCategory === "outbound"), "outbound");
const _farFit      = fitCategoryMultiplier(excludedItems.filter(i => i.routeCategory === "far"),      "far");
const categoryMultipliers = { outbound: _outboundFit, far: _farFit };

// Применяем активные multipliers к excludedItems (пересчитываем
// predictedSurge/predictedC/err/errPct/absPct/verdict/reason).
for (const it of excludedItems) {
  const fit = it.routeCategory === "outbound" ? _outboundFit
            : it.routeCategory === "far"      ? _farFit
            : null;
  if (!fit || !fit.active) continue;
  it.baselineSurge = it.predictedSurge;
  it.baselineC     = it.predictedC;
  it.baselineReason = it.reason;
  it.predictedSurge = +(it.predictedSurge * fit.mult).toFixed(3);
  it.predictedC     = +(it.predictedSurge * CMF_MINIMUM_BR).toFixed(2);
  it.err            = +(it.predictedC - it.factC).toFixed(2);
  it.errPct         = +((it.predictedC - it.factC) / it.factC * 100).toFixed(1);
  it.absPct         = +Math.abs(it.errPct).toFixed(1);
  it.verdict = it.absPct < 10 ? "good" : (it.errPct >= 0 ? "overshoot" : "undershoot");
  const _src = dataset.find(o => o.id === it.id);
  // factorNote отдельно — outbound/far multiplier поверх обычных факторов
  const baseReason = buildLooReason(it, {
    routeCategory: it.routeCategory,
    ttMult: it.ttMult,
    spdYa: _src?.spdYa ?? null,
    spdTT: _src?.spdTT ?? null,
    factorNote: null,
    factorShiftBr: 0,
    baselineC: null,
  });
  const sign = it.predictedC >= it.baselineC ? "+" : "";
  it.reason = `${baseReason} ${fit.label === "outbound" ? "Outbound" : "Far"}-multiplier ×${fit.mult.toFixed(2)} применён: baseline ${it.baselineC.toFixed(2)} br → ${it.predictedC.toFixed(2)} br (${sign}${(it.predictedC - it.baselineC).toFixed(2)} br).`;
}

console.log(`\n[CATEGORY MULTIPLIERS]`);
for (const [k, f] of Object.entries(categoryMultipliers)) {
  const tag = f.active ? "✓ АКТИВЕН" : "○ ожидает данных";
  console.log(`  [${k.padEnd(8)}] ${tag}  ×${f.mult}  n=${f.n}  Δ=${f.improvedPp ?? "?"}pp  — ${f.reason}`);
}

// === ANOMALY DETECTION =================================================
// Точки с |err| ≥ 30% — это либо ошибка ввода замера, либо реальный сдвиг
// сёрджа, который модель не уловила (соседние точки отсутствуют или
// противоречат). Подсвечиваем для приоритетной перепроверки и сбора данных
// именно в этой ячейке/слоте. Идея из дополнения пользователя про
// supply/demand: outliers — главные кандидаты на дообогащение датасета.
const ANOMALY_THRESHOLD_PCT = 40;
for (const it of looItems) {
  it.isAnomaly = it.absPct >= ANOMALY_THRESHOLD_PCT;
}
const _anomalyItems = looItems
  .filter(it => it.isAnomaly)
  .sort((a, b) => b.absPct - a.absPct);
const anomalies = {
  threshold: ANOMALY_THRESHOLD_PCT,
  n: _anomalyItems.length,
  ofTotal: looItems.length,
  shareOfData: looItems.length
    ? +(_anomalyItems.length / looItems.length * 100).toFixed(1)
    : 0,
  items: _anomalyItems.map(it => ({
    id: it.id,
    date: it.date,
    slot: it.slot,
    routeCategory: it.routeCategory ?? "intra",
    from: it.from,
    to: it.to,
    km: it.km,
    factC: it.factC,
    predictedC: it.predictedC,
    errPct: it.errPct,
    absPct: it.absPct,
    verdict: it.verdict,
    yaSurgeC: it.yaSurgeC ?? null,
    h3Cell: it.h3Cell ?? null,
    fromZone: it.fromZone ?? null,
    ttMult: it.ttMult,
    reason: it.reason,
  })),
};
console.log(`\n[ANOMALIES] |err| ≥ ${ANOMALY_THRESHOLD_PCT}%: ${_anomalyItems.length}/${looItems.length} точек (${anomalies.shareOfData}%)`);
for (const it of _anomalyItems.slice(0, 5)) {
  const sign = it.errPct >= 0 ? "+" : "";
  console.log(`  #${it.id} ${it.from}→${it.to}: factC=${it.factC} br, pred=${it.predictedC} br, err=${sign}${it.errPct}% (${it.verdict})`);
}

// бакеты по фактическому сёрджу — только по intra (главный фокус анализа)
const looBuckets = { "<1": [], "1-2": [], "2-3": [], "≥3": [] };
for (const it of intraItems) {
  if (it.yaSurgeC < 1.0) looBuckets["<1"].push(it);
  else if (it.yaSurgeC < 2.0) looBuckets["1-2"].push(it);
  else if (it.yaSurgeC < 3.0) looBuckets["2-3"].push(it);
  else looBuckets["≥3"].push(it);
}
const bucketsAgg = Object.fromEntries(
  Object.entries(looBuckets).map(([k, arr]) => [k, {
    n: arr.length,
    mae: arr.length ? +mean(arr.map(x => Math.abs(x.err))).toFixed(2) : null,
    mape: arr.length ? +mean(arr.map(x => x.absPct)).toFixed(1) : null,
  }])
);

// Разбивка по типу маршрута — главный диагностический срез 11-го прогона.
// Показывает, в какой категории недостаточно данных.
const looByCat = { intra: [], outbound: [], far: [] };
for (const it of looItems) {
  const c = it.routeCategory || "intra";
  if (looByCat[c]) looByCat[c].push(it);
}
const categoriesAgg = Object.fromEntries(
  Object.entries(looByCat).map(([k, arr]) => [k, {
    n: arr.length,
    mae: arr.length ? +mean(arr.map(x => Math.abs(x.err))).toFixed(2) : null,
    mape: arr.length ? +mean(arr.map(x => x.absPct)).toFixed(1) : null,
    within10pct: arr.filter(x => x.absPct < 10).length,
    within20pct: arr.filter(x => x.absPct < 20).length,
  }])
);

// Excluded (outbound + far) — отдельная сводка для UI, в overall НЕ входит.
const excludedAgg = excludedItems.length ? {
  n: excludedItems.length,
  mae:  +mean(excludedItems.map(x => Math.abs(x.err))).toFixed(2),
  mape: +mean(excludedItems.map(x => x.absPct)).toFixed(1),
  within10pct: excludedItems.filter(x => x.absPct < 10).length,
  within20pct: excludedItems.filter(x => x.absPct < 20).length,
  note: "Outbound и дальние маршруты (за МКАД) — справочно, в основные метрики и factor fitting не включены.",
} : null;

const looReport = {
  generatedAt: new Date().toISOString(),
  n: intraItems.length,
  scope: "intra-Минск (внутри МКАД)",
  overall: {
    n: intraItems.length,
    mae:  intraItems.length ? +mean(intraItems.map(x => Math.abs(x.err))).toFixed(2) : null,
    mape: intraItems.length ? +mean(intraItems.map(x => x.absPct)).toFixed(1) : null,
    within10pct: intraItems.filter(x => x.absPct < 10).length,
    within20pct: intraItems.filter(x => x.absPct < 20).length,
  },
  excluded: excludedAgg,
  buckets: bucketsAgg,
  categories: categoriesAgg,
  factorAdjustments,
  categoryMultipliers,
  anomalies,
  items: looItems.sort((a, b) => new Date(b.date) - new Date(a.date) || (b.id > a.id ? 1 : -1)),
};
// --- Diff vs предыдущий запуск (читаем перед перезаписью) -------------
const looPath = join(LEARNED_DIR, "loo.json");
let prevLoo = null;
if (existsSync(looPath)) {
  try { prevLoo = JSON.parse(readFileSync(looPath, "utf8")); } catch {}
}
const diff = prevLoo?.overall ? {
  dMape:   +(looReport.overall.mape   - prevLoo.overall.mape).toFixed(2),
  dMae:    +(looReport.overall.mae    - prevLoo.overall.mae).toFixed(2),
  dN:      looReport.overall.n        - prevLoo.overall.n,
  dW10:    looReport.overall.within10pct - prevLoo.overall.within10pct,
  dW20:    looReport.overall.within20pct - prevLoo.overall.within20pct,
  prevMape: prevLoo.overall.mape,
  prevN:    prevLoo.overall.n,
  prevW10:  prevLoo.overall.within10pct,
  prevW20:  prevLoo.overall.within20pct,
} : null;

writeFileSync(looPath, JSON.stringify(looReport, null, 2));
// копируем во фронт, чтобы MapDashboard мог загрузить
const PUBLIC_DATA = join(ROOT, "public/data");
mkdirSync(PUBLIC_DATA, { recursive: true });
writeFileSync(join(PUBLIC_DATA, "loo.json"), JSON.stringify(looReport, null, 2));
if (diff) {
  const arrow = (v, good) => v === 0 ? "→" : (good ? "↓ лучше" : "↑ хуже");
  console.log(`\n[DIFF vs предыдущий запуск]`);
  console.log(`  MAPE: ${prevLoo.overall.mape}% → ${looReport.overall.mape}% (Δ ${diff.dMape>=0?'+':''}${diff.dMape}pp ${arrow(diff.dMape, diff.dMape<0)})`);
  console.log(`  MAE : ${prevLoo.overall.mae} br → ${looReport.overall.mae} br (Δ ${diff.dMae>=0?'+':''}${diff.dMae} br)`);
  console.log(`  ±10%: ${prevLoo.overall.within10pct} → ${looReport.overall.within10pct} (Δ ${diff.dW10>=0?'+':''}${diff.dW10})`);
  console.log(`  ±20%: ${prevLoo.overall.within20pct} → ${looReport.overall.within20pct} (Δ ${diff.dW20>=0?'+':''}${diff.dW20})`);
  console.log(`  Точек : ${prevLoo.overall.n} → ${looReport.overall.n} (Δ ${diff.dN>=0?'+':''}${diff.dN})`);
}
console.log(`\n[LOO] Leave-one-out (фокус intra-Минск, внутри МКАД): ${intraItems.length} точек, ${excludedItems.length} outbound/far исключено из метрик.`);
console.log(`  Overall MAE = ${looReport.overall.mae} br, MAPE = ${looReport.overall.mape}%`);
console.log(`  В пределах ±10%: ${looReport.overall.within10pct}/${intraItems.length}, ±20%: ${looReport.overall.within20pct}/${intraItems.length}`);
if (excludedAgg) {
  console.log(`  [excluded outbound/far] n=${excludedAgg.n}, MAE=${excludedAgg.mae} br, MAPE=${excludedAgg.mape}% (для справки)`);
}
for (const [b, agg] of Object.entries(bucketsAgg)) {
  if (agg.n) console.log(`  Бакет ⚡${b.padEnd(4)}: n=${agg.n}, MAE=${agg.mae} br, MAPE=${agg.mape}%`);
}
const top = [...intraItems].sort((a,b)=>b.absPct-a.absPct).slice(0,3);
if (top.length) {
  console.log(`  Топ-3 промаха:`);
  for (const t of top) console.log(`    #${t.id} ${t.from}→${t.to}: факт ${t.factC} br, прогноз ${t.predictedC} br (${t.errPct>=0?'+':''}${t.errPct}%) — ${t.verdict}`);
}

// --- 6. METRICS: насколько текущая модель ошибается ---------------------
const errs = dataset.filter(o => o.factC && o.sC && o.yaSurgeC).map(o => {
  // если открытый сёрдж = 1.3, то реальный baza × 1.3 = factC. Наша модель: rawC × sC = factC.
  // Метрика: насколько наш sC отличается от того, который бы дал точно baza_Y × open_surge?
  // Возьмём проще: error = |factC_pred - factC| / factC, где factC_pred = rawC × predicted_surge.
  // Для baseline пусть predicted_surge = mean sC по слоту (если есть в slotMap).
  return o;
});
const metrics = {
  generatedAt: new Date().toISOString(),
  datasetSize: dataset.length,
  withYaSurge: withSurge.length,
  bySlot: Object.fromEntries(
    Object.entries(surgeReport.ourModel).flatMap(([day, slots]) =>
      Object.entries(slots).map(([slot, info]) => [`${day}-${slot}`, { n: info.n, meanSurge: info.mean, std: info.std }])
    )
  ),
  bySlotOpen: Object.fromEntries(
    Object.entries(surgeReport.yandexOpen).flatMap(([day, slots]) =>
      Object.entries(slots).map(([slot, info]) => [`${day}-${slot}`, { n: info.n, meanSurge: info.mean, std: info.std }])
    )
  ),
};
writeFileSync(join(LEARNED_DIR, "metrics.json"), JSON.stringify(metrics, null, 2));

// --- 7. CHANGELOG (append-only) -----------------------------------------
const cl = join(LEARNED_DIR, "changelog.md");
const prev = existsSync(cl) ? readFileSync(cl, "utf8") : "# Журнал обучения системы\n\n";
const slotLines = Object.entries(surgeReport.ourModel).flatMap(([day, slots]) =>
  Object.entries(slots).map(([slot, info]) => {
    const open = surgeReport.yandexOpen?.[day]?.[slot];
    const openStr = open ? ` | yaOpen mean=${open.mean} (n=${open.n})` : "";
    return `  - \`${day}-${slot}\`: n=${info.n}, sC mean=${info.mean}, std=${info.std}${openStr}`;
  })
);
const surgeModelLines = Object.entries(surgeModel.bySlot).map(([key, info]) => {
  const reg = info.regression
    ? ` | ${info.regression.formula} (MAE=${info.regression.mae})`
    : "";
  return `  - \`${key}\`: n=${info.n}, mean=${info.mean}, std=${info.std}${reg}`;
});
const sanityLine = sanityReport.verdict
  ? sanityReport.verdict
  : "(недостаточно данных для проверки v3)";
const diffMd = diff ? `
**Δ vs прошлый запуск** (что изменилось):
  - MAPE intra: ${diff.prevMape}% → ${looReport.overall.mape}% (${diff.dMape>=0?'+':''}${diff.dMape}pp ${diff.dMape<0?'↓ лучше':diff.dMape>0?'↑ хуже':'→ без изменений'})
  - MAE intra : ${prevLoo.overall.mae} → ${looReport.overall.mae} br (${diff.dMae>=0?'+':''}${diff.dMae} br)
  - ±10% попаданий: ${diff.prevW10} → ${looReport.overall.within10pct} (${diff.dW10>=0?'+':''}${diff.dW10})
  - ±20% попаданий: ${diff.prevW20} → ${looReport.overall.within20pct} (${diff.dW20>=0?'+':''}${diff.dW20})
  - Всего точек intra: ${diff.prevN} → ${looReport.overall.n} (${diff.dN>=0?'+':''}${diff.dN})
` : "\n_(первый запуск — diff недоступен)_\n";

const entry = `

## ${new Date().toISOString().slice(0,16).replace("T"," ")} — обучение #${(prev.match(/^## /gm)?.length ?? 0)+1}
${diffMd}
**Dataset**: ${dataset.length} заказов из ${resultFiles.length} прогонов калибровки. С открытым ⚡N: ${withSurge.length}.

**L1 SANITY (v3)**: ${sanityLine}
${sanityReport.evidence.regression ? `  - регрессия: pickup=${sanityReport.evidence.regression.pickup}, perKm=${sanityReport.evidence.regression.perKm}, perMin=${sanityReport.evidence.regression.perMin} (MAE=${sanityReport.evidence.regression.mae})` : ""}
${sanityReport.warnings.length ? "\n**⚠ Предупреждения L1**:\n" + sanityReport.warnings.map(w=>`  - ${w}`).join("\n") : ""}

**L1 SURGE MODEL (v3)** ⚡N(km, min, slot):
${surgeModelLines.length ? surgeModelLines.join("\n") : "  (нет данных)"}

**Time-slot сёрдж (Cmf, sC и yaOpen)**:
${slotLines.join("\n")}

**Hidden Эконом-boost (overall)**: n=${allHb.length}, mean=×${mean(allHb).toFixed(3)}

**Трафик**: ttMean=${trafficReport.ttMean ?? "—"}, ${trafficReport.note ?? "недостаточно данных"}
`;
writeFileSync(cl, prev + entry);

// --- Сводка ------------------------------------------------------------
console.log(`\n${"=".repeat(72)}`);
console.log("ОБУЧЕНИЕ ЗАВЕРШЕНО. Артефакты в scripts/learned/:");
console.log("  • dataset.json        — единая база заказов");
console.log("  • sanity-tariff.json  — проверка v3 (perKm/perMin → 0)");
console.log("  • surge-model.json    — ⚡N(km, min, slot) — главная модель v3");
console.log("  • surge-map.json      — sC по day×slot×cell");
console.log("  • hidden-boost.json   — Эконом-boost по слотам");
console.log("  • traffic-effect.json — влияние пробок");
console.log("  • metrics.json        — точность модели");
console.log("  • changelog.md        — журнал обучения (append-only)");
if (sanityReport.warnings.length) {
  console.log("\n⚠ Предупреждения L1 SANITY:");
  for (const w of sanityReport.warnings) console.log(`  - ${w}`);
}
if (surgeModel.warnings.length) {
  console.log("\n⚠ Предупреждения SURGE MODEL:");
  for (const w of surgeModel.warnings) console.log(`  - ${w}`);
}

// --- 7. Sync observations.json -------------------------------------------
// Авто-вливание калибровочных точек во фронтовую observations.json,
// чтобы карта/RoutePlanner улучшали прогноз по новым данным без ручного
// копирования. Запускаем как отдельный процесс — изолирует ошибки.
console.log("\n--- Sync observations ---");
const syncRes = spawnSync(
  process.execPath,
  [join(__dirname, "syncObservations.mjs")],
  { stdio: "inherit" },
);
if (syncRes.status !== 0) {
  console.warn("⚠ syncObservations.mjs упал (status=" + syncRes.status + "), карту не обновили");
}
