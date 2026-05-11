#!/usr/bin/env node
// Минимальный приёмник калибровочных замеров от сотрудников.
// Слушает 127.0.0.1:PORT (по умолчанию 3010), nginx проксирует /api/calib/ -> сюда.
// Принимает POST /submit с JSON-замером и пишет файл в CALIB_DIR.
// Никаких внешних npm-зависимостей — только node:http/fs/crypto.

import { createServer } from "node:http";
import { writeFile, mkdir, readdir, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

const PORT = Number(process.env.PORT || 3010);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = process.env.CALIB_DIR || "/var/www/rwbtaxi/data/calib";
const TOKEN = process.env.CALIB_TOKEN || ""; // если пусто — endpoint открытый
const MAX_BODY = 32 * 1024; // 32 KB
const RATE_LIMIT_PER_MIN = Number(process.env.CALIB_RATE_LIMIT || 60);

await mkdir(DATA_DIR, { recursive: true });

// ───────────── rate limiter (in-memory, per-IP) ─────────────
const hits = new Map(); // ip -> [timestamp, ...]
function tooManyRequests(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_LIMIT_PER_MIN;
}

// ───────────── helpers ─────────────
function jsonResponse(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Calib-Token",
  });
  res.end(JSON.stringify(body));
}

function isFiniteNum(v, min, max) {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

function validate(p) {
  const errors = [];
  if (typeof p.fromAddress !== "string" || p.fromAddress.trim().length < 2) errors.push("fromAddress");
  if (typeof p.toAddress !== "string" || p.toAddress.trim().length < 2) errors.push("toAddress");
  if (!isFiniteNum(p.fromLat, 53.7, 54.1)) errors.push("fromLat");
  if (!isFiniteNum(p.fromLng, 27.3, 27.8)) errors.push("fromLng");
  if (!isFiniteNum(p.toLat, 53.7, 54.1)) errors.push("toLat");
  if (!isFiniteNum(p.toLng, 27.3, 27.8)) errors.push("toLng");
  const haveE = isFiniteNum(p.factE, 0.5, 500);
  const haveC = isFiniteNum(p.factC, 0.5, 500);
  if (!haveE && !haveC) errors.push("factE_or_factC");
  if (p.factE != null && !haveE) errors.push("factE");
  if (p.factC != null && !haveC) errors.push("factC");
  if (p.etaMin != null && !isFiniteNum(p.etaMin, 0, 60)) errors.push("etaMin");
  if (p.tripMin != null && !isFiniteNum(p.tripMin, 0, 240)) errors.push("tripMin");
  if (p.km != null && !isFiniteNum(p.km, 0, 200)) errors.push("km");
  if (typeof p.demand !== "string" || !["green", "yellow", "red"].includes(p.demand)) errors.push("demand");
  if (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) errors.push("date");
  if (!isFiniteNum(p.hour, 0, 23)) errors.push("hour");
  return errors;
}

function clientIp(req) {
  // nginx: proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  // → если клиент прислал свой XFF, его IP в начале, наш доверенный nginx добавляет
  // реальный client IP в КОНЕЦ. Берём последний (spoof-resistant).
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) {
    const parts = xf.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress || "unknown";
}

// Защита от роста hits Map (и от бесполезных записей за окном rate-limit).
// Чистим раз в минуту: удаляем IP без свежих хитов.
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) {
    const fresh = arr.filter((t) => now - t < 60_000);
    if (!fresh.length) hits.delete(ip);
    else if (fresh.length !== arr.length) hits.set(ip, fresh);
  }
}, 60_000).unref();

// ───────────── handlers ─────────────
async function handleSubmit(req, res) {
  if (TOKEN && req.headers["x-calib-token"] !== TOKEN) {
    return jsonResponse(res, 401, { ok: false, error: "bad_token" });
  }

  let body = "";
  let killed = false;
  await new Promise((resolve) => {
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        killed = true;
        req.destroy();
        resolve();
      }
    });
    req.on("end", resolve);
    req.on("error", resolve);
  });
  if (killed) return jsonResponse(res, 413, { ok: false, error: "payload_too_large" });

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return jsonResponse(res, 400, { ok: false, error: "bad_json" });
  }

  const errors = validate(payload);
  if (errors.length) return jsonResponse(res, 400, { ok: false, error: "invalid", fields: errors });

  const id = `calib-${payload.date}-h${String(payload.hour).padStart(2, "0")}-${randomBytes(3).toString("hex")}`;
  const record = {
    id,
    receivedAt: new Date().toISOString(),
    receivedFromIp: clientIp(req),
    ...payload,
  };
  const filename = join(DATA_DIR, `${id}.json`);
  try {
    await writeFile(filename, JSON.stringify(record, null, 2));
  } catch (e) {
    console.error("[calib-receiver] write failed:", e);
    return jsonResponse(res, 500, { ok: false, error: "write_failed" });
  }
  console.log(`[calib-receiver] saved ${id} (${payload.fromAddress} → ${payload.toAddress})`);
  return jsonResponse(res, 200, { ok: true, id });
}

async function handleStats(_req, res) {
  try {
    const files = (await readdir(DATA_DIR)).filter((f) => f.startsWith("calib-") && f.endsWith(".json"));
    const today = new Date().toISOString().slice(0, 10);
    let todayCount = 0;
    let lastReceivedAt = null;
    for (const f of files) {
      try {
        const rec = JSON.parse(await readFile(join(DATA_DIR, f), "utf8"));
        if (rec.date === today) todayCount += 1;
        if (rec.receivedAt && (!lastReceivedAt || rec.receivedAt > lastReceivedAt)) {
          lastReceivedAt = rec.receivedAt;
        }
      } catch {
        /* skip */
      }
    }
    return jsonResponse(res, 200, {
      ok: true,
      total: files.length,
      today: todayCount,
      lastReceivedAt,
    });
  } catch (e) {
    return jsonResponse(res, 500, { ok: false, error: "stats_failed" });
  }
}

// ───────────── server ─────────────
const server = createServer(async (req, res) => {
  const ip = clientIp(req);

  if (req.method === "OPTIONS") return jsonResponse(res, 204, {});

  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    return jsonResponse(res, 200, { ok: true, service: "rwbtaxi-calib-receiver" });
  }

  if (tooManyRequests(ip)) {
    return jsonResponse(res, 429, { ok: false, error: "rate_limited" });
  }

  if (req.method === "GET" && req.url === "/stats") return handleStats(req, res);
  if (req.method === "POST" && req.url === "/submit") return handleSubmit(req, res);

  return jsonResponse(res, 404, { ok: false, error: "not_found" });
});

server.listen(PORT, HOST, () => {
  console.log(
    `[calib-receiver] listening on ${HOST}:${PORT}, dir=${DATA_DIR}, token=${TOKEN ? "on" : "off"}, rl=${RATE_LIMIT_PER_MIN}/min`,
  );
});
