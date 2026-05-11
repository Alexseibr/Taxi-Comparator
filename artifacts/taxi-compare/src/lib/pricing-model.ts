// Data-driven предсказатель цены Yandex.
// Модель обучена скриптом scripts/train-from-calibs-v3.mjs из 1300+ калибровок.
//
// v3 — двухслойная формула: тариф × surge_multiplier
//
//   Слой A — тариф (фиксированный для города/класса):
//     tariff_E(km, min) = base + per_km·km + per_min·min
//     tariff_C(km, min) = base + per_km·km + per_min·min
//     Обучается на «спокойных» yellow-калибровках (weekday, day-hours).
//
//   Слой B — surge_multiplier (зависит от условий):
//     surge(features) = w0 + w1·is_red + w2·is_yellow + w3·is_short +
//                       w4·is_morn + w5·is_eve + w6·is_night +
//                       w7·is_weekend + w8·dow_sin + w9·dow_cos +
//                       w10·eta_excess
//
//   Финал: predict = max(floor, tariff(km, min) · surge(features))
//
// Что нового в v3 vs v2:
//   • tripMin — главный сигнал времени (раньше игнорировался, использовался
//     только etaMin). При отсутствии — fallback на etaMin.
//   • red/yellow — мультипликаторы (сёрдж в %), а не аддитивные слагаемые
//   • day_of_week (выходные ≠ будни) — новый сигнал
//   • двухслойная композиция → меньше переобучения, лучше extrapolation
//
// Backward-compatible: если в pricing-model.json структура v2 (поле `features`,
// `MODEL.E.weights`) — автоматически используется старая формула.

import modelJson from "../data/pricing-model.json";

// ─── Типы ────────────────────────────────────────────────────────────────
export type ModelMetrics = {
  mae: number;
  mape: number;
  hit10: number;
  hit25: number;
  mapeLoo: number | null;
  hit10Loo: number | null;
  hit25Loo: number | null;
};

type TariffCoefs = { base: number; per_km: number; per_min: number; n: number };

export type PricingModelV3 = {
  version: 3;
  trainedAt: string;
  trainedFrom: string;
  nTotal: number;
  surgeFeatures: string[];
  floors: { E: number; C: number };
  tariff: { E: TariffCoefs; C: TariffCoefs };
  filterStats?: Record<string, number>;
  E: { surgeWeights: number[]; n: number; metrics: ModelMetrics };
  C: { surgeWeights: number[]; n: number; metrics: ModelMetrics };
};

export type PricingModelV2 = {
  version: 2;
  trainedAt: string;
  trainedFrom: string;
  nTotal: number;
  features: string[];
  floors?: { E: number; C: number };
  E: { weights: number[]; n: number; metrics: ModelMetrics };
  C: { weights: number[]; n: number; metrics: ModelMetrics };
};

export type PricingModel = PricingModelV3 | PricingModelV2;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RAW: any = modelJson;
export const MODEL = RAW as PricingModel;

const IS_V3 = MODEL.version === 3 && "tariff" in RAW;
const FLOOR_E = MODEL.floors?.E ?? (IS_V3 ? 5.0 : 2.5);
const FLOOR_C = MODEL.floors?.C ?? (IS_V3 ? 6.0 : 3.5);

export type DemandColor = "red" | "yellow" | "green" | null | undefined;

/**
 * eta_excess = превышение времени поездки над «идеальным» (24 км/ч).
 * 0 если сигнала нет или поездка быстрая. Значения >0 → пробка/час пик.
 * Отсекаем «physically impossible» (>60 км/ч в Минске → баг распознавания).
 */
export function etaExcessFromMin(
  km: number,
  min: number | null | undefined,
): number {
  if (!min || min <= 0 || km <= 0) return 0;
  if ((km / min) * 60 > 60) return 0;
  const idealMin = (km * 60) / 24;
  if (idealMin <= 0) return 0;
  return Math.max(0, min / idealMin - 1);
}

export type PredictOpts = {
  /** Дождь во время заказа (1 = да, 0 = нет). По умолчанию 0. (Только v2). */
  isRain?: 0 | 1;
  /**
   * Фактическое время поездки со скрина (минут). Главный сигнал v3 модели.
   * Если не передан — fallback на etaMin (4-й позиционный аргумент).
   */
  tripMin?: number | null;
  /** День недели (0=Sun…6=Sat). По умолчанию — сегодняшний день в браузере. */
  dow?: number;
};

// ─── v3 формула ──────────────────────────────────────────────────────────
function surgeFeatsV3(
  km: number,
  hour: number,
  demand: DemandColor,
  etaExcess: number,
  dow: number,
): number[] {
  const dowAng = (2 * Math.PI * dow) / 7;
  return [
    1,
    demand === "red" ? 1 : 0,
    demand === "yellow" ? 1 : 0,
    km < 1.5 ? 1 : 0,
    hour >= 7 && hour <= 9 ? 1 : 0,
    hour >= 15 && hour <= 19 ? 1 : 0,
    hour >= 22 || hour <= 5 ? 1 : 0,
    dow === 0 || dow === 6 ? 1 : 0,
    Math.sin(dowAng), Math.cos(dowAng),
    etaExcess,
  ];
}

function predictV3(
  isE: boolean,
  km: number,
  hour: number,
  demand: DemandColor,
  etaMin: number | null | undefined,
  opts: PredictOpts | undefined,
): number {
  const m = MODEL as PricingModelV3;
  const minutes = opts?.tripMin ?? etaMin ?? null;
  const eta = etaExcessFromMin(km, minutes);
  const dow = opts?.dow ?? new Date().getDay();
  const t = isE ? m.tariff.E : m.tariff.C;
  const floor = isE ? FLOOR_E : FLOOR_C;
  const tariff = Math.max(
    floor,
    t.base + t.per_km * km + t.per_min * (minutes ?? (km * 60) / 24),
  );
  const w = isE ? m.E.surgeWeights : m.C.surgeWeights;
  const mult = dot(w, surgeFeatsV3(km, hour, demand, eta, dow));
  return Math.max(floor, tariff * mult);
}

// ─── v2 формула (back-compat) ────────────────────────────────────────────
function featuresV2(
  km: number,
  hour: number,
  demand: DemandColor,
  etaExcess: number,
  isRain: 0 | 1,
): number[] {
  const angle = (2 * Math.PI * hour) / 24;
  return [
    1, km, km < 1.5 ? 1 : 0, Math.max(0, km - 1.5),
    demand === "red" ? 1 : 0, demand === "yellow" ? 1 : 0,
    Math.sin(angle), Math.cos(angle),
    hour >= 7 && hour <= 9 ? 1 : 0,
    hour >= 15 && hour <= 19 ? 1 : 0,
    hour >= 22 || hour <= 5 ? 1 : 0,
    etaExcess, isRain,
  ];
}

function predictV2(
  isE: boolean,
  km: number,
  hour: number,
  demand: DemandColor,
  etaMin: number | null | undefined,
  opts: PredictOpts | undefined,
): number {
  const m = MODEL as PricingModelV2;
  const eta = etaExcessFromMin(km, etaMin ?? null);
  const isRain: 0 | 1 = opts?.isRain ?? 0;
  const f = featuresV2(km, hour, demand, eta, isRain);
  const w = isE ? m.E.weights : m.C.weights;
  const floor = isE ? FLOOR_E : FLOOR_C;
  return Math.max(floor, dot(w, f));
}

function dot(w: number[], f: number[]): number {
  let s = 0;
  const n = Math.min(w.length, f.length);
  for (let i = 0; i < n; i++) s += w[i] * f[i];
  return s;
}

/** Прогноз цены Эконома (BYN). Floor: 5.0 BYN (минималка Yandex). */
export function predictE(
  km: number,
  hour: number,
  demand: DemandColor,
  etaMin?: number | null,
  opts?: PredictOpts,
): number {
  return IS_V3
    ? predictV3(true, km, hour, demand, etaMin, opts)
    : predictV2(true, km, hour, demand, etaMin, opts);
}

/** Прогноз цены Комфорта (BYN). Floor: 6.0 BYN. */
export function predictC(
  km: number,
  hour: number,
  demand: DemandColor,
  etaMin?: number | null,
  opts?: PredictOpts,
): number {
  return IS_V3
    ? predictV3(false, km, hour, demand, etaMin, opts)
    : predictV2(false, km, hour, demand, etaMin, opts);
}

// ─── ML CatBoost+H3 диапазон цены (P10/P50/P90) ──────────────────────────
// Sprint 3 (2026-05-02): серверный CatBoost+H3+MultiQuantile через
// /api/ml/predict-price. Даёт точный med (MAPE 18% E / 17% C) + интервал
// неопределённости. Sync predictE/predictC сохранены как fallback и для
// admin-таблицы (1300 строк × HTTP — не вариант).

const ML_PRICE_URL = "/api/ml/predict-price";
const ML_TIMEOUT_MS = 3000;

export type PriceQuantile = {
  /** P10 — нижняя граница (дешевле в ~10% случаев). */
  low: number;
  /** P50 — медианный прогноз. */
  med: number;
  /** P90 — верхняя граница (дороже в ~10% случаев). */
  high: number;
};

export type PriceRangePrediction = {
  E: PriceQuantile;
  C: PriceQuantile;
  km: number;
  minutesUsed: number;
  h3Dist: number;
  modelVersion: string;
};

export type PriceRangeArgs = {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  /** 0..23, локальный час Минска. */
  hour: number;
  /** 0=Mon..6=Sun (Python weekday). По умолчанию — сегодня. */
  dow?: number;
  demand?: DemandColor | "unknown";
  /** Фактическое или ETA время поездки в минутах. */
  minutes?: number | null;
  /** Дата заказа YYYY-MM-DD (Sprint 4 T02): для is_holiday/day_of_month/is_payday.
   *  Если не передана — серверные defaults (середина месяца, не праздник). */
  date?: string | null;
  temp?: number | null;
  rainMm?: number | null;
  wind?: number | null;
  humidity?: number | null;
};

/**
 * Запрашивает у сервера диапазон цены P10/P50/P90 для пары точек.
 * Возвращает null при сетевой ошибке/таймауте — вызывающий код должен
 * сделать fallback на синхронные predictE/predictC.
 */
export async function predictPriceRange(
  args: PriceRangeArgs,
  signal?: AbortSignal,
): Promise<PriceRangePrediction | null> {
  // dow: 0=Mon..6=Sun (Python weekday). JS Date.getDay() → 0=Sun..6=Sat.
  // Конвертируем: js → python = (js + 6) % 7.
  const jsDow = new Date().getDay();
  const dow = args.dow ?? (jsDow + 6) % 7;
  const demand = args.demand ?? "unknown";
  const body = {
    from_lat: args.fromLat,
    from_lng: args.fromLng,
    to_lat: args.toLat,
    to_lng: args.toLng,
    hour: ((args.hour % 24) + 24) % 24,
    dow: ((dow % 7) + 7) % 7,
    demand: demand || "unknown",
    minutes: args.minutes ?? null,
    date: args.date ?? null,
    temp: args.temp ?? null,
    rain_mm: args.rainMm ?? null,
    wind: args.wind ?? null,
    humidity: args.humidity ?? null,
  };
  try {
    const ctl = signal ? undefined : new AbortController();
    const timeoutId = ctl
      ? window.setTimeout(() => ctl.abort(), ML_TIMEOUT_MS)
      : 0;
    const r = await fetch(ML_PRICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? ctl?.signal,
    });
    if (timeoutId) window.clearTimeout(timeoutId);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d?.E || !d?.C) return null;
    return {
      E: { low: d.E.low, med: d.E.med, high: d.E.high },
      C: { low: d.C.low, med: d.C.med, high: d.C.high },
      km: d.km,
      minutesUsed: d.minutes_used,
      h3Dist: d.h3_dist,
      modelVersion: d.model_version,
    };
  } catch {
    return null;
  }
}

// ─── Batch вариант для admin-таблицы ────────────────────────────────────
// Sprint 3.1 (2026-05-02): один POST на /api/ml/predict-price/batch вместо
// 1300 отдельных запросов. Сервер режет ошибки построчно (errors-per-row).

const ML_PRICE_BATCH_URL = "/api/ml/predict-price/batch";
const ML_BATCH_TIMEOUT_MS = 15000;

// Sprint 4 T03: история ML-метрик для дашборда в админке.
// Бэкенд: GET /metrics/history?limit=N (см. app.py + nightly-ml-retrain.sh).
const ML_METRICS_HISTORY_URL = "/api/ml/metrics/history";
const ML_ROUTES_ERRORS_URL = "/api/ml/routes/errors";
const ML_ROUTES_COVERAGE_URL = "/api/ml/routes/coverage";
const ML_ORDERS_DISTRIBUTION_URL = "/api/ml/orders/distribution";

export type MetricsHistoryItem = {
  ts: string;
  snapshot: string | null;
  status: string | null;
  n_calibs: number | null;
  n_train_rows: number | null;
  mape_e_old: number | null;
  mape_e_new: number | null;
  mape_e_active: number | null;
  mape_c_old: number | null;
  mape_c_new: number | null;
  mape_c_active: number | null;
  model_version: string | null;
  trained_at: string | null;
};

export type MetricsHistoryResult = {
  items: MetricsHistoryItem[];
  nTotal: number;
};

/**
 * Загружает последние N записей истории retrain-ов для графика на странице ML.
 * Возвращает null при сетевой ошибке/таймауте — фронт показывает плейсхолдер.
 */
export async function fetchMetricsHistory(
  limit = 90,
  signal?: AbortSignal,
): Promise<MetricsHistoryResult | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const url = `${ML_METRICS_HISTORY_URL}?limit=${encodeURIComponent(String(limit))}`;
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return null;
    const j = (await r.json()) as { items: MetricsHistoryItem[]; n_total: number };
    return { items: Array.isArray(j.items) ? j.items : [], nTotal: j.n_total ?? 0 };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
    signal?.removeEventListener("abort", onAbort);
  }
}

// ─── Phase B: статистика умного генератора маршрутов ─────────────────
// Все три endpoint-а собирает скрипт aggregate-route-stats.py (запускается
// nightly и при ручном retrain). Если файлов ещё нет — FastAPI отдаёт
// {available:false}, фронт показывает плейсхолдер.

export type RoutePairStat = {
  n: number;
  nE: number;
  nC: number;
  mapeE: number;
  mapeC: number;
  mapePct: number;     // mapeE * 100, для удобства сортировки в UI
  lastSeenIso: string;
};

export type RouteErrorsResult = {
  available: boolean;
  generatedAt?: string;
  nCalibsTotal?: number;
  nCalibsMatched?: number;
  nPairs?: number;
  pairs?: Record<string, RoutePairStat>;
};

export async function fetchRouteErrors(): Promise<RouteErrorsResult | null> {
  try {
    const r = await fetch(ML_ROUTES_ERRORS_URL, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as RouteErrorsResult;
  } catch { return null; }
}

export type CoverageCell = { hour: number; dow: number; n: number; nRed: number; nYellow: number; nGreen: number; nUnknown: number };
export type CoverageResult = {
  available: boolean;
  generatedAt?: string;
  totals?: { n: number };
  byDemand?: { red: number; yellow: number; green: number; unknown: number };
  byHourDow?: CoverageCell[];
};
export async function fetchRouteCoverage(): Promise<CoverageResult | null> {
  try {
    const r = await fetch(ML_ROUTES_COVERAGE_URL, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as CoverageResult;
  } catch { return null; }
}

export type DistributionResult = {
  available: boolean;
  generatedAt?: string;
  overall?: { short: number; medium: number; long: number; n: number };
  byHour?: Array<{ hour: number; short: number; medium: number; long: number; n: number }>;
};
export async function fetchOrdersDistribution(): Promise<DistributionResult | null> {
  try {
    const r = await fetch(ML_ORDERS_DISTRIBUTION_URL, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as DistributionResult;
  } catch { return null; }
}

export type PriceBatchItem = {
  idx: number;
  ok: boolean;
  error: string | null;
  km: number | null;
  minutesUsed: number | null;
  h3Dist: number | null;
  E: PriceQuantile | null;
  C: PriceQuantile | null;
};

export type PriceBatchResult = {
  modelVersion: string;
  nTotal: number;
  nOk: number;
  nErr: number;
  calibApplied: boolean;
  results: PriceBatchItem[];
};

/**
 * Batch-предсказание для массива маршрутов. Возвращает null при сетевой
 * ошибке/таймауте. Сервер допускает до 2500 строк за один вызов.
 */
export async function predictPriceBatch(
  rows: PriceRangeArgs[],
  signal?: AbortSignal,
): Promise<PriceBatchResult | null> {
  if (rows.length === 0) {
    return {
      modelVersion: "empty",
      nTotal: 0,
      nOk: 0,
      nErr: 0,
      calibApplied: false,
      results: [],
    };
  }
  const jsDow = new Date().getDay();
  const defaultDow = (jsDow + 6) % 7;
  const body = {
    rows: rows.map((args) => ({
      from_lat: args.fromLat,
      from_lng: args.fromLng,
      to_lat: args.toLat,
      to_lng: args.toLng,
      hour: ((args.hour % 24) + 24) % 24,
      dow: (((args.dow ?? defaultDow) % 7) + 7) % 7,
      demand: args.demand ?? "unknown",
      minutes: args.minutes ?? null,
      date: args.date ?? null,
      temp: args.temp ?? null,
      rain_mm: args.rainMm ?? null,
      wind: args.wind ?? null,
      humidity: args.humidity ?? null,
    })),
  };
  try {
    const ctl = signal ? undefined : new AbortController();
    const timeoutId = ctl
      ? window.setTimeout(() => ctl.abort(), ML_BATCH_TIMEOUT_MS)
      : 0;
    const r = await fetch(ML_PRICE_BATCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? ctl?.signal,
    });
    if (timeoutId) window.clearTimeout(timeoutId);
    if (!r.ok) return null;
    const d = await r.json();
    if (!Array.isArray(d?.results)) return null;
    return {
      modelVersion: d.model_version,
      nTotal: d.n_total,
      nOk: d.n_ok,
      nErr: d.n_err,
      calibApplied: !!d.calib_applied,
      results: d.results.map(
        (it: {
          idx: number;
          ok: boolean;
          error: string | null;
          km: number | null;
          minutes_used: number | null;
          h3_dist: number | null;
          E: PriceQuantile | null;
          C: PriceQuantile | null;
        }) => ({
          idx: it.idx,
          ok: it.ok,
          error: it.error,
          km: it.km,
          minutesUsed: it.minutes_used,
          h3Dist: it.h3_dist,
          E: it.E,
          C: it.C,
        }),
      ),
    };
  } catch {
    return null;
  }
}

/** Возвращает дату обучения модели и метрики для отображения в шапке. */
export function modelInfo(): {
  trainedAt: string;
  ageDays: number;
  n: number;
  mapeE: number;
  mapeC: number;
  hit10E: number;
  hit10C: number;
  version: number;
} {
  const trainedAt = new Date(MODEL.trainedAt);
  const ageDays = (Date.now() - trainedAt.getTime()) / (24 * 3600_000);
  return {
    trainedAt: MODEL.trainedAt,
    ageDays,
    n: MODEL.nTotal,
    mapeE: MODEL.E.metrics.mape,
    mapeC: MODEL.C.metrics.mape,
    hit10E: MODEL.E.metrics.hit10,
    hit10C: MODEL.C.metrics.hit10,
    version: MODEL.version,
  };
}
