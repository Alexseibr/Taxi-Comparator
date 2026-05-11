// lib/anchors.mjs — read-only якорная сетка Минска для T013.
// Источник: /opt/rwbtaxi-screens/anchors-minsk.json (живёт в парсере, мы НЕ модифицируем).
// Hot-reload: раз в 60с проверяем mtime файла и перечитываем, если изменился.
//
// API:
//   getAnchors() -> массив якорей {id,name,lat,lng,type,address}
//   matchAnchor(lat, lng) -> {anchor, distance_m} | null  (ближайший в адаптивном радиусе)
//   inMkad(lat, lng) -> bool  (геометрический круг ~13 км от центра Минска)
//   haversineMeters(a, b)
//   classifyOrder(o) -> {anchor_a_id, anchor_b_id, dist_category, is_template_route}
//
// Адаптивный радиус по типу якоря:
//   metro/station/airport/bus/rail = 500 м (большой объект, посадка может быть в 500м)
//   tc/mall/market/universam       = 300 м
//   default                        = 250 м

import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger.mjs";

const ANCHORS_PATH = process.env.ANCHORS_PATH ||
  "/opt/rwbtaxi-screens/anchors-minsk.json";
const RELOAD_INTERVAL_MS = 60_000;

// Минск — приблизительный центр (Площадь Независимости).
const MINSK_CENTER = { lat: 53.9023, lng: 27.5619 };
// МКАД Минска — кольцевая дорога радиусом ~12-13 км от центра. Берём 13 для запаса.
const MKAD_RADIUS_M = 13_000;

// T013: правила "шаблона из книжки".
const TEMPLATE_MIN_DIST_M = 2_000;   // <2 км считаем «совсем коротким», не шаблон
const TEMPLATE_MAX_DIST_M = 30_000;  // >30 км — выброс

// Радиус захвата по типу якоря (м).
function captureRadiusFor(type) {
  const t = String(type || "").toLowerCase();
  if (["metro", "station", "rail", "bus", "airport"].includes(t)) return 500;
  if (["tc", "mall", "market", "universam", "shop"].includes(t)) return 300;
  return 250;
}

let _anchors = [];
let _loadedMtime = 0;
let _loadedAt = 0;
let _filteredOutByMkad = 0;
let _timer = null;

function tryLoad() {
  try {
    const st = fs.statSync(ANCHORS_PATH);
    if (st.mtimeMs === _loadedMtime) return false; // не изменился
    const raw = fs.readFileSync(ANCHORS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed
      : Array.isArray(parsed?.anchors) ? parsed.anchors
      : [];
    const inside = [];
    let outside = 0;
    for (const a of arr) {
      if (typeof a?.lat !== "number" || typeof a?.lng !== "number") continue;
      // T013: фильтр МКАД — выкидываем якоря за пределами кольцевой,
      // даже если они появились в anchors-minsk.json (страховка).
      if (!inMkadRaw(a.lat, a.lng)) { outside++; continue; }
      inside.push({
        id: String(a.id || a.name || `${a.lat},${a.lng}`),
        name: String(a.name || a.id || ""),
        lat: a.lat,
        lng: a.lng,
        type: String(a.type || ""),
        address: String(a.address || ""),
      });
    }
    _anchors = inside;
    _loadedMtime = st.mtimeMs;
    _loadedAt = Date.now();
    _filteredOutByMkad = outside;
    logger.info(
      { count: _anchors.length, outsideMkad: outside, path: ANCHORS_PATH },
      "anchors loaded",
    );
    return true;
  } catch (e) {
    logger.warn(
      { err: e?.message, path: ANCHORS_PATH },
      "anchors load failed; using last known set (or empty)",
    );
    return false;
  }
}

export function startAnchorsWatcher() {
  tryLoad();
  if (_timer) clearInterval(_timer);
  _timer = setInterval(tryLoad, RELOAD_INTERVAL_MS);
  if (typeof _timer.unref === "function") _timer.unref();
}

export function stopAnchorsWatcher() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

export function getAnchors() { return _anchors.slice(); }
export function getAnchorsMeta() {
  return {
    count: _anchors.length,
    loaded_at: _loadedAt ? new Date(_loadedAt).toISOString() : null,
    source_path: ANCHORS_PATH,
    filtered_out_by_mkad: _filteredOutByMkad,
  };
}

export function haversineMeters(a, b) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function inMkadRaw(lat, lng) {
  return haversineMeters({ lat, lng }, MINSK_CENTER) <= MKAD_RADIUS_M;
}

export function inMkad(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  return inMkadRaw(lat, lng);
}

// Ближайший якорь в его собственном адаптивном радиусе.
// Считаем расстояние до всех — массив маленький (десятки), отсортируем по дист.
// и возьмём первого, кто укладывается в свой радиус.
export function matchAnchor(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!_anchors.length) return null;
  let best = null;
  for (const a of _anchors) {
    const d = haversineMeters({ lat, lng }, a);
    const r = captureRadiusFor(a.type);
    if (d <= r && (!best || d < best.distance_m)) {
      best = { anchor: a, distance_m: d };
    }
  }
  return best;
}

// Категория поездки по дистанции в КИЛОМЕТРАХ (используем km из заказа,
// fallback на расчёт по координатам если km нет).
// short  : <2 км
// medium : 2..10 км
// long   : 10..30 км
// outside: всё прочее (за МКАД либо >30 км либо нет координат)
export function classifyDistanceKm(km, both_in_mkad) {
  if (!both_in_mkad) return "outside";
  if (typeof km !== "number" || !Number.isFinite(km)) return "outside";
  if (km < 2) return "short";
  if (km < 10) return "medium";
  if (km <= 30) return "long";
  return "outside";
}

// Полная классификация заказа.
// Принимает {lat_in,lng_in,lat_out,lng_out,km}.
export function classifyOrder(o) {
  const ma = matchAnchor(o?.lat_in, o?.lng_in);
  const mb = matchAnchor(o?.lat_out, o?.lng_out);
  const both_in_mkad = inMkad(o?.lat_in, o?.lng_in) && inMkad(o?.lat_out, o?.lng_out);

  // dist_category — по фактической длине поездки (km из выгрузки).
  const dist_category = classifyDistanceKm(o?.km, both_in_mkad);

  // is_template_route — оба конца сматчились с якорями + дистанция между ЯКОРЯМИ
  // в окне [TEMPLATE_MIN_DIST_M, TEMPLATE_MAX_DIST_M] + оба якоря в МКАД (это
  // гарантировано фильтром в tryLoad, но проверим явно).
  let is_template_route = false;
  if (ma && mb && ma.anchor.id !== mb.anchor.id) {
    const anchorDist = haversineMeters(ma.anchor, mb.anchor);
    if (anchorDist >= TEMPLATE_MIN_DIST_M &&
        anchorDist <= TEMPLATE_MAX_DIST_M &&
        inMkad(ma.anchor.lat, ma.anchor.lng) &&
        inMkad(mb.anchor.lat, mb.anchor.lng)) {
      is_template_route = true;
    }
  }

  return {
    anchor_a_id: ma?.anchor?.id ?? null,
    anchor_b_id: mb?.anchor?.id ?? null,
    dist_category,
    is_template_route,
  };
}

// Ручной reload — для тестов/debug-роута.
export function reloadAnchorsNow() {
  _loadedMtime = 0;
  return tryLoad();
}
