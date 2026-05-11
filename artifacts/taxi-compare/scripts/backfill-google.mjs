#!/usr/bin/env node
// Backfill historical orders/*.json with Google "typical traffic" estimates.
// Для каждой партии берёт хранимые orders и запрашивает Google Routes API
// с departureTime = ближайший будущий аналогичный (day+hour+minute) слот.
// Google вернёт typical traffic patterns для этого времени недели — это лучше
// чем TomTom ×1.06 (TomTom систематически недооценивает трафик в Минске на ~34%).
//
// Использование:
//   GOOGLE_MAPS_KEY=xxx node scripts/backfill-google.mjs                      # все файлы (skip уже backfilled)
//   GOOGLE_MAPS_KEY=xxx node scripts/backfill-google.mjs --force              # перезаписать всё
//   GOOGLE_MAPS_KEY=xxx node scripts/backfill-google.mjs --dry-run            # без API запросов
//   GOOGLE_MAPS_KEY=xxx node scripts/backfill-google.mjs scripts/orders/2026-04-26-1330.json  # выборочно
//
// Output: scripts/orders/<filename>.google-backfill.json для каждого input файла
//         + сводная статистика в stdout.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";

const GOOGLE_KEY = process.env.GOOGLE_MAPS_KEY;
if (!GOOGLE_KEY) { console.error("ERROR: GOOGLE_MAPS_KEY не задан"); process.exit(1); }

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const DRY = args.includes("--dry-run");
const fileArgs = args.filter(a => !a.startsWith("--"));

const DAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

// Минск = UTC+3 круглый год (нет DST с 2011 г). Все hour/day в orders/*.json
// — Минские. Контейнер Replit работает в UTC, поэтому нельзя использовать
// .setHours() / .getDay() — они вернут UTC значения, и backfill уйдёт на 3 часа
// позже желаемого.
const MINSK_TZ_OFFSET_MIN = 180;

function nextSlotForDay(targetDay, targetHour, targetMinute = 0) {
  const targetIdx = DAYS.indexOf(targetDay.toLowerCase());
  if (targetIdx < 0) return null;
  const offsetMs = MINSK_TZ_OFFSET_MIN * 60_000;
  // "Сейчас" в Минске, представленное как если бы это был UTC:
  const nowMinsk = new Date(Date.now() + offsetMs);
  const currentIdx = nowMinsk.getUTCDay();
  let daysAdd = (targetIdx - currentIdx + 7) % 7;
  // Целевой Минский слот, всё ещё в "shifted" представлении:
  const targetMinsk = new Date(Date.UTC(
    nowMinsk.getUTCFullYear(),
    nowMinsk.getUTCMonth(),
    nowMinsk.getUTCDate() + daysAdd,
    targetHour, targetMinute, 0, 0,
  ));
  // Если уже прошло (или в пределах 1 мин) — переносим на след. неделю:
  if (targetMinsk.getTime() <= nowMinsk.getTime() + 60_000) {
    targetMinsk.setUTCDate(targetMinsk.getUTCDate() + 7);
  }
  // Конверсия "Минск-как-UTC" в реальный UTC момент:
  return new Date(targetMinsk.getTime() - offsetMs);
}

// Извлечь minute из имени файла YYYY-MM-DD-HHMM.json (например "2026-04-26-1330.json" → 30)
function extractMinuteFromFile(filename) {
  const m = basename(filename).match(/-(\d{2})(\d{2})(?:-[A-Z])?\.json$/);
  return m ? parseInt(m[2]) : 0;
}

async function googleRoute(fromPt, toPt, departureTime) {
  const body = {
    origin:      { location: { latLng: { latitude: fromPt[0], longitude: fromPt[1] } } },
    destination: { location: { latLng: { latitude: toPt[0],   longitude: toPt[1]   } } },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE_OPTIMAL",
    departureTime: departureTime.toISOString(),
    routeModifiers: { avoidHighways: true, avoidTolls: false, avoidFerries: true },
  };
  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_KEY,
        "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      if (process.env.DEBUG_GOOGLE) {
        const txt = await r.text().catch(() => "");
        console.error(`[googleRoute] HTTP ${r.status}: ${txt.slice(0, 300)}`);
      }
      return null;
    }
    const j = await r.json();
    if (!j.routes?.[0]) return null;
    const route = j.routes[0];
    const trafficSec = parseInt(route.duration);
    const freeSec = parseInt(route.staticDuration);
    const km = route.distanceMeters / 1000;
    if (!Number.isFinite(trafficSec) || !Number.isFinite(freeSec) || freeSec <= 0) return null;
    return { km, freeMin: freeSec/60, trafficMin: trafficSec/60, gMult: trafficSec/freeSec };
  } catch (e) { return null; }
}

// --- Сбор файлов ---------------------------------------------------------
let files;
if (fileArgs.length) {
  files = fileArgs;
} else {
  const dir = "scripts/orders";
  files = readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}/.test(f))
    .filter(f => f.endsWith(".json"))
    .filter(f => !f.endsWith(".results.json"))
    .filter(f => !f.endsWith(".google-backfill.json"))
    .sort()
    .map(f => join(dir, f));
}

console.log(`📂 Backfill: ${files.length} файлов${DRY ? " (DRY RUN)" : ""}${FORCE ? " (FORCE)" : ""}\n`);

let totalOrders = 0;
let totalRequests = 0;
let totalSuccess = 0;
let totalSkipped = 0;
const allRows = [];

const BATCH = 5;

for (const file of files) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (!data.orders?.length) { console.log(`— ${basename(file)}: пустые orders, пропуск`); continue; }
  if (!data.day) { console.log(`⚠ ${basename(file)}: нет поля day, пропуск`); continue; }

  const outFile = file.replace(/\.json$/, ".google-backfill.json");
  if (existsSync(outFile) && !FORCE) {
    let existing;
    try {
      existing = JSON.parse(readFileSync(outFile, "utf8"));
    } catch {
      console.log(`↻ ${basename(file).padEnd(35)} битый файл, пере-backfill`);
      existing = null;
    }
    if (existing) {
      const errCount = existing.results?.filter(r => r.err).length ?? 0;
      const okCount = existing.results?.filter(r => !r.err && r.googleTrafficMin).length ?? 0;
      const expected = data.orders.length;
      // Skip только если ВСЕ заказы успешно (без err и количество совпадает).
      if (errCount === 0 && okCount === expected) {
        const prevRows = existing.results.filter(r => !r.err);
        allRows.push(...prevRows);
        totalSkipped++;
        console.log(`↻ ${basename(file).padEnd(35)} skip (уже backfilled, ${prevRows.length} ok)`);
        continue;
      }
      console.log(`↻ ${basename(file).padEnd(35)} re-try (err=${errCount}, ok=${okCount}/${expected})`);
    }
  }

  const fileMin = extractMinuteFromFile(file);
  const fileResults = [];
  let fileSucc = 0;

  const orders = data.orders;
  for (let i = 0; i < orders.length; i += BATCH) {
    const batch = orders.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async o => {
      const fromPt = data.coords[o.from], toPt = data.coords[o.to];
      if (!fromPt || !toPt) return { id: o.id, err: "no coords", from: o.from, to: o.to };
      const hour = o.hour ?? null;
      if (hour == null) return { id: o.id, err: "no hour" };
      const dep = nextSlotForDay(data.day, hour, fileMin);
      if (!dep) return { id: o.id, err: `bad day "${data.day}"` };

      const base = {
        id: o.id, from: o.from, to: o.to,
        hour, day: data.day, departureTime: dep.toISOString(),
        yaMin: o.yaMin ?? null, yaSurgeC: o.yaSurgeC ?? null,
        factC: o.factC ?? null, factE: o.factE ?? null,
      };

      if (DRY) return { ...base, dry: true };

      const gr = await googleRoute(fromPt, toPt, dep);
      totalRequests++;
      if (!gr) return { ...base, err: "API fail" };
      totalSuccess++; fileSucc++;
      return {
        ...base,
        googleKm: +gr.km.toFixed(3),
        googleFreeMin: +gr.freeMin.toFixed(2),
        googleTrafficMin: +gr.trafficMin.toFixed(2),
        gMult: +gr.gMult.toFixed(3),
      };
    }));
    fileResults.push(...results);
  }
  totalOrders += orders.length;

  if (!DRY) {
    writeFileSync(outFile, JSON.stringify({
      sourceFile: basename(file),
      backfilledAt: new Date().toISOString(),
      date: data.date, day: data.day, fileMinute: fileMin,
      successCount: fileSucc, totalCount: orders.length,
      results: fileResults,
    }, null, 2));
  }
  console.log(`✓ ${basename(file).padEnd(35)} ${fileSucc}/${orders.length}${DRY ? " (dry)" : ""}`);
  allRows.push(...fileResults.filter(r => !r.err && r.googleTrafficMin));
}

console.log(`\n========= ИТОГО =========`);
console.log(`Файлов всего:    ${files.length}`);
console.log(`Файлов пропущено (уже сделано): ${totalSkipped}`);
console.log(`Заказов обработано: ${totalOrders}`);
console.log(`Запросов в Google:  ${totalRequests}`);
if (totalRequests > 0) {
  console.log(`Успешных:           ${totalSuccess} (${(totalSuccess/totalRequests*100).toFixed(1)}%)`);
  console.log(`Стоимость:          ~$${(totalRequests * 0.01).toFixed(2)} (free tier $200/мес)`);
}

// --- Δ Yandex vs Google по всем точкам ---
const withYa = allRows.filter(r => r.yaMin != null && r.googleTrafficMin);
if (withYa.length >= 5) {
  const dPcts = withYa.map(r => (r.googleTrafficMin - r.yaMin) / r.yaMin * 100);
  const mean = a => a.reduce((s,x)=>s+x,0)/a.length;
  const median = a => { const s=[...a].sort((x,y)=>x-y); return s.length%2 ? s[(s.length-1)/2] : (s[s.length/2-1]+s[s.length/2])/2; };
  const sorted = [...dPcts].sort((a,b)=>a-b);
  console.log(`\n========= Δ Google trafficMin vs Я.мин =========`);
  console.log(`Точек с известным yaMin: ${withYa.length}/${allRows.length} (${(withYa.length/allRows.length*100).toFixed(0)}%)`);
  console.log(`  mean        = ${mean(dPcts)>=0?'+':''}${mean(dPcts).toFixed(1)}%  (общая систематическая ошибка)`);
  console.log(`  median      = ${median(sorted)>=0?'+':''}${median(sorted).toFixed(1)}%`);
  console.log(`  |mean abs|  = ${mean(dPcts.map(Math.abs)).toFixed(1)}%   (средний размер ошибки независимо от знака)`);
  console.log(`  range       = ${sorted[0].toFixed(0)}% .. ${sorted.at(-1).toFixed(0)}%`);
  console.log(`  q25/q75     = ${sorted[Math.floor(sorted.length*0.25)].toFixed(0)}% / ${sorted[Math.floor(sorted.length*0.75)].toFixed(0)}%`);

  const within10 = dPcts.filter(d => Math.abs(d) <= 10).length;
  const within20 = dPcts.filter(d => Math.abs(d) <= 20).length;
  const within30 = dPcts.filter(d => Math.abs(d) <= 30).length;
  console.log(`\n  В пределах ±10%: ${within10} (${(within10/withYa.length*100).toFixed(0)}%)`);
  console.log(`  В пределах ±20%: ${within20} (${(within20/withYa.length*100).toFixed(0)}%)`);
  console.log(`  В пределах ±30%: ${within30} (${(within30/withYa.length*100).toFixed(0)}%)`);

  // По часам
  console.log(`\n--- По часам (mean Δ%) ---`);
  const byHour = {};
  for (const r of withYa) {
    (byHour[r.hour] ??= []).push((r.googleTrafficMin - r.yaMin) / r.yaMin * 100);
  }
  for (const h of Object.keys(byHour).sort((a,b)=>+a-+b)) {
    const arr = byHour[h];
    console.log(`  ${h.padStart(2)}:00  n=${arr.length.toString().padStart(3)}  mean ${mean(arr)>=0?'+':''}${mean(arr).toFixed(1)}%  median ${median([...arr].sort((a,b)=>a-b))>=0?'+':''}${median([...arr].sort((a,b)=>a-b)).toFixed(1)}%`);
  }

  // По дням недели
  console.log(`\n--- По дням недели (mean Δ%) ---`);
  const byDay = {};
  for (const r of withYa) {
    (byDay[r.day] ??= []).push((r.googleTrafficMin - r.yaMin) / r.yaMin * 100);
  }
  for (const d of DAYS.filter(d => byDay[d])) {
    const arr = byDay[d];
    console.log(`  ${d.padEnd(10)}  n=${arr.length.toString().padStart(3)}  mean ${mean(arr)>=0?'+':''}${mean(arr).toFixed(1)}%`);
  }

  // Топ-10 худших
  const worst = withYa.map(r => ({...r, d: (r.googleTrafficMin-r.yaMin)/r.yaMin*100}))
    .sort((a,b)=>Math.abs(b.d)-Math.abs(a.d)).slice(0, 10);
  console.log(`\n--- Топ-10 худших расхождений (вероятно МКАД-крюки или редкие маршруты) ---`);
  for (const r of worst) {
    const fromTrim = (r.from || "").slice(0, 22).padEnd(22);
    const toTrim   = (r.to   || "").slice(0, 22).padEnd(22);
    console.log(`  ${r.id} ${fromTrim} → ${toTrim}: Я=${r.yaMin}мин, G=${r.googleTrafficMin.toFixed(1)}мин (${r.d>=0?'+':''}${r.d.toFixed(0)}%)`);
  }
}
