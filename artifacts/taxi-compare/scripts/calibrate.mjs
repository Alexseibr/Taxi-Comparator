#!/usr/bin/env node
// Калибровщик скриншотов Yandex Go против нашей модели — с TomTom Live Traffic.
//
// Использование:
//   VITE_TOMTOM_KEY=xxx node scripts/calibrate.mjs scripts/orders/2026-04-26.json
//
// Формат orders.json (см. scripts/orders/README.md):
// {
//   "date": "2026-04-26",
//   "day": "sunday",
//   "coords": {
//     "Авиационная 29": [53.917, 27.741],
//     ...
//   },
//   "orders": [
//     { "id":"9853", "from":"Авиационная 29", "to":"Карла Маркса 21",
//       "factE":15.8, "factC":17.5, "hour":9, "notes":"..." }
//   ]
// }
//
// Что делает:
//   1. OSRM driving route (overview=full) — реальный маршрут с геометрией.
//   2. TomTom Live Traffic Flow в N точках вдоль маршрута → мультипликатор пробок.
//   3. Применяет BASE_TARIFF (читается из observations.json calibrationVersion).
//   4. Считает sC = factC / rawC, sE = factE / rawE, hidden_boost = sE / sC.
//   5. Сводка: mean/std/min/max сёрджей, средний траффик, рекомендации.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const TOMTOM_KEY = process.env.VITE_TOMTOM_KEY;
if (!TOMTOM_KEY) {
  console.error("ERROR: VITE_TOMTOM_KEY не задан. Экспортируй ключ или запусти через `pnpm calib`.");
  process.exit(1);
}
const GOOGLE_KEY = process.env.GOOGLE_MAPS_KEY;
if (!GOOGLE_KEY) {
  console.warn("WARN: GOOGLE_MAPS_KEY не задан — Google Routes/Weather пропущены (только TomTom).");
}

const ordersPath = process.argv[2];
if (!ordersPath) {
  console.error("Usage: node scripts/calibrate.mjs <orders.json>");
  process.exit(1);
}
const ordersFile = resolve(process.cwd(), ordersPath);
if (!existsSync(ordersFile)) { console.error(`Не найден файл: ${ordersFile}`); process.exit(1); }

const data = JSON.parse(readFileSync(ordersFile, "utf8"));
const { coords: COORDS, orders: ORDERS, day = "sunday", date } = data;
if (!COORDS || !ORDERS) { console.error("orders.json должен содержать `coords` и `orders`"); process.exit(1); }

// --- Тариф из observations.json (источник правды калибровки v2) ---------
const obsFile = join(ROOT, "public/data/observations.json");
const obsJson = JSON.parse(readFileSync(obsFile, "utf8"));
const calibVer = obsJson.calibrationVersion ?? 2;
// Тариф v3 — плоская baza Yandex (perKm/perMin = 0).
const E = { pickup: 0, perKm: 0, perMin: 0, min: 9 };
const C = { pickup: 0, perKm: 0, perMin: 0, min: 10 };
const rawCmf = (km, min) => Math.max(C.min, C.pickup + C.perKm*km + C.perMin*min);
const rawEcon = (km, min) => Math.max(E.min, E.pickup + E.perKm*km + E.perMin*min);

// --- OSRM ---------------------------------------------------------------
async function osrmFull(from, to) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`osrm ${r.status}`);
  const j = await r.json();
  if (j.code !== "Ok") throw new Error(`osrm ${j.code}`);
  const route = j.routes[0];
  return { km: route.distance/1000, freeMin: route.duration/60, coords: route.geometry.coordinates };
}

// --- TomTom Live Traffic ------------------------------------------------
async function tomtomFlow(lat, lng) {
  const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${lat},${lng}&unit=KMPH&key=${TOMTOM_KEY}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j = await r.json();
    const seg = j?.flowSegmentData;
    if (!seg) return null;
    const cur = Number(seg.currentSpeed), free = Number(seg.freeFlowSpeed);
    if (!Number.isFinite(cur) || !Number.isFinite(free) || free <= 0) return null;
    return { cur, free, ratio: cur/free };
  } catch { return null; }
}

// Семплирование маршрута по длине, не по числу узлов (равномерно по км).
async function trafficMultiplier(coords, samples = 6) {
  const segLens = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i-1], [lng2, lat2] = coords[i];
    const R = 6371, t = d => d*Math.PI/180;
    const dL = t(lat2-lat1), dG = t(lng2-lng1);
    const d = 2*R*Math.asin(Math.sqrt(Math.sin(dL/2)**2 + Math.sin(dG/2)**2*Math.cos(t(lat1))*Math.cos(t(lat2))));
    segLens.push(d); total += d;
  }
  const targets = Array.from({length: samples}, (_, s) => total * (s + 0.5) / samples);
  const points = [];
  let acc = 0, i = 0;
  for (const t of targets) {
    while (i < segLens.length - 1 && acc + segLens[i] < t) { acc += segLens[i]; i++; }
    const seg = segLens[i] || 0.0001;
    const f = (t - acc) / seg;
    const [lng1, lat1] = coords[i] || coords.at(-1);
    const [lng2, lat2] = coords[i+1] || coords[i] || coords.at(-1);
    points.push([lat1 + (lat2-lat1)*f, lng1 + (lng2-lng1)*f]);
  }
  const flows = await Promise.all(points.map(([la, ln]) => tomtomFlow(la, ln)));
  const valid = flows.filter(Boolean);
  if (!valid.length) return { mult: 1.0, n: 0, total: flows.length, ratios: [], meanRatio: 1 };
  const meanRatio = valid.reduce((a, f) => a + f.ratio, 0) / valid.length;
  const mult = Math.max(1, Math.min(3, 1/meanRatio));
  return { mult, n: valid.length, total: flows.length, meanRatio, ratios: valid.map(f => +f.ratio.toFixed(2)) };
}

// --- Google Routes API (TRAFFIC_AWARE_OPTIMAL, городской маршрут) -------
// Возвращает {km, freeMin, trafficMin, gMult} или null.
// Стоимость ≈ $0.01/запрос (free tier $200/мес → ~20 000 запросов).
//
// ВАЖНО (фикс k-партии): без avoidHighways Google для дальних маршрутов уходит
// МКАД-крюком (Ермака→Братская: OSRM=14км → Google=66км). Это даёт нереальную
// скорость 60+ км/ч и ломает Δ vs Yandex (-25%). С avoidHighways=true Google
// строит маршрут как реальный таксист — через городские улицы.
//
// departureTime: ISO-строка или Date. Для backfill историч.точек передавай
// ближайший будущий аналогичный слот (например, "пн 11:47" → следующий пн).
// Без аргумента = now+60s (стандарт live-калибровки).
async function googleRoute(fromPt, toPt, departureTime = null) {
  if (!GOOGLE_KEY) return null;
  const depISO = departureTime
    ? (departureTime instanceof Date ? departureTime.toISOString() : departureTime)
    : new Date(Date.now() + 60_000).toISOString();
  const body = {
    origin:      { location: { latLng: { latitude: fromPt[0], longitude: fromPt[1] } } },
    destination: { location: { latLng: { latitude: toPt[0],   longitude: toPt[1]   } } },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE_OPTIMAL",
    departureTime: depISO,
    routeModifiers: {
      avoidHighways: true,  // важно для Минска: без этого Google тащит на МКАД
      avoidTolls: false,    // в РБ платных дорог нет
      avoidFerries: true,
    },
    extraComputations: ["TRAFFIC_ON_POLYLINE"],
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
        console.error(`[googleRoute] HTTP ${r.status}: ${txt.slice(0, 200)}`);
      }
      return null;
    }
    const j = await r.json();
    if (!j.routes || !j.routes[0]) return null;
    const route = j.routes[0];
    const trafficSec = parseInt(route.duration);
    const freeSec    = parseInt(route.staticDuration);
    const km = route.distanceMeters / 1000;
    if (!Number.isFinite(trafficSec) || !Number.isFinite(freeSec) || freeSec <= 0) return null;
    return { km, freeMin: freeSec/60, trafficMin: trafficSec/60, gMult: trafficSec/freeSec };
  } catch { return null; }
}

// --- Google Weather API (current conditions) ----------------------------
// Возвращает погоду в точке (берём центр пикапа партии).
// Стоимость ≈ $0.0005/запрос — 1 раз на партию.
async function googleWeather(lat, lng) {
  if (!GOOGLE_KEY) return null;
  const url = `https://weather.googleapis.com/v1/currentConditions:lookup?key=${GOOGLE_KEY}&location.latitude=${lat}&location.longitude=${lng}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j = await r.json();
    return {
      condition:    j.weatherCondition?.description?.text ?? null,
      conditionType: j.weatherCondition?.type ?? null,
      tempC:        j.temperature?.degrees ?? null,
      precipMmH:    j.precipitation?.qpf?.quantity ?? 0,
      precipProb:   j.precipitation?.probability?.percent ?? 0,
      precipType:   j.precipitation?.probability?.type ?? "NONE",
      windKmh:      j.wind?.speed?.value ?? null,
      visibilityKm: j.visibility?.distance ?? null,
      cloudPct:     j.cloudCover ?? null,
      isDay:        j.isDaytime ?? null,
    };
  } catch { return null; }
}

// --- Основной прогон ----------------------------------------------------
console.log(`\nКалибровка: ${ordersFile}`);
console.log(`Дата: ${date ?? "?"} | День: ${day} | Calibration v${calibVer} | Заказов: ${ORDERS.length}\n`);

// --- Погода (Google Weather API, один раз на партию) ---
let weather = null;
if (GOOGLE_KEY) {
  const firstPickup = COORDS[ORDERS[0]?.from];
  if (firstPickup) {
    weather = await googleWeather(firstPickup[0], firstPickup[1]);
    if (weather) {
      const w = weather;
      const precipStr = w.precipMmH > 0 ? `${w.precipMmH.toFixed(2)}мм/ч ${w.precipType}` : "сухо";
      console.log(`Погода (центр партии): ${w.condition}, ${w.tempC?.toFixed(1)}°C, осадки: ${precipStr} (${w.precipProb}%), ветер ${w.windKmh}км/ч, видимость ${w.visibilityKm}км\n`);
    }
  }
}

console.log("ID  | km    | freeMin | TomTom mult [n/N] ratios          | min     | spdOSRM | spdTT  | spdYa  | spdG  | gMult | gMin | Δспд%  | factC | rawC   | sC    | factE | rawE  | sE    | hidden");
console.log("=".repeat(200));

process.on('unhandledRejection', (r) => { console.error(`[unhandledRejection] ${r?.message || r}`); });
process.on('uncaughtException', (e) => { console.error(`[uncaughtException] ${e?.message || e}`); });

const results = [];
for (const o of ORDERS) {
  const fromPt = COORDS[o.from], toPt = COORDS[o.to];
  if (!fromPt || !toPt) { console.log(`${o.id}: НЕТ КООРДИНАТ для "${!fromPt?o.from:o.to}"`); continue; }
  let route, tt, gr;
  try { route = await osrmFull(fromPt, toPt); }
  catch (e) { console.log(`${o.id}: OSRM ошибка: ${e.message}`); continue; }
  // TomTom + Google параллельно
  const [ttResult, grResult] = await Promise.all([
    trafficMultiplier(route.coords, 6).catch(e => { console.log(`${o.id}: TomTom ошибка: ${e.message} — fallback ×1.0`); return { mult: 1.0, n: 0, total: 6, ratios: [], meanRatio: 1 }; }),
    googleRoute(fromPt, toPt).catch(() => null),
  ]);
  tt = ttResult; gr = grResult;
  // Если в orders.json указано фактическое время поездки от диспетчера
  // (`userTripMin`, приходит из формы сайта) — оно ТОЧНЕЕ TomTom, потому что
  // это число которое реально показал Yandex с учётом локальных пробок.
  // Иначе берём свободный поток × TomTom-мультипликатор.
  const minOSRMTT = route.freeMin * tt.mult;
  const min = (typeof o.userTripMin === "number" && o.userTripMin > 0)
    ? o.userTripMin
    : minOSRMTT;
  const minSource = (typeof o.userTripMin === "number" && o.userTripMin > 0) ? "form" : "tomtom";
  const rC = rawCmf(route.km, min);
  const rE = rawEcon(route.km, min);
  const sC = o.factC ? o.factC/rC : null;
  const sE = o.factE ? o.factE/rE : null;
  const hb = (sC && sE) ? (sE/sC) : null; // hidden Эконом-boost = sE/sC

  // --- Сравнение скоростей: OSRM-free vs TomTom vs Yandex (если есть) ---
  const spdOSRM = (route.km / route.freeMin) * 60;          // км/ч свободный поток (OSRM)
  const spdTT   = (route.km / min) * 60;                    // км/ч с пробками (TomTom)
  // Yandex: если на скрине указано время поездки (yaMin) — берём, км — из скрина или нашего OSRM
  const yaKm  = (typeof o.yaKm  === "number") ? o.yaKm  : route.km;
  const yaMin = (typeof o.yaMin === "number") ? o.yaMin : null;
  const spdYa = yaMin ? (yaKm / yaMin) * 60 : null;
  const dSpdPct = spdYa ? ((spdYa - spdTT) / spdTT * 100) : null;  // насколько Yandex быстрее/медленнее TomTom

  // --- Обратное восстановление базы Yandex по открытому сёрджу ----------
  // Yandex показывает на превью видимый surge (⚡ + число типа 1.3 / 0.6).
  // Если он есть в orders.json как `yaSurgeC` — можно посчитать baza_Y = factC / yaSurgeC,
  // и сравнить с нашей rawC. Если baza_Y << rawC → у Yandex дешевле тариф, не сёрдж.
  const yaSurgeC = (typeof o.yaSurgeC === "number") ? o.yaSurgeC : null;
  const bazaYC   = (yaSurgeC && o.factC) ? o.factC / yaSurgeC : null;
  const bazaRatio = bazaYC ? (bazaYC / rC) : null;  // <1 значит Yandex baza дешевле нашей rawC

  // Google скорость и Δ vs Google
  const spdG    = gr ? (gr.km / gr.trafficMin) * 60 : null;
  const dSpdGPct = (spdYa && spdG) ? ((spdYa - spdG) / spdG * 100) : null;

  results.push({...o, fromPt, toPt, km: route.km, freeMin: route.freeMin, ttMult: tt.mult, ttN: tt.n, ttTotal: tt.total, ttRatios: tt.ratios, ttMeanRatio: tt.meanRatio, min, minSource, rC, rE, sC, sE, hb, spdOSRM, spdTT, spdYa, dSpdPct, spdG, dSpdGPct, yaSurgeC, bazaYC, bazaRatio,
    googleKm: gr?.km ?? null, googleFreeMin: gr?.freeMin ?? null, googleTrafficMin: gr?.trafficMin ?? null, gMult: gr?.gMult ?? null,
    weather: weather ?? null,
  });
  const ratiosStr = tt.ratios.join(",").padEnd(20);
  const yaCol = spdYa ? `${spdYa.toFixed(1).padStart(5)} | ${(dSpdPct>=0?'+':'')+dSpdPct.toFixed(1).padStart(5)}%` : `  —   |   —   `;
  const gCol  = gr ? `${spdG.toFixed(1).padStart(5)} | ×${gr.gMult.toFixed(2)} | ${gr.trafficMin.toFixed(1).padStart(4)}` : `  —   |   —   |   —  `;
  const dGCol = dSpdGPct != null ? `${(dSpdGPct>=0?'+':'')+dSpdGPct.toFixed(1).padStart(5)}%` : `  —    `;
  const minMark = minSource === "form" ? `${min.toFixed(1).padStart(5)}*` : ` ${min.toFixed(1).padStart(6)}`;
  const factCStr = (typeof o.factC === "number") ? o.factC.toFixed(1).padStart(5) : "  —  ";
  const factEStr = (typeof o.factE === "number") ? o.factE.toFixed(1).padStart(5) : "  —  ";
  console.log(`${o.id}| ${route.km.toFixed(2).padStart(5)} | ${route.freeMin.toFixed(1).padStart(7)} | ×${tt.mult.toFixed(2)} [${tt.n}/${tt.total}] r=${ratiosStr} | ${minMark} | ${spdOSRM.toFixed(1).padStart(6)} | ${spdTT.toFixed(1).padStart(5)} | ${yaCol} | ${gCol} | ${dGCol} | ${factCStr} | ${rC.toFixed(2).padStart(6)} | ${sC?sC.toFixed(3):"  —  "} | ${factEStr} | ${rE.toFixed(2).padStart(5)} | ${sE?sE.toFixed(3):"  —  "} | ${hb?'×'+hb.toFixed(3):'—'}`);
  await new Promise(r => setTimeout(r, 250));
}

const outFile = join(dirname(ordersFile), basename(ordersFile, ".json") + ".results.json");
writeFileSync(outFile, JSON.stringify({ date, day, calibrationVersion: calibVer, results }, null, 2));

// --- Сводка + методологические рекомендации ----------------------------
console.log("\n" + "=".repeat(80));
const okC = results.filter(r => r.sC != null);
const okE = results.filter(r => r.sE != null);
const okHb = results.filter(r => r.hb != null);
if (okC.length || okE.length) {
  const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
  const std  = (a,m=mean(a)) => Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length);
  const median = a => a.length%2 ? a[(a.length-1)/2] : (a[a.length/2-1]+a[a.length/2])/2;
  if (okC.length) {
    const sC = okC.map(r => r.sC).sort((a,b)=>a-b);
    console.log(`Surge_C: mean=${mean(sC).toFixed(3)} median=${median(sC).toFixed(3)} std=${std(sC).toFixed(3)} range ${sC[0].toFixed(2)}..${sC.at(-1).toFixed(2)}  (по ${okC.length}/${results.length})`);
  }
  if (okE.length) {
    const sE = okE.map(r => r.sE).sort((a,b)=>a-b);
    console.log(`Surge_E: mean=${mean(sE).toFixed(3)} median=${median(sE).toFixed(3)} std=${std(sE).toFixed(3)} range ${sE[0].toFixed(2)}..${sE.at(-1).toFixed(2)}  (по ${okE.length}/${results.length})`);
  }
  if (okHb.length) {
    const hb = okHb.map(r => r.hb);
    console.log(`Hidden Эконом-boost (sE/sC): mean=×${mean(hb).toFixed(3)} median=×${median(hb).toFixed(3)}  (по ${okHb.length}/${results.length})`);
  }
  // Подсчёт диспетчерских замеров (с manual minSource).
  const formCount = results.filter(r => r.minSource === "form").length;
  if (formCount > 0) {
    console.log(`Время поездки из формы (приоритет над TomTom): ${formCount}/${results.length} замеров`);
  }
  const tt = results.map(r => r.ttMult);
  console.log(`TomTom traffic mult: mean=×${mean(tt).toFixed(3)} median=×${median(tt).toFixed(3)} range ${Math.min(...tt).toFixed(2)}..${Math.max(...tt).toFixed(2)}`);

  // --- Google Routes traffic статистика ----------------------------------
  const withG = results.filter(r => r.gMult != null);
  if (withG.length) {
    const gMults = withG.map(r => r.gMult);
    const gTraffics = withG.map(r => r.googleTrafficMin);
    const gKms = withG.map(r => r.googleKm);
    const gFrees = withG.map(r => r.googleFreeMin);
    console.log(`Google traffic mult: mean=×${mean(gMults).toFixed(3)} median=×${median([...gMults].sort((a,b)=>a-b)).toFixed(3)} range ${Math.min(...gMults).toFixed(2)}..${Math.max(...gMults).toFixed(2)}  (по ${withG.length}/${results.length} маршрутам)`);
    console.log(`Google freeMin:      mean=${mean(gFrees).toFixed(1)} median=${median([...gFrees].sort((a,b)=>a-b)).toFixed(1)}  (vs OSRM/TomTom freeMin)`);
    console.log(`Google trafficMin:   mean=${mean(gTraffics).toFixed(1)} median=${median([...gTraffics].sort((a,b)=>a-b)).toFixed(1)}  (= реальное время с трафиком)`);
    console.log(`Google km:           mean=${mean(gKms).toFixed(2)} median=${median([...gKms].sort((a,b)=>a-b)).toFixed(2)}  (vs OSRM км — Google может выбирать другие маршруты)`);
  }

  // --- Сравнение средних скоростей: OSRM-free vs TomTom vs Google vs Yandex
  const spdOSRMs = results.map(r => r.spdOSRM);
  const spdTTs   = results.map(r => r.spdTT);
  const spdGs    = results.filter(r => r.spdG != null).map(r => r.spdG);
  const withYa   = results.filter(r => r.spdYa != null);
  console.log(`\nСредние скорости (км/ч):`);
  console.log(`  OSRM-free:  mean=${mean(spdOSRMs).toFixed(1)} median=${median([...spdOSRMs].sort((a,b)=>a-b)).toFixed(1)} range ${Math.min(...spdOSRMs).toFixed(0)}..${Math.max(...spdOSRMs).toFixed(0)}`);
  console.log(`  TomTom:     mean=${mean(spdTTs).toFixed(1)} median=${median([...spdTTs].sort((a,b)=>a-b)).toFixed(1)} range ${Math.min(...spdTTs).toFixed(0)}..${Math.max(...spdTTs).toFixed(0)}`);
  if (spdGs.length) {
    console.log(`  Google:     mean=${mean(spdGs).toFixed(1)} median=${median([...spdGs].sort((a,b)=>a-b)).toFixed(1)} range ${Math.min(...spdGs).toFixed(0)}..${Math.max(...spdGs).toFixed(0)}`);
  }
  if (withYa.length) {
    const ys = withYa.map(r => r.spdYa);
    const dTTPcts = withYa.map(r => r.dSpdPct);
    console.log(`  Yandex:     mean=${mean(ys).toFixed(1)} median=${median([...ys].sort((a,b)=>a-b)).toFixed(1)} range ${Math.min(...ys).toFixed(0)}..${Math.max(...ys).toFixed(0)}  (по ${withYa.length} заказам со скрина)`);
    console.log(`  Δ Yandex vs TomTom: mean ${mean(dTTPcts)>=0?'+':''}${mean(dTTPcts).toFixed(1)}%  (если −N% — TomTom переоценивает свободность дорог)`);
    const withYaG = withYa.filter(r => r.dSpdGPct != null);
    if (withYaG.length) {
      const dGPcts = withYaG.map(r => r.dSpdGPct);
      console.log(`  Δ Yandex vs Google: mean ${mean(dGPcts)>=0?'+':''}${mean(dGPcts).toFixed(1)}%  (по ${withYaG.length} зак.) — должно быть ближе к 0% чем TomTom`);
      const ttAbs = mean(dTTPcts.map(Math.abs));
      const gAbs  = mean(dGPcts.map(Math.abs));
      const winner = gAbs < ttAbs ? "✓ Google ТОЧНЕЕ" : "✗ TomTom оказался точнее";
      console.log(`  |Δ| TomTom=${ttAbs.toFixed(1)}%, Google=${gAbs.toFixed(1)}%  → ${winner} (улучшение ${Math.abs(ttAbs-gAbs).toFixed(1)}пп)`);
    }
  } else {
    console.log(`  Yandex:     —  (добавь поля yaMin (и yaKm) в orders.json — скрипт сравнит средние скорости).`);
  }

  // --- Восстановление базовой цены Yandex по открытому сёрджу -----------
  const withSurge = results.filter(r => r.bazaYC != null);
  if (withSurge.length) {
    const bs = withSurge.map(r => r.bazaYC);
    const ratios = withSurge.map(r => r.bazaRatio);
    console.log(`\nОбратное восстановление базы Yandex Cmf (по открытому ⚡N со скрина):`);
    console.log(`  baza_Y = factC / yaSurgeC: mean=${mean(bs).toFixed(2)}br median=${median([...bs].sort((a,b)=>a-b)).toFixed(2)}br range ${Math.min(...bs).toFixed(1)}..${Math.max(...bs).toFixed(1)}`);
    console.log(`  baza_Y / наш rawC: mean=${mean(ratios).toFixed(3)} (если ≈ 1 — тариф совпадает; если << 1 — наш тариф завышен)`);
    // Если baza_Y почти константа = вероятно minimum-цена Cmf
    const stdBaza = std(bs);
    if (stdBaza < 0.5) {
      console.log(`  ⚠ baza_Y почти константна (σ=${stdBaza.toFixed(2)}br). Это типично если все маршруты упёрлись в minimum_Cmf ≈ ${mean(bs).toFixed(0)}br у Yandex.`);
    }
    console.log(`\n  По заказам:`);
    for (const r of withSurge) {
      console.log(`    ${r.id} ⚡${r.yaSurgeC.toFixed(2)}: factC=${r.factC} → baza_Y=${r.bazaYC.toFixed(2)}br, наш rawC=${r.rC.toFixed(2)}br (ratio=${r.bazaRatio.toFixed(2)})`);
    }
  } else {
    console.log(`\n  Открытые сёрджи Yandex: —  (добавь yaSurgeC/yaSurgeE в orders.json — скрипт восстановит base price Yandex)`);
  }

  // Outlier-детекция: |z| > 2 (по sC; нужно ≥2 точки и σ>0)
  if (okC.length >= 2) {
    const sCvals = okC.map(r => r.sC);
    const m = mean(sCvals), s = std(sCvals, m);
    if (s > 0) {
      const outliers = okC.filter(r => Math.abs((r.sC - m)/s) > 2);
      if (outliers.length) {
        console.log("\n⚠ Outliers (|z|>2 по sC):");
        for (const r of outliers) console.log(`  ${r.id} ${r.from}→${r.to}: sC=${r.sC.toFixed(3)} (mean=${m.toFixed(2)}, σ=${s.toFixed(2)}). Проверь координаты или статус заказа.`);
      }
    }
  }

  // Рекомендации
  console.log("\n📋 Методологические рекомендации:");
  const meanTT = mean(tt);
  if (meanTT < 1.05) console.log(`  • Пробок практически нет (×${meanTT.toFixed(2)}) — расхождения с Yandex НЕ от трафика, ищи причину в зональном сёрдже / hidden discount.`);
  else if (meanTT > 1.3) console.log(`  • Сильный трафик (×${meanTT.toFixed(2)}) — проверь, видит ли наша модель его через TomTom (a не только эмпирик).`);
  if (okHb.length) {
    const hbVals = okHb.map(r => r.hb);
    const meanHB = mean(hbVals);
    if (Math.abs(meanHB - 1) > 0.05) {
      const pct = ((meanHB - 1)*100).toFixed(0);
      console.log(`  • Hidden Эконом-boost = ×${meanHB.toFixed(3)} (Эконом ${pct>0?'дороже':'дешевле'} Комфорта на ${Math.abs(pct)}% к нашей формуле). Если стабильно — встроить в BASE_TARIFF.econom как множитель.`);
    }
  }
  if (okC.length) {
    const sCv = okC.map(r => r.sC);
    const meanSC = mean(sCv);
    if (meanSC < 0.7) console.log(`  • Средний sC=${meanSC.toFixed(2)} << 1.0 — возможно: (а) выходной/утренний дисконт Yandex, (б) координаты А неточны (OSRM-км завышен), (в) тариф v2 завышен.`);
    if (std(sCv) > 0.3) console.log(`  • Высокий std сёрджа (${std(sCv).toFixed(2)}) — заказы из разных зон/часов смешаны, не агрегируй их в одну точку без weight<1.`);
  }
}
console.log(`\n✓ Результаты сохранены: ${outFile}`);
console.log(`  Чтобы добавить в observations.json как слабые точки: см. scripts/orders/README.md\n`);
