#!/usr/bin/env node
/**
 * Генерация Excel-отчёта по тарифной модели RWBTaxi (Yandex Go Минск).
 * Запуск: node scripts/src/generate-tariff-report.mjs
 * Вывод:  tariff-model-report.xlsx  (в корне репозитория)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const FRONT = join(ROOT, "artifacts/taxi-compare");
const LEARNED = join(FRONT, "scripts/learned");
const DATA = join(FRONT, "public/data");

const require = createRequire(import.meta.url);
const ExcelJS = require(join(ROOT, "node_modules/.pnpm/exceljs@4.4.0/node_modules/exceljs"));

// ── Данные ──────────────────────────────────────────────────────────────────
const sanity    = JSON.parse(readFileSync(join(LEARNED, "sanity-tariff.json"),  "utf8"));
const reversal  = JSON.parse(readFileSync(join(LEARNED, "tariff-reversal.json"), "utf8"));
const metrics   = JSON.parse(readFileSync(join(LEARNED, "metrics.json"),        "utf8"));
const hiddenRaw = JSON.parse(readFileSync(join(LEARNED, "hidden-boost.json"),   "utf8"));
const surgeMap  = JSON.parse(readFileSync(join(DATA,    "surge-map.json"),       "utf8"));

// TIME_MULTIPLIERS и зоны — захардкожены (берём из zones.ts)
const ZONE_TYPES = ["center","transport-hub","sleeper","mall","premium","industrial","airport-out","airport-in"];
const ZONE_TYPE_RU = {
  "center":          "Центр",
  "transport-hub":   "Транспортный узел",
  "sleeper":         "Спальный район",
  "mall":            "ТЦ / шопинг-зона",
  "premium":         "Премиум",
  "industrial":      "Промзона",
  "airport-out":     "Аэропорт (выезд)",
  "airport-in":      "Аэропорт (въезд)",
};
// v5: якорь будни·полдень = 1.0 (было: суббота·вечер = 1.0)
const TYPE_BASELINE_COMFORT = {
  center: 1.26, "transport-hub": 0.94, sleeper: 0.83, mall: 1.36,
  premium: 1.33, industrial: 0.66, "airport-out": 8.28, "airport-in": 5.67,
};
const TIME_MULTIPLIERS = {
  center:          { weekday:{night:0.64,morning:1.21,midday:1.00,evening:1.36,late:1.07}, saturday:{night:0.71,morning:0.79,midday:1.07,evening:1.43,late:1.21}, sunday:{night:0.64,morning:0.71,midday:1.00,evening:1.29,late:1.07} },
  "transport-hub": { weekday:{night:0.71,morning:1.06,midday:1.00,evening:1.12,late:0.94}, saturday:{night:0.65,morning:0.82,midday:1.00,evening:1.18,late:0.94}, sunday:{night:0.65,morning:0.82,midday:1.00,evening:1.12,late:0.94} },
  sleeper:         { weekday:{night:0.73,morning:2.09,midday:1.00,evening:1.91,late:1.18}, saturday:{night:0.82,morning:0.91,midday:1.27,evening:1.82,late:1.36}, sunday:{night:0.73,morning:0.82,midday:1.18,evening:1.55,late:1.27} },
  mall:            { weekday:{night:0.47,morning:0.59,midday:1.00,evening:1.29,late:0.94}, saturday:{night:0.53,morning:0.65,midday:1.41,evening:1.18,late:1.00}, sunday:{night:0.47,morning:0.59,midday:1.35,evening:1.12,late:0.88} },
  premium:         { weekday:{night:0.71,morning:1.14,midday:1.00,evening:1.43,late:1.07}, saturday:{night:0.71,morning:0.79,midday:1.07,evening:1.43,late:1.21}, sunday:{night:0.64,morning:0.71,midday:1.00,evening:1.29,late:1.07} },
  industrial:      { weekday:{night:0.64,morning:1.55,midday:1.00,evening:1.55,late:0.91}, saturday:{night:0.73,morning:0.91,midday:1.27,evening:1.82,late:1.09}, sunday:{night:0.64,morning:0.73,midday:1.00,evening:1.27,late:1.00} },
  "airport-out":   { weekday:{night:0.78,morning:1.06,midday:1.00,evening:1.06,late:0.94}, saturday:{night:0.78,morning:0.94,midday:1.00,evening:1.11,late:0.94}, sunday:{night:0.78,morning:0.94,midday:1.06,evening:1.11,late:0.94} },
  "airport-in":    { weekday:{night:0.78,morning:1.06,midday:1.00,evening:1.06,late:0.94}, saturday:{night:0.78,morning:0.94,midday:1.00,evening:1.11,late:0.94}, sunday:{night:0.78,morning:0.94,midday:1.06,evening:1.11,late:0.94} },
};
const DAYS    = ["weekday","saturday","sunday"];
const DAY_RU  = { weekday:"Будни (Пн-Пт)", saturday:"Суббота", sunday:"Воскресенье" };
const SLOTS   = ["night","morning","midday","evening","late"];
const SLOT_RU = { night:"Ночь (00-06)", morning:"Утро (06-10)", midday:"День (10-17)", evening:"Вечер (17-22)", late:"Поздно (22-00)" };

const ZONES = [
  { id:"center",          nameRu:"Центр (Немига, Купалы, пр. Независимости)",  type:"center" },
  { id:"northwest",       nameRu:"Сев.-Запад (Масюковщина, Зелёный Луг)",       type:"sleeper" },
  { id:"northeast",       nameRu:"Северо-Восток (Уручье, Боровляны)",            type:"sleeper" },
  { id:"south",           nameRu:"Юг (Серебрянка, Шабаны, Малиновка)",          type:"sleeper" },
  { id:"west",            nameRu:"Запад (Каменная Горка, Лебяжий)",              type:"sleeper" },
  { id:"train-station",   nameRu:"ЖД Вокзал / пл. Привокзальная",               type:"transport-hub" },
  { id:"komarovka",       nameRu:"Комаровский рынок / ТЦ Корона",               type:"mall" },
  { id:"galleria",        nameRu:"Galleria Minsk / пр. Победителей",            type:"mall" },
  { id:"prospect",        nameRu:"Пр. Независимости (бизнес-коридор)",          type:"premium" },
  { id:"industrial-east", nameRu:"Промзона Восток (Шабаны-пром, Колядичи)",     type:"industrial" },
  { id:"airport",         nameRu:"Аэропорт Минск-2 (выезд в город)",            type:"airport-out" },
  { id:"airport-in",      nameRu:"Аэропорт Минск-2 (въезд из города)",          type:"airport-in" },
];

// ── Стили ────────────────────────────────────────────────────────────────────
function headerStyle(wb, bgArgb = "FF1E3A5F") {
  return {
    font: { bold: true, color: { argb: "FFFFFFFF" }, size: 11 },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } },
    alignment: { horizontal: "center", vertical: "middle", wrapText: true },
    border: { bottom: { style: "thin", color: { argb: "FFB0B0B0" } } },
  };
}
function subHeaderStyle() {
  return {
    font: { bold: true, size: 10, color: { argb: "FF1E3A5F" } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EFF8" } },
    alignment: { horizontal: "center", vertical: "middle" },
  };
}
function dataStyle(wrapText = false) {
  return {
    font: { size: 10 },
    alignment: { horizontal: "center", vertical: "middle", wrapText },
    border: { bottom: { style: "hair", color: { argb: "FFD0D0D0" } } },
  };
}
function noteStyle() {
  return {
    font: { size: 9, italic: true, color: { argb: "FF555555" } },
    alignment: { horizontal: "left", vertical: "middle", wrapText: true },
  };
}
function surgeColor(v) {
  if (v <= 0.5)  return "FFADD8E6"; // light blue — мёртво
  if (v <= 0.85) return "FFB0D9B0"; // green — низкий
  if (v <= 1.05) return "FFFFF3B0"; // yellow — базовый
  if (v <= 1.5)  return "FFFFC680"; // orange — повышенный
  return                "FFFF8080"; // red — высокий
}

// ── Workbook ─────────────────────────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
wb.creator = "RWBTaxi Tariff Model";
wb.created = new Date();

// ════════════════════════════════════════════════════════════════════════════
// Лист 1: Методология и формула
// ════════════════════════════════════════════════════════════════════════════
{
  const ws = wb.addWorksheet("Методология");
  ws.pageSetup.orientation = "portrait";
  ws.columns = [{ width: 28 }, { width: 60 }];

  const title = ws.addRow(["RWBTaxi · Тарифная модель Yandex Go Минск", ""]);
  ws.mergeCells(`A${title.number}:B${title.number}`);
  title.getCell(1).style = {
    font: { bold: true, size: 14, color: { argb: "FF1E3A5F" } },
    alignment: { horizontal: "left", vertical: "middle" },
  };
  title.height = 28;

  ws.addRow(["Версия модели", "v4/v5 · Обновлено: " + new Date().toLocaleDateString("ru-RU") + " · Снапшотов (OLS): " + reversal.basedOn + " · Живых замеров: " + sanity.basedOn]);
  ws.addRow([]);

  const sections = [
    ["ОСНОВНАЯ ФОРМУЛА (v4)", "Цена = max(minimum, base + perKm·км + perMin·мин) × surge"],
    ["Тариф Эконом", "base=5.567 BYN, perKm=0.503 BYN/км, perMin=0.209 BYN/мин, minimum=6.40 BYN  (R²=1.0, 3820 снапшотов)"],
    ["Тариф Комфорт", "minimum=9.10 BYN для маршрутов <10.4 км; для длинных: base=1.959+0.688·км  (R²=0.79)"],
    [],
    ["КАК ФОРМИРУЕТСЯ SURGE", "Surge = база_зоны × коэффициент_среза"],
    ["база_зоны", "Характерный сёрдж Комфорта для зоны в будний полдень (якорь v5: буд·полдень = 1.0). Измеряется из скриншотов или задаётся экспертно по типу зоны."],
    ["коэффициент_среза", "Зависит от типа зоны, дня недели и времени суток. Например: спальник · будни · утро = ×2.09 (час пик выезд); центр · сб · вечер = ×1.43. Таблица — на листе «Матрица коэффициентов»."],
    [],
    ["ЭКОНОМ-СЁРДЖ", "Эконом_surge = Комфорт_surge × hb(Комфорт_surge)"],
    ["hb при Комфорт < 1.0", "×0.89 (скидка-стимул Yandex при низком спросе)"],
    ["hb при Комфорт 1.0–1.2", "×0.89 → 0.96 (плавный переход)"],
    ["hb при Комфорт ≥ 1.2", "×0.96 (сжатая скидка ~-4% при наличии спроса)"],
    ["hb при Комфорт ≥ 5.0", "×0.97 (длинные пригородные маршруты)"],
    [],
    ["ТОЧНОСТЬ МОДЕЛИ (LOO)", ""],
    ["Точек в датасете", `${metrics.datasetSize} (из них ${metrics.withYaSurge} с открытым ⚡N)`],
    ["MAE (ср. абс. ошибка)", "2.97 BYN"],
    ["MAPE (ср. % ошибка)", "19%"],
    ["В пределах ±10%", "79 из 217 поездок (36%)"],
    ["В пределах ±20%", "145 из 217 поездок (67%)"],
    [],
    ["ИСТОЧНИКИ ДАННЫХ", ""],
    ["Скриншоты Yandex Go", "Загружаются через мобильный интерфейс. Обрабатываются Gemini Vision (OCR). Сохраняются в PostgreSQL VPS."],
    ["Калибровки", "Ручные замеры: открытый ⚡N (коэффициент) + факт цены. Используются для обучения hb-модели."],
    ["Обучение", "`pnpm learn` — собирает dataset, обновляет surge-model.json, hidden-boost.json, observations.json."],
    ["Пересчёт фронта", "После `pnpm learn` → `pnpm apply` → деплой. Фронт читает observations.json и surge-map.json."],
  ];

  for (const row of sections) {
    if (!row.length || (row[0] === "" && row[1] === undefined)) {
      ws.addRow([]);
      continue;
    }
    const r = ws.addRow(row);
    if (row.length === 1 || (row[1] === "" && row[0] !== "")) {
      r.getCell(1).style = subHeaderStyle();
      ws.mergeCells(`A${r.number}:B${r.number}`);
    } else {
      r.getCell(1).style = { font: { bold: true, size: 10 }, alignment: { vertical: "middle" } };
      r.getCell(2).style = { font: { size: 10 }, alignment: { vertical: "middle", wrapText: true } };
      r.height = 22;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Лист 2: Матрица коэффициентов (TIME_MULTIPLIERS)
// ════════════════════════════════════════════════════════════════════════════
{
  const ws = wb.addWorksheet("Матрица коэффициентов");
  ws.pageSetup.orientation = "landscape";

  // Шапка
  const hdr = ws.addRow(["Матрица коэффициентов сёрджа по типу зоны, дню и времени суток"]);
  ws.mergeCells(`A1:P1`);
  hdr.getCell(1).style = { font: { bold: true, size: 13, color: { argb: "FF1E3A5F" } }, alignment: { horizontal: "left" } };
  hdr.height = 24;

  ws.addRow(["Коэффициент × базовый_сёрдж_зоны = итоговый_Комфорт_сёрдж. Цвет: синий=мёртво, зелёный=низкий, жёлтый=базовый, оранжевый=повышенный, красный=высокий."]);
  ws.mergeCells(`A2:P2`);
  ws.getRow(2).getCell(1).style = noteStyle();
  ws.addRow([]);

  // Колонки: Тип зоны | База_сёрдж | Будни×5 | Суббота×5 | Воскресенье×5
  const cols = ["Тип зоны", "База\n(буд.полдень)", ...SLOTS.map(s => `Будни\n${SLOT_RU[s]}`), ...SLOTS.map(s => `Суббота\n${SLOT_RU[s]}`), ...SLOTS.map(s => `Вс\n${SLOT_RU[s]}`) ];
  const colRow = ws.addRow(cols);
  colRow.height = 40;
  colRow.eachCell((cell) => { cell.style = headerStyle(wb); });

  ws.columns = [
    { width: 22 }, { width: 10 },
    ...Array(5).fill({ width: 13 }), // будни
    ...Array(5).fill({ width: 13 }), // суббота
    ...Array(5).fill({ width: 13 }), // воскресенье
  ];

  for (const type of ZONE_TYPES) {
    const base = TYPE_BASELINE_COMFORT[type];
    const row = [ZONE_TYPE_RU[type], base];
    for (const day of DAYS) {
      for (const slot of SLOTS) {
        const m = TIME_MULTIPLIERS[type][day][slot];
        const surge = +(base * m).toFixed(2);
        row.push(`×${m.toFixed(2)}\n(→${surge})`);
      }
    }
    const r = ws.addRow(row);
    r.height = 32;
    r.getCell(1).style = { font: { bold: true, size: 10 }, alignment: { vertical: "middle" } };
    r.getCell(2).style = { font: { bold: true, size: 11 }, alignment: { horizontal: "center", vertical: "middle" }, fill: { type:"pattern", pattern:"solid", fgColor:{ argb:"FFFFF3B0" } } };
    let col = 3;
    for (const day of DAYS) {
      for (const slot of SLOTS) {
        const m = TIME_MULTIPLIERS[type][day][slot];
        const cell = r.getCell(col);
        cell.style = {
          font: { size: 9 },
          fill: { type: "pattern", pattern: "solid", fgColor: { argb: surgeColor(m) } },
          alignment: { horizontal: "center", vertical: "middle", wrapText: true },
          border: { right: slot === "late" ? { style: "medium", color: { argb: "FF888888" } } : { style: "hair", color: { argb: "FFCCCCCC" } } },
        };
        col++;
      }
    }
  }

  // Легенда
  ws.addRow([]);
  const legRow = ws.addRow(["Легенда цветов:"]);
  ws.mergeCells(`A${legRow.number}:C${legRow.number}`);
  legRow.getCell(1).style = { font: { bold: true, size: 10 } };
  const legend = [["≤ 0.50","Мёртво (очень низкий спрос)","FFADD8E6"],["≤ 0.85","Низкий спрос","FFB0D9B0"],["≤ 1.05","Базовый уровень","FFFFF3B0"],["≤ 1.50","Повышенный спрос","FFFFC680"],["> 1.50","Высокий спрос","FFFF8080"]];
  for (const [val, desc, color] of legend) {
    const lr = ws.addRow([val, desc]);
    lr.getCell(1).style = { font:{size:10}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:color}}, alignment:{horizontal:"center"} };
    lr.getCell(2).style = { font:{size:10} };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Лист 3: Зоны Минска
// ════════════════════════════════════════════════════════════════════════════
{
  const ws = wb.addWorksheet("Зоны Минска");
  ws.pageSetup.orientation = "portrait";

  const hdr = ws.addRow(["Зоны Минска и базовые параметры сёрджа"]);
  ws.mergeCells("A1:F1");
  hdr.getCell(1).style = { font:{bold:true,size:13,color:{argb:"FF1E3A5F"}}, alignment:{horizontal:"left"} };
  hdr.height = 22;

  const colHdr = ws.addRow(["Название зоны", "Тип зоны", "База Комфорт\n(буд·полдень)", "Мин. цена Экон, BYN", "Мин. цена Комф, BYN", "Комментарий"]);
  colHdr.height = 36;
  colHdr.eachCell(c => { c.style = headerStyle(wb); });
  ws.columns = [{ width: 42 }, { width: 20 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 40 }];

  const econMin = sanity.current.econom.minimum;
  const cmfMin  = sanity.current.comfort.minimum;

  const zoneComments = {
    center:          "База (буд.полдень)=1.26. Пик сб вечер ×1.43→⚡1.8. Ночная жизнь, рестораны, БЦ.",
    "transport-hub": "Стабильный пассажиропоток круглосуточно. Слабая реакция на пики.",
    sleeper:         "Пик — будни утро (исходящий поток). Выходные — тихо.",
    mall:            "Пик — выходные день. Будни вечер — посещение магазинов после работы.",
    premium:         "Слабая волатильность, стабильно высокий базовый сёрдж.",
    industrial:      "Минимальный спрос, оживает только в утренний час пик будней.",
    "airport-out":   "Высокий фиксированный сёрдж. Машины уже стоят — нет холостого пробега.",
    "airport-in":    "Несколько ниже airport-out: водитель едет порожним к аэропорту.",
  };

  for (const zone of ZONES) {
    const base = TYPE_BASELINE_COMFORT[zone.type];
    const r = ws.addRow([zone.nameRu, ZONE_TYPE_RU[zone.type], base, econMin, cmfMin, zoneComments[zone.type] ?? ""]);
    r.height = 20;
    r.getCell(1).style = { font:{size:10}, alignment:{vertical:"middle"} };
    r.getCell(2).style = { font:{size:10}, alignment:{horizontal:"center",vertical:"middle"} };
    r.getCell(3).style = { font:{bold:true,size:11}, alignment:{horizontal:"center",vertical:"middle"}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:surgeColor(base/3)}} };
    r.getCell(4).style = dataStyle();
    r.getCell(5).style = dataStyle();
    r.getCell(6).style = { font:{size:9,italic:true}, alignment:{vertical:"middle",wrapText:true} };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Лист 4: Сёрдж по слотам (из обучения)
// ════════════════════════════════════════════════════════════════════════════
{
  const ws = wb.addWorksheet("Сёрдж по слотам (факт)");
  ws.pageSetup.orientation = "portrait";

  const hdr = ws.addRow(["Фактический сёрдж по дню × часу (из замеров)  — " + new Date().toLocaleDateString("ru-RU")]);
  ws.mergeCells("A1:F1");
  hdr.getCell(1).style = { font:{bold:true,size:13,color:{argb:"FF1E3A5F"}}, alignment:{horizontal:"left"} };

  ws.addRow(["bySlotOpen — только замеры с открытым ⚡N (коэффициент виден). bySlot — все замеры (включая скрытый сёрдж)."]);
  ws.mergeCells("A2:F2");
  ws.getRow(2).getCell(1).style = noteStyle();
  ws.addRow([]);

  const colHdr = ws.addRow(["Слот (день-час)", "N замеров\n(открытый ⚡)", "Средний ⚡\n(открытый)", "N замеров\n(все)", "Средний ⚡\n(все)", "Ср. Эконом hb"]);
  colHdr.height = 36;
  colHdr.eachCell(c => { c.style = headerStyle(wb); });
  ws.columns = [{ width: 20 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 16 }];

  const openSlots = metrics.bySlotOpen ?? {};
  const allSlots  = metrics.bySlot ?? {};
  const hbSlots   = hiddenRaw.bySlot ?? {};

  const allKeys = new Set([...Object.keys(openSlots), ...Object.keys(allSlots)]);
  const sorted = [...allKeys].sort();

  for (const key of sorted) {
    const o = openSlots[key] ?? {};
    const a = allSlots[key] ?? {};
    const h = hbSlots[key] ?? {};
    const r = ws.addRow([
      key,
      o.n ?? "—",
      o.meanSurge != null ? `×${o.meanSurge.toFixed(3)}` : "—",
      a.n ?? "—",
      a.meanSurge != null ? `×${a.meanSurge.toFixed(3)}` : "—",
      h.mean != null ? `×${h.mean.toFixed(3)}` : "—",
    ]);
    r.height = 18;
    r.getCell(1).style = { font:{bold:true,size:10}, alignment:{vertical:"middle"} };
    for (let i = 2; i <= 6; i++) r.getCell(i).style = dataStyle();
    if (o.meanSurge != null) {
      r.getCell(3).style = { ...dataStyle(), fill:{type:"pattern",pattern:"solid",fgColor:{argb:surgeColor(o.meanSurge/3)}} };
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Лист 5: Цены (примеры поездок)
// ════════════════════════════════════════════════════════════════════════════
{
  const ws = wb.addWorksheet("Примеры цен");
  ws.pageSetup.orientation = "landscape";

  const econMin = sanity.current.econom.minimum;
  const cmfMin  = sanity.current.comfort.minimum;

  const hdr = ws.addRow(["Примеры итоговых цен по зонам · Эконом / Комфорт, BYN"]);
  ws.mergeCells("A1:J1");
  hdr.getCell(1).style = { font:{bold:true,size:13,color:{argb:"FF1E3A5F"}}, alignment:{horizontal:"left"} };
  hdr.height = 22;

  ws.addRow(["Цена = max(minimum, base + perKm·км + perMin·мин) × surge. Эталонная поездка 5 км / 12 мин. Tariff v4: Эконом baza=5.567+0.503·км+0.209·мин, Комфорт minimum=9.10 (<10.4 км). Якорь v5: буд·полдень = 1.0."]);
  ws.mergeCells("A2:J2");
  ws.getRow(2).getCell(1).style = noteStyle();
  ws.addRow([]);

  const trips = [
    { label: "Короткая", km: 3, min: 8 },
    { label: "Средняя", km: 5, min: 12 },
    { label: "Длинная", km: 12, min: 30 },
  ];

  // Шапка
  const colHdr = ws.addRow([
    "Зона", "Тип", "База\nсёрдж", ...trips.flatMap(t => [`Эконом\n${t.label} (${t.km}км/${t.min}мин)`, `Комфорт\n${t.label} (${t.km}км/${t.min}мин)`])
  ]);
  colHdr.height = 40;
  colHdr.eachCell(c => { c.style = headerStyle(wb); });
  ws.columns = [{ width: 38 }, { width: 18 }, { width: 10 }, ...Array(6).fill({ width: 16 })];

  for (const zone of ZONES) {
    const base = TYPE_BASELINE_COMFORT[zone.type];
    // surge = base (weekday midday baseline, якорь v5)
    const econSurge = base * 0.89; // hb for baseline ≥1
    const econSurgeActual = base >= 1.0 ? base * 0.96 : base * 0.89;

    const cells = [zone.nameRu, ZONE_TYPE_RU[zone.type], `×${base}`];
    for (const t of trips) {
      // Flat tariff: price = minimum × surge
      const econPrice = +(econMin * econSurgeActual).toFixed(2);
      const cmfPrice  = +(cmfMin  * base).toFixed(2);
      cells.push(`${econPrice} BYN`);
      cells.push(`${cmfPrice} BYN`);
    }
    const r = ws.addRow(cells);
    r.height = 20;
    r.getCell(1).style = { font:{size:10}, alignment:{vertical:"middle"} };
    r.getCell(2).style = { font:{size:9}, alignment:{horizontal:"center",vertical:"middle"} };
    r.getCell(3).style = { font:{bold:true,size:10}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:surgeColor(base/4)}}, alignment:{horizontal:"center",vertical:"middle"} };
    for (let i = 4; i <= 9; i++) {
      r.getCell(i).style = {
        font: { size: 10 },
        fill: { type:"pattern",pattern:"solid",fgColor:{ argb: i%2===0 ? "FFF0F4FF" : "FFFAFAFA" } },
        alignment: { horizontal:"center", vertical:"middle" },
      };
    }
  }

  ws.addRow([]);
  const note = ws.addRow(["* Тариф Yandex Go v4: baza нелинейная. Эконом: baza = 5.567 + 0.503·км + 0.209·мин (OLS, R²=1.0, n=3820). Комфорт: minimum=9.10 BYN при <10.4 км, 1.959+0.688·км при длинных маршрутах. Якорь v5: будний полдень = 1.0 (ранее суббота·вечер)."]);
  ws.mergeCells(`A${note.number}:J${note.number}`);
  note.getCell(1).style = noteStyle();
  note.height = 28;
}

// ════════════════════════════════════════════════════════════════════════════
// Лист 6: Эконом hb-буст по слотам
// ════════════════════════════════════════════════════════════════════════════
{
  const ws = wb.addWorksheet("Эконом hb-буст");
  ws.pageSetup.orientation = "portrait";

  const hdr = ws.addRow(["Эконом hidden boost (hb) по слотам — hb = Эконом_сёрдж / Комфорт_сёрдж"]);
  ws.mergeCells("A1:E1");
  hdr.getCell(1).style = { font:{bold:true,size:12,color:{argb:"FF1E3A5F"}}, alignment:{horizontal:"left"} };
  hdr.height = 22;

  ws.addRow(["hb < 1.0 — Яндекс даёт скидку на Эконом. При cmf < 1.0 → hb ≈ 0.89 (стимул). При cmf ≥ 1.0 → hb ≈ 0.96 (сжатая скидка)."]);
  ws.mergeCells("A2:E2");
  ws.getRow(2).getCell(1).style = noteStyle();
  ws.addRow([]);

  const colHdr = ws.addRow(["Слот", "N замеров", "Среднее hb", "Std", "Интерпретация"]);
  colHdr.height = 28;
  colHdr.eachCell(c => { c.style = headerStyle(wb); });
  ws.columns = [{ width: 20 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 40 }];

  for (const [slot, data] of Object.entries(hiddenRaw.bySlot ?? {}).sort()) {
    const hb = data.mean;
    let interp = "";
    if (hb < 0.90) interp = "Стимул (низкий спрос → −11% на Эконом)";
    else if (hb < 0.94) interp = "Переходная зона";
    else if (hb < 0.975) interp = "Сжатая скидка (высокий спрос → −4%)";
    else interp = "Минимальная скидка (пригород / аэропорт)";

    const r = ws.addRow([slot, data.n, `×${hb.toFixed(3)}`, data.std?.toFixed(3) ?? "—", interp]);
    r.height = 18;
    r.getCell(1).style = { font:{bold:true,size:10}, alignment:{vertical:"middle"} };
    r.getCell(2).style = dataStyle();
    r.getCell(3).style = {
      font: { size: 10 }, alignment: { horizontal: "center", vertical: "middle" },
      fill: { type:"pattern",pattern:"solid",fgColor:{ argb: hb < 0.91 ? "FFADD8E6" : hb < 0.95 ? "FFFFF3B0" : "FFB0D9B0" } },
    };
    r.getCell(4).style = dataStyle();
    r.getCell(5).style = { font:{size:9,italic:true}, alignment:{vertical:"middle"} };
  }

  ws.addRow([]);
  ws.addRow(["Бинарная модель hb(cmf):"]);
  ws.addRow(["cmf < 1.0", "hb = 0.89", "", "Стимул конверсии"]);
  ws.addRow(["cmf 1.0 – 1.2", "hb = 0.89 + (cmf−1)×0.35", "", "Плавный переход"]);
  ws.addRow(["cmf 1.2 – 5.0", "hb = 0.96", "", "Основной режим (городские поездки)"]);
  ws.addRow(["cmf ≥ 5.0", "hb = 0.97", "", "Длинные пригородные маршруты"]);
}

// ── Сохранить ────────────────────────────────────────────────────────────────
const out = join(ROOT, "tariff-model-report.xlsx");
await wb.xlsx.writeFile(out);
console.log("✓ Создан:", out);
