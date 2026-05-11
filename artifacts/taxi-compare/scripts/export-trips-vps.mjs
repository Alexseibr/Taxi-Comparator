#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import ExcelJS from "exceljs";

const SCREENS = "/tmp/rwb-export/screens";
const WB_FILE = "/tmp/rwb-export/wb/aggregated.jsonl";
const OUT = "/tmp/rwb-export/rwbtaxi-trips.xlsx";
const GEO_CACHE_PATH = "/tmp/rwb-export/geocode-cache.json";
const GOOGLE_KEY = process.env.GOOGLE_MAPS_KEY || "";

// ============= ГЕОКОДИНГ (Google Maps + диск-кеш) =============
// Yandex .raw.json приходит без координат — только адреса (fromAddress,
// toAddress). Геокодим их через Google Maps Geocoding API с кешем на диске,
// чтобы не платить за повторные запросы.
let geoCache = {};
try { geoCache = JSON.parse(readFileSync(GEO_CACHE_PATH, "utf8")); } catch {}
let geoCacheDirty = false;

function persistGeoCache() {
  if (!geoCacheDirty) return;
  mkdirSync(dirname(GEO_CACHE_PATH), { recursive: true });
  writeFileSync(GEO_CACHE_PATH, JSON.stringify(geoCache, null, 2));
  geoCacheDirty = false;
}

async function geocode(addr) {
  if (!addr || typeof addr !== "string") return null;
  const key = addr.trim().toLowerCase();
  if (!key) return null;
  if (key in geoCache) return geoCache[key]; // null/{} тоже кешируем
  if (!GOOGLE_KEY) return null;
  // Принудительно ограничиваем регион Беларусью (Минск), чтобы не получить
  // одноимённую улицу в РФ.
  const query = `${addr}, Минск, Беларусь`;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=by&language=ru&key=${GOOGLE_KEY}`;
  try {
    const res = await fetch(url);
    const j = await res.json();
    if (j.status === "OK" && j.results?.[0]?.geometry?.location) {
      const { lat, lng } = j.results[0].geometry.location;
      // Минск примерно в [53.7..54.0, 27.3..27.8]. Если выпали — null.
      if (lat >= 53.7 && lat <= 54.05 && lng >= 27.3 && lng <= 27.85) {
        geoCache[key] = { lat, lng, formatted: j.results[0].formatted_address };
      } else {
        geoCache[key] = null;
      }
    } else {
      geoCache[key] = null;
    }
  } catch (e) {
    geoCache[key] = null;
  }
  geoCacheDirty = true;
  await new Promise((r) => setTimeout(r, 50)); // rate-limit
  return geoCache[key];
}

// Оценка времени поездки в Минске (≈24 км/ч с учётом светофоров и пробок).
// Минимум 5 минут — даже на 1 км в плотном городе. То же, что в фронте.
function estimateTripMin(km) {
  if (!isFinite(km) || km <= 0) return null;
  return Math.max(5, Math.round(km * 2.5));
}

// Минск: 9 районов, приближённые центры (geo-минимум для группировки)
const DISTRICTS = [
  { id: "center",       name: "Центральный",  lat: 53.9075, lng: 27.5588 },
  { id: "sovetsky",     name: "Советский",    lat: 53.9163, lng: 27.6024 },
  { id: "pervomaysky",  name: "Первомайский", lat: 53.9358, lng: 27.6256 },
  { id: "partizansky",  name: "Партизанский", lat: 53.8978, lng: 27.6594 },
  { id: "zavodskoy",    name: "Заводский",    lat: 53.8556, lng: 27.6261 },
  { id: "leninsky",     name: "Ленинский",    lat: 53.8717, lng: 27.6011 },
  { id: "oktyabrsky",   name: "Октябрьский",  lat: 53.8514, lng: 27.5547 },
  { id: "moskovsky",    name: "Московский",   lat: 53.8636, lng: 27.4961 },
  { id: "frunzensky",   name: "Фрунзенский",  lat: 53.8997, lng: 27.4758 },
];

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function districtFor(lat, lng) {
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return "";
  let best = null, bestD = Infinity;
  for (const d of DISTRICTS) {
    const dist = haversineKm(lat, lng, d.lat, d.lng);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return best ? best.name : "";
}

function fmtIsoToLocal(iso) {
  if (!iso) return "";
  // "2026-04-25 04:37:59+00:00" → Date
  const d = new Date(iso.replace(" ", "T"));
  if (isNaN(d.getTime())) return iso;
  // Минск UTC+3
  const m = new Date(d.getTime() + 3 * 3600 * 1000);
  return m.toISOString().replace("T", " ").slice(0, 19); // "2026-04-25 07:37:59"
}

function pickTariff(tariffs, ...names) {
  if (!Array.isArray(tariffs)) return null;
  const ln = names.map((n) => n.toLowerCase());
  return tariffs.find((t) => ln.includes(String(t.name || "").toLowerCase())) || null;
}

// ============= 1) YANDEX из processed/*.raw.json =============
const yandexRows = [];
const tariffLog = []; // sheet 3

const rawFiles = readdirSync(SCREENS).filter((f) => f.endsWith(".raw.json"));
console.log(`raw files: ${rawFiles.length}`);

// PRE-PASS: собрать все уникальные адреса и геокодировать их пакетом.
// Геокод нужен потому что в .raw.json от vision-парсера geocode = null —
// модель распознаёт только текстовые адреса, координаты добавляем здесь.
const uniqAddrs = new Set();
for (const f of rawFiles) {
  let raw; try { raw = JSON.parse(readFileSync(join(SCREENS, f), "utf8")); } catch { continue; }
  if (raw.stage !== "ok" || !raw.parsed?.isTaxiApp) continue;
  if (raw.parsed.fromAddress) uniqAddrs.add(raw.parsed.fromAddress.trim());
  if (raw.parsed.toAddress)   uniqAddrs.add(raw.parsed.toAddress.trim());
}
if (!GOOGLE_KEY) {
  console.warn(`! GOOGLE_MAPS_KEY не задан — геокодинг пропущен, distKm останется null. Запусти: GOOGLE_MAPS_KEY=... node ${basename(process.argv[1])}`);
} else {
  console.log(`Геокодинг: ${uniqAddrs.size} уникальных адресов (Google Maps + кеш ${Object.keys(geoCache).length})...`);
  let done = 0, hits = 0, miss = 0;
  for (const a of uniqAddrs) {
    const before = geoCache[a.toLowerCase()] !== undefined;
    const r = await geocode(a);
    if (before) hits++; else miss++;
    if (++done % 25 === 0) { persistGeoCache(); console.log(`  ${done}/${uniqAddrs.size} (cache hit ${hits}, fetched ${miss})`); }
  }
  persistGeoCache();
  console.log(`Геокодинг готов: ${Object.keys(geoCache).length} адресов в кеше.`);
}

// Lookup из накопленного кеша для основного цикла.
function geo(addr) {
  if (!addr) return null;
  return geoCache[String(addr).trim().toLowerCase()] || null;
}

for (const f of rawFiles) {
  let raw;
  try { raw = JSON.parse(readFileSync(join(SCREENS, f), "utf8")); }
  catch (e) { continue; }
  if (raw.stage !== "ok" || !raw.parsed) continue;
  const p = raw.parsed;
  if (!p.isTaxiApp) continue;

  // meta (если есть)
  const metaName = f.replace(".raw.json", ".meta.json");
  let meta = {};
  try { meta = JSON.parse(readFileSync(join(SCREENS, metaName), "utf8")); }
  catch {}

  // время формирования заказа: meta.uploadedAt (ISO UTC) → локальное Минск
  const uploadedLocal = meta.uploadedAt ? fmtIsoToLocal(meta.uploadedAt.replace("Z", "+00:00")) : "";
  // или из имени файла calib-2026-04-27-h20-XXX → "2026-04-27 20:00 (приближённо)"
  const fnameMatch = f.match(/(\d{4}-\d{2}-\d{2})-h(\d{1,2})-/);
  const fnameDate = fnameMatch ? `${fnameMatch[1]} ${fnameMatch[2].padStart(2, "0")}:00` : "";

  const fromAddr = p.fromAddress || "";
  const toAddr = p.toAddress || "";
  // Координаты: сначала из vision parser (если когда-то появятся), потом из
  // нашего geo-кеша по тексту адреса.
  const gFrom = geo(fromAddr);
  const gTo = geo(toAddr);
  const fLat = p.geocode?.from?.lat ?? gFrom?.lat ?? null;
  const fLng = p.geocode?.from?.lng ?? gFrom?.lng ?? null;
  const tLat = p.geocode?.to?.lat ?? gTo?.lat ?? null;
  const tLng = p.geocode?.to?.lng ?? gTo?.lng ?? null;

  const distKm = (fLat && tLat) ? +haversineKm(fLat, fLng, tLat, tLng).toFixed(2) : null;
  // Источник км: координаты от vision = "Yandex", геокод = "карта", иначе пусто.
  const distSrc = (fLat && tLat)
    ? (p.geocode?.from?.lat ? "Yandex" : "карта")
    : "";

  const econ = pickTariff(p.tariffs, "Эконом", "Econom");
  const cmf  = pickTariff(p.tariffs, "Комфорт", "Comfort");
  const cmfPlus = pickTariff(p.tariffs, "Комфорт+", "Comfort+");
  const biz  = pickTariff(p.tariffs, "Бизнес", "Business");
  const electro = pickTariff(p.tariffs, "Электро", "Electro");

  // surge / всплеск: либо tariff.surge !== null, либо demandColor in {yellow,red,orange}
  const surgeFromTariff = (p.tariffs || []).map((t) => t.surge).find((s) => s != null);
  const surge = surgeFromTariff != null ? surgeFromTariff
              : (["yellow", "orange", "red"].includes(p.demandColor) ? `повышенный (${p.demandColor})` : "нет");

  // Время в пути: 1) первый non-null tariff.tripMin (после reparse будет почти
  // во всех скринах); 2) p.tripMinToDest (новое поле от обновлённого vision);
  // 3) оценка по км и средней скорости 24 км/ч в Минске (фоллбек, чтобы не
  // оставлять столбец пустым).
  const tripMinFromTariff = (p.tariffs || []).map((t) => t.tripMin).find((m) => m != null);
  const tripMinFromTopLevel = isFinite(p.tripMinToDest) && p.tripMinToDest > 0 ? p.tripMinToDest : null;
  const tripMinReal = tripMinFromTariff ?? tripMinFromTopLevel ?? null;
  const tripMin = tripMinReal ?? estimateTripMin(distKm);
  const tripMinSrc = tripMinReal != null ? "Yandex" : (tripMin != null ? "оценка" : "");

  yandexRows.push({
    file: f,
    uploadedAt: uploadedLocal || fnameDate,
    screenLocalTime: p.screenLocalTime || "",
    appName: p.appName || "Yandex Go",
    fromAddr: p.geocode?.from?.formatted || gFrom?.formatted || fromAddr,
    toAddr:   p.geocode?.to?.formatted   || gTo?.formatted   || toAddr,
    fromDistrict: districtFor(fLat, fLng),
    toDistrict:   districtFor(tLat, tLng),
    distKmHaversine: distKm,
    distSrc,
    tripMin,
    tripMinSrc,
    surge,
    demandColor: p.demandColor || "",
    priceEcon: econ?.priceBYN ?? null,
    etaEcon:   econ?.etaMin   ?? null,
    priceCmf:  cmf?.priceBYN  ?? null,
    etaCmf:    cmf?.etaMin    ?? null,
    priceCmfPlus: cmfPlus?.priceBYN ?? null,
    priceBiz:  biz?.priceBYN  ?? null,
    priceElectro: electro?.priceBYN ?? null,
    uploaderIp: meta.uploaderIp || "",
  });

  // tariff log (sheet 3)
  for (const t of (p.tariffs || [])) {
    tariffLog.push({
      source: "Yandex (скрин)",
      time: uploadedLocal || fnameDate,
      who: meta.uploaderIp || "(нет meta)",
      tariff: t.name,
      priceBYN: t.priceBYN ?? null,
      etaMin: t.etaMin ?? null,
      tripMin: t.tripMin ?? null,
      surge: t.surge ?? null,
      from: fromAddr,
      to: toAddr,
    });
  }
}
yandexRows.sort((a, b) => (a.uploadedAt || "").localeCompare(b.uploadedAt || ""));
{
  const n = yandexRows.length;
  const km = yandexRows.filter((r) => r.distKmHaversine != null).length;
  const tm = yandexRows.filter((r) => r.tripMin != null).length;
  const tmYa = yandexRows.filter((r) => r.tripMinSrc === "Yandex").length;
  const tmEs = yandexRows.filter((r) => r.tripMinSrc === "оценка").length;
  console.log(`Yandex: ${n} строк, км заполнено ${km}/${n}, время в пути ${tm}/${n} (Yandex ${tmYa}, оценка ${tmEs})`);
}

// ============= 2) ВБ из aggregated.jsonl =============
// carClass code → имя (известные WB classes)
const CAR_CLASS = {
  "644": "Эконом",
  "645": "Комфорт",
  "646": "Комфорт+",
  "647": "Бизнес",
  "648": "Минивэн",
  "649": "Премиум",
  "650": "Доставка",
};
const tariffName = (code) => CAR_CLASS[code] || code || "";

const wbRows = [];
const wbLines = readFileSync(WB_FILE, "utf8").split("\n").filter((l) => l.trim());
console.log(`WB lines: ${wbLines.length}`);

for (const ln of wbLines) {
  let o;
  try { o = JSON.parse(ln); } catch { continue; }
  const created = fmtIsoToLocal(o.createdAt);
  const cancelled = fmtIsoToLocal(o.cancelledAt);

  // время в пути: cancelledAt - createdAt (минуты), только если completed
  let tripMin = null;
  if (o.createdAt && o.cancelledAt) {
    const c = new Date(o.createdAt.replace(" ", "T"));
    const e = new Date(o.cancelledAt.replace(" ", "T"));
    if (!isNaN(c.getTime()) && !isNaN(e.getTime())) {
      tripMin = Math.round((e.getTime() - c.getTime()) / 60000);
    }
  }

  const tariffCreate = tariffName(o.carClassCreate);
  const tariffAppoint = tariffName(o.carClassAppoint);

  wbRows.push({
    orderId: o.orderId,
    createdAt: created,
    finishedAt: cancelled,
    status: o.status || "",
    fromAddr: "(только координаты)",
    toAddr:   "(только координаты)",
    fromDistrict: districtFor(o.latIn, o.lngIn),
    toDistrict:   districtFor(o.latOut, o.lngOut),
    latIn: o.latIn ?? null,
    lngIn: o.lngIn ?? null,
    latOut: o.latOut ?? null,
    lngOut: o.lngOut ?? null,
    km: (o.km ?? (o.latIn && o.latOut ? +haversineKm(o.latIn, o.lngIn, o.latOut, o.lngOut).toFixed(2) : null)),
    tripMin,
    surge: "(нет данных)",
    tariffOrdered: tariffCreate,
    tariffAssigned: tariffAppoint,
    gmvBYN: o.gmv ?? null,
    pricePromo: o.pricePromo ?? null,
    paymentType: o.paymentType ?? "",
    clientId: o.clientId ?? "",
    driverId: o.driverId ?? "",
    isNow: o.isNow === "1" || o.isNow === 1 ? "сейчас" : "пред.",
    source: o.source || "",
  });

  // tariff log (sheet 3)
  tariffLog.push({
    source: "ВБ (заказ)",
    time: created,
    who: `client:${o.clientId || ""} / driver:${o.driverId || ""}`,
    tariff: tariffCreate,
    priceBYN: o.gmv ?? null,
    etaMin: null,
    tripMin,
    surge: null,
    from: districtFor(o.latIn, o.lngIn),
    to: districtFor(o.latOut, o.lngOut),
  });
}
wbRows.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
tariffLog.sort((a, b) => (a.time || "").localeCompare(b.time || ""));

// ============= 3) XLSX =============
const wb = new ExcelJS.Workbook();
wb.creator = "rwbtaxi.by export";
wb.created = new Date();

function addSheet(name, columns, rows, freezeCol = 2) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: freezeCol, ySplit: 1 }] });
  ws.columns = columns;
  ws.addRows(rows);
  // header style
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  // alt rows
  for (let i = 2; i <= rows.length + 1; i++) {
    if (i % 2 === 0) {
      ws.getRow(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F7F7" } };
    }
  }
}

// Sheet 1: Yandex
addSheet("Yandex (скрины)", [
  { header: "Время загрузки (Минск)", key: "uploadedAt", width: 22 },
  { header: "Время на экране",       key: "screenLocalTime", width: 14 },
  { header: "Приложение",            key: "appName", width: 12 },
  { header: "Адрес A",               key: "fromAddr", width: 50 },
  { header: "Адрес B",               key: "toAddr", width: 50 },
  { header: "Район A",               key: "fromDistrict", width: 16 },
  { header: "Район B",               key: "toDistrict", width: 16 },
  { header: "Расстояние, км",        key: "distKmHaversine", width: 14 },
  { header: "Источник км",           key: "distSrc", width: 12 },
  { header: "Время в пути, мин",     key: "tripMin", width: 18 },
  { header: "Источник времени",      key: "tripMinSrc", width: 16 },
  { header: "Всплеск/повышение",     key: "surge", width: 22 },
  { header: "Цвет спроса",           key: "demandColor", width: 12 },
  { header: "Эконом, BYN",           key: "priceEcon", width: 12 },
  { header: "Эконом ETA, мин",       key: "etaEcon", width: 14 },
  { header: "Комфорт, BYN",          key: "priceCmf", width: 13 },
  { header: "Комфорт ETA, мин",      key: "etaCmf", width: 16 },
  { header: "Комфорт+, BYN",         key: "priceCmfPlus", width: 14 },
  { header: "Бизнес, BYN",           key: "priceBiz", width: 12 },
  { header: "Электро, BYN",          key: "priceElectro", width: 13 },
  { header: "IP загрузившего",       key: "uploaderIp", width: 16 },
  { header: "Файл скрина",           key: "file", width: 50 },
], yandexRows, 2);

// Sheet 2: WB
addSheet("ВБ (заказы)", [
  { header: "ID заказа",        key: "orderId", width: 12 },
  { header: "Создан (Минск)",   key: "createdAt", width: 21 },
  { header: "Завершён (Минск)", key: "finishedAt", width: 21 },
  { header: "Статус",           key: "status", width: 12 },
  { header: "Адрес A",          key: "fromAddr", width: 22 },
  { header: "Адрес B",          key: "toAddr", width: 22 },
  { header: "Район A",          key: "fromDistrict", width: 16 },
  { header: "Район B",          key: "toDistrict", width: 16 },
  { header: "Lat A",            key: "latIn", width: 11 },
  { header: "Lng A",            key: "lngIn", width: 11 },
  { header: "Lat B",            key: "latOut", width: 11 },
  { header: "Lng B",            key: "lngOut", width: 11 },
  { header: "Расстояние, км",   key: "km", width: 14 },
  { header: "Длит. (заказ→зав.), мин", key: "tripMin", width: 22 },
  { header: "Всплеск",          key: "surge", width: 14 },
  { header: "Тариф (заказан)",  key: "tariffOrdered", width: 16 },
  { header: "Тариф (назначен)", key: "tariffAssigned", width: 16 },
  { header: "GMV, BYN",         key: "gmvBYN", width: 12 },
  { header: "Промо, BYN",       key: "pricePromo", width: 12 },
  { header: "Тип оплаты",       key: "paymentType", width: 11 },
  { header: "Клиент ID",        key: "clientId", width: 12 },
  { header: "Водитель ID",      key: "driverId", width: 12 },
  { header: "Сейчас/Предзак.",  key: "isNow", width: 14 },
  { header: "Источник",         key: "source", width: 14 },
], wbRows, 2);

// Sheet 3: Кто-когда-с-каким-тарифом
addSheet("Сводка тарифов", [
  { header: "Источник",      key: "source", width: 16 },
  { header: "Время (Минск)", key: "time", width: 21 },
  { header: "Кто",           key: "who", width: 32 },
  { header: "Тариф",         key: "tariff", width: 14 },
  { header: "Цена, BYN",     key: "priceBYN", width: 12 },
  { header: "ETA, мин",      key: "etaMin", width: 10 },
  { header: "Время в пути, мин", key: "tripMin", width: 18 },
  { header: "Surge",         key: "surge", width: 10 },
  { header: "Откуда",        key: "from", width: 24 },
  { header: "Куда",          key: "to", width: 24 },
], tariffLog, 2);

// Sheet 4: README / расшифровка
const readme = wb.addWorksheet("Описание");
readme.addRows([
  ["Файл сформирован автоматически по данным VPS rwbtaxi.by"],
  ["Дата выгрузки", new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"],
  [""],
  ["Лист 1 — «Yandex (скрины)»"],
  ["Источник", "/var/www/rwbtaxi/data/screens/processed/*.raw.json"],
  ["Кол-во строк", yandexRows.length],
  ["Колонки", "Адреса/тарифы — то, что Gemini Vision распознал на скриншотах Yandex Go"],
  ["Расстояние", "Прямая (haversine) между coordinates from/to. Не реальный маршрут"],
  ["Время в пути", "tripMin часто отсутствует в скрине Yandex (показывает только цену)"],
  ["Всплеск", "По полю tariffs[].surge или demandColor (yellow/orange/red в иконке спроса)"],
  [""],
  ["Лист 2 — «ВБ (заказы)»"],
  ["Источник", "/var/www/rwbtaxi/data/wb/aggregated.jsonl"],
  ["Кол-во строк", wbRows.length],
  ["Адреса", "В исходных данных нет — только координаты latIn/lngIn/latOut/lngOut. Район определён по ближайшему центру 9 районов Минска"],
  ["Длительность", "cancelledAt − createdAt в минутах (для cancelled это время до отмены, для completed — фактическая длительность)"],
  ["Всплеск", "В выгрузке ВБ нет данных о повышении тарифа"],
  ["Тариф (заказан/назначен)", "carClassCreate / carClassAppoint, расшифровка: 644=Эконом, 645=Комфорт, 646=Комфорт+, 647=Бизнес"],
  [""],
  ["Лист 3 — «Сводка тарифов»"],
  ["Описание", "Кто (IP загрузившего скрин или ID клиента/водителя ВБ) — когда — какой тариф — по какой цене"],
  ["Кол-во строк", tariffLog.length],
  [""],
  ["Районы Минска (приближённые центры для группировки)"],
  ...DISTRICTS.map(d => [d.name, `${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}`]),
]);
readme.getColumn(1).width = 32;
readme.getColumn(2).width = 80;
readme.getRow(1).font = { bold: true, size: 14 };

await wb.xlsx.writeFile(OUT);
console.log(`\n✓ Готово: ${OUT}`);
console.log(`  Yandex: ${yandexRows.length} скринов`);
console.log(`  ВБ:     ${wbRows.length} заказов`);
console.log(`  Лог тарифов: ${tariffLog.length} записей`);
