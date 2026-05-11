// Хендлер /screens-map для админ-карты скриншотов Yandex Go (за последние N дней).
// Читает calib-*.json (id, fromLat/Lng, fromAddress, factE/C, demand, tripMin)
// и опционально подгружает raw.json для полного списка тарифов и demandColor.
// Картинки скринов лежат в SCREENS_DIR и раздаются nginx alias'ом /data/screens/.
//
// Эндпоинты:
//   GET /screens-map?days=7        — список точек (без тарифов, лёгкий)
//   GET /screens-map?days=7&full=1 — список с тарифами+demandColor (тяжелее)

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CALIB_DIR = process.env.CALIB_DIR || "/var/www/rwbtaxi/data/calib";
const SCREENS_DIR =
  process.env.SCREENS_DIR || "/var/www/rwbtaxi/data/screens/processed";
const SCREEN_EXTS = ["png", "jpg", "jpeg", "webp"];

function findScreenExt(id) {
  for (const e of SCREEN_EXTS) {
    if (existsSync(join(SCREENS_DIR, `${id}.${e}`))) return e;
  }
  return null;
}

async function readRaw(id) {
  try {
    const buf = await readFile(join(SCREENS_DIR, `${id}.raw.json`), "utf8");
    return JSON.parse(buf);
  } catch {
    return null;
  }
}

export async function handleScreensMap(req, res, jsonResponse) {
  const url = new URL(req.url, `http://${req.headers.host || "x"}`);
  const days = Math.max(
    1,
    Math.min(30, Number(url.searchParams.get("days")) || 7),
  );
  const full = url.searchParams.get("full") === "1";
  const cutoffMs = Date.now() - days * 24 * 3600 * 1000;

  let names = [];
  try {
    names = await readdir(CALIB_DIR);
  } catch {
    return jsonResponse(res, 200, {
      ok: true,
      total: 0,
      days,
      items: [],
      note: "calib_dir_missing",
    });
  }

  const items = [];
  for (const name of names) {
    if (!name.startsWith("calib-") || !name.endsWith(".json")) continue;
    let j;
    try {
      j = JSON.parse(await readFile(join(CALIB_DIR, name), "utf8"));
    } catch {
      continue;
    }
    const ts = new Date(j.uploadedAt || j.receivedAt || 0).getTime();
    if (!ts || ts < cutoffMs) continue;
    if (!Number.isFinite(Number(j.fromLat)) || !Number.isFinite(Number(j.fromLng)))
      continue;

    const id = String(j.id || name.replace(/\.json$/, ""));
    const ext = findScreenExt(id);
    if (!ext) continue;

    const item = {
      id,
      uploadedAt: String(j.uploadedAt || j.receivedAt || ""),
      fromAddress: String(j.fromAddress || ""),
      fromAddressGeo: String(j.fromAddressGeo || ""),
      fromLat: Number(j.fromLat),
      fromLng: Number(j.fromLng),
      toAddress: String(j.toAddress || ""),
      toAddressGeo: String(j.toAddressGeo || ""),
      toLat: Number.isFinite(Number(j.toLat)) ? Number(j.toLat) : null,
      toLng: Number.isFinite(Number(j.toLng)) ? Number(j.toLng) : null,
      factE: typeof j.factE === "number" ? j.factE : null,
      factC: typeof j.factC === "number" ? j.factC : null,
      etaMin: typeof j.etaMin === "number" ? j.etaMin : null,
      tripMin: typeof j.tripMin === "number" ? j.tripMin : null,
      demand: j.demand ?? null,
      screenUrl: `/data/screens/${id}.${ext}`,
      anomaly: j.anomaly
        ? {
            suspicious: Boolean(j.anomaly.suspicious),
            severity: String(j.anomaly.severity || ""),
            reason: String(j.anomaly.reason || "").slice(0, 300),
          }
        : null,
    };

    if (full) {
      const raw = await readRaw(id);
      if (raw?.parsed) {
        item.tariffs = Array.isArray(raw.parsed.tariffs)
          ? raw.parsed.tariffs.map((t) => ({
              name: String(t.name || ""),
              price: typeof t.price === "number" ? t.price : null,
              surge: typeof t.surge === "number" ? t.surge : null,
              tripMin: typeof t.tripMin === "number" ? t.tripMin : null,
            }))
          : null;
        item.demandColor = raw.parsed.demandColor || null;
      }
    }

    items.push(item);
  }

  items.sort((a, b) =>
    a.uploadedAt < b.uploadedAt ? 1 : a.uploadedAt > b.uploadedAt ? -1 : 0,
  );

  return jsonResponse(res, 200, {
    ok: true,
    total: items.length,
    days,
    full,
    items,
  });
}

// Детали по одному id — тяжёлая раскрутка raw.json. Дёргается из попапа маркера.
export async function handleScreensMapDetails(req, res, jsonResponse) {
  const url = new URL(req.url, `http://${req.headers.host || "x"}`);
  const id = String(url.searchParams.get("id") || "");
  if (!/^calib-[a-z0-9-]+$/i.test(id)) {
    return jsonResponse(res, 400, { ok: false, error: "bad_id" });
  }
  let j;
  try {
    j = JSON.parse(await readFile(join(CALIB_DIR, `${id}.json`), "utf8"));
  } catch {
    return jsonResponse(res, 404, { ok: false, error: "not_found" });
  }
  const raw = await readRaw(id);
  const ext = findScreenExt(id);
  return jsonResponse(res, 200, {
    ok: true,
    item: {
      id,
      uploadedAt: j.uploadedAt || j.receivedAt || "",
      fromAddress: j.fromAddress || "",
      fromAddressGeo: j.fromAddressGeo || "",
      toAddress: j.toAddress || "",
      toAddressGeo: j.toAddressGeo || "",
      fromLat: j.fromLat ?? null,
      fromLng: j.fromLng ?? null,
      toLat: j.toLat ?? null,
      toLng: j.toLng ?? null,
      factE: j.factE ?? null,
      factC: j.factC ?? null,
      etaMin: j.etaMin ?? null,
      tripMin: j.tripMin ?? null,
      demand: j.demand ?? null,
      demandColor: raw?.parsed?.demandColor ?? null,
      tariffs: raw?.parsed?.tariffs ?? null,
      anomaly: j.anomaly ?? null,
      screenUrl: ext ? `/data/screens/${id}.${ext}` : null,
    },
  });
}
