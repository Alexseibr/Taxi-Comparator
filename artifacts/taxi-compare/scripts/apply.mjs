#!/usr/bin/env node
// v3: BASE_TARIFF плоский (pickup=0, perKm=0, perMin=0, только minimum × surge),
// поэтому автоматическое применение тарифа из learn.mjs больше не нужно.
//
// Эта команда теперь — отчёт о состоянии методологии:
//   pnpm apply              — показать сводку sanity-check + surge-model
//   pnpm apply --confirm    — то же самое (флаг сохранён для обратной совместимости)
//
// Если в будущем sanity-check опровергнет v3 (perKm/perMin > 0.05), эта команда
// напомнит, что нужно вручную пересмотреть BASE_TARIFF в src/lib/zones.ts.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LEARNED = join(ROOT, "scripts/learned");
const SANITY  = join(LEARNED, "sanity-tariff.json");
const MODEL   = join(LEARNED, "surge-model.json");

if (!existsSync(SANITY) || !existsSync(MODEL)) {
  console.error("Не найдены артефакты обучения. Сначала запусти: pnpm learn");
  process.exit(1);
}

const sanity = JSON.parse(readFileSync(SANITY, "utf8"));
const model  = JSON.parse(readFileSync(MODEL,  "utf8"));

console.log("=".repeat(72));
console.log("ОТЧЁТ ПРИМЕНЕНИЯ МЕТОДОЛОГИИ v3");
console.log("=".repeat(72));
console.log(`\nТариф v3 (плоский, в src/lib/zones.ts):`);
console.log(`  Эконом : minimum=${sanity.current.econom.minimum} br, perKm=0, perMin=0, pickup=0`);
console.log(`  Комфорт: minimum=${sanity.current.comfort.minimum} br, perKm=0, perMin=0, pickup=0`);
console.log(`  Цена = minimum × surge (всегда)\n`);

console.log("L1 SANITY (проверка плоской baza):");
console.log(`  Заказов с открытым ⚡N: ${sanity.basedOn}`);
if (sanity.evidence?.regression) {
  const r = sanity.evidence.regression;
  console.log(`  Регрессия baza_Y ~ km, min:`);
  console.log(`    pickup=${r.pickup}, perKm=${r.perKm}, perMin=${r.perMin}, MAE=${r.mae}`);
}
if (sanity.verdict) console.log(`  Вердикт: ${sanity.verdict}`);
if (sanity.warnings?.length) {
  console.log("\n  ⚠ Предупреждения:");
  for (const w of sanity.warnings) console.log(`    - ${w}`);
}

console.log("\nL1 SURGE MODEL ⚡N(km, min, hour):");
for (const [key, info] of Object.entries(model.bySlot)) {
  const reg = info.regression
    ? ` | ${info.regression.formula} (MAE=${info.regression.mae})`
    : "";
  console.log(`  ${key}: n=${info.n}, mean=${info.mean}, std=${info.std}${reg}`);
}
if (model.warnings?.length) {
  console.log("\n  ⚠ Предупреждения:");
  for (const w of model.warnings) console.log(`    - ${w}`);
}

const sanityFailed = sanity.warnings?.some(w => w.includes("Гипотеза v3"));
console.log("\n" + "=".repeat(72));
if (sanityFailed) {
  console.log("❌ ВНИМАНИЕ: гипотеза v3 опровергнута. Нужно вручную пересмотреть");
  console.log("   BASE_TARIFF в src/lib/zones.ts (возможно, Yandex снова не плоский).");
  process.exit(2);
} else {
  console.log("✓ Методология v3 в порядке. Авто-применение тарифа в v3 не требуется");
  console.log("  (тариф плоский, всё обучение — в данных observations.json).");
}
