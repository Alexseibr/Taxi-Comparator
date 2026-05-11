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

import { readdir, readFile, writeFile, mkdir, rename, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request as httpsRequest } from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CALIB_DIR = process.env.CALIB_DIR || "/var/www/rwbtaxi/data/calib";
const ORDERS_DIR = join(ROOT, "scripts/orders");
const LEARNED_DIR = join(ROOT, "scripts/learned");
const DIST_DATA_DIR = process.env.DIST_DATA_DIR || "/var/www/rwbtaxi/dist/public/data";
const PROCESSED_MARKER = join(CALIB_DIR, ".processed.json");
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";

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

// ───── AI-куратор: hourly report по состоянию калибровки ─────
function postJson(host, path, body, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = httpsRequest({
      host, path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: timeoutMs,
    }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch { /* keep raw */ }
        resolve({ status: res.statusCode || 0, body: parsed, raw: buf });
      });
    });
    req.on("error", (e) => resolve({ status: 0, body: null, raw: String(e) }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: null, raw: "timeout" }); });
    req.write(data);
    req.end();
  });
}

async function callGeminiText(prompt) {
  const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };
  for (const model of models) {
    const r = await postJson(
      "generativelanguage.googleapis.com",
      `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GOOGLE_API_KEY)}`,
      body,
      60_000,
    );
    if (r.status === 200 && r.body?.candidates?.[0]?.content?.parts?.[0]?.text) {
      try {
        return { ok: true, model, parsed: JSON.parse(r.body.candidates[0].content.parts[0].text) };
      } catch { continue; }
    }
    if (r.status === 503 || r.status === 429) continue;
    return { ok: false, error: `gemini_${r.status}` };
  }
  return { ok: false, error: "gemini_all_failed" };
}

async function readJsonSafe(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

async function generateCuratorReport() {
  if (!GOOGLE_API_KEY) {
    console.log("[curator] GOOGLE_API_KEY пуст — отчёт пропущен");
    return;
  }
  console.log("[curator] собираю контекст…");

  const metrics = await readJsonSafe(join(LEARNED_DIR, "metrics.json"));
  const eval8 = await readJsonSafe(join(LEARNED_DIR, "eval-v8.json"));
  const loo = await readJsonSafe(join(LEARNED_DIR, "loo.json"));

  // Последние 30 строк changelog
  let changelogTail = "";
  try {
    const cl = await readFile(join(LEARNED_DIR, "changelog.md"), "utf8");
    changelogTail = cl.split("\n").slice(-40).join("\n");
  } catch { /* ok */ }

  // Последние 80 calib-*.json — для срезки аномалий
  let calibFiles = [];
  try {
    calibFiles = (await readdir(CALIB_DIR))
      .filter((f) => f.startsWith("calib-") && f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, 80);
  } catch { /* ok */ }

  let total = 0, suspicious = 0;
  const byCategory = {};
  const recentSamples = [];
  for (const f of calibFiles) {
    const j = await readJsonSafe(join(CALIB_DIR, f));
    if (!j) continue;
    total += 1;
    if (j.anomaly?.suspicious) {
      suspicious += 1;
      const cat = j.anomaly.category || "unknown";
      byCategory[cat] = (byCategory[cat] || 0) + 1;
      if (recentSamples.length < 12) {
        recentSamples.push({
          id: j.id,
          date: j.date,
          hour: j.hour,
          severity: j.anomaly.severity,
          category: cat,
          reason: j.anomaly.reason,
          factE: j.factE ?? null,
          factC: j.factC ?? null,
          from: (j.fromAddress || "").slice(0, 60),
          to: (j.toAddress || "").slice(0, 60),
        });
      }
    }
  }

  // LOO summary (median MAPE)
  let looSummary = null;
  if (loo && Array.isArray(loo.records)) {
    const errs = loo.records
      .map((r) => Number(r.mapeE) || Number(r.mape) || null)
      .filter((x) => x != null && Number.isFinite(x))
      .sort((a, b) => a - b);
    if (errs.length) {
      const median = errs[Math.floor(errs.length / 2)];
      const p90 = errs[Math.floor(errs.length * 0.9)];
      looSummary = { count: errs.length, medianMape: median, p90Mape: p90 };
    }
  }

  const prompt = [
    "Ты — старший куратор калибровщика тарифов такси rwbtaxi.by (Минск, Yandex Эконом+Комфорт).",
    "Раз в час ты получаешь сводку и пишешь короткий отчёт для оператора (русский язык).",
    "Будь конкретным: цифры, что выросло/упало, какие типы аномалий доминируют, что делать.",
    "",
    "Верни СТРОГО JSON по схеме:",
    "{",
    '  "summary": "2-3 предложения главное",',
    '  "highlights": ["короткие пункты, что хорошо"],',
    '  "warnings":  ["короткие пункты, что плохо/тревожит"],',
    '  "suggestions": ["конкретные действия оператору"],',
    '  "metrics": {"total": number, "suspicious": number, "byCategory": object, "looMedianMape": number|null}',
    "}",
    "",
    "ДАННЫЕ:",
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      calibCounts: { total, suspicious, byCategory },
      recentSuspicious: recentSamples,
      loo: looSummary,
      metrics: metrics ? Object.fromEntries(Object.entries(metrics).slice(0, 30)) : null,
      eval8: eval8 ? Object.fromEntries(Object.entries(eval8).slice(0, 30)) : null,
      changelogTail,
    }, null, 0),
  ].join("\n");

  const r = await callGeminiText(prompt);
  if (!r.ok) {
    console.warn(`[curator] Gemini fail: ${r.error} — отчёт пропущен`);
    return;
  }
  const p = r.parsed || {};
  const report = {
    updatedAt: new Date().toISOString(),
    model: r.model,
    summary: typeof p.summary === "string" ? p.summary : "",
    highlights: Array.isArray(p.highlights) ? p.highlights.slice(0, 10) : [],
    warnings: Array.isArray(p.warnings) ? p.warnings.slice(0, 10) : [],
    suggestions: Array.isArray(p.suggestions) ? p.suggestions.slice(0, 10) : [],
    metrics: {
      total,
      suspicious,
      byCategory,
      looMedianMape: looSummary?.medianMape ?? null,
      ...(p.metrics && typeof p.metrics === "object" ? p.metrics : {}),
    },
  };

  // markdown версия
  const lines = [
    `# AI-куратор калибровщика`,
    `Обновлено: ${report.updatedAt}  · модель: ${report.model}`,
    "",
    `**Сводка.** ${report.summary}`,
    "",
    `## Метрики`,
    `- Калибровок просмотрено: **${total}**, подозрительных: **${suspicious}** (${total ? ((suspicious / total) * 100).toFixed(1) : "0"}%)`,
    `- По категориям: ${Object.entries(byCategory).map(([k, v]) => `${k}=${v}`).join(", ") || "—"}`,
    `- LOO median MAPE: ${looSummary?.medianMape != null ? (looSummary.medianMape * 100).toFixed(2) + "%" : "—"}`,
    "",
  ];
  if (report.highlights.length) {
    lines.push("## Хорошо"); for (const h of report.highlights) lines.push(`- ${h}`); lines.push("");
  }
  if (report.warnings.length) {
    lines.push("## Тревожит"); for (const h of report.warnings) lines.push(`- ${h}`); lines.push("");
  }
  if (report.suggestions.length) {
    lines.push("## Что сделать"); for (const h of report.suggestions) lines.push(`- ${h}`); lines.push("");
  }
  const md = lines.join("\n");

  // Пишем в learned/ и копируем в dist/public/data/ (если доступен)
  await mkdir(LEARNED_DIR, { recursive: true });
  await atomicWrite(join(LEARNED_DIR, "ai-report.json"), JSON.stringify(report, null, 2));
  await atomicWrite(join(LEARNED_DIR, "ai-report.md"), md);

  if (existsSync(DIST_DATA_DIR)) {
    try {
      await copyFile(join(LEARNED_DIR, "ai-report.json"), join(DIST_DATA_DIR, "ai-report.json"));
      await copyFile(join(LEARNED_DIR, "ai-report.md"), join(DIST_DATA_DIR, "ai-report.md"));
      console.log(`[curator] отчёт записан и скопирован в ${DIST_DATA_DIR}`);
    } catch (e) {
      console.warn(`[curator] не удалось скопировать в ${DIST_DATA_DIR}:`, e.message);
    }
  } else {
    console.log(`[curator] отчёт записан (DIST_DATA_DIR не существует, копирование пропущено)`);
  }
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
    // Куратор всё равно нужен — пусть подведёт итог даже когда новых данных нет.
    try { await generateCuratorReport(); } catch (e) { console.warn(`[curator] FAIL: ${e?.message || e}`); }
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

  // AI-куратор пишется ВСЕГДА (даже если есть failGroups) —
  // это диагностический отчёт, который должен быть свежим.
  try {
    await generateCuratorReport();
  } catch (e) {
    console.warn(`[curator] FAIL: ${e?.message || e}`);
  }

  if (failGroups > 0) process.exit(2); // cron оповестит через лог; non-zero для мониторинга
}

main().catch(e => { console.error("[auto-calib] FATAL:", e); process.exit(1); });
