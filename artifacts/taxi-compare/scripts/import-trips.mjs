#!/usr/bin/env node
// Конвертирует CSV-экспорт замеров с сайта (кнопка «Экспорт» в диалоге
// «Мои поездки и замеры») в формат orders/<date>.json для последующего
// прогона через `pnpm calib` и `pnpm learn`.
//
// Использование:
//   node scripts/import-trips.mjs path/to/rwb-my-trips-YYYY-MM-DD.csv
//
// Выход: scripts/orders/manual-<date>.json (по одному файлу на каждую дату).
// После этого:
//   pnpm calib scripts/orders/manual-<date>.json
//   pnpm learn

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ORDERS_DIR = resolve(ROOT, "scripts/orders");

const inPath = process.argv[2];
if (!inPath) {
  console.error("Usage: node scripts/import-trips.mjs <trips-export.csv>");
  process.exit(1);
}
const file = resolve(process.cwd(), inPath);
if (!existsSync(file)) {
  console.error(`Не найден файл: ${file}`);
  process.exit(1);
}
const text = readFileSync(file, "utf8");

// Простой CSV-парсер с поддержкой кавычек (соответствует фронту).
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
if (lines.length < 2) {
  console.error("CSV пуст или содержит только заголовок.");
  process.exit(1);
}
const header = splitCsvLine(lines[0]).map((h) => h.trim());
const idx = (col) => header.indexOf(col);

const REQUIRED = ["id", "date", "day", "fromAddress", "toAddress", "fromLat", "fromLng", "toLat", "toLng"];
for (const r of REQUIRED) {
  if (idx(r) < 0) {
    console.error(`В CSV отсутствует обязательная колонка "${r}". Похоже, экспорт сделан старой версией сайта — пересохраните CSV свежим экспортом.`);
    process.exit(1);
  }
}

const rows = [];
for (let i = 1; i < lines.length; i++) {
  const cols = splitCsvLine(lines[i]);
  const obj = {};
  header.forEach((h, j) => {
    const v = cols[j];
    if (v !== undefined && v !== "") obj[h] = v;
  });
  rows.push(obj);
}

// Группируем по дате замера.
const byDate = new Map();
for (const r of rows) {
  const date = r.date;
  if (!date) continue;
  if (!byDate.has(date)) byDate.set(date, []);
  byDate.get(date).push(r);
}

if (byDate.size === 0) {
  console.error("Не нашёл ни одной строки с заполненной датой.");
  process.exit(1);
}

mkdirSync(ORDERS_DIR, { recursive: true });

let totalOrders = 0;
const written = [];
for (const [date, list] of byDate.entries()) {
  // Дни одинаковы внутри одной даты — берём из первой строки.
  const day = list[0].day;
  const coords = {};
  const orders = [];
  for (const r of list) {
    const fromAddr = r.fromAddress;
    const toAddr = r.toAddress;
    const fromLat = parseFloat(r.fromLat);
    const fromLng = parseFloat(r.fromLng);
    const toLat = parseFloat(r.toLat);
    const toLng = parseFloat(r.toLng);
    if (
      !fromAddr || !toAddr ||
      !Number.isFinite(fromLat) || !Number.isFinite(fromLng) ||
      !Number.isFinite(toLat) || !Number.isFinite(toLng)
    ) {
      console.warn(`  пропуск ${r.id}: нет адресов или координат`);
      continue;
    }
    coords[fromAddr] = [fromLat, fromLng];
    coords[toAddr] = [toLat, toLng];
    const o = {
      id: r.id,
      from: fromAddr,
      to: toAddr,
      hour: r.hour ? parseInt(r.hour, 10) : new Date(`${date}T12:00:00`).getHours(),
    };
    if (r.factE !== undefined) o.factE = parseFloat(r.factE);
    if (r.factC !== undefined) o.factC = parseFloat(r.factC);
    if (r.etaMin !== undefined) o.etaMin = parseFloat(r.etaMin);
    if (r.demand) o.demand = r.demand;
    // Время поездки в минутах (если ввели вручную) — пригодится для traffic loop.
    if (r.min !== undefined) o.userTripMin = parseFloat(r.min);
    const noteParts = [];
    if (r.demand) noteParts.push(`спрос ${r.demand}`);
    if (r.etaMin !== undefined) noteParts.push(`подача ${r.etaMin} мин`);
    if (r.notes) noteParts.push(r.notes);
    if (noteParts.length > 0) o.notes = noteParts.join(" · ");
    orders.push(o);
  }
  if (orders.length === 0) continue;
  const out = {
    date,
    day,
    comment: `Импорт замеров из формы сайта (${list.length} строк, источник: ${basename(file)}).`,
    coords,
    orders,
  };
  const outName = `manual-${date}.json`;
  const outPath = resolve(ORDERS_DIR, outName);
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  written.push(outPath);
  totalOrders += orders.length;
  console.log(`  → ${outName}: ${orders.length} замеров`);
}

console.log("");
console.log(`Готово: ${totalOrders} замеров в ${written.length} файлах.`);
console.log("");
console.log("Дальше:");
for (const p of written) {
  const rel = `scripts/orders/${basename(p)}`;
  console.log(`  pnpm calib ${rel}`);
}
console.log(`  pnpm learn   # переобучит модель на всех данных`);
console.log(`  pnpm apply   # запишет новые коэффициенты в код`);
