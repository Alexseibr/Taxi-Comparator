#!/usr/bin/env node
// Экспорт всех заказов из dataset.json в Excel (.xlsx) для удобного просмотра.
// Колонки: дата, время, откуда, куда, км, мин (по Я.), ⚡, цена Эконом, цена Комфорт.
// Запуск:  node scripts/export-orders-xlsx.mjs

import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const dataset = JSON.parse(readFileSync(join(ROOT, "scripts/learned/dataset.json"), "utf8"));
const observations = JSON.parse(readFileSync(join(ROOT, "public/data/observations.json"), "utf8"));

// Извлечь HH:MM из имени файла "2026-04-26-1033.results.json" → "10:33"
function timeFromSource(src) {
  const m = src && src.match(/(\d{4})(?:-[A-Z])?\.results\.json$/);
  if (!m) return "";
  const hhmm = m[1];
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
}

const DAY_RU = { sunday: "вс", monday: "пн", tuesday: "вт", wednesday: "ср", thursday: "чт", friday: "пт", saturday: "сб", weekday: "будни" };

// 1) Заказы из dataset.json (калибровочные партии, 26-27 апр)
const datasetRows = dataset.orders.map(o => ({
  date: o.date,
  time: timeFromSource(o.sourceFile) || (o.hour != null ? `${String(o.hour).padStart(2, "0")}:00` : ""),
  day: DAY_RU[o.day] || o.day || "",
  from: o.fromAddr || "",
  to: o.toAddr || "",
  km: o.km != null ? +o.km.toFixed(2) : null,
  min: o.yaMin ?? (o.min != null ? Math.round(o.min) : null),
  surge: o.yaSurgeC ?? null,
  econ: o.factE ?? null,
  cmf: o.factC ?? null,
  src: o.sourceFile || "",
}));

// 2) Точки из observations.json которых нет в dataset (даты 25.04 и т.п.)
const datesetDates = new Set(datasetRows.map(r => r.date));
const obsRows = [];

// 2a) Агрегатные items вида "→ Адрес (X.XX км/Y.Y мин, Комфорт Z.Z ⇒ ×S.SS)"
const RE_AGG = /→\s+([^()→]+?)\s+\(([\d.]+)\s*км\/([\d.]+)\s*мин(?:,\s*Комфорт\s+([\d.]+)\s*⇒\s*×([\d.]+))?\)/g;
// 2b) Speed-items вида "FROM → TO · X.XX км/Y.Y мин (скрин)"
const RE_SPEED = /^(.+?)\s*→\s*(.+?)\s*·\s*([\d.]+)\s*км\/([\d.]+)\s*мин/;

const seenSpeedRoutes = new Set(); // дедуп: speed-itemы дублируют агрегатные
for (const it of (observations.items || [])) {
  const dateOnly = (it.date || "").slice(0, 10);
  if (!dateOnly || datesetDates.has(dateOnly)) continue; // в dataset уже есть, пропускаем
  const time = (it.date || "").slice(11, 16) || "";
  const day = DAY_RU[it.day] || it.day || "";
  const fromAddr = it.address || "";

  // Сначала проверяем агрегат (multi-route в notes)
  const aggMatches = [...(it.notes || "").matchAll(RE_AGG)];
  if (aggMatches.length > 0) {
    for (const m of aggMatches) {
      const to = m[1].trim();
      obsRows.push({
        date: dateOnly, time, day,
        from: fromAddr, to,
        km: +m[2], min: +m[3],
        surge: m[5] ? +m[5] : null,
        econ: null, cmf: m[4] ? +m[4] : null,
        src: `observations:${it.id || ""}`,
      });
      seenSpeedRoutes.add(`${fromAddr}|${to}|${dateOnly} ${time}`);
    }
    continue;
  }

  // Speed-item (одиночный маршрут в notes без цены)
  const sm = (it.notes || "").match(RE_SPEED);
  if (sm) {
    const fromN = sm[1].trim();
    const toN = sm[2].trim();
    const dedupKey = `${fromN}|${toN}|${dateOnly} ${time}`;
    // Проверим не покрыт ли он уже агрегатом (приблизительно — by to-addr)
    const covered = [...seenSpeedRoutes].some(k => k.includes(`|${toN}|${dateOnly} ${time}`) || k.includes(`|${toN.split(" ")[0]}|${dateOnly} ${time}`));
    if (covered) continue;
    obsRows.push({
      date: dateOnly, time, day,
      from: fromN, to: toN,
      km: +sm[3], min: +sm[4],
      surge: it.comfortSurge ?? null,
      econ: null, cmf: null,
      src: `observations:${it.id || ""}`,
    });
    seenSpeedRoutes.add(dedupKey);
    continue;
  }

  // Иначе — просто точка без направления (включаем для полноты)
  obsRows.push({
    date: dateOnly, time, day,
    from: fromAddr, to: "(не указано)",
    km: null, min: null,
    surge: it.comfortSurge ?? null,
    econ: null, cmf: null,
    src: `observations:${it.id || ""}`,
  });
}

const rows = [...datasetRows, ...obsRows]
  .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

const wb = new ExcelJS.Workbook();
wb.creator = "RWB Taxi · taxi-compare";
wb.created = new Date();

const ws = wb.addWorksheet("Заказы Я.Такси", {
  views: [{ state: "frozen", ySplit: 1 }],
});

ws.columns = [
  { header: "№",                 key: "n",     width: 5  },
  { header: "Дата",              key: "date",  width: 12 },
  { header: "Время",             key: "time",  width: 8  },
  { header: "День",              key: "day",   width: 6  },
  { header: "Откуда",            key: "from",  width: 38 },
  { header: "Куда",              key: "to",    width: 38 },
  { header: "Км",                key: "km",    width: 7  },
  { header: "Мин (Я.)",          key: "min",   width: 9  },
  { header: "⚡ Surge",           key: "surge", width: 9  },
  { header: "Цена Эконом, br",   key: "econ",  width: 16 },
  { header: "Цена Комфорт, br",  key: "cmf",   width: 16 },
  { header: "Партия",            key: "src",   width: 32 },
];

rows.forEach((r, i) => {
  ws.addRow({ n: i + 1, ...r });
});

// Шапка: жирный, заливка
const header = ws.getRow(1);
header.font = { bold: true, color: { argb: "FFFFFFFF" } };
header.alignment = { vertical: "middle", horizontal: "center" };
header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
header.height = 22;

// Числовые форматы
ws.getColumn("km").numFmt    = "0.00";
ws.getColumn("min").numFmt   = "0";
ws.getColumn("surge").numFmt = "0.00";
ws.getColumn("econ").numFmt  = "0.00";
ws.getColumn("cmf").numFmt   = "0.00";

// Альтернирующая подсветка строк по дате
let lastDate = null, stripe = false;
for (let i = 2; i <= rows.length + 1; i++) {
  const row = ws.getRow(i);
  const date = row.getCell("date").value;
  if (date !== lastDate) {
    stripe = !stripe;
    lastDate = date;
  }
  if (stripe) {
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F7FC" } };
  }
}

// Автофильтр
ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

// Сводка снизу
const sumRow = ws.addRow({});
sumRow.getCell(1).value = `Итого заказов: ${rows.length}`;
sumRow.font = { bold: true, italic: true };

// Сохранение xlsx
const outDir = join(ROOT, "exports");
mkdirSync(outDir, { recursive: true });
const outXlsx = join(outDir, "orders.xlsx");
await wb.xlsx.writeFile(outXlsx);

// Сохранение csv (UTF-8 с BOM, разделитель ; — для русского Excel)
const csvHeaders = ["№","Дата","Время","День","Откуда","Куда","Км","Мин (Я.)","⚡ Surge","Цена Эконом, br","Цена Комфорт, br","Партия"];
const escCsv = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLines = [csvHeaders.join(";")];
rows.forEach((r, i) => {
  csvLines.push([
    i + 1, r.date, r.time, r.day, r.from, r.to,
    r.km != null ? r.km.toFixed(2).replace(".", ",") : "",
    r.min != null ? r.min : "",
    r.surge != null ? String(r.surge).replace(".", ",") : "",
    r.econ != null ? String(r.econ).replace(".", ",") : "",
    r.cmf != null ? String(r.cmf).replace(".", ",") : "",
    r.src,
  ].map(escCsv).join(";"));
});
const outCsv = join(outDir, "orders.csv");
const { writeFileSync } = await import("node:fs");
writeFileSync(outCsv, "\uFEFF" + csvLines.join("\r\n"), "utf8");

console.log(`✓ Сохранено: ${outXlsx}`);
console.log(`✓ Сохранено: ${outCsv}`);
console.log(`  Строк: ${rows.length}`);
console.log(`  По датам:`, [...new Set(rows.map(r => r.date))].map(d => `${d}=${rows.filter(r => r.date === d).length}`).join(", "));
