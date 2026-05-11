export type DayType = "weekday" | "saturday" | "sunday";
export type TimeSlot = "night" | "morning" | "midday" | "evening" | "late";
export type TaxiClass = "econom" | "comfort";
export type ZoneType =
  | "center"
  | "transport-hub"
  | "sleeper"
  | "mall"
  | "premium"
  | "industrial"
  | "airport-out"
  | "airport-in";

export type SurgeData = {
  econom: number;
  comfort: number;
  hiddenEconomSurge?: number;
  source: "measured" | "predicted";
  measuredAt?: string;
  notes?: string;
};

export type SurgeMatrix = Record<DayType, Record<TimeSlot, SurgeData>>;

export type Zone = {
  id: string;
  nameEn: string;
  nameRu: string;
  description: string;
  center: [number, number];
  radiusM: number;
  type: ZoneType;
  surge: SurgeMatrix;
};

export const DAYS: { id: DayType; label: string; emoji: string }[] = [
  { id: "weekday", label: "Будни", emoji: "💼" },
  { id: "saturday", label: "Суббота", emoji: "🎉" },
  { id: "sunday", label: "Воскресенье", emoji: "🛌" },
];

// 7-дневная UI-схема для селектора в шапке. Backend (surge-model.json,
// zones.surge) ничего не знает про конкретные дни недели — только
// weekday/saturday/sunday. Поэтому ScheduleDay → DayType — это просто
// проекция: пн-пт → weekday, сб → saturday, вс → sunday.
export type ScheduleDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export const SCHEDULE_DAYS: { id: ScheduleDay; label: string; short: string; emoji: string }[] = [
  { id: "monday",    label: "Понедельник", short: "Пн", emoji: "💼" },
  { id: "tuesday",   label: "Вторник",     short: "Вт", emoji: "💼" },
  { id: "wednesday", label: "Среда",       short: "Ср", emoji: "💼" },
  { id: "thursday",  label: "Четверг",     short: "Чт", emoji: "💼" },
  { id: "friday",    label: "Пятница",     short: "Пт", emoji: "🎈" },
  { id: "saturday",  label: "Суббота",     short: "Сб", emoji: "🎉" },
  { id: "sunday",    label: "Воскресенье", short: "Вс", emoji: "🛌" },
];

export function scheduleDayToType(d: ScheduleDay): DayType {
  if (d === "saturday") return "saturday";
  if (d === "sunday") return "sunday";
  return "weekday";
}

// JS getDay(): 0=вс, 1=пн, ..., 6=сб
const JS_DAY_TO_SCHEDULE: ScheduleDay[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export function getCurrentScheduleDay(now: Date = new Date()): ScheduleDay {
  return JS_DAY_TO_SCHEDULE[now.getDay()];
}

export const TIME_SLOTS: {
  id: TimeSlot;
  label: string;
  hours: string;
  startHour: number;
  endHour: number;
  emoji: string;
}[] = [
  { id: "night", label: "Ночь", hours: "00–06", startHour: 0, endHour: 6, emoji: "🌙" },
  { id: "morning", label: "Утро", hours: "07–10", startHour: 7, endHour: 10, emoji: "☀️" },
  { id: "midday", label: "День", hours: "11–14", startHour: 11, endHour: 14, emoji: "🏙️" },
  { id: "evening", label: "Вечер", hours: "15–19", startHour: 15, endHour: 19, emoji: "🚦" },
  { id: "late", label: "Поздний вечер", hours: "20–23", startHour: 20, endHour: 23, emoji: "🌆" },
];

export function hourToSlot(hour: number): TimeSlot {
  for (const s of TIME_SLOTS) {
    if (hour >= s.startHour && hour <= s.endHour) return s.id;
  }
  return "night";
}

// КАЛИБРОВКА v3 — 26.04.2026 — Yandex использует ПЛОСКУЮ baza.
//
// Формула:
//   raw      = pickup + perKm·км + perMin·мин = 0
//   preSurge = max(minimum, raw) = minimum (ВСЕГДА)
//   final    = minimum × surge   ← вся динамика — в сёрдже
//
// ОТКРЫТИЕ v3 (на 60 заказах с открытым ⚡N от 0.8 до 31.6, дальность 1..150 км):
//   baza_Y = factC / yaSurgeC = 9.83 br ± 0.21 (σ < 3%) на ВСЕХ дистанциях.
//   Даже на 44 км в аэропорт baza_Y = 9.93 br.
//
//   Это значит: у Yandex perKm и perMin фактически НУЛЕВЫЕ. Длина маршрута
//   зашита в surge — именно поэтому ⚡N в UI коррелирует с км (ratio
//   ⚡N/км ≈ 0.13–0.20). То что мы видим в иконке «×N» — это полный
//   множитель цены к плоской монете 10 br, а не «множитель спроса».
//
// СРАВНЕНИЕ ВЕРСИЙ:
//   v1: Cmf pickup=7.0 perKm=0.10 perMin=0.85, minimum=4
//   v2: Cmf pickup=4.0 perKm=1.20 perMin=0.80, minimum=10  ← ошибка: perKm > 0
//   v3: Cmf pickup=0   perKm=0    perMin=0,    minimum=10  ← плоская монета
//
// Hidden Эконом-boost (v3): Эконом дешевле Cmf на 4–11% при том же сёрдже.
// Скидка НЕ постоянна — БИНАРНАЯ функция от sC (см. hiddenBoost() ниже).
// 109 калибровочных замеров (10 прогонов) → hb=0.89 при sC<1, hb=0.96 при sC≥1.
// Реализован двумя способами:
//   1) minimum_E = 9 br (даёт первый множитель 9/10 = 0.9)
//   2) hiddenBoost(sC) умножает предсказанный сёрдж на 0.89..0.97
//      → итоговое отношение Эконом/Cmf = 0.9 × hb(sC) ∈ [0.80, 0.87]
//
// Влияние пробок (v3): т.к. perKm = perMin = 0, время поездки больше не
// влияет на цену через формулу basePrice. Пробки применяются как множитель
// СЁРДЖА через trafficSurgeMultiplier(ratio) в RoutePlanner. Например,
// ratio=0.5 (едем в 2 раза медленнее свободного) → ×1.30 к surge.
// Калибровка приближённая, нужны замеры в час пик (будни 7-10/17-19).
//
// Подробности и журнал обучения: scripts/METHODOLOGY.md, scripts/learned/changelog.md
//
// Параметры:
//   pickup, perKm, perMin — обнулены (Yandex их не использует).
//                           Поля сохранены для совместимости со старыми скриптами.
//   minimum               — единственный реальный параметр тарифа Yandex.
//                           Cmf=10, Econ=9 (через hidden_boost ×0.89).
//   longDistanceThresholdKm/longDistancePerKm — отключены.
//
// Проверка v3 на длинных заказах вс 26.04.2026 (factC = 10 × yaSurgeC):
//   #9876 Немига → Аэропорт MSQ (44 км, ⚡6.0): 10 × 6.0 = 60.0 br  (факт 59.6, ошибка -0.7%)
//   #9879 Ермака → Гатово (26 км, ⚡5.1):       10 × 5.1 = 51.0 br  (факт 51.0, ошибка 0.0%)
//   #9874 Победы → Боровляны (15 км, ⚡1.9):    10 × 1.9 = 19.0 br  (факт 18.7, ошибка -1.6%)
//   #9871 Малиновка (8 км, ⚡2.0):              10 × 2.0 = 20.0 br  (факт 20.0, ошибка 0.0%)
//   #9866 Немига короткий (3.7 км, ⚡0.5):      10 × 0.5 =  5.0 br  (факт 4.6,  ошибка +8.7%)
// Восстановленные минимумы по фактическим данным Я.Такси Минск:
//   - Cmf minimum  = 9.86 br  (median по 73 замерам с открытым ⚡, std 0.30)
//   - Econ minimum = 9.39 br  (Cmf × 0.952, hidden Эконом-boost из 126 замеров)
// ── Тарифная формула v4 (OLS по 7640 снапшотам Yandex Go, 20 маршрутов) ────
//
// ECONOM (R²=1.0000, MAE=0.003 BYN — детерминированная формула):
//   baza = 5.567 + 0.5032·km + 0.2086·min
//   price = max(6.40, baza) × surge
//
// COMFORT / BUSINESS (R²=0.79; minimum=9.10 доминирует до ~10.4 км):
//   baza_long = 1.959 + 0.688·km  (km и min коллинеарны в датасете)
//   price = max(9.10, baza_long) × surge
//
// До v4 держали плоскую модель (perKm=0, perMin=0, minimum=const) —
// для Эконома это давало MAE=4.10 BYN (ошибка 29%!). Новая формула: MAE≈0.
export const BASE_TARIFF = {
  econom: {
    pickup: 5.567,   // базовая ставка, BYN (v4 OLS 3820 снапшотов)
    perKm:  0.503,   // BYN/км (R²=1.0)
    perMin: 0.209,   // BYN/мин
    minimum: 6.40,   // наблюдаемый пол (самый короткий маршрут)
    longDistanceThresholdKm: 9999,
    longDistancePerKm: 0,
  },
  comfort: {
    pickup: 1.959,   // базовая ставка для длинных маршрутов
    perKm:  0.688,   // BYN/км (минимум 9.10 доминирует для <10.4 км)
    perMin: 0,       // km и min коллинеарны — не разделяется
    minimum: 9.10,   // наблюдаемый пол (все маршруты ≤10.4 км = 9.10)
    longDistanceThresholdKm: 9999,
    longDistancePerKm: 0,
  },
};

// Допустимый диапазон сёрджа: расширен после v3 (видели ⚡6.0 на аэропорт).
export const SURGE_BOUNDS = { min: 0.3, max: 10.0 };

// ───────────────────────────────────────────────────────────────────────────
// 2D-таблица сёрджа от (km × tripMin).  Учится из реальных скринов Yandex,
// см. scripts/learn-vps.mjs (лучшая модель M5: LOO-MAPE 19.7% против 36.0%
// у одномерной distanceSurgeMultiplier по 139 скринам).
//
// Идея: Yandex считает финальный сёрдж по 4 факторам — км, время в пути,
// район и час. Для weekday-данных (139 шт.) фактор времени в пути несёт
// почти всю информацию о пробках/часах, поэтому 2D-сетка (км × tripMin)
// даёт почти двукратный прирост точности.
//
// Бакеты (фиксированные):
//   km:      [0, 2.5, 4, 6, 9, 13, 20, ∞)
//   tripMin: [0, 5, 10, 15, 20, 30, 45, ∞)
//
// cells содержит медиану yaSurgeC для каждой непустой ячейки (i_km,j_min).
// Для пустых/тонких (n<2) ячеек fallback по 8 соседям, иначе globalMedian.
// ───────────────────────────────────────────────────────────────────────────
import ROUTE_SURGE_2D_RAW from "../../public/data/route-surge-2d.json";

type RouteSurge2D = {
  generatedAt: string;
  basedOn: number;
  source: string;
  kmBuckets: number[];
  minBuckets: number[];
  cells: Record<string, { med: number; n: number }>;
  globalMedian: number;
};
const ROUTE_SURGE_2D = ROUTE_SURGE_2D_RAW as RouteSurge2D;

function bucketIdx(v: number, b: number[]): number {
  for (let i = 0; i < b.length - 1; i++) if (v < b[i + 1]) return i;
  return b.length - 2;
}

/**
 * routeSurgeMultiplier(km, tripMin) — двумерный сёрдж по эмпирической таблице.
 * km        — расстояние маршрута, км (haversine A→B либо OSRM/Google).
 * tripMin   — время в пути в минутах (с учётом пробок).  Берём наш min с
 *             trafficMult, либо tripMinToDest от Yandex, либо OSRM duration.
 *
 * Возвращает множитель ≈ yaSurgeC — финальная цена / минимум(Комфорт).
 * Использовать ВМЕСТО distanceSurgeMultiplier там, где известен tripMin.
 */
export function routeSurgeMultiplier(km: number, tripMin: number): number {
  if (!isFinite(km) || km <= 0) return 1.0;
  if (!isFinite(tripMin) || tripMin <= 0) return distanceSurgeMultiplier(km);
  const i = bucketIdx(km, ROUTE_SURGE_2D.kmBuckets);
  const j = bucketIdx(tripMin, ROUTE_SURGE_2D.minBuckets);
  const cell = ROUTE_SURGE_2D.cells[`${i},${j}`];
  if (cell && cell.n >= 2) return cell.med;
  // соседи 3×3
  const ns: number[] = [];
  for (let di = -1; di <= 1; di++)
    for (let dj = -1; dj <= 1; dj++) {
      if (di === 0 && dj === 0) continue;
      const c = ROUTE_SURGE_2D.cells[`${i + di},${j + dj}`];
      if (c && c.n >= 2) ns.push(c.med);
    }
  if (ns.length) {
    const s = [...ns].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  return ROUTE_SURGE_2D.globalMedian;
}

/**
 * Старый одномерный distMul — оставлен для обратной совместимости и для
 * случаев, когда tripMin неизвестен.  Бакеты по 224 ранним замерам.
 *
 * @deprecated  используйте routeSurgeMultiplier(km, tripMin) — он точнее в 2 раза.
 */
export function distanceSurgeMultiplier(km: number): number {
  if (!isFinite(km) || km <= 0) return 1.0;
  if (km < 1.5)  return 1.00;
  if (km < 2.5)  return 0.68;
  if (km < 4.0)  return 0.77;
  if (km < 6.0)  return 0.95;
  if (km < 9.0)  return 1.28;
  if (km < 13.0) return 1.67;
  if (km < 20.0) return 1.76;
  return 1.93;
}

export function basePrice(cls: TaxiClass, km: number, min: number): number {
  const t = BASE_TARIFF[cls];
  const baseKm =
    Math.min(km, t.longDistanceThresholdKm) * t.perKm +
    Math.max(0, km - t.longDistanceThresholdKm) * t.longDistancePerKm;
  return Math.max(t.minimum, t.pickup + baseKm + min * t.perMin);
}

export type PriceBreakdown = {
  pickup: number;
  perKmCharge: number;
  perMinCharge: number;
  longDistanceCharge: number;
  raw: number;            // pickup + km + min + long
  baseMinimum: number;    // нижняя планка из тарифа
  preSurge: number;       // max(minimum, raw) — итог ДО сёрджа
  surge: number;          // ограниченный SURGE_BOUNDS
  final: number;          // preSurge × surge
  dominatedBy: "minimum" | "raw"; // что определило preSurge: минимум или формула
};

export function finalPrice(
  cls: TaxiClass,
  km: number,
  min: number,
  surge: number = 1.0
): PriceBreakdown {
  const t = BASE_TARIFF[cls];
  const sg = Math.max(SURGE_BOUNDS.min, Math.min(SURGE_BOUNDS.max, surge));

  const perKmCharge = Math.min(km, t.longDistanceThresholdKm) * t.perKm;
  const longDistanceCharge =
    Math.max(0, km - t.longDistanceThresholdKm) * t.longDistancePerKm;
  const perMinCharge = min * t.perMin;

  const raw = t.pickup + perKmCharge + longDistanceCharge + perMinCharge;
  const preSurge = Math.max(t.minimum, raw);
  const final = preSurge * sg;

  return {
    pickup: t.pickup,
    perKmCharge,
    perMinCharge,
    longDistanceCharge,
    raw,
    baseMinimum: t.minimum,
    preSurge,
    surge: sg,
    final,
    dominatedBy: raw >= t.minimum ? "raw" : "minimum",
  };
}

// Baseline Комфорт surge by zone type. Якорная точка: будни · полдень = 1.0.
// Это характерный сёрдж зоны в спокойный рабочий день в обед.
// (Раньше якорь был «суббота вечер»; пересчёт v5: new_base = old_base × old_midday_mul)
const TYPE_BASELINE_COMFORT: Record<ZoneType, number> = {
  center:          1.26,
  "transport-hub": 0.94,
  sleeper:         0.83,
  mall:            1.36,
  premium:         1.33,
  industrial:      0.66,
  "airport-out":   8.28,
  "airport-in":    5.67,
};

// Коэффициент, применяемый к базовому сёрджу зоны (будни·полдень = 1.0) для
// любой комбинации день×слот. Описывает пассажиропоток по типу зоны:
//  - sleeper:       ×2.09 будни утро (выезд на работу), ×1.91 будни вечер (возврат).
//  - center:        ×1.43 сб вечер (ночная жизнь), ×1.36 будни вечер (выход с работы).
//  - mall:          минимум будни утро, пик сб полдень (×1.41) и воскресенье полдень.
//  - premium:       слабая волатильность, стабильно чуть выше базы.
//  - transport-hub: стабильный пассажиропоток, почти плоский.
//  - industrial:    оживает только в будни утро/вечер, мёртв в выходные.
//  - airports:      стабильно, небольшой пик утро/вечер.
type DayTime = Record<DayType, Record<TimeSlot, number>>;

const TIME_MULTIPLIERS: Record<ZoneType, DayTime> = {
  center: {
    weekday:  { night: 0.64, morning: 1.21, midday: 1.00, evening: 1.36, late: 1.07 },
    saturday: { night: 0.71, morning: 0.79, midday: 1.07, evening: 1.43, late: 1.21 },
    sunday:   { night: 0.64, morning: 0.71, midday: 1.00, evening: 1.29, late: 1.07 },
  },
  "transport-hub": {
    weekday:  { night: 0.71, morning: 1.06, midday: 1.00, evening: 1.12, late: 0.94 },
    saturday: { night: 0.65, morning: 0.82, midday: 1.00, evening: 1.18, late: 0.94 },
    sunday:   { night: 0.65, morning: 0.82, midday: 1.00, evening: 1.12, late: 0.94 },
  },
  sleeper: {
    // будни утро: пик выезда на работу (×2.09); будни вечер: пик возврата (×1.91)
    weekday:  { night: 0.73, morning: 2.09, midday: 1.00, evening: 1.91, late: 1.18 },
    saturday: { night: 0.82, morning: 0.91, midday: 1.27, evening: 1.82, late: 1.36 },
    sunday:   { night: 0.73, morning: 0.82, midday: 1.18, evening: 1.55, late: 1.27 },
  },
  mall: {
    weekday:  { night: 0.47, morning: 0.59, midday: 1.00, evening: 1.29, late: 0.94 },
    saturday: { night: 0.53, morning: 0.65, midday: 1.41, evening: 1.18, late: 1.00 },
    sunday:   { night: 0.47, morning: 0.59, midday: 1.35, evening: 1.12, late: 0.88 },
  },
  premium: {
    weekday:  { night: 0.71, morning: 1.14, midday: 1.00, evening: 1.43, late: 1.07 },
    saturday: { night: 0.71, morning: 0.79, midday: 1.07, evening: 1.43, late: 1.21 },
    sunday:   { night: 0.64, morning: 0.71, midday: 1.00, evening: 1.29, late: 1.07 },
  },
  industrial: {
    weekday:  { night: 0.64, morning: 1.55, midday: 1.00, evening: 1.55, late: 0.91 },
    saturday: { night: 0.73, morning: 0.91, midday: 1.27, evening: 1.82, late: 1.09 },
    sunday:   { night: 0.64, morning: 0.73, midday: 1.00, evening: 1.27, late: 1.00 },
  },
  "airport-out": {
    weekday:  { night: 0.78, morning: 1.06, midday: 1.00, evening: 1.06, late: 0.94 },
    saturday: { night: 0.78, morning: 0.94, midday: 1.00, evening: 1.11, late: 0.94 },
    sunday:   { night: 0.78, morning: 0.94, midday: 1.06, evening: 1.11, late: 0.94 },
  },
  "airport-in": {
    weekday:  { night: 0.78, morning: 1.06, midday: 1.00, evening: 1.06, late: 0.94 },
    saturday: { night: 0.78, morning: 0.94, midday: 1.00, evening: 1.11, late: 0.94 },
    sunday:   { night: 0.78, morning: 0.94, midday: 1.06, evening: 1.11, late: 0.94 },
  },
};

// Convert predicted Комфорт surge to predicted Эконом surge.
//
// Калибровка v3 (60 замеров с открытым ⚡N вс 26.04.2026, hb = sE/sC, по бакетам sC):
//   sC<1.0      n=7   hb=0.891  (классическая скидка ~−11% на спокойном спросе)
//   sC 1.0..1.3 n=10  hb=0.969  (сжатая скидка ~−3%)
//   sC 1.3..1.6 n=8   hb=0.948  (то же)
//   sC 1.6..2.0 n=13  hb=0.965  (то же)
//   sC 2.0..2.5 n=13  hb=0.963  (то же)
//   sC 2.5..4.0 n=8   hb=0.960  (то же)
//   sC 4.0..7.0 n=5   hb=0.950  (междугородние; добавлен 9947 sC=4.36 hb=0.892)
//   sC>7.0      n=1   hb=0.979  (междугородние, чуть выше)
//
// 8-й прогон (1422): 2 новые точки. 9948 (sC=0.80 → hb=0.903) идеально лёг
// в плато <1.0. 9947 (Минск→Фаниполь, sC=4.36 → hb=0.892) — пограничный:
// формула предсказывает 0.96 для sC<5, реальный 0.892. Намёк, что для
// длинных пригородных поездок (большие км, sC ~4..5) скидка ближе к
// плато <1.0, чем к городскому 0.96. Пока в формулу не вшиваем —
// нужны ещё 3-4 таких замера, чтобы отделить от шума.
//
// Реальная модель: Yandex применяет ДВА режима скидки:
//   (а) sC < 1.0 (низкий спрос):   hb = 0.89 — классическая «−11%»
//                                  скидка как стимул конверсии
//   (б) sC ≥ 1.0 (есть спрос):     hb ≈ 0.96 — сжатая «−4%»;
//                                  Yandex не отдает большую скидку,
//                                  раз клиент и так готов платить
// Между ними короткий переход 1.0–1.2 для гладкости.
//
// Наблюдаемый overall mean по 109 замерам = 0.948. Константа 0.956 оставлена
// как fallback из ранних прогонов — изменение требует перепроверки UI,
// поэтому пока не трогаем (бинарная hb() ниже всё равно используется первой).
export const HIDDEN_BOOST_V3 = 0.956;

/**
 * Возвращает hidden Эконом-boost для данного Комфорт-сёрджа.
 * hb = (factE / minimum_E) / (factC / minimum_C).
 * Бинарная модель по 109 калибровочным замерам (вс 26.04.2026, 10 прогонов).
 */
export function hiddenBoost(comfortSurge: number): number {
  // Защита от NaN/±Infinity/undefined — иначе все сравнения возвращают
  // false и функция отдала бы 0.96, протащив NaN дальше через умножение.
  if (!Number.isFinite(comfortSurge)) return 0.89;
  const sC = Math.max(0, comfortSurge);
  if (sC < 1.0) return 0.89;                       // низкий спрос → стимул
  if (sC < 1.2) return 0.89 + (sC - 1.0) * 0.35;   // плавный переход 0.89 → 0.96
  if (sC < 5.0) return 0.96;                       // основной плато (умеренный/высокий)
  return 0.97;                                     // междугородние (sC > 5)
}

export function predictEconom(comfortSurge: number): {
  econom: number;
  hidden?: number;
} {
  const hb = hiddenBoost(comfortSurge);
  const econom = comfortSurge * hb;
  // В v3 всегда возвращаем `hidden` равным предсказанному econom-сёрджу:
  // hb меняется со sC (см. таблицу выше), поэтому статичные наблюдения
  // econom для конкретной соты могут быть «не в той фазе». Регрессионное
  // предсказание точнее реальной IDW-точки, если она замерена при другом sC.
  return { econom, hidden: econom };
}

type Anchor = {
  comfort: number;
  econom?: number;
  hiddenEconom?: number;
  measured?: { date: string; notes: string };
};

function buildMatrix(type: ZoneType, anchor: Anchor): SurgeMatrix {
  // anchor.comfort — это сёрдж, измеренный в субботу вечером (реальные замеры).
  // TIME_MULTIPLIERS теперь нормированы к будни·полдень = 1.0 (якорь v5).
  // Конвертируем: baseline_midday = comfort_sat_eve / MULT[type].saturday.evening
  const satEveMult = TIME_MULTIPLIERS[type].saturday.evening;
  const baseline = +(anchor.comfort / satEveMult).toFixed(3);
  const isMeasured = !!anchor.measured;
  const result = {} as SurgeMatrix;
  for (const day of DAYS) {
    result[day.id] = {} as Record<TimeSlot, SurgeData>;
    for (const t of TIME_SLOTS) {
      const mult = TIME_MULTIPLIERS[type][day.id][t.id];
      const comfort = Math.max(0.85, +(baseline * mult).toFixed(2));
      const isAnchorCell = day.id === "saturday" && t.id === "evening";

      let econom: number;
      let hidden: number | undefined;

      if (isAnchorCell && anchor.econom !== undefined) {
        econom = anchor.econom;
        hidden = anchor.hiddenEconom;
      } else {
        const e = predictEconom(comfort);
        econom = e.econom;
        hidden = e.hidden ? +e.hidden.toFixed(2) : undefined;
      }

      result[day.id][t.id] = {
        econom,
        comfort,
        ...(hidden ? { hiddenEconomSurge: hidden } : {}),
        source: isMeasured && isAnchorCell ? "measured" : "predicted",
        ...(isMeasured && isAnchorCell
          ? { measuredAt: anchor.measured!.date, notes: anchor.measured!.notes }
          : {}),
      };
    }
  }
  return result;
}

const M = "2026-04-25";

export const ZONES: Zone[] = [
  {
    id: "center",
    nameEn: "City Center",
    nameRu: "Центр (Немига, Купалы, пр. Независимости)",
    description: "Heart of Minsk — Nemiga, Kupaly, Independence Ave",
    center: [53.9045, 27.5615],
    radiusM: 1500,
    type: "center",
    surge: buildMatrix("center", {
      comfort: 1.8,
      econom: 1.0,
      hiddenEconom: 1.75,
      measured: {
        date: M,
        notes: "Points #7, #8: hidden surge ~1.75× on Эконом in red center zone",
      },
    }),
  },
  {
    id: "vokzal",
    nameEn: "Railway Station",
    nameRu: "Минск-Пасс (ж/д вокзал)",
    description: "Train station hub with constant taxi demand",
    center: [53.8905, 27.5485],
    radiusM: 800,
    type: "transport-hub",
    surge: buildMatrix("transport-hub", {
      comfort: 1.1,
      measured: { date: M, notes: "Point #1 (17:09): Комфорт 10.8 @ 1.1×, queue '3 in line'" },
    }),
  },
  {
    id: "pobedy",
    nameEn: "Pobedy Square",
    nameRu: "Площадь Победы / пр. Независимости",
    description: "Central business district",
    center: [53.918, 27.585],
    radiusM: 1200,
    type: "center",
    surge: buildMatrix("center", {
      comfort: 2.0,
      measured: {
        date: M,
        notes: "Points #1, #2: Комфорт base 9.7 × 1.5–2.0× on weekend evening",
      },
    }),
  },
  {
    id: "vostochnaya",
    nameEn: "Vostochnaya / Partizansky",
    nameRu: "Восточная / Партизанский район",
    description: "Eastern residential district",
    center: [53.9, 27.65],
    radiusM: 2000,
    type: "sleeper",
    surge: buildMatrix("sleeper", {
      comfort: 1.9,
      measured: {
        date: M,
        notes: "Points #13–15: Комфорт surge 1.8–1.9×, no hidden Эконом surge",
      },
    }),
  },
  {
    id: "uruchcha",
    nameEn: "Uruchcha",
    nameRu: "Уручье / Боровляны",
    description: "North-east outskirts, beyond MKAD",
    center: [53.96, 27.7],
    radiusM: 2500,
    type: "sleeper",
    surge: buildMatrix("sleeper", {
      comfort: 1.9,
      measured: { date: M, notes: "Point #13: Комфорт 18.6 @ 1.9× from city to Uruchcha" },
    }),
  },
  {
    id: "pobediteley",
    nameEn: "Pobeditelei Ave",
    nameRu: "пр. Победителей",
    description: "West embankment, premium business zone",
    center: [53.92, 27.51],
    radiusM: 2000,
    type: "premium",
    surge: buildMatrix("premium", {
      comfort: 2.2,
      econom: 1.0,
      hiddenEconom: 2.6,
      measured: {
        date: M,
        notes: "Start screen: Эконом ⚡ от 15.8 (×2.6 vs minimum 6.0). Hottest zone observed",
      },
    }),
  },
  {
    id: "kupriyanova",
    nameEn: "Kupriyanova / South",
    nameRu: "Куприянова / Уборевича / юг",
    description: "South residential districts",
    center: [53.85, 27.5],
    radiusM: 2500,
    type: "sleeper",
    surge: buildMatrix("sleeper", {
      comfort: 2.1,
      measured: { date: M, notes: "Points #15, #3 (17:10): Комфорт 21 @ 2.1× to south" },
    }),
  },
  {
    id: "mihalovo",
    nameEn: "Mihalovo / Sport Sci.",
    nameRu: "Михалово / 3 Сентября",
    description: "South-west residential area",
    center: [53.835, 27.485],
    radiusM: 2000,
    type: "sleeper",
    surge: buildMatrix("sleeper", {
      comfort: 1.5,
      econom: 1.0,
      hiddenEconom: 1.67,
      measured: { date: M, notes: "Start screen: Эконом ⚡ от 10 (×1.67). Cooler than Pobeditelei" },
    }),
  },
  {
    id: "kuncevshina",
    nameEn: "Kuntsevshchina / West",
    nameRu: "Кунцевщина / ул. Одинцова / м. Пушкинская",
    description: "Western residential area near Pushkinskaya metro",
    center: [53.888, 27.462],
    radiusM: 1500,
    type: "sleeper",
    surge: buildMatrix("sleeper", {
      comfort: 1.8,
      econom: 1.0,
      hiddenEconom: 2.63,
      measured: {
        date: M,
        notes:
          "Point Одинцова 36к1 → м.Пушкинская 17:39: Эконом ⚡от 15.8 (×2.63 hidden), Комфорт 18 (×1.8), Комфорт+ 18.9 (×1.9), Business 20.9 (×2.1)",
      },
    }),
  },

  // Sleeper districts (predicted)
  {
    id: "kamennaya-gorka",
    nameEn: "Kamennaya Gorka",
    nameRu: "Каменная горка / Сухарево СЗ",
    description: "North-west sleeping district beyond MKAD",
    center: [53.913, 27.428],
    radiusM: 2200,
    type: "sleeper",
    surge: buildMatrix("sleeper", { comfort: 1.5 }),
  },
  {
    id: "suharevo",
    nameEn: "Sukharevo",
    nameRu: "Сухарево / Запад",
    description: "Western sleeping district",
    center: [53.892, 27.435],
    radiusM: 1800,
    type: "sleeper",
    surge: buildMatrix("sleeper", { comfort: 1.5 }),
  },
  {
    id: "malinovka",
    nameEn: "Malinovka",
    nameRu: "Малиновка / Юго-Запад",
    description: "South-west residential",
    center: [53.86, 27.46],
    radiusM: 1500,
    type: "sleeper",
    surge: buildMatrix("sleeper", { comfort: 1.6 }),
  },
  {
    id: "kurasovschina",
    nameEn: "Kurasovshchina",
    nameRu: "Курасовщина / юг",
    description: "Southern residential district",
    center: [53.86, 27.535],
    radiusM: 1700,
    type: "sleeper",
    surge: buildMatrix("sleeper", { comfort: 1.7 }),
  },
  {
    id: "loshitsa",
    nameEn: "Loshitsa",
    nameRu: "Лошица / юг",
    description: "South park & residential area",
    center: [53.838, 27.56],
    radiusM: 1700,
    type: "sleeper",
    surge: buildMatrix("sleeper", { comfort: 1.6 }),
  },
  {
    id: "serebryanka",
    nameEn: "Serebryanka",
    nameRu: "Серебрянка / ЮВ",
    description: "South-east residential district",
    center: [53.864, 27.59],
    radiusM: 1700,
    type: "sleeper",
    surge: buildMatrix("sleeper", { comfort: 1.7 }),
  },
  {
    id: "chizhovka",
    nameEn: "Chizhovka",
    nameRu: "Чижовка / ЮВ",
    description: "South-east residential & reservoir area",
    center: [53.844, 27.625],
    radiusM: 1800,
    type: "sleeper",
    surge: buildMatrix("sleeper", { comfort: 1.5 }),
  },
  {
    id: "shabany",
    nameEn: "Shabany",
    nameRu: "Шабаны / крайний ЮВ",
    description: "Far south-east industrial / sleeping district",
    center: [53.832, 27.66],
    radiusM: 2000,
    type: "industrial",
    surge: buildMatrix("industrial", { comfort: 1.3 }),
  },
  {
    id: "zavodskoy",
    nameEn: "Zavodskoy",
    nameRu: "Заводской район / восток",
    description: "Eastern industrial & residential district",
    center: [53.872, 27.64],
    radiusM: 1800,
    type: "industrial",
    surge: buildMatrix("industrial", { comfort: 1.5 }),
  },
  {
    id: "zeleny-lug",
    nameEn: "Zeleny Lug",
    nameRu: "Зелёный Луг / СВ",
    description: "North-east residential district",
    center: [53.948, 27.605],
    radiusM: 2000,
    type: "sleeper",
    surge: buildMatrix("sleeper", { comfort: 1.7 }),
  },
  {
    id: "vesnyanka",
    nameEn: "Vesnyanka / Drozdy",
    nameRu: "Веснянка / Дрозды / СЗ",
    description: "North-west premium residential",
    center: [53.94, 27.495],
    radiusM: 1800,
    type: "premium",
    surge: buildMatrix("premium", { comfort: 1.8 }),
  },
  {
    id: "cnyanka",
    nameEn: "Tsnyanka",
    nameRu: "Цнянка / водохранилище / север",
    description: "North area near Tsnyanka reservoir",
    center: [53.955, 27.555],
    radiusM: 2000,
    type: "sleeper",
    surge: buildMatrix("sleeper", { comfort: 1.5 }),
  },

  // Shopping malls (predicted, weekend-driven)
  {
    id: "mall-dana",
    nameEn: "Dana Mall",
    nameRu: "ТЦ Dana Mall (СВ)",
    description: "Shopping mall on north-east MKAD",
    center: [53.946, 27.62],
    radiusM: 800,
    type: "mall",
    surge: buildMatrix("mall", { comfort: 1.7 }),
  },
  {
    id: "mall-arena",
    nameEn: "Arena City",
    nameRu: "ТЦ Arena City (Победителей)",
    description: "Shopping mall near Pobeditelei avenue",
    center: [53.918, 27.5],
    radiusM: 800,
    type: "mall",
    surge: buildMatrix("mall", { comfort: 1.8 }),
  },
  {
    id: "mall-galleria",
    nameEn: "Galleria Minsk",
    nameRu: "Galleria Minsk (Купалы)",
    description: "Central shopping mall near city center",
    center: [53.901, 27.555],
    radiusM: 600,
    type: "mall",
    surge: buildMatrix("mall", { comfort: 1.7 }),
  },
  {
    id: "mall-korona-zamok",
    nameEn: "Korona / Zamok",
    nameRu: "ТЦ Корона / Замок (СЗ)",
    description: "Shopping cluster near Kamennaya Gorka",
    center: [53.911, 27.426],
    radiusM: 700,
    type: "mall",
    surge: buildMatrix("mall", { comfort: 1.6 }),
  },
  {
    id: "mall-rivera",
    nameEn: "Riviera Mall",
    nameRu: "ТЦ Ривьера (юг)",
    description: "Shopping mall on south side",
    center: [53.852, 27.526],
    radiusM: 700,
    type: "mall",
    surge: buildMatrix("mall", { comfort: 1.6 }),
  },

  // Airports (asymmetric)
  {
    id: "airport-msq",
    nameEn: "Airport MSQ (city → airport)",
    nameRu: "Аэропорт MSQ (направление: ИЗ города)",
    description: "Asymmetric tariff: ride TO airport — driver returns empty, surge ~9×",
    center: [53.886, 28.04],
    radiusM: 2500,
    type: "airport-out",
    surge: buildMatrix("airport-out", {
      comfort: 9.2,
      econom: 1.4,
      measured: { date: M, notes: "Point: Харьковская → MSQ 91.7 BYN @ 9.2×" },
    }),
  },
  {
    id: "airport-msq-from",
    nameEn: "Airport MSQ (airport → city)",
    nameRu: "Аэропорт MSQ (направление: ИЗ аэропорта)",
    description: "Driver already in queue, no empty return — lower surge ~6×",
    center: [53.886, 28.06],
    radiusM: 1500,
    type: "airport-in",
    surge: buildMatrix("airport-in", {
      comfort: 6.3,
      measured: { date: M, notes: "Point: MSQ → Старовиленская 63 BYN @ 6.3×" },
    }),
  },
];

// Minsk centre and approximate MKAD ring radius (km). Used to clip the
// hex grid so we don't render hexes outside the city.
export const MINSK_CENTER: [number, number] = [53.9006, 27.5586];
export const MKAD_RADIUS_KM = 11;

function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sa));
}

export function distanceKmFromCenter(lat: number, lng: number): number {
  return haversineKm(MINSK_CENTER, [lat, lng]);
}

// Map Leaflet zoom level → H3 resolution. Coarser when zoomed out, finer when zoomed in.
export function zoomToH3Res(zoom: number): number {
  if (zoom <= 11) return 7; // ~1.2 km edge
  if (zoom === 12) return 8; // ~460 m
  return 9; // ~170 m
}

export type InterpolatedSurge = {
  comfort: number;
  econom: number;
  hidden?: number;
  source: "measured" | "blended" | "predicted";
  topZone: Zone;
  observationHits: number;
};

export type ObservationPoint = {
  lat: number;
  lng: number;
  day: DayType;
  slot: TimeSlot;
  comfortSurge?: number;
  economSurge?: number;
  hiddenEconomSurge?: number;
  /**
   * Опциональный вес наблюдения (0..1, default 1.0). Используется для
   * «слабых» точек с менее надёжными данными (например, координаты А/Б
   * приблизительные). Они влияют на интерполяцию пропорционально weight.
   */
  weight?: number;
};

// Дополнительный вес «реальных» наблюдений (внешний JSON или поездки
// пользователя) относительно встроенных модельных зон. 3× даёт уверенный
// сдвиг карты в сторону факта, не перекрывая прогноз полностью.
const OBSERVATION_BOOST = 3;

// Inverse-Distance-Weighted interpolation of surge at an arbitrary point.
// Uses up to 4 nearest zones, weighted by 1/d^2. The closest zone is
// reported as `topZone`; if it sits within ~600 m we trust it directly,
// otherwise we blend.
export function surgeAt(
  lat: number,
  lng: number,
  day: DayType,
  time: TimeSlot,
  extras: ObservationPoint[] = [],
): InterpolatedSurge {
  const distances = ZONES.map((z) => ({
    z,
    d: haversineKm([lat, lng], z.center),
  })).sort((a, b) => a.d - b.d);

  const top = distances.slice(0, 4);
  const closest = top[0];

  let sumWComfort = 0;
  let comfortAcc = 0;
  let sumWEconom = 0;
  let economAcc = 0;
  let hiddenAcc = 0;
  let hiddenW = 0;
  let measuredHits = 0;

  for (const { z, d } of top) {
    const s = z.surge[day][time];
    const w = 1 / Math.pow(Math.max(d, 0.05), 2);
    sumWComfort += w;
    comfortAcc += w * s.comfort;
    sumWEconom += w;
    economAcc += w * s.econom;
    if (s.hiddenEconomSurge !== undefined) {
      hiddenAcc += w * s.hiddenEconomSurge;
      hiddenW += w;
    }
    if (s.source === "measured") measuredHits++;
  }

  // Подмешиваем точечные наблюдения, относящиеся к этому (day, slot).
  let nearestObsKm = Infinity;
  let observationHits = 0;
  for (const o of extras) {
    if (o.day !== day || o.slot !== time) continue;
    const d = haversineKm([lat, lng], [o.lat, o.lng]);
    if (d > 4) continue; // дальше 4 км вклад пренебрежимо мал
    observationHits++;
    if (d < nearestObsKm) nearestObsKm = d;
    // Мульплицируем boost на weight (по умолчанию 1.0). Слабые точки
    // (weight=0.3) дают усиление всего ×0.9 относительно зон, а не ×3.
    const wMul = typeof o.weight === "number" ? o.weight : 1;
    const w = (OBSERVATION_BOOST * wMul / Math.pow(Math.max(d, 0.05), 2));
    if (typeof o.comfortSurge === "number") {
      sumWComfort += w;
      comfortAcc += w * o.comfortSurge;
    }
    if (typeof o.economSurge === "number") {
      sumWEconom += w;
      economAcc += w * o.economSurge;
    }
    if (typeof o.hiddenEconomSurge === "number") {
      hiddenW += w;
      hiddenAcc += w * o.hiddenEconomSurge;
    }
  }

  const comfort = sumWComfort > 0 ? +(comfortAcc / sumWComfort).toFixed(2) : 1;
  const econom = sumWEconom > 0 ? +(economAcc / sumWEconom).toFixed(2) : 1;
  const hidden = hiddenW > 0 ? +(hiddenAcc / hiddenW).toFixed(2) : undefined;

  let source: "measured" | "blended" | "predicted" = "predicted";
  if (nearestObsKm < 0.4) source = "measured";
  else if (closest.d < 0.6 && closest.z.surge[day][time].source === "measured")
    source = "measured";
  else if (measuredHits > 0 || observationHits > 0) source = "blended";

  return { comfort, econom, hidden, source, topZone: closest.z, observationHits };
}

// Russian labels for UI explanations
export const ZONE_TYPE_RU: Record<ZoneType, string> = {
  center: "Центр / Бизнес-кварталы",
  "transport-hub": "Транспортный узел",
  sleeper: "Спальный район",
  mall: "Торговый центр",
  premium: "Премиум-район",
  industrial: "Промзона",
  "airport-out": "Аэропорт MSQ (выезд)",
  "airport-in": "Аэропорт MSQ (прилёт)",
};

export const DAY_RU: Record<DayType, string> = {
  weekday: "будни",
  saturday: "суббота",
  sunday: "воскресенье",
};

export const TIME_RU: Record<TimeSlot, string> = {
  night: "ночь (00–06)",
  morning: "утро (06–10)",
  midday: "день (10–15)",
  evening: "вечер (15–19)",
  late: "поздний вечер (19–23)",
};

// Short reason for the (type × day × time) multiplier value. Anything not
// listed here falls back to a generic description.
const REASON_TABLE: Partial<
  Record<ZoneType, Partial<Record<DayType, Partial<Record<TimeSlot, string>>>>>
> = {
  sleeper: {
    weekday: {
      morning: "жители массово выезжают на работу — спрос высокий, свободных машин в районе мало",
      evening: "обратный поток с работы домой",
      midday: "район пустой, заявок мало",
      night: "ночь — почти никого",
    },
    saturday: {
      morning: "выходное утро, все спят",
      evening: "поездки в гости / в центр (anchor)",
    },
    sunday: { morning: "воскресное утро, заявок очень мало" },
  },
  center: {
    weekday: {
      morning: "приток с окраин, но людей разбрасывает по разным БЦ — заявок умеренно",
      evening: "массовый выезд с работы по домам",
    },
    saturday: { evening: "ночная жизнь, рестораны (anchor)" },
    sunday: { midday: "город спокойный, многие гуляют пешком" },
  },
  mall: {
    weekday: { morning: "ТЦ ещё закрыт или пустой", evening: "после работы заезжают за покупками" },
    saturday: { midday: "пик выходного шопинга" },
    sunday: { midday: "почти такой же пик шопинга, как в субботу" },
  },
  premium: {
    weekday: { morning: "у жителей свободный график — утреннего пика почти нет" },
    saturday: { evening: "anchor, дорогие машины и Comfort+" },
  },
  industrial: {
    weekday: {
      morning: "рабочие смены — небольшой пик",
      evening: "конец смены",
      night: "ночью фабрики не работают",
    },
    saturday: { morning: "выходные — промзона почти мёртвая" },
    sunday: { midday: "выходной, грузопоток минимальный" },
  },
  "transport-hub": {
    weekday: {
      morning: "поезда круглосуточно, очередь машин гасит сёрдж",
      evening: "стабильный поток приезжающих",
    },
  },
  "airport-out": {
    weekday: {
      morning: "из города в аэропорт: водитель возвращается порожняком ~50 км — высокий базовый коэффициент",
    },
    saturday: { evening: "вечерние рейсы — обычная загрузка" },
  },
  "airport-in": {
    weekday: {
      morning: "в город из аэропорта: водитель уже стоит в очереди — нет холостого пробега туда",
    },
  },
};

function multiplierToWord(m: number): string {
  if (m >= 1.1) return "повышенный";
  if (m >= 0.95) return "базовый уровень";
  if (m >= 0.7) return "пониженный";
  return "очень низкий";
}

export type CellExplanation = {
  zoneNameRu: string;
  zoneTypeRu: string;
  dayRu: string;
  timeRu: string;
  multiplier: number;
  /** Базовый сёрдж зоны (будни·полдень = 1.0 по шкале зоны). */
  baselineSurge: number;
  reason: string;
  comfortSurge: number;
  hasHidden: boolean;
};

export function explainCell(
  topZone: Zone,
  day: DayType,
  time: TimeSlot,
  comfortSurge: number,
  hasHidden: boolean,
): CellExplanation {
  const mult = TIME_MULTIPLIERS[topZone.type][day][time];
  const baselineSurge = mult > 0 ? +(comfortSurge / mult).toFixed(2) : comfortSurge;
  const explicit = REASON_TABLE[topZone.type]?.[day]?.[time];
  const reason =
    explicit ??
    `${multiplierToWord(mult)} спрос для типа зоны «${ZONE_TYPE_RU[topZone.type]}»`;
  return {
    zoneNameRu: topZone.nameRu,
    zoneTypeRu: ZONE_TYPE_RU[topZone.type],
    dayRu: DAY_RU[day],
    timeRu: TIME_RU[time],
    multiplier: +mult.toFixed(2),
    baselineSurge,
    reason,
    comfortSurge: +comfortSurge.toFixed(2),
    hasHidden,
  };
}

// Description of how time multipliers were derived for each zone type. Used
// in the Methodology card on the UI.
export const METHODOLOGY: Record<ZoneType, { title: string; reasons: string[] }> = {
  center: {
    title: "Центр / Бизнес-кварталы",
    reasons: [
      "Утро будни ×0.85 — приток с окраин, но людей разбрасывает по разным БЦ → не все ловят такси.",
      "Вечер будни ×0.95 — пик: толпа разъезжается по домам, исходящий поток.",
      "Выходной вечер ×1.0 — anchor (наблюдение 25.04). Ночная жизнь, рестораны.",
      "Воскресенье день ×0.7 — относительно спокойно, гуляют пешком.",
    ],
  },
  "transport-hub": {
    title: "Транспортные узлы (вокзал)",
    reasons: [
      "Поток поездов круглосуточный → стабильный спрос ×0.6–0.95.",
      "Очередь машин на стоянке гасит сёрдж — он редко превышает ×1.1 (anchor).",
    ],
  },
  sleeper: {
    title: "Спальные районы",
    reasons: [
      "Утро будни ×1.15 ← главный пик: жители массово выезжают на работу, машин в районе мало.",
      "Вечер будни ×1.05 — обратный поток, возвращаются домой.",
      "Будни день/ночь ×0.4–0.55 — район пустой, заявок мало.",
      "Выходные утро ×0.5 — все спят.",
      "Суббота вечер ×1.0 (anchor) — поездки в гости / в центр.",
    ],
  },
  mall: {
    title: "Торговые центры",
    reasons: [
      "Суббота днём ×1.2 — главный пик, люди едут на шопинг.",
      "Воскресенье днём ×1.15 — почти такой же пик.",
      "Вечер будни ×1.1 — после работы заезжают за покупками.",
      "Утро будни ×0.5 — ТЦ ещё закрыт или пустой.",
    ],
  },
  premium: {
    title: "Премиум-зоны (Победителей, Дрозды)",
    reasons: [
      "Жители реже ездят на работу в час пик (свободный график) → утренний пик слабее ×0.8.",
      "Спрос плавно растёт к вечеру ×1.0, без резких провалов.",
      "Высокий baseline сёрджа из-за дорогих машин и более дорогого Комфорт+/Business.",
    ],
  },
  industrial: {
    title: "Промзоны (Шабаны, Заводской)",
    reasons: [
      "Малый пик в рабочие часы (×0.85) — рабочие смены.",
      "Вечер будни ×0.85, но в целом весь день низкий уровень ×0.4–0.7.",
      "Выходные мёртвые — фабрики не работают.",
    ],
  },
  "airport-out": {
    title: "Аэропорт MSQ (из города)",
    reasons: [
      "Базовый сёрдж ×9.2 заложен в тариф ─ водитель возвращается из аэропорта порожняком (~50 км).",
      "Слабая суточная динамика — рейсы есть круглосуточно.",
      "Утренние и вечерние рейсы поднимают сёрдж до anchor ×1.0.",
    ],
  },
  "airport-in": {
    title: "Аэропорт MSQ (в город)",
    reasons: [
      "Базовый сёрдж ×6.3 — водитель уже стоит в очереди в аэропорту, нет холостого пробега туда.",
      "Разница ~32 BYN с обратным направлением — асимметрия.",
    ],
  },
};

export function surgeColor(surgeValue: number): string {
  if (surgeValue < 1.0) return "#10b981";
  if (surgeValue < 1.3) return "#84cc16";
  if (surgeValue < 1.7) return "#eab308";
  if (surgeValue < 2.2) return "#f97316";
  if (surgeValue < 4.0) return "#ef4444";
  return "#7c3aed";
}

export function surgeLabel(surgeValue: number): string {
  if (surgeValue < 1.0) return "Discount";
  if (surgeValue < 1.3) return "Calm";
  if (surgeValue < 1.7) return "Normal";
  if (surgeValue < 2.2) return "Busy";
  if (surgeValue < 4.0) return "Hot";
  return "Extreme";
}

/** Цветовая шкала средней скорости (км/ч). */
export function speedColor(kmh: number): string {
  if (kmh < 15) return "#7c2d12"; // багровый — стояк
  if (kmh < 20) return "#dc2626"; // красный
  if (kmh < 28) return "#f97316"; // оранжевый
  if (kmh < 36) return "#eab308"; // жёлтый
  if (kmh < 45) return "#84cc16"; // салатовый
  return "#16a34a"; // зелёный — свободно
}

/** Текстовая метка скорости. */
export function speedLabel(kmh: number): string {
  if (kmh < 15) return "Стояк";
  if (kmh < 20) return "Затор";
  if (kmh < 28) return "Медленно";
  if (kmh < 36) return "Спокойно";
  if (kmh < 45) return "Быстро";
  return "Свободно";
}

export function buildExportJson(): string {
  return JSON.stringify(
    {
      meta: {
        city: "Minsk",
        provider: "RWB Taxi",
        currency: "BYN",
        exportedAt: new Date().toISOString(),
      },
      baseTariff: BASE_TARIFF,
      zoneTypes: TYPE_BASELINE_COMFORT,
      timeMultipliers: TIME_MULTIPLIERS,
      zones: ZONES,
      legend: {
        days: DAYS,
        timeSlots: TIME_SLOTS,
        sourceMeanings: {
          measured: "Real RWB Taxi observation from screenshot",
          predicted: "Model estimate using zone type × day × time multipliers",
        },
      },
    },
    null,
    2,
  );
}

export function buildExportCsv(): string {
  const rows: string[] = [
    "zone_id,zone_name_en,zone_name_ru,zone_type,lat,lng,radius_m,day,time_slot,econom_surge,comfort_surge,hidden_econom_surge,source,measured_at,notes",
  ];
  for (const z of ZONES) {
    for (const day of DAYS) {
      for (const t of TIME_SLOTS) {
        const s = z.surge[day.id][t.id];
        const safeNotes = (s.notes ?? "").replace(/"/g, '""');
        rows.push(
          [
            z.id,
            `"${z.nameEn}"`,
            `"${z.nameRu}"`,
            z.type,
            z.center[0],
            z.center[1],
            z.radiusM,
            day.id,
            t.id,
            s.econom,
            s.comfort,
            s.hiddenEconomSurge ?? "",
            s.source,
            s.measuredAt ?? "",
            `"${safeNotes}"`,
          ].join(","),
        );
      }
    }
  }
  return rows.join("\n");
}

// ============================================================================
// СТРАТЕГИЯ ЦЕНООБРАЗОВАНИЯ RWB TAXI · v2 (2026-04-26)
// ============================================================================
// Гибридная модель: у нас СВОЯ прозрачная сетка цен (фиксированная,
// не зависит от Я.). Я.Такси — только бенчмарк/потолок. Снизу — пол,
// чтобы даже глубокий демпинг не уводил цену в убыток-маркетинг:
//
//   preFloor   = min(rwb_own, ya_estimate × (1 − RWB_DEMPING_VS_YA))
//   final_rwb  = max(RWB_FLOOR, preFloor)
//
// Источник финала (поле `source`):
//   "own"     — наша сетка ≤ потолка → берём свою (честная прозрачная цена)
//   "ceiling" — наша сетка > потолка → спускаемся до Я.×(1−demping) (демпинг)
//   "floor"   — preFloor < RWB_FLOOR → поднимаем до пола (защита от убытка)
//
// Цель: НЕ копировать Я., а строить СВОИ цены с гарантией паритета снизу
// и привлекательности сверху. Водитель работает по фикс. окладу/смене,
// поэтому цена для клиента — маркетинговый рычаг, а не доход водителя.
// ----------------------------------------------------------------------------

/** На сколько RWB обязан быть ниже Я. в момент заказа. 0.10 = на 10%. */
export const RWB_DEMPING_VS_YA = 0.10;

/**
 * Порог сёрджа, выше которого RWB-сетка тоже масштабируется на surge
 * (вариант 3 — гибрид: обычные часы цены не двигаем, в часы пик/ночь
 *  с реальным спросом — повышаем пропорционально). Ниже порога сёрдж
 *  игнорируется, цена остаётся базовой.
 */
export const RWB_OWN_SURGE_THRESHOLD = 1.5;

/** Верхний потолок surge, применяемого к нашей сетке.
 *  По официальному vc.ru/52012 (Я.Такси PR, 2018): даже при формульном ⚡=7
 *  Я.Такси никогда не уходит выше ×2.5–3.0 в большинстве городов. Применяем
 *  ту же дисциплину к собственной сетке RWB — иначе на дальних bar-маршрутах
 *  (Чкалова→спальник вс 22:30, ⚡=4.2) получаем own × 4.2 и улетаем выше Я. */
export const RWB_OWN_SURGE_CAP = 3.0;

/** Минимальная цена поездки в RWB — даже при глубоком демпинге не падаем
 *  ниже этого порога. 7 br = «честный минимум»: оплата подачи + ~5 мин. */
export const RWB_FLOOR = 7.00;

/**
 * КЛАССИЧЕСКАЯ тарифная сетка RWB (как настраивается в CRM таксопарка):
 *   цена = max(minimum, pickup + perKm × km + perMin × min)
 *
 * Параметры подобраны на 11 фактических замерах Я.Такси (sunday-evening,
 * 26.04.2026). Базовая сетка B = выходные-вечер: {0, 7, 1.30, 0.30}.
 * Остальные слоты масштабированы по нашему ⚡-весу относительно неё:
 *
 *   ⚡-вес (день недели × слот) → масштаб perKm/perMin от B:
 *     будни-день      (1.7/2.0 = 0.85) → perKm 1.10, perMin 0.25
 *     будни-вечер     (1.9/2.0 = 0.95) → perKm 1.25, perMin 0.30
 *     будни-ночь      (1.2/2.0 = 0.60) → perKm 0.80, perMin 0.20
 *     выходные-день   (1.5/2.0 = 0.75) → perKm 1.00, perMin 0.25
 *     выходные-вечер  (B)              → perKm 1.30, perMin 0.30  ← калибр
 *     выходные-ночь   (1.2/2.0 = 0.60) → perKm 0.80, perMin 0.20
 *
 * minimum = 7 br (наш пол снизу), pickup = 0 (включена в minimum).
 * ECONOM = COMFORT × 0.95 (как у Я.: 9.39 / 9.86 = 0.952).
 *
 * Эту таблицу можно ВРУЧНУЮ скопировать в CRM таксопарка — она настроена
 * под классический ввод (подача / минимум / руб-км / руб-мин).
 *
 * Слоты времени:
 *   day     = 06:00–17:00 (включает morning + midday)
 *   evening = 17:00–22:00
 *   night   = 22:00–06:00 (включает night + late)
 */
export type DayKind = "weekday" | "weekend";
export type TariffSlot = "day" | "evening" | "night";

export type RwbTariff = {
  pickup: number;    // br, плата за подачу (включается ВСЕГДА)
  minimum: number;   // br, нижняя граница цены поездки
  perKm: number;     // br/км
  perMin: number;    // br/мин в пути
};

/** 6 классических сеток × 2 класса (econom, comfort). */
export const RWB_TARIFF_GRID: Record<TaxiClass, Record<DayKind, Record<TariffSlot, RwbTariff>>> = {
  comfort: {
    weekday: {
      day:     { pickup: 0, minimum: 7, perKm: 1.10, perMin: 0.25 },
      evening: { pickup: 0, minimum: 7, perKm: 1.25, perMin: 0.30 },
      night:   { pickup: 0, minimum: 7, perKm: 0.80, perMin: 0.20 },
    },
    weekend: {
      day:     { pickup: 0, minimum: 7, perKm: 1.00, perMin: 0.25 },
      evening: { pickup: 0, minimum: 7, perKm: 1.30, perMin: 0.30 }, // ← калибр B
      night:   { pickup: 0, minimum: 7, perKm: 0.80, perMin: 0.20 },
    },
  },
  econom: {  // ≈ comfort × 0.95 (как у Я.: 9.39 / 9.86)
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

/** Маппинг (день недели, час) → (DayKind, TariffSlot). */
export function rwbTariffSlot(day: DayType, hour: number): { kind: DayKind; slot: TariffSlot } {
  const kind: DayKind = day === "weekday" ? "weekday" : "weekend";
  let slot: TariffSlot;
  if (hour >= 6 && hour < 17)       slot = "day";
  else if (hour >= 17 && hour < 22) slot = "evening";
  else                              slot = "night";
  return { kind, slot };
}

/** Выбрать правильную тарифную сетку RWB по классу + дню + часу. */
export function rwbTariffFor(cls: TaxiClass, day: DayType, hour: number): RwbTariff & { kind: DayKind; slot: TariffSlot } {
  const { kind, slot } = rwbTariffSlot(day, hour);
  return { ...RWB_TARIFF_GRID[cls][kind][slot], kind, slot };
}

export type RwbOwnBreakdown = {
  tariff: RwbTariff;       // выбранная сетка
  kind: DayKind;           // weekday | weekend
  slot: TariffSlot;        // day | evening | night
  pickup: number;          // br
  minimum: number;         // br
  kmCost: number;          // perKm × km
  minCost: number;         // perMin × min
  rawSum: number;          // pickup + kmCost + minCost (до minimum)
  price: number;           // (max(minimum, rawSum)) × surgeApplied — финал по нашей сетке
  surgeApplied: number;    // 1.0 если surge < threshold, иначе значение surge (вариант 3)
};

/** Расчёт цены RWB по нашей собственной классической сетке.
 *
 *  Если передан `surge ≥ RWB_OWN_SURGE_THRESHOLD` — применяем гибрид (вариант 3):
 *  цена пропорционально масштабируется на surge, чтобы наша сетка тоже
 *  «дышала» вместе со спросом в часы пик / поздним вечером. Ниже порога
 *  surge игнорируется, цена остаётся базовой и не пугает в обычные часы.
 */
export function rwbOwnPrice(
  cls: TaxiClass,
  km: number,
  min: number,
  hour: number,
  day: DayType,
  surge: number = 1.0,
): RwbOwnBreakdown {
  const t = rwbTariffFor(cls, day, hour);
  const kmCost = +(t.perKm * km).toFixed(2);
  const minCost = +(t.perMin * min).toFixed(2);
  const rawSum = +(t.pickup + kmCost + minCost).toFixed(2);
  const baseSum = Math.max(t.minimum, rawSum);
  const surgeApplied = surge >= RWB_OWN_SURGE_THRESHOLD
    ? Math.min(surge, RWB_OWN_SURGE_CAP)
    : 1.0;
  const price = +(baseSum * surgeApplied).toFixed(2);
  return {
    tariff: { pickup: t.pickup, minimum: t.minimum, perKm: t.perKm, perMin: t.perMin },
    kind: t.kind,
    slot: t.slot,
    pickup: t.pickup,
    minimum: t.minimum,
    kmCost,
    minCost,
    rawSum,
    price,
    surgeApplied,
  };
}

export type RwbHybridResult = {
  own: RwbOwnBreakdown;
  yaEstimate: number;
  yaCeiling: number;            // ya × (1 − demping)
  preFloorPrice: number;        // min(own.price, ceiling) ДО применения пола
  finalPrice: number;           // max(RWB_FLOOR, preFloorPrice)
  source: "own" | "ceiling" | "floor"; // что определило финал
  savingsPct: number;           // на сколько % final ниже Я.
  reason: string;               // человеко-читаемое обоснование
};

/** Гибридный расчёт: своя классическая цена + потолок −N% от Я. + пол.
 *  Если передан `surge` ≥ {@link RWB_OWN_SURGE_THRESHOLD} — наша своя сетка
 *  тоже масштабируется на surge (вариант 3 — гибрид). */
export function rwbHybridPrice(args: {
  cls: TaxiClass;
  km: number;
  min: number;
  hour: number;
  day: DayType;
  yaEstimate: number;  // оценка цены Я. в момент заказа (br)
  surge?: number;      // ⚡N оцениваемый нашей моделью (для масштабирования собственной сетки)
}): RwbHybridResult {
  const own = rwbOwnPrice(args.cls, args.km, args.min, args.hour, args.day, args.surge ?? 1.0);
  const yaCeiling = +(args.yaEstimate * (1 - RWB_DEMPING_VS_YA)).toFixed(2);
  const preFloor = Math.min(own.price, yaCeiling);
  const finalPrice = +Math.max(RWB_FLOOR, preFloor).toFixed(2);
  let source: "own" | "ceiling" | "floor";
  let reason: string;
  const surgeNote = own.surgeApplied > 1
    ? ` (surge ×${own.surgeApplied.toFixed(2)} применён)`
    : "";
  if (finalPrice === RWB_FLOOR && preFloor < RWB_FLOOR) {
    source = "floor";
    reason = `демпинг увёл бы цену до ${preFloor.toFixed(2)} br, поднимаем до пола ${RWB_FLOOR} br`;
  } else if (own.price <= yaCeiling) {
    source = "own";
    reason = `своя сетка дешевле потолка (${own.price} ≤ ${yaCeiling}) — берём свою${surgeNote}`;
  } else {
    source = "ceiling";
    reason = `своя сетка${surgeNote} выше потолка (${own.price} > ${yaCeiling}) — спускаемся до −${(RWB_DEMPING_VS_YA * 100).toFixed(0)}% от Я.`;
  }
  const savingsPct = args.yaEstimate > 0
    ? +((1 - finalPrice / args.yaEstimate) * 100).toFixed(1)
    : 0;
  return { own, yaEstimate: args.yaEstimate, yaCeiling, preFloorPrice: preFloor, finalPrice, source, savingsPct, reason };
}
