// Open-Meteo (Минск) — почасовая погода для last-7d + forecast-1d.
// Без ключа, CORS-открытый. Кэш в localStorage на 30 минут.
//
// Используется в трёх местах:
//   1) Инференс цены  — `is_rain` фича модели v2 (см. pricing-model.ts).
//   2) Канарейка тренда — баланс «сейчас дождь / эталон тоже дождь»
//      (см. computeYandexTrend в AdminCalibComparison.tsx).
//   3) Плашка погоды на карте спроса — оператор сразу видит почему сёрдж
//      в районе подскочил (дождь/метель/жара/мороз — см. WeatherStripe).
//
// Ключ карты — `YYYY-MM-DDTHH` в локальном времени Минска (Europe/Minsk).
// Это совпадает с тем, как мы кладём calib (там date+hour локальные).

export type WeatherHour = {
  isRain: 0 | 1;       // precipitation > 0.1 mm/h ИЛИ snowfall > 0
  isSnow: 0 | 1;       // snowfall > 0
  tempC: number;       // °C
};

export type WeatherMap = Map<string, WeatherHour>;

const LS_KEY = "rwb-weather-v1";
const TTL_MS = 30 * 60 * 1000;       // 30 минут
const URL =
  "https://api.open-meteo.com/v1/forecast" +
  "?latitude=53.9&longitude=27.55" +
  // weather_code в hourly нужен чтобы fetchUpcomingPrecip мог отличить
  // ливень (80-82) от обычного дождя (51-65) и грозу (95+).
  "&hourly=temperature_2m,precipitation,snowfall,weather_code" +
  // current=… — снимок «прямо сейчас» (open-meteo обновляет раз в 15 мин).
  // Используется только для виджета погоды на карте — для ML-фич остаётся
  // hourly (точное соответствие времени калибровки).
  "&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,relative_humidity_2m,weather_code,precipitation,snowfall" +
  "&past_days=14&forecast_days=2" +
  "&timezone=Europe%2FMinsk";

/**
 * «Прямо сейчас» — снимок текущей погоды для виджета на карте.
 * НЕ для ML-фич (там нужен hourly за час калибровки), а для оператора:
 * объяснить почему сёрдж в районе подскочил (дождь? метель? жара?).
 */
export type CurrentWeather = {
  /** ISO-строка времени снимка от open-meteo (TZ Минск). */
  timeIso: string;
  /** Температура воздуха °C, может быть отрицательной. */
  tempC: number;
  /** «Ощущается как» (учитывает ветер и влажность) °C. */
  apparentC: number;
  /** Скорость ветра км/ч на 10м. */
  windKmh: number;
  /** Порывы км/ч (сильнее windKmh обычно в 1.5-2 раза). */
  gustKmh: number;
  /** Влажность 0..100. */
  humidity: number;
  /** WMO weather code: 0=ясно, 1-3=переменная, 45/48=туман, 51-67=дождь/морось, 71-86=снег, 95-99=гроза. */
  weatherCode: number;
  /** Осадки мм/ч за последний интервал. */
  precipitationMm: number;
  /** Снегопад см/ч. */
  snowfallCm: number;
};

// `YYYY-MM-DDTHH` в TZ Europe/Minsk
export function weatherKey(d: Date): string {
  // calib в браузере уже работает в локальной TZ юзера, которая у
  // диспетчеров и водителей всегда = Минск. Но для устойчивости форматируем
  // через Intl с явным timeZone=Europe/Minsk.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Minsk",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  let h = parts.find((p) => p.type === "hour")?.value ?? "00";
  if (h === "24") h = "00"; // Intl иногда возвращает 24 — нормализуем
  return `${y}-${m}-${day}T${h.padStart(2, "0")}`;
}

type CacheShape = { fetchedAt: number; raw: unknown };

function readCache(): CacheShape | null {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (!s) return null;
    const parsed = JSON.parse(s) as CacheShape;
    if (
      typeof parsed?.fetchedAt !== "number" ||
      Date.now() - parsed.fetchedAt > TTL_MS
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(raw: unknown): void {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ fetchedAt: Date.now(), raw } as CacheShape),
    );
  } catch {
    /* приватный режим / переполнение — ок, без кэша */
  }
}

function buildMap(raw: unknown): WeatherMap {
  const m: WeatherMap = new Map();
  const r = raw as {
    hourly?: {
      time?: string[];
      precipitation?: number[];
      snowfall?: number[];
      temperature_2m?: number[];
    };
  };
  const times = r?.hourly?.time ?? [];
  const precip = r?.hourly?.precipitation ?? [];
  const snow = r?.hourly?.snowfall ?? [];
  const temp = r?.hourly?.temperature_2m ?? [];
  for (let i = 0; i < times.length; i++) {
    // Open-Meteo с timezone=Europe/Minsk возвращает time как `YYYY-MM-DDTHH:MM`
    // в этой же TZ. Нам нужен ключ `YYYY-MM-DDTHH`.
    const t = times[i];
    if (typeof t !== "string" || t.length < 13) continue;
    const key = t.slice(0, 13); // "2026-04-30T07"
    const p = Number(precip[i] ?? 0);
    const sn = Number(snow[i] ?? 0);
    const tc = Number(temp[i] ?? 0);
    m.set(key, {
      isRain: p > 0.1 || sn > 0 ? 1 : 0,
      isSnow: sn > 0 ? 1 : 0,
      tempC: tc,
    });
  }
  return m;
}

export async function fetchWeather(): Promise<WeatherMap> {
  const cached = readCache();
  if (cached) return buildMap(cached.raw);
  try {
    const res = await fetch(URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const raw = await res.json();
    writeCache(raw);
    return buildMap(raw);
  } catch {
    // Если Open-Meteo недоступен (или CORS заблокировал) — возвращаем пустую
    // карту. Вызывающий код должен трактовать отсутствующий ключ как
    // «погода неизвестна» (isRain=0 по умолчанию, без бонуса фильтрации).
    return new Map();
  }
}

export function getIsRain(d: Date, w: WeatherMap): 0 | 1 {
  return w.get(weatherKey(d))?.isRain ?? 0;
}

/**
 * Снимок «прямо сейчас». Использует тот же кэш что fetchWeather()
 * (один URL, один localStorage ключ — экономим квоту open-meteo).
 * Возвращает null если open-meteo недоступен ИЛИ ответ без поля current
 * (старый кэш версии v1 без current=… параметра).
 */
export async function fetchCurrentWeather(): Promise<CurrentWeather | null> {
  const cached = readCache();
  if (cached) {
    const cur = extractCurrent(cached.raw);
    if (cur) return cur;
    // Кэш есть, но без current — пробьём заново (ниже), кэш перезапишется.
  }
  try {
    const res = await fetch(URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const raw = await res.json();
    writeCache(raw);
    return extractCurrent(raw);
  } catch {
    return null;
  }
}

function extractCurrent(raw: unknown): CurrentWeather | null {
  const r = raw as {
    current?: {
      time?: string;
      temperature_2m?: number;
      apparent_temperature?: number;
      wind_speed_10m?: number;
      wind_gusts_10m?: number;
      relative_humidity_2m?: number;
      weather_code?: number;
      precipitation?: number;
      snowfall?: number;
    };
  };
  const c = r?.current;
  if (!c || typeof c.temperature_2m !== "number") return null;
  return {
    timeIso: typeof c.time === "string" ? c.time : "",
    tempC: c.temperature_2m,
    apparentC:
      typeof c.apparent_temperature === "number"
        ? c.apparent_temperature
        : c.temperature_2m,
    windKmh: typeof c.wind_speed_10m === "number" ? c.wind_speed_10m : 0,
    gustKmh: typeof c.wind_gusts_10m === "number" ? c.wind_gusts_10m : 0,
    humidity: typeof c.relative_humidity_2m === "number" ? c.relative_humidity_2m : 0,
    weatherCode: typeof c.weather_code === "number" ? c.weather_code : 0,
    precipitationMm: typeof c.precipitation === "number" ? c.precipitation : 0,
    snowfallCm: typeof c.snowfall === "number" ? c.snowfall : 0,
  };
}

/**
 * Прогноз на ближайшие 1-3 часа: «через сколько часов начнётся осадок».
 * Используется в WeatherStripe, чтобы оператор заранее видел «через 2ч пойдёт
 * снег» и подготовил флот, а не реагировал постфактум.
 *
 * Логика: смотрим hourly precipitation/snowfall на следующие 3 часа от
 * текущего момента. Если в каком-то часу осадки превысят порог — возвращаем
 * первый такой час. Текущий час игнорируем (его уже показывает CurrentWeather).
 *
 * Возвращает null если:
 *   - open-meteo недоступен ИЛИ кэш без forecast
 *   - в next 3h осадков не ожидается (это нормальный случай — ничего не показываем)
 */
export type UpcomingPrecip = {
  /** Через сколько целых часов начнётся (1, 2 или 3). */
  inHours: 1 | 2 | 3;
  /** "дождь" | "снег" | "ливень». */
  kind: "rain" | "snow" | "shower";
  /** Иконка для вывода. */
  icon: string;
  /** Готовая русская подпись («через 2ч начнётся дождь»). */
  label: string;
};

export async function fetchUpcomingPrecip(): Promise<UpcomingPrecip | null> {
  const cached = readCache();
  let raw = cached?.raw;
  if (!raw) {
    try {
      const res = await fetch(URL, { cache: "no-store" });
      if (!res.ok) return null;
      raw = await res.json();
      writeCache(raw);
    } catch {
      return null;
    }
  }
  return extractUpcoming(raw);
}

function extractUpcoming(raw: unknown): UpcomingPrecip | null {
  const r = raw as {
    hourly?: {
      time?: string[];
      precipitation?: number[];
      snowfall?: number[];
      weather_code?: number[];
    };
  };
  const times = r?.hourly?.time ?? [];
  const precip = r?.hourly?.precipitation ?? [];
  const snow = r?.hourly?.snowfall ?? [];
  const codes = r?.hourly?.weather_code ?? [];
  if (times.length === 0) return null;
  // Ключ текущего часа в локальной TZ Минска
  const nowKey = weatherKey(new Date()); // "2026-05-02T15"
  // Находим индекс текущего часа в hourly.time
  const idxNow = times.findIndex((t) => typeof t === "string" && t.slice(0, 13) === nowKey);
  if (idxNow < 0) return null;
  // Смотрим +1, +2, +3 часа
  for (const offset of [1, 2, 3] as const) {
    const i = idxNow + offset;
    if (i >= times.length) break;
    const p = Number(precip[i] ?? 0);
    const sn = Number(snow[i] ?? 0);
    const code = Number(codes[i] ?? 0);
    // Ливень (80-82) — самое неприятное, выделяем отдельно
    const isShower = code >= 80 && code <= 82;
    const isThunder = code >= 95;
    const isSnow = sn > 0 || (code >= 71 && code <= 77) || (code >= 85 && code <= 86);
    const isRain = p > 0.1 || (code >= 51 && code <= 67);
    if (isShower || isThunder) {
      return {
        inHours: offset,
        kind: "shower",
        icon: isThunder ? "⛈️" : "🌧️",
        label: `через ${offset}ч ${isThunder ? "гроза" : "ливень"}`,
      };
    }
    if (isSnow) {
      return {
        inHours: offset,
        kind: "snow",
        icon: "❄️",
        label: `через ${offset}ч пойдёт снег`,
      };
    }
    if (isRain) {
      return {
        inHours: offset,
        kind: "rain",
        icon: "🌧️",
        label: `через ${offset}ч начнётся дождь`,
      };
    }
  }
  return null;
}

export function describeWeatherCode(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: "☀️", label: "ясно" };
  if (code >= 1 && code <= 3) return { icon: "⛅", label: "облачно" };
  if (code === 45 || code === 48) return { icon: "🌫️", label: "туман" };
  if (code >= 51 && code <= 55) return { icon: "🌦️", label: "морось" };
  if (code >= 56 && code <= 57) return { icon: "🧊", label: "ледяная морось" };
  if (code >= 61 && code <= 65) return { icon: "🌧️", label: "дождь" };
  if (code >= 66 && code <= 67) return { icon: "🧊", label: "ледяной дождь" };
  if (code >= 71 && code <= 75) return { icon: "❄️", label: "снег" };
  if (code === 77) return { icon: "❄️", label: "снежная крупа" };
  if (code >= 80 && code <= 82) return { icon: "🌧️", label: "ливень" };
  if (code >= 85 && code <= 86) return { icon: "❄️", label: "снежный ливень" };
  if (code === 95) return { icon: "⛈️", label: "гроза" };
  if (code === 96 || code === 99) return { icon: "⛈️", label: "гроза с градом" };
  return { icon: "🌡️", label: "погода" };
}

/**
 * Считаем «коэффициент сёрджа» от погоды — насколько погода вероятно
 * подталкивает спрос вверх. 0 = нейтрально, 1 = ожидаем заметный сёрдж,
 * 2 = ожидаем большой сёрдж. Для виджета: цветовая подсказка оператору.
 *
 * Логика эмпирическая (на основе наблюдений Минск 2024-2026):
 *   - Дождь любой    → +0.5
 *   - Сильный дождь  → +1.0 (ливень >5мм/ч)
 *   - Снег           → +0.8
 *   - Метель         → +1.5 (снег + ветер >25)
 *   - Гроза          → +1.0
 *   - Сильный мороз  → +0.5 (≤ -15°C)
 *   - Жара           → +0.3 (≥ 30°C)
 *   - Сильный ветер  → +0.3 (>40 км/ч порывы)
 */
export function weatherSurgeHint(w: CurrentWeather): {
  level: 0 | 1 | 2;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;
  const isRainCode = w.weatherCode >= 51 && w.weatherCode <= 67;
  const isShower = w.weatherCode >= 80 && w.weatherCode <= 82;
  const isSnowCode = (w.weatherCode >= 71 && w.weatherCode <= 77) || (w.weatherCode >= 85 && w.weatherCode <= 86);
  const isThunder = w.weatherCode >= 95;
  if (isShower || w.precipitationMm > 5) {
    score += 1.0;
    reasons.push("ливень");
  } else if (isRainCode || w.precipitationMm > 0.1) {
    score += 0.5;
    reasons.push("дождь");
  }
  if (isSnowCode || w.snowfallCm > 0) {
    score += 0.8;
    reasons.push("снег");
  }
  if (isSnowCode && w.gustKmh > 25) {
    score += 0.7;
    reasons.push("ветер");
  }
  if (isThunder) {
    score += 1.0;
    reasons.push("гроза");
  }
  if (w.tempC <= -15) {
    score += 0.5;
    reasons.push(`мороз ${Math.round(w.tempC)}°`);
  } else if (w.tempC >= 30) {
    score += 0.3;
    reasons.push(`жара ${Math.round(w.tempC)}°`);
  }
  if (w.gustKmh > 40 && !reasons.includes("ветер")) {
    score += 0.3;
    reasons.push(`порывы ${Math.round(w.gustKmh)} км/ч`);
  }
  const level: 0 | 1 | 2 = score >= 1.5 ? 2 : score >= 0.5 ? 1 : 0;
  return { level, reasons };
}
