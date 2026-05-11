#!/usr/bin/env node
// Догоняет точные адреса (улица + дом) для исторических calib-*.json через
// Google Reverse Geocoding по координатам fromLat/fromLng и toLat/toLng.
//
// Зачем: Vision (process-screens) часто отдаёт POI вместо адреса —
// «Дворец спорта», «Минск-Пасс», «Корона», «Комаровский». Для обучения
// модели и анализа «откуда заказы» нужен точный адрес. Координаты у нас
// уже есть (forward-geocoded ранее), осталось обратным запросом получить
// `formatted_address` с улицей и номером дома и записать в поля
// fromAddressGeo / toAddressGeo прямо в calib-*.json.
//
// Запуск НА VPS (там есть GOOGLE_MAPS_KEY):
//   node /opt/rwbtaxi-screens/enrich-addresses-vps.mjs                  # все файлы без fromAddressGeo
//   node /opt/rwbtaxi-screens/enrich-addresses-vps.mjs --force          # перезаписать всё (если хочется обновить)
//   node /opt/rwbtaxi-screens/enrich-addresses-vps.mjs --dry-run        # без запросов и записи
//   node /opt/rwbtaxi-screens/enrich-addresses-vps.mjs --limit=50       # обработать первые N (для теста)
//
// Цена: ~$0.005 на калиб-файл (2 reverse-geocode запроса).
// 215 файлов = ~$1.10. Лимит Google по умолчанию 50 req/sec — мы шлём по
// 8 req/sec последовательно, чтобы не упереться.

import { readFileSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { request } from "node:https";

const GOOGLE_KEY = process.env.GOOGLE_MAPS_KEY || process.env.GOOGLE_API_KEY;
if (!GOOGLE_KEY) {
  console.error("ERROR: ни GOOGLE_MAPS_KEY, ни GOOGLE_API_KEY не заданы");
  process.exit(1);
}
const CALIB_DIR = process.env.CALIB_DIR || "/var/www/rwbtaxi/data/calib";

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const DRY = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

function getJson(host, path, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    const req = request(
      { host, path, method: "GET", timeout: timeoutMs },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, body: null });
          }
        });
      },
    );
    req.on("error", (e) => resolve({ status: 0, body: null, error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, body: null, error: "timeout" });
    });
    req.end();
  });
}

const PRIORITY = ["street_address", "premise", "subpremise", "route"];

async function reverseGeocode(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  const r = await getJson(
    "maps.googleapis.com",
    `/maps/api/geocode/json?latlng=${lat},${lng}&language=ru&region=by&result_type=street_address|premise|subpremise|route&key=${encodeURIComponent(GOOGLE_KEY)}`,
  );
  if (
    r.status !== 200 ||
    r.body?.status !== "OK" ||
    !Array.isArray(r.body.results) ||
    r.body.results.length === 0
  ) {
    return "";
  }
  let best = null;
  let bestPrio = 99;
  for (const cand of r.body.results) {
    const types = Array.isArray(cand.types) ? cand.types : [];
    let prio = 99;
    for (let i = 0; i < PRIORITY.length; i++) {
      if (types.includes(PRIORITY[i])) prio = Math.min(prio, i);
    }
    if (prio < bestPrio) {
      bestPrio = prio;
      best = cand;
    }
  }
  if (!best) best = r.body.results[0];
  return String(best.formatted_address || "")
    .replace(/,?\s*Беларусь\s*$/i, "")
    .replace(/,?\s*Минск\s*$/i, "")
    .trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const all = readdirSync(CALIB_DIR)
    .filter((n) => n.startsWith("calib-") && n.endsWith(".json"))
    .sort();
  console.log(`[enrich] найдено ${all.length} calib-*.json в ${CALIB_DIR}`);

  let toProcess = 0;
  let done = 0;
  let okFrom = 0;
  let okTo = 0;
  let skipped = 0;
  let failed = 0;

  for (const name of all) {
    if (done >= LIMIT) break;
    const path = join(CALIB_DIR, name);
    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch (e) {
      console.warn(`  ! read failed ${name}: ${e.message}`);
      failed++;
      continue;
    }
    let j;
    try {
      j = JSON.parse(raw);
    } catch (e) {
      console.warn(`  ! parse failed ${name}: ${e.message}`);
      failed++;
      continue;
    }

    const hasFrom = typeof j.fromAddressGeo === "string" && j.fromAddressGeo.length > 0;
    const hasTo = typeof j.toAddressGeo === "string" && j.toAddressGeo.length > 0;
    if (!FORCE && hasFrom && hasTo) {
      skipped++;
      continue;
    }
    toProcess++;
    if (!Number.isFinite(j.fromLat) || !Number.isFinite(j.fromLng) ||
        !Number.isFinite(j.toLat)   || !Number.isFinite(j.toLng)) {
      console.warn(`  ⊘ ${name}: нет координат, пропускаю`);
      skipped++;
      continue;
    }

    if (DRY) {
      console.log(`  [dry] ${name} (${j.fromAddress || "?"} → ${j.toAddress || "?"})`);
      done++;
      continue;
    }

    const [fromGeo, toGeo] = await Promise.all([
      hasFrom && !FORCE ? Promise.resolve(j.fromAddressGeo) : reverseGeocode(j.fromLat, j.fromLng),
      hasTo   && !FORCE ? Promise.resolve(j.toAddressGeo)   : reverseGeocode(j.toLat,   j.toLng),
    ]);
    if (fromGeo) okFrom++;
    if (toGeo) okTo++;

    j.fromAddressGeo = fromGeo;
    j.toAddressGeo = toGeo;

    // Атомарная запись через tmp+rename — чтобы не битый JSON не словил reader.
    const tmp = `${path}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(j, null, 2));
    renameSync(tmp, path);
    done++;
    if (done % 10 === 0) {
      console.log(`  · ${done}/${toProcess} обработано (last: ${name} → ${fromGeo} / ${toGeo})`);
    }

    // Throttling — 8 req/sec суммарно, по 2 запроса на файл = ~4 файла/сек.
    await sleep(250);
  }

  console.log(
    `\n[enrich] done=${done} skipped=${skipped} failed=${failed} okFrom=${okFrom} okTo=${okTo}${DRY ? " (dry-run)" : ""}`,
  );
}

main().catch((e) => {
  console.error("[enrich] FATAL:", e);
  process.exit(2);
});
