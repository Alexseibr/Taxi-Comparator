#!/usr/bin/env node
// Сравнение фактических цен Я. с прогнозом нашей модели для калибровочного
// прогона. Читает orders/<run>.results.json (после `pnpm calib`) и применяет
// PREDICT-логику (slot-регрессия + H3 + hour-фактор) к каждому маршруту.
//
// Использование: node scripts/compare-predict.mjs <run-source-file>
//   например: node scripts/compare-predict.mjs 2026-04-26-2229.results.json

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { h3CellOf } from "./factors.mjs";
import { tagFromH3Cell, tagSummary } from "./zoneTags.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const sourceFile = process.argv[2];
if (!sourceFile) {
  console.error("Usage: node scripts/compare-predict.mjs <YYYY-MM-DD-HHMM.results.json>");
  process.exit(1);
}

const results = JSON.parse(readFileSync(join(ROOT, "scripts/orders", sourceFile), "utf8"));
const surgeModel = JSON.parse(readFileSync(join(ROOT, "scripts/learned/surge-model.json"), "utf8"));
const loo = JSON.parse(readFileSync(join(ROOT, "scripts/learned/loo.json"), "utf8"));
const sanity = JSON.parse(readFileSync(join(ROOT, "scripts/learned/sanity-tariff.json"), "utf8"));
const CMF_MIN = +sanity.evidence.bazaStats.median.toFixed(2);
const ECON_MIN = +(CMF_MIN * 0.952).toFixed(2);

// Часовая гранулярность (синхронизировано с learn.mjs).
// При отсутствии регрессии в точном часе пробуем соседние часы ±2.
const SLOT_PEER_WINDOW_HOURS = 2;
function findSlotInfoFor(dayKey, hour) {
  const exactKey = `${dayKey}-h${hour}`;
  const exact = surgeModel.bySlot[exactKey];
  if (exact?.regression) return { info: exact, key: exactKey, fallback: null };
  for (let d = 1; d <= SLOT_PEER_WINDOW_HOURS; d++) {
    for (const h of [hour - d, hour + d]) {
      if (h < 0 || h > 23) continue;
      const k = `${dayKey}-h${h}`;
      const cand = surgeModel.bySlot[k];
      if (cand?.regression) return { info: cand, key: k, fallback: h };
    }
  }
  if (exact) return { info: exact, key: exactKey, fallback: null };
  for (let d = 1; d <= SLOT_PEER_WINDOW_HOURS; d++) {
    for (const h of [hour - d, hour + d]) {
      if (h < 0 || h > 23) continue;
      const k = `${dayKey}-h${h}`;
      const cand = surgeModel.bySlot[k];
      if (cand) return { info: cand, key: k, fallback: h };
    }
  }
  // Финальный глобальный fallback: ближайший по часу слот того же дня с .mean.
  // Возвращаем ТОЛЬКО mean (без regression) — регрессия чужого часа out-of-domain.
  let best = null;
  for (const [k, info] of Object.entries(surgeModel.bySlot)) {
    if (!info?.mean) continue;
    if (!k.startsWith(dayKey + "-h")) continue;
    const h = parseInt(k.slice((dayKey + "-h").length), 10);
    if (Number.isNaN(h)) continue;
    const dist = Math.abs(h - hour);
    if (!best || dist < best.dist) best = { info, key: k, fallback: h, dist };
  }
  if (best) {
    return {
      info: { mean: best.info.mean, n: best.info.n }, // без regression
      key: best.key,
      fallback: best.fallback,
    };
  }
  return { info: null, key: exactKey, fallback: null };
}

const DAY_MAP = {
  monday:"weekday", tuesday:"weekday", wednesday:"weekday", thursday:"weekday", friday:"weekday",
  saturday:"saturday", sunday:"sunday",
};
const dayKey = DAY_MAP[(results.day || "sunday").toLowerCase()];

// --- RWB tariff grid (зеркало RWB_TARIFF_GRID из src/lib/zones.ts) ---------
const RWB_DEMPING_VS_YA = 0.10;
const RWB_FLOOR = 7.00;
const RWB_OWN_SURGE_THRESHOLD = 1.5;
const RWB_OWN_SURGE_CAP = 3.0;
const RWB_GRID = {
  comfort: {
    weekday: {
      day:     { pickup:0, minimum:7, perKm:1.10, perMin:0.25 },
      evening: { pickup:0, minimum:7, perKm:1.25, perMin:0.30 },
      night:   { pickup:0, minimum:7, perKm:0.80, perMin:0.20 },
    },
    weekend: {
      day:     { pickup:0, minimum:7, perKm:1.00, perMin:0.25 },
      evening: { pickup:0, minimum:7, perKm:1.30, perMin:0.30 },
      night:   { pickup:0, minimum:7, perKm:0.80, perMin:0.20 },
    },
  },
  econom: {
    weekday: {
      day:     { pickup:0, minimum:7, perKm:1.05, perMin:0.24 },
      evening: { pickup:0, minimum:7, perKm:1.20, perMin:0.29 },
      night:   { pickup:0, minimum:7, perKm:0.76, perMin:0.19 },
    },
    weekend: {
      day:     { pickup:0, minimum:7, perKm:0.95, perMin:0.24 },
      evening: { pickup:0, minimum:7, perKm:1.24, perMin:0.29 },
      night:   { pickup:0, minimum:7, perKm:0.76, perMin:0.19 },
    },
  },
};
function rwbSlot(dKey, hour) {
  const kind = dKey === "weekday" ? "weekday" : "weekend";
  let slot;
  if (hour >= 6 && hour < 17) slot = "day";
  else if (hour >= 17 && hour < 22) slot = "evening";
  else slot = "night";
  return { kind, slot };
}
function rwbFinal(cls, km, min, hour, dKey, yaPrice, surge = 1.0) {
  const { kind, slot } = rwbSlot(dKey, hour);
  const t = RWB_GRID[cls][kind][slot];
  const baseSum = Math.max(t.minimum, t.pickup + t.perKm*km + t.perMin*min);
  const surgeApplied = surge >= RWB_OWN_SURGE_THRESHOLD
    ? Math.min(surge, RWB_OWN_SURGE_CAP)
    : 1.0;
  const own = +(baseSum * surgeApplied).toFixed(2);
  const ceiling = +(yaPrice * (1 - RWB_DEMPING_VS_YA)).toFixed(2);
  const preFloor = Math.min(own, ceiling);
  const final = +Math.max(RWB_FLOOR, preFloor).toFixed(2);
  let src;
  if (final === RWB_FLOOR && preFloor < RWB_FLOOR) src = "пол";
  else if (own <= ceiling) src = "своя" + (surgeApplied > 1 ? `×⚡${surgeApplied.toFixed(1)}` : "");
  else src = "потолок";
  return { own, ceiling, final, src, surgeApplied };
}

// --- Predict surge (как в predict.mjs) -------------------------------------
const fzAdj = (loo.factorAdjustments || []).find(f => f.mode === "fromZone");
const hourAdj = (loo.factorAdjustments || []).find(f => f.mode === "hour");

const MINSK_CENTER_LAT = 53.9006, MINSK_CENTER_LNG = 27.5660;
function centDistFn(lat, lng) {
  if (lat == null || lng == null) return 0;
  const x = (lng - MINSK_CENTER_LNG) * Math.cos((lat + MINSK_CENTER_LAT) / 2 * Math.PI/180);
  const y = lat - MINSK_CENTER_LAT;
  return 6371 * Math.PI/180 * Math.sqrt(x*x + y*y);
}

function predictSurge(km, freeMin, ttMult, hour, fromPt, toPt) {
  const slotKey = `${dayKey}-h${hour}`;
  const _resolved = findSlotInfoFor(dayKey, hour);
  const slotInfo = _resolved.info;
  const usedSlotKey = _resolved.key;
  const fallbackTag = _resolved.fallback != null ? ` [fallback h${_resolved.fallback}]` : "";
  const minTotal = freeMin * (ttMult ?? 1);
  const centD = fromPt ? centDistFn(fromPt[0], fromPt[1]) : 0;
  const destD = toPt ? centDistFn(toPt[0], toPt[1]) : 0;

  let surge, surgeReason;
  if (slotInfo?.regression) {
    const r = slotInfo.regression;
    if (r.version === 7 || r.bOutbound != null) {
      // v7: 7 фич — pickup centDist + km·centDist + max(0, destD − pickupD) (нелинейная)
      const outbound = Math.max(0, destD - centD);
      surge = r.intercept + r.bKm*km + r.bFreeMin*freeMin + r.bTt*((ttMult ?? 1) - 1)
            + r.bCent*centD + (r.bKmCent ?? 0)*(km * centD) + r.bOutbound*outbound;
      surgeReason = `slot ${usedSlotKey}${fallbackTag} regression v7 (n=${slotInfo.n}, centD=${centD.toFixed(1)}км, km·cD=${(km*centD).toFixed(1)}, outbound=${outbound.toFixed(1)}км)`;
    } else if (r.version === 5 || r.bCent != null) {
      // v5: 6 фич — centDist + km*centDist (interaction)
      surge = r.intercept + r.bKm*km + r.bFreeMin*freeMin + r.bTt*((ttMult ?? 1) - 1)
            + r.bCent*centD + (r.bKmCent ?? 0)*(km * centD);
      surgeReason = `slot ${usedSlotKey}${fallbackTag} regression v5 (n=${slotInfo.n}, centD=${centD.toFixed(1)}км, km·cD=${(km*centD).toFixed(1)})`;
    } else if (r.version === 4 || r.bFreeMin != null) {
      // v4: разделённые фичи km / freeMin / (ttMult-1)
      surge = r.intercept + r.bKm*km + r.bFreeMin*freeMin + r.bTt*((ttMult ?? 1) - 1);
      surgeReason = `slot ${usedSlotKey}${fallbackTag} regression v4 (n=${slotInfo.n})`;
    } else {
      // v3 fallback: 2 фичи (km, min)
      surge = r.intercept + r.bKm*km + r.bMin*minTotal;
      surgeReason = `slot ${usedSlotKey}${fallbackTag} regression v3 (n=${slotInfo.n})`;
    }
  } else if (slotInfo?.mean) {
    surge = slotInfo.mean;
    surgeReason = `slot ${usedSlotKey}${fallbackTag} mean (n=${slotInfo.n})`;
  } else {
    surge = 1.0;
    surgeReason = `СЛОТ ${slotKey} и соседние ±${SLOT_PEER_WINDOW_HOURS}ч ПУСТЫ → baseline 1.00`;
  }
  surge = Math.max(0.3, Math.min(10.0, surge));

  // H3 zone factor
  let h3Mu = 1.0, h3Active = false, cellId = null;
  if (fromPt && fromPt[0] != null) {
    cellId = h3CellOf(fromPt[0], fromPt[1]);
    const ci = fzAdj?.cells?.[cellId];
    if (fzAdj?.active && ci && ci.mu !== 1.0) {
      h3Mu = ci.mu; h3Active = true;
    }
  }
  // Hour factor
  let hourMu = 1.0, hourActive = false;
  if (hourAdj?.active && hourAdj.hours?.[String(hour)] && hourAdj.hours[String(hour)].mu !== 1.0) {
    hourMu = hourAdj.hours[String(hour)].mu;
    hourActive = true;
  }

  const finalSurge = +(surge * h3Mu * hourMu).toFixed(3);
  return {
    base: +surge.toFixed(3), final: finalSurge,
    cmf: +(finalSurge * CMF_MIN).toFixed(2),
    econ: +(finalSurge * ECON_MIN).toFixed(2),
    h3Active, h3Mu, cellId, hourActive, hourMu, surgeReason, slotKey,
  };
}

// --- Прогон -----------------------------------------------------------------
console.log(`\nСравнение прогноз vs факт — ${sourceFile}`);
console.log(`Дата: ${results.date} (${results.day})\n`);

const rows = [];
for (const o of results.results) {
  const p = predictSurge(o.km, o.freeMin ?? (o.min/(o.ttMult||1)), o.ttMult ?? 1, o.hour, o.fromPt, o.toPt);
  const yaCmf = o.factC, yaEcon = o.factE, yaSurge = o.yaSurgeC;
  const rwbC = rwbFinal("comfort", o.km, o.min, o.hour, dayKey, p.cmf,  p.final);
  const rwbE = rwbFinal("econom",  o.km, o.min, o.hour, dayKey, p.econ, p.final);
  const surgeErr = (yaSurge != null) ? ((p.final - yaSurge) / yaSurge * 100) : null;
  const cmfErr   = ((p.cmf - yaCmf) / yaCmf * 100);
  const econErr  = ((p.econ - yaEcon) / yaEcon * 100);
  rows.push({ ...o, p, rwbC, rwbE, surgeErr, cmfErr, econErr });
}

// Таблица
console.log("ID | from→to                                   | km   | min  | Я.⚡  → Я.Cmf  | наш⚡ → наш Cmf | Δ⚡    | ΔCmf%  | RWB Cmf (источник)");
console.log("=".repeat(180));
for (const r of rows) {
  const route = `${r.from}→${r.to}`.slice(0, 42).padEnd(42);
  const yaSurgeStr = r.yaSurgeC != null ? `⚡${r.yaSurgeC.toFixed(2)}` : ` ⚡—  `;
  const dSurgeStr  = r.yaSurgeC != null ? (r.p.final - r.yaSurgeC).toFixed(2).padStart(6) : "    — ";
  console.log(
    `${r.id} | ${route} | ${r.km.toFixed(1).padStart(4)} | ${r.min.toFixed(0).padStart(4)} | ` +
    `${yaSurgeStr} → ${r.factC.toFixed(1).padStart(5)} br (E ${r.factE.toFixed(1)}) | ` +
    `⚡${r.p.final.toFixed(2)} → ${r.p.cmf.toFixed(2).padStart(5)} br (E ${r.p.econ.toFixed(2)})  | ` +
    `${dSurgeStr} | ${r.cmfErr >= 0 ? "+" : ""}${r.cmfErr.toFixed(0).padStart(4)}% C / ${r.econErr >= 0 ? "+" : ""}${r.econErr.toFixed(0).padStart(4)}% E | ` +
    `${r.rwbC.final.toFixed(2).padStart(5)} br (${r.rwbC.src})`
  );
}

// Сводка
const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
const median = a => { if (!a.length) return 0; const s=[...a].sort((x,y)=>x-y); return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2; };
const cmfErrs = rows.map(r => r.cmfErr);
const econErrs = rows.map(r => r.econErr);
const surgeErrs = rows.map(r => r.surgeErr).filter(x => x != null);
console.log("\n" + "=".repeat(80));
if (surgeErrs.length) {
  console.log(`Средняя ошибка surge: mean=${mean(surgeErrs).toFixed(1)}% / mean|abs|=${mean(surgeErrs.map(Math.abs)).toFixed(1)}% / median|abs|=${median(surgeErrs.map(Math.abs)).toFixed(1)}%   (n=${surgeErrs.length} с известным yaSurgeC)`);
} else {
  console.log(`Surge ошибки: yaSurgeC не указан ни в одной записи — пропускаем (заполни yaSurgeC в orders.json для прямого замера)`);
}
console.log(`Средняя ошибка Cmf:   mean=${mean(cmfErrs).toFixed(1)}% / mean|abs|=${mean(cmfErrs.map(Math.abs)).toFixed(1)}% / median|abs|=${median(cmfErrs.map(Math.abs)).toFixed(1)}%`);
console.log(`Средняя ошибка Econ:  mean=${mean(econErrs).toFixed(1)}% / mean|abs|=${mean(econErrs.map(Math.abs)).toFixed(1)}% / median|abs|=${median(econErrs.map(Math.abs)).toFixed(1)}%`);
const within10C = cmfErrs.filter(x => Math.abs(x) <= 10).length;
const within20C = cmfErrs.filter(x => Math.abs(x) <= 20).length;
const within10E = econErrs.filter(x => Math.abs(x) <= 10).length;
const within20E = econErrs.filter(x => Math.abs(x) <= 20).length;
console.log(`Within ±10%: Cmf ${within10C}/${rows.length} (${(within10C/rows.length*100).toFixed(0)}%), Econ ${within10E}/${rows.length} (${(within10E/rows.length*100).toFixed(0)}%)`);
console.log(`Within ±20%: Cmf ${within20C}/${rows.length} (${(within20C/rows.length*100).toFixed(0)}%), Econ ${within20E}/${rows.length} (${(within20E/rows.length*100).toFixed(0)}%)`);

// Доход RWB vs Я.
const yaTotal = rows.reduce((s,r) => s + r.factC, 0);
const rwbTotal = rows.reduce((s,r) => s + r.rwbC.final, 0);
const lostBr = yaTotal - rwbTotal;
console.log(`\nСумма Я.Cmf по ${rows.length} заказам:  ${yaTotal.toFixed(1)} br`);
console.log(`Сумма RWB Cmf по ${rows.length} заказам: ${rwbTotal.toFixed(1)} br`);
console.log(`Недополучено vs Я.: ${lostBr.toFixed(1)} br (${(lostBr/yaTotal*100).toFixed(1)}% — наш потолок завышен/занижен)`);

// Источники RWB цены (своя×⚡N → бакет "своя")
const sources = { своя: 0, потолок: 0, пол: 0 };
for (const r of rows) {
  const bucket = r.rwbC.src.startsWith("своя") ? "своя" : r.rwbC.src;
  sources[bucket] = (sources[bucket] ?? 0) + 1;
}
console.log(`\nИсточник RWB Cmf: своя=${sources["своя"]}, потолок=${sources["потолок"]}, пол=${sources["пол"]} (из ${rows.length})`);

// Слот покрытия
const slotsHit = new Set(rows.map(r => r.p.slotKey));
const slotsEmpty = [...slotsHit].filter(k => !surgeModel.bySlot[k]?.regression);
if (slotsEmpty.length) {
  console.log(`\n⚠ Слоты БЕЗ регрессии (predict вернул baseline): ${slotsEmpty.join(", ")}`);
  console.log(`   → Эти 14 точек заполнят пробел "sunday-late" если запустить learn.mjs.`);
}

// 🏷 Зональные ярлыки активных H3-ячеек
if (fzAdj?.active && fzAdj.cells && Object.keys(fzAdj.cells).length) {
  console.log("\n" + "=".repeat(80));
  console.log("🏷 Активные H3-ячейки модели (зональные ярлыки):");
  const cellEntries = Object.entries(fzAdj.cells)
    .sort((a, b) => Math.abs((b[1].mu || 1) - 1) - Math.abs((a[1].mu || 1) - 1));
  for (const [cellId, info] of cellEntries) {
    const tag = info.tag || tagFromH3Cell(cellId);
    const direction = info.mu > 1 ? `+${((info.mu - 1) * 100).toFixed(1)}%` : `−${((1 - info.mu) * 100).toFixed(1)}%`;
    const smoothMark = info.smoothed ? " (сглажено)" : "";
    console.log(`   ${tagSummary(tag).padEnd(48)} mu=${info.mu.toFixed(3)} (${direction})  n=${info.n}${smoothMark}`);
    console.log(`     ${cellId}  @ ${info.lat?.toFixed(5) ?? "?"}, ${info.lng?.toFixed(5) ?? "?"}`);
  }
}

// Какие ячейки в этой партии замеров встретились (для понимания покрытия)
const cellsInBatch = new Map();
for (const r of rows) {
  if (!r.p.cellId) continue;
  const key = r.p.cellId;
  if (!cellsInBatch.has(key)) cellsInBatch.set(key, { count: 0, active: r.p.h3Active });
  cellsInBatch.get(key).count++;
}
if (cellsInBatch.size) {
  console.log("\n📍 H3-ячейки в этой партии:");
  for (const [cellId, info] of [...cellsInBatch.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const tag = tagFromH3Cell(cellId);
    const mark = info.active ? "✓" : "·";
    console.log(`   ${mark} ${tagSummary(tag).padEnd(48)} ${info.count} замер(ов)  ${cellId}`);
  }
  console.log(`   (✓ — ячейка активна в модели, · — нет фактора, n<3 или |mu-1|≤10%)`);
}
