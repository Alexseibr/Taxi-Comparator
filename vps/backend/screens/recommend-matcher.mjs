// recommend-matcher.mjs — связка «клик на рекомендацию ↔ загруженный скрин».
//
// ИДЕЯ. Когда таксист тапает в нашем приложении пару А→Б из списка
// «Рекомендованные адреса», мы уже знаем (на сервере /reserve):
//   • точные координаты А и Б (из anchors-minsk.json),
//   • расстояние,
//   • IP клиента,
//   • когда тапнул.
// Через 1-3 минуты он делает скрин Yandex Go и грузит обратно. Скрин
// проходит OCR → geocode (gemini-vision + Google Geocode) и попадает в
// calib JSON. Адрес со скрина может быть обрезан («Алеся Гару…»),
// геокод может промахнуться на район — но мы-то уже ЗНАЕМ что это была
// та самая «Корона Каменная Горка → Серебрянка, 11.2 км». Этот модуль:
//
//   1) recordClick(...)   — при /reserve пишем click-<ts>-<ipHash>.json
//                           в /var/www/rwbtaxi/data/recommendations/.
//                           Файлы старше CLICK_TTL_MS удаляются лениво.
//   2) tryMatchCalib(...) — читает все click-файлы за последние
//                           ~MATCH_WINDOW_MS до calib.uploadedAt с тем же
//                           IP, выбирает ближайший по координатам,
//                           возвращает объект matchedRecommendation
//                           для записи в calib JSON.
//
// Связка ТОЛЬКО по IP (telegram_id у нас сейчас нет в скриновом
// пайплайне). Для NAT/моб.операторов это даёт ~80% попаданий —
// false-match режим уменьшаем коротким окном (3 мин по умолчанию)
// и проверкой расстояния <300/500м между ожидаемыми и распознанными
// координатами А/Б.

import { mkdir, readdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const CLICKS_DIR = "/var/www/rwbtaxi/data/recommendations";
const CLICK_TTL_MS = 30 * 60 * 1000;  // 30 минут — потом файл удаляется
const MATCH_WINDOW_MS = 3 * 60 * 1000; // 3 мин — окно для матча скрина с кликом
const MATCH_FROM_M_HIGH = 300;
const MATCH_TO_M_HIGH = 500;
const MATCH_FROM_M_MED = 600;
const MATCH_TO_M_MED = 1000;

let _cleanupAtMs = 0;

function ensureDir() {
  if (!existsSync(CLICKS_DIR)) {
    return mkdir(CLICKS_DIR, { recursive: true });
  }
  return null;
}

function ipHash6(ip) {
  return createHash("sha256").update(String(ip || "unknown")).digest("hex").slice(0, 6);
}

// Лениво (не чаще раза в 60с) сносим устаревшие click-*.json.
// Так не приходится держать отдельный cron, и под нагрузкой работа
// размазывается по запросам.
async function maybeCleanup(nowMs) {
  if (nowMs - _cleanupAtMs < 60_000) return;
  _cleanupAtMs = nowMs;
  try {
    const files = await readdir(CLICKS_DIR);
    const cutoff = nowMs - CLICK_TTL_MS;
    for (const f of files) {
      if (!f.startsWith("click-") || !f.endsWith(".json")) continue;
      const fp = join(CLICKS_DIR, f);
      try {
        const st = await stat(fp);
        if (st.mtimeMs < cutoff) await unlink(fp);
      } catch {}
    }
  } catch {}
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    return Infinity;
  }
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Записать клик. Вызывается из handleReserve в screen-receiver.mjs ПОСЛЕ
// успешной брони. Передавать «уже распарсенный» anchorFrom/anchorTo,
// чтобы не делать повторный JSON.parse anchors-minsk.json.
//
// args: { routeId, clientId, ip, anchorFrom, anchorTo, distanceKm }
//   anchorFrom / anchorTo = { id, name, lat, lng, address }
export async function recordClick({ routeId, clientId, ip, anchorFrom, anchorTo, distanceKm }) {
  if (!anchorFrom || !anchorTo) return;
  if (typeof anchorFrom.lat !== "number" || typeof anchorTo.lat !== "number") return;
  await ensureDir();
  const nowMs = Date.now();
  await maybeCleanup(nowMs);
  const rec = {
    routeId: String(routeId || ""),
    clientId: String(clientId || "").slice(0, 80),
    ip: String(ip || "unknown"),
    ipHash: ipHash6(ip),
    clickedAtMs: nowMs,
    clickedAt: new Date(nowMs).toISOString(),
    from: {
      name: anchorFrom.name,
      address: anchorFrom.address || "",
      lat: anchorFrom.lat,
      lng: anchorFrom.lng,
    },
    to: {
      name: anchorTo.name,
      address: anchorTo.address || "",
      lat: anchorTo.lat,
      lng: anchorTo.lng,
    },
    distanceKm: typeof distanceKm === "number" ? +distanceKm.toFixed(2) : null,
  };
  const fname = `click-${nowMs}-${rec.ipHash}.json`;
  try {
    await writeFile(join(CLICKS_DIR, fname), JSON.stringify(rec));
  } catch (e) {
    // не валим /reserve если диск умер
    console.warn(`[recommend-matcher] recordClick failed: ${e?.message || e}`);
  }
}

// Найти лучшую рекомендацию для свежего calib. Возвращает либо
// объект matchedRecommendation для записи в calib JSON, либо null.
//
// args: { uploadedAtMs, receivedFromIp, fromLat, fromLng, toLat, toLng }
export async function tryMatchCalib({ uploadedAtMs, receivedFromIp, fromLat, fromLng, toLat, toLng }) {
  if (typeof fromLat !== "number" || typeof toLat !== "number") return null;
  if (!receivedFromIp) return null;
  await ensureDir();
  const wantHash = ipHash6(receivedFromIp);
  const nowMs = uploadedAtMs || Date.now();
  const cutoffOld = nowMs - MATCH_WINDOW_MS;
  let files = [];
  try {
    files = await readdir(CLICKS_DIR);
  } catch {
    return null;
  }
  // Префильтр по имени файла (`click-<ts>-<ipHash6>.json`) — экономим
  // открытия. Под капотом ~максимум 30мин × частота кликов файлов,
  // итерация дешёвая.
  const candidates = [];
  for (const f of files) {
    if (!f.startsWith("click-") || !f.endsWith(".json")) continue;
    const m = /^click-(\d+)-([a-f0-9]{6})\.json$/.exec(f);
    if (!m) continue;
    const ts = +m[1];
    if (ts < cutoffOld || ts > nowMs + 5_000) continue; // окно: clicked ≤3мин до и не из будущего
    if (m[2] !== wantHash) continue;                    // тот же IP
    candidates.push({ ts, file: f });
  }
  if (!candidates.length) return null;
  // Читаем кандидатов и считаем расстояние до распознанных точек
  let best = null;
  for (const c of candidates) {
    let rec;
    try {
      rec = JSON.parse(await readFile(join(CLICKS_DIR, c.file), "utf8"));
    } catch { continue; }
    const fromM = haversineMeters(rec.from?.lat, rec.from?.lng, fromLat, fromLng);
    const toM   = haversineMeters(rec.to?.lat,   rec.to?.lng,   toLat,   toLng);
    // Score: сумма расстояний, чем меньше — тем лучше; при равенстве —
    // более свежий клик выигрывает (ближе к моменту скрина).
    const score = fromM + toM - (c.ts / 1e9); // tiebreaker: свежее = меньше score
    if (!best || score < best.score) {
      best = { rec, fromM, toM, ts: c.ts, score };
    }
  }
  if (!best) return null;
  // Threshold — иначе матч не считается реальным
  let confidence;
  if (best.fromM <= MATCH_FROM_M_HIGH && best.toM <= MATCH_TO_M_HIGH) confidence = "high";
  else if (best.fromM <= MATCH_FROM_M_MED && best.toM <= MATCH_TO_M_MED) confidence = "medium";
  else return null; // не матч — слишком далеко
  const r = best.rec;
  return {
    routeId: r.routeId,
    clickedAt: r.clickedAt,
    deltaMs: nowMs - r.clickedAtMs,
    expectedFromName: r.from?.name || "",
    expectedToName: r.to?.name || "",
    expectedFromLat: r.from?.lat,
    expectedFromLng: r.from?.lng,
    expectedToLat: r.to?.lat,
    expectedToLng: r.to?.lng,
    expectedDistanceKm: r.distanceKm,
    fromDistanceM: Math.round(best.fromM),
    toDistanceM: Math.round(best.toM),
    confidence,
  };
}
