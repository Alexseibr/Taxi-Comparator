#!/usr/bin/env node
// Один раз: для каждого якоря в anchors-minsk.json догнать точный адрес
// (улица + номер дома) через Google Reverse Geocoding и записать в новое
// поле `address`. Поле `name` НЕ трогаем — оно остаётся как привычная
// подпись района/станции.
//
// Запуск НА VPS (там есть GOOGLE_MAPS_KEY):
//   node /opt/rwbtaxi-screens/enrich-anchors.mjs            # только пустые address
//   node /opt/rwbtaxi-screens/enrich-anchors.mjs --force    # перезаписать всё
//   node /opt/rwbtaxi-screens/enrich-anchors.mjs --dry-run  # без запросов и записи
//
// Цена: ~$0.005 на якорь × 30+ якорей = ~$0.15. Throttle 6 req/sec.

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "node:https";

const GOOGLE_KEY = process.env.GOOGLE_MAPS_KEY || process.env.GOOGLE_API_KEY;
if (!GOOGLE_KEY) {
  console.error("ERROR: ни GOOGLE_MAPS_KEY, ни GOOGLE_API_KEY не заданы");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = process.env.ANCHORS_FILE || join(__dirname, "anchors-minsk.json");

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const DRY = args.includes("--dry-run");

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
  // Формат который оставляем: "<улица> <дом>, Минск".
  // Убираем хвост "Беларусь", "Минская область 220XXX" / "Мінская вобласць",
  // дублирующиеся пробелы и лишние запятые.
  return String(best.formatted_address || "")
    .replace(/,?\s*Беларусь\s*$/i, "")
    .replace(/,\s*(Минская область|Мінская вобласць)(\s+\d{4,6})?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*,\s*$/g, "")
    .trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const raw = readFileSync(FILE, "utf8");
  const json = JSON.parse(raw);
  const anchors = json.anchors;
  if (!Array.isArray(anchors)) {
    console.error("ERROR: ожидаю поле anchors:[...] в", FILE);
    process.exit(1);
  }
  console.log(`[enrich-anchors] ${anchors.length} якорей в ${FILE}`);

  let done = 0;
  let ok = 0;
  let skipped = 0;

  for (const a of anchors) {
    if (!FORCE && typeof a.address === "string" && a.address.length > 0) {
      skipped++;
      continue;
    }
    if (DRY) {
      console.log(`  [dry] ${a.id} (${a.name}) lat=${a.lat} lng=${a.lng}`);
      continue;
    }
    const addr = await reverseGeocode(a.lat, a.lng);
    const padName = String(a.name).padEnd(30, " ");
    if (addr) {
      a.address = addr;
      ok++;
      console.log(`  ✓ ${padName} → ${addr}`);
    } else {
      a.address = "";
      console.warn(`  ✗ ${padName} → (нет результата)`);
    }
    done++;
    await sleep(170); // ~6 req/sec
  }

  if (!DRY) {
    const tmp = `${FILE}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(json, null, 2));
    renameSync(tmp, FILE);
  }

  console.log(
    `\n[enrich-anchors] done=${done} ok=${ok} skipped=${skipped}${DRY ? " (dry-run)" : ""}`,
  );
}

main().catch((e) => {
  console.error("[enrich-anchors] FATAL:", e);
  process.exit(2);
});
