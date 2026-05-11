#!/usr/bin/env node
// Авто-калибровщик для VPS (cron: каждый час).
// 1) Читает CALIB_DIR/calib-*.json (формат calib-receiver)
// 2) Группирует по date+hour, конвертит в orders/auto-{date}-h{HH}.json
//    (тот же формат, что и ручные orders/<date>-<HHMM>.json — для calibrate.mjs)
// 3) Запускает calibrate.mjs на каждом изменённом orders-файле
// 4) Сохраняет marker CALIB_DIR/.processed.json — но ТОЛЬКО для записей, где
//    calibrate отработал успешно. Если calibrate упал — записи остаются
//    необработанными и попадут в следующий запуск.
//
// Безопасность данных:
// - На JSON parse fail существующего orders файла → ABORT этой группы
//   (никогда не перезаписываем повреждённые данные пустыми).
// - Запись orders/marker — атомарно (tmp + rename).
//
// Идемпотентно: повторный запуск без новых замеров — no-op.
//
// Env:
//   CALIB_DIR (default /var/www/rwbtaxi/data/calib)
//   VITE_TOMTOM_KEY, GOOGLE_MAPS_KEY (нужны calibrate.mjs)

import { readdir, readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CALIB_DIR = process.env.CALIB_DIR || "/var/www/rwbtaxi/data/calib";
const ORDERS_DIR = join(ROOT, "scripts/orders");
const PROCESSED_MARKER = join(CALIB_DIR, ".processed.json");

const DAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

function makeKey(addr) { return String(addr || "").trim(); }
function nearlySame(a, b, eps = 0.0005) {
  return Math.abs(a[0]-b[0]) < eps && Math.abs(a[1]-b[1]) < eps;
}

// Атомарная запись: write tmp + rename.
async function atomicWrite(path, content) {
  const tmp = `${path}.tmp.${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

async function loadProcessed() {
  if (!existsSync(PROCESSED_MARKER)) return new Set();
  try {
    const j = JSON.parse(await readFile(PROCESSED_MARKER, "utf8"));
    return new Set(j.ids || []);
  } catch { return new Set(); }
}

async function saveProcessed(set) {
  const out = { ids: Array.from(set), updatedAt: new Date().toISOString(), count: set.size };
  await atomicWrite(PROCESSED_MARKER, JSON.stringify(out, null, 2));
}

async function main() {
  const processed = await loadProcessed();
  const allFiles = (await readdir(CALIB_DIR)).filter(f => f.startsWith("calib-") && f.endsWith(".json"));
  const newRecs = [];
  for (const f of allFiles) {
    let r;
    try { r = JSON.parse(await readFile(join(CALIB_DIR, f), "utf8")); } catch { continue; }
    if (!r.id || processed.has(r.id)) continue;
    newRecs.push(r);
  }
  if (!newRecs.length) {
    console.log(`[auto-calib] нет новых замеров (всего файлов: ${allFiles.length}, processed: ${processed.size})`);
    return;
  }
  console.log(`[auto-calib] новых замеров: ${newRecs.length} из ${allFiles.length}`);

  // group by date+hour
  const groups = new Map(); // key -> { date, hour, recs[] }
  for (const r of newRecs) {
    const key = `${r.date}-h${String(r.hour).padStart(2, "0")}`;
    if (!groups.has(key)) groups.set(key, { date: r.date, hour: r.hour, recs: [] });
    groups.get(key).recs.push(r);
  }

  await mkdir(ORDERS_DIR, { recursive: true });

  // Проходим по группам: формируем orders, запускаем calibrate, помечаем processed
  // ТОЛЬКО при успехе данной группы.
  let successGroups = 0, failGroups = 0;
  for (const [key, group] of groups) {
    const ordersPath = join(ORDERS_DIR, `auto-${key}.json`);
    let orders = [], coords = {}, existing = new Set();

    if (existsSync(ordersPath)) {
      // КРИТИЧНО: на parse-fail НЕ перезаписываем — пропускаем группу с ошибкой,
      // чтобы не уничтожить уже накопленные данные.
      try {
        const j = JSON.parse(await readFile(ordersPath, "utf8"));
        orders = Array.isArray(j.orders) ? j.orders : [];
        coords = (j.coords && typeof j.coords === "object") ? j.coords : {};
        for (const o of orders) if (o && o.id) existing.add(o.id);
      } catch (e) {
        console.error(`[auto-calib] ABORT group ${key}: existing ${ordersPath} unreadable (${e.message}). Не перезаписываю — записи группы остаются необработанными.`);
        failGroups++;
        continue;
      }
    }

    let added = 0;
    const groupIds = []; // id, которые войдут в этот файл — пометим processed только при success
    for (const r of group.recs) {
      if (existing.has(r.id)) { groupIds.push(r.id); continue; } // уже в файле
      const fk = makeKey(r.fromAddress);
      const tk = makeKey(r.toAddress);
      let fromKey = fk, toKey = tk;
      if (coords[fk] && !nearlySame(coords[fk], [r.fromLat, r.fromLng])) {
        fromKey = `${fk} #${r.id.slice(-6)}`;
      }
      coords[fromKey] = [r.fromLat, r.fromLng];
      if (coords[tk] && !nearlySame(coords[tk], [r.toLat, r.toLng])) {
        toKey = `${tk} #${r.id.slice(-6)}`;
      }
      coords[toKey] = [r.toLat, r.toLng];

      const order = {
        id: r.id,
        from: fromKey,
        to: toKey,
        hour: r.hour,
      };
      if (Number.isFinite(r.factE)) order.factE = r.factE;
      if (Number.isFinite(r.factC)) order.factC = r.factC;
      // tripMin → yaMin, km → yaKm (calibrate.mjs ожидает именно эти имена)
      if (Number.isFinite(r.tripMin)) order.yaMin = r.tripMin;
      if (Number.isFinite(r.km)) order.yaKm = r.km;
      const tags = [];
      if (r.demand) tags.push(r.demand);
      if (r.source) tags.push(r.source);
      const noteParts = [`[auto]`, ...tags, r.notes].filter(Boolean);
      order.notes = noteParts.join(" ").trim();
      orders.push(order);
      groupIds.push(r.id);
      added++;
    }

    const dayName = DAYS[new Date(group.date + "T00:00:00Z").getUTCDay()];
    const out = {
      date: group.date,
      day: dayName,
      comment: `Автогенерация из замеров фронта (calib-receiver), час ${String(group.hour).padStart(2, "0")}:00. Накоплено: ${orders.length} заказов.`,
      coords,
      orders,
    };
    await atomicWrite(ordersPath, JSON.stringify(out, null, 2));
    console.log(`[auto-calib] ${ordersPath}: ${orders.length} заказов всего (+${added})`);

    // Запускаем calibrate ТОЛЬКО если что-то добавили
    if (added > 0) {
      console.log(`[auto-calib] >>> calibrate ${ordersPath}`);
      const res = spawnSync("node", ["scripts/calibrate.mjs", ordersPath], {
        cwd: ROOT, stdio: "inherit", env: process.env,
      });
      if (res.status !== 0) {
        console.error(`[auto-calib] calibrate FAILED (status=${res.status}) для ${ordersPath} — записи группы НЕ помечаю как processed, повторим в следующий запуск`);
        failGroups++;
        continue; // НЕ добавляем groupIds в processed
      }
    }

    // Успех (или нечего было калибровать) — помечаем processed
    for (const id of groupIds) processed.add(id);
    successGroups++;
  }

  await saveProcessed(processed);
  console.log(`[auto-calib] DONE: групп успешно ${successGroups}, провалено ${failGroups}, всего в марке ${processed.size}/${allFiles.length}`);
  if (failGroups > 0) process.exit(2); // cron оповестит через лог; non-zero для мониторинга
}

main().catch(e => { console.error("[auto-calib] FATAL:", e); process.exit(1); });
