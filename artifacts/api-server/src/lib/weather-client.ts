/**
 * Server-side Open-Meteo client for Minsk weather.
 *
 * Fetches hourly temperature + precipitation forecast and caches the result
 * in memory for 15 minutes. Used by the surge model and the demand-forecast
 * endpoint so every route snapshot reflects current weather conditions.
 *
 * Belarus is UTC+3 year-round (no DST since 2011).
 */

import { logger } from "./logger";

const MINSK_LAT = 53.9;
const MINSK_LNG = 27.55;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const OPEN_METEO_URL =
  `https://api.open-meteo.com/v1/forecast` +
  `?latitude=${MINSK_LAT}&longitude=${MINSK_LNG}` +
  `&hourly=temperature_2m,precipitation,snowfall,weather_code` +
  `&past_days=1&forecast_days=3` +
  `&timezone=Europe%2FMinsk`;

export interface WeatherContext {
  /** 1 if rain or snowfall is present (precipitation > 0.1 mm/h OR snowfall > 0) */
  isRain: boolean;
  /** 1 if snowfall > 0 */
  isSnow: boolean;
  /** Temperature in °C */
  tempC: number;
  /** WMO weather code (0 = clear, 95+ = thunderstorm) */
  weatherCode: number;
}

interface OpenMeteoHourly {
  time: string[];
  temperature_2m: number[];
  precipitation: number[];
  snowfall: number[];
  weather_code: number[];
}

interface OpenMeteoResponse {
  hourly: OpenMeteoHourly;
}

/** Key: "YYYY-MM-DDTHH" in Europe/Minsk time */
type WeatherCache = Map<string, WeatherContext>;

let cache: WeatherCache | null = null;
let cacheAt = 0;
let fetchPromise: Promise<WeatherCache> | null = null;

function parseCache(data: OpenMeteoResponse): WeatherCache {
  const map: WeatherCache = new Map();
  const h = data.hourly;
  for (let i = 0; i < h.time.length; i++) {
    // time comes as "YYYY-MM-DDTHH:MM" — we only need the hour part
    const key = h.time[i]!.substring(0, 13); // "YYYY-MM-DDTHH"
    const precip = h.precipitation[i] ?? 0;
    const snow = h.snowfall[i] ?? 0;
    const temp = h.temperature_2m[i] ?? 0;
    const code = h.weather_code[i] ?? 0;
    map.set(key, {
      isRain: precip > 0.1 || snow > 0,
      isSnow: snow > 0,
      tempC: temp,
      weatherCode: code,
    });
  }
  return map;
}

async function doFetch(): Promise<WeatherCache> {
  const resp = await fetch(OPEN_METEO_URL, {
    headers: { "User-Agent": "rwbtaxi-surge-model/1.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!resp.ok) throw new Error(`Open-Meteo HTTP ${resp.status}`);
  const data = (await resp.json()) as OpenMeteoResponse;
  return parseCache(data);
}

async function getWeatherCache(): Promise<WeatherCache> {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;

  if (!fetchPromise) {
    fetchPromise = doFetch()
      .then((c) => {
        cache = c;
        cacheAt = Date.now();
        fetchPromise = null;
        return c;
      })
      .catch((err) => {
        fetchPromise = null;
        logger.warn({ err: String(err) }, "weather-client: Open-Meteo fetch failed; using stale or default");
        if (cache) return cache;
        throw err;
      });
  }
  return fetchPromise;
}

/**
 * Returns weather context for the given UTC Date.
 * Converts to Europe/Minsk hour key (UTC+3) and looks up the hourly forecast.
 * Falls back to a neutral (dry, +15°C) context if the API is unavailable.
 */
export async function getWeatherAt(date: Date): Promise<WeatherContext> {
  const FALLBACK: WeatherContext = { isRain: false, isSnow: false, tempC: 15, weatherCode: 0 };
  try {
    const map = await getWeatherCache();
    // Convert UTC date to Minsk hour key "YYYY-MM-DDTHH"
    const minskMs = date.getTime() + 3 * 60 * 60 * 1000;
    const minskDate = new Date(minskMs);
    const y = minskDate.getUTCFullYear();
    const mo = String(minskDate.getUTCMonth() + 1).padStart(2, "0");
    const d = String(minskDate.getUTCDate()).padStart(2, "0");
    const h = String(minskDate.getUTCHours()).padStart(2, "0");
    const key = `${y}-${mo}-${d}T${h}`;
    return map.get(key) ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/**
 * Returns a map of weather contexts for a range of dates (one per hour).
 * More efficient than calling getWeatherAt() in a loop since it only hits
 * the cache once.
 */
export async function getWeatherRange(
  from: Date,
  count: number,
  stepMs: number,
): Promise<WeatherContext[]> {
  const FALLBACK: WeatherContext = { isRain: false, isSnow: false, tempC: 15, weatherCode: 0 };
  try {
    const map = await getWeatherCache();
    const out: WeatherContext[] = [];
    for (let i = 0; i < count; i++) {
      const ms = from.getTime() + i * stepMs;
      const minskMs = ms + 3 * 60 * 60 * 1000;
      const d = new Date(minskMs);
      const y = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dy = String(d.getUTCDate()).padStart(2, "0");
      const h = String(d.getUTCHours()).padStart(2, "0");
      const key = `${y}-${mo}-${dy}T${h}`;
      out.push(map.get(key) ?? FALLBACK);
    }
    return out;
  } catch {
    return Array.from({ length: count }, () => ({ ...FALLBACK }));
  }
}
