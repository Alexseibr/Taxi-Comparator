#!/usr/bin/env node
// Миграция observations.json v2 → v3 (с автоисправлением битой первой попытки).
//
// v2 формула: factC = (pickup + perKm·км + perMin·мин) × surge_v2
//             surge_v2 ≈ 0.3..1.5 (наша «слабая модель»)
//
// v3 формула: factC = 10 × surge_v3   (плоская baza Yandex)
//             surge_v3 ≈ 0.3..6.0 (полный множитель к 10br = «⚡N» Yandex)
//
// Соотношение: surge_v3 = surge_v2 × (typical_raw_v2 / 10)
//
// Эмпирические factors по слотам (из 16 заказов с открытым ⚡N):
//   sunday-morning: factor = 1.63  (sC=0.59 → ⚡N=0.96)
//   sunday-midday:  factor = 4.74  (sC=0.73 → ⚡N=3.46)
//   <неизвестно>:   factor = 2.50  (средняя оценка)
//
// MANUAL_OVERRIDES: для записей где в notes явно есть открытый ⚡N — берём его.
//
// Использование:
//   node scripts/migrate-v3.mjs           — dry-run
//   node scripts/migrate-v3.mjs --confirm — применить (идемпотентно)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OBS_FILE = join(__dirname, "..", "public/data/observations.json");
const CONFIRM = process.argv.includes("--confirm");

const FACTORS = {
  "sunday-morning": 1.63,
  "sunday-midday":  4.74,
};
const DEFAULT_FACTOR = 2.50;

// Точные значения (когда в источнике есть открытый ⚡N или averaged-from-screenshots).
const MANUAL_OVERRIDES = {
  "sverdlova-17-2026-04-25-23-16": 1.96, // notes: "Среднее: ×1.96" из 3 замеров скриншотов
};

const obs = JSON.parse(readFileSync(OBS_FILE, "utf8"));

// --- ШАГ 1: автооткат битой v3-миграции (где comfortSurge стал null) ---
const NOTES_RE = /^\s*\[v3 migrate ×([\d.]+): ([^\s]+) → ([^\]]+)\]\s*/;
let reverted = 0;
for (const item of obs.items) {
  if (item.calibrationVersion !== 3) continue;
  if (typeof item.notes !== "string") continue;
  const m = item.notes.match(NOTES_RE);
  if (!m) continue;
  const oldVal = m[2] === "undefined" || m[2] === "null" ? null : Number(m[2]);
  // Откатываем до v2 — следующий шаг сделает корректную v3-миграцию.
  if (oldVal === null || Number.isNaN(oldVal)) {
    delete item.comfortSurge;
  } else {
    item.comfortSurge = oldVal;
  }
  item.calibrationVersion = 2;
  item.notes = item.notes.replace(NOTES_RE, "");
  reverted++;
}

// --- ШАГ 2: правильная v3-миграция (только items с числовым comfortSurge) ---
let migrated = 0, skipped = 0, manualApplied = 0;
const sample = [];
for (const item of obs.items) {
  if (item.calibrationVersion === 3) { skipped++; continue; }
  // Speed-only / прочие записи без замера сёрджа — пропускаем.
  if (typeof item.comfortSurge !== "number") {
    item.calibrationVersion = 3; // помечаем что просмотрено
    skipped++;
    continue;
  }

  const oldSurge = item.comfortSurge;
  let newSurge, factorTag;
  if (item.id in MANUAL_OVERRIDES) {
    newSurge = MANUAL_OVERRIDES[item.id];
    factorTag = "manual";
    manualApplied++;
  } else {
    const key = `${item.day}-${item.slot}`;
    const factor = FACTORS[key] ?? DEFAULT_FACTOR;
    newSurge = +(oldSurge * factor).toFixed(2);
    factorTag = `×${factor}`;
  }
  sample.push({ id: item.id, slot: `${item.day}-${item.slot}`, factor: factorTag, old: oldSurge, new: newSurge });

  if (CONFIRM) {
    item.comfortSurge = newSurge;
    item.calibrationVersion = 3;
    item.notes = `[v3 migrate ${factorTag}: ${oldSurge} → ${newSurge}] ${(item.notes ?? "").trim()}`.trim();
  }
  migrated++;
}

if (CONFIRM) {
  obs.calibrationVersion = 3;
  obs.updatedAt = new Date().toISOString().slice(0, 16);
  writeFileSync(OBS_FILE, JSON.stringify(obs, null, 2));
}

console.log(`observations.json — миграция v2 → v3`);
console.log(`  всего items: ${obs.items.length}`);
console.log(`  откачено битых v3: ${reverted}`);
console.log(`  обновлены (с числовым surge): ${migrated}`);
console.log(`  применено ручных override: ${manualApplied}`);
console.log(`  пропущены (speed-only / уже v3): ${skipped}`);
console.log(`\nПримеры (первые 12):`);
console.log(`  id                                          slot                factor       old → new`);
for (const s of sample.slice(0, 12)) {
  const f = String(s.factor).padEnd(8);
  console.log(`  ${s.id.padEnd(44)} ${s.slot.padEnd(18)} ${f}  ${String(s.old).padStart(5)} → ${String(s.new).padStart(5)}`);
}
console.log(`\n${CONFIRM ? "✓ Файл обновлён." : "[DRY-RUN] Применить: node scripts/migrate-v3.mjs --confirm"}`);
