#!/usr/bin/env node
// Import-batch: разворачивает батч-CSV в orders.json для `pnpm calib`.
//
// Идея: сотрудник снимает 5–10 скринов из ОДНОЙ точки А в фиксированный
// час. Чтобы не дублировать адрес «А» и адреса целей в каждой строке,
// в CSV пишутся только индексы направлений из шаблона.
//
// Использование:
//   pnpm import-batch <template.json> <batch.csv>
//
// CSV формат (имена колонок обязательные, порядок не важен):
//   date,hour,destIdx,factE,factC,etaMin,demand
//   2026-04-27,14,0,12.5,15.0,5,green
//   2026-04-27,14,1,18.0,21.5,7,yellow
//
// destIdx — 0-based индекс в template.destinations
// demand  — green | yellow | red (опционально)
// factE/factC — можно одно из двух пустым (если этого класса не было)
// etaMin — подача (минуты до водителя), можно пусто
//
// Выход: scripts/orders/manual-<date>.json (по одному файлу на каждую дату).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ORDERS_DIR = join(ROOT, "scripts/orders");

const [, , templatePath, csvPath] = process.argv;
if (!templatePath || !csvPath) {
  console.error("Использование: pnpm import-batch <template.json> <batch.csv>");
  process.exit(1);
}
if (!existsSync(templatePath)) { console.error(`Не найден шаблон: ${templatePath}`); process.exit(1); }
if (!existsSync(csvPath))      { console.error(`Не найден CSV: ${csvPath}`);            process.exit(1); }

const tpl = JSON.parse(readFileSync(templatePath, "utf8"));
if (!tpl.from || !Array.isArray(tpl.fromCoords) || !Array.isArray(tpl.destinations)) {
  console.error(`Шаблон сломан: нужны поля from / fromCoords / destinations[]`);
  process.exit(1);
}
console.log(`Шаблон: ${tpl.name || tpl.id} (${tpl.destinations.length} направлений)`);

// --- Парсер CSV (минимальный, без зависимостей) ---
function parseCsv(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim());
  if (!lines.length) return { header: [], rows: [] };
  const split = (s) => s.split(",").map(c => c.trim());
  const header = split(lines[0]).map(h => h.toLowerCase());
  const rows = lines.slice(1).map(l => {
    const cells = split(l);
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i] ?? ""; });
    return obj;
  });
  return { header, rows };
}
const num = (s) => {
  if (s == null || s === "") return null;
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const validDemand = (v) => ["green", "yellow", "red"].includes(String(v || "").toLowerCase().trim());

// --- Чтение CSV ---
const { header, rows } = parseCsv(readFileSync(csvPath, "utf8"));
const required = ["date", "hour", "destidx"];
const missing = required.filter(h => !header.includes(h));
if (missing.length) {
  console.error(`В CSV не хватает колонок: ${missing.join(", ")}`);
  console.error(`Найдены: ${header.join(", ")}`);
  process.exit(1);
}
console.log(`Прочитано строк CSV: ${rows.length}`);

// --- Группировка по дате ---
const byDate = new Map(); // date → { coords, orders }
let skipped = 0;
const tplFromKey = tpl.from;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const seenIds = new Set();
let rowIdx = 0;
for (const r of rows) {
  rowIdx++;
  const date = r.date;
  const hour = num(r.hour);
  const idx  = num(r.destidx);
  if (!date || !ISO_DATE.test(date)) {
    console.warn(`  ⚠ строка #${rowIdx}: дата "${date}" не в формате YYYY-MM-DD — пропускаем`);
    skipped++;
    continue;
  }
  // Strict calendar check: new Date("2026-02-31") нормализуется в март.
  // Проверяем, что компоненты после парсинга совпадают с исходной строкой.
  const [yy, mm, dd] = date.split("-").map((s) => parseInt(s, 10));
  const dateObj = new Date(Date.UTC(yy, mm - 1, dd));
  if (
    Number.isNaN(dateObj.getTime()) ||
    dateObj.getUTCFullYear() !== yy ||
    dateObj.getUTCMonth() !== mm - 1 ||
    dateObj.getUTCDate() !== dd
  ) {
    console.warn(`  ⚠ строка #${rowIdx}: дата "${date}" не существует в календаре — пропускаем`);
    skipped++;
    continue;
  }
  if (hour == null || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    console.warn(`  ⚠ строка #${rowIdx}: hour="${r.hour}" должен быть целым 0..23 — пропускаем`);
    skipped++;
    continue;
  }
  if (idx == null || !Number.isInteger(idx) || idx < 0) {
    console.warn(`  ⚠ строка #${rowIdx}: destIdx="${r.destidx}" должен быть целым >= 0 — пропускаем`);
    skipped++;
    continue;
  }
  const dest = tpl.destinations[idx];
  if (!dest) {
    console.warn(`  ⚠ строка #${rowIdx}: destIdx=${idx} нет в шаблоне (всего ${tpl.destinations.length}) — пропускаем`);
    skipped++;
    continue;
  }
  const factE = num(r.facte);
  const factC = num(r.factc);
  if (factE == null && factC == null) {
    console.warn(`  ⚠ строка #${rowIdx}: ни factE ни factC не указаны — пропускаем`);
    skipped++;
    continue;
  }
  const etaMin = num(r.etamin);
  const demand = validDemand(r.demand) ? r.demand.toLowerCase().trim() : null;

  if (!byDate.has(date)) {
    byDate.set(date, {
      coords: { [tplFromKey]: tpl.fromCoords },
      orders: [],
    });
  }
  const bucket = byDate.get(date);
  bucket.coords[dest.to] = dest.coords;

  // Уникализация id: при повторе (template,date,hour,destIdx) добавляем суффикс
  // -<rowIdx>, чтобы pnpm calib не сливал разные замеры в один заказ.
  let id = `batch-${tpl.id}-${date}-h${String(hour).padStart(2, "0")}-d${idx}`;
  if (seenIds.has(id)) id = `${id}-r${rowIdx}`;
  seenIds.add(id);
  const notes = [
    `Шаблон: ${tpl.id}`,
    etaMin != null ? `ETA подачи ${etaMin} мин` : null,
    demand ? `спрос: ${demand === "green" ? "🟢" : demand === "yellow" ? "🟡" : "🔴"}` : null,
  ].filter(Boolean).join("; ");

  bucket.orders.push({
    id,
    from: tplFromKey,
    to: dest.to,
    factE: factE ?? null,
    factC: factC ?? null,
    hour,
    notes: notes || undefined,
  });
}

if (skipped) console.log(`Пропущено строк: ${skipped}`);

// --- Запись orders/manual-<date>.json ---
mkdirSync(ORDERS_DIR, { recursive: true });
const dateToDay = (date) => {
  const d = new Date(date).getDay();
  return d === 0 ? "sunday" : d === 6 ? "saturday" : "weekday";
};
const written = [];
for (const [date, bucket] of byDate) {
  const out = {
    date,
    day: dateToDay(date),
    coords: bucket.coords,
    orders: bucket.orders,
  };
  const tplShort = tpl.id.replace(/[^a-z0-9-]/gi, "-").slice(0, 24);
  const file = join(ORDERS_DIR, `manual-${date}-${tplShort}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  written.push({ file, n: bucket.orders.length });
}

console.log("");
if (!written.length) {
  console.log("⚠ Пустой результат — orders.json не создан.");
  process.exit(0);
}
console.log(`Создано файлов: ${written.length}`);
for (const w of written) {
  console.log(`  ${basename(w.file)}: ${w.n} заказов`);
}
console.log(`\nДальше:`);
for (const w of written) {
  console.log(`  pnpm calib ${w.file.replace(ROOT + "/", "")}`);
}
console.log(`  pnpm learn`);
console.log(`  pnpm apply`);
