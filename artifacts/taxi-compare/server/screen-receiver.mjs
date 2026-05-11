#!/usr/bin/env node
// Приёмник скринов (Yandex Go и т.п.) от сотрудников и пользователей.
// Слушает 127.0.0.1:PORT (по умолчанию 3011), nginx проксирует /api/screens/ -> сюда.
//
// Endpoints:
//   GET  /health            — проверка живости.
//   GET  /stats             — статистика incoming/processed/failed.
//   POST /upload            — multipart/form-data, поле "files" (до 5 файлов),
//                             сохраняет в INCOMING. Раз в N минут cron запускает
//                             process-screens.mjs → Gemini Vision → calib-*.json.
//   GET  /recommended       — список адресов А→Б, СГЕНЕРИРОВАННЫЙ из якорей
//                             (anchors-minsk.json). Каждые 5 минут — новая выборка
//                             (детерминированный seed). Микс коротких/средних/длинных.
//                             Маршруты, отработанные за последние 24 ч, исключаются.
//   POST /reserve           — {routeId, clientId} → бронь адреса на 2 минуты
//                             (для других выглядит как "занято", потом исчезает).
//   POST /release           — {routeId, clientId} → отпустить досрочно (засчитывается
//                             как «сделано» — адрес выпадает из списка).
//
// Бронь хранится in-memory: Map<routeId, {clientId, until}>; expired переезжает
// в Map completed (адрес считается сделанным 24 часа), потом авто-очищается.

import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import {
  writeFile,
  readFile,
  mkdir,
  readdir,
  stat,
  rename,
  appendFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Busboy from "busboy";
import {
  handleScreensMap,
  handleScreensMapDetails,
} from "./screens-map-handler.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.SCREENS_PORT || 3011);
const HOST = process.env.SCREENS_HOST || "127.0.0.1";
const ROOT = process.env.SCREENS_DIR || "/var/www/rwbtaxi/data/screens";
const INCOMING = join(ROOT, "incoming");
const PROCESSED = join(ROOT, "processed");
const FAILED = join(ROOT, "failed");
const TOKEN = process.env.SCREENS_TOKEN || "";
const RATE_LIMIT_PER_MIN = Number(process.env.SCREENS_RATE_LIMIT || 10);
// Gemini API key для анализа графа связей (/wb/graph/analyze).
// Лежит в /etc/rwbtaxi-calib.env, systemd-юнит подхватывает через EnvironmentFile.
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
// Какие модели Gemini пробуем для анализа графа (по очереди при ошибке).
const GRAPH_ANALYZE_MODELS = (
  process.env.GRAPH_ANALYZE_MODELS ||
  "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// Кэш анализа графа: один и тот же payload → не дёргаем Gemini заново 30 минут.
const GRAPH_ANALYZE_CACHE_MS = Number(
  process.env.GRAPH_ANALYZE_CACHE_MS || 30 * 60 * 1000,
);
const MAX_FILE_BYTES = Number(process.env.SCREENS_MAX_FILE || 10 * 1024 * 1024);
const MAX_FILES_PER_REQUEST = Number(process.env.SCREENS_MAX_FILES || 5);
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

// Бронь маршрута за оператором. 20 минут — окно «оператор тапнул адрес,
// открыл Yandex Go, поехал/ждёт машину/делает скрин». В течение этих
// 20 минут адрес НЕ показывается другим — каждый работает по своему
// списку, никто не делает скрины по тому же маршруту параллельно.
// Если оператор передумал — адрес автоматически освободится через TTL
// и снова попадёт в общий пул. Если скрин пришёл раньше — бронь снимается
// markCompleted (через /upload).
const RESERVATION_TTL_MS = Number(
  process.env.RESERVATION_TTL_MS || 20 * 60 * 1000,
);
// «Адрес уже сделан недавно» — 24 часа. Дольше — снова появится в выдаче.
const COMPLETED_TTL_MS = Number(
  process.env.COMPLETED_TTL_MS || 24 * 60 * 60 * 1000,
);
// Сколько маршрутов держим в одной выдаче ВСЕГО (раньше было 4+4+4=12 жёстко;
// теперь общая квота, а распределение short/medium/long берётся из реальной
// статистики поездок /orders/distribution; жёсткие TARGET_SHORT/MEDIUM/LONG
// оставлены fallback-ом, если ML недоступен).
const TARGET_TOTAL = Number(process.env.TARGET_TOTAL || 12);
const TARGET_SHORT = Number(process.env.TARGET_SHORT || 4);
const TARGET_MEDIUM = Number(process.env.TARGET_MEDIUM || 4);
const TARGET_LONG = Number(process.env.TARGET_LONG || 4);
// Минск-2 (airport) и пригороды (suburb) — опциональные спец-бакеты.
// По умолчанию ВЫКЛЮЧЕНЫ (TARGET_AIRPORT=0, TARGET_SUBURB=0): пары аэропорта
// и пригородов попадают в обычные S/M/L бакеты, не загрязняя активное обучение.
// Включить: TARGET_AIRPORT=1 TARGET_SUBURB=1 в env.
// Значение > 0 → пара исключается из cityPairs и получает гарантированную квоту.
const TARGET_AIRPORT = Number(process.env.TARGET_AIRPORT || 0);
const TARGET_SUBURB  = Number(process.env.TARGET_SUBURB  || 0);
const USE_AIRPORT_BUCKET = TARGET_AIRPORT > 0;
const USE_SUBURB_BUCKET  = TARGET_SUBURB  > 0;
const CITY_LAT_MIN = Number(process.env.CITY_LAT_MIN || 53.83);
const CITY_LAT_MAX = Number(process.env.CITY_LAT_MAX || 53.98);
const CITY_LNG_MIN = Number(process.env.CITY_LNG_MIN || 27.40);
const CITY_LNG_MAX = Number(process.env.CITY_LNG_MAX || 27.78);
// Минимум на каждую корзину, чтобы при сильном перекосе распределения
// (например, 95% коротких) не получить 0 средних/длинных — нам тогда вообще
// нечем будет калибровать модель в этих сегментах.
const TARGET_MIN_PER_BUCKET = Number(process.env.TARGET_MIN_PER_BUCKET || 2);
// Окно стабильности выдачи (мс): в течение него один и тот же seed →
// один и тот же набор пар. По умолчанию 5 минут.
const SAMPLE_WINDOW_MS = Number(process.env.SAMPLE_WINDOW_MS || 5 * 60 * 1000);

// ───────────── ML stats для умной выдачи ─────────────
// FastAPI /opt/rwbtaxi-newstat-ml на 127.0.0.1:3013 отдаёт три файла:
//   /routes/errors        — per-pair MAPE (ключ "{anchorIdA}__{anchorIdB}")
//   /routes/coverage      — матрица 24×7 «сколько калибровок в этом слоте»
//   /orders/distribution  — реальное распределение поездок по km-bucket
// Используем для (а) приоритизации шумных пар, (б) добивания пустых слотов,
// (в) подгонки квот short/medium/long под реальный поток заказов.
const ML_BASE = process.env.SCREENS_ML_BASE || "http://127.0.0.1:3013";
const ML_SECRET = process.env.SCREENS_ML_SECRET || "";
const ML_FETCH_TTL_MS = Number(process.env.ML_FETCH_TTL_MS || 5 * 60 * 1000);
// Чем больше K — тем агрессивнее «шумные» пары вылезают наверх.
// weight = 1 + mape * RESIDUAL_WEIGHT_K  (mape в долях, не в процентах).
// При K=5: пара с MAPE 40% получает вес 1+5*0.4 = 3 (×3 чаще обычной).
const RESIDUAL_WEIGHT_K = Number(process.env.RESIDUAL_WEIGHT_K || 5);
// Бонус за «пустоту слота»: если в текущем (час × dow) меньше 3 калибровок —
// все пары в выдаче получают +COVERAGE_BOOST_K к весу. Это пушит сбор
// данных в «дырах» расписания (например, ночь субботы).
const COVERAGE_BOOST_K = Number(process.env.COVERAGE_BOOST_K || 2);
const COVERAGE_BOOST_THRESHOLD = Number(process.env.COVERAGE_BOOST_THRESHOLD || 3);
// Полностью отключить умную логику (откат к старому 4/4/4 рандому).
const DISABLE_SMART_GENERATOR =
  String(process.env.DISABLE_SMART_GENERATOR || "").toLowerCase() === "true";
// Гранулярные флаги отката (для A/B и диагностики):
//   DISABLE_RESIDUAL_WEIGHTING=true  → веса по MAPE отключены, все пары равновесные.
//   DISABLE_PROPORTIONAL_QUOTAS=true → квоты S/M/L фиксированы (TARGET_SHORT/MEDIUM/LONG),
//                                       ML-распределение игнорируется.
const DISABLE_RESIDUAL_WEIGHTING =
  String(process.env.DISABLE_RESIDUAL_WEIGHTING || "").toLowerCase() === "true";
const DISABLE_PROPORTIONAL_QUOTAS =
  String(process.env.DISABLE_PROPORTIONAL_QUOTAS || "").toLowerCase() === "true";
// Максимальный возраст ML-stats (route_errors/coverage/distribution) в мс.
// Если данные старше — честный откат к flat shuffle + равным квотам.
// Default: 48 часов.
const ML_STATS_MAX_AGE_MS = Number(process.env.ML_STATS_MAX_AGE_MS || 48 * 60 * 60 * 1000);

// ml-stats: TTL-кэш + graceful fallback. Если FastAPI недоступен / отдал
// 4xx-5xx / timeout 1.5с / available:false — отдаём `null`, и генератор
// откатывается к старому поведению (равные веса, фиксированные квоты).
const mlCache = new Map(); // path -> { at, value }
async function fetchMl(path) {
  const cached = mlCache.get(path);
  const now = Date.now();
  if (cached && now - cached.at < ML_FETCH_TTL_MS) return cached.value;
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 1500);
    const headers = { Accept: "application/json" };
    if (ML_SECRET) headers["X-Shared-Secret"] = ML_SECRET;
    const res = await fetch(`${ML_BASE}${path}`, {
      signal: ctl.signal,
      headers,
    });
    clearTimeout(tm);
    if (!res.ok) throw new Error(`http_${res.status}`);
    const json = await res.json();
    let value = json && json.available !== false ? json : null;
    // Staleness guard: если generatedAt старше ML_STATS_MAX_AGE_MS (48ч по умолчанию)
    // — честный откат к flat shuffle + равным квотам, как будто ML недоступен.
    if (value && value.generatedAt) {
      const ageMs = now - new Date(value.generatedAt).getTime();
      if (ageMs > ML_STATS_MAX_AGE_MS) {
        if (process.env.SCREENS_LOG_ML_ERRORS === "true") {
          console.warn(`[screens] ml stats ${path} stale (${(ageMs / 3_600_000).toFixed(1)}h), fallback to flat`);
        }
        value = null;
      }
    }
    mlCache.set(path, { at: now, value });
    return value;
  } catch (e) {
    // Кэшируем `null` тоже — чтобы не дрочить FastAPI при каждом запросе
    // /recommended если он лежит. Через 5 минут попробуем снова.
    mlCache.set(path, { at: now, value: null });
    if (process.env.SCREENS_LOG_ML_ERRORS === "true") {
      console.warn(`[screens] ml fetch ${path} failed: ${e.message}`);
    }
    return null;
  }
}

// Достаём целевые квоты short/medium/long. Если есть orders_distribution —
// берём byHour[hour] (если набралось ≥30 поездок в этот час) или overall.
// Иначе — статические TARGET_SHORT/MEDIUM/LONG.
// При DISABLE_PROPORTIONAL_QUOTAS=true всегда возвращает статические квоты.
function pickTargetQuotas(distribution, totalCount, hour) {
  if (DISABLE_PROPORTIONAL_QUOTAS) {
    return { short: TARGET_SHORT, medium: TARGET_MEDIUM, long: TARGET_LONG };
  }
  let frac = null;
  if (distribution) {
    const byHour = distribution.byHour?.[hour];
    if (byHour && byHour.n >= 30) {
      frac = { short: byHour.short / byHour.n, medium: byHour.medium / byHour.n, long: byHour.long / byHour.n };
    } else if (distribution.overall && distribution.overall.n >= 100) {
      frac = {
        short: distribution.overall.short,
        medium: distribution.overall.medium,
        long: distribution.overall.long,
      };
    }
  }
  if (!frac) {
    return { short: TARGET_SHORT, medium: TARGET_MEDIUM, long: TARGET_LONG };
  }
  // Применяем минимум на bucket, потом нормируем под totalCount.
  const min = TARGET_MIN_PER_BUCKET;
  let s = Math.max(min, Math.round(frac.short * totalCount));
  let m = Math.max(min, Math.round(frac.medium * totalCount));
  let l = Math.max(min, Math.round(frac.long * totalCount));
  // Если из-за минимумов сумма > totalCount — урезаем самую большую.
  while (s + m + l > totalCount) {
    if (s >= m && s >= l && s > min) s--;
    else if (m >= l && m > min) m--;
    else if (l > min) l--;
    else break;
  }
  return { short: s, medium: m, long: l };
}

// Coverage boost for (hour, demand_color): fires when the current
// (hour × demand) bucket is below the median of all non-empty cells.
// demand_color: "red" | "yellow" | "green" | null (defaults to "yellow").
function pickCoverageBoost(coverage, hour, demand_color) {
  if (!coverage || !Array.isArray(coverage.byHourDow)) return 0;
  // Map demand to column: nRed | nYellow | nGreen
  const col = demand_color === "red"   ? "nRed"
             : demand_color === "green" ? "nGreen"
             : "nYellow";
  // Count for this (hour, demand) across all days-of-week
  const demandCounts = coverage.byHourDow
    .filter((c) => c.hour === hour)
    .map((c) => c[col] ?? 0);
  const totalForSlot = demandCounts.reduce((a, b) => a + b, 0);
  // Compute median across all (hour × demand) totals for relative comparison
  const allTotals = [];
  for (let h = 0; h < 24; h++) {
    const cells = coverage.byHourDow.filter((c) => c.hour === h);
    const s = cells.reduce((a, c) => a + (c[col] ?? 0), 0);
    if (s > 0) allTotals.push(s);
  }
  if (!allTotals.length) return 0;
  allTotals.sort((a, b) => a - b);
  const median = allTotals[Math.floor(allTotals.length / 2)];
  // Boost if this slot has fewer than half the median or below absolute threshold
  if (totalForSlot < median / 2 || totalForSlot < COVERAGE_BOOST_THRESHOLD) {
    return COVERAGE_BOOST_K;
  }
  return 0;
}

// pairKey для матчинга с ML routes/errors. Ключ собран на стороне Python
// как "{anchor_a.id}__{anchor_b.id}", здесь повторяем.
function pairKey(a, b) {
  return `${a.id}__${b.id}`;
}

// Weighted shuffle: нестрогая Fisher-Yates выборка с вероятностью пропорц.
// весу. Детерминированный mulberry32 PRNG (тот же seed → тот же порядок).
function weightedShuffleSeeded(items, weights, seed) {
  const n = items.length;
  if (n === 0) return [];
  const ws = weights.slice();
  const idx = items.map((_, i) => i);
  let t = (seed >>> 0) || 1;
  function next() {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }
  const out = [];
  let totalW = 0;
  for (let i = 0; i < n; i++) totalW += Math.max(0, ws[i]);
  for (let pick = 0; pick < n; pick++) {
    if (totalW <= 0) {
      // все веса нулевые → деградируем в простой shuffle оставшихся
      const j = Math.floor(next() * idx.length);
      out.push(items[idx[j]]);
      idx.splice(j, 1);
      ws.splice(j, 1);
      continue;
    }
    const target = next() * totalW;
    let acc = 0;
    let chosen = idx.length - 1;
    for (let i = 0; i < idx.length; i++) {
      acc += Math.max(0, ws[i]);
      if (acc >= target) { chosen = i; break; }
    }
    out.push(items[idx[chosen]]);
    totalW -= Math.max(0, ws[chosen]);
    idx.splice(chosen, 1);
    ws.splice(chosen, 1);
  }
  return out;
}

// Файл с якорными точками — рядом с .mjs.
const ANCHORS_FILE =
  process.env.ANCHORS_FILE ||
  (existsSync(join(__dirname, "anchors-minsk.json"))
    ? join(__dirname, "anchors-minsk.json")
    : join(ROOT, "anchors-minsk.json"));

await mkdir(INCOMING, { recursive: true });
await mkdir(PROCESSED, { recursive: true });
await mkdir(FAILED, { recursive: true });

// ───────────── anchors (точки А и Б) ─────────────
let anchorsCache = null;
let anchorsCacheAt = 0;

async function loadAnchors() {
  const now = Date.now();
  // hot-reload файла раз в минуту
  if (anchorsCache && now - anchorsCacheAt < 60_000) return anchorsCache;
  try {
    const raw = await readFile(ANCHORS_FILE, "utf8");
    const json = JSON.parse(raw);
    const arr = Array.isArray(json?.anchors)
      ? json.anchors
      : Array.isArray(json)
        ? json
        : [];
    // Только валидные с координатами и именем.
    anchorsCache = arr
      .filter(
        (a) =>
          a &&
          typeof a.name === "string" &&
          typeof a.lat === "number" &&
          typeof a.lng === "number",
      )
      .map((a) => ({
        id: String(a.id || a.name),
        name: a.name,
        lat: a.lat,
        lng: a.lng,
        type: a.type || "any",
      }));
    anchorsCacheAt = now;
    console.log(
      `[screens] loaded ${anchorsCache.length} anchors from ${ANCHORS_FILE}`,
    );
  } catch (e) {
    console.warn(
      `[screens] cannot load ANCHORS_FILE=${ANCHORS_FILE}: ${e.message}`,
    );
    anchorsCache = [];
    anchorsCacheAt = now;
  }
  return anchorsCache;
}

// ───────────── reservations / completed ─────────────
const reservations = new Map(); // routeId -> {clientId, until}
const completed = new Map(); // routeId -> completedAt (Date.now())

function pruneExpired() {
  const now = Date.now();
  for (const [routeId, r] of reservations) {
    if (r.until <= now) {
      reservations.delete(routeId);
      completed.set(routeId, now);
    }
  }
}
function pruneCompleted() {
  const cutoff = Date.now() - COMPLETED_TTL_MS;
  for (const [routeId, t] of completed) {
    if (t < cutoff) completed.delete(routeId);
  }
}
setInterval(pruneExpired, 5_000).unref();
setInterval(pruneCompleted, 60_000).unref();

// ───────────── geo + RNG helpers ─────────────
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Детерминированный shuffle (mulberry32) — для одинакового seed одинаковая
// выборка маршрутов в течение SAMPLE_WINDOW_MS.
function shuffleSeeded(arr, seed) {
  const a = arr.slice();
  let t = (seed >>> 0) || 1;
  for (let i = a.length - 1; i > 0; i--) {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    const j = ((r ^ (r >>> 14)) >>> 0) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ───────────── routeId codec ─────────────
// routeId = "gen-<i>-<j>" — индексы в массиве anchors. Парсится при /reserve,
// поэтому держать кэш сгенерированной выдачи не нужно.
function makeRouteId(i, j) {
  return `gen-${i}-${j}`;
}
function parseRouteId(id) {
  const m = /^gen-(\d+)-(\d+)$/.exec(String(id || ""));
  if (!m) return null;
  const i = +m[1];
  const j = +m[2];
  if (!Number.isFinite(i) || !Number.isFinite(j)) return null;
  if (i === j || i < 0 || j < 0) return null;
  return { i, j };
}

// ───────────── generateRoutes ─────────────
// Smart generator: pairs weighted by MAPE (noisy pairs surface more often)
// and coverage (low-coverage demand×hour slots boosted). Quotas adapt to
// real ride distribution from orders_distribution.
// Falls back to flat shuffle + fixed quotas when routeErrors is unavailable/stale.
function hashStringU32(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

async function generateRoutes(clientId = "", demand_color = null) {
  const anchors = await loadAnchors();
  if (anchors.length < 4) return { anchors, routes: [] };

  // Все направленные пары + расстояние
  const pairs = [];
  for (let i = 0; i < anchors.length; i++) {
    for (let j = 0; j < anchors.length; j++) {
      if (i === j) continue;
      const km = haversineKm(anchors[i], anchors[j]);
      pairs.push({ i, j, km, key: pairKey(anchors[i], anchors[j]) });
    }
  }
  // Раскладываем пары по бакетам в строгом порядке приоритета:
  //   1. airport — любая пара где хоть один якорь имеет type=="airport"
  //   2. suburb  — любая пара где хоть один якорь вне city-box (и НЕ airport)
  //   3. short/medium/long — оставшиеся, разрезанные по distanceKm
  // Так длинные airport-маршруты (~40км) и пригородные (~10-25км с особой
  // тарификацией Yandex) не шумят медиану обычных long (там Минск 10-20км).
  const isInCity = (a) =>
    a &&
    typeof a.lat === "number" &&
    typeof a.lng === "number" &&
    a.lat >= CITY_LAT_MIN &&
    a.lat <= CITY_LAT_MAX &&
    a.lng >= CITY_LNG_MIN &&
    a.lng <= CITY_LNG_MAX;
  // Airport/suburb — опциональные спец-бакеты (по умолчанию выключены, TARGET=0).
  // Когда выключены — пары аэропорта/пригородов попадают в обычные S/M/L.
  const isAirportPair = (p) =>
    USE_AIRPORT_BUCKET &&
    (anchors[p.i]?.type === "airport" || anchors[p.j]?.type === "airport");
  const isSuburbPair = (p) =>
    USE_SUBURB_BUCKET &&
    !isAirportPair(p) &&
    (!isInCity(anchors[p.i]) || !isInCity(anchors[p.j]));
  const airportPairs = USE_AIRPORT_BUCKET ? pairs.filter(isAirportPair) : [];
  const suburbPairs  = USE_SUBURB_BUCKET  ? pairs.filter(isSuburbPair)  : [];
  const cityPairs = pairs.filter(
    (p) => !isAirportPair(p) && !isSuburbPair(p),
  );
  const buckets = {
    short: cityPairs.filter((p) => p.km <= 3),
    medium: cityPairs.filter((p) => p.km > 3 && p.km <= 10),
    long: cityPairs.filter((p) => p.km > 10),
    ...(USE_AIRPORT_BUCKET ? { airport: airportPairs } : {}),
    ...(USE_SUBURB_BUCKET  ? { suburb:  suburbPairs  } : {}),
  };

  // Fetch all three ML endpoints. routeErrors is the gate:
  // if it is unavailable or stale, all smart logic is forced off —
  // flat shuffle + fixed quotas, no MAPE weighting, no coverage boost.
  let routeErrors = null, coverage = null, distribution = null;
  if (!DISABLE_SMART_GENERATOR) {
    [routeErrors, coverage, distribution] = await Promise.all([
      fetchMl("/routes/errors"),
      fetchMl("/routes/coverage"),
      fetchMl("/orders/distribution"),
    ]);
    // Strict gate: routeErrors must be present and fresh; otherwise force flat.
    if (!routeErrors) {
      coverage = null;
      distribution = null;
    }
  }

  // Use Minsk local time (UTC+3) to match aggregation buckets in aggregate-route-stats.py.
  const now = new Date();
  const mskOffsetMs = 3 * 60 * 60 * 1000;
  const mskNow = new Date(now.getTime() + mskOffsetMs);
  const hour = mskNow.getUTCHours();
  const dow = (mskNow.getUTCDay() + 6) % 7;
  const coverageBoost = pickCoverageBoost(coverage, hour, demand_color);
  const quotas = pickTargetQuotas(distribution, TARGET_TOTAL, hour);

  // reason values: "hot" (mape ≥ 25%), "coldslot" (low-coverage boost), "new" (no data), null
  const pairsRE = routeErrors?.pairs || null;
  function weightFor(key) {
    let w = 1;
    let reason = null;
    let mapeE = null;
    let n = 0;
    const stat = pairsRE ? pairsRE[key] : null;
    if (!DISABLE_RESIDUAL_WEIGHTING && stat && typeof stat.mapeE === "number" && stat.n >= 5) {
      mapeE = stat.mapeE;
      n = stat.n;
      w += stat.mapeE * RESIDUAL_WEIGHT_K;
      if (stat.mapeE >= 0.25) reason = "hot";
    } else if (!stat) {
      reason = "new";
    }
    if (coverageBoost > 0) {
      w += coverageBoost;
      if (reason !== "hot") reason = "coldslot";
    }
    return { weight: w, mapeE, n, reason };
  }

  // Seed: 5-min window XOR clientId hash → stable per-user shuffle within window.
  const timeSeed = Math.floor(Date.now() / SAMPLE_WINDOW_MS);
  const userSeed = clientId ? hashStringU32(clientId) : 0;
  const baseSeed = (timeSeed ^ userSeed) >>> 0;

  function makeShuffled(bucket, seedShift) {
    const items = bucket;
    const meta = items.map((p) => weightFor(p.key));
    return weightedShuffleSeeded(
      items.map((p, i) => ({ ...p, _meta: meta[i] })),
      meta.map((m) => m.weight),
      baseSeed + seedShift,
    );
  }
  const shuffled = {
    short: makeShuffled(buckets.short, 0),
    medium: makeShuffled(buckets.medium, 1),
    long: makeShuffled(buckets.long, 2),
    ...(USE_AIRPORT_BUCKET ? { airport: makeShuffled(buckets.airport, 3) } : {}),
    ...(USE_SUBURB_BUCKET  ? { suburb:  makeShuffled(buckets.suburb,  4) } : {}),
  };

  pruneCompleted();

  // Гарантия «список не кончается». Раньше: если за 24ч оператор/команда
  // отработала всё что есть в пуле — generateRoutes возвращала пусто, и
  // оператор тыкал refresh впустую.
  //
  // Теперь — multi-pass с прогрессивно ослабляющимся «возрастом сделанного»:
  //   Pass 1 (strict): пара не должна быть сделана за последние 24ч.
  //   Pass 2 (soft):   разрешаем повторы которым >= 4 часа.
  //   Pass 3 (loose):  разрешаем повторы которым >= 1 час.
  //   Pass 4 (any):    вообще без фильтра — крайний случай.
  //
  // Также — асимметричный дедуп (раньше фильтровали и обратное направление):
  // если делали скрин по B→A, это НЕ блокирует A→B. Цена/время в Yandex Go
  // зависят от направления (одностороннее движение, развороты, заторы по
  // часам), нам нужен скрин по каждому направлению отдельно.
  //
  // anti-cluster (≤2 повторений якоря в выдаче) — общий счётчик used
  // на все проходы, чтобы один и тот же район не доминировал.
  const used = new Map();
  const taken = new Set();
  function pick(bucketName, count, minAgeMs) {
    const out = [];
    for (const p of shuffled[bucketName]) {
      if (out.length >= count) break;
      const id = makeRouteId(p.i, p.j);
      if (taken.has(id)) continue;
      const cAt = completed.get(id);
      if (cAt != null && Date.now() - cAt < minAgeMs) continue;
      const ci = used.get(p.i) || 0;
      const cj = used.get(p.j) || 0;
      if (ci >= 2 || cj >= 2) continue;
      used.set(p.i, ci + 1);
      used.set(p.j, cj + 1);
      taken.add(id);
      out.push({
        ...p,
        id,
        bucket: bucketName,
        recentlyDoneAt: cAt ?? null,
      });
    }
    return out;
  }

  const ageThresholds = [
    COMPLETED_TTL_MS, // strict — реально новые пары
    4 * 60 * 60 * 1000, // soft  — допускаем повторы старше 4ч
    60 * 60 * 1000, // loose — допускаем повторы старше 1ч
    0, // any   — что есть в пуле, то и берём
  ];

  const acc = {
    short: [], medium: [], long: [],
    ...(USE_AIRPORT_BUCKET ? { airport: [] } : {}),
    ...(USE_SUBURB_BUCKET  ? { suburb:  [] } : {}),
  };
  // Квоты: ML отдаёт пропорции для S/M/L (TARGET_TOTAL).
  // Airport/suburb — только когда явно включены через env TARGET_AIRPORT/TARGET_SUBURB > 0.
  const fullQuotas = {
    ...quotas,
    ...(USE_AIRPORT_BUCKET ? { airport: TARGET_AIRPORT } : {}),
    ...(USE_SUBURB_BUCKET  ? { suburb:  TARGET_SUBURB  } : {}),
  };
  const allBuckets = /** @type {const} */ (
    ["short", "medium", "long",
     ...(USE_AIRPORT_BUCKET ? ["airport"] : []),
     ...(USE_SUBURB_BUCKET  ? ["suburb"]  : []),
    ]
  );
  // Сначала по бакетам с заданными квотами на каждом проходе.
  for (const minAge of ageThresholds) {
    for (const b of allBuckets) {
      const need = fullQuotas[b] - acc[b].length;
      if (need <= 0) continue;
      acc[b].push(...pick(b, need, minAge));
    }
  }
  // Overflow: если какой-то бакет всё ещё неполон (например, в пригороде
  // мало long-пар), добираем общую массу из любого S/M/L бакета — лишь бы
  // у оператора был список нужного размера. airport НЕ участвует в
  // overflow: либо есть аэропортные пары и квота TARGET_AIRPORT набралась,
  // либо нет — заполнять S/M/L аэропортными парами не надо.
  const smlNeeded = quotas.short + quotas.medium + quotas.long;
  let smlGot = acc.short.length + acc.medium.length + acc.long.length;
  if (smlGot < smlNeeded) {
    for (const minAge of ageThresholds) {
      if (smlGot >= smlNeeded) break;
      for (const b of /** @type {const} */ (["short", "medium", "long"])) {
        if (smlGot >= smlNeeded) break;
        const need = smlNeeded - smlGot;
        const extras = pick(b, need, minAge);
        acc[b].push(...extras);
        smlGot += extras.length;
      }
    }
  }
  // Когда airport/suburb включены (TARGET > 0) — ставим их первыми.
  // По умолчанию (TARGET=0) — только S/M/L, airport/suburb попадают в S/M/L обычным путём.
  const out = [
    ...(USE_AIRPORT_BUCKET ? acc.airport : []),
    ...(USE_SUBURB_BUCKET  ? acc.suburb  : []),
    ...acc.short,
    ...acc.medium,
    ...acc.long,
  ];

  return {
    anchors,
    smartActive: !DISABLE_SMART_GENERATOR && (!!routeErrors || !!coverage || !!distribution),
    quotas,
    coverageBoost,
    routes: out.map((r) => ({
      id: r.id,
      from: anchors[r.i].name,
      to: anchors[r.j].name,
      fromLat: anchors[r.i].lat,
      fromLng: anchors[r.i].lng,
      toLat: anchors[r.j].lat,
      toLng: anchors[r.j].lng,
      bucket: r.bucket,
      distanceKm: Math.round(r.km * 10) / 10,
      mapeE: r._meta?.mapeE ?? null,
      routeMapePct: r._meta?.mapeE != null ? Math.round(r._meta.mapeE * 1000) / 10 : null,
      n: r._meta?.n ?? 0,
      weightReason: r._meta?.reason ?? null,
      boostReason: r._meta?.reason ?? null,
      recentlyDoneAt: r.recentlyDoneAt ?? null,
    })),
  };
}

// ───────────── rate limiter (in-memory, per-IP) ─────────────
const hits = new Map();
function tooManyRequests(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_LIMIT_PER_MIN;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) {
    const fresh = arr.filter((t) => now - t < 60_000);
    if (!fresh.length) hits.delete(ip);
    else if (fresh.length !== arr.length) hits.set(ip, fresh);
  }
}, 60_000).unref();

// ───────────── helpers ─────────────
// CORS: для /wb/* (PII) — строгий allowlist + credentials:true (cookie-сессия).
// Для публичных эндпоинтов (/upload, /reserve, /recommended, /health, /stats)
// — мягкий "*", чтобы не сломать клиентов.
const WB_ALLOWED_ORIGINS = new Set(
  String(process.env.WB_ALLOWED_ORIGIN || "https://rwbtaxi.by")
    .split(",").map((s) => s.trim()).filter(Boolean),
);

function applyWbCors(req, res) {
  const origin = req.headers.origin;
  if (origin && WB_ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    // Origin не в allowlist (или вовсе нет) — всё равно явно выставляем
    // первый разрешённый ориджин как ACAO, чтобы fallback в jsonResponse()
    // НЕ подставил мягкое "*". Браузер с реальным чужим origin сравнит
    // ACAO с document.origin и отвергнет ответ — это и есть нужная защита.
    const fallback = WB_ALLOWED_ORIGINS.values().next().value || "https://rwbtaxi.by";
    res.setHeader("Access-Control-Allow-Origin", fallback);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, GET, PATCH, DELETE, OPTIONS",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );
}

// CSRF: для не-GET /wb/* запросов проверяем Origin/Referer.
// Cookie-сессия (HttpOnly) сама по себе делает CSRF опасным, поэтому
// дополнительная проверка Origin закрывает класс CSRF полностью.
function checkCsrfOrigin(req) {
  const m = req.method;
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
  const origin = req.headers.origin;
  if (origin) return WB_ALLOWED_ORIGINS.has(origin);
  const referer = req.headers.referer;
  if (referer) {
    for (const o of WB_ALLOWED_ORIGINS) {
      if (referer === o || referer.startsWith(o + "/")) return true;
    }
    return false;
  }
  // Запрет не-GET без Origin/Referer (защита от CSRF от не-браузерных
  // клиентов, которые при этом таскают cookie). Запрос можно повторить
  // через Bearer — для этого Origin/Referer не требуются.
  return false;
}

function jsonResponse(res, status, body) {
  // Если CORS уже выставлен (например, через applyWbCors) — не перезаписываем.
  // Иначе — мягкое "*" для обратной совместимости публичных эндпоинтов.
  if (!res.hasHeader("Access-Control-Allow-Origin")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "POST, GET, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-Screens-Token, Authorization",
    );
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

function clientIp(req) {
  // Приоритет: X-Real-IP (если nginx настроен с real_ip_header), иначе —
  // ПЕРВЫЙ элемент X-Forwarded-For (он же оригинальный клиент по RFC 7239).
  // Старая реализация брала ПОСЛЕДНИЙ → за nginx это всегда 127.0.0.1,
  // и rate-limit де-факто не работал.
  const xri = req.headers["x-real-ip"];
  if (typeof xri === "string" && xri.trim()) return xri.trim();
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || "unknown";
}

// Псевдо-анонимизация IP для логов: sha256(ip + случайная_соль).
// Соль генерится при старте процесса и НЕ сохраняется → после рестарта
// корреляция теряется, что соответствует «хранение IP не дольше суток».
const _IP_LOG_SALT = randomBytes(16).toString("hex");
function ipForLog(ip) {
  if (!ip) return "?";
  const h = createHash("sha256");
  h.update(ip);
  h.update(_IP_LOG_SALT);
  return "ip:" + h.digest("hex").slice(0, 12);
}

// ───────────── cookie + WB-сессия ─────────────
const WB_SID_COOKIE = "rwb_sid";

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out)) out[k] = v;
  }
  return out;
}

function setSessionCookie(res, token, expiresAt) {
  const maxAgeSec = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
  const expires = new Date(expiresAt).toUTCString();
  res.setHeader("Set-Cookie", [
    `${WB_SID_COOKIE}=${token}`,
    "Path=/",
    `Expires=${expires}`,
    `Max-Age=${maxAgeSec}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; "));
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${WB_SID_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  );
}

// ───────────── rate-limit для /wb/login ─────────────
// Двухконтурная защита: 5 попыток / 5 мин / IP + 10 / час / login.
// После 3-й неудачи с одного IP — задержка ответа 1.5 с (отбивает
// off-line брутфорс на словаре).
const _WB_LOGIN_IP_WINDOW = 5 * 60_000;
const _WB_LOGIN_IP_MAX = 5;
const _WB_LOGIN_LOGIN_WINDOW = 60 * 60_000;
const _WB_LOGIN_LOGIN_MAX = 10;
const _wbLoginByIp = new Map();
const _wbLoginByLogin = new Map();

function _checkWbLoginRate(ip, login) {
  const now = Date.now();
  const ipArr = (_wbLoginByIp.get(ip) || []).filter(
    (t) => now - t < _WB_LOGIN_IP_WINDOW,
  );
  const lk = (login || "").toLowerCase();
  const loginArr = (_wbLoginByLogin.get(lk) || []).filter(
    (t) => now - t < _WB_LOGIN_LOGIN_WINDOW,
  );
  if (ipArr.length >= _WB_LOGIN_IP_MAX) return { ok: false, reason: "ip" };
  if (loginArr.length >= _WB_LOGIN_LOGIN_MAX) return { ok: false, reason: "login" };
  return { ok: true, ipAttempts: ipArr.length };
}

function _recordWbLoginAttempt(ip, login) {
  const now = Date.now();
  const ipArr = (_wbLoginByIp.get(ip) || []).filter(
    (t) => now - t < _WB_LOGIN_IP_WINDOW,
  );
  ipArr.push(now);
  _wbLoginByIp.set(ip, ipArr);
  const lk = (login || "").toLowerCase();
  const loginArr = (_wbLoginByLogin.get(lk) || []).filter(
    (t) => now - t < _WB_LOGIN_LOGIN_WINDOW,
  );
  loginArr.push(now);
  _wbLoginByLogin.set(lk, loginArr);
}

function _clearWbLoginAttempts(ip, login) {
  _wbLoginByIp.delete(ip);
  _wbLoginByLogin.delete((login || "").toLowerCase());
}

setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of _wbLoginByIp) {
    const fresh = arr.filter((t) => now - t < _WB_LOGIN_IP_WINDOW);
    if (!fresh.length) _wbLoginByIp.delete(k);
    else if (fresh.length !== arr.length) _wbLoginByIp.set(k, fresh);
  }
  for (const [k, arr] of _wbLoginByLogin) {
    const fresh = arr.filter((t) => now - t < _WB_LOGIN_LOGIN_WINDOW);
    if (!fresh.length) _wbLoginByLogin.delete(k);
    else if (fresh.length !== arr.length) _wbLoginByLogin.set(k, fresh);
  }
}, 60_000).unref();

// Cleanup старых .bak-* файлов (PII-retention).
// Оставляем `keep` свежайших, остальные удаляем.
async function cleanupOldBackups(dir, basenamePrefix, keep) {
  try {
    const { readdir, stat, unlink } = await import("node:fs/promises");
    const entries = await readdir(dir);
    const matched = [];
    for (const name of entries) {
      if (!name.startsWith(basenamePrefix)) continue;
      try {
        const st = await stat(join(dir, name));
        if (st.isFile()) matched.push({ name, mtime: st.mtimeMs });
      } catch {
        /* race с другим cleanup — пропускаем */
      }
    }
    matched.sort((a, b) => b.mtime - a.mtime);
    const toDelete = matched.slice(keep);
    for (const f of toDelete) {
      try {
        await unlink(join(dir, f.name));
      } catch {
        /* ignore */
      }
    }
    return { kept: Math.min(keep, matched.length), deleted: toDelete.length };
  } catch {
    return { kept: 0, deleted: 0 };
  }
}

function makeUploadId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hour = pad(d.getHours());
  const rand = randomBytes(3).toString("hex");
  return `screen-${date}-h${hour}-${rand}`;
}

function extFromMime(mime) {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return ".bin";
}

function readJsonBody(req, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.destroy();
        reject(new Error("body_too_large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const txt = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(txt));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// ───────────── Gemini helper для анализа графа ─────────────
// Точно такой же стиль, как в process-screens.mjs (postJson через node:https):
// без зависимостей, низкоуровневый POST. Один проход по списку моделей —
// первая успешная возвращает результат, остальные пробуем при 429/5xx/невалидном
// JSON. Тайм-аут 30s. Для графа payload ≤ 5 KB и ответ ≤ 4 KB.
function _postGeminiJson(host, path, body, timeoutMs) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body));
    const opts = {
      method: "POST",
      host,
      path,
      headers: {
        "content-type": "application/json",
        "content-length": data.length,
      },
      timeout: timeoutMs,
    };
    const r = httpsRequest(opts, (resp) => {
      const chunks = [];
      resp.on("data", (c) => chunks.push(c));
      resp.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = { _rawText: raw.slice(0, 500) };
        }
        resolve({ status: resp.statusCode || 0, body: parsed });
      });
    });
    r.on("timeout", () => {
      r.destroy(new Error("timeout"));
    });
    r.on("error", (e) => resolve({ status: 0, body: { error: { message: String(e?.message || e) } } }));
    r.write(data);
    r.end();
  });
}

// Дёргаем Gemini с system+user промптом, ожидаем JSON-ответ.
// schema — опциональный JSON Schema для structured output (ускоряет/стабилизирует).
// Возвращает: {ok, model, parsed, error?, tokens?}
async function geminiAnalyzeJson({ system, user, schema = null, timeoutMs = 30_000 }) {
  if (!GOOGLE_API_KEY) {
    return { ok: false, error: "no_api_key" };
  }
  const generationConfig = { temperature: 0.2, responseMimeType: "application/json" };
  if (schema) generationConfig.responseSchema = schema;
  const body = {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig,
  };
  let lastErr = "all_failed";
  for (const model of GRAPH_ANALYZE_MODELS) {
    const r = await _postGeminiJson(
      "generativelanguage.googleapis.com",
      `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GOOGLE_API_KEY)}`,
      body,
      timeoutMs,
    );
    if (r.status === 200) {
      const txt = r.body?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof txt === "string" && txt.trim()) {
        try {
          const parsed = JSON.parse(txt);
          const u = r.body?.usageMetadata || {};
          return {
            ok: true,
            model,
            parsed,
            tokens: { in: u.promptTokenCount, out: u.candidatesTokenCount },
          };
        } catch {
          lastErr = `bad_json_from_${model}`;
          continue;
        }
      }
      lastErr = `empty_response_from_${model}`;
      continue;
    }
    lastErr =
      r.body?.error?.message ||
      r.body?.error?.status ||
      `http_${r.status}_from_${model}`;
    // 4xx (кроме 429) — нет смысла пробовать другие модели, ключ/payload плох.
    if (r.status >= 400 && r.status < 500 && r.status !== 429) {
      break;
    }
  }
  return { ok: false, error: String(lastErr).slice(0, 240) };
}

// In-memory кэш анализа графа (ключ = хэш payload).
const _graphAnalyzeCache = new Map();

function _cheapHash(s) {
  // FNV-1a 32-bit — достаточно для кэш-ключа (нет коллизий на 100+ записях).
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

// ───── Rate limiter для дорогих ручек (LLM): минута + сутки, на ключ ─────
// Защищает /wb/graph/analyze от того, что один токен или утёкший токен
// раскрутит счётчик Gemini в неконтролируемые €€. Минимально-достаточный,
// процессо-локальный — нам сейчас 1 экземпляр сервера.
const _rateBuckets = new Map(); // key -> { minStart, minCount, dayStart, dayCount }

function _rateConsume(key, perMinLimit, perDayLimit) {
  const now = Date.now();
  let b = _rateBuckets.get(key);
  if (!b) {
    b = { minStart: now, minCount: 0, dayStart: now, dayCount: 0 };
    _rateBuckets.set(key, b);
  }
  // Сброс окон.
  if (now - b.minStart >= 60_000) {
    b.minStart = now;
    b.minCount = 0;
  }
  if (now - b.dayStart >= 24 * 60 * 60_000) {
    b.dayStart = now;
    b.dayCount = 0;
  }
  if (b.minCount >= perMinLimit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((60_000 - (now - b.minStart)) / 1000)),
      scope: "minute",
    };
  }
  if (b.dayCount >= perDayLimit) {
    return {
      ok: false,
      retryAfterSec: Math.max(
        60,
        Math.ceil((24 * 60 * 60_000 - (now - b.dayStart)) / 1000),
      ),
      scope: "day",
    };
  }
  b.minCount += 1;
  b.dayCount += 1;
  return { ok: true };
}

// Простая периодическая чистка корзин, чтобы Map не росла бесконечно.
setInterval(
  () => {
    const now = Date.now();
    for (const [k, b] of _rateBuckets) {
      // Если давно не было активности — забыть.
      if (now - b.dayStart > 26 * 60 * 60_000) _rateBuckets.delete(k);
    }
  },
  60 * 60_000,
).unref();

// ───────────── /upload ─────────────
async function handleUpload(req, res, ip) {
  if (TOKEN && req.headers["x-screens-token"] !== TOKEN) {
    return jsonResponse(res, 401, { ok: false, error: "bad_token" });
  }

  const ctype = req.headers["content-type"] || "";
  if (!ctype.startsWith("multipart/form-data")) {
    return jsonResponse(res, 400, { ok: false, error: "bad_content_type" });
  }

  let bb;
  try {
    bb = Busboy({
      headers: req.headers,
      limits: {
        fileSize: MAX_FILE_BYTES,
        files: MAX_FILES_PER_REQUEST,
        fields: 10,
        fieldSize: 4096,
      },
    });
  } catch {
    return jsonResponse(res, 400, { ok: false, error: "busboy_init_failed" });
  }

  const accepted = [];
  const rejected = [];
  let filesSeen = 0;
  let aborted = false;
  const fileWrites = [];
  // Поля multipart которые клиент шлёт ДО файлов (operator + weather).
  // Складываем в общий объект, потом подмешиваем к каждому скрин-meta.
  // Поле weather — это JSON-строка `{isRain:0|1, isSnow:0|1, tempC:N, key:"YYYY-MM-DDTHH"}`,
  // снятая фронтом из open-meteo на момент upload (см. lib/weather.ts).
  // Используется ML-пайплайном как фича для модели цены — в дождь/снег
  // Yandex Go поднимает цены на 10-30%, без этой фичи модель промахивается.
  const fields = {};
  bb.on("field", (name, val) => {
    if (typeof name !== "string" || name.length > 32) return;
    if (typeof val !== "string") return;
    // ограничиваем 4KB чтобы не съесть память (limits.fieldSize=4096 уже даёт страховку)
    fields[name] = val.slice(0, 1024);
  });

  bb.on("file", (_field, stream, info) => {
    filesSeen += 1;
    const mime = info.mimeType || "";
    if (!ALLOWED_MIME.has(mime)) {
      rejected.push({ originalName: info.filename, reason: `bad_mime:${mime}` });
      stream.resume();
      return;
    }
    const id = makeUploadId();
    const filename = id + extFromMime(mime);
    const target = join(INCOMING, filename);
    const chunks = [];
    let bytes = 0;
    let truncated = false;
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      chunks.push(chunk);
    });
    stream.on("limit", () => {
      truncated = true;
    });
    stream.on("end", () => {
      if (truncated) {
        rejected.push({ originalName: info.filename, reason: "too_large" });
        return;
      }
      const buf = Buffer.concat(chunks, bytes);
      // Парсим weather (если фронт прислал) — ровно ОДИН раз на скрин,
      // не на batch: формат тот же что в lib/weather.ts → WeatherHour.
      // Всё опционально — старый клиент без weather просто положит null.
      let weather = null;
      if (typeof fields.weather === "string" && fields.weather.length > 0) {
        try {
          const w = JSON.parse(fields.weather);
          if (w && typeof w === "object") {
            weather = {
              isRain: w.isRain === 1 ? 1 : 0,
              isSnow: w.isSnow === 1 ? 1 : 0,
              tempC: typeof w.tempC === "number" && Number.isFinite(w.tempC) ? w.tempC : null,
              key: typeof w.key === "string" && w.key.length <= 16 ? w.key : null,
            };
          }
        } catch {
          /* битый JSON — оставляем null */
        }
      }
      const meta = {
        id,
        uploadedAt: new Date().toISOString(),
        uploaderIp: ip,
        originalName: info.filename,
        mime,
        sizeBytes: bytes,
        operator: typeof fields.operator === "string" ? fields.operator.slice(0, 60) : null,
        weather,
      };
      const w = (async () => {
        try {
          await writeFile(target, buf);
          await writeFile(
            target + ".meta.json",
            JSON.stringify(meta, null, 2),
          );
          accepted.push({ id, originalName: info.filename, sizeBytes: bytes });
          console.log(
            `[screens] saved ${id} (${info.filename}, ${bytes}b, ip=${ip})`,
          );
        } catch (e) {
          console.error(`[screens] write failed for ${id}:`, e);
          rejected.push({ originalName: info.filename, reason: "write_failed" });
        }
      })();
      fileWrites.push(w);
    });
  });

  bb.on("filesLimit", () => {
    aborted = true;
  });

  bb.on("error", (e) => {
    console.error("[screens] busboy error:", e);
  });

  await new Promise((resolve) => {
    bb.on("close", resolve);
    bb.on("finish", resolve);
    req.pipe(bb);
  });

  await Promise.allSettled(fileWrites);

  if (filesSeen === 0) {
    return jsonResponse(res, 400, { ok: false, error: "no_files" });
  }
  return jsonResponse(res, 200, {
    ok: true,
    accepted,
    rejected,
    aborted,
  });
}

// ───────────── /stats ─────────────
async function handleStats(_req, res) {
  async function dirStats(dir) {
    try {
      const files = (await readdir(dir)).filter((f) =>
        /\.(jpe?g|png|webp)$/i.test(f),
      );
      const today = new Date().toISOString().slice(0, 10);
      let todayCount = 0;
      let lastMtime = 0;
      for (const f of files) {
        try {
          const s = await stat(join(dir, f));
          if (s.mtime.toISOString().slice(0, 10) === today) todayCount += 1;
          if (s.mtimeMs > lastMtime) lastMtime = s.mtimeMs;
        } catch {
          /* skip */
        }
      }
      return {
        total: files.length,
        today: todayCount,
        lastAt: lastMtime ? new Date(lastMtime).toISOString() : null,
      };
    } catch {
      return { total: 0, today: 0, lastAt: null };
    }
  }
  return jsonResponse(res, 200, {
    ok: true,
    incoming: await dirStats(INCOMING),
    processed: await dirStats(PROCESSED),
    failed: await dirStats(FAILED),
    reservations: {
      active: reservations.size,
      completed: completed.size,
    },
  });
}

// ───────────── /recommended ─────────────
async function handleRecommended(req, res) {
  pruneExpired();
  let clientId = "";
  let demand_color = null;
  try {
    const u = new URL(req.url, "http://x");
    const cid = u.searchParams.get("clientId") || "";
    if (cid && cid.length <= 80) clientId = cid;
    const dem = u.searchParams.get("demand") || "";
    if (dem === "red" || dem === "yellow" || dem === "green") demand_color = dem;
  } catch {
    /* malformed URL — use defaults */
  }
  const gen = await generateRoutes(clientId, demand_color);
  const list = gen.routes.map((r) => {
    const reservation = reservations.get(r.id);
    return {
      id: r.id,
      from: r.from,
      to: r.to,
      bucket: r.bucket,
      distanceKm: r.distanceKm,
      fromLat: r.fromLat ?? null,
      fromLng: r.fromLng ?? null,
      toLat: r.toLat ?? null,
      toLng: r.toLng ?? null,
      mapeE: r.mapeE ?? null,
      routeMapePct: r.routeMapePct ?? null,
      n: r.n ?? 0,
      weightReason: r.weightReason ?? null,
      boostReason: r.boostReason ?? null,
      recentlyDoneAt: r.recentlyDoneAt ?? null,
      reservedUntil: reservation ? reservation.until : null,
      reservedBy: reservation ? reservation.clientId : null,
    };
  });
  return jsonResponse(res, 200, {
    ok: true,
    now: Date.now(),
    ttlMs: RESERVATION_TTL_MS,
    smartActive: gen.smartActive ?? false,
    quotas: gen.quotas ?? null,
    coverageBoost: gen.coverageBoost ?? 0,
    routes: list,
  });
}

// ───────────── /reserve ─────────────
async function handleReserve(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonResponse(res, 400, { ok: false, error: "bad_json" });
  }
  const routeId = String(body?.routeId || "").trim();
  const clientId = String(body?.clientId || "").trim();
  if (!routeId || !clientId) {
    return jsonResponse(res, 400, { ok: false, error: "missing_fields" });
  }
  // Защита от DoS: routeId должен быть валидной парой индексов anchors.
  const parsed = parseRouteId(routeId);
  if (!parsed) {
    return jsonResponse(res, 400, { ok: false, error: "bad_route_id" });
  }
  const anchors = await loadAnchors();
  if (parsed.i >= anchors.length || parsed.j >= anchors.length) {
    return jsonResponse(res, 404, { ok: false, error: "unknown_route" });
  }
  if (clientId.length > 80) {
    return jsonResponse(res, 400, { ok: false, error: "bad_client_id" });
  }
  pruneExpired();

  if (completed.has(routeId)) {
    return jsonResponse(res, 410, { ok: false, error: "already_done" });
  }

  const existing = reservations.get(routeId);
  const now = Date.now();
  if (existing && existing.clientId !== clientId && existing.until > now) {
    return jsonResponse(res, 409, {
      ok: false,
      error: "taken",
      reservedUntil: existing.until,
    });
  }

  const until = now + RESERVATION_TTL_MS;
  reservations.set(routeId, { clientId, until });
  return jsonResponse(res, 200, {
    ok: true,
    routeId,
    until,
    ttlMs: RESERVATION_TTL_MS,
  });
}

// ───────────── /release ─────────────
async function handleRelease(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonResponse(res, 400, { ok: false, error: "bad_json" });
  }
  const routeId = String(body?.routeId || "").trim();
  const clientId = String(body?.clientId || "").trim();
  if (!routeId || !clientId) {
    return jsonResponse(res, 400, { ok: false, error: "missing_fields" });
  }
  const existing = reservations.get(routeId);
  if (existing && existing.clientId === clientId) {
    reservations.delete(routeId);
    completed.set(routeId, Date.now()); // считаем сделанным даже при отмене
    return jsonResponse(res, 200, { ok: true });
  }
  return jsonResponse(res, 404, { ok: false, error: "not_yours" });
}

// ───────────── /recent-calibs (для админ-таблицы план/факт) ─────────────
const CALIB_DIR    = process.env.CALIB_DIR    || "/var/www/rwbtaxi/data/calib";
const PROBES_FILE  = process.env.PROBES_FILE  || "/var/www/rwbtaxi/data/yandex-probes.jsonl";
const BOT_TOKEN    = process.env.BOT_TOKEN    || "";
const CHAT_ID      = process.env.CHAT_ID      || "";
const PROBE_SECRET = process.env.PROBE_SECRET || "";
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

// ───────────── /yandex-probe + /yandex-probe-redirect ─────────────
const DAYS_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

// Strict schema validation for probe payload — prevents poisoning of ML pipeline.
function _validateProbePayload(body) {
  if (!body || typeof body !== "object") return "payload_not_object";
  const routes = body.routes;
  if (!Array.isArray(routes)) return "routes_not_array";
  if (routes.length === 0) return "routes_empty";
  if (routes.length > 20) return "routes_too_many";
  for (const r of routes) {
    if (!r || typeof r !== "object") return "route_not_object";
    if (typeof r.id !== "string" || r.id.length === 0 || r.id.length > 100) return "route_bad_id";
    const hasEconom  = r.econom  != null;
    const hasComfort = r.comfort != null;
    if (!hasEconom && !hasComfort) continue; // allowed — skipped in _saveProbePayload
    const numFields = ["econom", "comfort", "surge_econom", "surge_comfort", "km", "min", "eta_min", "speed_kmh"];
    for (const f of numFields) {
      const v = r[f];
      if (v == null) continue;
      if (typeof v !== "number" || !Number.isFinite(v)) return `route_bad_num:${f}`;
      if (f === "econom"  || f === "comfort")       { if (v < 0 || v > 50000) return `route_price_range:${f}`; }
      if (f === "surge_econom" || f === "surge_comfort") { if (v < 0 || v > 20) return `route_surge_range:${f}`; }
      if (f === "km")     { if (v < 0 || v > 5000)  return "route_km_range"; }
    }
    const strFields = ["label", "from_addr", "to_addr"];
    for (const f of strFields) {
      if (r[f] != null && (typeof r[f] !== "string" || r[f].length > 300)) return `route_bad_str:${f}`;
    }
    if (r.from_coord != null) {
      if (!Array.isArray(r.from_coord) || r.from_coord.length !== 2 ||
          !Number.isFinite(r.from_coord[0]) || !Number.isFinite(r.from_coord[1]))
        return "route_bad_from_coord";
    }
    if (r.to_coord != null) {
      if (!Array.isArray(r.to_coord) || r.to_coord.length !== 2 ||
          !Number.isFinite(r.to_coord[0]) || !Number.isFinite(r.to_coord[1]))
        return "route_bad_to_coord";
    }
  }
  return null; // ok
}

function _surgeIcon(se) {
  if (se == null) return "";
  if (se < 1.0) return "🔵";
  if (se < 1.2) return "🟢";
  if (se < 1.4) return "🟡";
  if (se < 1.6) return "🟠";
  return "🔴";
}

async function _saveProbePayload(payload, ip) {
  const ts = new Date().toISOString();
  const mskNow = new Date(Date.now() + MSK_OFFSET_MS);
  const date = mskNow.toISOString().slice(0, 10);
  const hour = mskNow.getUTCHours();

  // Read previous entry BEFORE appending (for замер# and delta comparison)
  let probeNum = 1;
  let prevEconomTotal = null;
  let prevProbeNum = 0;
  try {
    const existing = await readFile(PROBES_FILE, "utf8").catch(() => "");
    const lines = existing.split("\n").filter((l) => l.trim());
    probeNum = lines.length + 1;
    if (lines.length > 0) {
      try {
        const prev = JSON.parse(lines[lines.length - 1]);
        prevProbeNum = lines.length;
        const prevEcon = (prev.routes || []).filter((r) => r.econom != null);
        if (prevEcon.length > 0) prevEconomTotal = prevEcon.reduce((s, r) => s + r.econom, 0);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  // Build log entry with full route data (preserving all bookmarklet fields)
  const logEntry = { ts, origin: payload.origin || "bookmarklet", ip, routes: [] };
  const saved = [];

  for (const r of (payload.routes || [])) {
    if (!r.id || (r.econom == null && r.comfort == null)) continue;
    const tripMin = r.eta_min || r.min || null;
    const speedKmh = r.speed_kmh || ((tripMin && r.km) ? Math.round(r.km / tripMin * 60) : null);
    logEntry.routes.push({
      id: r.id, label: r.label || r.id,
      km: r.km || null,
      min: tripMin,
      speed_kmh: speedKmh,
      from_addr: r.from_addr || null,
      to_addr: r.to_addr || null,
      econom: r.econom ?? null,
      comfort: r.comfort ?? null,
      surge_econom: r.surge_econom ?? null,
      surge_comfort: r.surge_comfort ?? null,
      has_route_price: r.has_route_price ?? false,
    });

    // Write individual calib file
    const calibId = `calib-${date}-h${String(hour).padStart(2, "0")}-${randomBytes(3).toString("hex")}`;
    const fromCoord = Array.isArray(r.from_coord) ? r.from_coord : null;
    const toCoord   = Array.isArray(r.to_coord)   ? r.to_coord   : null;
    const calib = {
      id: calibId,
      receivedAt: ts,
      receivedFromIp: ip,
      fromAddress: r.from_addr || null,
      toAddress:   r.to_addr   || null,
      fromLat: fromCoord ? fromCoord[1] : null,
      fromLng: fromCoord ? fromCoord[0] : null,
      toLat:   toCoord   ? toCoord[1]   : null,
      toLng:   toCoord   ? toCoord[0]   : null,
      minFallback: r.min || null,
      factE: r.econom  ?? null,
      factC: r.comfort ?? null,
      km: r.km || null,
      tripMin,
      speedKmh,
      demand: "yellow",
      date,
      hour,
      orderAt: ts,
      orderAtSource: "bookmarklet",
      source: "bookmarklet-probe",
      surgeEconom:  r.surge_econom  ?? null,
      surgeComfort: r.surge_comfort ?? null,
      hasRoutePrice: r.has_route_price ?? false,
      routeId:    r.id,
      routeLabel: r.label || r.id,
    };
    try {
      await mkdir(CALIB_DIR, { recursive: true });
      await writeFile(join(CALIB_DIR, calibId + ".json"), JSON.stringify(calib));
      console.log(`[probe-calib] saved route ${r.id} factE= ${r.econom ?? "—"} factC= ${r.comfort ?? "—"}`);
      saved.push({ id: calibId, routeId: r.id, factE: r.econom, factC: r.comfort });
    } catch (e) {
      console.error("[probe-calib] write error:", e.message);
    }
  }

  try {
    await appendFile(PROBES_FILE, JSON.stringify(logEntry) + "\n");
  } catch (e) {
    console.error("[probe-calib] probes.jsonl append error:", e.message);
  }

  // ── Telegram: rich format ──
  if (BOT_TOKEN && CHAT_ID && logEntry.routes.length > 0) {
    try {
      const hh  = String(mskNow.getUTCHours()).padStart(2, "0");
      const mm  = String(mskNow.getUTCMinutes()).padStart(2, "0");
      const dd  = String(mskNow.getUTCDate()).padStart(2, "0");
      const mo  = String(mskNow.getUTCMonth() + 1).padStart(2, "0");
      const dow = DAYS_RU[mskNow.getUTCDay()];

      const validRoutes = logEntry.routes.filter((r) => r.econom != null || r.comfort != null);

      const routeBlocks = validRoutes.map((r) => {
        const parts = [r.label || r.id];
        if (r.km) parts.push(r.km.toFixed(1) + " км");
        if (r.min) parts.push(`⏱${Math.round(r.min)} мин`);
        if (r.speed_kmh) parts.push(`🚀${Math.round(r.speed_kmh)} км/ч`);
        const header = parts.join("  ");
        const addr = (r.from_addr && r.to_addr) ? `  ${r.from_addr} → ${r.to_addr}` : "";
        const seIcon = _surgeIcon(r.surge_econom);
        const scIcon = _surgeIcon(r.surge_comfort);
        const ecoLine = r.econom != null
          ? `  Эконом:   ${r.econom.toFixed(1)}р` +
            (r.surge_econom != null ? `  скачок ${seIcon}×${r.surge_econom.toFixed(2)}` : "")
          : "";
        const cftLine = r.comfort != null
          ? `  Комфорт:  ${r.comfort.toFixed(1)}р` +
            (r.surge_comfort != null ? `  скачок ${scIcon}×${r.surge_comfort.toFixed(2)}` : "") +
            " (от)"
          : "";
        return [header, addr, ecoLine, cftLine].filter(Boolean).join("\n");
      });

      const econRoutes = validRoutes.filter((r) => r.econom != null);
      const cftRoutes  = validRoutes.filter((r) => r.comfort != null);
      const econTotal  = econRoutes.reduce((s, r) => s + r.econom, 0);
      const cftTotal   = cftRoutes.reduce((s, r) => s + r.comfort, 0);
      const speeds     = validRoutes.filter((r) => r.speed_kmh).map((r) => r.speed_kmh);
      const avgSpeed   = speeds.length ? Math.round(speeds.reduce((s, v) => s + v, 0) / speeds.length) : null;

      const totalsLines = [
        `Итого по ${validRoutes.length} маршрутам:`,
        econRoutes.length ? `  Эконом:   ${econTotal.toFixed(1)}р (сред. ${(econTotal / econRoutes.length).toFixed(1)}р)` : "",
        cftRoutes.length  ? `  Комфорт:  ${cftTotal.toFixed(1)}р (сред. ${(cftTotal / cftRoutes.length).toFixed(1)}р)`  : "",
        avgSpeed          ? `  🚀 Средняя скорость: ${avgSpeed} км/ч`                                                       : "",
      ].filter(Boolean).join("\n");

      let deltaLine = "";
      if (prevEconomTotal != null && econRoutes.length > 0) {
        const delta = Math.round((econTotal - prevEconomTotal) * 10) / 10;
        if (Math.abs(delta) < 0.15) {
          deltaLine = `➡️ Стабильно: Δ эконом 0.0р к замеру #${prevProbeNum}`;
        } else if (delta > 0) {
          deltaLine = `📈 Дороже на ${delta.toFixed(1)}р к замеру #${prevProbeNum}`;
        } else {
          deltaLine = `📉 Дешевле на ${Math.abs(delta).toFixed(1)}р к замеру #${prevProbeNum}`;
        }
      }

      const msgHeader = `🚕 Яндекс.Го — Минск\n🕐 ${dow} ${hh}:${mm} по МСК • ${dd}.${mo}   замер #${probeNum}`;
      const text = [msgHeader, "", ...routeBlocks, "", totalsLines, deltaLine ? "\n" + deltaLine : ""]
        .filter((s) => s !== undefined)
        .join("\n")
        .trim();

      const body = Buffer.from(JSON.stringify({ chat_id: CHAT_ID, text }));
      await new Promise((ok) => {
        const req2 = httpsRequest({
          host: "api.telegram.org",
          path: `/bot${BOT_TOKEN}/sendMessage`,
          method: "POST",
          headers: { "content-type": "application/json", "content-length": body.length },
          timeout: 5000,
        }, (r) => { r.resume(); ok(r.statusCode); });
        req2.on("error", ok);
        req2.end(body);
      });
      console.log(`[probe-tg] sent, status: 200`);
    } catch (e) {
      console.error("[probe-tg] error:", e.message);
    }
  }

  return { saved, total: logEntry.routes.length };
}

// GET /probe-secret — returns PROBE_SECRET to authenticated admin UI (requires SCREENS_TOKEN).
async function handleProbeSecret(req, res) {
  if (TOKEN && req.headers["x-screens-token"] !== TOKEN)
    return jsonResponse(res, 401, { ok: false, error: "bad_token" });
  return jsonResponse(res, 200, { ok: true, secret: PROBE_SECRET });
}

// GET /yandex-probe-redirect?d=base64json&t=PROBE_SECRET
// Called by bookmarklet via window.open(). Returns HTML result page.
async function handleYandexProbeRedirect(req, res) {
  const u = new URL(req.url, "http://x");

  // Auth: shared secret in ?t= (bookmarklet can't set headers)
  if (PROBE_SECRET && u.searchParams.get("t") !== PROBE_SECRET) {
    res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>403 Forbidden</h2><p>Invalid probe token.</p>");
    return;
  }

  const ip = req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "?";
  const rl = _rateConsume(`probe-redir:${ip}`, 10, 200);
  if (!rl.ok) {
    res.writeHead(429, { "Content-Type": "text/html; charset=utf-8", "Retry-After": String(rl.retryAfterSec) });
    res.end(`<h2>429 Too Many Requests</h2><p>Retry after ${rl.retryAfterSec}s</p>`);
    return;
  }

  let payload;
  try {
    const d = u.searchParams.get("d") || "";
    if (!d) throw new Error("no d");
    payload = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(d)))));
  } catch {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>400 Bad Request</h2><p>Cannot decode payload.</p>");
    return;
  }

  const validErr = _validateProbePayload(payload);
  if (validErr) {
    res.writeHead(422, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h2>422 Invalid Payload</h2><p>${validErr}</p>`);
    return;
  }

  const result = await _saveProbePayload(payload, ip);
  const rows = (payload.routes || []).map((r) => {
    const ok = r.econom != null || r.comfort != null;
    return `<tr style="color:${ok?"#22c55e":"#ef4444"}">
      <td style="padding:2px 8px">${r.label || r.id}</td>
      <td style="padding:2px 8px">${r.econom != null ? "Э" + r.econom.toFixed(1) : "—"}</td>
      <td style="padding:2px 8px">${r.comfort != null ? "К" + r.comfort.toFixed(1) : "—"}</td>
      <td style="padding:2px 8px">${r.surge_econom != null ? "×" + r.surge_econom.toFixed(2) : ""}</td>
    </tr>`;
  }).join("");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><meta charset="utf-8">
<title>Probe OK</title>
<style>body{background:#0f172a;color:#e2e8f0;font-family:monospace;padding:16px}
table{border-collapse:collapse}th{color:#94a3b8;text-align:left;padding:2px 8px}</style>
</head><body>
<h3>✅ Сохранено ${result.saved.length}/${result.total}</h3>
<table><tr><th>Маршрут</th><th>Эконом</th><th>Комфорт</th><th>Surge</th></tr>
${rows}</table>
<p style="color:#64748b;font-size:11px">${new Date().toISOString()}</p>
</body></html>`);
}

// POST /yandex-probe — called by rwbtaxi-price-probe.py cron (localhost or authenticated).
async function handleYandexProbe(req, res) {
  // Auth: shared secret in x-screens-token header
  if (PROBE_SECRET && req.headers["x-screens-token"] !== PROBE_SECRET)
    return jsonResponse(res, 401, { ok: false, error: "bad_token" });

  const ip = req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "127.0.0.1";
  const rl = _rateConsume(`probe-post:${ip}`, 20, 1500);
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfterSec));
    return jsonResponse(res, 429, { ok: false, error: "rate_limited", retryAfterSec: rl.retryAfterSec });
  }

  let body;
  try { body = await readJsonBody(req); }
  catch { return jsonResponse(res, 400, { ok: false, error: "bad_json" }); }

  const validErr = _validateProbePayload(body);
  if (validErr) return jsonResponse(res, 422, { ok: false, error: validErr });

  const result = await _saveProbePayload(body, ip);
  return jsonResponse(res, 200, { ok: true, saved: result.saved.length, total: result.total });
}

async function handleRecentCalibs(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "x"}`);
  const limit = Math.max(
    1,
    Math.min(200, Number(url.searchParams.get("limit")) || 50),
  );
  let names;
  try {
    names = await readdir(CALIB_DIR);
  } catch {
    return jsonResponse(res, 200, {
      ok: true,
      total: 0,
      items: [],
      note: "calib_dir_missing",
    });
  }
  const jsons = names.filter(
    (n) => n.startsWith("calib-") && n.endsWith(".json"),
  );
  const items = [];
  for (const name of jsons) {
    try {
      const buf = await readFile(join(CALIB_DIR, name), "utf8");
      const j = JSON.parse(buf);
      items.push({
        id: String(j.id || name.replace(/\.json$/, "")),
        receivedAt: String(j.receivedAt || ""),
        receivedFromIp: String(j.receivedFromIp || ""),
        fromAddress: String(j.fromAddress || ""),
        toAddress: String(j.toAddress || ""),
        // Точные адреса от Google Reverse Geocoding (улица + дом). Заполняются
        // process-screens при создании calib и enrich-addresses-vps.mjs для
        // исторических файлов. Пустая строка если ещё не догнали.
        fromAddressGeo: String(j.fromAddressGeo || ""),
        toAddressGeo: String(j.toAddressGeo || ""),
        fromLat: Number.isFinite(Number(j.fromLat)) ? Number(j.fromLat) : null,
        fromLng: Number.isFinite(Number(j.fromLng)) ? Number(j.fromLng) : null,
        toLat: Number.isFinite(Number(j.toLat)) ? Number(j.toLat) : null,
        toLng: Number.isFinite(Number(j.toLng)) ? Number(j.toLng) : null,
        factE: typeof j.factE === "number" ? j.factE : null,
        factC: typeof j.factC === "number" ? j.factC : null,
        etaMin: typeof j.etaMin === "number" ? j.etaMin : null,
        // Минуты поездки со скрина (надпись «22 мин» рядом с ценой) — нужны
        // фронту чтобы переучить модель на минуты вместо км по прямой.
        tripMin: typeof j.tripMin === "number" ? j.tripMin : null,
        demand: j.demand ?? null,
        date: String(j.date || ""),
        hour: typeof j.hour === "number" ? j.hour : null,
        source: String(j.source || ""),
        notes: String(j.notes || ""),
      });
    } catch {
      // битый файл пропускаем
    }
  }
  items.sort((a, b) =>
    a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0,
  );
  return jsonResponse(res, 200, {
    ok: true,
    total: items.length,
    items: items.slice(0, limit),
  });
}

// ───────────── /screens-stats и /screens-requeue (админ-мониторинг pipeline'а) ─────────────
// Стата за 1ч/24ч: сколько прислано, сколько распознано, сколько в failed (по причине),
// сколько ждёт в incoming. Используется в админ-карточке «План vs факт» — чтобы видеть,
// что Gemini не молчком режет на 429, а проблема видна и есть кнопка «перепрогнать».
//
// /screens-stats — публичный GET (статистика без чувствительных данных).
// /screens-requeue — POST, требует WB Bearer (это админская операция).

const SCREENS_PIPELINE_DIRS = {
  incoming: join(ROOT, "incoming"),
  processed: join(ROOT, "processed"),
  failed: join(ROOT, "failed"),
};

async function listFiles(dir) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function handleScreensStats(req, res) {
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  // 1) поток скринов — берём mtime файлов по трём папкам
  const buckets = { uploaded1h: 0, uploaded24h: 0, ok1h: 0, ok24h: 0, failed1h: 0, failed24h: 0 };
  const failedReasons = {};
  let oldestPendingMs = null;
  let inFailedRetryable = 0;

  // incoming
  for (const name of await listFiles(SCREENS_PIPELINE_DIRS.incoming)) {
    if (name.startsWith(".")) continue;
    try {
      const st = await stat(join(SCREENS_PIPELINE_DIRS.incoming, name));
      const age = now - st.mtimeMs;
      if (age <= HOUR) buckets.uploaded1h++;
      if (age <= DAY) buckets.uploaded24h++;
      if (oldestPendingMs == null || st.mtimeMs < oldestPendingMs) oldestPendingMs = st.mtimeMs;
    } catch {}
  }
  // processed (учитываем только оригиналы изображений, не *.meta.json/*.raw.json)
  for (const name of await listFiles(SCREENS_PIPELINE_DIRS.processed)) {
    if (name.endsWith(".meta.json") || name.endsWith(".raw.json")) continue;
    try {
      const st = await stat(join(SCREENS_PIPELINE_DIRS.processed, name));
      const age = now - st.mtimeMs;
      if (age <= HOUR) { buckets.uploaded1h++; buckets.ok1h++; }
      if (age <= DAY) { buckets.uploaded24h++; buckets.ok24h++; }
    } catch {}
  }
  // failed (читаем .error.json чтобы достать reason)
  for (const name of await listFiles(SCREENS_PIPELINE_DIRS.failed)) {
    if (!name.endsWith(".error.json")) continue;
    const fp = join(SCREENS_PIPELINE_DIRS.failed, name);
    let st, errObj;
    try {
      st = await stat(fp);
      errObj = JSON.parse(await readFile(fp, "utf8"));
    } catch {
      continue;
    }
    const reason = String(errObj?.error || "unknown");
    failedReasons[reason] = (failedReasons[reason] || 0) + 1;
    if (reason === "vision_all_failed") inFailedRetryable++;
    const age = now - st.mtimeMs;
    if (age <= HOUR) { buckets.uploaded1h++; buckets.failed1h++; }
    if (age <= DAY) { buckets.uploaded24h++; buckets.failed24h++; }
  }

  // 2) последний успешно созданный calib (mtime calib-*.json)
  let lastSuccessAt = null;
  let calibCount = 0;
  let calib1h = 0;
  let calib24h = 0;
  for (const name of await listFiles(CALIB_DIR)) {
    if (!name.startsWith("calib-") || !name.endsWith(".json")) continue;
    calibCount++;
    try {
      const st = await stat(join(CALIB_DIR, name));
      const age = now - st.mtimeMs;
      if (age <= HOUR) calib1h++;
      if (age <= DAY) calib24h++;
      if (lastSuccessAt == null || st.mtimeMs > lastSuccessAt) lastSuccessAt = st.mtimeMs;
    } catch {}
  }

  return jsonResponse(res, 200, {
    ok: true,
    now: new Date(now).toISOString(),
    last1h: {
      uploaded: buckets.uploaded1h,
      ok: buckets.ok1h,
      failed: buckets.failed1h,
      calibCreated: calib1h,
    },
    last24h: {
      uploaded: buckets.uploaded24h,
      ok: buckets.ok24h,
      failed: buckets.failed24h,
      calibCreated: calib24h,
    },
    failedReasons,
    inFailedRetryable,
    incomingPending: (await listFiles(SCREENS_PIPELINE_DIRS.incoming)).filter(
      (n) => !n.startsWith("."),
    ).length,
    oldestPendingAt: oldestPendingMs ? new Date(oldestPendingMs).toISOString() : null,
    oldestPendingMin: oldestPendingMs
      ? Math.round((now - oldestPendingMs) / 60000)
      : null,
    lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : null,
    lastSuccessMinAgo: lastSuccessAt ? Math.round((now - lastSuccessAt) / 60000) : null,
    calibTotal: calibCount,
  });
}

async function handleScreensRequeue(req, res) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  const FAILED = SCREENS_PIPELINE_DIRS.failed;
  const INCOMING = SCREENS_PIPELINE_DIRS.incoming;
  await mkdir(INCOMING, { recursive: true });
  let moved = 0;
  let skipped = 0;
  for (const name of await listFiles(FAILED)) {
    if (!name.endsWith(".error.json")) continue;
    const errPath = join(FAILED, name);
    let errObj;
    try {
      errObj = JSON.parse(await readFile(errPath, "utf8"));
    } catch {
      skipped++; continue;
    }
    if (errObj?.error !== "vision_all_failed") {
      skipped++; continue;
    }
    const base = name.slice(0, -".error.json".length);
    const src = join(FAILED, base);
    try {
      await stat(src);
    } catch {
      skipped++; continue;
    }
    try {
      await rename(src, join(INCOMING, base));
      await unlink(errPath);
      for (const ext of [".meta.json", ".raw.json"]) {
        const side = join(FAILED, base + ext);
        try { await unlink(side); } catch {}
      }
      moved++;
    } catch {
      skipped++;
    }
  }
  return jsonResponse(res, 200, { ok: true, moved, skipped });
}

// ───────────── WB orders module (Wildberries Taxi data) ─────────────
// Хранит загруженные CSV-выгрузки от ВБ-такси, аккумулирует заказы
// в одном aggregated.jsonl (append-only, дедупликация по order_id).
// Защищён собственным логин/пароль через ENV WB_ADMIN_LOGIN / WB_ADMIN_PASSWORD.
//
// Endpoints (все, кроме /wb/login, требуют Bearer token):
//   POST /wb/login       { login, password }       → { token, expiresAt }
//   POST /wb/upload      text/csv body              → { batchId, parsed, dups, added }
//   GET  /wb/stats                                  → totals/averages/regression/hourly/daily
//   GET  /wb/orders?limit=&offset=&status=&date=&clientId=&driverId=
//   GET  /wb/pairs?limit=                           → topClients/topDrivers/topPairs

const WB_DIR = process.env.WB_DIR || "/var/www/rwbtaxi/data/wb";
const WB_AGG_FILE = join(WB_DIR, "aggregated.jsonl");
const WB_UPLOADS_DIR = join(WB_DIR, "uploads");
const WB_ADMIN_LOGIN = process.env.WB_ADMIN_LOGIN || "";
const WB_ADMIN_PASSWORD = process.env.WB_ADMIN_PASSWORD || "";
// Viewer-учётка (роль 'viewer') — даёт доступ ТОЛЬКО к /pryan (карта прогноза
// тарифов). К WB-выгрузкам, антифроду и админке — НЕТ. Учётка хардкод-дефолт
// "rwb"/"39903990" (по требованию заказчика), может перебиваться ENV.
const WB_VIEWER_LOGIN = process.env.WB_VIEWER_LOGIN || "rwb";
const WB_VIEWER_PASSWORD = process.env.WB_VIEWER_PASSWORD || "39903990";
const WB_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const WB_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// Инициализацию изолируем: даже если каталог недоступен, остальные эндпоинты
// (calib/screens/upload/recommended) должны продолжать работать.
// Если init упал — WB-эндпоинты будут возвращать 503.
let WB_INIT_ERROR = null;
try {
  await mkdir(WB_DIR, { recursive: true });
  await mkdir(WB_UPLOADS_DIR, { recursive: true });
} catch (e) {
  WB_INIT_ERROR = e?.message || String(e);
  console.error("[wb] init failed, WB endpoints will return 503:", WB_INIT_ERROR);
}

const wbSessions = new Map(); // token -> { expiresAt }

// Сериализация записи в aggregated.jsonl: новая загрузка ждёт, пока завершится
// предыдущая. Защищает дедуп по orderId от гонки при параллельных POST /wb/upload.
let wbUploadChain = Promise.resolve();
function serializeWbWrite(fn) {
  const next = wbUploadChain.then(fn, fn);
  // chain не должен «протекать» rejected promise'ами наружу
  wbUploadChain = next.catch(() => undefined);
  return next;
}

function pruneWbSessions() {
  const now = Date.now();
  for (const [t, s] of wbSessions) {
    if (s.expiresAt <= now) wbSessions.delete(t);
  }
}
setInterval(pruneWbSessions, 60_000).unref();

// Возвращает объект сессии {expiresAt, userId, role, login, displayName} или null.
// Truthy/falsy совместимо со старыми вызовами `if (!checkWbAuth(req))`.
//
// ВАЖНО: viewer-роль (просмотр /pryan) НЕ должна получать доступ к WB-данным
// (заказы/клиенты/водители/фрод/админка). Поэтому checkWbAuth по умолчанию
// отбрасывает viewer-сессию. Для нейтральных эндпоинтов вроде /wb/me нужно
// использовать checkWbAuthAny (см. ниже).
// Сначала пробуем cookie (HttpOnly+Secure+SameSite=Lax — основной канал
// после миграции), затем Authorization: Bearer (legacy/Native клиенты,
// автоматизация, старые SPA-сессии в localStorage).
function _readWbToken(req) {
  const cookies = parseCookies(req);
  const ck = cookies[WB_SID_COOKIE];
  if (typeof ck === "string" && /^[a-f0-9]{32,}$/i.test(ck)) return ck;
  const h = req.headers["authorization"] || "";
  const m = /^Bearer\s+([a-f0-9]{32,})$/i.exec(h);
  if (m) return m[1];
  return null;
}
function checkWbAuthAny(req) {
  const token = _readWbToken(req);
  if (!token) return null;
  const sess = wbSessions.get(token);
  if (!sess || sess.expiresAt < Date.now()) {
    if (sess) wbSessions.delete(token);
    return null;
  }
  return { token, ...sess };
}
// Доступ к большинству /wb/* эндпоинтов — только admin. Антифродер работает
// только с кейсами (handleWbCase*) — там guard явно расширен до admin+antifraud.
function checkWbAuth(req) {
  const sess = checkWbAuthAny(req);
  if (!sess) return null;
  if (sess.role !== "admin") return null;
  return sess;
}
function checkWbAuthAdminOrAntifraud(req) {
  const sess = checkWbAuthAny(req);
  if (!sess) return null;
  if (sess.role !== "admin" && sess.role !== "antifraud") return null;
  return sess;
}
function requireWbRole(req, role) {
  const sess = checkWbAuthAny(req);
  if (!sess) return null;
  if (sess.role === "viewer") return null;
  if (role && sess.role !== role) return null;
  return sess;
}

// Логаут: уничтожаем серверную сессию (читаем токен из cookie ИЛИ Bearer)
// и явно гасим cookie на стороне клиента. Без аутентификации возвращаем
// 200 (идемпотентно — фронт всё равно почистит локальное состояние).
async function handleWbLogout(req, res) {
  const token = _readWbToken(req);
  if (token) wbSessions.delete(token);
  clearSessionCookie(res);
  return jsonResponse(res, 200, { ok: true });
}

async function handleWbLogin(req, res) {
  if (WB_INIT_ERROR) {
    return jsonResponse(res, 503, { ok: false, error: "wb_not_configured" });
  }
  const ip = clientIp(req);
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return jsonResponse(res, 400, { ok: false, error: "bad_json" });
  }
  const login = String(body?.login || "").trim();
  const password = String(body?.password || "");
  if (!login || !password) {
    return jsonResponse(res, 400, { ok: false, error: "missing_fields" });
  }
  // Rate-limit: 5/5мин/IP + 10/час/login. Проверяем ДО hash-сравнения,
  // чтобы атакующий не мог дёргать дорогой scrypt-verify.
  const rate = _checkWbLoginRate(ip, login);
  if (!rate.ok) {
    console.warn(
      `[wb-login] rate-limited reason=${rate.reason} ${ipForLog(ip)} login=${login.slice(0, 32)}`,
    );
    return jsonResponse(res, 429, {
      ok: false, error: "too_many_login_attempts", reason: rate.reason,
    });
  }
  // 1) Сначала проверяем созданных пользователей (users.jsonl с ролями).
  let auth = null;
  try {
    const users = await _loadUsers();
    const u = users.find((x) => !x.disabled && x.login.toLowerCase() === login.toLowerCase());
    if (u && _verifyPassword(password, u.passwordHash)) {
      auth = {
        userId: u.id, role: u.role, login: u.login, displayName: u.displayName || u.login,
      };
    }
  } catch (e) {
    req.log?.warn?.({ err: e?.message }, "[wb] users.jsonl read failed");
  }
  // 2) Fallback: ENV-учётка (всегда роль admin).
  if (!auth && WB_ADMIN_LOGIN && WB_ADMIN_PASSWORD
      && login === WB_ADMIN_LOGIN && password === WB_ADMIN_PASSWORD) {
    auth = { userId: "env-admin", role: "admin", login, displayName: "Главный админ" };
  }
  // 3) Fallback: ENV viewer-учётка → роль 'viewer' (доступ только к /pryan).
  if (!auth && WB_VIEWER_LOGIN && WB_VIEWER_PASSWORD
      && login.toLowerCase() === WB_VIEWER_LOGIN.toLowerCase()
      && password === WB_VIEWER_PASSWORD) {
    auth = {
      userId: "env-viewer", role: "viewer",
      login: WB_VIEWER_LOGIN, displayName: "Просмотр карты",
    };
  }
  if (!auth) {
    _recordWbLoginAttempt(ip, login);
    // После 3-й неудачи с одного IP — задержка 1.5с (эмулирует «timing
    // tar-pit»: off-line словарный брут резко замедляется при сохранении
    // приемлемого UX для забывчивого юзера).
    const ipArr = _wbLoginByIp.get(ip) || [];
    if (ipArr.length >= 3) {
      await new Promise((r) => setTimeout(r, 1500));
    }
    console.warn(
      `[wb-login] bad creds ${ipForLog(ip)} login=${login.slice(0, 32)} attempts_ip=${ipArr.length}`,
    );
    return jsonResponse(res, 401, { ok: false, error: "bad_credentials" });
  }
  // Успех: сбрасываем счётчики rate-limit для этого IP+login.
  _clearWbLoginAttempts(ip, login);
  const token = randomBytes(24).toString("hex");
  const expiresAt = Date.now() + WB_SESSION_TTL_MS;
  wbSessions.set(token, { expiresAt, ...auth });
  // Cookie — основной канал после миграции (HttpOnly+Secure+SameSite=Lax),
  // но токен также возвращаем в JSON ради обратной совместимости с уже
  // развёрнутыми клиентами, которые читают response.token.
  setSessionCookie(res, token, expiresAt);
  console.log(
    `[wb-login] ok ${ipForLog(ip)} role=${auth.role} login=${auth.login}`,
  );
  return jsonResponse(res, 200, {
    ok: true, token, expiresAt,
    user: { id: auth.userId, login: auth.login, role: auth.role, displayName: auth.displayName },
  });
}

function _validCoord(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

// Поддерживаем два формата CSV:
//   v1 (10 колонок): order_id,order_date,order_create_date_time,order_cancel_date_time,
//                    fta_sum_min,gmv_client_gross,distance_order_km,time_trip_min,client_id,driver_id
//   v2 (14 колонок): order_id,lat_in,lng_in,lat_out,lng_out,order_date,...
function parseWbCsvLine(line, format /* "v1" | "v2" */) {
  const c = line.split(",");
  const fmt = format === "v2" ? "v2" : "v1";
  const minCols = fmt === "v2" ? 14 : 10;
  if (c.length < minCols) return null;

  let idx = 0;
  const orderId = String(c[idx++] || "").trim();
  let latIn = null, lngIn = null, latOut = null, lngOut = null;
  if (fmt === "v2") {
    const li = Number(c[idx++]);
    const gi = Number(c[idx++]);
    const lo = Number(c[idx++]);
    const go = Number(c[idx++]);
    if (_validCoord(li, gi)) { latIn = li; lngIn = gi; }
    if (_validCoord(lo, go)) { latOut = lo; lngOut = go; }
  }
  const orderDate = String(c[idx++] || "").trim();
  const createdAt = String(c[idx++] || "").trim();
  const cancelStr = c[idx++];
  const isCancelled =
    cancelStr && cancelStr !== "1970-01-01 00:00:00+00:00" && cancelStr !== "";
  const fta = c[idx] !== "" && c[idx] != null ? Number(c[idx]) : null; idx++;
  const gmv = c[idx] !== "" && c[idx] != null ? Number(c[idx]) : null; idx++;
  const km = c[idx] !== "" && c[idx] != null ? Number(c[idx]) : null; idx++;
  const tripMin = c[idx] !== "" && c[idx] != null ? Number(c[idx]) : null; idx++;
  const clientId = String(c[idx++] || "").trim();
  const driverId = String(c[idx++] || "").trim();

  const o = {
    orderId,
    orderDate,
    createdAt,
    cancelledAt: isCancelled ? String(cancelStr).trim() : null,
    fta,
    gmv,
    km,
    tripMin,
    clientId,
    driverId,
  };
  if (latIn !== null) { o.latIn = latIn; o.lngIn = lngIn; }
  if (latOut !== null) { o.latOut = latOut; o.lngOut = lngOut; }

  if (!o.orderId) return null;
  if (o.tripMin !== null && (!Number.isFinite(o.tripMin) || o.tripMin > 24 * 60 || o.tripMin < 0)) {
    o.tripMin = null;
  }
  if (o.km !== null && (!Number.isFinite(o.km) || o.km > 200 || o.km < 0)) {
    o.km = null;
  }
  if (o.fta !== null && !Number.isFinite(o.fta)) o.fta = null;
  if (o.gmv !== null && !Number.isFinite(o.gmv)) o.gmv = null;
  return o;
}

function classifyWb(o) {
  if (o.cancelledAt) return "cancelled";
  if (o.gmv && o.km && o.tripMin) return "completed";
  return "open";
}

async function handleWbUpload(req, res, ip) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  let bytes = 0;
  const chunks = [];
  let aborted = false;
  await new Promise((resolve) => {
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > WB_MAX_UPLOAD_BYTES) {
        aborted = true;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", resolve);
    req.on("error", resolve);
  });
  if (aborted) {
    return jsonResponse(res, 413, { ok: false, error: "body_too_large" });
  }
  const csv = Buffer.concat(chunks).toString("utf8");
  return processWbCsv(res, csv, ip);
}

async function processWbCsv(res, csvText, ip) {
  // BOM из Excel-экспортов
  if (csvText.charCodeAt(0) === 0xfeff) csvText = csvText.slice(1);
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return jsonResponse(res, 400, { ok: false, error: "empty_csv" });
  }
  const header = lines.shift().trim();
  // Поддерживаем два формата заголовка: v1 (без координат) и v2 (с lat_in/lng_in/lat_out/lng_out).
  const REQ_V1 = [
    "order_id",
    "order_date",
    "order_create_date_time",
    "order_cancel_date_time",
    "fta_sum_min",
    "gmv_client_gross",
    "distance_order_km",
    "time_trip_min",
    "client_id",
    "driver_id",
  ];
  const REQ_V2 = [
    "order_id",
    "lat_in",
    "lng_in",
    "lat_out",
    "lng_out",
    "order_date",
    "order_create_date_time",
    "order_cancel_date_time",
    "fta_sum_min",
    "gmv_client_gross",
    "distance_order_km",
    "time_trip_min",
    "client_id",
    "driver_id",
  ];
  const headerCols = header.split(",").map((s) => s.trim());
  let csvFormat = null;
  if (
    headerCols.length >= REQ_V2.length &&
    REQ_V2.every((n, i) => headerCols[i] === n)
  ) {
    csvFormat = "v2";
  } else if (
    headerCols.length >= REQ_V1.length &&
    REQ_V1.every((n, i) => headerCols[i] === n)
  ) {
    csvFormat = "v1";
  } else {
    return jsonResponse(res, 400, {
      ok: false,
      error: "bad_header",
      expected: `v1: ${REQ_V1.join(",")} | v2: ${REQ_V2.join(",")}`,
      got: header,
    });
  }

  // Сериализуем критическую секцию: чтение existing + append.
  // Любые параллельные /wb/upload встанут в очередь и не задублируют orderId.
  return serializeWbWrite(async () => {
    const batchId = `wb-batch-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;

    // Загружаем все существующие записи в Map для возможного merge.
    const existingMap = new Map();
    try {
      const buf = await readFile(WB_AGG_FILE, "utf8");
      for (const ln of buf.split(/\r?\n/)) {
        if (!ln) continue;
        try {
          const o = JSON.parse(ln);
          if (o?.orderId) existingMap.set(o.orderId, o);
        } catch {
          /* skip */
        }
      }
    } catch {
      /* нет файла — ок */
    }

    const fresh = [];
    let parsed = 0,
      dups = 0,
      bad = 0,
      enriched = 0;
    const enrichedRecords = new Map(); // orderId -> updated record

    for (const ln of lines) {
      const o = parseWbCsvLine(ln, csvFormat);
      if (!o) {
        bad++;
        continue;
      }
      parsed++;
      const prev = existingMap.get(o.orderId);
      if (prev) {
        // Merge: дополняем отсутствующие поля (в первую очередь — координаты).
        let changed = false;
        const merged = { ...prev };
        if (o.latIn != null && prev.latIn == null) {
          merged.latIn = o.latIn; merged.lngIn = o.lngIn; changed = true;
        }
        if (o.latOut != null && prev.latOut == null) {
          merged.latOut = o.latOut; merged.lngOut = o.lngOut; changed = true;
        }
        // Если раньше cancelledAt было null, а сейчас стало известно — обновим.
        if (o.cancelledAt && !prev.cancelledAt) {
          merged.cancelledAt = o.cancelledAt; changed = true;
        }
        // Аналогично можно подтянуть пропущенные числовые поля.
        for (const k of ["fta", "gmv", "km", "tripMin"]) {
          if ((prev[k] == null || !Number.isFinite(prev[k])) && o[k] != null && Number.isFinite(o[k])) {
            merged[k] = o[k]; changed = true;
          }
        }
        if (changed) {
          // Любое изменение полей классификации может перевести запись open → completed/cancelled.
          merged.status = classifyWb(merged);
          merged.enrichedAt = new Date().toISOString();
          merged.enrichBatchId = batchId;
          enrichedRecords.set(o.orderId, merged);
          existingMap.set(o.orderId, merged);
          enriched++;
        } else {
          dups++;
        }
        continue;
      }
      o.batchId = batchId;
      o.uploadedAt = new Date().toISOString();
      o.uploaderIp = ip;
      o.status = classifyWb(o);
      fresh.push(o);
      existingMap.set(o.orderId, o);
    }

    // Запись: если были обогащения — перезаписываем файл целиком атомарно
    // (write to .tmp + rename), с бэкапом старого. Иначе — append fresh.
    if (enriched > 0) {
      const all = [...existingMap.values()];
      const tmp = WB_AGG_FILE + ".tmp";
      const bak = WB_AGG_FILE + ".bak-" + batchId;
      const data = all.map((o) => JSON.stringify(o)).join("\n") + "\n";
      await writeFile(tmp, data);
      try { await rename(WB_AGG_FILE, bak); } catch { /* нет старого — ок */ }
      await rename(tmp, WB_AGG_FILE);
      console.log(`[wb] batch ${batchId}: enriched=${enriched} backup=${bak}`);
      // PII-retention: храним только N=3 свежих бэкапов (старые содержат
      // снепшоты заказов и могут жить вечно — это диск + GDPR-риск).
      try {
        const cleaned = await cleanupOldBackups(WB_DIR, "aggregated.jsonl.bak-", 3);
        if (cleaned.deleted > 0) {
          console.log(`[wb] backup cleanup kept=${cleaned.kept} deleted=${cleaned.deleted}`);
        }
      } catch (e) {
        console.warn(`[wb] backup cleanup failed: ${e?.message || e}`);
      }
    } else if (fresh.length > 0) {
      const data = fresh.map((o) => JSON.stringify(o)).join("\n") + "\n";
      await writeFile(WB_AGG_FILE, data, { flag: "a" });
    }

    if (fresh.length > 0 || enriched > 0) {
      await writeFile(
        join(WB_UPLOADS_DIR, batchId + ".json"),
        JSON.stringify(
          {
            batchId,
            uploadedAt: new Date().toISOString(),
            uploaderIp: ip,
            csvFormat,
            parsed,
            dups,
            bad,
            added: fresh.length,
            enriched,
          },
          null,
          2,
        ),
      );
      console.log(
        `[wb] batch ${batchId}: format=${csvFormat} parsed=${parsed} dups=${dups} bad=${bad} added=${fresh.length} enriched=${enriched}`,
      );
    }

    return jsonResponse(res, 200, {
      ok: true,
      batchId,
      csvFormat,
      parsed,
      dups,
      bad,
      added: fresh.length,
      enriched,
    });
  });
}

async function loadWbAll() {
  try {
    const buf = await readFile(WB_AGG_FILE, "utf8");
    const out = [];
    for (const ln of buf.split(/\r?\n/)) {
      if (!ln) continue;
      try {
        out.push(JSON.parse(ln));
      } catch {
        /* skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}

const _avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const _med = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

// Порог «короткой подачи» — заказ считается подозрительным, если водитель
// доехал до клиента быстрее, чем за 2 минуты. Это ловит самозаказы и крутки
// с близкого старта (точки старта водителя в данных нет, поэтому считаем
// именно по времени, а не по расстоянию).
const SHORT_PICKUP_FTA_MIN = 2;
// Перекрёстная аномалия (б): одна и та же пара (clientId, driverId) в один
// календарный день делает ≥ N заказов. 3 — порог здравого смысла (двое-трое
// случайных совпадений в день норм, четыре уже не бывает).
const CROSS_PAIR_DAILY_MIN = 3;
// Связка: пара (clientId, driverId) ≥ N заказов в окне. ≥2 — определение
// «связанных поездок», как договаривались.
const LINKED_PAIR_MIN = 2;

// Один проход по всем заказам строит контекст для окна [fromMs, toMs):
//   — first-seen карты по клиентам/водителям (за всё время до toMs);
//   — множество телефонов, известных как driverPhone (для cross-detect);
//   — индексы повторов и связок;
//   — множество orderId по типам аномалий.
// Контекст переиспользуется и в /wb/stats (агрегаты), и в /wb/orders (фильтры).
function _wbBuildWindowContext(allOrders, fromMs, toMs) {
  const hasFrom = Number.isFinite(fromMs);
  const hasTo = Number.isFinite(toMs);
  const inRange = [];
  const clientFirstSeen = new Map();
  const driverFirstSeen = new Map();
  const driverPhones = new Set();
  for (const o of allOrders) {
    const t = Date.parse(o.createdAt || "");
    if (!Number.isFinite(t)) continue;
    if (hasTo && t >= toMs) continue; // строго до конца окна
    if (o.clientId) {
      const k = String(o.clientId);
      const prev = clientFirstSeen.get(k);
      if (prev === undefined || t < prev) clientFirstSeen.set(k, t);
    }
    if (o.driverId && o.driverId !== "0") {
      const k = String(o.driverId);
      const prev = driverFirstSeen.get(k);
      if (prev === undefined || t < prev) driverFirstSeen.set(k, t);
    }
    if (o.driverPhone) driverPhones.add(String(o.driverPhone));
    if ((!hasFrom || t >= fromMs) && (!hasTo || t < toMs)) inRange.push(o);
  }
  // Per-pair counts in window + per-pair-per-day counts (для cross-б).
  const pairCount = new Map();
  const pairDayCount = new Map();
  for (const o of inRange) {
    if (!o.clientId || !o.driverId || o.driverId === "0") continue;
    const pk = `${o.clientId}|${o.driverId}`;
    pairCount.set(pk, (pairCount.get(pk) || 0) + 1);
    const dk = `${pk}|${o.orderDate || ""}`;
    pairDayCount.set(dk, (pairDayCount.get(dk) || 0) + 1);
  }
  // Сеты orderId по аномалиям.
  const crossOrderIds = new Set();
  const shortPickupOrderIds = new Set();
  const linkedOrderIds = new Set();
  const fraudOrderIds = new Set();
  const repeatOrderIds = new Set();
  const firstSeenOrderIds = new Set();
  for (const o of inRange) {
    // first-seen: первый заказ клиента в окне И ранее клиента не было
    if (o.clientId) {
      const fs = clientFirstSeen.get(String(o.clientId));
      if (fs !== undefined && hasFrom && fs >= fromMs) {
        firstSeenOrderIds.add(o.orderId);
      } else if (fs !== undefined && hasFrom && fs < fromMs) {
        repeatOrderIds.add(o.orderId);
      }
    }
    // cross (a): clientPhone совпал с одним из driverPhone
    if (o.clientPhone && driverPhones.has(String(o.clientPhone))) {
      crossOrderIds.add(o.orderId);
    }
    // cross (b): пара ≥3 раз/день
    if (o.clientId && o.driverId && o.driverId !== "0") {
      const dk = `${o.clientId}|${o.driverId}|${o.orderDate || ""}`;
      if ((pairDayCount.get(dk) || 0) >= CROSS_PAIR_DAILY_MIN) {
        crossOrderIds.add(o.orderId);
      }
    }
    // short pickup (только completed с валидным fta>0)
    if (
      o.status === "completed" &&
      o.fta != null &&
      o.fta > 0 &&
      o.fta < SHORT_PICKUP_FTA_MIN
    ) {
      shortPickupOrderIds.add(o.orderId);
    }
    // linked: пара (cid,did) встретилась в окне ≥ LINKED_PAIR_MIN раз
    if (o.clientId && o.driverId && o.driverId !== "0") {
      const pk = `${o.clientId}|${o.driverId}`;
      if ((pairCount.get(pk) || 0) >= LINKED_PAIR_MIN) {
        linkedOrderIds.add(o.orderId);
      }
    }
    // фрод: union самых ярких эвристик (cross + short + selfRide + speed)
    if (_detectSelfRide(o) != null) fraudOrderIds.add(o.orderId);
    if (_detectSpeedAnomaly(o) != null) fraudOrderIds.add(o.orderId);
  }
  for (const id of crossOrderIds) fraudOrderIds.add(id);
  for (const id of shortPickupOrderIds) fraudOrderIds.add(id);
  return {
    inRange,
    clientFirstSeen,
    driverFirstSeen,
    driverPhones,
    pairCount,
    pairDayCount,
    crossOrderIds,
    shortPickupOrderIds,
    linkedOrderIds,
    fraudOrderIds,
    repeatOrderIds,
    firstSeenOrderIds,
    fromMs: hasFrom ? fromMs : null,
    toMs: hasTo ? toMs : null,
  };
}

// Снимок KPI за окно (использует _wbBuildWindowContext).
function _wbSnapshot(ctx) {
  const { inRange } = ctx;
  const completed = inRange.filter((o) => o.status === "completed");
  const cancelled = inRange.filter((o) => o.status === "cancelled");
  const open = inRange.filter((o) => o.status === "open");
  const activeClients = new Set();
  const activeDrivers = new Set();
  for (const o of inRange) {
    if (o.clientId) activeClients.add(String(o.clientId));
    if (o.driverId && o.driverId !== "0") activeDrivers.add(String(o.driverId));
  }
  // newClients/newDrivers: firstSeen ∈ [fromMs, toMs)
  let newClients = 0;
  let newDrivers = 0;
  if (ctx.fromMs != null) {
    for (const [, t] of ctx.clientFirstSeen) {
      if (t >= ctx.fromMs && (ctx.toMs == null || t < ctx.toMs)) newClients++;
    }
    for (const [, t] of ctx.driverFirstSeen) {
      if (t >= ctx.fromMs && (ctx.toMs == null || t < ctx.toMs)) newDrivers++;
    }
  } else {
    // Без fromMs — все, кого видели до toMs, считаются «новыми за всё время».
    newClients = ctx.clientFirstSeen.size;
    newDrivers = ctx.driverFirstSeen.size;
  }
  // total — накопленное за всё время до конца окна.
  const totalClients = ctx.clientFirstSeen.size;
  const totalDrivers = ctx.driverFirstSeen.size;
  const _km = completed.map((o) => o.km).filter((x) => x > 0);
  const _trip = completed.map((o) => o.tripMin).filter((x) => x > 0 && x < 600);
  const _gmv = completed.map((o) => o.gmv).filter((x) => x > 0);
  const _fta = completed.map((o) => o.fta).filter((x) => x > 0 && x < 60);
  const _speed = completed
    .map((o) => (o.km > 0 && o.tripMin > 0 ? (o.km / o.tripMin) * 60 : 0))
    .filter((s) => s > 3 && s < 100);
  const revenueTotal = _gmv.reduce((s, x) => s + x, 0);

  // ── Доход водителя по фроду и кэшбэк клиента по аномальным группам.
  // Кэшбэк = 30% от GMV безналичных (paymentType='4') completed-заказов
  // внутри множества (linked/cross/shortPickup). Доход водителя по фроду
  // пока null — ждём выгрузку с полем driver_payout.
  const CASHBACK_RATE = 0.3;
  let fraudGmv = 0;
  let linkedGmvCard = 0;
  let crossGmvCard = 0;
  let shortPickupGmvCard = 0;
  for (const o of inRange) {
    if (o.status !== "completed") continue;
    const g = Number(o.gmv) || 0;
    if (g <= 0) continue;
    const isCard = String(o.paymentType || "") === "4";
    if (ctx.fraudOrderIds.has(o.orderId)) fraudGmv += g;
    if (isCard) {
      if (ctx.linkedOrderIds.has(o.orderId)) linkedGmvCard += g;
      if (ctx.crossOrderIds.has(o.orderId)) crossGmvCard += g;
      if (ctx.shortPickupOrderIds.has(o.orderId)) shortPickupGmvCard += g;
    }
  }
  return {
    range: { fromMs: ctx.fromMs, toMs: ctx.toMs },
    orders: inRange.length,
    completed: completed.length,
    cancelled: cancelled.length,
    open: open.length,
    activeClients: activeClients.size,
    activeDrivers: activeDrivers.size,
    totalClients,
    totalDrivers,
    newClients,
    newDrivers,
    repeatTrips: ctx.repeatOrderIds.size,
    crossTrips: ctx.crossOrderIds.size,
    shortPickupTrips: ctx.shortPickupOrderIds.size,
    linkedTrips: ctx.linkedOrderIds.size,
    fraudSuspectTrips: ctx.fraudOrderIds.size,
    revenueTotal: Math.round(revenueTotal * 100) / 100,
    avgCheck: _avg(_gmv),
    avgKm: _avg(_km),
    avgTripMin: _avg(_trip),
    avgFta: _avg(_fta),
    avgSpeedKmh: _avg(_speed),
    // Финансовые показатели по аномалиям.
    fraudGmvBYN: Math.round(fraudGmv * 100) / 100,
    fraudDriverPayoutBYN: null,
    linkedCashbackBYN: Math.round(linkedGmvCard * CASHBACK_RATE * 100) / 100,
    crossCashbackBYN: Math.round(crossGmvCard * CASHBACK_RATE * 100) / 100,
    shortPickupCashbackBYN:
      Math.round(shortPickupGmvCard * CASHBACK_RATE * 100) / 100,
  };
}

async function handleWbStats(req, res) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  const url = new URL(req.url, `http://${req.headers.host || "x"}`);
  const range = _parseTimeRange(url);
  const allOrders = await loadWbAll();
  const all = _filterByTimeRange(allOrders, range);
  const completed = all.filter(
    (o) =>
      o.status === "completed" &&
      o.gmv > 0 &&
      o.km > 0 &&
      o.tripMin > 0 &&
      o.tripMin < 600,
  );
  const cancelled = all.filter((o) => o.status === "cancelled");

  const km = completed.map((o) => o.km);
  const trip = completed.map((o) => o.tripMin);
  const gmv = completed.map((o) => o.gmv);
  const fta = completed.map((o) => o.fta).filter((x) => x > 0 && x < 60);
  const ppk = completed.map((o) => o.gmv / o.km);
  const ppm = completed.map((o) => o.gmv / o.tripMin);
  const speeds = completed
    .map((o) => (o.km / o.tripMin) * 60)
    .filter((s) => s > 3 && s < 100);

  let regression = null;
  if (completed.length > 10) {
    const n = completed.length;
    const sx1 = completed.reduce((s, o) => s + o.km, 0);
    const sx2 = completed.reduce((s, o) => s + o.tripMin, 0);
    const sx1x1 = completed.reduce((s, o) => s + o.km * o.km, 0);
    const sx2x2 = completed.reduce((s, o) => s + o.tripMin * o.tripMin, 0);
    const sx1x2 = completed.reduce((s, o) => s + o.km * o.tripMin, 0);
    const sy = completed.reduce((s, o) => s + o.gmv, 0);
    const sx1y = completed.reduce((s, o) => s + o.km * o.gmv, 0);
    const sx2y = completed.reduce((s, o) => s + o.tripMin * o.gmv, 0);
    const det3 = (m) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const M = [
      [n, sx1, sx2],
      [sx1, sx1x1, sx1x2],
      [sx2, sx1x2, sx2x2],
    ];
    const B = [sy, sx1y, sx2y];
    const D = det3(M);
    if (Math.abs(D) > 1e-6) {
      const a =
        det3([
          [B[0], M[0][1], M[0][2]],
          [B[1], M[1][1], M[1][2]],
          [B[2], M[2][1], M[2][2]],
        ]) / D;
      const b =
        det3([
          [M[0][0], B[0], M[0][2]],
          [M[1][0], B[1], M[1][2]],
          [M[2][0], B[2], M[2][2]],
        ]) / D;
      const c =
        det3([
          [M[0][0], M[0][1], B[0]],
          [M[1][0], M[1][1], B[1]],
          [M[2][0], M[2][1], B[2]],
        ]) / D;
      regression = { intercept: a, perKm: b, perMin: c };
    }
  }

  const byHour = {};
  for (const o of completed) {
    const h = parseInt(String(o.createdAt || "").substr(11, 2), 10);
    if (!Number.isFinite(h)) continue;
    if (!byHour[h]) byHour[h] = [];
    byHour[h].push(o);
  }
  const hourly = [];
  for (let h = 0; h < 24; h++) {
    const arr = byHour[h] || [];
    if (!arr.length) continue;
    hourly.push({
      hour: h,
      count: arr.length,
      avgKm: _avg(arr.map((o) => o.km)),
      avgGmv: _avg(arr.map((o) => o.gmv)),
      avgPpk: _avg(arr.map((o) => o.gmv / o.km)),
    });
  }

  const byDay = {};
  for (const o of all) {
    const d = String(o.orderDate || "");
    if (!d) continue;
    if (!byDay[d]) byDay[d] = { total: 0, completed: 0, cancelled: 0 };
    byDay[d].total++;
    if (o.status === "completed") byDay[d].completed++;
    else if (o.status === "cancelled") byDay[d].cancelled++;
  }
  const daily = Object.entries(byDay)
    .sort()
    .map(([date, v]) => ({ date, ...v }));

  // ─── KPI-снапшот для главного дашборда + сравнение с пред. периодом ───
  const ctx = _wbBuildWindowContext(allOrders, range.fromMs, range.toMs);
  const dashboard = _wbSnapshot(ctx);
  let compare = null;
  if (Number.isFinite(range.fromMs) && Number.isFinite(range.toMs)) {
    const len = range.toMs - range.fromMs;
    const prevCtx = _wbBuildWindowContext(
      allOrders,
      range.fromMs - len,
      range.fromMs,
    );
    compare = _wbSnapshot(prevCtx);
  }

  return jsonResponse(res, 200, {
    ok: true,
    totals: {
      orders: all.length,
      completed: completed.length,
      cancelled: cancelled.length,
      cancelRate: all.length ? cancelled.length / all.length : 0,
      uniqueClients: new Set(all.map((o) => o.clientId).filter(Boolean)).size,
      uniqueDrivers: new Set(
        all.filter((o) => o.driverId && o.driverId !== "0").map((o) => o.driverId),
      ).size,
    },
    averages: {
      distanceKm: { avg: _avg(km), median: _med(km) },
      tripMin: { avg: _avg(trip), median: _med(trip) },
      gmv: { avg: _avg(gmv), median: _med(gmv) },
      ftaMin: { avg: _avg(fta), median: _med(fta) },
      pricePerKm: { avg: _avg(ppk), median: _med(ppk) },
      pricePerMin: { avg: _avg(ppm), median: _med(ppm) },
      speedKmh: { avg: _avg(speeds), median: _med(speeds) },
    },
    regression,
    hourly,
    daily,
    dashboard,
    compare,
  });
}

async function handleWbOrders(req, res) {
  // Антифродер тоже должен иметь доступ к /wb/orders, иначе он не построит
  // секцию «Заказы за период» в карточке кейса. Доступ остался admin-only
  // для всего остального — здесь явное расширение до admin+antifraud.
  if (!checkWbAuthAdminOrAntifraud(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  const url = new URL(req.url, `http://${req.headers.host || "x"}`);
  const limit = Math.max(
    1,
    Math.min(500, Number(url.searchParams.get("limit")) || 100),
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const status = String(url.searchParams.get("status") || "all");
  const date = String(url.searchParams.get("date") || "");
  const clientId = String(url.searchParams.get("clientId") || "");
  const driverId = String(url.searchParams.get("driverId") || "");
  const fromTs = String(url.searchParams.get("fromTs") || "");
  const toTs = String(url.searchParams.get("toTs") || "");
  const fromMs = fromTs ? Date.parse(fromTs) : NaN;
  const toMs = toTs ? Date.parse(toTs) : NaN;

  // Аномалийные фильтры. Включаются опционально и используют контекст окна.
  const fRepeat = url.searchParams.get("repeat") === "1";
  const fCross = url.searchParams.get("cross") === "1";
  const fShortPickup = url.searchParams.get("shortPickup") === "1";
  const fFraud = url.searchParams.get("fraudSuspect") === "1";
  const fLinked = url.searchParams.get("linked") === "1";
  const fFirstSeen = url.searchParams.get("firstSeen") === "1";
  const hourParam = url.searchParams.get("hour");
  const hourNum =
    hourParam != null && hourParam !== "" ? parseInt(hourParam, 10) : null;
  const needCtx =
    fRepeat || fCross || fShortPickup || fFraud || fLinked || fFirstSeen;

  const allOrders = await loadWbAll();
  let all = allOrders;
  if (status !== "all") all = all.filter((o) => o.status === status);
  if (date) all = all.filter((o) => o.orderDate === date);
  if (clientId) all = all.filter((o) => String(o.clientId) === clientId);
  if (driverId) all = all.filter((o) => String(o.driverId) === driverId);
  if (Number.isFinite(fromMs)) {
    all = all.filter((o) => {
      if (!o.createdAt) return false;
      const t = Date.parse(o.createdAt);
      return Number.isFinite(t) && t >= fromMs;
    });
  }
  if (Number.isFinite(toMs)) {
    all = all.filter((o) => {
      if (!o.createdAt) return false;
      const t = Date.parse(o.createdAt);
      return Number.isFinite(t) && t < toMs;
    });
  }
  if (needCtx) {
    const ctx = _wbBuildWindowContext(allOrders, fromMs, toMs);
    if (fRepeat) all = all.filter((o) => ctx.repeatOrderIds.has(o.orderId));
    if (fCross) all = all.filter((o) => ctx.crossOrderIds.has(o.orderId));
    if (fShortPickup)
      all = all.filter((o) => ctx.shortPickupOrderIds.has(o.orderId));
    if (fLinked) all = all.filter((o) => ctx.linkedOrderIds.has(o.orderId));
    if (fFraud) all = all.filter((o) => ctx.fraudOrderIds.has(o.orderId));
    if (fFirstSeen)
      all = all.filter((o) => ctx.firstSeenOrderIds.has(o.orderId));
  }
  if (Number.isFinite(hourNum) && hourNum >= 0 && hourNum < 24) {
    all = all.filter((o) => {
      const h = parseInt(String(o.createdAt || "").substr(11, 2), 10);
      return Number.isFinite(h) && h === hourNum;
    });
  }

  all.sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );

  let items = all.slice(offset, offset + limit);

  // Опциональное обогащение: для UI карточки кейса нужны флаги auto/manual фрод
  // на каждую строку. Тяжёлый расчёт делаем лениво и ТОЛЬКО когда явно
  // запрошено withFraudMarks=1 (иначе старые потребители не платят за это).
  const withFraudMarks = url.searchParams.get("withFraudMarks") === "1";
  if (withFraudMarks) {
    const ctx = _wbBuildWindowContext(allOrders, fromMs, toMs);
    const marksMap = await _loadFraudMarksMap();
    items = items.map((o) => {
      const mark = marksMap.get(o.orderId);
      return {
        ...o,
        autoFraud: ctx.fraudOrderIds.has(o.orderId),
        manualFraud: !!(mark && mark.isFraud),
        manualFraudBy: mark && mark.isFraud ? (mark.markedByName || null) : null,
        manualFraudAt: mark && mark.isFraud ? (mark.at || null) : null,
      };
    });
  }

  return jsonResponse(res, 200, {
    ok: true,
    total: all.length,
    items,
  });
}

// ───────────── /wb/graph — экспериментальный граф связей ─────────────
// Узлы: client / driver / franch. Рёбра: client–driver (вес = совместные
// заказы), driver–franch (заказы), driver–driver через общих клиентов
// (только при depth=2). focus задаётся как "client:ID"/"driver:ID"/"franch:ID";
// без focus — берём топ-связанные пары как seed.
async function handleWbGraph(req, res) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  const url = new URL(req.url, `http://${req.headers.host || "x"}`);
  const range = _parseTimeRange(url);
  const focus = String(url.searchParams.get("focus") || "").trim();
  const depth = Math.min(
    2,
    Math.max(1, Number(url.searchParams.get("depth")) || 1),
  );
  const minWeight = Math.max(
    1,
    Number(url.searchParams.get("minWeight")) || 1,
  );
  const includeFranchs = url.searchParams.get("includeFranchs") !== "0";
  const limit = Math.min(
    600,
    Math.max(20, Number(url.searchParams.get("limit")) || 200),
  );

  let focusKind = null;
  let focusId = null;
  let focusKey = null;
  if (focus) {
    const m = focus.match(/^(client|driver|franch):(.+)$/);
    if (!m) return jsonResponse(res, 400, { ok: false, error: "bad_focus" });
    focusKind = m[1];
    focusId = m[2];
    focusKey = `${focusKind[0]}:${focusId}`;
  }

  const all = _filterByTimeRange(await loadWbAll(), range);

  // Агрегаты per-node и per-edge.
  const cdPair = new Map(); // "c:..|d:.." → {trips,gmv}
  const dfPair = new Map(); // "d:..|f:.." → {trips,gmv}
  const cStats = new Map(); // "c:.." → {trips,gmv,drivers:Set,franchs:Set}
  const dStats = new Map(); // "d:.." → {trips,gmv,clients:Set,franchs:Set}
  const fStats = new Map(); // "f:.." → {trips,gmv,clients:Set,drivers:Set}

  for (const o of all) {
    const cid = o.clientId ? `c:${o.clientId}` : null;
    const did = o.driverId && o.driverId !== "0" ? `d:${o.driverId}` : null;
    const fid = o.franchId ? `f:${o.franchId}` : null;
    const g = Number(o.gmv) || 0;
    const completed = o.status === "completed";
    if (cid) {
      let e = cStats.get(cid);
      if (!e) {
        e = { trips: 0, gmv: 0, drivers: new Set(), franchs: new Set() };
        cStats.set(cid, e);
      }
      e.trips++;
      if (completed) e.gmv += g;
      if (did) e.drivers.add(did);
      if (fid) e.franchs.add(fid);
    }
    if (did) {
      let e = dStats.get(did);
      if (!e) {
        e = { trips: 0, gmv: 0, clients: new Set(), franchs: new Set() };
        dStats.set(did, e);
      }
      e.trips++;
      if (completed) e.gmv += g;
      if (cid) e.clients.add(cid);
      if (fid) e.franchs.add(fid);
    }
    if (fid) {
      let e = fStats.get(fid);
      if (!e) {
        e = { trips: 0, gmv: 0, clients: new Set(), drivers: new Set() };
        fStats.set(fid, e);
      }
      e.trips++;
      if (completed) e.gmv += g;
      if (cid) e.clients.add(cid);
      if (did) e.drivers.add(did);
    }
    if (cid && did) {
      const k = `${cid}|${did}`;
      let e = cdPair.get(k);
      if (!e) {
        e = { trips: 0, gmv: 0 };
        cdPair.set(k, e);
      }
      e.trips++;
      if (completed) e.gmv += g;
    }
    if (did && fid) {
      const k = `${did}|${fid}`;
      let e = dfPair.get(k);
      if (!e) {
        e = { trips: 0, gmv: 0 };
        dfPair.set(k, e);
      }
      e.trips++;
      if (completed) e.gmv += g;
    }
  }

  // Seed nodes: focus или топ-N пар.
  const nodeIds = new Set();
  if (focusKey) {
    nodeIds.add(focusKey);
  } else {
    const seedPairs = [...cdPair.entries()]
      .filter(([, v]) => v.trips >= Math.max(minWeight, 2))
      .sort((a, b) => b[1].trips - a[1].trips)
      .slice(0, Math.max(20, Math.floor(limit / 4)));
    for (const [k] of seedPairs) {
      const [c, d] = k.split("|");
      nodeIds.add(c);
      nodeIds.add(d);
    }
  }

  // Раскрытие узла по правилам: client→drivers(+franchs), driver→clients(+franchs),
  // franch→drivers (от парка к клиентам не разворачиваем, чтобы не взорвать).
  const expand = (id) => {
    if (id.startsWith("c:")) {
      const e = cStats.get(id);
      if (!e) return;
      for (const did of e.drivers) {
        const w = (cdPair.get(`${id}|${did}`) || { trips: 0 }).trips;
        if (w >= minWeight) nodeIds.add(did);
      }
      if (includeFranchs) for (const fid of e.franchs) nodeIds.add(fid);
    } else if (id.startsWith("d:")) {
      const e = dStats.get(id);
      if (!e) return;
      for (const cid of e.clients) {
        const w = (cdPair.get(`${cid}|${id}`) || { trips: 0 }).trips;
        if (w >= minWeight) nodeIds.add(cid);
      }
      if (includeFranchs)
        for (const fid of e.franchs) {
          const w = (dfPair.get(`${id}|${fid}`) || { trips: 0 }).trips;
          if (w >= minWeight) nodeIds.add(fid);
        }
    } else if (id.startsWith("f:") && includeFranchs) {
      const e = fStats.get(id);
      if (!e) return;
      for (const did of e.drivers) {
        const w = (dfPair.get(`${did}|${id}`) || { trips: 0 }).trips;
        if (w >= minWeight) nodeIds.add(did);
      }
    }
  };

  // BFS на depth уровней.
  let frontier = new Set(nodeIds);
  for (let lvl = 0; lvl < depth; lvl++) {
    const before = new Set(nodeIds);
    for (const id of frontier) expand(id);
    frontier = new Set([...nodeIds].filter((x) => !before.has(x)));
    if (frontier.size === 0) break;
  }

  // Cap по limit: сохраняем focus + топ по trips.
  const scoreOf = (id) => {
    if (focusKey && id === focusKey) return Number.POSITIVE_INFINITY;
    if (id.startsWith("c:")) return cStats.get(id)?.trips || 0;
    if (id.startsWith("d:")) return dStats.get(id)?.trips || 0;
    if (id.startsWith("f:")) return fStats.get(id)?.trips || 0;
    return 0;
  };
  let truncated = false;
  if (nodeIds.size > limit) {
    truncated = true;
    const kept = [...nodeIds]
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, limit);
    nodeIds.clear();
    for (const id of kept) nodeIds.add(id);
  }

  // Узлы.
  const nodes = [];
  for (const id of nodeIds) {
    const kind =
      id[0] === "c" ? "client" : id[0] === "d" ? "driver" : "franch";
    const rawId = id.slice(2);
    let trips = 0;
    let gmv = 0;
    if (kind === "client") {
      const e = cStats.get(id);
      trips = e?.trips || 0;
      gmv = e?.gmv || 0;
    } else if (kind === "driver") {
      const e = dStats.get(id);
      trips = e?.trips || 0;
      gmv = e?.gmv || 0;
    } else {
      const e = fStats.get(id);
      trips = e?.trips || 0;
      gmv = e?.gmv || 0;
    }
    nodes.push({
      id,
      kind,
      label: rawId,
      trips,
      gmv: Math.round(gmv * 100) / 100,
      role: focusKey && id === focusKey ? "focus" : "neighbor",
    });
  }

  // Рёбра — только между выжившими узлами.
  const edges = [];
  const has = (id) => nodeIds.has(id);
  for (const [k, v] of cdPair) {
    if (v.trips < minWeight) continue;
    const [c, d] = k.split("|");
    if (!has(c) || !has(d)) continue;
    edges.push({
      source: c,
      target: d,
      kind: "client-driver",
      weight: v.trips,
      gmv: Math.round(v.gmv * 100) / 100,
    });
  }
  if (includeFranchs) {
    for (const [k, v] of dfPair) {
      if (v.trips < minWeight) continue;
      const [d, f] = k.split("|");
      if (!has(d) || !has(f)) continue;
      edges.push({
        source: d,
        target: f,
        kind: "driver-franch",
        weight: v.trips,
        gmv: Math.round(v.gmv * 100) / 100,
      });
    }
  }
  // depth=2: добавляем driver-driver рёбра через общих клиентов
  // (вес = число общих клиентов в выживших узлах). Заранее фильтруем
  // соседей по nodeIds — без этого получаем O(N²) при крупных клиентах.
  if (depth >= 2) {
    const driverSet = new Set(
      [...nodeIds].filter((x) => x.startsWith("d:")),
    );
    const ddPair = new Map();
    for (const did of driverSet) {
      const ds = dStats.get(did);
      if (!ds) continue;
      for (const cid of ds.clients) {
        if (!nodeIds.has(cid)) continue;
        const cs = cStats.get(cid);
        if (!cs) continue;
        for (const did2 of cs.drivers) {
          if (did2 === did) continue;
          if (!driverSet.has(did2)) continue;
          const k = did < did2 ? `${did}||${did2}` : `${did2}||${did}`;
          ddPair.set(k, (ddPair.get(k) || 0) + 1);
        }
      }
    }
    for (const [k, w] of ddPair) {
      if (w < minWeight) continue;
      const [d1, d2] = k.split("||");
      edges.push({
        source: d1,
        target: d2,
        kind: "driver-driver",
        weight: w,
        gmv: 0,
      });
    }
  }

  // Если фокус задан, но самой сущности нет в данных за период — сообщаем.
  let focusFound = true;
  if (focusKey) {
    const fk = focusKey;
    focusFound =
      (fk.startsWith("c:") && cStats.has(fk)) ||
      (fk.startsWith("d:") && dStats.has(fk)) ||
      (fk.startsWith("f:") && fStats.has(fk));
  }

  return jsonResponse(res, 200, {
    ok: true,
    focus: focus || null,
    focusFound,
    nodes,
    edges,
    stats: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      truncated,
    },
  });
}

// ───────── /wb/graph/analyze — Gemini-разбор графа связей ─────────
// Принимает { nodes, edges, period?, focus? } (то, что ровно вернул /wb/graph),
// вытаскивает компактное саммари в текст и отправляет в Gemini с промптом:
// «найди подозрительные паттерны: hub-водители с аномально многими клиентами,
// клиенты с одним и тем же водителем (возможный самозаказ), тесные подграфы
// (общие клиенты между водителями = признак сговора), изолированные кластеры».
// Ответ возвращается как JSON: { summary, findings: [{type, severity, nodeIds, …}] }.
async function handleWbGraphAnalyze(req, res) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  if (!GOOGLE_API_KEY) {
    return jsonResponse(res, 503, {
      ok: false,
      error: "no_api_key",
      hint: "GOOGLE_API_KEY не задан в /etc/rwbtaxi-calib.env",
    });
  }
  let body;
  try {
    body = await readJsonBody(req, 256 * 1024); // до 256 KB на payload графа
  } catch {
    return jsonResponse(res, 400, { ok: false, error: "bad_json" });
  }
  const nodes = Array.isArray(body?.nodes) ? body.nodes : null;
  const edges = Array.isArray(body?.edges) ? body.edges : null;
  if (!nodes || !edges) {
    return jsonResponse(res, 400, { ok: false, error: "bad_payload" });
  }
  if (nodes.length === 0) {
    return jsonResponse(res, 400, { ok: false, error: "empty_graph" });
  }
  if (nodes.length > 800 || edges.length > 2000) {
    return jsonResponse(res, 400, {
      ok: false,
      error: "graph_too_large",
      hint: "уменьшите limit или сузьте фокус",
    });
  }

  // ── Rate limit. Per-token (на хэше bearer) и глобальный, чтобы утёкший
  // токен или баг в UI не разорил счётчик Gemini. Per-token щедрый — UI
  // обычно делает ~1 запрос за просмотр; global — твёрдый кап на день.
  const authHeader = String(req.headers.authorization || "");
  const tokenSig = authHeader
    ? "tok:" + _cheapHash(authHeader.slice(0, 256))
    : "anon:" + (req.socket?.remoteAddress || "x");
  const perToken = _rateConsume(tokenSig, 6, 60); // 6/min, 60/day
  if (!perToken.ok) {
    res.setHeader("Retry-After", String(perToken.retryAfterSec));
    return jsonResponse(res, 429, {
      ok: false,
      error: "rate_limited",
      scope: perToken.scope,
      retryAfterSec: perToken.retryAfterSec,
    });
  }
  const global = _rateConsume("__global__", 30, 500); // 30/min, 500/day
  if (!global.ok) {
    res.setHeader("Retry-After", String(global.retryAfterSec));
    return jsonResponse(res, 429, {
      ok: false,
      error: "rate_limited_global",
      scope: global.scope,
      retryAfterSec: global.retryAfterSec,
    });
  }

  const period = String(body?.period || "").slice(0, 80);
  const focus = String(body?.focus || "").slice(0, 80);

  // Компактное представление: только нужные поля. Это сильно режет токены.
  const compactNodes = nodes.map((n) => ({
    id: String(n.id || ""),
    k: n.kind === "client" ? "c" : n.kind === "driver" ? "d" : "f",
    t: Number(n.trips) || 0,
    g: Math.round(Number(n.gmv) || 0),
  }));
  const compactEdges = edges.map((e) => ({
    a: String(e.source || e.from || ""),
    b: String(e.target || e.to || ""),
    k:
      e.kind === "client-driver"
        ? "cd"
        : e.kind === "driver-franch"
          ? "df"
          : "dd",
    w: Number(e.weight) || 0,
    g: Math.round(Number(e.gmv) || 0),
  }));

  // Краткая статистика — вшиваем в промпт, чтобы модель видела «масштаб».
  const stats = {
    nodes: { total: compactNodes.length },
    byKind: { c: 0, d: 0, f: 0 },
    edges: { total: compactEdges.length, cd: 0, df: 0, dd: 0 },
  };
  for (const n of compactNodes) stats.byKind[n.k] = (stats.byKind[n.k] || 0) + 1;
  for (const e of compactEdges) stats.edges[e.k] = (stats.edges[e.k] || 0) + 1;

  // Кэш: один и тот же payload в течение 30 минут не дёргает Gemini заново.
  // Канонизируем порядок (sort) перед хэшированием — иначе фронт, отдающий
  // те же узлы в другом порядке, мимо кэша попадает.
  const cacheNodes = [...compactNodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cacheEdges = [...compactEdges]
    .map((e) => (e.a <= e.b ? e : { ...e, a: e.b, b: e.a }))
    .sort((x, y) => {
      if (x.a !== y.a) return x.a < y.a ? -1 : 1;
      if (x.b !== y.b) return x.b < y.b ? -1 : 1;
      return x.k < y.k ? -1 : x.k > y.k ? 1 : 0;
    });
  const cacheKey = _cheapHash(
    JSON.stringify({ period, focus, n: cacheNodes, e: cacheEdges }),
  );
  const cached = _graphAnalyzeCache.get(cacheKey);
  if (cached && Date.now() - cached.at < GRAPH_ANALYZE_CACHE_MS) {
    return jsonResponse(res, 200, { ...cached.payload, cached: true });
  }

  const system = [
    "Ты — антифрод-аналитик в данных таксопарка.",
    "На входе — граф связей между клиентами (c:ID), водителями (d:ID) и парками-франчайзи (f:ID) за указанный период.",
    "Рёбра: cd — клиент↔водитель (вес = совместных поездок), df — водитель↔парк, dd — водитель↔водитель (через общих клиентов).",
    "Задача: найти ПОДОЗРИТЕЛЬНЫЕ паттерны, не описывать тривиальное.",
    "Возвращай ТОЛЬКО JSON по схеме (никакого markdown, никаких \"```\").",
  ].join(" ");

  const user = [
    `Период: ${period || "не указан"}.`,
    focus ? `Фокус: ${focus}.` : "Фокус не задан — общий обзор.",
    `Размер графа: ${stats.nodes.total} узлов (клиентов=${stats.byKind.c}, водителей=${stats.byKind.d}, парков=${stats.byKind.f}), ${stats.edges.total} рёбер (cd=${stats.edges.cd}, df=${stats.edges.df}, dd=${stats.edges.dd}).`,
    "",
    "ИЩИ паттерны (приведи 3–8 самых сильных, не больше):",
    "1) hub-водитель: один водитель с непропорционально большим числом клиентов и/или поездок относительно других в графе.",
    "2) сговор водителей: группа из 2–6 водителей с заметным числом ОБЩИХ клиентов (видно через рёбра dd с большим w).",
    "3) самозаказ: клиент, у которого 90%+ поездок приходится на 1–2 водителей, при этом общее число поездок > 5.",
    "4) изолированный кластер: подграф из 3+ узлов, слабо связанный с остальной сетью.",
    "5) аномалия GMV: связка с резко высоким средним чеком на поездку (g/w >> медианы).",
    "",
    "Для каждого finding верни: type (один из 'hub_driver','collusion','self_order','isolated_cluster','gmv_outlier'), severity (1–5, где 5 — самый подозрительный), nodeIds (массив id из графа, до 8 шт.), explanation (1–2 предложения по-русски с конкретными числами).",
    "В summary дай 1–3 предложения общего вывода по-русски.",
    "",
    "Граф (JSON):",
    JSON.stringify({ nodes: compactNodes, edges: compactEdges }),
  ].join("\n");

  const schema = {
    type: "object",
    properties: {
      summary: { type: "string" },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            severity: { type: "integer" },
            nodeIds: { type: "array", items: { type: "string" } },
            explanation: { type: "string" },
          },
          required: ["type", "severity", "nodeIds", "explanation"],
        },
      },
    },
    required: ["summary", "findings"],
  };

  const t0 = Date.now();
  const r = await geminiAnalyzeJson({ system, user, schema, timeoutMs: 30_000 });
  const ms = Date.now() - t0;

  if (!r.ok) {
    console.warn(
      `[graph/analyze] gemini failed in ${ms}ms: ${r.error} (nodes=${nodes.length}, edges=${edges.length})`,
    );
    return jsonResponse(res, 502, {
      ok: false,
      error: "gemini_failed",
      detail: r.error,
    });
  }

  // Чистим/нормализуем ответ — модель иногда возвращает severity как строку и т.п.
  const findings = Array.isArray(r.parsed?.findings)
    ? r.parsed.findings
        .map((f) => ({
          type: String(f?.type || "unknown"),
          severity: Math.max(1, Math.min(5, Math.round(Number(f?.severity) || 1))),
          nodeIds: Array.isArray(f?.nodeIds)
            ? f.nodeIds.map((x) => String(x)).slice(0, 12)
            : [],
          explanation: String(f?.explanation || ""),
        }))
        .filter((f) => f.explanation.length > 0)
        .slice(0, 12)
    : [];
  const summary = String(r.parsed?.summary || "").slice(0, 1200);

  const payload = {
    ok: true,
    model: r.model,
    elapsedMs: ms,
    tokens: r.tokens || null,
    stats,
    summary,
    findings,
    generatedAt: new Date().toISOString(),
  };
  _graphAnalyzeCache.set(cacheKey, { at: Date.now(), payload });
  // Простая защита от утечки памяти: больше 50 записей — выкидываем половину.
  if (_graphAnalyzeCache.size > 50) {
    const keys = [..._graphAnalyzeCache.keys()].slice(0, 25);
    for (const k of keys) _graphAnalyzeCache.delete(k);
  }
  console.log(
    `[graph/analyze] ok model=${r.model} ms=${ms} nodes=${nodes.length} edges=${edges.length} findings=${findings.length}`,
  );
  return jsonResponse(res, 200, payload);
}

async function handleWbPairs(req, res) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  const url = new URL(req.url, `http://${req.headers.host || "x"}`);
  const limit = Math.max(
    1,
    Math.min(200, Number(url.searchParams.get("limit")) || 50),
  );
  const range = _parseTimeRange(url);
  const all = _filterByTimeRange(await loadWbAll(), range);

  const byClient = new Map();
  for (const o of all) {
    if (!o.clientId) continue;
    if (!byClient.has(o.clientId)) {
      byClient.set(o.clientId, {
        clientId: o.clientId,
        total: 0,
        completed: 0,
        cancelled: 0,
        gmvSum: 0,
        drivers: new Set(),
      });
    }
    const e = byClient.get(o.clientId);
    e.total++;
    if (o.status === "completed") {
      e.completed++;
      e.gmvSum += o.gmv || 0;
    } else if (o.status === "cancelled") {
      e.cancelled++;
    }
    if (o.driverId && o.driverId !== "0") e.drivers.add(o.driverId);
  }
  const topClients = [...byClient.values()]
    .map((c) => ({
      clientId: c.clientId,
      total: c.total,
      completed: c.completed,
      cancelled: c.cancelled,
      gmvSum: Math.round(c.gmvSum * 100) / 100,
      uniqueDrivers: c.drivers.size,
      cancelRate: c.total ? c.cancelled / c.total : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);

  const byDriver = new Map();
  for (const o of all) {
    if (!o.driverId || o.driverId === "0") continue;
    if (!byDriver.has(o.driverId)) {
      byDriver.set(o.driverId, {
        driverId: o.driverId,
        total: 0,
        completed: 0,
        cancelled: 0,
        gmvSum: 0,
        clients: new Set(),
      });
    }
    const e = byDriver.get(o.driverId);
    e.total++;
    if (o.status === "completed") {
      e.completed++;
      e.gmvSum += o.gmv || 0;
    } else if (o.status === "cancelled") {
      e.cancelled++;
    }
    if (o.clientId) e.clients.add(o.clientId);
  }
  const topDrivers = [...byDriver.values()]
    .map((d) => ({
      driverId: d.driverId,
      total: d.total,
      completed: d.completed,
      cancelled: d.cancelled,
      gmvSum: Math.round(d.gmvSum * 100) / 100,
      uniqueClients: d.clients.size,
      cancelRate: d.total ? d.cancelled / d.total : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);

  const byPair = new Map();
  for (const o of all) {
    if (!o.driverId || o.driverId === "0" || !o.clientId) continue;
    const key = `${o.clientId}|${o.driverId}`;
    if (!byPair.has(key)) {
      byPair.set(key, {
        clientId: o.clientId,
        driverId: o.driverId,
        total: 0,
        completed: 0,
        cancelled: 0,
        gmvSum: 0,
      });
    }
    const e = byPair.get(key);
    e.total++;
    if (o.status === "completed") {
      e.completed++;
      e.gmvSum += o.gmv || 0;
    } else if (o.status === "cancelled") {
      e.cancelled++;
    }
  }
  const topPairs = [...byPair.values()]
    .filter((p) => p.total >= 2)
    .map((p) => ({ ...p, gmvSum: Math.round(p.gmvSum * 100) / 100 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);

  return jsonResponse(res, 200, {
    ok: true,
    topClients,
    topDrivers,
    topPairs,
  });
}

// ───────────── WB heatmap / drill-in / lists ─────────────

// извлечь час из createdAt типа "2026-04-01 14:23:51+00:00"
function _parseHour(s) {
  const h = parseInt(String(s || "").substr(11, 2), 10);
  return Number.isFinite(h) ? h : null;
}
// 0 = Mon, 6 = Sun (orderDate "2026-04-15")
function _parseWeekday(d) {
  if (!d) return null;
  const dt = new Date(d + "T00:00:00Z");
  if (isNaN(dt.getTime())) return null;
  const js = dt.getUTCDay(); // 0=Sun..6=Sat
  return (js + 6) % 7; // 0=Mon..6=Sun
}
// бины дистанций
const _DIST_BINS = [
  { from: 0, to: 2, label: "0–2 км" },
  { from: 2, to: 5, label: "2–5 км" },
  { from: 5, to: 10, label: "5–10 км" },
  { from: 10, to: 20, label: "10–20 км" },
  { from: 20, to: 50, label: "20–50 км" },
  { from: 50, to: Infinity, label: "50+ км" },
];
function _binDistance(km) {
  if (km == null || !Number.isFinite(km)) return -1;
  for (let i = 0; i < _DIST_BINS.length; i++) {
    if (km >= _DIST_BINS[i].from && km < _DIST_BINS[i].to) return i;
  }
  return -1;
}

async function handleWbHeatmap(req, res) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  const url = new URL(req.url, "http://localhost");
  const range = _parseTimeRange(url);
  const status = _parseStatusFilter(url);
  const all = _filterByStatus(
    _filterByTimeRange(await loadWbAll(), range),
    status,
  );

  // Матрица 7 (Mon..Sun) × 24 (час)
  const cells = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ total: 0, completed: 0, cancelled: 0, gmvSum: 0 })),
  );
  // По дням недели
  const byWeekday = Array.from({ length: 7 }, () => ({ total: 0, completed: 0, cancelled: 0, gmvSum: 0, kmSum: 0 }));
  // По часам (агрегат по всем дням). gmvList/ppkmList нужны для avg цен.
  const byHour = Array.from({ length: 24 }, () => ({
    total: 0, completed: 0, cancelled: 0, gmvSum: 0, kmSum: 0,
    gmvList: [], ppkmList: [],
  }));
  // По бинам дистанций
  const byDistance = _DIST_BINS.map((b) => ({
    label: b.label,
    from: b.from,
    to: b.to === Infinity ? null : b.to,
    total: 0,
    completed: 0,
    cancelled: 0,
    gmvSum: 0,
  }));

  // Гео-агрегация точек подачи (pickup): бакет ≈ 11м (4 знака после запятой).
  // Ключ "lat|lng".
  const pickupMap = new Map();
  let withCoords = 0;

  for (const o of all) {
    const w = _parseWeekday(o.orderDate);
    const h = _parseHour(o.createdAt);
    const isC = o.status === "completed";
    const isX = o.status === "cancelled";

    if (w !== null && h !== null) {
      const c = cells[w][h];
      c.total++;
      if (isC) { c.completed++; c.gmvSum += o.gmv || 0; }
      else if (isX) c.cancelled++;
    }
    if (w !== null) {
      const r = byWeekday[w];
      r.total++;
      if (isC) { r.completed++; r.gmvSum += o.gmv || 0; r.kmSum += o.km || 0; }
      else if (isX) r.cancelled++;
    }
    if (h !== null) {
      const r = byHour[h];
      r.total++;
      if (isC) {
        r.completed++;
        r.gmvSum += o.gmv || 0;
        r.kmSum += o.km || 0;
        if (o.gmv > 0) r.gmvList.push(o.gmv);
        if (o.gmv > 0 && o.km > 0) r.ppkmList.push(o.gmv / o.km);
      } else if (isX) r.cancelled++;
    }
    const di = _binDistance(o.km);
    if (di >= 0) {
      const r = byDistance[di];
      r.total++;
      if (isC) { r.completed++; r.gmvSum += o.gmv || 0; }
      else if (isX) r.cancelled++;
    }

    if (Number.isFinite(o.latIn) && Number.isFinite(o.lngIn)) {
      withCoords++;
      const lat = Math.round(o.latIn * 1e4) / 1e4;
      const lng = Math.round(o.lngIn * 1e4) / 1e4;
      const key = lat + "|" + lng;
      let p = pickupMap.get(key);
      if (!p) {
        p = { lat, lng, count: 0, completed: 0, cancelled: 0, gmvSum: 0, selfRideCount: 0 };
        pickupMap.set(key, p);
      }
      p.count++;
      if (isC) { p.completed++; p.gmvSum += o.gmv || 0; }
      else if (isX) p.cancelled++;
      if (_detectSelfRide(o) != null) p.selfRideCount++;
    }
  }

  // Сортируем точки по count desc — фронт может показать топ.
  // avgPrice = средняя сумма заказа в этой точке (только по completed).
  // selfRideCount = сколько заказов с подачей≈высадкой (возможные самозаказы).
  const pickup = [...pickupMap.values()]
    .map((p) => ({
      lat: p.lat,
      lng: p.lng,
      count: p.count,
      completed: p.completed,
      cancelled: p.cancelled,
      cancelRate: p.count ? p.cancelled / p.count : 0,
      gmvSum: Math.round(p.gmvSum * 100) / 100,
      avgPrice: p.completed > 0
        ? Math.round((p.gmvSum / p.completed) * 100) / 100
        : null,
      selfRideCount: p.selfRideCount,
    }))
    .sort((a, b) => b.count - a.count);

  return jsonResponse(res, 200, {
    ok: true,
    cells: cells.map((row) =>
      row.map((c) => ({
        total: c.total,
        completed: c.completed,
        cancelled: c.cancelled,
        cancelRate: c.total ? c.cancelled / c.total : 0,
        gmvSum: Math.round(c.gmvSum * 100) / 100,
      })),
    ),
    byWeekday: byWeekday.map((r, i) => ({
      weekday: i,
      total: r.total,
      completed: r.completed,
      cancelled: r.cancelled,
      cancelRate: r.total ? r.cancelled / r.total : 0,
      gmvSum: Math.round(r.gmvSum * 100) / 100,
      kmSum: Math.round(r.kmSum * 100) / 100,
    })),
    byHour: byHour.map((r, i) => ({
      hour: i,
      total: r.total,
      completed: r.completed,
      cancelled: r.cancelled,
      cancelRate: r.total ? r.cancelled / r.total : 0,
      gmvSum: Math.round(r.gmvSum * 100) / 100,
      kmSum: Math.round(r.kmSum * 100) / 100,
      avgGmv: r.gmvList.length
        ? Math.round((_avg(r.gmvList)) * 100) / 100
        : 0,
      medianGmv: r.gmvList.length
        ? Math.round((_med(r.gmvList)) * 100) / 100
        : 0,
      avgPricePerKm: r.ppkmList.length
        ? Math.round((_avg(r.ppkmList)) * 100) / 100
        : 0,
      medianPricePerKm: r.ppkmList.length
        ? Math.round((_med(r.ppkmList)) * 100) / 100
        : 0,
    })),
    byDistance: byDistance.map((r) => ({
      ...r,
      cancelRate: r.total ? r.cancelled / r.total : 0,
      gmvSum: Math.round(r.gmvSum * 100) / 100,
    })),
    geo: {
      pickup,
      buckets: pickup.length,
      withCoords,
      precision: 4,
    },
    meta: {
      total: all.length,
      withCoords,
      coverage: all.length ? withCoords / all.length : 0,
      status,
    },
  });
}

// Округление координат до сетки `gridM` метров (в Минске).
function _gridKey(lat, lng, gridM) {
  const stepLat = gridM / 111000;
  const stepLng = gridM / (111000 * Math.cos((53.9 * Math.PI) / 180));
  const ix = Math.round(lat / stepLat);
  const iy = Math.round(lng / stepLng);
  return `${ix},${iy}`;
}

// Топ повторяющихся маршрутов pickup→dropoff (только completed с координатами).
// Возвращает массив { count, pickupLat, pickupLng, dropoffLat, dropoffLng,
//   avgKm, avgGmv, kmSum, gmvSum, distM }, отсортированный по count desc.
function _topRoutes(orders, opts = {}) {
  const gridM = opts.gridM || 200;
  const limit = opts.limit || 12;
  const minCount = opts.minCount || 2;
  const m = new Map();
  for (const o of orders) {
    if (o.status !== "completed") continue;
    if (!Number.isFinite(o.latIn) || !Number.isFinite(o.lngIn)) continue;
    if (!Number.isFinite(o.latOut) || !Number.isFinite(o.lngOut)) continue;
    const k =
      _gridKey(o.latIn, o.lngIn, gridM) +
      "→" +
      _gridKey(o.latOut, o.lngOut, gridM);
    if (!m.has(k)) {
      m.set(k, {
        key: k,
        count: 0,
        gmvSum: 0,
        kmSum: 0,
        pickupLat: o.latIn,
        pickupLng: o.lngIn,
        dropoffLat: o.latOut,
        dropoffLng: o.lngOut,
      });
    }
    const r = m.get(k);
    r.count++;
    r.gmvSum += o.gmv || 0;
    r.kmSum += o.km || 0;
  }
  return [...m.values()]
    .filter((r) => r.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((r) => ({
      key: r.key,
      count: r.count,
      pickupLat: r.pickupLat,
      pickupLng: r.pickupLng,
      dropoffLat: r.dropoffLat,
      dropoffLng: r.dropoffLng,
      kmSum: Math.round(r.kmSum * 100) / 100,
      gmvSum: Math.round(r.gmvSum * 100) / 100,
      avgKm: r.count ? Math.round((r.kmSum / r.count) * 100) / 100 : 0,
      avgGmv: r.count ? Math.round((r.gmvSum / r.count) * 100) / 100 : 0,
      distM: Math.round(
        haversineKm(
          { lat: r.pickupLat, lng: r.pickupLng },
          { lat: r.dropoffLat, lng: r.dropoffLng },
        ) * 1000,
      ),
    }));
}

// Точки заказов для карты профиля. Берём только заказы с координатами подачи.
function _orderPoints(orders) {
  const out = [];
  for (const o of orders) {
    if (!Number.isFinite(o.latIn) || !Number.isFinite(o.lngIn)) continue;
    const sa = _detectSpeedAnomaly(o);
    out.push({
      orderId: o.orderId,
      clientId: o.clientId || null,
      driverId: o.driverId || null,
      status: o.status,
      latIn: o.latIn,
      lngIn: o.lngIn,
      latOut: Number.isFinite(o.latOut) ? o.latOut : null,
      lngOut: Number.isFinite(o.lngOut) ? o.lngOut : null,
      km: o.km != null ? o.km : null,
      gmv: o.gmv != null ? o.gmv : null,
      tripMin: o.tripMin != null ? o.tripMin : null,
      createdAt: o.createdAt || null,
      isSelfRide: _detectSelfRide(o) != null,
      speedAnomaly: sa ? sa.kind : null,
      // Обогащённые поля из CSV-импорта.
      driverName: o.driverName || null,
      autoNumber: o.autoNumber || null,
      autoId: o.autoId || null,
      paymentType: o.paymentType || null,
      paymentType2: o.paymentType2 || null,
      isSubsidy: o.paymentType2 === "6" || o.paymentType === "6",
      fta: o.fta != null ? o.fta : null,
      clientWait: o.clientWait != null ? o.clientWait : null,
      passengerPhone: o.passengerPhone || null,
    });
  }
  return out;
}

function _summarizeOrders(orders) {
  const completed = orders.filter((o) => o.status === "completed");
  const cancelled = orders.filter((o) => o.status === "cancelled");
  const km = completed.map((o) => o.km).filter((x) => x > 0);
  const tripMin = completed.map((o) => o.tripMin).filter((x) => x > 0);
  const gmv = completed.map((o) => o.gmv).filter((x) => x > 0);
  const dates = orders.map((o) => o.orderDate).filter(Boolean).sort();
  // Новые агрегации из обогащённых полей.
  const autos = new Set();
  let fastCancel = 0;
  let subsidyCount = 0;
  const ftaList = [];
  const waitList = [];
  for (const o of orders) {
    if (o.autoId && o.autoId !== "0") autos.add(o.autoId);
    if (o.status === "cancelled" && _isFastCancel(o)) fastCancel++;
    if (o.paymentType2 === "6" || o.paymentType === "6") subsidyCount++;
    if (o.fta != null && Number.isFinite(o.fta)) ftaList.push(o.fta);
    if (o.clientWait != null && Number.isFinite(o.clientWait)) waitList.push(o.clientWait);
  }
  return {
    total: orders.length,
    completed: completed.length,
    cancelled: cancelled.length,
    cancelRate: orders.length ? cancelled.length / orders.length : 0,
    gmvSum: Math.round(completed.reduce((s, o) => s + (o.gmv || 0), 0) * 100) / 100,
    avgKm: _avg(km),
    avgTripMin: _avg(tripMin),
    avgGmv: _avg(gmv),
    firstDate: dates[0] || null,
    lastDate: dates[dates.length - 1] || null,
    uniqueAutos: autos.size,
    fastCancelCount: fastCancel,
    subsidyCount,
    subsidyShare: orders.length ? subsidyCount / orders.length : 0,
    avgFta: _avg(ftaList),
    avgClientWait: _avg(waitList),
  };
}

// Быстрый отказ — отмена менее чем за 30 секунд после создания.
function _isFastCancel(o) {
  if (!o.createdAt || !o.cancelledAt) return false;
  const c = Date.parse(o.createdAt);
  const x = Date.parse(o.cancelledAt);
  if (!Number.isFinite(c) || !Number.isFinite(x)) return false;
  const diff = (x - c) / 1000;
  return diff > 0 && diff < 30;
}

function _activityByDay(orders) {
  const m = new Map();
  for (const o of orders) {
    const d = o.orderDate;
    if (!d) continue;
    if (!m.has(d)) m.set(d, { date: d, total: 0, completed: 0, cancelled: 0 });
    const r = m.get(d);
    r.total++;
    if (o.status === "completed") r.completed++;
    else if (o.status === "cancelled") r.cancelled++;
  }
  return [...m.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

function _activityByHour(orders) {
  const arr = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, completed: 0, cancelled: 0 }));
  for (const o of orders) {
    const h = _parseHour(o.createdAt);
    if (h === null) continue;
    arr[h].total++;
    if (o.status === "completed") arr[h].completed++;
    else if (o.status === "cancelled") arr[h].cancelled++;
  }
  return arr;
}

function _activityByWeekday(orders) {
  const arr = Array.from({ length: 7 }, (_, w) => ({ weekday: w, total: 0, completed: 0, cancelled: 0 }));
  for (const o of orders) {
    const w = _parseWeekday(o.orderDate);
    if (w === null) continue;
    arr[w].total++;
    if (o.status === "completed") arr[w].completed++;
    else if (o.status === "cancelled") arr[w].cancelled++;
  }
  return arr;
}

// Подтягиваем ФИО/телефон клиента из последнего заказа (где поле непусто).
function _identityClient(orders) {
  let name = null, phone = null;
  // последний заказ — последний по createdAt
  const sorted = [...orders].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
  for (const o of sorted) {
    if (!name && o.clientName) name = o.clientName;
    if (!phone && o.clientPhone) phone = o.clientPhone;
    if (name && phone) break;
  }
  return { name, phone };
}
// ФИО + телефон + текущая машина (последняя по времени) водителя.
function _identityDriver(orders) {
  let name = null, phone = null, autoNumber = null, autoId = null;
  // последний заказ — последний по createdAt
  const sorted = [...orders].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
  for (const o of sorted) {
    if (!name && o.driverName) name = o.driverName;
    if (!phone && o.driverPhone) phone = o.driverPhone;
    if (!autoNumber && o.autoNumber) autoNumber = o.autoNumber;
    if (!autoId && o.autoId && o.autoId !== "0") autoId = o.autoId;
    if (name && phone && autoNumber && autoId) break;
  }
  return { name, phone, autoNumber, autoId };
}

function _safeDecodeId(raw) {
  if (!raw) return null;
  let dec;
  try { dec = decodeURIComponent(raw); } catch { return null; }
  if (!dec || dec.length > 64) return null;
  if (!/^[A-Za-z0-9_\-]+$/.test(dec)) return null;
  return dec;
}

async function handleWbClient(req, res) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  const m = /^\/wb\/client\/([^/?]+)/.exec(req.url);
  const clientId = _safeDecodeId(m ? m[1] : "");
  if (!clientId) return jsonResponse(res, 400, { ok: false, error: "bad_id" });

  const all = await loadWbAll();
  const orders = all.filter((o) => String(o.clientId) === clientId);
  if (!orders.length) return jsonResponse(res, 404, { ok: false, error: "not_found" });

  const partnersMap = new Map();
  const partnerOrders = new Map(); // driverId → orders[]
  for (const o of orders) {
    const id = o.driverId;
    if (!id || id === "0") continue;
    if (!partnersMap.has(id)) {
      partnersMap.set(id, { driverId: id, total: 0, completed: 0, cancelled: 0, gmvSum: 0 });
      partnerOrders.set(id, []);
    }
    const r = partnersMap.get(id);
    r.total++;
    if (o.status === "completed") { r.completed++; r.gmvSum += o.gmv || 0; }
    else if (o.status === "cancelled") r.cancelled++;
    partnerOrders.get(id).push(o);
  }
  const partners = [...partnersMap.values()]
    .map((p) => {
      const ident = _identityDriver(partnerOrders.get(p.driverId) || []);
      return {
        ...p,
        gmvSum: Math.round(p.gmvSum * 100) / 100,
        cancelRate: p.total ? p.cancelled / p.total : 0,
        driverName: ident.name,
        driverPhone: ident.phone,
        autoNumber: ident.autoNumber,
        autoId: ident.autoId,
      };
    })
    .sort((a, b) => b.total - a.total);

  const sortedOrders = [...orders].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );

  const ident = _identityClient(orders);
  return jsonResponse(res, 200, {
    ok: true,
    kind: "client",
    id: clientId,
    identity: ident,
    summary: { ..._summarizeOrders(orders), uniquePartners: partners.length },
    partners,
    byDay: _activityByDay(orders),
    byHour: _activityByHour(orders),
    byWeekday: _activityByWeekday(orders),
    routes: _topRoutes(orders),
    points: _orderPoints(orders),
    orders: sortedOrders,
  });
}

async function handleWbDriver(req, res) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  const m = /^\/wb\/driver\/([^/?]+)/.exec(req.url);
  const driverId = _safeDecodeId(m ? m[1] : "");
  if (!driverId) return jsonResponse(res, 400, { ok: false, error: "bad_id" });

  const all = await loadWbAll();
  const orders = all.filter((o) => String(o.driverId) === driverId);
  if (!orders.length) return jsonResponse(res, 404, { ok: false, error: "not_found" });

  const partnersMap = new Map();
  const partnerOrders = new Map();
  for (const o of orders) {
    const id = o.clientId;
    if (!id) continue;
    if (!partnersMap.has(id)) {
      partnersMap.set(id, { clientId: id, total: 0, completed: 0, cancelled: 0, gmvSum: 0 });
      partnerOrders.set(id, []);
    }
    const r = partnersMap.get(id);
    r.total++;
    if (o.status === "completed") { r.completed++; r.gmvSum += o.gmv || 0; }
    else if (o.status === "cancelled") r.cancelled++;
    partnerOrders.get(id).push(o);
  }
  const partners = [...partnersMap.values()]
    .map((p) => {
      const ident = _identityClient(partnerOrders.get(p.clientId) || []);
      return {
        ...p,
        gmvSum: Math.round(p.gmvSum * 100) / 100,
        cancelRate: p.total ? p.cancelled / p.total : 0,
        clientName: ident.name,
        clientPhone: ident.phone,
      };
    })
    .sort((a, b) => b.total - a.total);

  // Список машин водителя (auto_sharing).
  const autosMap = new Map(); // autoId → { autoId, autoNumber, count }
  for (const o of orders) {
    if (!o.autoId || o.autoId === "0") continue;
    if (!autosMap.has(o.autoId)) {
      autosMap.set(o.autoId, { autoId: o.autoId, autoNumber: o.autoNumber || null, count: 0 });
    }
    autosMap.get(o.autoId).count++;
  }
  const autos = [...autosMap.values()].sort((a, b) => b.count - a.count);

  const sortedOrders = [...orders].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );

  const ident = _identityDriver(orders);

  // WB-методичка: сводка по новым fraud-сигналам для этого водителя.
  let phoneSelfCount = 0;
  let familyMatchCount = 0;
  let shortOrderCount = 0;
  let completedCount = 0;
  for (const o of orders) {
    if (_detectPhoneSelfOrder(o)) phoneSelfCount++;
    if (_detectFamilyMatch(o)) familyMatchCount++;
    if (o.status === "completed") completedCount++;
    if (_isShortOrder(o)) shortOrderCount++;
  }
  const wbFraudCounters = {
    phoneSelfOrders: phoneSelfCount,
    familyMatches: familyMatchCount,
    cashStreak: _maxCashStreak(orders),
    shortOrders: shortOrderCount,
    shortOrderShare: completedCount > 0 ? shortOrderCount / completedCount : 0,
  };

  return jsonResponse(res, 200, {
    ok: true,
    kind: "driver",
    id: driverId,
    identity: ident,
    summary: { ..._summarizeOrders(orders), uniquePartners: partners.length },
    wbFraudCounters,
    partners,
    autos,
    byDay: _activityByDay(orders),
    byHour: _activityByHour(orders),
    byWeekday: _activityByWeekday(orders),
    routes: _topRoutes(orders),
    points: _orderPoints(orders),
    orders: sortedOrders,
  });
}

// ───────────── /wb/franch/:id — карточка парка ─────────────
async function handleWbFranch(req, res) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  const m = /^\/wb\/franch\/([^/?]+)/.exec(req.url);
  const franchId = _safeDecodeId(m ? m[1] : "");
  if (!franchId) return jsonResponse(res, 400, { ok: false, error: "bad_id" });

  const all = await loadWbAll();
  const orders = all.filter((o) => String(o.franchId || "") === franchId);
  if (!orders.length) {
    return jsonResponse(res, 404, { ok: false, error: "not_found" });
  }

  // Агрегаты по водителям парка.
  const driverMap = new Map();
  for (const o of orders) {
    const id = o.driverId;
    if (!id || id === "0") continue;
    if (!driverMap.has(id)) {
      driverMap.set(id, {
        driverId: id,
        driverName: null,
        total: 0,
        completed: 0,
        cancelled: 0,
        gmvSum: 0,
        clients: new Set(),
      });
    }
    const r = driverMap.get(id);
    r.total++;
    if (o.status === "completed") {
      r.completed++;
      r.gmvSum += o.gmv || 0;
    } else if (o.status === "cancelled") r.cancelled++;
    if (o.clientId) r.clients.add(o.clientId);
    if (!r.driverName && o.driverName) r.driverName = o.driverName;
  }
  const topDrivers = [...driverMap.values()]
    .map((r) => ({
      driverId: r.driverId,
      driverName: r.driverName,
      total: r.total,
      completed: r.completed,
      cancelled: r.cancelled,
      cancelRate: r.total ? r.cancelled / r.total : 0,
      gmvSum: Math.round(r.gmvSum * 100) / 100,
      uniqueClients: r.clients.size,
    }))
    .sort((a, b) => b.total - a.total);

  // Агрегаты по клиентам парка.
  const clientMap = new Map();
  for (const o of orders) {
    const id = o.clientId;
    if (!id) continue;
    if (!clientMap.has(id)) {
      clientMap.set(id, {
        clientId: id,
        total: 0,
        completed: 0,
        cancelled: 0,
        gmvSum: 0,
        drivers: new Set(),
      });
    }
    const r = clientMap.get(id);
    r.total++;
    if (o.status === "completed") {
      r.completed++;
      r.gmvSum += o.gmv || 0;
    } else if (o.status === "cancelled") r.cancelled++;
    if (o.driverId && o.driverId !== "0") r.drivers.add(o.driverId);
  }
  const topClients = [...clientMap.values()]
    .map((r) => ({
      clientId: r.clientId,
      total: r.total,
      completed: r.completed,
      cancelled: r.cancelled,
      cancelRate: r.total ? r.cancelled / r.total : 0,
      gmvSum: Math.round(r.gmvSum * 100) / 100,
      uniqueDrivers: r.drivers.size,
    }))
    .sort((a, b) => b.total - a.total);

  const sortedOrders = [...orders].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );

  return jsonResponse(res, 200, {
    ok: true,
    kind: "franch",
    id: franchId,
    summary: {
      ..._summarizeOrders(orders),
      uniqueDrivers: driverMap.size,
      uniqueClients: clientMap.size,
    },
    topDrivers,
    topClients,
    byDay: _activityByDay(orders),
    byHour: _activityByHour(orders),
    byWeekday: _activityByWeekday(orders),
    orders: sortedOrders.slice(0, 200),
  });
}

async function handleWbPair(req, res) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  const m = /^\/wb\/pair\/([^/?]+)\/([^/?]+)/.exec(req.url);
  if (!m) return jsonResponse(res, 400, { ok: false, error: "bad_id" });
  const clientId = _safeDecodeId(m[1]);
  const driverId = _safeDecodeId(m[2]);
  if (!clientId || !driverId) {
    return jsonResponse(res, 400, { ok: false, error: "bad_id" });
  }

  const all = await loadWbAll();
  const orders = all.filter(
    (o) => String(o.clientId) === clientId && String(o.driverId) === driverId,
  );
  if (!orders.length) {
    return jsonResponse(res, 404, { ok: false, error: "not_found" });
  }

  // Считаем агрегаты для всего клиента и всего водителя — чтоб посчитать долю пары.
  const clientTotal = all.filter((o) => String(o.clientId) === clientId).length;
  const driverTotal = all.filter((o) => String(o.driverId) === driverId).length;

  const sortedOrders = [...orders].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );

  const clientIdent = _identityClient(orders);
  const driverIdent = _identityDriver(orders);
  return jsonResponse(res, 200, {
    ok: true,
    kind: "pair",
    clientId,
    driverId,
    clientIdentity: clientIdent,
    driverIdentity: driverIdent,
    // Для пары "уникальных партнёров" всегда 1 — это сама пара. Чтобы не ломать общий тип WbEntitySummary.
    summary: { ..._summarizeOrders(orders), uniquePartners: 1 },
    clientTotal,
    driverTotal,
    shareOfClient: clientTotal ? orders.length / clientTotal : 0,
    shareOfDriver: driverTotal ? orders.length / driverTotal : 0,
    byDay: _activityByDay(orders),
    byHour: _activityByHour(orders),
    byWeekday: _activityByWeekday(orders),
    routes: _topRoutes(orders, { minCount: 1 }),
    points: _orderPoints(orders),
    orders: sortedOrders,
  });
}

function _aggregateClients(all) {
  const m = new Map();
  for (const o of all) {
    if (!o.clientId) continue;
    if (!m.has(o.clientId)) {
      m.set(o.clientId, { clientId: o.clientId, total: 0, completed: 0, cancelled: 0, gmvSum: 0, kmSum: 0, drivers: new Set(), firstDate: null, lastDate: null });
    }
    const r = m.get(o.clientId);
    r.total++;
    if (o.status === "completed") { r.completed++; r.gmvSum += o.gmv || 0; r.kmSum += o.km || 0; }
    else if (o.status === "cancelled") r.cancelled++;
    if (o.driverId && o.driverId !== "0") r.drivers.add(o.driverId);
    if (o.orderDate) {
      if (!r.firstDate || o.orderDate < r.firstDate) r.firstDate = o.orderDate;
      if (!r.lastDate || o.orderDate > r.lastDate) r.lastDate = o.orderDate;
    }
  }
  return [...m.values()].map((r) => ({
    clientId: r.clientId,
    total: r.total,
    completed: r.completed,
    cancelled: r.cancelled,
    cancelRate: r.total ? r.cancelled / r.total : 0,
    gmvSum: Math.round(r.gmvSum * 100) / 100,
    kmSum: Math.round(r.kmSum * 100) / 100,
    uniqueDrivers: r.drivers.size,
    firstDate: r.firstDate,
    lastDate: r.lastDate,
  }));
}
function _aggregateDrivers(all) {
  const m = new Map();
  for (const o of all) {
    if (!o.driverId || o.driverId === "0") continue;
    if (!m.has(o.driverId)) {
      m.set(o.driverId, { driverId: o.driverId, total: 0, completed: 0, cancelled: 0, gmvSum: 0, kmSum: 0, clients: new Set(), firstDate: null, lastDate: null });
    }
    const r = m.get(o.driverId);
    r.total++;
    if (o.status === "completed") { r.completed++; r.gmvSum += o.gmv || 0; r.kmSum += o.km || 0; }
    else if (o.status === "cancelled") r.cancelled++;
    if (o.clientId) r.clients.add(o.clientId);
    if (o.orderDate) {
      if (!r.firstDate || o.orderDate < r.firstDate) r.firstDate = o.orderDate;
      if (!r.lastDate || o.orderDate > r.lastDate) r.lastDate = o.orderDate;
    }
  }
  return [...m.values()].map((r) => ({
    driverId: r.driverId,
    total: r.total,
    completed: r.completed,
    cancelled: r.cancelled,
    cancelRate: r.total ? r.cancelled / r.total : 0,
    gmvSum: Math.round(r.gmvSum * 100) / 100,
    kmSum: Math.round(r.kmSum * 100) / 100,
    uniqueClients: r.clients.size,
    firstDate: r.firstDate,
    lastDate: r.lastDate,
  }));
}

function _applyListFilters(items, url, partnerKey) {
  const minOrders = Math.max(0, Number(url.searchParams.get("minOrders")) || 0);
  const maxCancelRate = url.searchParams.get("maxCancelRate");
  const minCancelRate = url.searchParams.get("minCancelRate");
  const minGmv = Math.max(0, Number(url.searchParams.get("minGmv")) || 0);
  const search = String(url.searchParams.get("search") || "").trim();
  const sortBy = String(url.searchParams.get("sortBy") || "total");
  const order = String(url.searchParams.get("order") || "desc") === "asc" ? 1 : -1;
  const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get("limit")) || 200));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  let filtered = items;
  if (minOrders > 0) filtered = filtered.filter((x) => x.total >= minOrders);
  if (maxCancelRate !== null && maxCancelRate !== "") {
    const v = Number(maxCancelRate);
    if (Number.isFinite(v)) filtered = filtered.filter((x) => x.cancelRate <= v);
  }
  if (minCancelRate !== null && minCancelRate !== "") {
    const v = Number(minCancelRate);
    if (Number.isFinite(v)) filtered = filtered.filter((x) => x.cancelRate >= v);
  }
  if (minGmv > 0) filtered = filtered.filter((x) => x.gmvSum >= minGmv);
  if (search) {
    const s = search.toLowerCase();
    const k = partnerKey === "uniqueDrivers" ? "clientId" : "driverId";
    filtered = filtered.filter((x) => String(x[k] || "").toLowerCase().includes(s));
  }

  const allowedSort = new Set(["total", "completed", "cancelled", "cancelRate", "gmvSum", "kmSum", partnerKey, "firstDate", "lastDate"]);
  const sk = allowedSort.has(sortBy) ? sortBy : "total";
  filtered.sort((a, b) => {
    const av = a[sk], bv = b[sk];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return -1 * order;
    if (av > bv) return 1 * order;
    return 0;
  });

  return {
    total: filtered.length,
    items: filtered.slice(offset, offset + limit),
  };
}

async function handleWbClientsList(req, res) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  const url = new URL(req.url, `http://${req.headers.host || "x"}`);
  const range = _parseTimeRange(url);
  const all = _filterByTimeRange(await loadWbAll(), range);
  const items = _aggregateClients(all);
  const out = _applyListFilters(items, url, "uniqueDrivers");
  return jsonResponse(res, 200, { ok: true, ...out });
}

async function handleWbDriversList(req, res) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  const url = new URL(req.url, `http://${req.headers.host || "x"}`);
  const range = _parseTimeRange(url);
  const all = _filterByTimeRange(await loadWbAll(), range);
  const items = _aggregateDrivers(all);
  const out = _applyListFilters(items, url, "uniqueClients");
  return jsonResponse(res, 200, { ok: true, ...out });
}

async function handleWbNewDrivers(req, res) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  const url = new URL(req.url, `http://${req.headers.host || "x"}`);
  const range = _parseTimeRange(url);
  const all = await loadWbAll();

  const firstSeen = new Map();
  for (const o of all) {
    if (!o.driverId || o.driverId === "0" || !o.createdAt) continue;
    const t = Date.parse(o.createdAt);
    if (!Number.isFinite(t)) continue;
    const cur = firstSeen.get(o.driverId);
    if (!cur || t < cur.firstMs) {
      firstSeen.set(o.driverId, { firstMs: t, firstIso: o.createdAt });
    }
  }

  const newIds = new Set();
  const hasFrom = Number.isFinite(range.fromMs);
  const hasTo = Number.isFinite(range.toMs);
  for (const [did, fs] of firstSeen.entries()) {
    if (hasFrom && fs.firstMs < range.fromMs) continue;
    if (hasTo && fs.firstMs >= range.toMs) continue;
    newIds.add(did);
  }

  const byDriver = new Map();
  for (const o of all) {
    if (!o.driverId || !newIds.has(o.driverId)) continue;
    if (!byDriver.has(o.driverId)) {
      byDriver.set(o.driverId, {
        driverId: o.driverId,
        total: 0, completed: 0, cancelled: 0, open: 0,
        gmvSum: 0, kmSum: 0, ftaSum: 0, ftaCount: 0,
        clients: new Map(), ppks: [], speeds: [],
      });
    }
    const r = byDriver.get(o.driverId);
    r.total++;
    if (o.status === "completed") {
      r.completed++;
      r.gmvSum += o.gmv || 0;
      r.kmSum += o.km || 0;
      if (o.km > 0 && o.gmv > 0) r.ppks.push(o.gmv / o.km);
      if (o.km > 0 && o.tripMin > 0) {
        const sp = (o.km / o.tripMin) * 60;
        if (sp > 0 && sp < 200) r.speeds.push(sp);
      }
    } else if (o.status === "cancelled") {
      r.cancelled++;
    } else {
      r.open++;
    }
    if (o.fta != null && Number.isFinite(o.fta) && o.fta > 0 && o.fta < 60) {
      r.ftaSum += o.fta;
      r.ftaCount++;
    }
    if (o.clientId) {
      r.clients.set(o.clientId, (r.clients.get(o.clientId) || 0) + 1);
    }
  }

  const allCompleted = all.filter(
    (o) => o.status === "completed" && o.gmv > 0 && o.km > 0,
  );
  const allPpkSorted = allCompleted.map((o) => o.gmv / o.km).sort((a, b) => a - b);
  const ppkP95 = _quantile(allPpkSorted, 0.95);
  const allCancelRates = (() => {
    const m = new Map();
    for (const o of all) {
      if (!o.driverId || o.driverId === "0") continue;
      if (!m.has(o.driverId)) m.set(o.driverId, { t: 0, c: 0 });
      const r = m.get(o.driverId);
      r.t++;
      if (o.status === "cancelled") r.c++;
    }
    const arr = [];
    for (const r of m.values()) if (r.t >= 5) arr.push(r.c / r.t);
    arr.sort((a, b) => a - b);
    return arr;
  })();
  const cancelP90 = _quantile(allCancelRates, 0.9);

  const items = [];
  for (const r of byDriver.values()) {
    let topPartner = null;
    for (const [cid, count] of r.clients.entries()) {
      if (!topPartner || count > topPartner.count) topPartner = { clientId: cid, count };
    }
    const loyaltyShare = topPartner && r.total > 0 ? topPartner.count / r.total : 0;
    const cancelRate = r.total ? r.cancelled / r.total : 0;
    const avgPpk = r.ppks.length ? r.ppks.reduce((a, b) => a + b, 0) / r.ppks.length : null;
    const avgFta = r.ftaCount ? r.ftaSum / r.ftaCount : null;
    const avgSpeed = r.speeds.length ? r.speeds.reduce((a, b) => a + b, 0) / r.speeds.length : null;

    let score = 0;
    const reasons = [];

    if (r.total >= 3) {
      if (cancelRate >= 0.7) {
        score += 5;
        reasons.push({ severity: "high", label: `Отмен ${(cancelRate * 100).toFixed(0)}% — критично для новичка` });
      } else if (cancelRate >= 0.5) {
        score += 3;
        reasons.push({ severity: "med", label: `Отмен ${(cancelRate * 100).toFixed(0)}% — выше нормы` });
      } else if (cancelP90 > 0 && cancelRate >= cancelP90) {
        score += 2;
        reasons.push({ severity: "med", label: `Отмен ${(cancelRate * 100).toFixed(0)}% — в топ‑10% по парку` });
      }

      if (loyaltyShare >= 0.7 && topPartner) {
        score += 5;
        reasons.push({ severity: "high", label: `${(loyaltyShare * 100).toFixed(0)}% заказов с одним клиентом ${topPartner.clientId}` });
      } else if (loyaltyShare >= 0.5 && topPartner) {
        score += 3;
        reasons.push({ severity: "med", label: `${(loyaltyShare * 100).toFixed(0)}% заказов с одним клиентом ${topPartner.clientId}` });
      }

      if (avgPpk != null && ppkP95 > 0 && avgPpk >= ppkP95) {
        score += 2;
        reasons.push({ severity: "med", label: `Ставка ${avgPpk.toFixed(2)} BYN/км ≥ p95 рынка (${ppkP95.toFixed(2)})` });
      }

      if (avgFta != null && avgFta >= 25) {
        score += 1;
        reasons.push({ severity: "low", label: `Подача ${avgFta.toFixed(0)} мин — высокая` });
      }

      if (avgSpeed != null && (avgSpeed > 80 || avgSpeed < 8)) {
        score += 1;
        reasons.push({ severity: "low", label: `Средняя скорость ${avgSpeed.toFixed(0)} км/ч — нереалистично` });
      }
    }

    if (r.total >= 5 && cancelRate === 1) {
      score += 3;
      reasons.push({ severity: "critical", label: "100% отмен — никаких выполненных" });
    }

    const severity = score === 0 ? "clean" : _severityOf(score);
    items.push({
      driverId: r.driverId,
      firstSeenAt: firstSeen.get(r.driverId).firstIso,
      total: r.total,
      completed: r.completed,
      cancelled: r.cancelled,
      open: r.open,
      cancelRate,
      gmvSum: Math.round(r.gmvSum * 100) / 100,
      kmSum: Math.round(r.kmSum * 100) / 100,
      avgPpk: avgPpk != null ? Math.round(avgPpk * 100) / 100 : null,
      avgFta: avgFta != null ? Math.round(avgFta * 10) / 10 : null,
      avgSpeed: avgSpeed != null ? Math.round(avgSpeed * 10) / 10 : null,
      uniqueClients: r.clients.size,
      topPartner: topPartner
        ? { clientId: topPartner.clientId, count: topPartner.count, share: loyaltyShare }
        : null,
      score,
      severity,
      reasons,
    });
  }

  items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.total !== a.total) return b.total - a.total;
    if (a.firstSeenAt < b.firstSeenAt) return -1;
    if (a.firstSeenAt > b.firstSeenAt) return 1;
    return 0;
  });

  return jsonResponse(res, 200, {
    ok: true,
    from: hasFrom ? new Date(range.fromMs).toISOString() : null,
    to: hasTo ? new Date(range.toMs).toISOString() : null,
    totalNew: items.length,
    thresholds: {
      ppkP95: Math.round(ppkP95 * 100) / 100,
      cancelP90: Math.round(cancelP90 * 1000) / 1000,
    },
    items,
  });
}

// ───────────── /wb/timeline — bucketed counts per time bucket ─────────────
const TIMELINE_BUCKETS = {
  "10m": 10 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
};
const TIMELINE_MAX_BUCKETS = 5000;

async function handleWbTimeline(req, res) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  const url = new URL(req.url, `http://${req.headers.host || "x"}`);
  const bucketRaw = String(url.searchParams.get("bucket") || "1h").toLowerCase();
  const bucket = TIMELINE_BUCKETS[bucketRaw] ? bucketRaw : "1h";
  const bucketMs = TIMELINE_BUCKETS[bucket];
  const fromTs = String(url.searchParams.get("fromTs") || "");
  const toTs = String(url.searchParams.get("toTs") || "");
  const fromMs = fromTs ? Date.parse(fromTs) : NaN;
  const toMs = toTs ? Date.parse(toTs) : NaN;

  const all = await loadWbAll();

  let minT = Infinity;
  let maxT = -Infinity;
  const accepted = [];
  for (const o of all) {
    if (!o.createdAt) continue;
    const t = Date.parse(o.createdAt);
    if (!Number.isFinite(t)) continue;
    if (Number.isFinite(fromMs) && t < fromMs) continue;
    if (Number.isFinite(toMs) && t >= toMs) continue;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
    accepted.push({ t, status: o.status });
  }

  if (!Number.isFinite(minT) || !Number.isFinite(maxT)) {
    return jsonResponse(res, 200, {
      ok: true,
      bucket,
      bucketMs,
      from: null,
      to: null,
      total: 0,
      buckets: [],
    });
  }

  const startMs = Math.floor(minT / bucketMs) * bucketMs;
  const endMs = Math.floor(maxT / bucketMs) * bucketMs;
  const expectedBuckets = Math.floor((endMs - startMs) / bucketMs) + 1;
  if (expectedBuckets > TIMELINE_MAX_BUCKETS) {
    return jsonResponse(res, 400, {
      ok: false,
      error: "too_many_buckets",
      expectedBuckets,
      maxBuckets: TIMELINE_MAX_BUCKETS,
      hint: "Сократите диапазон или увеличьте размер бакета",
    });
  }

  const map = new Map();
  for (const a of accepted) {
    const key = Math.floor(a.t / bucketMs) * bucketMs;
    let agg = map.get(key);
    if (!agg) {
      agg = { total: 0, completed: 0, cancelled: 0, open: 0 };
      map.set(key, agg);
    }
    agg.total++;
    if (a.status === "completed") agg.completed++;
    else if (a.status === "cancelled") agg.cancelled++;
    else agg.open++;
  }

  const buckets = [];
  for (let ms = startMs; ms <= endMs; ms += bucketMs) {
    const agg = map.get(ms) || { total: 0, completed: 0, cancelled: 0, open: 0 };
    buckets.push({
      ts: new Date(ms).toISOString(),
      ms,
      ...agg,
    });
  }

  return jsonResponse(res, 200, {
    ok: true,
    bucket,
    bucketMs,
    from: new Date(startMs).toISOString(),
    to: new Date(endMs + bucketMs).toISOString(),
    total: accepted.length,
    buckets,
  });
}

// ───────────── /wb/fraud — rule-based scoring of suspicious activity ─────────────
function _parseTimeRange(url) {
  const fromTs = String(url.searchParams.get("fromTs") || "");
  const toTs = String(url.searchParams.get("toTs") || "");
  const fromMs = fromTs ? Date.parse(fromTs) : NaN;
  const toMs = toTs ? Date.parse(toTs) : NaN;
  return {
    fromMs,
    toMs,
    hasRange: Number.isFinite(fromMs) || Number.isFinite(toMs),
  };
}
function _filterByTimeRange(all, range) {
  if (!range || !range.hasRange) return all;
  const fromMs = range.fromMs;
  const toMs = range.toMs;
  const hasFrom = Number.isFinite(fromMs);
  const hasTo = Number.isFinite(toMs);
  return all.filter((o) => {
    if (!o.createdAt) return false;
    const t = Date.parse(o.createdAt);
    if (!Number.isFinite(t)) return false;
    if (hasFrom && t < fromMs) return false;
    if (hasTo && t >= toMs) return false;
    return true;
  });
}
// Допустимые значения: "all" (по умолчанию), "completed", "cancelled", "open".
function _parseStatusFilter(url) {
  const s = String(url.searchParams.get("status") || "all").toLowerCase();
  if (s === "completed" || s === "cancelled" || s === "open") return s;
  return "all";
}
function _filterByStatus(all, status) {
  if (!status || status === "all") return all;
  return all.filter((o) => o.status === status);
}

// Подача и высадка совпадают (или почти) → возможный самозаказ водителя.
// Возвращаем дистанцию в метрах, если подозрительно, иначе null.
const SELF_RIDE_KM = 0.3;
function _detectSelfRide(o) {
  if (!o || o.status !== "completed") return null;
  if (
    Number.isFinite(o.latIn) && Number.isFinite(o.lngIn) &&
    Number.isFinite(o.latOut) && Number.isFinite(o.lngOut)
  ) {
    const hKm = haversineKm(
      { lat: o.latIn, lng: o.lngIn },
      { lat: o.latOut, lng: o.lngOut },
    );
    if (hKm < SELF_RIDE_KM) return Math.round(hKm * 1000);
  }
  // Координат нет, но фактический пробег очень короткий — тоже флагуем.
  if (o.km != null && o.km > 0 && o.km < SELF_RIDE_KM) {
    return Math.round(o.km * 1000);
  }
  return null;
}

// Аномалия скорости: возвращает { kind, kmh } или null.
// kind ∈ {"fake_gps", "too_fast", "too_slow"}.
//   fake_gps  — выше любой реальной для города (>120 км/ч)
//   too_fast  — слишком быстро для Минска (>80 км/ч)
//   too_slow  — на длинной поездке скорость пешехода (<5 км/ч при km≥2)
// Учитываем только completed заказы с валидными km и tripMin.
const SPEED_FAKE_KMH = 120;
const SPEED_HIGH_KMH = 80;
const SPEED_SLOW_KMH = 5;
const SPEED_SLOW_MIN_KM = 2;
function _detectSpeedAnomaly(o) {
  if (!o || o.status !== "completed") return null;
  if (!(o.km > 0)) return null;
  if (!(o.tripMin > 0)) return null;
  // Если поездка совсем короткая (<300 м) — это уже самозаказ, скорость
  // тут считать смысла нет (артефакты округления).
  if (o.km < 0.3) return null;
  const hours = o.tripMin / 60;
  const kmh = o.km / hours;
  if (!Number.isFinite(kmh) || kmh <= 0) return null;
  if (kmh > SPEED_FAKE_KMH) return { kind: "fake_gps", kmh };
  if (kmh > SPEED_HIGH_KMH) return { kind: "too_fast", kmh };
  if (kmh < SPEED_SLOW_KMH && o.km >= SPEED_SLOW_MIN_KM) {
    return { kind: "too_slow", kmh };
  }
  return null;
}

// ───────────── WB-методичка: дополнительные fraud-детекторы ─────────────
// Нормализуем телефон до последних 9 цифр (национальный номер РБ без +375).
function _normPhone(p) {
  if (p == null) return null;
  const digits = String(p).replace(/\D/g, "");
  if (!digits) return null;
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

// Прямой самозаказ: телефон заказчика/пассажира совпадает с телефоном водителя.
// Это база антифрод-методички WB (формула =ЕСЛИ(B2=F2;1;0)).
function _detectPhoneSelfOrder(o) {
  if (!o) return null;
  const dp = _normPhone(o.driverPhone);
  if (!dp) return null;
  const cp = _normPhone(o.clientPhone);
  if (cp && cp === dp) return { phone: dp, matched: "client" };
  const pp = _normPhone(o.passengerPhone);
  if (pp && pp === dp) return { phone: dp, matched: "passenger" };
  return null;
}

// Берём последнее «слово» из ФИО как фамилию (мин. 3 символа).
function _surname(name) {
  if (!name) return null;
  const parts = String(name).trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const s = parts[parts.length - 1];
  return s.length >= 3 ? s : null;
}
// Расстояние Левенштейна с ранним выходом (нам важно только ≤1).
function _lev1(a, b) {
  if (a === b) return 0;
  if (!a || !b) return Math.max(a?.length || 0, b?.length || 0);
  if (Math.abs(a.length - b.length) > 1) return 2;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= n; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + c);
      if (dp[i][j] < rowMin) rowMin = dp[i][j];
    }
    if (rowMin > 1) return 2; // ранний выход
  }
  return dp[m][n];
}
// Совпадение фамилии заказчика и водителя (анкетная проверка из методички).
function _detectFamilyMatch(o) {
  if (!o) return null;
  const ds = _surname(o.driverName);
  if (!ds) return null;
  const cs = _surname(o.passengerName) || _surname(o.clientName);
  if (!cs) return null;
  const d = _lev1(ds, cs);
  if (d <= 1) return { driverSurname: ds, clientSurname: cs, distance: d };
  return null;
}

// Короткий заказ (≤2 км) — сигнал «выборочные заказы» из методички.
const SHORT_ORDER_KM = 2;
function _isShortOrder(o) {
  return !!(o && o.status === "completed" && o.km != null && o.km > 0 && o.km <= SHORT_ORDER_KM);
}

// Тип оплаты «наличные». В данных встречаются варианты "4", "cash", "нал…".
function _isCashPayment(o) {
  if (!o) return false;
  const p = String(o.paymentType ?? "").toLowerCase().trim();
  if (!p) return false;
  if (p === "4" || p === "cash" || p === "наличные" || p.startsWith("нал")) return true;
  return false;
}

// Максимальная серия наличных completed-заказов ПОДРЯД по времени
// (без non-cash completed-заказов между ними), в пределах одного рабочего дня.
// Семантика методички WB: «>3 наличных заказов в день подряд по времени».
// Сбросы:
//   1) встретился completed non-cash заказ → сброс серии до 0
//   2) серия растянулась > CASH_STREAK_DAY_MS → начинаем новый отсчёт с этого заказа
const CASH_STREAK_DAY_MS = 24 * 60 * 60 * 1000;
function _maxCashStreak(orders) {
  const seq = [];
  for (const o of orders) {
    if (o.status !== "completed" || !o.createdAt) continue;
    const t = Date.parse(o.createdAt);
    if (!Number.isFinite(t)) continue;
    seq.push({ t, cash: _isCashPayment(o) });
  }
  if (seq.length === 0) return 0;
  seq.sort((a, b) => a.t - b.t);
  let best = 0, cur = 0, runStart = 0;
  for (const x of seq) {
    if (!x.cash) { cur = 0; continue; }
    if (cur === 0) {
      runStart = x.t; cur = 1;
    } else if (x.t - runStart > CASH_STREAK_DAY_MS) {
      runStart = x.t; cur = 1;
    } else {
      cur++;
    }
    if (cur > best) best = cur;
  }
  return best;
}

function _quantile(sortedAsc, q) {
  if (!sortedAsc || sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.floor(q * sortedAsc.length)),
  );
  return sortedAsc[idx];
}
function _severityOf(score) {
  if (score >= 8) return "critical";
  if (score >= 6) return "high";
  if (score >= 3) return "med";
  return "low";
}
function _pushMap(map, key, val) {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  arr.push(val);
}

async function handleWbFraud(req, res) {
  if (!checkWbAuth(req)) {
    return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
  }
  const all = await loadWbAll();

  // ── 1. Group orders ──
  const byClient = new Map();
  const byDriver = new Map();
  const byPair = new Map();
  // selfRideMap: orderId → дистанция между подачей и высадкой в метрах.
  const selfRideMap = new Map();
  // speedAnomalyMap: orderId → { kind, kmh }.
  const speedAnomalyMap = new Map();
  // autoToDrivers: autoId → Set<driverId> — для сигнала auto_sharing.
  const autoToDrivers = new Map();
  // WB-методичка: orderId → { phone, matched } — самозаказ по телефону.
  const phoneSelfMap = new Map();
  // WB-методичка: orderId → { driverSurname, clientSurname, distance }.
  const familyMatchMap = new Map();
  // WB-методичка: orderId — короткий заказ (≤2 км).
  const shortOrderSet = new Set();
  for (const o of all) {
    if (o.clientId) _pushMap(byClient, o.clientId, o);
    if (o.driverId && o.driverId !== "0") _pushMap(byDriver, o.driverId, o);
    if (o.clientId && o.driverId && o.driverId !== "0") {
      _pushMap(byPair, `${o.clientId}|${o.driverId}`, o);
    }
    const dM = _detectSelfRide(o);
    if (dM != null && o.orderId) selfRideMap.set(o.orderId, dM);
    const sa = _detectSpeedAnomaly(o);
    if (sa && o.orderId) speedAnomalyMap.set(o.orderId, sa);
    if (o.autoId && o.autoId !== "0" && o.driverId && o.driverId !== "0") {
      if (!autoToDrivers.has(o.autoId)) autoToDrivers.set(o.autoId, new Set());
      autoToDrivers.get(o.autoId).add(o.driverId);
    }
    const ps = _detectPhoneSelfOrder(o);
    if (ps && o.orderId) phoneSelfMap.set(o.orderId, ps);
    const fm = _detectFamilyMatch(o);
    if (fm && o.orderId) familyMatchMap.set(o.orderId, fm);
    if (_isShortOrder(o) && o.orderId) shortOrderSet.add(o.orderId);
  }

  // ── 2. Global percentiles for per-km and fta ──
  const ppkSorted = all
    .filter((o) => o.status === "completed" && o.km > 0 && o.gmv > 0)
    .map((o) => o.gmv / o.km)
    .sort((a, b) => a - b);
  const ppkP95 = _quantile(ppkSorted, 0.95);
  const ppkP99 = _quantile(ppkSorted, 0.99);
  const ftaSorted = all
    .filter((o) => o.fta != null && Number.isFinite(o.fta) && o.fta >= 0)
    .map((o) => o.fta)
    .sort((a, b) => a - b);
  const ftaP95 = _quantile(ftaSorted, 0.95);

  // ── 3. Per-client rules (min 5 orders) ──
  const clients = [];
  for (const [cid, orders] of byClient) {
    if (orders.length < 5) continue;
    const reasons = [];
    let score = 0;
    const total = orders.length;
    const cancelled = orders.filter((o) => o.status === "cancelled").length;
    const cancelRate = cancelled / total;
    if (cancelRate >= 0.7) {
      reasons.push({
        code: "client_cancel_extreme",
        severity: "high",
        label: `Отмен ${(cancelRate * 100).toFixed(0)}% (${cancelled} из ${total}) — порог 70%`,
      });
      score += 5;
    } else if (cancelRate >= 0.5) {
      reasons.push({
        code: "client_cancel_high",
        severity: "med",
        label: `Отмен ${(cancelRate * 100).toFixed(0)}% (${cancelled} из ${total}) — порог 50%`,
      });
      score += 3;
    }
    // Loyalty
    const driverCounts = new Map();
    for (const o of orders) {
      if (o.driverId && o.driverId !== "0") {
        driverCounts.set(o.driverId, (driverCounts.get(o.driverId) || 0) + 1);
      }
    }
    let topPartner = null;
    for (const [d, c] of driverCounts) {
      if (!topPartner || c > topPartner.count) topPartner = { driverId: d, count: c };
    }
    if (topPartner) {
      const share = topPartner.count / total;
      topPartner.share = share;
      if (share >= 0.7) {
        reasons.push({
          code: "loyal_to_one_driver_extreme",
          severity: "high",
          label: `${(share * 100).toFixed(0)}% заказов с одним водителем ${topPartner.driverId} (${topPartner.count} из ${total})`,
        });
        score += 5;
      } else if (share >= 0.5) {
        reasons.push({
          code: "loyal_to_one_driver_high",
          severity: "med",
          label: `${(share * 100).toFixed(0)}% заказов с одним водителем ${topPartner.driverId} (${topPartner.count} из ${total})`,
        });
        score += 3;
      }
    }
    // Night dumper
    const nightCancels = orders.filter((o) => {
      if (o.status !== "cancelled") return false;
      const t = o.createdAt;
      if (!t || typeof t !== "string" || t.length < 13) return false;
      const h = parseInt(t.slice(11, 13), 10);
      return Number.isFinite(h) && h >= 0 && h <= 4;
    }).length;
    if (nightCancels >= 3) {
      reasons.push({
        code: "night_dumper",
        severity: "med",
        label: `${nightCancels} ночных отмен (00–04 UTC)`,
      });
      score += 2;
    }
    // Subsidy-abuse: высокая доля поездок с субсидией (CI) — может быть накрутка.
    const subsidies = orders.filter(
      (o) => o.paymentType2 === "6" || o.paymentType === "6",
    ).length;
    if (total >= 5 && subsidies / total >= 0.7) {
      reasons.push({
        code: "client_subsidy_abuse_extreme",
        severity: "high",
        label: `${(subsidies / total * 100).toFixed(0)}% заказов с субсидией (${subsidies} из ${total})`,
      });
      score += 4;
    } else if (total >= 5 && subsidies / total >= 0.5) {
      reasons.push({
        code: "client_subsidy_abuse_high",
        severity: "med",
        label: `${(subsidies / total * 100).toFixed(0)}% заказов с субсидией (${subsidies} из ${total})`,
      });
      score += 2;
    }
    if (score >= 3) {
      const ident = _identityClient(orders);
      clients.push({
        clientId: cid,
        clientName: ident.name,
        clientPhone: ident.phone,
        total,
        cancelled,
        cancelRate,
        topPartner,
        score,
        severity: _severityOf(score),
        reasons,
      });
    }
  }
  clients.sort((a, b) => b.score - a.score);

  // ── 4. Per-driver rules (min 10 orders) ──
  const drivers = [];
  for (const [did, orders] of byDriver) {
    if (orders.length < 10) continue;
    const reasons = [];
    let score = 0;
    const total = orders.length;
    const cancelled = orders.filter((o) => o.status === "cancelled").length;
    const cancelRate = cancelled / total;
    if (cancelRate >= 0.5) {
      reasons.push({
        code: "driver_cancel_extreme",
        severity: "high",
        label: `Отмен ${(cancelRate * 100).toFixed(0)}% (${cancelled} из ${total}) — порог 50%`,
      });
      score += 5;
    } else if (cancelRate >= 0.4) {
      reasons.push({
        code: "driver_cancel_high",
        severity: "med",
        label: `Отмен ${(cancelRate * 100).toFixed(0)}% (${cancelled} из ${total}) — порог 40%`,
      });
      score += 3;
    } else if (cancelRate >= 0.3) {
      reasons.push({
        code: "driver_cancel_med",
        severity: "low",
        label: `Отмен ${(cancelRate * 100).toFixed(0)}% (${cancelled} из ${total}) — выше среднего`,
      });
      score += 1;
    }
    // Loyalty
    const clientCounts = new Map();
    for (const o of orders) {
      if (o.clientId) {
        clientCounts.set(o.clientId, (clientCounts.get(o.clientId) || 0) + 1);
      }
    }
    let topPartner = null;
    for (const [c, n] of clientCounts) {
      if (!topPartner || n > topPartner.count) topPartner = { clientId: c, count: n };
    }
    if (topPartner) {
      const share = topPartner.count / total;
      topPartner.share = share;
      if (share >= 0.5) {
        reasons.push({
          code: "loyal_to_one_client_extreme",
          severity: "high",
          label: `${(share * 100).toFixed(0)}% заказов с одним клиентом ${topPartner.clientId} (${topPartner.count} из ${total})`,
        });
        score += 5;
      } else if (share >= 0.3) {
        reasons.push({
          code: "loyal_to_one_client_high",
          severity: "med",
          label: `${(share * 100).toFixed(0)}% заказов с одним клиентом ${topPartner.clientId} (${topPartner.count} из ${total})`,
        });
        score += 3;
      }
    }
    // Expensive per km
    const completed = orders.filter(
      (o) => o.status === "completed" && o.km > 0 && o.gmv > 0,
    );
    if (completed.length >= 5 && ppkP95 > 0) {
      const avgPpk =
        completed.reduce((s, o) => s + o.gmv / o.km, 0) / completed.length;
      if (avgPpk >= ppkP95) {
        reasons.push({
          code: "driver_expensive_per_km",
          severity: "med",
          label: `Средняя ставка ${avgPpk.toFixed(2)} BYN/км ≥ p95 рынка (${ppkP95.toFixed(2)})`,
        });
        score += 2;
      }
    }
    // Long FTA
    const ftaVals = orders
      .filter((o) => o.fta != null && Number.isFinite(o.fta))
      .map((o) => o.fta);
    if (ftaVals.length >= 5 && ftaP95 > 0) {
      const avgFta = ftaVals.reduce((s, v) => s + v, 0) / ftaVals.length;
      if (avgFta >= ftaP95) {
        reasons.push({
          code: "driver_long_fta",
          severity: "med",
          label: `Средняя подача ${avgFta.toFixed(0)} мин ≥ p95 (${ftaP95.toFixed(0)})`,
        });
        score += 2;
      }
    }
    // Self-ride pattern: много заказов где подача≈высадка.
    const selfRides = orders.filter((o) => selfRideMap.has(o.orderId)).length;
    if (selfRides >= 6) {
      reasons.push({
        code: "driver_self_ride_pattern_extreme",
        severity: "critical",
        label: `${selfRides} заказов с подачей≈высадкой — серийный самозаказ`,
      });
      score += 6;
    } else if (selfRides >= 3) {
      reasons.push({
        code: "driver_self_ride_pattern",
        severity: "high",
        label: `${selfRides} заказов с подачей≈высадкой — возможны самозаказы`,
      });
      score += 4;
    }
    // Speed-anomaly pattern: водитель регулярно даёт «странную» среднюю скорость.
    const fakeGps = orders.filter((o) => {
      const x = speedAnomalyMap.get(o.orderId);
      return x && x.kind === "fake_gps";
    }).length;
    const tooFast = orders.filter((o) => {
      const x = speedAnomalyMap.get(o.orderId);
      return x && x.kind === "too_fast";
    }).length;
    const tooSlow = orders.filter((o) => {
      const x = speedAnomalyMap.get(o.orderId);
      return x && x.kind === "too_slow";
    }).length;
    if (fakeGps >= 2) {
      reasons.push({
        code: "driver_fake_gps_pattern",
        severity: "critical",
        label: `${fakeGps} поездок со скоростью >120 км/ч — фейковый GPS?`,
      });
      score += 6;
    }
    if (fakeGps + tooFast >= 5) {
      reasons.push({
        code: "driver_speed_anomaly_pattern",
        severity: "high",
        label: `${fakeGps + tooFast} поездок с аномально высокой скоростью`,
      });
      score += 4;
    }
    if (tooSlow >= 5) {
      reasons.push({
        code: "driver_slow_trip_pattern",
        severity: "high",
        label: `${tooSlow} поездок искусственно растянуты по времени`,
      });
      score += 4;
    }
    // Fast-cancel pattern: доля отмен <30 сек после создания (выбор «жирных»
    // заказов). Считаем долю, чтобы не флагать водителей с большим объёмом
    // и редкими случайными быстрыми отменами. Минимум 3 случая для разумной
    // статистики и минимум 10 заказов всего.
    const fastCancels = orders.filter((o) =>
      o.status === "cancelled" && _isFastCancel(o),
    ).length;
    const fastCancelShare = total > 0 ? fastCancels / total : 0;
    if (total >= 10 && fastCancels >= 3 && fastCancelShare >= 0.2) {
      reasons.push({
        code: "driver_fast_cancel_pattern",
        severity: "high",
        label: `${fastCancels} отмен за <30 сек (${(fastCancelShare * 100).toFixed(0)}% заказов) — выбор «жирных» заказов`,
      });
      score += 4;
    } else if (total >= 10 && fastCancels >= 3 && fastCancelShare >= 0.1) {
      reasons.push({
        code: "driver_fast_cancel_med",
        severity: "med",
        label: `${fastCancels} отмен за <30 сек (${(fastCancelShare * 100).toFixed(0)}% заказов)`,
      });
      score += 2;
    }
    // Auto-sharing: водитель ездит на машине, на которой ездят и другие.
    const sharedAutos = [];
    for (const o of orders) {
      if (!o.autoId || o.autoId === "0") continue;
      const set = autoToDrivers.get(o.autoId);
      if (set && set.size > 1 && !sharedAutos.find((x) => x.autoId === o.autoId)) {
        sharedAutos.push({
          autoId: o.autoId,
          autoNumber: o.autoNumber || null,
          driverCount: set.size,
        });
      }
    }
    if (sharedAutos.length > 0) {
      const top = sharedAutos.sort((a, b) => b.driverCount - a.driverCount)[0];
      reasons.push({
        code: "auto_sharing",
        severity: top.driverCount >= 3 ? "high" : "med",
        label: `Машина ${top.autoNumber || top.autoId} — ${top.driverCount} разных водителей`,
        autoId: top.autoId,
        autoNumber: top.autoNumber,
        driverCount: top.driverCount,
      });
      score += top.driverCount >= 3 ? 4 : 2;
    }
    // ── WB-методичка: прямой самозаказ по телефону (=ЕСЛИ(B2=F2;1;0)). ──
    const phoneSelfOrders = orders.filter((o) => phoneSelfMap.has(o.orderId)).length;
    if (phoneSelfOrders >= 3) {
      reasons.push({
        code: "driver_phone_self_extreme",
        severity: "critical",
        label: `${phoneSelfOrders} заказов где телефон клиента = телефон водителя`,
      });
      score += 7;
    } else if (phoneSelfOrders >= 1) {
      reasons.push({
        code: "driver_phone_self",
        severity: "high",
        label: `${phoneSelfOrders} заказ(ов) где телефон клиента = телефон водителя`,
      });
      score += 4;
    }
    // ── WB-методичка: совпадение фамилии клиента и водителя (анкета). ──
    const familyMatches = orders.filter((o) => familyMatchMap.has(o.orderId)).length;
    if (familyMatches >= 3) {
      reasons.push({
        code: "driver_family_match_pattern",
        severity: "high",
        label: `${familyMatches} заказов с совпадающей фамилией клиент/водитель`,
      });
      score += 4;
    } else if (familyMatches >= 1) {
      reasons.push({
        code: "driver_family_match",
        severity: "med",
        label: `${familyMatches} заказ(ов) с совпадающей фамилией клиент/водитель`,
      });
      score += 2;
    }
    // ── WB-методичка: серия наличных заказов подряд (>3 за ≤6ч). ──
    const cashStreak = _maxCashStreak(orders);
    if (cashStreak >= 5) {
      reasons.push({
        code: "driver_cash_streak_extreme",
        severity: "high",
        label: `${cashStreak} наличных заказов подряд за день — серия`,
      });
      score += 4;
    } else if (cashStreak >= 4) {
      reasons.push({
        code: "driver_cash_streak",
        severity: "med",
        label: `${cashStreak} наличных заказов подряд за день`,
      });
      score += 2;
    }
    // ── WB-методичка: «выборочные заказы» — много коротких (≤2 км). ──
    const completedOrders = orders.filter((o) => o.status === "completed");
    const shortOrders = completedOrders.filter((o) => shortOrderSet.has(o.orderId)).length;
    const shortShare = completedOrders.length > 0 ? shortOrders / completedOrders.length : 0;
    if (completedOrders.length >= 10 && shortShare >= 0.5) {
      reasons.push({
        code: "driver_short_orders_extreme",
        severity: "high",
        label: `${shortOrders} коротких заказов ≤2км (${(shortShare * 100).toFixed(0)}% выполненных) — выборочные`,
      });
      score += 4;
    } else if (completedOrders.length >= 10 && shortShare >= 0.3) {
      reasons.push({
        code: "driver_short_orders",
        severity: "med",
        label: `${shortOrders} коротких заказов ≤2км (${(shortShare * 100).toFixed(0)}% выполненных)`,
      });
      score += 2;
    }
    if (score >= 3) {
      const ident = _identityDriver(orders);
      drivers.push({
        driverId: did,
        driverName: ident.name,
        driverPhone: ident.phone,
        autoNumber: ident.autoNumber,
        autoId: ident.autoId,
        total,
        cancelled,
        cancelRate,
        topPartner,
        score,
        severity: _severityOf(score),
        reasons,
      });
    }
  }
  drivers.sort((a, b) => b.score - a.score);

  // ── 5. Per-pair rules (min 3 joint orders) ──
  const pairs = [];
  for (const [key, orders] of byPair) {
    if (orders.length < 3) continue;
    const [cid, did] = key.split("|");
    const reasons = [];
    let score = 0;
    const total = orders.length;
    const cancelled = orders.filter((o) => o.status === "cancelled").length;
    const cancelRate = cancelled / total;
    const cTotal = byClient.get(cid)?.length || total;
    const dTotal = byDriver.get(did)?.length || total;
    const shareOfClient = total / cTotal;
    const shareOfDriver = total / dTotal;
    reasons.push({
      code: "repeat_pair",
      severity: "low",
      label: `${total} совместных заказов`,
    });
    score += 1;
    if (shareOfClient >= 0.5) {
      reasons.push({
        code: "pair_dominant_client",
        severity: "high",
        label: `${(shareOfClient * 100).toFixed(0)}% заказов клиента — с этим водителем`,
      });
      score += 4;
    } else if (shareOfClient >= 0.3) {
      reasons.push({
        code: "pair_dominant_client_med",
        severity: "med",
        label: `${(shareOfClient * 100).toFixed(0)}% заказов клиента — с этим водителем`,
      });
      score += 2;
    }
    if (shareOfDriver >= 0.3) {
      reasons.push({
        code: "pair_dominant_driver",
        severity: "high",
        label: `${(shareOfDriver * 100).toFixed(0)}% заказов водителя — с этим клиентом`,
      });
      score += 3;
    } else if (shareOfDriver >= 0.2) {
      reasons.push({
        code: "pair_dominant_driver_med",
        severity: "med",
        label: `${(shareOfDriver * 100).toFixed(0)}% заказов водителя — с этим клиентом`,
      });
      score += 1;
    }
    if (cancelRate >= 0.4 && cancelled >= 2) {
      reasons.push({
        code: "pair_high_cancel",
        severity: "high",
        label: `${cancelled} из ${total} совместных — отмены (${(cancelRate * 100).toFixed(0)}%)`,
      });
      score += 3;
    }
    const pairSelfRides = orders.filter((o) =>
      selfRideMap.has(o.orderId),
    ).length;
    if (pairSelfRides >= 2) {
      reasons.push({
        code: "pair_self_ride_pattern",
        severity: "high",
        label: `${pairSelfRides} совместных самозаказов (подача≈высадка)`,
      });
      score += 5;
    }
    if (score >= 3) {
      const cIdent = _identityClient(orders);
      const dIdent = _identityDriver(orders);
      pairs.push({
        clientId: cid,
        driverId: did,
        clientName: cIdent.name,
        clientPhone: cIdent.phone,
        driverName: dIdent.name,
        driverPhone: dIdent.phone,
        autoNumber: dIdent.autoNumber,
        total,
        cancelled,
        cancelRate,
        shareOfClient,
        shareOfDriver,
        score,
        severity: _severityOf(score),
        reasons,
      });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  // ── 6. Per-order anomalies ──
  const orderItems = [];
  for (const o of all) {
    const reasons = [];
    let score = 0;
    if (o.status === "cancelled" && o.gmv != null && o.gmv > 0) {
      reasons.push({
        code: "cancelled_with_payment",
        severity: "high",
        label: `Отменён, но списано ${o.gmv.toFixed(2)} BYN`,
      });
      score += 5;
    }
    if (o.status === "completed" && o.km > 0 && o.gmv > 0) {
      const ppk = o.gmv / o.km;
      if (ppkP99 > 0 && ppk >= ppkP99) {
        reasons.push({
          code: "extreme_per_km",
          severity: "high",
          label: `${ppk.toFixed(2)} BYN/км ≥ p99 рынка (${ppkP99.toFixed(2)})`,
        });
        score += 3;
      } else if (ppkP95 > 0 && ppk >= ppkP95) {
        reasons.push({
          code: "high_per_km",
          severity: "med",
          label: `${ppk.toFixed(2)} BYN/км ≥ p95 рынка (${ppkP95.toFixed(2)})`,
        });
        score += 1;
      }
      if (o.km < 1 && o.gmv >= 8) {
        reasons.push({
          code: "super_short_high_price",
          severity: "med",
          label: `Поездка ${o.km.toFixed(2)} км за ${o.gmv.toFixed(2)} BYN`,
        });
        score += 2;
      }
    }
    if (
      o.status === "completed" &&
      (o.km === 0 || o.km == null) &&
      (o.gmv || 0) > 0
    ) {
      reasons.push({
        code: "zero_km_completed",
        severity: "high",
        label: "Выполнен с 0 км, но есть оплата",
      });
      score += 3;
    }
    if (o.fta != null && Number.isFinite(o.fta) && o.fta >= 30) {
      reasons.push({
        code: "fta_extreme",
        severity: "med",
        label: `Подача ${o.fta.toFixed(0)} мин (≥30)`,
      });
      score += 2;
    }
    const selfRideDistM = o.orderId ? selfRideMap.get(o.orderId) : null;
    if (selfRideDistM != null) {
      reasons.push({
        code: "pickup_dropoff_collocated",
        severity: "high",
        label: `Подача и высадка совпадают (${selfRideDistM} м) — возможен самозаказ`,
      });
      score += 4;
    }
    const sa = o.orderId ? speedAnomalyMap.get(o.orderId) : null;
    if (sa) {
      if (sa.kind === "fake_gps") {
        reasons.push({
          code: "fake_gps_speed",
          severity: "high",
          label: `Средняя скорость ${sa.kmh.toFixed(0)} км/ч — недостоверно (фейковый GPS?)`,
        });
        score += 5;
      } else if (sa.kind === "too_fast") {
        reasons.push({
          code: "high_speed_anomaly",
          severity: "med",
          label: `Средняя скорость ${sa.kmh.toFixed(0)} км/ч — слишком быстро для Минска`,
        });
        score += 3;
      } else if (sa.kind === "too_slow") {
        reasons.push({
          code: "slow_trip_anomaly",
          severity: "med",
          label: `Поездка ${o.km.toFixed(1)} км за ${o.tripMin.toFixed(0)} мин (${sa.kmh.toFixed(1)} км/ч) — искусственно растянуто?`,
        });
        score += 2;
      }
    }
    if (score >= 3) {
      orderItems.push({
        orderId: o.orderId,
        score,
        severity: _severityOf(score),
        reasons,
        createdAt: o.createdAt,
        status: o.status,
        clientId: o.clientId,
        driverId: o.driverId,
        km: o.km,
        gmv: o.gmv,
        fta: o.fta,
        tripMin: o.tripMin,
      });
    }
  }
  orderItems.sort((a, b) => b.score - a.score);

  return jsonResponse(res, 200, {
    ok: true,
    generatedAt: new Date().toISOString(),
    stats: {
      totalOrders: all.length,
      totalClients: byClient.size,
      totalDrivers: byDriver.size,
      flaggedClients: clients.length,
      flaggedDrivers: drivers.length,
      flaggedPairs: pairs.length,
      flaggedOrders: orderItems.length,
    },
    thresholds: {
      ppkP95,
      ppkP99,
      ftaP95,
      clientMinTotal: 5,
      driverMinTotal: 10,
      pairMinTotal: 3,
    },
    clients: clients.slice(0, 100),
    drivers: drivers.slice(0, 100),
    pairs: pairs.slice(0, 100),
    orders: orderItems.slice(0, 200),
  });
}

// ───────────── server ─────────────
// ═════════════════════════════════════════════════════════════════════════════
// WB Anti-fraud RBAC + Cases (тикет-система разбора фрод-сигналов)
// Хранилища (JSONL, без БД):
//   users.jsonl  — пользователи с ролями (admin | antifraud)
//   cases.jsonl  — тикеты разбора (lazy-create при «Взять в работу»)
// Все эндпоинты /wb/users/* и /wb/cases/* требуют Bearer-сессию;
// /wb/users/* доступны только role=admin.
// ═════════════════════════════════════════════════════════════════════════════

const WB_USERS_FILE = join(WB_DIR, "users.jsonl");
const WB_CASES_FILE = join(WB_DIR, "cases.jsonl");
// Ручные пометки заказов как «фрод» (антифродером в карточке кейса).
// Append-only: каждый upsert/снятие — новая запись. На чтение — last-write-wins по orderId.
const WB_FRAUD_MARKS_FILE = join(WB_DIR, "fraud_marks.jsonl");

// Сериализация записей (защита от гонок при параллельных PATCH/POST).
let wbUsersChain = Promise.resolve();
let wbCasesChain = Promise.resolve();
let wbFraudMarksChain = Promise.resolve();
function _serializeUsers(fn) {
  const next = wbUsersChain.then(fn, fn);
  wbUsersChain = next.catch(() => undefined);
  return next;
}
function _serializeCases(fn) {
  const next = wbCasesChain.then(fn, fn);
  wbCasesChain = next.catch(() => undefined);
  return next;
}
function _serializeFraudMarks(fn) {
  const next = wbFraudMarksChain.then(fn, fn);
  wbFraudMarksChain = next.catch(() => undefined);
  return next;
}

function _hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
function _verifyPassword(pw, stored) {
  if (typeof stored !== "string" || !stored.startsWith("scrypt$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const got = scryptSync(String(pw), salt, expected.length);
    return got.length === expected.length && timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}
function _genId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}
// Простой человеко-читаемый пароль: 10 символов, буквы+цифры без неоднозначных.
function _genPassword(len = 10) {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function _readJsonl(path) {
  if (!existsSync(path)) return [];
  let raw;
  try { raw = await readFile(path, "utf-8"); } catch { return []; }
  const out = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip bad line */ }
  }
  return out;
}
async function _writeJsonlAtomic(path, items) {
  const tmp = path + ".tmp";
  const body = items.map((x) => JSON.stringify(x)).join("\n") + (items.length ? "\n" : "");
  await writeFile(tmp, body, "utf-8");
  await rename(tmp, path);
}

async function _loadUsers() { return _readJsonl(WB_USERS_FILE); }
async function _saveUsers(arr) { return _writeJsonlAtomic(WB_USERS_FILE, arr); }
function _userPublic(u) {
  if (!u) return null;
  return {
    id: u.id, login: u.login, role: u.role, displayName: u.displayName || u.login,
    disabled: !!u.disabled, createdAt: u.createdAt, createdBy: u.createdBy || null,
  };
}

async function _loadCases() { return _readJsonl(WB_CASES_FILE); }
async function _saveCases(arr) { return _writeJsonlAtomic(WB_CASES_FILE, arr); }

// Fraud marks: append-only лог. Чтение схлопывается в Map<orderId, last>.
async function _loadFraudMarksRaw() { return _readJsonl(WB_FRAUD_MARKS_FILE); }
async function _appendFraudMark(rec) {
  const line = JSON.stringify(rec) + "\n";
  await mkdir(dirname(WB_FRAUD_MARKS_FILE), { recursive: true }).catch(() => {});
  await appendFile(WB_FRAUD_MARKS_FILE, line, "utf-8");
}
// Возвращает Map orderId -> { isFraud, markedById, markedByName, caseId, at }
async function _loadFraudMarksMap() {
  const all = await _loadFraudMarksRaw();
  const m = new Map();
  for (const r of all) {
    if (!r || !r.orderId) continue;
    const prev = m.get(r.orderId);
    if (!prev || (r.at || 0) >= (prev.at || 0)) m.set(r.orderId, r);
  }
  return m;
}

function _wbUnauth(res) {
  return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
}
function _wbForbidden(res) {
  return jsonResponse(res, 403, { ok: false, error: "forbidden" });
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleWbMe(req, res) {
  // /me доступен любой авторизованной роли, включая viewer'а — иначе он не
  // сможет получить свой профиль и фронт уйдёт в логин-цикл.
  const sess = checkWbAuthAny(req);
  if (!sess) return _wbUnauth(res);
  return jsonResponse(res, 200, {
    ok: true,
    user: { id: sess.userId, login: sess.login, role: sess.role, displayName: sess.displayName },
  });
}

async function handleWbUsersList(req, res) {
  const sess = requireWbRole(req, "admin");
  if (!sess) return _wbForbidden(res);
  const users = await _loadUsers();
  return jsonResponse(res, 200, {
    ok: true, users: users.map(_userPublic),
  });
}

async function handleWbUserCreate(req, res) {
  const sess = requireWbRole(req, "admin");
  if (!sess) return _wbForbidden(res);
  let body;
  try { body = await readJsonBody(req); }
  catch { return jsonResponse(res, 400, { ok: false, error: "bad_json" }); }
  const login = String(body?.login || "").trim();
  const role = String(body?.role || "antifraud");
  const displayName = String(body?.displayName || login).trim();
  let password = String(body?.password || "");
  if (!login) return jsonResponse(res, 400, { ok: false, error: "missing_login" });
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(login)) {
    return jsonResponse(res, 400, { ok: false, error: "bad_login_format" });
  }
  if (role !== "admin" && role !== "antifraud") {
    return jsonResponse(res, 400, { ok: false, error: "bad_role" });
  }
  return _serializeUsers(async () => {
    const users = await _loadUsers();
    if (users.some((u) => u.login.toLowerCase() === login.toLowerCase())) {
      return jsonResponse(res, 409, { ok: false, error: "login_taken" });
    }
    if (!password) password = _genPassword(10);
    if (password.length < 6) {
      return jsonResponse(res, 400, { ok: false, error: "password_too_short" });
    }
    const u = {
      id: _genId("user"),
      login, role, displayName: displayName || login,
      passwordHash: _hashPassword(password),
      disabled: false,
      createdAt: Date.now(),
      createdBy: sess.userId,
    };
    users.push(u);
    await _saveUsers(users);
    // Возвращаем сгенерированный пароль ТОЛЬКО при создании.
    return jsonResponse(res, 200, {
      ok: true, user: _userPublic(u), password,
    });
  });
}

async function handleWbUserUpdate(req, res, userId) {
  const sess = requireWbRole(req, "admin");
  if (!sess) return _wbForbidden(res);
  let body;
  try { body = await readJsonBody(req); }
  catch { return jsonResponse(res, 400, { ok: false, error: "bad_json" }); }
  return _serializeUsers(async () => {
    const users = await _loadUsers();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx === -1) return jsonResponse(res, 404, { ok: false, error: "user_not_found" });
    const u = users[idx];
    let newPassword = null;
    if (typeof body?.displayName === "string") u.displayName = body.displayName.trim() || u.login;
    if (typeof body?.disabled === "boolean") u.disabled = body.disabled;
    if (body?.role && (body.role === "admin" || body.role === "antifraud")) u.role = body.role;
    if (body?.resetPassword === true) {
      newPassword = _genPassword(10);
      u.passwordHash = _hashPassword(newPassword);
    } else if (typeof body?.password === "string" && body.password.length >= 6) {
      newPassword = body.password;
      u.passwordHash = _hashPassword(newPassword);
    }
    u.updatedAt = Date.now();
    users[idx] = u;
    await _saveUsers(users);
    return jsonResponse(res, 200, {
      ok: true, user: _userPublic(u), ...(newPassword ? { password: newPassword } : {}),
    });
  });
}

async function handleWbUserDelete(req, res, userId) {
  const sess = requireWbRole(req, "admin");
  if (!sess) return _wbForbidden(res);
  return _serializeUsers(async () => {
    const users = await _loadUsers();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx === -1) return jsonResponse(res, 404, { ok: false, error: "user_not_found" });
    users.splice(idx, 1);
    await _saveUsers(users);
    return jsonResponse(res, 200, { ok: true });
  });
}

// ── Cases ───────────────────────────────────────────────────────────────────

const CASE_STATUS_OPEN = "in_progress";
const CASE_STATUS_CLOSED = "closed";
const CASE_RESOLUTIONS = new Set(["confirmed", "rejected", "unclear"]);

async function handleWbCasesList(req, res) {
  const sess = checkWbAuthAdminOrAntifraud(req);
  if (!sess) return _wbUnauth(res);
  const u = new URL(req.url, "http://x");
  const status = u.searchParams.get("status"); // open|closed|all
  const subjectType = u.searchParams.get("subjectType");
  const subjectId = u.searchParams.get("subjectId");
  const assignee = u.searchParams.get("assignee"); // me|<id>|any
  const limit = Math.min(parseInt(u.searchParams.get("limit") || "200", 10) || 200, 1000);

  const cases = await _loadCases();
  let out = cases;
  if (status === "open") out = out.filter((c) => c.status === CASE_STATUS_OPEN);
  else if (status === "closed") out = out.filter((c) => c.status === CASE_STATUS_CLOSED);
  if (subjectType) out = out.filter((c) => c.subjectType === subjectType);
  if (subjectId) out = out.filter((c) => String(c.subjectId) === String(subjectId));
  if (assignee === "me") out = out.filter((c) => c.assigneeId === sess.userId);
  else if (assignee && assignee !== "any") out = out.filter((c) => c.assigneeId === assignee);

  out = out.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, limit);
  return jsonResponse(res, 200, { ok: true, cases: out, total: out.length });
}

async function handleWbCaseGet(req, res, caseId) {
  const sess = checkWbAuthAdminOrAntifraud(req);
  if (!sess) return _wbUnauth(res);
  const cases = await _loadCases();
  const c = cases.find((x) => x.id === caseId);
  if (!c) return jsonResponse(res, 404, { ok: false, error: "case_not_found" });
  return jsonResponse(res, 200, { ok: true, case: c });
}

// «Взять в работу»: lazy-create. Тело: { subjectType, subjectId, subjectName?, signals?, score? }
// Если по этому subject уже есть открытый кейс → возвращаем его.
async function handleWbCaseTake(req, res) {
  const sess = checkWbAuthAdminOrAntifraud(req);
  if (!sess) return _wbUnauth(res);
  let body;
  try { body = await readJsonBody(req); }
  catch { return jsonResponse(res, 400, { ok: false, error: "bad_json" }); }
  const subjectType = String(body?.subjectType || "");
  const subjectId = String(body?.subjectId || "");
  if (subjectType !== "driver" && subjectType !== "client") {
    return jsonResponse(res, 400, { ok: false, error: "bad_subjectType" });
  }
  if (!subjectId) return jsonResponse(res, 400, { ok: false, error: "missing_subjectId" });

  return _serializeCases(async () => {
    const cases = await _loadCases();
    const open = cases.find(
      (c) => c.subjectType === subjectType && String(c.subjectId) === subjectId
        && c.status === CASE_STATUS_OPEN,
    );
    if (open) {
      // Уже в работе — отдаём как есть (даже если у другого антифродера).
      return jsonResponse(res, 200, { ok: true, case: open, alreadyAssigned: true });
    }
    // Если по этому subject уже есть закрытый разбор — НЕ создаём новый кейс.
    // Антифродер видит резолюцию предыдущего разбора и не повторяет работу.
    // (Берём самый свежий по closedAt/updatedAt.)
    const closedSame = cases
      .filter((c) => c.subjectType === subjectType && String(c.subjectId) === subjectId
        && c.status === CASE_STATUS_CLOSED)
      .sort((a, b) => (b.closedAt || b.updatedAt || 0) - (a.closedAt || a.updatedAt || 0));
    if (closedSame.length) {
      return jsonResponse(res, 200, {
        ok: true, case: closedSame[0], alreadyResolved: true,
      });
    }
    const now = Date.now();
    const c = {
      id: _genId("case"),
      subjectType, subjectId,
      subjectName: String(body?.subjectName || "").trim() || null,
      signals: Array.isArray(body?.signals) ? body.signals.slice(0, 30) : [],
      score: Number.isFinite(body?.score) ? body.score : null,
      status: CASE_STATUS_OPEN,
      assigneeId: sess.userId, assigneeName: sess.displayName,
      takenAt: now,
      resolution: null, resolutionNote: "",
      actionTaken: "",
      bonusesApplied: false, bonusesPeriod: "",
      closedAt: null, closedById: null, closedByName: null,
      createdAt: now, updatedAt: now,
      comments: [],
    };
    cases.push(c);
    await _saveCases(cases);
    return jsonResponse(res, 200, { ok: true, case: c });
  });
}

async function handleWbCaseRelease(req, res, caseId) {
  const sess = checkWbAuthAdminOrAntifraud(req);
  if (!sess) return _wbUnauth(res);
  return _serializeCases(async () => {
    const cases = await _loadCases();
    const idx = cases.findIndex((c) => c.id === caseId);
    if (idx === -1) return jsonResponse(res, 404, { ok: false, error: "case_not_found" });
    const c = cases[idx];
    if (c.status !== CASE_STATUS_OPEN)
      return jsonResponse(res, 409, { ok: false, error: "not_open" });
    if (c.assigneeId !== sess.userId && sess.role !== "admin")
      return jsonResponse(res, 403, { ok: false, error: "not_yours" });
    c.assigneeId = null; c.assigneeName = null; c.takenAt = null;
    c.updatedAt = Date.now();
    c.comments.push({
      id: _genId("cm"), authorId: sess.userId, authorName: sess.displayName,
      text: "↶ снял с себя", at: Date.now(),
    });
    cases[idx] = c;
    await _saveCases(cases);
    return jsonResponse(res, 200, { ok: true, case: c });
  });
}

// PATCH /wb/cases/:id — обновить и/или закрыть с резолюцией.
// Тело: { resolution, resolutionNote, actionTaken, bonusesApplied, bonusesPeriod, close }
async function handleWbCaseUpdate(req, res, caseId) {
  const sess = checkWbAuthAdminOrAntifraud(req);
  if (!sess) return _wbUnauth(res);
  let body;
  try { body = await readJsonBody(req); }
  catch { return jsonResponse(res, 400, { ok: false, error: "bad_json" }); }
  return _serializeCases(async () => {
    const cases = await _loadCases();
    const idx = cases.findIndex((c) => c.id === caseId);
    if (idx === -1) return jsonResponse(res, 404, { ok: false, error: "case_not_found" });
    const c = cases[idx];
    // Закрытый кейс — финальный. Никаких правок (даже админу): чтобы исключить
    // повторный «разбор» того, что уже разобрано. При необходимости новый
    // разбор должен открываться как новый кейс другим маршрутом.
    if (c.status === CASE_STATUS_CLOSED) {
      return jsonResponse(res, 409, { ok: false, error: "case_closed" });
    }
    if (c.assigneeId && c.assigneeId !== sess.userId && sess.role !== "admin") {
      return jsonResponse(res, 403, { ok: false, error: "not_yours" });
    }
    if (typeof body?.resolution === "string") {
      if (!CASE_RESOLUTIONS.has(body.resolution))
        return jsonResponse(res, 400, { ok: false, error: "bad_resolution" });
      c.resolution = body.resolution;
    }
    if (typeof body?.resolutionNote === "string") c.resolutionNote = body.resolutionNote.slice(0, 4000);
    if (typeof body?.actionTaken === "string") c.actionTaken = body.actionTaken.slice(0, 4000);
    if (typeof body?.bonusesApplied === "boolean") c.bonusesApplied = body.bonusesApplied;
    if (typeof body?.bonusesPeriod === "string") c.bonusesPeriod = body.bonusesPeriod.slice(0, 200);
    c.updatedAt = Date.now();
    if (body?.close === true) {
      if (!c.resolution) return jsonResponse(res, 400, { ok: false, error: "no_resolution" });
      c.status = CASE_STATUS_CLOSED;
      c.closedAt = Date.now();
      c.closedById = sess.userId; c.closedByName = sess.displayName;
    }
    cases[idx] = c;
    await _saveCases(cases);
    return jsonResponse(res, 200, { ok: true, case: c });
  });
}

async function handleWbCaseComment(req, res, caseId) {
  const sess = checkWbAuthAdminOrAntifraud(req);
  if (!sess) return _wbUnauth(res);
  let body;
  try { body = await readJsonBody(req); }
  catch { return jsonResponse(res, 400, { ok: false, error: "bad_json" }); }
  const text = String(body?.text || "").trim();
  if (!text) return jsonResponse(res, 400, { ok: false, error: "empty_text" });
  return _serializeCases(async () => {
    const cases = await _loadCases();
    const idx = cases.findIndex((c) => c.id === caseId);
    if (idx === -1) return jsonResponse(res, 404, { ok: false, error: "case_not_found" });
    const c = cases[idx];
    // Закрытый кейс — обсуждение заморожено. Иначе можно было бы дописывать
    // «задним числом» комментарии к решённым кейсам и менять впечатление о разборе.
    if (c.status === "closed") {
      return jsonResponse(res, 409, { ok: false, error: "case_closed", case: c });
    }
    c.comments.push({
      id: _genId("cm"), authorId: sess.userId, authorName: sess.displayName,
      text: text.slice(0, 4000), at: Date.now(),
    });
    c.updatedAt = Date.now();
    cases[idx] = c;
    await _saveCases(cases);
    return jsonResponse(res, 200, { ok: true, case: c });
  });
}

// ── Fraud marks (ручные пометки заказов антифродером) ───────────────────────

// GET /wb/fraud-marks?driverId=&clientId=&from=&to=
// Возвращает актуальные пометки (last-write-wins по orderId) с применёнными
// фильтрами (по subjectType/subjectId если заданы; по at если from/to ISO).
async function handleWbFraudMarksList(req, res) {
  const sess = checkWbAuthAdminOrAntifraud(req);
  if (!sess) return _wbUnauth(res);
  const u = new URL(req.url, "http://x");
  const driverId = u.searchParams.get("driverId") || "";
  const clientId = u.searchParams.get("clientId") || "";
  const from = u.searchParams.get("from") || "";
  const to = u.searchParams.get("to") || "";
  const fromMs = from ? Date.parse(from) : NaN;
  const toMs = to ? Date.parse(to) : NaN;
  const map = await _loadFraudMarksMap();
  let arr = Array.from(map.values());
  if (driverId) arr = arr.filter((r) => r.subjectType === "driver" && String(r.subjectId) === driverId);
  if (clientId) arr = arr.filter((r) => r.subjectType === "client" && String(r.subjectId) === clientId);
  if (Number.isFinite(fromMs)) arr = arr.filter((r) => (r.at || 0) >= fromMs);
  if (Number.isFinite(toMs)) arr = arr.filter((r) => (r.at || 0) < toMs);
  arr.sort((a, b) => (b.at || 0) - (a.at || 0));
  return jsonResponse(res, 200, { ok: true, marks: arr, total: arr.length });
}

// POST /wb/fraud-marks  body: { orderId, subjectType, subjectId, isFraud, caseId? }
// Append-only: пишем новую запись с at=now. Если isFraud=false — это «снятие».
async function handleWbFraudMarkUpsert(req, res) {
  const sess = checkWbAuthAdminOrAntifraud(req);
  if (!sess) return _wbUnauth(res);
  let body;
  try { body = await readJsonBody(req); }
  catch { return jsonResponse(res, 400, { ok: false, error: "bad_json" }); }
  const orderId = String(body?.orderId || "").trim();
  const subjectType = String(body?.subjectType || "");
  const subjectId = String(body?.subjectId || "").trim();
  const isFraud = !!body?.isFraud;
  const caseId = body?.caseId ? String(body.caseId) : null;
  if (!orderId) return jsonResponse(res, 400, { ok: false, error: "missing_orderId" });
  if (subjectType !== "driver" && subjectType !== "client") {
    return jsonResponse(res, 400, { ok: false, error: "bad_subjectType" });
  }
  if (!subjectId) return jsonResponse(res, 400, { ok: false, error: "missing_subjectId" });
  // Целостность: пометка должна ссылаться на реальный заказ, и subject (driver/client)
  // обязан совпадать с теми, что записаны в самом заказе. Без этого admin/antifraud
  // мог бы приписать произвольному водителю чужие заказы и исказить /wb/driver-fraud-report.
  let _orders;
  try { _orders = await loadWbAll(); } catch { _orders = []; }
  const order = _orders.find((o) => o && o.orderId === orderId);
  if (!order) return jsonResponse(res, 404, { ok: false, error: "order_not_found" });
  if (subjectType === "driver" && String(order.driverId || "") !== subjectId) {
    return jsonResponse(res, 400, { ok: false, error: "subject_mismatch" });
  }
  if (subjectType === "client" && String(order.clientId || "") !== subjectId) {
    return jsonResponse(res, 400, { ok: false, error: "subject_mismatch" });
  }
  // caseId опционален, но если передан — должен существовать и относиться к тому же subject.
  if (caseId) {
    const _cases = await _loadCases();
    const cs = _cases.find((c) => c.id === caseId);
    if (!cs) return jsonResponse(res, 404, { ok: false, error: "case_not_found" });
    if (cs.subjectType !== subjectType || String(cs.subjectId) !== subjectId) {
      return jsonResponse(res, 400, { ok: false, error: "case_subject_mismatch" });
    }
  }
  return _serializeFraudMarks(async () => {
    const rec = {
      id: _genId("fm"),
      orderId, subjectType, subjectId,
      isFraud, caseId,
      markedById: sess.userId, markedByName: sess.displayName,
      at: Date.now(),
    };
    await _appendFraudMark(rec);
    return jsonResponse(res, 200, { ok: true, mark: rec });
  });
}

// GET /wb/driver-fraud-report?from=&to=&limit=
// Сводный отчёт по водителям за период: общие заказы, авто-фрод, ручные пометки,
// объединённое множество фрод-заказов и сумма фрод-GMV. Сортировка по anyFraudGmv.
async function handleWbDriverFraudReport(req, res) {
  const sess = checkWbAuthAdminOrAntifraud(req);
  if (!sess) return _wbUnauth(res);
  const u = new URL(req.url, "http://x");
  const from = u.searchParams.get("from") || "";
  const to = u.searchParams.get("to") || "";
  const limit = Math.min(parseInt(u.searchParams.get("limit") || "500", 10) || 500, 5000);
  const fromMs = from ? Date.parse(from) : NaN;
  const toMs = to ? Date.parse(to) : NaN;

  const allOrders = await loadWbAll();
  const inRange = allOrders.filter((o) => {
    if (!o.driverId || o.driverId === "0") return false;
    if (!o.createdAt) return false;
    if (Number.isFinite(fromMs)) {
      const t = Date.parse(o.createdAt);
      if (!Number.isFinite(t) || t < fromMs) return false;
    }
    if (Number.isFinite(toMs)) {
      const t = Date.parse(o.createdAt);
      if (!Number.isFinite(t) || t >= toMs) return false;
    }
    return true;
  });

  // Авто-фрод: тот же контекст окна, что и в /wb/stats.
  const autoCtx = _wbBuildWindowContext(allOrders, fromMs, toMs);
  const autoFraudIds = autoCtx.fraudOrderIds;
  // Ручные пометки.
  const marksMap = await _loadFraudMarksMap();
  const manualFraudIds = new Set();
  for (const [orderId, r] of marksMap) {
    if (r && r.isFraud) manualFraudIds.add(orderId);
  }

  const byDriver = new Map();
  for (const o of inRange) {
    const did = String(o.driverId);
    let acc = byDriver.get(did);
    if (!acc) {
      acc = {
        driverId: did,
        orders: 0, totalGmv: 0,
        autoFraudOrders: 0, autoFraudGmv: 0,
        manualFraudOrders: 0, manualFraudGmv: 0,
        anyFraudOrders: 0, anyFraudGmv: 0,
      };
      byDriver.set(did, acc);
    }
    const g = Number(o.gmv) || 0;
    acc.orders++;
    acc.totalGmv += g;
    const isAuto = autoFraudIds.has(o.orderId);
    const isManual = manualFraudIds.has(o.orderId);
    if (isAuto) { acc.autoFraudOrders++; acc.autoFraudGmv += g; }
    if (isManual) { acc.manualFraudOrders++; acc.manualFraudGmv += g; }
    if (isAuto || isManual) { acc.anyFraudOrders++; acc.anyFraudGmv += g; }
  }
  const out = Array.from(byDriver.values())
    .filter((r) => r.orders > 0)
    .map((r) => ({
      ...r,
      totalGmv: Math.round(r.totalGmv * 100) / 100,
      autoFraudGmv: Math.round(r.autoFraudGmv * 100) / 100,
      manualFraudGmv: Math.round(r.manualFraudGmv * 100) / 100,
      anyFraudGmv: Math.round(r.anyFraudGmv * 100) / 100,
    }))
    .sort((a, b) => b.anyFraudGmv - a.anyFraudGmv || b.anyFraudOrders - a.anyFraudOrders)
    .slice(0, limit);
  return jsonResponse(res, 200, {
    ok: true,
    from: from || null, to: to || null,
    rows: out, total: out.length,
  });
}

// ═════════════════════════════════════════════════════════════════════════════

const server = createServer(async (req, res) => {
  const ip = clientIp(req);

  // Для /wb/* — строгий CORS allowlist + credentials:true (cookie-сессия) +
  // CSRF-проверка Origin/Referer на не-GET. Применяем ДО общего OPTIONS-обработчика,
  // иначе preflight для /wb/* уйдёт с мягким "*", и браузер отклонит запрос
  // с credentials:'include'.
  const _isWbRoute = typeof req.url === "string"
    && (req.url === "/wb" || req.url.startsWith("/wb/"));
  if (_isWbRoute) {
    applyWbCors(req, res);
    if (!checkCsrfOrigin(req)) {
      console.warn(
        `[wb-csrf] blocked ${req.method} ${req.url} ${ipForLog(ip)} origin=${req.headers.origin || "-"} referer=${(req.headers.referer || "-").slice(0, 80)}`,
      );
      return jsonResponse(res, 403, { ok: false, error: "csrf_blocked" });
    }
  }

  if (req.method === "OPTIONS") return jsonResponse(res, 204, {});

  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    return jsonResponse(res, 200, { ok: true, service: "rwbtaxi-screens" });
  }

  // Rate-limit ТОЛЬКО на тяжёлые загрузки файлов (защита от флуда).
  // GET-эндпоинты и легкие POST (login/reserve/release) не лимитим — это админка
  // с десятком параллельных запросов на странице, иначе она ловит 429 на ровном месте.
  const isHeavyUpload =
    req.method === "POST" && (req.url === "/upload" || req.url === "/wb/upload");
  if (isHeavyUpload && tooManyRequests(ip)) {
    return jsonResponse(res, 429, { ok: false, error: "rate_limited" });
  }

  if (req.method === "GET" && req.url === "/stats") return handleStats(req, res);
  // /recommended?clientId=… — клиент шлёт query для per-user фильтра «уже отработанных»
  // маршрутов (см. fetchRecommendedRoutes). Строгое === ронялось в 404 при наличии qs.
  if (
    req.method === "GET" &&
    (req.url === "/recommended" || req.url.startsWith("/recommended?"))
  )
    return handleRecommended(req, res);
  if (req.method === "GET" && req.url === "/probe-secret")
    return handleProbeSecret(req, res);
  if (req.method === "GET" && req.url.startsWith("/yandex-probe-redirect"))
    return handleYandexProbeRedirect(req, res);
  if (req.method === "POST" && req.url === "/yandex-probe")
    return handleYandexProbe(req, res);
  if (req.method === "GET" && req.url.startsWith("/recent-calibs"))
    return handleRecentCalibs(req, res);
  // Карта замеров Yandex Go (компонент AdminScreensMap.tsx). startsWith,
  // потому что фронт шлёт ?days=7 / ?id=… в query.
  if (req.method === "GET" && req.url.startsWith("/screens-map/details"))
    return handleScreensMapDetails(req, res, jsonResponse);
  if (req.method === "GET" && req.url.startsWith("/screens-map"))
    return handleScreensMap(req, res, jsonResponse);
  if (req.method === "GET" && req.url.startsWith("/pipeline-stats"))
    return handleScreensStats(req, res);
  if (req.method === "POST" && req.url === "/pipeline-requeue")
    return handleScreensRequeue(req, res);
  if (req.method === "POST" && req.url === "/upload")
    return handleUpload(req, res, ip);
  if (req.method === "POST" && req.url === "/reserve")
    return handleReserve(req, res);
  if (req.method === "POST" && req.url === "/release")
    return handleRelease(req, res);

  // ─── WB endpoints ───
  if (req.method === "POST" && req.url === "/wb/login")
    return handleWbLogin(req, res);
  if (req.method === "POST" && req.url === "/wb/logout")
    return handleWbLogout(req, res);
  if (req.method === "POST" && req.url === "/wb/upload")
    return handleWbUpload(req, res, ip);
  if (req.method === "GET" && req.url.startsWith("/wb/stats"))
    return handleWbStats(req, res);
  // /wb/graph/analyze — Gemini-разбор графа. Должен идти ДО /wb/graph (который GET).
  if (req.method === "POST" && req.url === "/wb/graph/analyze")
    return handleWbGraphAnalyze(req, res);
  if (req.method === "GET" && req.url.startsWith("/wb/graph"))
    return handleWbGraph(req, res);
  if (req.method === "GET" && req.url.startsWith("/wb/orders"))
    return handleWbOrders(req, res);
  // Drill-in для пары — ДО /wb/pairs (списка).
  if (req.method === "GET" && /^\/wb\/pair\/[^/?]+\/[^/?]+/.test(req.url))
    return handleWbPair(req, res);
  if (req.method === "GET" && req.url.startsWith("/wb/pairs"))
    return handleWbPairs(req, res);
  if (req.method === "GET" && req.url.startsWith("/wb/heatmap"))
    return handleWbHeatmap(req, res);
  if (req.method === "GET" && req.url.startsWith("/wb/timeline"))
    return handleWbTimeline(req, res);
  // Внимание: только /wb/fraud (без -marks). startsWith("/wb/fraud") ловит и
  // /wb/fraud-marks → /wb/driver-fraud-report и т.п., поэтому проверяем строго.
  if (
    req.method === "GET" &&
    (req.url === "/wb/fraud" || req.url.startsWith("/wb/fraud?"))
  )
    return handleWbFraud(req, res);
  // drill-in (/wb/client/:id, /wb/driver/:id) — проверять ДО списков (/wb/clients, /wb/drivers)
  if (req.method === "GET" && /^\/wb\/client\/[^/?]/.test(req.url))
    return handleWbClient(req, res);
  if (req.method === "GET" && /^\/wb\/driver\/[^/?]/.test(req.url))
    return handleWbDriver(req, res);
  if (req.method === "GET" && /^\/wb\/franch\/[^/?]/.test(req.url))
    return handleWbFranch(req, res);
  if (req.method === "GET" && req.url.startsWith("/wb/clients"))
    return handleWbClientsList(req, res);
  if (req.method === "GET" && req.url.startsWith("/wb/new-drivers"))
    return handleWbNewDrivers(req, res);
  if (req.method === "GET" && req.url.startsWith("/wb/drivers"))
    return handleWbDriversList(req, res);

  // ── WB users (admin) и cases (тикеты разбора фрода) ──
  if (req.method === "GET" && req.url === "/wb/me")
    return handleWbMe(req, res);
  if (req.method === "GET" && req.url.startsWith("/wb/users") && !/\/wb\/users\/[^/?]/.test(req.url))
    return handleWbUsersList(req, res);
  if (req.method === "POST" && req.url === "/wb/users")
    return handleWbUserCreate(req, res);
  {
    const m = /^\/wb\/users\/([^/?]+)(?:\?.*)?$/.exec(req.url);
    if (m && req.method === "PATCH") return handleWbUserUpdate(req, res, m[1]);
    if (m && req.method === "DELETE") return handleWbUserDelete(req, res, m[1]);
  }
  // cases: порядок важен — сначала специфичные пути.
  if (req.method === "POST" && req.url === "/wb/cases/take")
    return handleWbCaseTake(req, res);
  {
    const m = /^\/wb\/cases\/([^/?]+)\/release$/.exec(req.url);
    if (m && req.method === "POST") return handleWbCaseRelease(req, res, m[1]);
  }
  {
    const m = /^\/wb\/cases\/([^/?]+)\/comment$/.exec(req.url);
    if (m && req.method === "POST") return handleWbCaseComment(req, res, m[1]);
  }
  {
    const m = /^\/wb\/cases\/([^/?]+)(?:\?.*)?$/.exec(req.url);
    if (m && m[1] !== "take" && req.method === "GET") return handleWbCaseGet(req, res, m[1]);
    if (m && m[1] !== "take" && req.method === "PATCH") return handleWbCaseUpdate(req, res, m[1]);
  }
  if (req.method === "GET" && req.url.startsWith("/wb/cases"))
    return handleWbCasesList(req, res);

  // ── Антифрод: ручные пометки заказов и сводный отчёт по водителям ──
  if (req.method === "GET" && req.url.startsWith("/wb/fraud-marks"))
    return handleWbFraudMarksList(req, res);
  if (req.method === "POST" && req.url === "/wb/fraud-marks")
    return handleWbFraudMarkUpsert(req, res);
  if (req.method === "GET" && req.url.startsWith("/wb/driver-fraud-report"))
    return handleWbDriverFraudReport(req, res);

  return jsonResponse(res, 404, { ok: false, error: "not_found" });
});

server.listen(PORT, HOST, () => {
  console.log(
    `[screens] listening on ${HOST}:${PORT}, root=${ROOT}, anchors=${ANCHORS_FILE}, ttl=${RESERVATION_TTL_MS}ms, completedTtl=${COMPLETED_TTL_MS}ms, sampleWindow=${SAMPLE_WINDOW_MS}ms, rl=${RATE_LIMIT_PER_MIN}/min`,
  );
});
