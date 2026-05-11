import type { DayType, TimeSlot } from "./zones";

export type ObservationOrigin = "external" | "user-trip";

export type DemandLabel = "green" | "yellow" | "red";

export type Observation = {
  id: string;
  lat: number;
  lng: number;
  day: DayType;
  slot: TimeSlot;
  comfortSurge?: number;
  economSurge?: number;
  hiddenEconomSurge?: number;
  date: string;
  source?: string;
  notes?: string;
  address?: string;
  origin: ObservationOrigin;
  /**
   * Опциональные данные о факт. поездке. Если есть km и min — можем вычислить
   * реальную скорость на этом участке и зоне. Из накопленных таких замеров
   * строится локальная карта скоростей по часам/районам, которая корректирует
   * прогноз пробок (см. traffic.ts → inferTrafficFromObservations).
   */
  km?: number;
  min?: number;
  /** Час замера (0..23). Если не задан — выводится из date, иначе из slot. */
  hour?: number;
  /**
   * Опциональный вес наблюдения для IDW (0..1, default 1.0). Используется
   * для «слабых» точек, у которых данные менее надёжны (например, координаты
   * А/Б реверс-инжинирим из скриншота, без точного адреса). Слабые точки
   * влияют на интерполяцию пропорционально weight.
   */
  weight?: number;
  /* --- Поля для замеров через форму на сайте (для дальнейшего обучения) --- */
  fromAddress?: string;
  toAddress?: string;
  fromLat?: number;
  fromLng?: number;
  toLat?: number;
  toLng?: number;
  /** Цена Эконом из Яндекса в BYN. */
  factE?: number;
  /** Цена Комфорт из Яндекса в BYN. */
  factC?: number;
  /** Время подачи водителя в минутах (то, что Яндекс пишет «через X мин приедет»). */
  etaMin?: number;
  /** Метка спроса со светофора Яндекса: зелёный / жёлтый / красный. */
  demand?: DemandLabel;
};

export const VALID_DEMAND: DemandLabel[] = ["green", "yellow", "red"];

export type ObservationsFile = {
  version: number;
  updatedAt?: string;
  items: Omit<Observation, "origin">[];
};

const VALID_DAYS: DayType[] = ["weekday", "saturday", "sunday"];
const VALID_SLOTS: TimeSlot[] = ["night", "morning", "midday", "evening", "late"];

export const USER_TRIPS_KEY = "pzk:user-trips:v1";
export const EXTERNAL_OBSERVATIONS_PATH = "data/observations.json";

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clampLatLng(lat: number, lng: number): boolean {
  // Roughly Minsk + suburbs.
  return lat >= 53.7 && lat <= 54.1 && lng >= 27.3 && lng <= 27.8;
}

export function validateRaw(
  raw: unknown,
  origin: ObservationOrigin,
): Observation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (!isFiniteNumber(r.lat) || !isFiniteNumber(r.lng)) return null;
  if (!clampLatLng(r.lat, r.lng)) return null;
  if (typeof r.day !== "string" || !VALID_DAYS.includes(r.day as DayType)) return null;
  if (typeof r.slot !== "string" || !VALID_SLOTS.includes(r.slot as TimeSlot)) return null;
  if (typeof r.date !== "string" || !r.date) return null;
  const obs: Observation = {
    id: r.id,
    lat: r.lat,
    lng: r.lng,
    day: r.day as DayType,
    slot: r.slot as TimeSlot,
    date: r.date,
    origin,
  };
  if (isFiniteNumber(r.comfortSurge)) obs.comfortSurge = r.comfortSurge;
  if (isFiniteNumber(r.economSurge)) obs.economSurge = r.economSurge;
  if (isFiniteNumber(r.hiddenEconomSurge)) obs.hiddenEconomSurge = r.hiddenEconomSurge;
  if (typeof r.source === "string") obs.source = r.source;
  if (typeof r.notes === "string") obs.notes = r.notes;
  if (typeof r.address === "string") obs.address = r.address;
  if (isFiniteNumber(r.km) && r.km > 0 && r.km < 200) obs.km = r.km;
  if (isFiniteNumber(r.min) && r.min > 0 && r.min < 600) obs.min = r.min;
  if (isFiniteNumber(r.hour) && r.hour >= 0 && r.hour <= 23) obs.hour = r.hour;
  if (isFiniteNumber(r.weight) && r.weight > 0 && r.weight <= 1) obs.weight = r.weight;
  if (typeof r.fromAddress === "string") obs.fromAddress = r.fromAddress;
  if (typeof r.toAddress === "string") obs.toAddress = r.toAddress;
  if (isFiniteNumber(r.fromLat)) obs.fromLat = r.fromLat;
  if (isFiniteNumber(r.fromLng)) obs.fromLng = r.fromLng;
  if (isFiniteNumber(r.toLat)) obs.toLat = r.toLat;
  if (isFiniteNumber(r.toLng)) obs.toLng = r.toLng;
  if (isFiniteNumber(r.factE) && r.factE > 0) obs.factE = r.factE;
  if (isFiniteNumber(r.factC) && r.factC > 0) obs.factC = r.factC;
  if (isFiniteNumber(r.etaMin) && r.etaMin >= 0 && r.etaMin < 120) obs.etaMin = r.etaMin;
  if (typeof r.demand === "string" && VALID_DEMAND.includes(r.demand as DemandLabel)) {
    obs.demand = r.demand as DemandLabel;
  }
  // Need at least one signal: либо surge-данные, либо замер скорости (km+min)
  if (
    obs.comfortSurge === undefined &&
    obs.economSurge === undefined &&
    obs.hiddenEconomSurge === undefined &&
    !(obs.km !== undefined && obs.min !== undefined)
  ) {
    return null;
  }
  return obs;
}

export function parseObservationsFile(
  json: unknown,
  origin: ObservationOrigin = "external",
): { items: Observation[]; errors: string[] } {
  const errors: string[] = [];
  if (!json || typeof json !== "object") {
    return { items: [], errors: ["Файл не является объектом"] };
  }
  const f = json as Partial<ObservationsFile>;
  if (!Array.isArray(f.items)) {
    return { items: [], errors: ["Поле items должно быть массивом"] };
  }
  const items: Observation[] = [];
  f.items.forEach((raw, i) => {
    const obs = validateRaw(raw, origin);
    if (!obs) errors.push(`Пропущена запись #${i + 1} — не прошла валидацию`);
    else items.push(obs);
  });
  return { items, errors };
}

// CSV: id,lat,lng,day,slot,comfortSurge,economSurge,hiddenEconomSurge,date,source,notes
export function parseCsv(
  csvText: string,
  origin: ObservationOrigin = "user-trip",
): { items: Observation[]; errors: string[] } {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { items: [], errors: ["Файл пустой"] };
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const idx = (col: string): number => header.indexOf(col);
  const required = ["id", "lat", "lng", "day", "slot", "date"];
  for (const r of required) {
    if (idx(r) < 0) return { items: [], errors: [`В CSV нет колонки "${r}"`] };
  }
  const items: Observation[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const obj: Record<string, unknown> = {};
    header.forEach((h, j) => {
      const raw = cols[j];
      if (raw === undefined || raw === "") return;
      if (["lat", "lng", "comfortSurge", "economSurge", "hiddenEconomSurge", "km", "min", "hour", "weight", "fromLat", "fromLng", "toLat", "toLng", "factE", "factC", "etaMin"].includes(h)) {
        const n = Number(raw.replace(",", "."));
        if (Number.isFinite(n)) obj[h] = n;
      } else {
        obj[h] = raw;
      }
    });
    const obs = validateRaw(obj, origin);
    if (!obs) errors.push(`Строка #${i + 1}: не прошла валидацию`);
    else items.push(obs);
  }
  return { items, errors };
}

// Минимальный split CSV с поддержкой кавычек.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function loadUserTrips(): Observation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(USER_TRIPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const { items } = parseObservationsFile(parsed, "user-trip");
    return items;
  } catch {
    return [];
  }
}

export function saveUserTrips(items: Observation[]): void {
  if (typeof window === "undefined") return;
  const file: ObservationsFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: items.map(({ origin: _o, ...rest }) => rest),
  };
  window.localStorage.setItem(USER_TRIPS_KEY, JSON.stringify(file));
  // Сообщаем подписчикам в этой же вкладке.
  window.dispatchEvent(new CustomEvent("pzk:user-trips-changed"));
}

export function clearUserTrips(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(USER_TRIPS_KEY);
  window.dispatchEvent(new CustomEvent("pzk:user-trips-changed"));
}
