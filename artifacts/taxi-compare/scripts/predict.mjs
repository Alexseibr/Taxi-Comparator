#!/usr/bin/env node
// Прогноз цены Я.Такси Cmf для нового заказа БЕЗ необходимости запускать
// калибровку. Использует обученную slot-регрессию и активные факторы.
//
// Запуск:
//   node scripts/predict.mjs --km 17.4 --min 20 --hour 17 --day sunday --lat 53.902 --lng 27.560
//   node scripts/predict.mjs --km 5 --min 10 --hour 13 --day monday   (без координат → нет H3-сдвига)
//
// Параметры:
//   --km   длина маршрута в км (как в скрине Я.)
//   --min  время в пути в минутах (как в скрине Я.)
//   --hour час 0-23
//   --day  monday|tuesday|...|sunday
//   --lat  широта точки старта (опционально, для применения H3-зонального множителя)
//   --lng  долгота точки старта (опционально, для применения H3-зонального множителя)
//   --to-lat широта точки назначения (опционально, для slot-регрессии v6 с destCentDist)
//   --to-lng долгота точки назначения (опционально, для slot-регрессии v6 с destCentDist)
//
// На выходе: ожидаемый ⚡N, ожидаемый Cmf, обоснование.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { h3CellOf } from "./factors.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LEARNED = join(ROOT, "scripts/learned");

// ---- Парсим CLI аргументы --------------------------------------------------
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, "");
  args[k] = process.argv[i + 1];
}
const km   = parseFloat(args.km);
const min  = parseFloat(args.min);
const hour = parseInt(args.hour, 10);
const dayInput = (args.day || "sunday").toLowerCase();
const lat  = args.lat != null ? parseFloat(args.lat) : null;
const lng  = args.lng != null ? parseFloat(args.lng) : null;
const toLat = args["to-lat"] != null ? parseFloat(args["to-lat"]) : null;
const toLng = args["to-lng"] != null ? parseFloat(args["to-lng"]) : null;

if (!km || !min || isNaN(hour)) {
  console.error("Использование: node scripts/predict.mjs --km <N> --min <N> --hour <0-23> [--day mon|...|sun] [--lat <N> --lng <N>]");
  process.exit(1);
}

// ---- Day key (как в learn.mjs / zones.ts: weekday | saturday | sunday) -----
const DAY_MAP = {
  mon: "weekday", monday: "weekday",
  tue: "weekday", tuesday: "weekday",
  wed: "weekday", wednesday: "weekday",
  thu: "weekday", thursday: "weekday",
  fri: "weekday", friday: "weekday",
  sat: "saturday", saturday: "saturday",
  sun: "sunday", sunday: "sunday",
  weekday: "weekday",
};
const dayKey = DAY_MAP[dayInput];
if (!dayKey) {
  console.error(`Неизвестный день: "${dayInput}". Допустимо: mon|tue|wed|thu|fri|sat|sun (или weekday|saturday|sunday).`);
  process.exit(1);
}

// ---- Slot — часовая гранулярность, синхронизировано с learn.mjs ---------
// Раньше было 5 широких слотов (night/morning/midday/evening/late). Теперь
// learn.mjs группирует по `h{hour}` (24 слота). Если для точного часа в
// surge-model.json нет регрессии — пробуем соседние часы того же дня
// ±SLOT_PEER_WINDOW_HOURS. Это аналог neighborPeers() в learn.mjs.
const SLOT_PEER_WINDOW_HOURS = 2;
const partOfDay = `h${hour}`;
const slotKey = `${dayKey}-${partOfDay}`;

// ---- Грузим обученные артефакты --------------------------------------------
const j = (p) => JSON.parse(readFileSync(join(LEARNED, p), "utf8"));
const surgeModel = j("surge-model.json");
const loo        = j("loo.json");
const sanity     = j("sanity-tariff.json");
const CMF_MIN    = +sanity.evidence.bazaStats.median.toFixed(2); // 9.86

// Берём слот точного часа; если регрессии нет — расширяем поиск на соседние
// часы того же дня. Возвращает { info, key, fallbackHour } — где key и
// fallbackHour отражают, какой именно слот удалось использовать.
function findSlotInfo(dayKey, hour) {
  const exactKey = `${dayKey}-h${hour}`;
  const exact = surgeModel.bySlot[exactKey];
  if (exact?.regression) return { info: exact, key: exactKey, fallbackHour: null };
  // Расширяющееся окно ±1, ±2 от час; берём первого соседа с регрессией
  for (let d = 1; d <= SLOT_PEER_WINDOW_HOURS; d++) {
    for (const h of [hour - d, hour + d]) {
      if (h < 0 || h > 23) continue;
      const k = `${dayKey}-h${h}`;
      const cand = surgeModel.bySlot[k];
      if (cand?.regression) return { info: cand, key: k, fallbackHour: h };
    }
  }
  // Регрессии нигде нет — возвращаем точный слот (или ближайший непустой) для агрегата
  if (exact) return { info: exact, key: exactKey, fallbackHour: null };
  for (let d = 1; d <= SLOT_PEER_WINDOW_HOURS; d++) {
    for (const h of [hour - d, hour + d]) {
      if (h < 0 || h > 23) continue;
      const k = `${dayKey}-h${h}`;
      const cand = surgeModel.bySlot[k];
      if (cand) return { info: cand, key: k, fallbackHour: h };
    }
  }
  // Финальный глобальный fallback: ищем ЛЮБОЙ слот того же дня с .mean,
  // ближайший по часу. Так в "ночные" провалы датасета (sunday-h2..h6)
  // мы попадём на ранний вечер вместо тупого baseline 1.00.
  // ВАЖНО: возвращаем ТОЛЬКО mean (без regression). Регрессия из чужого часа
  // (например, sunday-h10 для запроса sunday-h3) физически бессмысленна —
  // её km/freeMin коэффициенты обучены на другом контексте и могут давать
  // out-of-domain ⚡ < 0.5 для коротких маршрутов. Mean — robust агрегат.
  let best = null;
  for (const [k, info] of Object.entries(surgeModel.bySlot)) {
    if (!info?.mean) continue;
    if (!k.startsWith(dayKey + "-h")) continue;
    const h = parseInt(k.slice((dayKey + "-h").length), 10);
    if (Number.isNaN(h)) continue;
    const dist = Math.abs(h - hour);
    if (!best || dist < best.dist) best = { info, key: k, fallbackHour: h, dist };
  }
  if (best) {
    return {
      info: { mean: best.info.mean, n: best.info.n }, // без regression
      key: best.key,
      fallbackHour: best.fallbackHour,
    };
  }
  return { info: null, key: exactKey, fallbackHour: null };
}
const _resolvedSlot = findSlotInfo(dayKey, hour);
const slotInfo = _resolvedSlot.info;
const usedSlotKey = _resolvedSlot.key;
const usedFallbackHour = _resolvedSlot.fallbackHour;
const fzAdj    = (loo.factorAdjustments || []).find(f => f.mode === "fromZone");
const cellId   = (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng))
  ? h3CellOf(lat, lng) : null;
const cellInfo = cellId ? fzAdj?.cells?.[cellId] : null;
const fzMult   = cellInfo?.mu ?? 1.0;
const fzActive = fzAdj?.active && cellInfo && fzMult !== 1.0;

// ---- centDist (расстояние pickup от центра Минска) — для v5 -----------
const MINSK_CENTER_LAT = 53.9006, MINSK_CENTER_LNG = 27.5660;
function centDistFn(lat, lng) {
  if (lat == null || lng == null) return 0;
  const x = (lng - MINSK_CENTER_LNG) * Math.cos((lat + MINSK_CENTER_LAT) / 2 * Math.PI/180);
  const y = lat - MINSK_CENTER_LAT;
  return 6371 * Math.PI/180 * Math.sqrt(x*x + y*y);
}
const centD = centDistFn(lat, lng);
const destD = centDistFn(toLat, toLng);

// ---- Считаем surge ---------------------------------------------------------
let predSurge, surgeReason;
if (slotInfo?.regression) {
  const r = slotInfo.regression;
  if (r.version === 7 || r.bOutbound != null) {
    // v7: 7 фич — pickup centDist + km·centDist + max(0, destD − pickupD).
    // Нелинейная outbound-only фича: активна только для "выезда из центра"
    // (центр→окраина), для остальных направлений = 0. Чинит overshoot для i16, b01, 9866.
    const ttMult  = r.slotTtMean ?? 1.0;
    const freeMin = min / ttMult;
    const kmCent = km * centD;
    const outbound = Math.max(0, destD - centD);
    predSurge = r.intercept + r.bKm*km + r.bFreeMin*freeMin + r.bTt*(ttMult - 1)
              + r.bCent*centD + (r.bKmCent ?? 0)*kmCent + r.bOutbound*outbound;
    surgeReason = `Часовой слот v7 "${usedSlotKey}"${usedFallbackHour != null ? ` (соседний час, для ${slotKey} нет регрессии)` : ""} (n=${slotInfo.n}): ${r.formula}, ttMult=${ttMult.toFixed(2)}, freeMin≈${freeMin.toFixed(1)}, centDist=${centD.toFixed(1)}км, km·centD=${kmCent.toFixed(1)}, outbound=${outbound.toFixed(1)}км = ${predSurge.toFixed(2)}`;
  } else if (r.version === 5 || r.bCent != null) {
    // v5: 6 фич — centDist + km*centDist (interaction). Для центральных коротких
    // маршрутов оба ≈ 0 → не overshoot; для окраин+длинных оба усиливают surge.
    const ttMult  = r.slotTtMean ?? 1.0;
    const freeMin = min / ttMult;
    const kmCent = km * centD;
    predSurge = r.intercept + r.bKm*km + r.bFreeMin*freeMin + r.bTt*(ttMult - 1)
              + r.bCent*centD + (r.bKmCent ?? 0)*kmCent;
    surgeReason = `Часовой слот v5 "${usedSlotKey}"${usedFallbackHour != null ? ` (соседний час, для ${slotKey} нет регрессии)` : ""} (n=${slotInfo.n}): ${r.formula}, ttMult=${ttMult.toFixed(2)}, freeMin≈${freeMin.toFixed(1)}, centDist=${centD.toFixed(1)}км, km·centD=${kmCent.toFixed(1)} = ${predSurge.toFixed(2)}`;
  } else if (r.version === 4 || r.bFreeMin != null) {
    // v4: km, freeMin (свободный поток), ttMult (пробки) — отдельные фичи.
    // Пользователь даёт `min` со скрина Я. (с пробками). Обратно вычисляем
    // freeMin через slot-typical ttMult (среднее по слоту из обучающих данных)
    // — это лучшая оценка, когда нет real-time TomTom snapshot в момент квоты.
    const ttMult  = r.slotTtMean ?? 1.0;                    // slot-typical traffic
    const freeMin = min / ttMult;                           // обратное восстановление
    predSurge = r.intercept + r.bKm*km + r.bFreeMin*freeMin + r.bTt*(ttMult - 1);
    surgeReason = `Часовой слот v4 "${usedSlotKey}"${usedFallbackHour != null ? ` (соседний час, для ${slotKey} нет регрессии)` : ""} (n=${slotInfo.n}): ${r.formula}, ttMult=${ttMult.toFixed(2)}, freeMin≈${freeMin.toFixed(1)} = ${predSurge.toFixed(2)}`;
  } else {
    predSurge = r.intercept + r.bKm * km + r.bMin * min;
    surgeReason = `Часовой слот v3 "${usedSlotKey}"${usedFallbackHour != null ? ` (соседний час, для ${slotKey} нет регрессии)` : ""} (n=${slotInfo.n}): ${r.formula} = ${predSurge.toFixed(2)}`;
  }
} else if (slotInfo?.mean) {
  predSurge = slotInfo.mean;
  surgeReason = `Регрессии в "${usedSlotKey}" нет (n=${slotInfo.n}, мало данных), беру средний ⚡ слота = ${predSurge.toFixed(2)}`;
} else {
  predSurge = 1.0;
  surgeReason = `Слот "${slotKey}" и соседние ±${SLOT_PEER_WINDOW_HOURS}ч пусты — ставлю ⚡ = 1.00 (baseline). Нужны калибровочные замеры на этот час!`;
}
const rawSurge = predSurge;
predSurge = Math.max(0.3, Math.min(10.0, predSurge)); // SURGE_BOUNDS как в zones.ts
const clampWarning = rawSurge !== predSurge
  ? `\n  ⚠ Регрессия дала ⚡=${rawSurge.toFixed(2)}, обрезано до ⚡=${predSurge.toFixed(2)} (SURGE_BOUNDS [0.3..10.0]). Маршрут вне диапазона обученных данных.`
  : "";

const baseSurge = predSurge;
const baseCmf   = +(predSurge * CMF_MIN).toFixed(2);
const finalSurge = +(predSurge * fzMult).toFixed(3);
const finalCmf  = +(finalSurge * CMF_MIN).toFixed(2);

// ---- Сравнение Эконом ------------------------------------------------------
const econMin = +(CMF_MIN * 0.952).toFixed(2);
const finalEcon = +(finalSurge * econMin).toFixed(2);

// ---- Вывод -----------------------------------------------------------------
console.log("=".repeat(72));
console.log(`ПРОГНОЗ Я.Такси для маршрута: ${km} км, ${min} мин`);
console.log(`Слот: ${slotKey} (час ${hour})${usedFallbackHour != null ? `, fallback на h${usedFallbackHour}` : ""}${cellId ? `, H3-ячейка старта: ${cellId.slice(0,7)}…` : ", без координат старта"}`);
console.log("=".repeat(72));
console.log();
console.log("ШАГ 1. Базовый surge (без факторов):");
console.log(`  ⚡ = ${baseSurge.toFixed(2)} → Cmf = ${baseCmf} br`);
console.log(`  ${surgeReason}${clampWarning}`);
console.log();
const fromZoneLabel = cellId ? `H3 ${cellId.slice(0, 7)}…` : "без координат старта";
if (fzActive) {
  const sign = fzMult < 1 ? "−" : "+";
  const pct = Math.abs(100 * (1 - fzMult)).toFixed(0);
  console.log(`ШАГ 2. Применяем зональный множитель (${fromZoneLabel} ×${fzMult.toFixed(2)}):`);
  console.log(`  ⚡ финальный = ${baseSurge.toFixed(2)} × ${fzMult.toFixed(2)} = ${finalSurge.toFixed(2)}`);
  console.log(`  Cmf финальный = ${finalCmf} br  (${sign}${pct}% от baseline)`);
  console.log();
} else {
  console.log(`ШАГ 2. Зональный множитель для "${fromZoneLabel}" = ×1.00 → не сдвигает прогноз.`);
  console.log();
}
console.log(`ОЦЕНКА Я.ТАКСИ (для расчёта потолка RWB):`);
console.log(`  Эконом: ${finalEcon} br  (${econMin} × ⚡${finalSurge.toFixed(2)})`);
console.log(`  Cmf   : ${finalCmf} br  (${CMF_MIN} × ⚡${finalSurge.toFixed(2)})`);
console.log();
console.log(`Статус Я.-модели: MAPE intra-Минск = ${loo.overall.mape}% (n=${loo.overall.n}, ±10% попаданий = ${loo.overall.within10pct}/${loo.overall.n}).`);
console.log();

// ============================================================================
// БЛОК RWB · классическая сетка (подача + минимум + perKm + perMin) + потолок
// ============================================================================
// Дублируем константы из src/lib/zones.ts → RWB_TARIFF_GRID.
// Если меняете там — синхронизируйте здесь.
const RWB_DEMPING_VS_YA = 0.10;
const RWB_FLOOR = 7.00;
const RWB_OWN_SURGE_THRESHOLD = 1.5; // вариант 3 — гибрид
const RWB_OWN_SURGE_CAP = 3.0;       // потолок surge на нашу сетку (по аналогии с Я.Такси ×2.5–3.0)
const RWB_TARIFF_GRID = {
  comfort: {
    weekday: {
      day:     { pickup: 0, minimum: 7, perKm: 1.10, perMin: 0.25 },
      evening: { pickup: 0, minimum: 7, perKm: 1.25, perMin: 0.30 },
      night:   { pickup: 0, minimum: 7, perKm: 0.80, perMin: 0.20 },
    },
    weekend: {
      day:     { pickup: 0, minimum: 7, perKm: 1.00, perMin: 0.25 },
      evening: { pickup: 0, minimum: 7, perKm: 1.30, perMin: 0.30 },
      night:   { pickup: 0, minimum: 7, perKm: 0.80, perMin: 0.20 },
    },
  },
  econom: {
    weekday: {
      day:     { pickup: 0, minimum: 7, perKm: 1.05, perMin: 0.24 },
      evening: { pickup: 0, minimum: 7, perKm: 1.20, perMin: 0.29 },
      night:   { pickup: 0, minimum: 7, perKm: 0.76, perMin: 0.19 },
    },
    weekend: {
      day:     { pickup: 0, minimum: 7, perKm: 0.95, perMin: 0.24 },
      evening: { pickup: 0, minimum: 7, perKm: 1.24, perMin: 0.29 },
      night:   { pickup: 0, minimum: 7, perKm: 0.76, perMin: 0.19 },
    },
  },
};

function rwbTariffSlot(dayKey, hour) {
  const kind = dayKey === "weekday" ? "weekday" : "weekend";
  let slot;
  if (hour >= 6 && hour < 17)       slot = "day";
  else if (hour >= 17 && hour < 22) slot = "evening";
  else                              slot = "night";
  return { kind, slot };
}

function rwbCalc(cls, km, min, hour, dayKey, yaPrice, surge = 1.0) {
  const { kind, slot } = rwbTariffSlot(dayKey, hour);
  const t = RWB_TARIFF_GRID[cls][kind][slot];
  const kmCost = +(t.perKm * km).toFixed(2);
  const minCost = +(t.perMin * min).toFixed(2);
  const rawSum = +(t.pickup + kmCost + minCost).toFixed(2);
  const baseSum = Math.max(t.minimum, rawSum);
  const surgeApplied = surge >= RWB_OWN_SURGE_THRESHOLD
    ? Math.min(surge, RWB_OWN_SURGE_CAP)
    : 1.0;
  const ownPrice = +(baseSum * surgeApplied).toFixed(2);
  const ceiling = +(yaPrice * (1 - RWB_DEMPING_VS_YA)).toFixed(2);
  const preFloor = Math.min(ownPrice, ceiling);
  const final = +Math.max(RWB_FLOOR, preFloor).toFixed(2);
  let source;
  if (final === RWB_FLOOR && preFloor < RWB_FLOOR) source = "floor";
  else if (ownPrice <= ceiling) source = "own";
  else source = "ceiling";
  const savings = yaPrice > 0 ? +((1 - final / yaPrice) * 100).toFixed(1) : 0;
  return { kind, slot, t, kmCost, minCost, rawSum, ownPrice, ceiling, preFloor, final, source, savings, surgeApplied };
}

const rE = rwbCalc("econom",  km, min, hour, dayKey, finalEcon, finalSurge);
const rC = rwbCalc("comfort", km, min, hour, dayKey, finalCmf,  finalSurge);

console.log("=".repeat(72));
console.log(`ЦЕНА RWB TAXI · классическая сетка + потолок −${(RWB_DEMPING_VS_YA*100).toFixed(0)}% от Я.`);
console.log("=".repeat(72));
console.log();
console.log(`Шаг A — наша своя цена (тариф «${rC.kind}-${rC.slot}»):`);
console.log(`  подача ${rC.t.pickup} + perKm ${rC.t.perKm} × ${km.toFixed(2)} км + perMin ${rC.t.perMin} × ${min.toFixed(0)} мин`);
console.log(`  = ${rC.t.pickup} + ${rC.kmCost} + ${rC.minCost} = ${rC.rawSum} br`);
if (rC.rawSum < rC.t.minimum) {
  console.log(`  меньше минимума ${rC.t.minimum} br → берём минимум`);
}
console.log(`  Cmf_own = ${rC.ownPrice} br`);
console.log();
console.log(`Шаг B — потолок (Я. × ${(1 - RWB_DEMPING_VS_YA).toFixed(2)}):`);
console.log(`  Cmf_потолок = ${finalCmf} × 0.90 = ${rC.ceiling} br`);
console.log();
console.log(`Шаг C — финал = max(пол ${RWB_FLOOR}, min(own, потолок)):`);
function arrow(r) {
  if (r.source === "own")     return "✓ своя сетка";
  if (r.source === "ceiling") return "↓ демпинг до потолка";
  return `↑ поднято до пола ${RWB_FLOOR.toFixed(2)} br (preFloor было ${r.preFloor.toFixed(2)} br)`;
}
const arrowC = arrow(rC);
const arrowE = arrow(rE);
console.log(`  Эконом: ${rE.final} br  (${arrowE}, на ${rE.savings}% дешевле Я.)`);
console.log(`  Cmf   : ${rC.final} br  (${arrowC}, на ${rC.savings}% дешевле Я.)  ← основной`);
console.log();
console.log(`СРАВНЕНИЕ:    Я.Такси Cmf = ${finalCmf} br  →  RWB Cmf = ${rC.final} br  (Δ = ${(finalCmf - rC.final).toFixed(2)} br, −${rC.savings}%)`);
