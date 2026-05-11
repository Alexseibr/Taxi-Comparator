#!/usr/bin/env node
// Обогащение датасета исторической погодой Open-Meteo.
// Для каждого order'a в scripts/learned/dataset.json берём
// (fromLat, fromLng, date, hour) и фетчим precipitation/snowfall/temp/wind
// в час заказа. Кэшируем по (lat0.01, lng0.01, date) — Open-Meteo всё
// равно отдаёт сразу 24 hourly за день.
//
// Источник: https://api.open-meteo.com/v1/forecast (past_days до 92)
//   + https://archive-api.open-meteo.com/v1/archive (для старых дат)
// Бесплатный, без API-ключа.
//
// Выход: scripts/learned/weather.json — map<orderId, weatherRow>
//   { precipMm, rainMm, snowCm, tempC, windKmh, isWet, isSnow, raw }
//
// Вызов: node scripts/enrich/weather.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DATASET = join(ROOT, "scripts/learned/dataset.json");
const CACHE   = join(ROOT, "scripts/learned/weather-cache.json");
const OUT     = join(ROOT, "scripts/learned/weather.json");

const TZ = "Europe/Minsk";
const ROUND = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;

// Кэш: { "lat_lng_date": { hourly: { time:[], precipitation:[], ... } } }
let cache = {};
if (existsSync(CACHE)) {
  try { cache = JSON.parse(readFileSync(CACHE, "utf8")); }
  catch { cache = {}; }
}

const dataset = JSON.parse(readFileSync(DATASET, "utf8"));
const todayStr = new Date().toISOString().slice(0, 10);

function chooseEndpoint(date) {
  // Open-Meteo Forecast: past_days до 92, форкаст 16
  // Archive: всё что глубже, задержка ~5 дней
  const dt = new Date(date + "T00:00:00Z").getTime();
  const now = Date.now();
  const ageDays = (now - dt) / 86_400_000;
  if (ageDays <= 90 && ageDays >= -10) {
    return {
      base: "https://api.open-meteo.com/v1/forecast",
      // запросим окно с запасом ±2 дня вокруг даты
      params: { past_days: Math.min(92, Math.max(0, Math.ceil(ageDays) + 2)),
                forecast_days: Math.max(1, Math.ceil(-ageDays) + 2) },
    };
  }
  return {
    base: "https://archive-api.open-meteo.com/v1/archive",
    params: { start_date: date, end_date: date },
  };
}

async function fetchWeather(lat, lng, date) {
  const key = `${ROUND(lat, 2)}_${ROUND(lng, 2)}_${date}`;
  if (cache[key]) return { key, data: cache[key], cached: true };

  const ep = chooseEndpoint(date);
  const url = new URL(ep.base);
  url.searchParams.set("latitude", String(ROUND(lat, 4)));
  url.searchParams.set("longitude", String(ROUND(lng, 4)));
  url.searchParams.set("hourly",
    "precipitation,rain,snowfall,temperature_2m,wind_speed_10m");
  url.searchParams.set("timezone", TZ);
  for (const [k, v] of Object.entries(ep.params)) {
    url.searchParams.set(k, String(v));
  }

  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`Open-Meteo ${r.status} ${r.statusText} for ${url}`);
  const j = await r.json();
  if (!j.hourly?.time) throw new Error(`No hourly in response: ${JSON.stringify(j).slice(0,200)}`);

  // вырезаем только нужный день из hourly (24 точки)
  const idx = j.hourly.time.map((t, i) => t.startsWith(date) ? i : -1).filter(i => i >= 0);
  const slim = {
    time:           idx.map(i => j.hourly.time[i]),
    precipitation:  idx.map(i => j.hourly.precipitation?.[i] ?? 0),
    rain:           idx.map(i => j.hourly.rain?.[i] ?? 0),
    snowfall:       idx.map(i => j.hourly.snowfall?.[i] ?? 0),
    temperature_2m: idx.map(i => j.hourly.temperature_2m?.[i] ?? null),
    wind_speed_10m: idx.map(i => j.hourly.wind_speed_10m?.[i] ?? null),
  };
  cache[key] = { fetchedAt: new Date().toISOString(), date, hourly: slim };
  return { key, data: cache[key], cached: false };
}

function pickHour(weatherDay, hour) {
  const idx = weatherDay.hourly.time.findIndex(t => {
    // t = "2026-04-26T15:00"
    const h = parseInt(t.slice(11, 13), 10);
    return h === hour;
  });
  if (idx < 0) return null;
  const precipMm = +weatherDay.hourly.precipitation[idx] || 0;
  const rainMm   = +weatherDay.hourly.rain[idx] || 0;
  const snowCm   = +weatherDay.hourly.snowfall[idx] || 0;
  const tempC    = weatherDay.hourly.temperature_2m[idx];
  const windKmh  = weatherDay.hourly.wind_speed_10m[idx];
  return {
    precipMm: +precipMm.toFixed(2),
    rainMm:   +rainMm.toFixed(2),
    snowCm:   +snowCm.toFixed(2),
    tempC:    tempC !== null ? +Number(tempC).toFixed(1) : null,
    windKmh:  windKmh !== null ? +Number(windKmh).toFixed(1) : null,
    // классификации:
    isWet:  precipMm >= 0.5,
    isSnow: snowCm   >= 0.1,
    isCold: tempC !== null && tempC <= -5,
  };
}

const out = {};
let cachedHits = 0, fetched = 0, errs = 0;
for (const o of dataset.orders) {
  if (o.fromLat == null || o.fromLng == null) continue;
  try {
    const { data, cached } = await fetchWeather(o.fromLat, o.fromLng, o.date);
    cached ? cachedHits++ : fetched++;
    const w = pickHour(data, o.hour);
    if (w) out[o.id] = w;
  } catch (e) {
    errs++;
    console.warn(`[weather] order ${o.id} (${o.date} ${o.hour}h ${o.fromAddr}): ${e.message}`);
  }
}

mkdirSync(dirname(CACHE), { recursive: true });
writeFileSync(CACHE, JSON.stringify(cache, null, 2));
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: "Open-Meteo (forecast/archive)",
  n: Object.keys(out).length,
  byOrderId: out,
}, null, 2));

// сводка по wet/snow/temp
const vals = Object.values(out);
const wet  = vals.filter(w => w.isWet).length;
const snow = vals.filter(w => w.isSnow).length;
const temps = vals.map(w => w.tempC).filter(t => t !== null);
const tMin = temps.length ? Math.min(...temps) : null;
const tMax = temps.length ? Math.max(...temps) : null;

console.log(`[weather] orders enriched: ${Object.keys(out).length}`);
console.log(`[weather]   cache hits: ${cachedHits}, fetched: ${fetched}, errors: ${errs}`);
console.log(`[weather]   wet (precip≥0.5mm): ${wet}/${vals.length}`);
console.log(`[weather]   snow (≥0.1cm):     ${snow}/${vals.length}`);
console.log(`[weather]   temp range: ${tMin}..${tMax} °C`);
console.log(`[weather]   → ${OUT}`);
