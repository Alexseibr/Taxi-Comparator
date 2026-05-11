#!/usr/bin/env node
/**
 * Берёт scripts/learned/dataset.json (110 заказов A — B исключён фильтром
 * в learn.mjs) и переписывает public/data/observations.json. Каждый заказ
 * становится observation в точке отправления (pickup) — именно там Y. видит
 * локальный спрос и формирует ⚡N. Значения surge напрямую из факта (yaSurgeC,
 * hb для эконома). Это даёт фронту 100+ живых точек для IDW без ручной работы.
 *
 * Базовые наблюдения из старых ручных скриншотов (sverdlova, sobinova, и т.д.)
 * сохраняются как preserved — у них id не начинается с 4-значной цифры заказа.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATASET_PATH = join(ROOT, "scripts", "learned", "dataset.json");
const OBS_PATH = join(ROOT, "public", "data", "observations.json");

const ds = JSON.parse(readFileSync(DATASET_PATH, "utf8"));
const obsFile = JSON.parse(readFileSync(OBS_PATH, "utf8"));

// Сохраняем все ручные/исторические записи: id вида "address-YYYY-MM-DD-HH-MM"
// или "speed-..." (точки скоростей). Перезаписываем только те, что уже от
// автоматической калибровки (id начинается с calib-).
const preserved = obsFile.items.filter(
  (it) => !String(it.id).startsWith("calib-"),
);

// Маппинг hourly slot → 5-слотовая UI-схема фронта.
// learn.mjs пишет `slot = "h{hour}"` в dataset.json. Но фронт
// `src/lib/observations.ts` валидирует только {night|morning|midday|evening|late},
// иначе точка отбрасывается и не попадает в IDW. Здесь конвертируем перед
// записью в public/data/observations.json.
function hourToUiSlot(hour) {
  if (typeof hour !== "number" || Number.isNaN(hour)) return "midday";
  if (hour >= 0  && hour <= 6 ) return "night";
  if (hour >= 7  && hour <= 10) return "morning";
  if (hour >= 11 && hour <= 14) return "midday";
  if (hour >= 15 && hour <= 19) return "evening";
  return "late";
}

// Hidden boost для Эконома по бакетам sC (из learned/hidden-boost.json,
// захардкожено для устойчивости — это та же таблица что в zones.ts:261).
function hbForSC(sC) {
  if (sC < 1.0) return 0.891;
  if (sC < 1.3) return 0.969;
  if (sC < 1.6) return 0.948;
  if (sC < 2.0) return 0.965;
  if (sC < 2.5) return 0.963;
  if (sC < 4.0) return 0.96;
  if (sC < 7.0) return 0.95;
  return 0.979;
}

// Вес наблюдения: для дальних/outliers снижаем, чтобы один аэропортный
// замер не «оттягивал» весь IDW в радиусе 4 км.
function weightFor(o) {
  if (o.km > 50) return 0.4; // загородные — слабый сигнал для городской карты
  if (o.km > 30) return 0.6;
  if (o.yaSurgeC < 0.7 || o.yaSurgeC > 5) return 0.7; // экстремумы
  return 1.0;
}

const calibItems = [];
for (const o of ds.orders) {
  // Оставляем только заказы с открытым ⚡N (yaSurgeC != null) — иначе нет смысла.
  if (o.yaSurgeC == null) continue;
  // Координаты pickup должны лежать в bbox Минска (см. clampLatLng).
  if (
    o.fromLat == null ||
    o.fromLng == null ||
    o.fromLat < 53.7 ||
    o.fromLat > 54.1 ||
    o.fromLng < 27.3 ||
    o.fromLng > 27.8
  )
    continue;

  const sC = +o.yaSurgeC;
  const hb = hbForSC(sC);
  const sE = +(sC * hb).toFixed(2);

  calibItems.push({
    id: `calib-${o.id}`,
    lat: +o.fromLat.toFixed(4),
    lng: +o.fromLng.toFixed(4),
    day: o.day,
    slot: hourToUiSlot(o.hour),
    comfortSurge: +sC.toFixed(2),
    economSurge: sE,
    hiddenEconomSurge: +hb.toFixed(3),
    calibrationVersion: 3,
    date: o.date,
    source: "rwb-calibration-run",
    address: o.fromAddr || "",
    weight: weightFor(o),
    notes: `Прогон ${o.sourceFile.replace(".results.json", "")}: ${o.fromAddr} → ${o.toAddr}, ${o.km?.toFixed?.(1) ?? "?"} км, ⚡${sC.toFixed(2)}.`,
    km: +o.km?.toFixed?.(2),
    min: +o.min?.toFixed?.(1),
    hour: o.hour,
  });
}

const merged = [...preserved, ...calibItems];

const out = {
  $schema: "./observations.schema.json",
  version: 2,
  calibrationVersion: 3,
  updatedAt: new Date().toISOString().slice(0, 16),
  items: merged,
};

writeFileSync(OBS_PATH, JSON.stringify(out, null, 2) + "\n");

console.log(
  `✓ observations.json обновлён: ${preserved.length} ручных + ${calibItems.length} калибровочных = ${merged.length} точек`,
);
console.log(`  файл: ${OBS_PATH}`);
