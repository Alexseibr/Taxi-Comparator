import { ZONES, hourToSlot, type Zone, type DayType, type ZoneType } from "./zones";

// Множители "интенсивности спроса" по типу зоны.
// Калибровка: центр и вокзал генерят больше заявок на единицу площади
// чем спальник; промзона почти не генерирует.
// Аэропорт = 0: парк RWB работает по Минску, авто в МСК-2 не «отрезаем».
export const TYPE_DEMAND_FACTOR: Record<string, number> = {
  "center": 2.5,
  "transport-hub": 2.2,
  "premium": 1.4,
  "mall": 1.3,
  "sleeper": 1.0,
  "outskirts": 0.6,
  "industrial": 0.4,
  "airport-out": 0,
  "airport-in": 0,
};

// Локальный haversine — не хочется тащить из zones.ts (она его не экспортит).
function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Сколько машин одновременно нужно на 1.0 surge × 1500m radius × type=sleeper.
// Это калибровочная константа: при totalCars=500 и базовом surge=1.0
// получается ~25-30 машин в обычный спальник.
const DEMAND_BASE_CARS_PER_KM = 12;

export type FleetAllocation = {
  zoneId: string;
  cars: number;
  demand: number;       // Сколько машин нужно по прогнозу
  ratio: number;        // cars / demand (1.0 = идеальный баланс)
  surge: number;        // surge у Я. — для контекста
};

export type FleetSummary = {
  totalCars: number;
  onShift: number;      // На линии сейчас
  offShift: number;     // В резерве/смене
  totalDemand: number;
  globalRatio: number;  // onShift / totalDemand
  allocations: FleetAllocation[];
  hour: number;
  day: DayType;
};

export type FleetOptions = {
  reservePct?: number;  // Доля парка в резерве (по умолчанию 15%)
  /** Множитель базовой интенсивности спроса по городу.
   *  1.0 = обычный день, 0.5 = ночь/тихо, 2.0 = час пик / непогода.
   *  Влияет только на «прогноз спроса» и `globalRatio`/`fleetColor`,
   *  не меняет распределение машин между зонами. */
  demandScale?: number;
};

function zoneDemandWeight(z: Zone, hour: number, day: DayType): number {
  const slot = hourToSlot(hour);
  const surge = z.surge[day][slot].comfort;
  const typeFactor = TYPE_DEMAND_FACTOR[z.type] ?? 1.0;
  // Площадь круга ∝ r², но спрос растёт суб-линейно (центральные точки
  // концентрируют людей сильнее периферии), берём степень 1.4.
  const radiusKm = z.radiusM / 1000;
  const areaScale = Math.pow(radiusKm, 1.4);
  return surge * typeFactor * areaScale;
}

function zoneAbsoluteDemand(
  z: Zone,
  hour: number,
  day: DayType,
  demandScale: number,
): number {
  const slot = hourToSlot(hour);
  const surge = z.surge[day][slot].comfort;
  const typeFactor = TYPE_DEMAND_FACTOR[z.type] ?? 1.0;
  const radiusKm = z.radiusM / 1000;
  // demand = base × scale × surge × typeFactor × area^1.4
  return (
    DEMAND_BASE_CARS_PER_KM *
    demandScale *
    surge *
    typeFactor *
    Math.pow(radiusKm, 1.4)
  );
}

/**
 * Распределяет парк totalCars по зонам пропорционально прогнозу спроса
 * на конкретный час и день недели.
 *
 * Алгоритм:
 *   1. reservePct % парка отводим в смену (off-shift)
 *   2. остаток (on-shift) распределяем по зонам пропорционально весу
 *      weight(zone) = surge × typeFactor × area^1.4
 *   3. остаток округления досыпаем в Центр
 *   4. для каждой зоны считаем "целевой спрос" в машинах одновременно
 *      и ratio = allocated/demand → цвет на карте
 */
export function distributeFleet(
  totalCars: number,
  hour: number,
  day: DayType,
  opts?: FleetOptions
): FleetSummary {
  const reservePct = opts?.reservePct ?? 0.15;
  const demandScale = opts?.demandScale ?? 1.0;
  const onShift = Math.max(0, Math.round(totalCars * (1 - reservePct)));
  const offShift = totalCars - onShift;

  const weights = ZONES.map((z) => zoneDemandWeight(z, hour, day));
  const sumW = weights.reduce((a, b) => a + b, 0) || 1;

  // Largest-remainder method (метод Гамильтона):
  //   exact[i] = onShift × weight[i] / sumW          (вещественное)
  //   floors[i] = ⌊exact[i]⌋                          (гарантированно ≥0, sum ≤ onShift)
  //   leftover = onShift − Σfloors                    (≥0, ≤ N)
  //   распределяем leftover по 1 машине в зоны с наибольшей дробной частью
  // Свойства: cars[i] ≥ 0, Σcars = onShift, нет «перетягивания минусов в Центр».
  const exact = weights.map((w) => (onShift * w) / sumW);
  const floors = exact.map((x) => Math.floor(x));
  const cars = [...floors];
  const allocatedFloor = floors.reduce((a, b) => a + b, 0);
  let leftover = onShift - allocatedFloor;
  if (leftover > 0) {
    const order = exact
      .map((x, i) => ({ i, frac: x - floors[i] }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < leftover && k < order.length; k++) {
      cars[order[k].i] += 1;
    }
  }

  const slot = hourToSlot(hour);
  const allocations: FleetAllocation[] = ZONES.map((z, i) => {
    const demand = zoneAbsoluteDemand(z, hour, day, demandScale);
    return {
      zoneId: z.id,
      cars: cars[i],
      demand: +demand.toFixed(1),
      ratio: demand > 0 ? cars[i] / demand : Infinity,
      surge: z.surge[day][slot].comfort,
    };
  });

  const totalDemand = allocations.reduce((s, a) => s + a.demand, 0);
  const globalRatio = totalDemand > 0 ? onShift / totalDemand : Infinity;

  return {
    totalCars,
    onShift,
    offShift,
    totalDemand: +totalDemand.toFixed(1),
    globalRatio: +globalRatio.toFixed(2),
    allocations,
    hour,
    day,
  };
}

/**
 * Цвет круга на карте по балансу supply/demand.
 *   ≥1.3   зелёный  — избыток (можем брать заказы дальше / меньше surge)
 *   ≥0.95  салат    — баланс
 *   ≥0.7   жёлтый   — норма с напряжением
 *   ≥0.45  оранж    — дефицит (стоит поднять цену → стянуть водителей)
 *   <0.45  красный  — острый дефицит, не успеваем подавать
 */
export function fleetColor(ratio: number): string {
  if (!Number.isFinite(ratio)) return "#10b981";
  if (ratio >= 1.3) return "#10b981";
  if (ratio >= 0.95) return "#84cc16";
  if (ratio >= 0.7) return "#eab308";
  if (ratio >= 0.45) return "#f97316";
  return "#ef4444";
}

export function fleetLabel(ratio: number): string {
  if (!Number.isFinite(ratio)) return "избыток";
  if (ratio >= 1.3) return "избыток";
  if (ratio >= 0.95) return "хороший баланс";
  if (ratio >= 0.7) return "норма";
  if (ratio >= 0.45) return "напряжение";
  return "острый дефицит";
}

/**
 * Множитель цены RWB-тарифа от баланса supply/demand.
 * При избытке (ratio>1.3) цену оставляем минимальной (×1.0),
 * при остром дефиците (<0.45) поднимаем до ×2.5.
 * Используется в дальнейшем для интеграции в калькулятор.
 */
export function balanceMultiplier(ratio: number): number {
  if (!Number.isFinite(ratio)) return 1.0;
  if (ratio >= 1.3) return 1.0;
  if (ratio >= 0.95) return 1.05;
  if (ratio >= 0.7) return 1.2;
  if (ratio >= 0.45) return 1.6;
  return Math.min(2.5, 1.6 + (0.45 - ratio) * 2.0);
}

// === HEX-распределение ====================================================
// При высоком zoom большие круги по zones мельчают и неудобны. Делаем
// распределение по hex-сетке (та же что в основной карте), исключая
// «нежилые» ячейки: лес, вода, поля за МКАД, промзоны без бенефициаров,
// аэропорт. Критерий обитаемости — расстояние до центра ближайшей зоны
// (topZoneId по IDW), помноженное на радиус зоны.

export type HexFleetInput = {
  id: string;                       // h3 cell index
  centerLatLng: [number, number];
  surge: number;                    // surge.comfort в этой соте
  topZoneId: string;                // ближайшая по IDW зона
};

export type HexFleetAllocation = {
  hexId: string;
  cars: number;
  surge: number;
  habitable: boolean;               // false = за пределами районов, не получает машин
  topZoneId: string;
  distKm: number;                   // расстояние до центра ведущей зоны
};

export type HexFleetSummary = {
  totalCars: number;
  onShift: number;
  offShift: number;
  habitableCount: number;
  excludedCount: number;            // лес/вода/аэропорт — отброшено
  meanCarsPerHabitable: number;
  maxCars: number;
  allocations: HexFleetAllocation[];
  hour: number;
  day: DayType;
};

// Радиус «обитаемости»: ячейки дальше HABITABILITY_FACTOR × radiusZone
// от центра ведущей зоны исключаем — там лес/поле/вода.
const HABITABILITY_FACTOR = 1.25;

export function distributeFleetToHexes(
  totalCars: number,
  hexes: HexFleetInput[],
  hour: number,
  day: DayType,
  opts?: { reservePct?: number }
): HexFleetSummary {
  const reservePct = opts?.reservePct ?? 0.15;
  const onShift = Math.max(0, Math.round(totalCars * (1 - reservePct)));
  const offShift = totalCars - onShift;

  // 1. Размечаем obitability + считаем weight для каждой ячейки
  const enriched = hexes.map((h) => {
    const zone = ZONES.find((z) => z.id === h.topZoneId);
    let habitable = false;
    let weight = 0;
    let distKm = Infinity;
    if (zone) {
      const typeFactor = TYPE_DEMAND_FACTOR[zone.type] ?? 1.0;
      distKm = haversineKm(h.centerLatLng, zone.center);
      const limit = (zone.radiusM / 1000) * HABITABILITY_FACTOR;
      // Исключаем: aэропорт (typeFactor=0) + слишком далеко от центра зоны
      if (typeFactor > 0 && distKm <= limit) {
        habitable = true;
        // Внутри района распределение пропорционально surge × type
        // (proximity-бонус НЕ применяем — иначе центральные хексы получат
        // непропорционально много, тогда как граница зоны столь же жилая).
        weight = h.surge * typeFactor;
      }
    }
    return { ...h, habitable, weight, distKm };
  });

  const sumW = enriched.reduce((s, x) => s + x.weight, 0) || 1;

  // 2. Largest-remainder округление (cars ≥ 0, Σcars = onShift)
  const exact = enriched.map((x) => (onShift * x.weight) / sumW);
  const floors = exact.map((x) => Math.floor(x));
  const cars = [...floors];
  const allocatedFloor = floors.reduce((a, b) => a + b, 0);
  const leftover = onShift - allocatedFloor;
  if (leftover > 0) {
    const order = exact
      .map((x, i) => ({ i, frac: x - floors[i] }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < leftover && k < order.length; k++) {
      cars[order[k].i] += 1;
    }
  }

  const allocations: HexFleetAllocation[] = enriched.map((x, i) => ({
    hexId: x.id,
    cars: cars[i],
    surge: x.surge,
    habitable: x.habitable,
    topZoneId: x.topZoneId,
    distKm: +x.distKm.toFixed(2),
  }));

  const habitableCount = enriched.filter((x) => x.habitable).length;
  const excludedCount = enriched.length - habitableCount;
  const meanCarsPerHabitable =
    habitableCount > 0 ? onShift / habitableCount : 0;
  const maxCars = allocations.reduce((m, a) => Math.max(m, a.cars), 0);

  return {
    totalCars,
    onShift,
    offShift,
    habitableCount,
    excludedCount,
    meanCarsPerHabitable: +meanCarsPerHabitable.toFixed(2),
    maxCars,
    allocations,
    hour,
    day,
  };
}

/**
 * Цвет ячейки в hex-режиме по плотности относительно среднего по городу.
 *   t = cars / meanCarsPerHabitable
 *   t<0.3 — почти прозрачно (мало машин)
 *   t<0.7 — голубой
 *   t<1.3 — салат  (норма)
 *   t<2.0 — жёлтый
 *   t<3.0 — оранж
 *   ≥3.0 — красный (концентрация в горячей точке)
 */
export function hexDensityColor(cars: number, mean: number): string {
  if (cars === 0) return "transparent";
  if (mean <= 0) return "#84cc16";
  const t = cars / mean;
  if (t >= 3.0) return "#ef4444";
  if (t >= 2.0) return "#f97316";
  if (t >= 1.3) return "#eab308";
  if (t >= 0.7) return "#84cc16";
  if (t >= 0.3) return "#22d3ee";
  return "#bae6fd";
}

// Удобный re-export — используется в FleetLayer
export type { ZoneType };
