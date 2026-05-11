// Опрос пробок через несколько провайдеров.
// Приоритет (с 27.04.2026): Google Routes API → TomTom → HERE.
// Google теперь основной — даёт самые точные данные о времени в пробке
// (учитывает исторические паттерны + текущее состояние). TomTom оставлен
// запасным на случай отказа Google (квоты, сетевые ошибки).
//
// Ключи берутся из переменных окружения сборки:
//   VITE_GOOGLE_MAPS_KEY — Google Routes API (10k req/мес бесплатно, дальше платно)
//   VITE_TOMTOM_KEY      — TomTom Traffic Flow (2500 req/day бесплатно)
//   VITE_HERE_KEY        — HERE Traffic Flow v7 (250k req/мес бесплатно)
//
// Если ни один ключ не задан — функции возвращают null и пробочный бамп
// просто не применяется (приложение продолжает работать на якорях +
// наблюдениях + локальной таблице MINSK_TRAFFIC_BY_DAY_HOUR).
//
// Бэкенда нет: запросы идут прямо из браузера. Все три провайдера
// поддерживают CORS. Ключи попадут в JS-бандл и станут публичными —
// ОБЯЗАТЕЛЬНО ограничьте их в дашборде провайдера по HTTP-referrer
// (rwbtaxi.by, *.replit.dev).

import type { RoutePoint } from "./routing";

export type TrafficSample = {
  /** Текущая средняя скорость, км/ч. */
  currentSpeed: number;
  /** Свободная скорость на этом участке, км/ч. */
  freeFlowSpeed: number;
  /** Отношение currentSpeed / freeFlowSpeed (0..1). Чем меньше — тем хуже. */
  ratio: number;
  /** Откуда взяли данные. */
  provider: "google" | "tomtom" | "here";
};

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;
const TOMTOM_KEY = import.meta.env.VITE_TOMTOM_KEY as string | undefined;
const HERE_KEY = import.meta.env.VITE_HERE_KEY as string | undefined;

export function hasTrafficProvider(): boolean {
  return Boolean(GOOGLE_KEY || TOMTOM_KEY || HERE_KEY);
}

export function trafficProviderName(): string | null {
  if (GOOGLE_KEY) return "Google";
  if (TOMTOM_KEY) return "TomTom";
  if (HERE_KEY) return "HERE";
  return null;
}

/**
 * Google Routes API. Делаем короткий маршрут вокруг точки (~400м по широте)
 * и сравниваем `duration` (с трафиком) и `staticDuration` (без). Ratio =
 * staticDuration / duration ∈ (0..1] — чем меньше, тем хуже пробки. Скорости
 * восстанавливаем зная длину сегмента.
 */
async function fetchGoogle(
  point: RoutePoint,
  signal?: AbortSignal,
): Promise<TrafficSample | null> {
  if (!GOOGLE_KEY) return null;
  const [lat, lng] = point;
  // ±200м по широте — короткий сегмент, хватает чтобы Google вернул
  // осмысленные duration/staticDuration без лишней траты квоты.
  const d = 0.0018; // ~200м
  const url = "https://routes.googleapis.com/directions/v2:computeRoutes";
  const body = {
    origin: { location: { latLng: { latitude: lat - d, longitude: lng } } },
    destination: { location: { latLng: { latitude: lat + d, longitude: lng } } },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_KEY,
        "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      routes?: Array<{
        duration?: string;          // "623s"
        staticDuration?: string;    // "486s"
        distanceMeters?: number;
      }>;
    };
    const r = json.routes?.[0];
    if (!r || !r.duration || !r.staticDuration || !r.distanceMeters) return null;
    const dur = parseFloat(r.duration);          // sec, с трафиком
    const dStatic = parseFloat(r.staticDuration); // sec, без трафика
    if (!Number.isFinite(dur) || !Number.isFinite(dStatic) || dur <= 0 || dStatic <= 0) return null;
    const km = r.distanceMeters / 1000;
    const currentSpeed = (km / dur) * 3600;
    const freeFlowSpeed = (km / dStatic) * 3600;
    const ratio = freeFlowSpeed > 0 ? currentSpeed / freeFlowSpeed : 1;
    return {
      currentSpeed,
      freeFlowSpeed,
      ratio: Math.max(0, Math.min(1, ratio)),
      provider: "google",
    };
  } catch {
    return null;
  }
}

async function fetchTomtom(
  point: RoutePoint,
  signal?: AbortSignal,
): Promise<TrafficSample | null> {
  if (!TOMTOM_KEY) return null;
  const [lat, lng] = point;
  // Flow Segment Data: ближайший дорожный сегмент к точке.
  const url =
    `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json` +
    `?point=${lat},${lng}&unit=KMPH&key=${TOMTOM_KEY}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      flowSegmentData?: {
        currentSpeed: number;
        freeFlowSpeed: number;
      };
    };
    const d = json.flowSegmentData;
    if (!d) return null;
    const ratio =
      d.freeFlowSpeed > 0 ? d.currentSpeed / d.freeFlowSpeed : 1;
    return {
      currentSpeed: d.currentSpeed,
      freeFlowSpeed: d.freeFlowSpeed,
      ratio: Math.max(0, Math.min(1, ratio)),
      provider: "tomtom",
    };
  } catch {
    return null;
  }
}

async function fetchHere(
  point: RoutePoint,
  signal?: AbortSignal,
): Promise<TrafficSample | null> {
  if (!HERE_KEY) return null;
  const [lat, lng] = point;
  // HERE Traffic Flow v7 — bbox в радиусе ~150 м.
  const d = 0.0015;
  const bbox = `${lat - d},${lng - d};${lat + d},${lng + d}`;
  const url =
    `https://data.traffic.hereapi.com/v7/flow?in=bbox:${bbox}` +
    `&locationReferencing=shape&apiKey=${HERE_KEY}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      results?: Array<{
        currentFlow?: { speed?: number; freeFlow?: number; jamFactor?: number };
      }>;
    };
    const r = json.results?.[0]?.currentFlow;
    if (!r || r.speed === undefined || r.freeFlow === undefined) return null;
    const ratio = r.freeFlow > 0 ? r.speed / r.freeFlow : 1;
    return {
      currentSpeed: r.speed * 3.6, // HERE отдаёт м/с
      freeFlowSpeed: r.freeFlow * 3.6,
      ratio: Math.max(0, Math.min(1, ratio)),
      provider: "here",
    };
  } catch {
    return null;
  }
}

/**
 * Возвращает пробочный сэмпл, пробуя провайдеров в порядке приоритета.
 * Если основной (Google) не ответил/упал — пробуем TomTom, затем HERE.
 */
export async function fetchTrafficAt(
  point: RoutePoint,
  signal?: AbortSignal,
): Promise<TrafficSample | null> {
  if (GOOGLE_KEY) {
    const g = await fetchGoogle(point, signal);
    if (g) return g;
  }
  if (TOMTOM_KEY) {
    const t = await fetchTomtom(point, signal);
    if (t) return t;
  }
  if (HERE_KEY) {
    const h = await fetchHere(point, signal);
    if (h) return h;
  }
  return null;
}

/**
 * Опрашивает пробки в нескольких точках и возвращает средний коэффициент.
 * `null` — если нет провайдера или все запросы провалились.
 */
export async function fetchAvgTraffic(
  points: RoutePoint[],
  signal?: AbortSignal,
): Promise<TrafficSample | null> {
  if (!hasTrafficProvider()) return null;
  const samples = await Promise.all(
    points.map((p) => fetchTrafficAt(p, signal)),
  );
  const ok = samples.filter((s): s is TrafficSample => s !== null);
  if (ok.length === 0) return null;
  const avgRatio = ok.reduce((a, s) => a + s.ratio, 0) / ok.length;
  const avgCur = ok.reduce((a, s) => a + s.currentSpeed, 0) / ok.length;
  const avgFree = ok.reduce((a, s) => a + s.freeFlowSpeed, 0) / ok.length;
  return {
    currentSpeed: avgCur,
    freeFlowSpeed: avgFree,
    ratio: avgRatio,
    provider: ok[0].provider,
  };
}

/**
 * Превращает коэффициент свободного потока в МУЛЬТИПЛИКАТОР сёрджа.
 *
 * v3 (плоский тариф, perKm=perMin=0): пробки больше нельзя протащить через
 * perMin·adjustedMin (perMin = 0). Поэтому теперь они применяются прямо к
 * сёрджу как отдельный множитель.
 *
 * Калибровка ориентировочная (нет данных в час пик на 26.04.2026):
 *   ratio ≥ 0.95 → ×1.00 (свободно, нет бампа)
 *   ratio = 0.75 → ×1.10 (лёгкие пробки)
 *   ratio = 0.50 → ×1.30 (средние пробки)
 *   ratio = 0.30 → ×1.55 (тяжёлые)
 *   ratio < 0.10 → ×1.80 (катастрофа, потолок)
 *
 * Когда придут будни-замеры в час пик, корреляция surge↔ttMult в
 * scripts/learned/traffic-effect.json уточнит коэффициенты.
 */
export function trafficSurgeMultiplier(ratio: number): number {
  if (ratio >= 0.95) return 1.0;
  if (ratio < 0.10) return 1.8;
  // Линейная интерполяция: ratio=0.95 → 1.0, ratio=0.10 → 1.8
  const m = 1.0 + (0.95 - ratio) * (0.8 / 0.85);
  return Math.min(1.8, Math.max(1.0, +m.toFixed(3)));
}

/**
 * @deprecated в v3. Сохранён для обратной совместимости со старыми импортами.
 * В v3 пробки идут через trafficSurgeMultiplier (мультипликатор сёрджа).
 */
export function trafficSurgeBump(_ratio: number): number {
  return 0;
}

/**
 * Превращает коэффициент свободного потока (ratio = currentSpeed/freeFlowSpeed)
 * в множитель ВРЕМЕНИ поездки. Используется для отображения ETA на карте,
 * а НЕ для расчёта цены (в v3 цена не зависит от времени).
 *
 * Ограничения:
 *  - не меньше 1.0 (быстрее свободного не бывает)
 *  - не больше 3.0 (катастрофические пробки)
 */
export function trafficTimeMultiplier(ratio: number): number {
  if (ratio >= 0.95) return 1.0;
  if (ratio < 0.05) return 3.0;
  return Math.min(3.0, 1 / ratio);
}

// Локальная модель пробок для Минска — таблица типичных коэффициентов
// (multiplier ≥ 1.0). Используется когда нет API-ключа TomTom/HERE.
// Источник: эмпирически по характеру минского трафика, выверено на 7 годах
// личного опыта вождения. Можно уточнять по мере накопления данных.
//
// Логика:
//  - будни 07-10 утром: пик до ×1.7 (отток в центр)
//  - будни 17-19 вечером: пик до ×1.8 (возврат домой)
//  - выходные дни: меньше пик, max ×1.2-1.3 в районе ТЦ днём
//  - ночь и раннее утро: всегда ×1.0
const MINSK_TRAFFIC_BY_DAY_HOUR: Record<
  "weekday" | "saturday" | "sunday",
  number[]
> = {
  // 24 часа: индекс = час (0..23)
  weekday: [
    1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.05, 1.4, 1.7, 1.5, // 00-09
    1.2, 1.1, 1.1, 1.1, 1.15, 1.3, 1.5, 1.7, 1.8, 1.5, // 10-19
    1.2, 1.1, 1.05, 1.0,                                 // 20-23
  ],
  saturday: [
    1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.05, 1.1,  // 00-09
    1.15, 1.2, 1.2, 1.25, 1.3, 1.3, 1.25, 1.2, 1.15, 1.1, // 10-19
    1.05, 1.0, 1.0, 1.0,                                  // 20-23
  ],
  sunday: [
    1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.05,  // 00-09
    1.1, 1.15, 1.2, 1.2, 1.25, 1.25, 1.2, 1.15, 1.1, 1.05, // 10-19
    1.0, 1.0, 1.0, 1.0,                                   // 20-23
  ],
};

/**
 * Возвращает локально-предсказанный коэффициент времени поездки в Минске
 * для заданного дня и часа. Используется когда нет реального API пробок.
 * Возвращает множитель ≥ 1.0, на который нужно умножить «свободное» время
 * OSRM, чтобы получить реальное время в пробке.
 */
export function localTrafficTimeMultiplier(
  day: "weekday" | "saturday" | "sunday",
  hour: number,
): number {
  const safeHour = Math.max(0, Math.min(23, Math.floor(hour)));
  return MINSK_TRAFFIC_BY_DAY_HOUR[day][safeHour];
}

/**
 * Превращает локальный множитель времени обратно в «эквивалентный ratio»
 * (currentSpeed/freeFlowSpeed) — для отображения в UI как процент скорости.
 */
export function multiplierToRatio(mult: number): number {
  return Math.max(0.05, Math.min(1, 1 / mult));
}

// ─────────────────────────────────────────────────────────────────────────────
// Калибровка пробок из накопленных наблюдений
// ─────────────────────────────────────────────────────────────────────────────

/**
 * «Свободная» городская скорость в Минске — эталон, относительно которого
 * считаем пробочный множитель из замеров `km/min`. Это средняя скорость по
 * городу в полностью свободный поток (3-5 утра по будням).
 *
 * Получено эмпирически: магистрали 60-70 км/ч, центр 35-40 км/ч → среднее ~50.
 */
export const MINSK_FREE_FLOW_SPEED_KMH = 50;

type ObsMeasure = {
  lat: number;
  lng: number;
  day: "weekday" | "saturday" | "sunday";
  hour: number;
  km: number;
  min: number;
};

function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(lat1)) * Math.cos(toRad(lat2));
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Из массива наблюдений с известными км/мин выводит пробочный множитель
 * для конкретной точки/дня/часа. Алгоритм:
 *
 *   1) фильтруем только наблюдения с замером (km > 0 && min > 0)
 *   2) выбираем те, что в радиусе ≤ radiusKm (по умолчанию 3 км),
 *      с тем же типом дня и часом ±1 (узкое окно для точности пиков)
 *   3) вес: w = 1/(distance + 0.5) × 1/(1 + 2·hourDiff)
 *   4) **гармоническая** средняя скорость по темпу (min/km) — корректно
 *      для усреднения по дистанции
 *   5) baseline свободной скорости приходит от OSRM для конкретного маршрута
 *      (а не глобальные 50 км/ч) — это снимает bias центр/магистрали
 *
 * Возвращает null если данных недостаточно (< 2 точек).
 */
export function inferTrafficFromObservations(
  point: { lat: number; lng: number },
  day: "weekday" | "saturday" | "sunday",
  hour: number,
  observations: Array<{
    lat: number;
    lng: number;
    day?: string;
    slot?: string;
    hour?: number;
    date?: string;
    km?: number;
    min?: number;
  }>,
  options: {
    radiusKm?: number;
    /** Свободная скорость на этом маршруте (км/ч) — baseline для multiplier.
     *  Если не задана, используется городское усреднение MINSK_FREE_FLOW_SPEED_KMH. */
    freeFlowSpeedKmh?: number;
  } = {},
): {
  multiplier: number;
  avgSpeed: number;
  sampleCount: number;
} | null {
  const radiusKm = options.radiusKm ?? 3;
  const freeFlowKmh = options.freeFlowSpeedKmh ?? MINSK_FREE_FLOW_SPEED_KMH;
  const measures: Array<ObsMeasure & { weight: number }> = [];
  for (const o of observations) {
    if (!o.km || !o.min || o.km <= 0 || o.min <= 0) continue;
    if (o.day !== day) continue;
    const oHour =
      typeof o.hour === "number"
        ? o.hour
        : o.date
          ? parseInt(o.date.slice(11, 13), 10)
          : slotToHour(o.slot);
    if (!Number.isFinite(oHour)) continue;
    const hourDiff = Math.abs(oHour - hour);
    if (hourDiff > 1) continue; // узкое окно — пики 1ч острые
    const d = distKm(point.lat, point.lng, o.lat, o.lng);
    if (d > radiusKm) continue;
    const weight = (1 / (d + 0.5)) * (1 / (1 + 2 * hourDiff));
    measures.push({
      lat: o.lat,
      lng: o.lng,
      day,
      hour: oHour,
      km: o.km,
      min: o.min,
      weight,
    });
  }
  if (measures.length < 2) return null;
  // Гармоническое среднее: усредняем темп (min/km), потом инвертируем.
  // Формально: time = sum(km_i) / avgSpeed, => avgSpeed_harmonic = sum(km_i) / sum(min_i),
  // взвешенный вариант: avgPace = sum(w_i · pace_i) / sum(w_i), avgSpeed = 60/avgPace.
  let wSum = 0;
  let paceAcc = 0; // мин/км · weight
  for (const m of measures) {
    const pace = m.min / m.km; // мин на км
    paceAcc += pace * m.weight;
    wSum += m.weight;
  }
  const avgPace = paceAcc / wSum;
  if (avgPace <= 0) return null;
  const avgSpeed = 60 / avgPace; // км/ч (1/pace в ч/км × 60)
  const multiplier = Math.max(
    1.0,
    Math.min(3.0, freeFlowKmh / avgSpeed),
  );
  return { multiplier, avgSpeed, sampleCount: measures.length };
}

function slotToHour(slot?: string): number {
  switch (slot) {
    case "night":
      return 3;
    case "morning":
      return 8;
    case "midday":
      return 13;
    case "evening":
      return 17;
    case "late":
      return 22;
    default:
      return NaN;
  }
}
