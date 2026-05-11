#!/usr/bin/env node
// Отправляет один файл orders/<date>-<HHMM>.json в общий пул калибровок
// на VPS через POST https://rwbtaxi.by/api/calib/submit.
//
// Использование:
//   node scripts/push-orders-to-server.mjs scripts/orders/2026-04-27-1500.json
//
// Опционально через окружение:
//   CALIB_URL=https://rwbtaxi.by/api/calib/submit
//   CALIB_TOKEN=<token>           если на сервере включён Bearer-токен
//   CALIB_DEMAND_DEFAULT=yellow   если в notes нет 🟢/⚡/🔴
//   CALIB_SOURCE=screenshot-import (метка источника, идёт в payload)
//   CALIB_DRY=1                   только распечатать payload, не слать

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join, basename, extname } from "node:path";

const args = process.argv.slice(2);
const force = args.includes("--force");
const filePath = args.find((a) => !a.startsWith("--"));
if (!filePath) {
  console.error("Использование: node scripts/push-orders-to-server.mjs <orders.json> [--force]");
  process.exit(1);
}

const URL_DEFAULT = "https://rwbtaxi.by/api/calib/submit";
const url     = process.env.CALIB_URL || URL_DEFAULT;
const token   = process.env.CALIB_TOKEN || "";
const source  = process.env.CALIB_SOURCE || "screenshot-import";
const dry     = process.env.CALIB_DRY === "1";
const demandDefault = (process.env.CALIB_DEMAND_DEFAULT || "yellow").toLowerCase();

// Маркер «уже отправлено» рядом с исходным orders-файлом.
// При повторном запуске пропускаем заказы из marker.pushed[], если нет --force.
const absFile = resolve(filePath);
const markerPath = join(dirname(absFile), basename(absFile, extname(absFile)) + ".pushed.json");
let pushed = new Set();
if (!dry && !force && existsSync(markerPath)) {
  try {
    const m = JSON.parse(readFileSync(markerPath, "utf8"));
    if (Array.isArray(m.pushed)) pushed = new Set(m.pushed);
  } catch (e) {
    console.warn(`  ⚠ маркер ${basename(markerPath)} битый, игнорирую: ${e.message}`);
  }
}

const data = JSON.parse(readFileSync(resolve(filePath), "utf8"));
if (!data.coords || !Array.isArray(data.orders)) {
  console.error(`Файл ${filePath} не похож на orders.json (нет coords/orders[])`);
  process.exit(1);
}

// Из notes выводим demand: 🟢 → green, 🔴 → red, ⚡ → yellow, иначе default.
function demandFromNotes(s = "") {
  const t = s.toLowerCase();
  if (s.includes("🟢") || t.includes("green") || t.includes("без surge") || t.includes("без ⚡")) return "green";
  if (s.includes("🔴") || t.includes(" red")) return "red";
  if (s.includes("⚡") || t.includes("yellow") || t.includes("⚡yellow")) return "yellow";
  return demandDefault;
}

// etaMin (подача Эконома) выудим из строки notes вида "Подача: Эконом 6 / Комфорт 4 мин".
function etaMinFromNotes(s = "") {
  const m = s.match(/эконом\s+(\d+)/i) || s.match(/подача[:\s]+эконом\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

// receiver принимает токен в X-Calib-Token (см. server/calib-receiver.mjs).
const headers = { "Content-Type": "application/json" };
if (token) headers["X-Calib-Token"] = token;

let ok = 0, fail = 0, skipped = 0;
const errors = [];
const newlyPushed = [];
for (const o of data.orders) {
  if (pushed.has(o.id)) {
    console.log(`  · ${o.id} → пропуск (уже отправлено ранее, --force чтобы повторить)`);
    skipped++;
    continue;
  }
  const fromCoords = data.coords[o.from];
  const toCoords   = data.coords[o.to];
  if (!fromCoords || !toCoords) {
    console.warn(`  ⚠ ${o.id}: нет координат для "${o.from}" или "${o.to}" — пропуск`);
    fail++;
    continue;
  }
  const payload = {
    fromAddress: o.from,
    toAddress:   o.to,
    fromLat:     fromCoords[0],
    fromLng:     fromCoords[1],
    toLat:       toCoords[0],
    toLng:       toCoords[1],
    factE:       o.factE ?? null,
    factC:       o.factC ?? null,
    etaMin:      etaMinFromNotes(o.notes ?? ""),
    demand:      demandFromNotes(o.notes ?? ""),
    date:        data.date,
    hour:        o.hour ?? null,
    source,
    notes:       `[${o.id}] ${o.notes ?? ""}`.trim(),
  };
  if (dry) {
    console.log(JSON.stringify(payload));
    continue;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    if (!res.ok) {
      fail++;
      errors.push({ id: o.id, status: res.status, body: body.slice(0, 200) });
      console.warn(`  ✗ ${o.id} → HTTP ${res.status}: ${body.slice(0, 120)}`);
    } else {
      ok++;
      newlyPushed.push(o.id);
      let pretty = body;
      try { pretty = JSON.stringify(JSON.parse(body)); } catch {}
      console.log(`  ✓ ${o.id} → ${pretty}`);
    }
  } catch (e) {
    fail++;
    errors.push({ id: o.id, error: String(e) });
    console.warn(`  ✗ ${o.id} → ${e.message}`);
  }
}

// Обновляем маркер «уже отправлено», объединяя с прошлыми пушами.
if (!dry && newlyPushed.length) {
  const merged = Array.from(new Set([...pushed, ...newlyPushed])).sort();
  const markerData = {
    sourceFile: basename(absFile),
    updatedAt:  new Date().toISOString(),
    endpoint:   url,
    pushed:     merged,
  };
  try {
    writeFileSync(markerPath, JSON.stringify(markerData, null, 2));
  } catch (e) {
    console.warn(`  ⚠ не смог записать маркер ${basename(markerPath)}: ${e.message}`);
  }
}

console.log(
  `\nИтого: отправлено ${ok}, пропущено ${skipped}, ошибок ${fail}, всего ${data.orders.length}`,
);
if (!dry && newlyPushed.length) {
  console.log(`Маркер обновлён: ${basename(markerPath)} (${pushed.size + newlyPushed.length} ID)`);
}
if (errors.length) {
  console.log("Ошибки:");
  for (const e of errors) console.log("  ", e);
  process.exit(2);
}
