/**
 * Time-of-day + weather + events surge model for Yandex Go in Minsk.
 *
 * The model produces a smooth multiplier in [1.0, 2.4] driven by:
 *  - Morning commute peak (~07:00–10:00, peak 08:30)
 *  - Evening commute peak (~17:00–20:00, peak 18:30) — the strongest peak
 *  - Friday/Saturday nightlife window (22:00–03:00) — moderate
 *  - Weather: rain (+15%), snow (+25%), frost < -10°C (+8%), heat > 30°C (+5%)
 *  - City events: Dinamo matches, concerts, holidays — from minsk-events.ts
 *  - Per-route volatility hash-jitter so airport / nightlife routes react
 *    sharper than calm residential ones
 *  - A small captured-at jitter so consecutive snapshots feel slightly noisy
 *    even within the same 20-min slot
 *
 * The model is intentionally deterministic given (date, routeId) so a forecast
 * line can be drawn for the next 24h and verified against history.
 */

import type { WeatherContext } from "./weather-client";
import { getEventSurgeMult, getActiveEvents } from "./minsk-events";

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function gaussian(x: number, center: number, sigma: number): number {
  const d = x - center;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

/**
 * Minsk-time hour float in [0, 24).
 *
 * Belarus is on Moscow Time (UTC+3) year-round with no DST since 2011, so we
 * can safely shift from UTC by a fixed +3h offset instead of relying on the
 * server's local timezone (which is typically UTC in containers).
 */
const MINSK_OFFSET_HOURS = 3;

function minskHour(date: Date): number {
  const utc =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;
  return (utc + MINSK_OFFSET_HOURS) % 24;
}

/** Day-of-week in Minsk: 0 = Sunday … 6 = Saturday. */
function minskDayOfWeek(date: Date): number {
  const shifted = new Date(date.getTime() + MINSK_OFFSET_HOURS * 60 * 60 * 1000);
  return shifted.getUTCDay();
}

export interface SurgeBreakdown {
  multiplier: number;
  morning: number;
  evening: number;
  nightlife: number;
  /** Weather additive component (rain/snow/temp). */
  weather: number;
  /** Event multiplicative component (1.0 if no events active). */
  eventMult: number;
  /** Name of the active event (if any). */
  eventName: string | null;
  jitter: number;
  /** Highest-magnitude contribution name, used to tag a snapshot. */
  driver: "morning_rush" | "evening_rush" | "nightlife" | "weather" | "event" | "calm";
}

/**
 * Compute weather additive contribution to surge.
 *
 * Rain:    +0.15 base (demand spikes because people avoid walking)
 * Snow:    +0.25 (worse than rain — slower roads + fleet shortage)
 * Frost:   +0.08 when tempC < -10 (cold start, driver reluctance)
 * Heat:    +0.05 when tempC > 30 (A/C demand spike)
 * Thunderstorm (WMO 95-99): additional +0.10
 */
function computeWeatherComponent(wx: WeatherContext): number {
  let w = 0;
  if (wx.isSnow) {
    w += 0.25;
  } else if (wx.isRain) {
    w += 0.15;
  }
  if (wx.tempC < -10) w += 0.08;
  if (wx.tempC > 30) w += 0.05;
  if (wx.weatherCode >= 95) w += 0.10; // thunderstorm on top
  return w;
}

export function computeSurge(
  date: Date,
  routeId: string,
  volatility: number,
  wx?: WeatherContext,
): SurgeBreakdown {
  const h = minskHour(date);
  const dow = minskDayOfWeek(date);

  const routeHash = hash(routeId);
  const peakBoost = volatility;

  // Morning rush — Mon–Fri only.
  const isWeekday = dow >= 1 && dow <= 5;
  const morning = isWeekday ? 0.45 * peakBoost * gaussian(h, 8.5, 1.1) : 0;

  // Evening rush — Mon–Fri stronger, Sat lighter.
  const eveningWeight = isWeekday ? 0.6 : dow === 6 ? 0.35 : 0.2;
  const evening = eveningWeight * peakBoost * gaussian(h, 18.5, 1.4);

  // Nightlife — Fri night and Sat night, with the curve wrapping past midnight.
  let nightlife = 0;
  if (dow === 5 || dow === 6) {
    const wrapped = h < 6 ? h + 24 : h;
    nightlife = 0.4 * peakBoost * gaussian(wrapped, 25, 2.2);
  }

  // ── Weather component ────────────────────────────────────────────────────
  const weatherComponent = wx ? computeWeatherComponent(wx) : 0;

  // ── City events ──────────────────────────────────────────────────────────
  const eventMult = getEventSurgeMult(date);
  const activeEvents = getActiveEvents(date);
  const eventName = activeEvents.length > 0 ? activeEvents[0]!.name : null;

  // Per-route deterministic jitter (-0.06..+0.06)
  const minuteSlot = Math.floor(date.getTime() / (20 * 60 * 1000));
  const j = ((routeHash ^ minuteSlot) % 1000) / 1000 - 0.5;
  const jitter = j * 0.12 * (0.5 + volatility);

  // Apply weather and events:
  //   raw_time = 1.0 + morning + evening + nightlife + weather + jitter
  //   final = raw_time * eventMult  (event scales everything)
  const rawTime = 1.0 + morning + evening + nightlife + weatherComponent + jitter;
  const rawFinal = rawTime * eventMult;
  const multiplier = Math.min(2.4, Math.max(0.95, rawFinal));

  // Determine primary driver
  let driver: SurgeBreakdown["driver"] = "calm";
  if (eventMult > 1.15) {
    driver = "event";
  } else {
    const peaks: Array<[SurgeBreakdown["driver"], number]> = [
      ["morning_rush", morning],
      ["evening_rush", evening],
      ["nightlife", nightlife],
      ["weather", weatherComponent],
    ];
    const top = peaks.reduce((acc, cur) => (cur[1] > acc[1] ? cur : acc));
    if (top[1] > 0.08) driver = top[0];
  }

  return {
    multiplier,
    morning,
    evening,
    nightlife,
    weather: weatherComponent,
    eventMult,
    eventName,
    jitter,
    driver,
  };
}

/**
 * Generate forecast points for the next `hoursAhead` hours at `stepMinutes`
 * resolution starting from `from`.
 *
 * @param weatherByStep Optional pre-fetched weather for each step index.
 *   If provided, must have length >= total steps. If omitted, weather
 *   component is zero (legacy behaviour).
 */
export function forecastSurge(
  from: Date,
  routeId: string,
  volatility: number,
  hoursAhead = 24,
  stepMinutes = 20,
  weatherByStep?: WeatherContext[],
): Array<{
  at: Date;
  multiplier: number;
  driver: SurgeBreakdown["driver"];
  eventName: string | null;
  weatherContrib: number;
}> {
  const out: Array<{
    at: Date;
    multiplier: number;
    driver: SurgeBreakdown["driver"];
    eventName: string | null;
    weatherContrib: number;
  }> = [];
  const stepMs = stepMinutes * 60 * 1000;
  const total = Math.ceil((hoursAhead * 60) / stepMinutes);
  for (let i = 0; i < total; i++) {
    const at = new Date(from.getTime() + i * stepMs);
    const wx = weatherByStep?.[i];
    const s = computeSurge(at, routeId, volatility, wx);
    out.push({
      at,
      multiplier: s.multiplier,
      driver: s.driver,
      eventName: s.eventName,
      weatherContrib: s.weather,
    });
  }
  return out;
}
