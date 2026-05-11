#!/usr/bin/env node
/**
 * Telegram-бот: /forecast → Excel с прогнозом тарифов Yandex Go на 7 дней.
 *
 * Логика прогноза:
 *  1. Тип дня: weekday / saturday / sunday / праздник (→ sunday)
 *  2. Погода: Open-Meteo (Минск) — дождь / снег / ветер → коэффициент буста
 *  3. Surge = TYPE_BASELINE × TIME_MULT[zone][dayType][slot] × weatherBoost
 *  4. Итоговая цена Комфорт (5 км / 12 мин): max(9.10, surge × base)
 *
 * Запуск: node scripts/src/tariff-bot.mjs
 * Env:    TELEGRAM_BOT_TOKEN
 */

import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const require = createRequire(import.meta.url);
const TelegramBot = require(join(ROOT, "node_modules/.pnpm/node-telegram-bot-api@0.67.0/node_modules/node-telegram-bot-api"));
const ExcelJS    = require(join(ROOT, "node_modules/.pnpm/exceljs@4.4.0/node_modules/exceljs"));

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN не задан"); process.exit(1); }

// ── Тарифные константы (из zones.ts v4/v5) ──────────────────────────────────
const ECON_BASE = { pickup: 5.567, perKm: 0.503, perMin: 0.209, minimum: 6.40 };
const CMF_MIN   = 9.10;

// Базовый сёрдж зоны в будни·полдень (якорь = 1.0)
const TYPE_BASELINE = {
  center:          1.26,
  sleeper:         0.83,
  mall:            1.36,
  "transport-hub": 0.94,
  premium:         1.33,
  industrial:      0.66,
};

const TIME_MULT = {
  center: {
    weekday:  { night: 0.64, morning: 1.21, midday: 1.00, evening: 1.36, late: 1.07 },
    saturday: { night: 0.71, morning: 0.79, midday: 1.07, evening: 1.43, late: 1.21 },
    sunday:   { night: 0.64, morning: 0.71, midday: 1.00, evening: 1.29, late: 1.07 },
  },
  sleeper: {
    weekday:  { night: 0.73, morning: 2.09, midday: 1.00, evening: 1.91, late: 1.18 },
    saturday: { night: 0.82, morning: 0.91, midday: 1.27, evening: 1.82, late: 1.36 },
    sunday:   { night: 0.73, morning: 0.82, midday: 1.18, evening: 1.55, late: 1.27 },
  },
  mall: {
    weekday:  { night: 0.47, morning: 0.59, midday: 1.00, evening: 1.29, late: 0.94 },
    saturday: { night: 0.53, morning: 0.65, midday: 1.41, evening: 1.18, late: 1.00 },
    sunday:   { night: 0.47, morning: 0.59, midday: 1.35, evening: 1.12, late: 0.88 },
  },
  "transport-hub": {
    weekday:  { night: 0.71, morning: 1.06, midday: 1.00, evening: 1.12, late: 0.94 },
    saturday: { night: 0.65, morning: 0.82, midday: 1.00, evening: 1.18, late: 0.94 },
    sunday:   { night: 0.65, morning: 0.82, midday: 1.00, evening: 1.12, late: 0.94 },
  },
  premium: {
    weekday:  { night: 0.71, morning: 1.14, midday: 1.00, evening: 1.43, late: 1.07 },
    saturday: { night: 0.71, morning: 0.79, midday: 1.07, evening: 1.43, late: 1.21 },
    sunday:   { night: 0.64, morning: 0.71, midday: 1.00, evening: 1.29, late: 1.07 },
  },
  industrial: {
    weekday:  { night: 0.64, morning: 1.55, midday: 1.00, evening: 1.55, late: 0.91 },
    saturday: { night: 0.73, morning: 0.91, midday: 1.27, evening: 1.82, late: 1.09 },
    sunday:   { night: 0.64, morning: 0.73, midday: 1.00, evening: 1.27, late: 1.00 },
  },
};

const ZONE_RU = {
  center: "Центр",
  sleeper: "Спальник",
  mall: "ТЦ/Молл",
  "transport-hub": "Вокзал/Аэропорт",
  premium: "Премиум-район",
  industrial: "Промзона",
};

const SLOT_RU   = { night: "Ночь (00–06)", morning: "Утро (06–10)", midday: "День (10–15)", evening: "Вечер (15–22)", late: "Поздно (22–00)" };
const SLOT_KEYS = ["night", "morning", "midday", "evening", "late"];

// ── Беларусские праздники (MM-DD → название) ─────────────────────────────────
const BY_HOLIDAYS = {
  "01-01": "Новый год",
  "01-07": "Рождество православное",
  "03-08": "День женщин",
  "03-15": "День Конституции",
  "05-01": "День труда",
  "05-09": "День Победы",
  "07-03": "День Независимости",
  "11-07": "День Октябрьской революции",
  "12-25": "Рождество католическое",
};

// Радуница — вычисляется как вторник после Пасхи (приблизительно хардкодим 2026-2029)
const RADUNICA = { "2026": "04-21", "2027": "05-11", "2028": "04-25", "2029": "04-17" };

function getHoliday(date) {
  const mmdd = date.toISOString().slice(5, 10);
  const yyyy = String(date.getFullYear());
  if (RADUNICA[yyyy] === mmdd) return "Радуница";
  return BY_HOLIDAYS[mmdd] || null;
}

function getDayType(date, holiday) {
  if (holiday) return "sunday";
  const dow = date.getDay(); // 0=вс, 6=сб
  if (dow === 0) return "sunday";
  if (dow === 6) return "saturday";
  return "weekday";
}

function getDayLabel(date, holiday) {
  const days = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  const dow = days[date.getDay()];
  if (holiday) return `🎉 ${dow} · Праздник (${holiday})`;
  if (date.getDay() === 6) return `🎉 сб`;
  if (date.getDay() === 0) return `😴 вс`;
  return `💼 ${dow}`;
}

// ── WMO коды погоды ──────────────────────────────────────────────────────────
function decodeWeather(code, precip, wind) {
  let emoji = "☀️", label = "Ясно", mod = 0.00;

  if (code === 0) { emoji = "☀️"; label = "Ясно"; }
  else if (code <= 3) { emoji = "🌤"; label = "Переменная облачность"; }
  else if (code <= 48) { emoji = "🌫"; label = "Туман"; mod = 0.05; }
  else if (code <= 57) { emoji = "🌦"; label = "Морось"; mod = 0.10; }
  else if (code <= 67) {
    if (code >= 65) { emoji = "🌧"; label = "Сильный дождь"; mod = 0.20; }
    else { emoji = "🌦"; label = "Дождь"; mod = 0.12; }
  } else if (code <= 77) {
    if (code >= 75) { emoji = "❄️"; label = "Сильный снег"; mod = 0.35; }
    else { emoji = "🌨"; label = "Снег"; mod = 0.25; }
  } else if (code <= 82) { emoji = "🌧"; label = "Ливень"; mod = 0.18; }
  else if (code <= 86) { emoji = "🌨"; label = "Снежный ливень"; mod = 0.30; }
  else if (code >= 95) { emoji = "⛈"; label = "Гроза"; mod = 0.22; }

  // Ветер > 10 м/с — дополнительный буст
  if (wind > 10) { mod += 0.05; label += `, ветер ${Math.round(wind)} м/с`; }
  if (wind > 15) { mod += 0.07; }

  // Сильные осадки усиливают дальше
  if (precip > 10) mod += 0.05;

  return { emoji, label, mod: Math.min(mod, 0.50) };
}

// ── Open-Meteo ───────────────────────────────────────────────────────────────
async function fetchWeather() {
  const url = "https://api.open-meteo.com/v1/forecast?" + [
    "latitude=53.9",
    "longitude=27.567",
    "daily=weathercode,precipitation_sum,windspeed_10m_max",
    "timezone=Europe%2FMinsk",
    "forecast_days=8",
  ].join("&");

  const res  = await fetch(url);
  const json = await res.json();
  return json.daily; // { time[], weathercode[], precipitation_sum[], windspeed_10m_max[] }
}

// ── Surge + цена ─────────────────────────────────────────────────────────────
function calcSurge(zone, dayType, slot, weatherMod) {
  const base = TYPE_BASELINE[zone];
  const mult = TIME_MULT[zone][dayType][slot];
  return +(base * mult * (1 + weatherMod)).toFixed(3);
}

function cmfPrice(surge, km = 5, min = 12) {
  const raw = CMF_MIN * surge;
  return +Math.max(CMF_MIN, raw).toFixed(2);
}

function econPrice(surge, km = 5, min = 12) {
  const baza = ECON_BASE.pickup + ECON_BASE.perKm * km + ECON_BASE.perMin * min;
  return +Math.max(ECON_BASE.minimum, baza * surge).toFixed(2);
}

// ── Обоснование (reasons) ────────────────────────────────────────────────────
function buildReasons(dayType, holiday, weather) {
  const parts = [];
  if (holiday)            parts.push(`праздник — ${holiday}`);
  if (dayType === "saturday") parts.push("суббота — повышенный вечерний спрос");
  if (dayType === "sunday")   parts.push("воскресенье — низкий деловой трафик");
  if (weather.mod >= 0.25)    parts.push(`сильные осадки (+${Math.round(weather.mod*100)}% surge)`);
  else if (weather.mod >= 0.10) parts.push(`осадки (+${Math.round(weather.mod*100)}% surge)`);
  else if (weather.mod >= 0.05) parts.push(`неблагоприятные условия (+${Math.round(weather.mod*100)}%)`);
  if (parts.length === 0)     parts.push("стандартный день");
  return parts.join("; ");
}

// ── Excel ─────────────────────────────────────────────────────────────────────
async function buildExcel(days) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RWBTaxi ForecastBot";

  const BLUE   = "FF1E3A5F";
  const LBLUE  = "FFD6E4F0";
  const YELLOW = "FFFFF0C8";
  const RED    = "FFFFD6D6";
  const GREEN  = "FFD6FFE8";
  const ORANGE = "FFFFF3CC";

  function hStyle() {
    return { font: { bold: true, color: { argb: "FFFFFFFF" }, size: 11 },
             fill: { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } },
             alignment: { horizontal: "center", vertical: "middle", wrapText: true },
             border: { bottom: { style: "thin" } } };
  }

  function surge2fill(s) {
    if (s >= 2.5) return { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
    if (s >= 1.5) return { type: "pattern", pattern: "solid", fgColor: { argb: ORANGE } };
    if (s >= 1.0) return { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
    return { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
  }

  // ── ЛИСТ 1: сводка по дням ─────────────────────────────────────────────────
  const ws1 = wb.addWorksheet("Прогноз на неделю");
  ws1.views = [{ state: "frozen", ySplit: 3 }];

  // Заголовок
  const title = ws1.addRow(["RWBTaxi · Прогноз тарифов Yandex Go Минск"]);
  ws1.mergeCells("A1:O1");
  title.getCell(1).style = { font: { bold: true, size: 14, color: { argb: BLUE } } };
  title.height = 26;

  const sub = ws1.addRow([`Сформировано: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Minsk" })} · Якорь: будни·полдень = ×1.00 · Тариф v4/v5`]);
  ws1.mergeCells("A2:O2");
  sub.getCell(1).style = { font: { italic: true, size: 10, color: { argb: "FF555555" } } };
  sub.height = 16;

  // Шапка: день | погода | [слот × 3 зоны]
  const ZONES_SHOWN = ["center", "sleeper", "mall"];
  const hdrCols = ["Дата / День", "Тип", "Погода", "Причины surge"];
  ZONES_SHOWN.forEach(z => SLOT_KEYS.filter(s => s !== "night" && s !== "late").forEach(s => {
    hdrCols.push(`${ZONE_RU[z]}\n${SLOT_RU[s].split(" ")[0]}`);
  }));

  const hdrRow = ws1.addRow(hdrCols);
  hdrRow.height = 42;
  hdrRow.eachCell(c => { c.style = hStyle(); });

  ws1.columns = [
    { width: 22 }, { width: 12 }, { width: 28 }, { width: 40 },
    ...ZONES_SHOWN.flatMap(() => [{ width: 10 }, { width: 10 }, { width: 10 }]),
  ];

  // Данные
  for (const d of days) {
    const rowData = [d.label, d.dayTypeLabel, `${d.weather.emoji} ${d.weather.label}`, d.reasons];

    ZONES_SHOWN.forEach(zone => {
      ["morning", "midday", "evening"].forEach(slot => {
        const s = d.surges[zone][slot];
        rowData.push(s.toFixed(2) + "×");
      });
    });

    const row = ws1.addRow(rowData);
    row.height = 20;

    // Фон для строки праздника / выходных
    if (d.holiday) {
      ["A","B","C","D"].forEach(col => {
        row.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF0D0" } };
      });
    }

    // Цветовая шкала по сёрджу
    let colIdx = 5;
    ZONES_SHOWN.forEach(zone => {
      ["morning", "midday", "evening"].forEach(slot => {
        const s = d.surges[zone][slot];
        const cell = row.getCell(colIdx++);
        cell.fill = surge2fill(s);
        cell.alignment = { horizontal: "center" };
        cell.font = { bold: s >= 1.5 };
      });
    });
  }

  // ── Легенда ────────────────────────────────────────────────────────────────
  ws1.addRow([]);
  const leg = ws1.addRow(["Легенда: 🟩 surge <1.0 · 🟨 1.0–1.5 · 🟧 1.5–2.5 · 🟥 ≥2.5"]);
  ws1.mergeCells(`A${leg.number}:O${leg.number}`);
  leg.getCell(1).style = { font: { italic: true, size: 9 } };

  // ── ЛИСТ 2: детальная матрица по всем зонам ────────────────────────────────
  const ws2 = wb.addWorksheet("Детали по зонам");
  ws2.views = [{ state: "frozen", ySplit: 2, xSplit: 2 }];

  const allZones = Object.keys(TYPE_BASELINE);
  const h2 = ws2.addRow(["Зона", "Слот", ...days.map(d => d.label)]);
  h2.height = 36;
  h2.eachCell(c => { c.style = hStyle(); });
  ws2.columns = [{ width: 20 }, { width: 18 }, ...days.map(() => ({ width: 13 }))];

  allZones.forEach(zone => {
    SLOT_KEYS.forEach((slot, si) => {
      const row = ws2.addRow([
        si === 0 ? ZONE_RU[zone] : "",
        SLOT_RU[slot],
        ...days.map(d => d.surges[zone] ? +(d.surges[zone][slot]).toFixed(2) : "—"),
      ]);
      row.height = 18;
      if (si === 0) {
        row.getCell(1).style = { font: { bold: true, color: { argb: BLUE } } };
      }
      // Цвет по surge
      days.forEach((d, di) => {
        if (!d.surges[zone]) return;
        const s = d.surges[zone][slot];
        const cell = row.getCell(di + 3);
        cell.fill = surge2fill(s);
        cell.alignment = { horizontal: "center" };
        cell.numFmt = "0.00";
      });
    });
    ws2.addRow([]); // разделитель
  });

  // ── ЛИСТ 3: цены (5 км / 12 мин) ──────────────────────────────────────────
  const ws3 = wb.addWorksheet("Цены 5км·12мин");
  ws3.views = [{ state: "frozen", ySplit: 2, xSplit: 2 }];

  const h3 = ws3.addRow(["Зона", "Слот / Тариф", ...days.map(d => d.label)]);
  h3.height = 36;
  h3.eachCell(c => { c.style = hStyle(); });
  ws3.columns = [{ width: 20 }, { width: 20 }, ...days.map(() => ({ width: 13 }))];

  allZones.forEach(zone => {
    SLOT_KEYS.forEach((slot, si) => {
      const rowC = ws3.addRow([
        si === 0 ? `${ZONE_RU[zone]} · Комфорт` : "",
        `${SLOT_RU[slot]}`,
        ...days.map(d => d.surges[zone] ? cmfPrice(d.surges[zone][slot]) : "—"),
      ]);
      rowC.height = 18;
      if (si === 0) rowC.getCell(1).style = { font: { bold: true, color: { argb: BLUE } } };
      days.forEach((d, di) => {
        const cell = rowC.getCell(di + 3);
        cell.numFmt = '"BYN "0.00';
        cell.alignment = { horizontal: "center" };
        const s = d.surges[zone] ? d.surges[zone][slot] : 1;
        cell.fill = surge2fill(s);
      });
    });
    SLOT_KEYS.forEach((slot, si) => {
      const rowE = ws3.addRow([
        si === 0 ? `${ZONE_RU[zone]} · Эконом` : "",
        `${SLOT_RU[slot]}`,
        ...days.map(d => d.surges[zone] ? econPrice(d.surges[zone][slot]) : "—"),
      ]);
      rowE.height = 18;
      days.forEach((d, di) => {
        const cell = rowE.getCell(di + 3);
        cell.numFmt = '"BYN "0.00';
        cell.alignment = { horizontal: "center" };
        const s = d.surges[zone] ? d.surges[zone][slot] : 1;
        cell.fill = surge2fill(s);
      });
    });
    ws3.addRow([]);
  });

  return wb;
}

// ── Сборка данных на 7 дней ────────────────────────────────────────────────
async function buildForecastDays() {
  const weatherDaily = await fetchWeather();

  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 1; i <= 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    const holiday = getHoliday(date);
    const dayType = getDayType(date, holiday);
    const label   = getDayLabel(date, holiday);

    // Найти индекс в Open-Meteo (time = "YYYY-MM-DD")
    const isoDate = date.toISOString().slice(0, 10);
    const wi = (weatherDaily.time || []).indexOf(isoDate);

    let weather = { emoji: "❓", label: "нет данных", mod: 0 };
    if (wi >= 0) {
      weather = decodeWeather(
        weatherDaily.weathercode[wi],
        weatherDaily.precipitation_sum[wi],
        weatherDaily.windspeed_10m_max[wi],
      );
    }

    const surges = {};
    for (const zone of Object.keys(TYPE_BASELINE)) {
      surges[zone] = {};
      for (const slot of SLOT_KEYS) {
        surges[zone][slot] = calcSurge(zone, dayType, slot, weather.mod);
      }
    }

    days.push({
      date, label,
      dayType, dayTypeLabel: dayType === "weekday" ? "Будни" : dayType === "saturday" ? "Суббота" : "Вс/Праздник",
      holiday, weather, surges,
      reasons: buildReasons(dayType, holiday, weather),
    });
  }

  return days;
}

// ── Бот ───────────────────────────────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: true });
console.log("✅ RWBTaxi ForecastBot запущен. Жду /forecast ...");

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "👋 RWBTaxi ForecastBot\n\n" +
    "Команды:\n" +
    "  /forecast — прогноз тарифов Yandex Go на 7 дней в виде Excel-файла\n\n" +
    "Прогноз учитывает:\n" +
    "• Погоду в Минске (дождь / снег / ветер → буст surge)\n" +
    "• Праздники Беларуси (переводят день в режим воскресенья)\n" +
    "• Сёрдж по типу зоны и слоту (спальник, центр, ТЦ…)\n" +
    "• Тариф v4/v5: Эконом = 5.567 + 0.503·км + 0.209·мин; Комфорт minimum=9.10 BYN"
  );
});

bot.onText(/\/forecast/, async (msg) => {
  const chatId = msg.chat.id;

  await bot.sendMessage(chatId, "⏳ Запрашиваю погоду и строю прогноз на 7 дней...");

  try {
    const days = await buildForecastDays();
    const wb   = await buildExcel(days);

    // Сохраняем во временный файл
    const tmpPath = join(tmpdir(), `forecast_${chatId}_${Date.now()}.xlsx`);
    await wb.xlsx.writeFile(tmpPath);

    // Краткий текстовый анонс
    const lines = ["📊 *Прогноз тарифов Yandex Go Минск — 7 дней*\n"];
    for (const d of days) {
      const cSurge = d.surges["center"]["evening"];
      const sSurge = d.surges["sleeper"]["morning"];
      lines.push(
        `${d.weather.emoji} *${d.label}*\n` +
        `   Центр·вечер: ×${cSurge.toFixed(2)} | Спальник·утро: ×${sSurge.toFixed(2)}\n` +
        `   _${d.reasons}_`
      );
    }
    lines.push("\n📎 Полный Excel ниже ↓");

    await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });

    // Отправляем файл
    const dateStr = new Date().toISOString().slice(0, 10);
    await bot.sendDocument(chatId, tmpPath, {}, {
      filename: `tariff-forecast-${dateStr}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    if (existsSync(tmpPath)) unlinkSync(tmpPath);

  } catch (err) {
    console.error("Forecast error:", err);
    await bot.sendMessage(chatId, `❌ Ошибка: ${err.message}`);
  }
});

bot.on("polling_error", (err) => {
  console.error("Polling error:", err.code, err.message);
});
