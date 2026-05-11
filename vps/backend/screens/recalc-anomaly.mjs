#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";

const KEY = process.env.GOOGLE_API_KEY;
if (!KEY) { console.error("GOOGLE_API_KEY missing"); process.exit(1); }

const CALIB = process.env.CALIB_DIR || "/var/www/rwbtaxi/data/calib";
const VISION_MODELS = (process.env.VISION_MODELS
  ? process.env.VISION_MODELS.split(",").map((s) => s.trim()).filter(Boolean)
  : ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite"]);
const BACKOFF_MS = Number(process.env.VISION_BACKOFF_MS || 5000);
const DELAY_MS = Number(process.env.RECALC_DELAY_MS || 300);
const MAX = Number(process.env.RECALC_MAX || 10000);
const ONLY_SUSPICIOUS = process.env.RECALC_ONLY_SUSPICIOUS === "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function postJson(host, path, body, timeout = 30000) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = httpsRequest(
      { method: "POST", hostname: host, path, timeout,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } },
      (res) => {
        let buf = ""; res.on("data", (c) => (buf += c));
        res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); } catch { resolve({ status: res.statusCode, body: { raw: buf } }); } });
      },
    );
    req.on("error", (e) => resolve({ status: 0, body: { error: e.message } }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: { error: "timeout" } }); });
    req.write(data); req.end();
  });
}

function extractRetryAfterMs(body) {
  try {
    const msg = body?.error?.message || body?.error?.status || "";
    const m = String(msg).match(/retry in ([\d.]+)\s*s/i);
    if (m) { const sec = parseFloat(m[1]); if (Number.isFinite(sec) && sec > 0) return Math.min(Math.ceil(sec * 1000) + 2000, 60000); }
  } catch {}
  return 0;
}

async function callGeminiText(prompt, timeoutMs = 30_000) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };
  for (let i = 0; i < VISION_MODELS.length; i++) {
    const model = VISION_MODELS[i];
    const r = await postJson(
      "generativelanguage.googleapis.com",
      `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(KEY)}`,
      body, timeoutMs,
    );
    if (r.status === 200 && r.body?.candidates?.[0]?.content?.parts?.[0]?.text) {
      try { return { ok: true, model, parsed: JSON.parse(r.body.candidates[0].content.parts[0].text) }; }
      catch { if (i < VISION_MODELS.length - 1) await sleep(BACKOFF_MS); continue; }
    }
    const retryAfter = r.status === 429 ? extractRetryAfterMs(r.body) : 0;
    if (i < VISION_MODELS.length - 1) await sleep(Math.max(BACKOFF_MS, retryAfter));
  }
  return { ok: false, error: "gemini_all_failed" };
}

function loadHistory(currentId, limit = 60) {
  const names = readdirSync(CALIB)
    .filter((n) => n.startsWith("calib-") && n.endsWith(".json") && !n.includes(currentId))
    .sort().reverse().slice(0, limit);
  const out = [];
  for (const n of names) {
    try {
      const j = JSON.parse(readFileSync(join(CALIB, n), "utf8"));
      out.push({
        id: j.id, date: j.date, hour: j.hour,
        from: (j.fromAddress || "").slice(0, 60),
        to: (j.toAddress || "").slice(0, 60),
        factE: j.factE ?? null, factC: j.factC ?? null,
        etaMin: j.etaMin ?? null, tripMin: j.tripMin ?? null,
        demand: j.demand ?? null,
      });
    } catch {}
  }
  return out;
}

async function detectAnomaly(c, history) {
  const prompt = [
    "Ты — куратор данных для калибровщика тарифов такси в Минске (Yandex Эконом+Комфорт).",
    "Тебе даётся ТЕКУЩАЯ калибровка (только что распознанная из скриншота) и ИСТОРИЯ последних калибровок.",
    "Оцени, является ли текущая запись подозрительной (выброс цены, нестыковка адресов, ошибка распознавания, странный спрос).",
    "",
    "СЛОВАРЬ ПОЛЕЙ — это критически важно, не путай:",
    "- etaMin — это ВРЕМЯ ПОДАЧИ ВОДИТЕЛЯ к точке А (через сколько водитель приедет за клиентом). На скрине — жёлтая овальная плашка с автомобилем на карте + подпись «прибытие в ЧЧ:ММ», либо число в плашке выбранного тарифа. Обычно 1-15 мин. Сильно зависит от того, сколько свободных машин рядом с точкой А прямо сейчас, поэтому может скакать в разы между соседними замерами в одной точке — это НОРМАЛЬНО.",
    "- tripMin — это ВРЕМЯ В ПУТИ от точки А до точки Б (длительность самой поездки с пробками). На скрине — подпись «· N мин» в строке маршрута/адреса. Обычно 5-90 мин. Должно быть стабильно для одного маршрута А→Б в близкое время суток (±20%).",
    "- factE, factC — конечные цены (BYN) тарифов Эконом и Комфорт.",
    "- demand — цвет общего индикатора спроса (green/yellow/red).",
    "",
    "ПРАВИЛА СРАВНЕНИЯ (строго!):",
    "1. НИКОГДА не сравнивай etaMin одного замера с tripMin другого — это разные сущности. Сравнения вида «ETA текущего 5 мин против обратного 10 мин» допустимы ТОЛЬКО если это etaMin↔etaMin, и при этом сами по себе различия в etaMin между замерами НЕ являются аномалией (подача легко скачет 2x-5x в зависимости от загрузки таксопарка).",
    "2. tripMin сравнивай с tripMin похожих маршрутов в истории (тот же маршрут или обратный А↔Б, близкий час). Если tripMin отличается >50% от исторической медианы — возможна аномалия.",
    "3. factE/factC сравнивай с factE/factC похожих маршрутов в близкий час (±2 часа). Если цена отличается >40% — это price_outlier.",
    "4. Если на ТЕКУЩЕЙ записи etaMin > tripMin (подача дольше самой поездки) при наличии обоих значений — это категория vision_doubt: скорее всего OCR перепутал жёлтую плашку подачи с временем маршрута.",
    "5. Большое etaMin само по себе (например 30+ мин) — это НЕ аномалия, может быть реальный дефицит машин; помечай только если этого не подтверждает demand=red и при этом цена не повышена.",
    "",
    "Категории (выбери одну, если suspicious=true):",
    "- price_outlier — цена сильно отличается от похожих маршрутов в близкое время",
    "- geocode_mismatch — адреса не сходятся (один или оба явно не в Минске или нелогичны)",
    "- vision_doubt — есть признаки ошибки распознавания: etaMin>tripMin, нелепые суммы, demand явно не вяжется с показаниями",
    "- demand_mismatch — спрос (зелёный/жёлтый/красный) не вяжется с ценой/часом",
    "- context_mismatch — что-то ещё системно странное относительно истории",
    "",
    "Верни СТРОГО JSON по схеме:",
    '{"suspicious": boolean, "severity": "low"|"medium"|"high"|null, "category": string|null, "reason": string, "confidence": number}',
    "reason — короткая фраза по-русски (1-2 предложения, до 200 символов). В reason явно указывай ИМЯ поля (etaMin/tripMin/factE/factC), а не общее слово «ETA» — чтобы было видно что именно сравнивалось.",
    "confidence — 0..1.",
    "Если данных мало или всё нормально — suspicious=false, severity=null, category=null, reason='ок'.",
    "",
    "ТЕКУЩАЯ:",
    JSON.stringify({
      id: c.id, date: c.date, hour: c.hour,
      from: c.fromAddress, to: c.toAddress,
      factE: c.factE ?? null, factC: c.factC ?? null,
      etaMin: c.etaMin ?? null, tripMin: c.tripMin ?? null,
      demand: c.demand ?? null,
    }, null, 0),
    "",
    `ИСТОРИЯ (${history.length} последних, новые сверху):`,
    JSON.stringify(history.slice(0, 60), null, 0),
  ].join("\n");

  const r = await callGeminiText(prompt);
  if (!r.ok) return { suspicious: false, severity: null, category: null, reason: `детектор недоступен: ${r.error}`, confidence: 0, model: null, checkedAt: new Date().toISOString() };
  const p = r.parsed || {};
  return {
    suspicious: !!p.suspicious,
    severity: ["low", "medium", "high"].includes(p.severity) ? p.severity : (p.suspicious ? "low" : null),
    category: typeof p.category === "string" ? p.category : null,
    reason: typeof p.reason === "string" ? p.reason.slice(0, 400) : "",
    confidence: typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0,
    model: r.model,
    checkedAt: new Date().toISOString(),
  };
}

const all = readdirSync(CALIB)
  .filter((n) => n.startsWith("calib-") && n.endsWith(".json"))
  .sort().reverse();
console.log(`Calib JSONs: ${all.length}, ONLY_SUSPICIOUS=${ONLY_SUSPICIOUS}, MAX=${MAX}`);

let processed = 0, flippedToClean = 0, stillSuspicious = 0, newlySuspicious = 0, fail = 0, skipped = 0;
const startTs = Date.now();

for (const f of all) {
  if (processed >= MAX) break;
  const fp = join(CALIB, f);
  let cj;
  try { cj = JSON.parse(readFileSync(fp, "utf8")); } catch { continue; }
  if (ONLY_SUSPICIOUS && !cj.anomaly?.suspicious) { skipped++; continue; }

  const wasSusp = !!cj.anomaly?.suspicious;
  const history = loadHistory(cj.id || f.replace(/\.json$/, ""), 60);
  const a = await detectAnomaly(cj, history);
  if (!a) { fail++; continue; }
  if (a.reason?.startsWith("детектор недоступен")) { fail++; await sleep(BACKOFF_MS); continue; }

  cj.anomaly = a;
  cj.anomalyRecalcAt = new Date().toISOString();
  writeFileSync(fp, JSON.stringify(cj, null, 2));

  if (wasSusp && !a.suspicious) flippedToClean++;
  else if (wasSusp && a.suspicious) stillSuspicious++;
  else if (!wasSusp && a.suspicious) newlySuspicious++;

  processed++;
  if (processed % 25 === 0) {
    const dt = ((Date.now() - startTs) / 1000).toFixed(0);
    console.log(`  [${processed}/${all.length}] ${dt}s — clean←susp:${flippedToClean} susp→susp:${stillSuspicious} new:${newlySuspicious} fail:${fail}`);
  }
  await sleep(DELAY_MS);
}

const dt = ((Date.now() - startTs) / 1000).toFixed(0);
console.log(JSON.stringify({ processed, flippedToClean, stillSuspicious, newlySuspicious, fail, skipped, dtSec: dt }, null, 2));
