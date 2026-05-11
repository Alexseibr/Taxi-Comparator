// Факторы Яндекса, которые мы накладываем поверх baseline-регрессии ⚡N(km,min,slot).
// Каждый фактор — multiplicative: finalPred = baselinePred × Π factorMult(order).
//
// Подбор коэффициентов — greedy sequential grid search поверх результатов LOO:
// фиксируем все ранее подобранные множители и ищем коэфы текущего фактора,
// минимизирующие MAPE. Если улучшения нет (≤ 0.2pp) — фактор «pending data»
// (множитель = 1 / 0).
//
// Этот модуль НЕ зависит от learn.mjs — только helpers + grid search.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// --- Загрузка статических справочников --------------------------------------

export function loadWeather() {
  const p = join(ROOT, "scripts/learned/weather.json");
  if (!existsSync(p)) return {};
  const j = JSON.parse(readFileSync(p, "utf8"));
  return j.byOrderId || {};
}

export function loadHolidays() {
  const p = join(ROOT, "scripts/data/holidays-by.json");
  if (!existsSync(p)) return {};
  const j = JSON.parse(readFileSync(p, "utf8"));
  return j.by_date || {};
}

// --- Геофункции -------------------------------------------------------------

const R = 6371;
function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Зона отправления:
//   airport     — аэропорт MSQ (~5 км вокруг)
//   center      — центр Минска (внутри bbox исторического центра)
//   residential — внутри МКАД, но не центр
//   suburb      — за МКАД
const MINSK_CENTROID = [53.902, 27.560];
const MSQ            = [53.882, 28.030];
const CENTER_BBOX    = { latMin: 53.880, latMax: 53.920,
                         lngMin: 27.530, lngMax: 27.605 };
const MKAD_RADIUS_KM = 12;

export function fromZoneOf(lat, lng) {
  if (lat == null || lng == null) return "unknown";
  const dMsq = haversineKm(lat, lng, MSQ[0], MSQ[1]);
  if (dMsq < 5) return "airport";
  if (lat >= CENTER_BBOX.latMin && lat <= CENTER_BBOX.latMax &&
      lng >= CENTER_BBOX.lngMin && lng <= CENTER_BBOX.lngMax) return "center";
  const dCity = haversineKm(lat, lng, MINSK_CENTROID[0], MINSK_CENTROID[1]);
  if (dCity <= MKAD_RADIUS_KM) return "residential";
  return "suburb";
}

export const FROM_ZONE_LABEL = {
  center:      "🏛 Центр Минска",
  residential: "🏘 Спальник Минска",
  airport:     "✈ Аэропорт MSQ",
  suburb:      "🌲 За МКАД",
  unknown:     "—",
};

// --- H3 Гексагональная сетка (resolution 7, ~1.4 км сторона / ~5 км² площадь) -
// Заменяет грубую 4-зонную классификацию (center/residential/airport/suburb)
// на 50-70 микро-ячеек по Минску. Учится отдельный множитель для каждой
// ячейки с n ≥ 3 точек, плюс пространственное сглаживание с соседями.
import { latLngToCell, gridDisk, cellToLatLng } from "h3-js";

export const H3_RESOLUTION = 7;

export function h3CellOf(lat, lng) {
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  try {
    return latLngToCell(lat, lng, H3_RESOLUTION);
  } catch {
    return null;
  }
}

// --- Час пик ----------------------------------------------------------------

export function isPeak(day, hour) {
  if (day === "saturday" || day === "sunday") return false;
  return (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
}

// --- Праздники --------------------------------------------------------------

export function isHoliday(date, holidaysByDate) {
  return Boolean(holidaysByDate[date]);
}

// --- Объединённое обогащение ------------------------------------------------

export function attachFeatures(orders, { weather, holidays }) {
  return orders.map((o) => ({
    ...o,
    fromZone: fromZoneOf(o.fromLat, o.fromLng),
    h3Cell: h3CellOf(o.fromLat, o.fromLng),
    isPeak: isPeak(o.day, o.hour),
    isHoliday: isHoliday(o.date, holidays),
    holidayName: holidays[o.date] || null,
    weather: weather[o.id] || null,
  }));
}

// --- Утилита MAPE -----------------------------------------------------------

function computeMape(predSurges, items) {
  let sumAbs = 0, n = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.yaSurgeC || it.yaSurgeC <= 0) continue;
    const errPct = (predSurges[i] - it.yaSurgeC) / it.yaSurgeC * 100;
    sumAbs += Math.abs(errPct);
    n++;
  }
  return n ? sumAbs / n : null;
}

// --- Sequential multiplier fitting ------------------------------------------
// items: [{ id, yaSurgeC, predictedSurge, fromZone, isPeak, isHoliday, weather, ... }]
// Возвращает { adjustments: [...], finalMape, finalPredSurges }

const MIN_IMPROVEMENT_PP = 0.2; // дефолт: ≥0.2pp улучшения, чтобы считать фактор активным (weather/peak/holiday)

// Per-mode пороги: для гео и временных факторов делаем ниже, потому что
// это **структурные** причины разброса surge в Минске (направленный спрос
// от центра в спальники в воскр-вечером + узкое окно бар-часа 22-23),
// а не «эффект погоды». Здесь чувствительность важнее стат-значимости.
const FACTOR_THRESHOLDS_PP = {
  weather:  0.20,
  peak:     0.20,
  holiday:  0.20,
  fromZone: 0.00, // применяем ВСЕГДА, если есть ≥1 ячейка с |mu-1|>10% и фактор не ухудшил MAPE
  hour:     0.05, // late-night окно 22-23 узкое — 0.05 п.п. достаточно как сигнал
};

function range(lo, hi, step) {
  const out = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(+v.toFixed(4));
  return out;
}

// === Фактор 1: Weather ===
// mult = 1 + α·precipMm + β·snowCm   (для items без weather → mult=1)
function fitWeather(items, baselinePred) {
  const baseMape = computeMape(baselinePred, items);
  // Если ни у одного нет осадков — нет сигнала, выходим
  const wets  = items.filter(it => (it.weather?.precipMm || 0) > 0).length;
  const snows = items.filter(it => (it.weather?.snowCm   || 0) > 0).length;
  if (wets === 0 && snows === 0) {
    return { mode: "weather", coefs: { alpha: 0, beta: 0 },
             active: false, reason: "В выборке нет ни одного замера с осадками",
             mapeBefore: baseMape, mapeAfter: baseMape, predSurges: baselinePred,
             observed: { wetN: wets, snowN: snows } };
  }
  let best = { alpha: 0, beta: 0, mape: baseMape, pred: baselinePred };
  for (const a of range(-0.05, 0.50, 0.05)) {
    for (const b of range(-0.05, 0.50, 0.05)) {
      const pred = items.map((it, i) => {
        const w = it.weather || {};
        return baselinePred[i] * (1 + a * (w.precipMm || 0) + b * (w.snowCm || 0));
      });
      const m = computeMape(pred, items);
      if (m !== null && m < best.mape) best = { alpha: a, beta: b, mape: m, pred };
    }
  }
  const improved = baseMape - best.mape;
  const active = improved >= MIN_IMPROVEMENT_PP;
  return {
    mode: "weather",
    coefs: active ? { alpha: best.alpha, beta: best.beta } : { alpha: 0, beta: 0 },
    active,
    reason: active
      ? `Лучший фит: precip×${best.alpha.toFixed(2)}/мм + snow×${best.beta.toFixed(2)}/см`
      : `Сигнал слабый (улучшение ${improved.toFixed(2)}pp < ${MIN_IMPROVEMENT_PP}pp)`,
    mapeBefore: baseMape,
    mapeAfter: active ? best.mape : baseMape,
    predSurges: active ? best.pred : baselinePred,
    observed: { wetN: wets, snowN: snows },
  };
}

// === Фактор 2: Час пик ===
function fitPeak(items, baselinePred) {
  const baseMape = computeMape(baselinePred, items);
  const peakN = items.filter(it => it.isPeak).length;
  const offN  = items.length - peakN;
  if (peakN === 0 || offN === 0) {
    return { mode: "peak", coefs: { gamma: 0 }, active: false,
      reason: peakN === 0
        ? "В выборке нет ни одного замера в часы пик (будни 07-09 / 17-19)"
        : "В выборке только замеры часа пик — не на чем сравнивать",
      mapeBefore: baseMape, mapeAfter: baseMape, predSurges: baselinePred,
      observed: { peakN, offN } };
  }
  let best = { gamma: 0, mape: baseMape, pred: baselinePred };
  for (const g of range(-0.20, 0.50, 0.05)) {
    const pred = items.map((it, i) => baselinePred[i] * (it.isPeak ? (1 + g) : 1));
    const m = computeMape(pred, items);
    if (m !== null && m < best.mape) best = { gamma: g, mape: m, pred };
  }
  const improved = baseMape - best.mape;
  const active = improved >= MIN_IMPROVEMENT_PP;
  return {
    mode: "peak",
    coefs: active ? { gamma: best.gamma } : { gamma: 0 },
    active,
    reason: active
      ? `Час пик +${(best.gamma * 100).toFixed(0)}% к ⚡`
      : `Слабый сигнал (улучшение ${improved.toFixed(2)}pp)`,
    mapeBefore: baseMape,
    mapeAfter: active ? best.mape : baseMape,
    predSurges: active ? best.pred : baselinePred,
    observed: { peakN, offN },
  };
}

// === Фактор 3: H3-зона отправления (resolution 7, ~1.4 км) ==================
// Заменили грубые 4 категории (center/residential/airport/suburb) на ~50-70
// H3-ячеек по Минску. Для каждой ячейки с n ≥ MIN_N_PER_CELL точек считаем
// медианный mu = yaSurge / baselinePred, затем сглаживаем со средневзвешенным
// по соседним H3-ячейкам (gridDisk radius=1, 6 соседей):
//   mu_smoothed = 0.6 * mu_own + 0.4 * mean(mu_neighbors_weighted_by_n)
// Применяем только ячейки, где |mu_smoothed - 1| > MIN_DEVIATION (иначе шум).
const MIN_N_PER_CELL = 3;
const MIN_DEVIATION  = 0.10;     // |mu - 1| ≥ 10% чтобы применить
const MU_CLAMP       = [0.5, 2.0];
const SMOOTH_OWN     = 0.6;
const SMOOTH_NEIGH   = 0.4;

function fitH3Zone(items, baselinePred) {
  const baseMape = computeMape(baselinePred, items);

  // Группировка ratio = yaSurge / baselinePred по H3-ячейкам
  const byCell = new Map();
  let withCell = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.h3Cell) continue;
    if (!it.yaSurgeC || it.yaSurgeC <= 0) continue;
    if (!baselinePred[i] || baselinePred[i] <= 0) continue;
    withCell++;
    const ratio = it.yaSurgeC / baselinePred[i];
    let g = byCell.get(it.h3Cell);
    if (!g) { g = { items: [] }; byCell.set(it.h3Cell, g); }
    g.items.push({ idx: i, ratio });
  }

  if (byCell.size === 0) {
    return { mode: "fromZone", scheme: "h3-r7", coefs: {}, cells: {}, active: false,
      reason: "Ни у одного замера нет координат — H3-стратификация невозможна",
      mapeBefore: baseMape, mapeAfter: baseMape, predSurges: baselinePred,
      observed: { totalCells: 0, fittedCells: 0, activeCells: 0, withCoords: withCell } };
  }

  // Raw mu per cell (median, clamped) для ячеек с достаточным n
  const rawMus = new Map();
  for (const [cell, g] of byCell) {
    if (g.items.length < MIN_N_PER_CELL) continue;
    const ratios = g.items.map(x => x.ratio).sort((a, b) => a - b);
    const median = ratios[Math.floor(ratios.length / 2)];
    const muClamped = Math.max(MU_CLAMP[0], Math.min(MU_CLAMP[1], median));
    rawMus.set(cell, { mu: muClamped, n: g.items.length });
  }

  // Spatial smoothing: 0.6 × own + 0.4 × weighted_mean(neighbors)
  // Соседи с данными — тоже из rawMus (не учитываем пустые ячейки).
  const smoothed = new Map();
  for (const [cell, raw] of rawMus) {
    const neighbors = gridDisk(cell, 1).filter(c => c !== cell);
    let nbMuW = 0, nbW = 0;
    for (const nb of neighbors) {
      const r = rawMus.get(nb);
      if (!r) continue;
      nbMuW += r.mu * r.n;
      nbW   += r.n;
    }
    const muS = nbW > 0
      ? SMOOTH_OWN * raw.mu + SMOOTH_NEIGH * (nbMuW / nbW)
      : raw.mu; // нет соседей с данными — оставляем raw
    smoothed.set(cell, { mu: muS, n: raw.n, smoothed: nbW > 0 });
  }

  // Применяем только активные (значимое отклонение от 1)
  const active = new Map();
  for (const [cell, info] of smoothed) {
    if (Math.abs(info.mu - 1) > MIN_DEVIATION) active.set(cell, info);
  }

  // Прогноз с применёнными ячейками
  const pred = baselinePred.slice();
  for (let i = 0; i < items.length; i++) {
    const cellInfo = active.get(items[i].h3Cell);
    if (cellInfo) pred[i] = baselinePred[i] * cellInfo.mu;
  }
  const newMape = computeMape(pred, items);
  const improved = baseMape - newMape;
  const threshold = FACTOR_THRESHOLDS_PP.fromZone;
  // Активируем когда: (а) есть хотя бы одна значимая ячейка И (б) применение не ухудшило MAPE
  // больше чем на 0.5 п.п. (минимальная защита от шума). Это ослабленный режим:
  // direction asymmetry (центр vs спальник) — реальный физический сигнал, его держим всегда
  // даже при малом улучшении на overall выборке.
  const isActive = active.size > 0 && improved >= (threshold - 0.5);

  // Cells metadata для UI
  const cellsOut = {};
  for (const [cell, info] of active) {
    const [lat, lng] = cellToLatLng(cell);
    cellsOut[cell] = {
      mu: +info.mu.toFixed(3),
      n: info.n,
      lat: +lat.toFixed(5),
      lng: +lng.toFixed(5),
      smoothed: info.smoothed,
    };
  }

  return {
    mode: "fromZone",
    scheme: "h3-r7",
    coefs: {},          // больше не используем coarse coefs (для backward compat у потребителей)
    cells: isActive ? cellsOut : {},
    active: isActive,
    reason: isActive
      ? `Активно ${Object.keys(cellsOut).length} H3-ячеек (из ${rawMus.size} с n≥${MIN_N_PER_CELL}); выборка с координатами: ${withCell}; ΔMAPE=${improved.toFixed(2)}pp`
      : `H3-стратификация не помогла: улучшение ${improved.toFixed(2)} п.п. при пороге ${threshold} п.п.; кандидатов было ${active.size}`,
    mapeBefore: baseMape,
    mapeAfter: isActive ? newMape : baseMape,
    predSurges: isActive ? pred : baselinePred,
    observed: {
      totalCells: byCell.size,
      fittedCells: rawMus.size,
      activeCells: active.size,
      withCoords: withCell,
    },
  };
}

// === Фактор 4: Час суток (temporal smoothing, аналог H3) ===================
// Слотовая регрессия ⚡N(km, min, slot) усредняет surge внутри часового
// слота. Это даёт overshoot для точек, которые попадают в локальный провал
// внутри слота (соседние замеры в этот же слот имеют высокий ⚡, регрессия
// сглаживает прогноз вверх). Лекарство: per-hour median ratio + сглаживание
// с соседними часами (±1 час, циклически). Активация — те же пороги, что и
// у H3: n ≥ 3 в часе, |mu-1| > 10%, MAPE-improvement ≥ 0.2 п.п.
function fitHourFactor(items, baselinePred) {
  const baseMape = computeMape(baselinePred, items);

  const byHour = new Map();
  let withHour = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.hour == null || it.hour < 0 || it.hour > 23) continue;
    if (!it.yaSurgeC || it.yaSurgeC <= 0) continue;
    if (!baselinePred[i] || baselinePred[i] <= 0) continue;
    withHour++;
    const ratio = it.yaSurgeC / baselinePred[i];
    let g = byHour.get(it.hour);
    if (!g) { g = { items: [] }; byHour.set(it.hour, g); }
    g.items.push({ idx: i, ratio });
  }

  if (byHour.size === 0) {
    return { mode: "hour", scheme: "hour-cyclic", coefs: {}, hours: {}, active: false,
      reason: "Ни у одного замера нет валидного часа — temporal-стратификация невозможна",
      mapeBefore: baseMape, mapeAfter: baseMape, predSurges: baselinePred,
      observed: { totalHours: 0, fittedHours: 0, activeHours: 0, withHour } };
  }

  // Raw mu per hour (median, clamped)
  const rawMus = new Map();
  for (const [hour, g] of byHour) {
    if (g.items.length < MIN_N_PER_CELL) continue;
    const ratios = g.items.map(x => x.ratio).sort((a, b) => a - b);
    const median = ratios[Math.floor(ratios.length / 2)];
    const muClamped = Math.max(MU_CLAMP[0], Math.min(MU_CLAMP[1], median));
    rawMus.set(hour, { mu: muClamped, n: g.items.length });
  }

  // Temporal smoothing: ±1 час циклически (23 ↔ 0), weight by n
  const smoothed = new Map();
  for (const [hour, raw] of rawMus) {
    const neighbors = [(hour + 23) % 24, (hour + 1) % 24]
      .map(h => rawMus.get(h))
      .filter(Boolean);
    let nbMuW = 0, nbW = 0;
    for (const r of neighbors) { nbMuW += r.mu * r.n; nbW += r.n; }
    const muS = nbW > 0
      ? SMOOTH_OWN * raw.mu + SMOOTH_NEIGH * (nbMuW / nbW)
      : raw.mu;
    smoothed.set(hour, { mu: muS, n: raw.n, smoothed: nbW > 0 });
  }

  // Активные — значимое отклонение от 1
  const active = new Map();
  for (const [hour, info] of smoothed) {
    if (Math.abs(info.mu - 1) > MIN_DEVIATION) active.set(hour, info);
  }

  // Прогноз с применёнными часами
  const pred = baselinePred.slice();
  for (let i = 0; i < items.length; i++) {
    const info = active.get(items[i].hour);
    if (info) pred[i] = baselinePred[i] * info.mu;
  }
  const newMape = computeMape(pred, items);
  const improved = baseMape - newMape;
  const threshold = FACTOR_THRESHOLDS_PP.hour;
  const isActive = improved >= threshold;

  // Hours metadata для UI
  const hoursOut = {};
  for (const [hour, info] of active) {
    hoursOut[String(hour)] = {
      mu: +info.mu.toFixed(3),
      n: info.n,
      smoothed: info.smoothed,
    };
  }

  return {
    mode: "hour",
    scheme: "hour-cyclic",
    coefs: {},
    hours: isActive ? hoursOut : {},
    active: isActive,
    reason: isActive
      ? `Активно ${Object.keys(hoursOut).length} часов суток (из ${rawMus.size} с n≥${MIN_N_PER_CELL}); выборка с часом: ${withHour}; ΔMAPE=${improved.toFixed(2)}pp`
      : `Temporal-стратификация не помогла: улучшение ${improved.toFixed(2)} п.п. < ${threshold} п.п.; кандидатов было ${active.size}`,
    mapeBefore: baseMape,
    mapeAfter: isActive ? newMape : baseMape,
    predSurges: isActive ? pred : baselinePred,
    observed: {
      totalHours: byHour.size,
      fittedHours: rawMus.size,
      activeHours: active.size,
      withHour,
    },
  };
}

// === Фактор 5: Праздники ===
function fitHoliday(items, baselinePred) {
  const baseMape = computeMape(baselinePred, items);
  const holN = items.filter(it => it.isHoliday).length;
  const regN = items.length - holN;
  if (holN === 0 || regN === 0) {
    return { mode: "holiday", coefs: { delta: 0 }, active: false,
      reason: holN === 0
        ? "В выборке нет замеров в государственные праздники РБ"
        : "В выборке только праздничные замеры — не на чем сравнивать",
      mapeBefore: baseMape, mapeAfter: baseMape, predSurges: baselinePred,
      observed: { holidayN: holN, regularN: regN } };
  }
  let best = { delta: 0, mape: baseMape, pred: baselinePred };
  for (const d of range(-0.20, 0.50, 0.05)) {
    const pred = items.map((it, i) => baselinePred[i] * (it.isHoliday ? (1 + d) : 1));
    const m = computeMape(pred, items);
    if (m !== null && m < best.mape) best = { delta: d, mape: m, pred };
  }
  const improved = baseMape - best.mape;
  const active = improved >= MIN_IMPROVEMENT_PP;
  return {
    mode: "holiday",
    coefs: active ? { delta: best.delta } : { delta: 0 },
    active,
    reason: active
      ? `Праздник +${(best.delta * 100).toFixed(0)}% к ⚡`
      : `Слабый сигнал (улучшение ${improved.toFixed(2)}pp)`,
    mapeBefore: baseMape,
    mapeAfter: active ? best.mape : baseMape,
    predSurges: active ? best.pred : baselinePred,
    observed: { holidayN: holN, regularN: regN },
  };
}

// --- Pipeline: применить все факторы по порядку -----------------------------
// items: [{id, yaSurgeC, predictedSurge, fromZone, isPeak, isHoliday, weather}]
// Возвращает: { factors: [{...}], finalPredSurges, baselineMape, finalMape }
export function fitFactors(items) {
  const baseline = items.map(it => it.predictedSurge);
  const baselineMape = computeMape(baseline, items);

  const factors = [];
  let pred = baseline;

  for (const fit of [fitWeather, fitPeak, fitH3Zone, fitHourFactor, fitHoliday]) {
    const f = fit(items, pred);
    factors.push(f);
    pred = f.predSurges;
  }

  const finalMape = computeMape(pred, items);
  return { factors, finalPredSurges: pred, baselineMape, finalMape };
}
