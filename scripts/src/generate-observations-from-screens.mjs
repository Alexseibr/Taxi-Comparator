#!/usr/bin/env node
/**
 * generate-observations-from-screens.mjs
 *
 * Читает все calib-*.json из CALIB_DIR, вычисляет surge по v4-формуле,
 * пишет observations.json совместимый с public/data/observations.json.
 *
 * Запуск на ВПС:
 *   node generate-observations-from-screens.mjs
 *
 * Переменные окружения:
 *   CALIB_DIR   — путь к calib-файлам (по умолчанию /var/www/rwbtaxi/data/calib)
 *   OUT_FILE    — куда писать (по умолчанию /tmp/observations-export.json)
 */
'use strict';

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CALIB_DIR = process.env.CALIB_DIR || '/var/www/rwbtaxi/data/calib';
const OUT_FILE  = process.env.OUT_FILE  || '/tmp/observations-export.json';

// ── v4 тарифные константы ────────────────────────────────────────────────────
const ECON_PICKUP  = 5.567;
const ECON_PER_KM  = 0.503;
const ECON_PER_MIN = 0.209;
const ECON_MIN_BYN = 6.40;
const CMF_MIN_BYN  = 9.10;

const DOGLEG       = 1.4;   // реальная дорога ≈ 1.4 × хорда (Хаверсин)
const AVG_KMH      = 18;    // средняя скорость по Минску, км/ч

// ── Haversine distance (km) ──────────────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ── День / слот ──────────────────────────────────────────────────────────────
function dayType(dateStr, hour) {
  // dateStr: "2026-04-27"
  const d = new Date(dateStr + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun,1=Mon,...,6=Sat
  if (dow === 0) return 'sunday';
  if (dow === 6) return 'saturday';
  return 'weekday';
}

function timeSlot(hour) {
  if (hour <= 5)  return 'night';
  if (hour <= 9)  return 'morning';
  if (hour <= 14) return 'midday';
  if (hour <= 21) return 'evening';
  return 'late';
}

// ── Surge из цены ────────────────────────────────────────────────────────────
function economSurge(factE, km, min) {
  const base = ECON_PICKUP + ECON_PER_KM * km + ECON_PER_MIN * min;
  if (base < ECON_MIN_BYN) return null; // маршрут слишком короткий → минималка
  const s = factE / base;
  if (!Number.isFinite(s)) return null;
  return Math.max(0.3, Math.min(4.0, s));
}

function comfortSurge(factC) {
  const s = factC / CMF_MIN_BYN;
  if (!Number.isFinite(s)) return null;
  return Math.max(0.5, Math.min(4.0, s));
}

// ── Читаем calib-файлы ───────────────────────────────────────────────────────
const files = readdirSync(CALIB_DIR)
  .filter(f => f.startsWith('calib-') && f.endsWith('.json'))
  .sort();

console.log(`[gen-obs] найдено файлов: ${files.length}`);

const items = [];
let skippedExcluded = 0, skippedCoords = 0, skippedPrices = 0, skippedSurge = 0;

for (const fname of files) {
  let c;
  try { c = JSON.parse(readFileSync(join(CALIB_DIR, fname), 'utf8')); }
  catch { continue; }

  // Фильтр: исключённые из обучения (suburb, duplicate, etc.)
  if (c.excludedFromTraining) { skippedExcluded++; continue; }

  // Нужны координаты обеих точек
  if (!c.fromLat || !c.fromLng || !c.toLat || !c.toLng) { skippedCoords++; continue; }
  // Хотя бы одна цена
  if (!c.factE && !c.factC) { skippedPrices++; continue; }

  // Расстояние и время
  const hav = haversineKm(c.fromLat, c.fromLng, c.toLat, c.toLng);
  const km  = hav * DOGLEG;
  const min = c.tripMin ?? (km / AVG_KMH * 60);

  // Координата наблюдения — середина маршрута
  const lat = (c.fromLat + c.toLat) / 2;
  const lng = (c.fromLng + c.toLng) / 2;

  // Границы Минска
  if (lat < 53.7 || lat > 54.1 || lng < 27.3 || lng > 27.8) { skippedCoords++; continue; }

  const hour = typeof c.hour === 'number' ? c.hour : null;
  if (hour === null) { skippedCoords++; continue; }

  const day  = dayType(c.date, hour);
  const slot = timeSlot(hour);

  // Surge-коэффициенты
  const es = c.factE ? economSurge(c.factE, km, min) : undefined;
  const cs = c.factC ? comfortSurge(c.factC) : undefined;

  // Нужен хотя бы один surge
  if (es === null && cs === null) { skippedSurge++; continue; }
  if (es === undefined && cs === undefined) { skippedSurge++; continue; }

  const obs = {
    id:    c.id,
    lat:   Math.round(lat * 1e6) / 1e6,
    lng:   Math.round(lng * 1e6) / 1e6,
    day,
    slot,
    date:  c.date,
    hour,
    source: c.source || 'screenshot',
    ...(c.operator ? { notes: `op:${c.operator}` } : {}),
    ...(typeof es === 'number' ? { economSurge: Math.round(es * 1000) / 1000 } : {}),
    ...(typeof cs === 'number' ? { comfortSurge: Math.round(cs * 1000) / 1000 } : {}),
    // Сохраняем фактические цены и доп. поля для аналитики
    ...(c.factE ? { factE: c.factE } : {}),
    ...(c.factC ? { factC: c.factC } : {}),
    ...(c.etaMin != null ? { etaMin: c.etaMin } : {}),
    ...(c.demand ? { demand: c.demand } : {}),
    ...(c.fromLat ? { fromLat: c.fromLat, fromLng: c.fromLng } : {}),
    ...(c.toLat   ? { toLat: c.toLat, toLng: c.toLng } : {}),
    ...(c.fromAddress ? { fromAddress: c.fromAddress } : {}),
    ...(c.toAddress   ? { toAddress: c.toAddress } : {}),
    ...(Number.isFinite(km) ? { km: Math.round(km * 10) / 10 } : {}),
    ...(Number.isFinite(min) ? { min: Math.round(min * 10) / 10 } : {}),
  };

  items.push(obs);
}

console.log(`[gen-obs] готово: ${items.length} записей`);
console.log(`[gen-obs] пропущено: excluded=${skippedExcluded} coords=${skippedCoords} prices=${skippedPrices} surge=${skippedSurge}`);

// ── Деdup по id ──────────────────────────────────────────────────────────────
const seen = new Set();
const unique = items.filter(o => { if (seen.has(o.id)) return false; seen.add(o.id); return true; });
console.log(`[gen-obs] уникальных id: ${unique.length}`);

// ── Пишем JSON ───────────────────────────────────────────────────────────────
const out = {
  version:   3,
  updatedAt: new Date().toISOString(),
  generatedBy: 'generate-observations-from-screens.mjs',
  totalCalibFiles: files.length,
  items: unique,
};

writeFileSync(OUT_FILE, JSON.stringify(out));
console.log(`[gen-obs] записано: ${OUT_FILE} (${Math.round(Buffer.byteLength(JSON.stringify(out)) / 1024)} KB)`);
