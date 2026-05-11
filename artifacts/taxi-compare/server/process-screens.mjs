#!/usr/bin/env node
// Cron-обработчик: берёт скрины из incoming/, шлёт в Gemini Vision, парсит,
// геокодит адреса, создаёт calib-*.json в /var/www/rwbtaxi/data/calib/.
// Оригиналы переезжают в processed/ или failed/ с raw.json/error.json рядом.
//
// Запуск: */5 * * * * /usr/local/bin/rwbtaxi-process-screens.sh

import { readdir, readFile, writeFile, rename, unlink, mkdir, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";

const ROOT = process.env.SCREENS_DIR || "/var/www/rwbtaxi/data/screens";
const INCOMING = join(ROOT, "incoming");
const PROCESSED = join(ROOT, "processed");
const FAILED = join(ROOT, "failed");
const CALIB_DIR = process.env.CALIB_DIR || "/var/www/rwbtaxi/data/calib";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY || GOOGLE_API_KEY;
const VISION_MODEL = process.env.VISION_MODEL || "gemini-2.5-flash";
const VISION_FALLBACK_MODEL = process.env.VISION_FALLBACK_MODEL || "gemini-2.5-flash-lite";
// Расширенная цепочка fallback. У 2.5-flash самая жёсткая free-quota,
// поэтому при 429 уходим на 2.0-flash / 2.0-flash-lite / 1.5-flash —
// у каждой модели свои отдельные счётчики RPM/RPD на free-tier.
// На v1beta endpoint доступны только семейства 2.5 и 2.0 (1.5 убрана из API).
// Каждая модель имеет свой отдельный free-quota счётчик RPM/RPD.
const VISION_MODELS = (process.env.VISION_MODELS
  ? process.env.VISION_MODELS.split(",").map((s) => s.trim()).filter(Boolean)
  : [
      VISION_MODEL,
      VISION_FALLBACK_MODEL,
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
    ]);
// Пауза между fallback'ами на 429 — даём модели хотя бы вдохнуть, чтобы
// не выжечь next-минутный лимит на следующей модели цепочки.
const VISION_BACKOFF_MS = Number(process.env.VISION_BACKOFF_MS || 5000);
// Число общих ретраев всей цепочки, если все модели упали по 429 одновременно.
const VISION_RETRIES = Number(process.env.VISION_RETRIES || 1);
const VISION_RETRY_PAUSE_MS = Number(process.env.VISION_RETRY_PAUSE_MS || 25000);
// Верхняя граница для retry_after из тела 429 (чтобы не уснуть на 5 минут).
const VISION_RETRY_AFTER_CAP_MS = Number(process.env.VISION_RETRY_AFTER_CAP_MS || 60000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_PER_RUN = Number(process.env.SCREENS_PROCESS_MAX || 50);
// Параллельная обработка файлов внутри одного запуска. 3 одновременно —
// безопасно для Gemini free-tier (60 RPM): 3 файла × 2 вызова = 6 RPM пик.
const CONCURRENCY = Number(process.env.SCREENS_PROCESS_CONCURRENCY || 3);

if (!GOOGLE_API_KEY) {
  console.error("[process-screens] GOOGLE_API_KEY не задан, выхожу");
  process.exit(1);
}
if (!GOOGLE_MAPS_KEY) {
  console.error("[process-screens] GOOGLE_MAPS_KEY не задан, выхожу");
  process.exit(1);
}

await mkdir(PROCESSED, { recursive: true });
await mkdir(FAILED, { recursive: true });
await mkdir(CALIB_DIR, { recursive: true });

// ────────── helpers ──────────
function postJson(host, path, body, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const data = typeof body === "string" ? body : JSON.stringify(body);
    const req = httpsRequest(
      {
        method: "POST",
        hostname: host,
        path,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(buf) });
          } catch {
            resolve({ status: res.statusCode, body: { raw: buf } });
          }
        });
      },
    );
    req.on("error", (e) => resolve({ status: 0, body: { error: e.message } }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, body: { error: "timeout" } });
    });
    req.write(data);
    req.end();
  });
}

function getJson(host, path, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    const req = httpsRequest(
      { method: "GET", hostname: host, path, timeout: timeoutMs },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(buf) });
          } catch {
            resolve({ status: res.statusCode, body: { raw: buf } });
          }
        });
      },
    );
    req.on("error", (e) => resolve({ status: 0, body: { error: e.message } }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, body: { error: "timeout" } });
    });
    req.end();
  });
}

const VISION_PROMPT = `Это скриншот мобильного приложения такси в Минске (Yandex Go или похожее).

Извлеки информацию строго в JSON, никакого текста вокруг:
{
  "isTaxiApp": true|false,
  "appName": "Yandex Go" | "Bolt" | "Maxim" | "Uklon" | "другое",
  "fromAddress": "АДРЕС ОТКУДА — это ВЕРХНЯЯ строка маршрута на экране, точка А (начало поездки). Без слова Беларусь и без индекса.",
  "toAddress": "АДРЕС КУДА — это НИЖНЯЯ строка маршрута на экране, точка Б (конец поездки). Без слова Беларусь и без индекса.",
  "tariffs": [
    {
      "name": "Эконом" | "Комфорт" | "Комфорт+" | "Бизнес" | "Минивэн" | "Курьер" | "Доставка",
      "priceBYN": число — цена в белорусских рублях (BYN),
      "etaMin": число минут до подачи (это маленькая цифра рядом с иконкой машинки/⏱ — обычно 2-15 мин: «4 мин») или null,
      "tripMin": число минут в пути от А до Б (это РЕАЛЬНОЕ время самой поездки с пробками — обычно 10-60 мин). Ищи внимательно: в Yandex Go это часто подпись «·22 мин» рядом с ценой тарифа, либо в верхней части экрана «23 мин · 8 км», либо просто «22 мин» рядом с маршрутной полоской. НЕ путай с etaMin (подача) — etaMin маленький (2-10), tripMin больше (10-60). Если на экране видишь только одну цифру минут и не уверен какая — возьми её как tripMin если она ≥10, иначе etaMin. Если совсем не видно — null,
      "surge": число — множитель ⚡ (например 1.5) или null
    }
  ],
  "demandColor": "green" | "yellow" | "red" — общий индикатор спроса/сурджа в приложении или null,
  "screenLocalTime": "ЧЧ:ММ" или null — время РОВНО как видно в статусбаре телефона (часы и минуты в верхней части экрана). Это локальное время Минска (Europe/Minsk, UTC+3). НЕ время «заказан в», НЕ время в карточке тарифа — только верхний статусбар.
}

Правила:
- Цены ОБЯЗАТЕЛЬНО приведи к BYN. Если на экране ₽/RUB/USD — в priceBYN ставь null и в notes поясни.
- Не выдумывай ничего. Если поле не видно — null.
- Адреса бери ровно как на экране (улица + дом, без города/страны).
- Если на экране только один тариф — массив из одного элемента.
- Если это НЕ скрин такси — isTaxiApp:false и пустые tariffs/адреса.`;

async function callGemini(model, base64png) {
  const body = {
    contents: [
      {
        parts: [
          { text: VISION_PROMPT },
          { inline_data: { mime_type: "image/png", data: base64png } },
        ],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };
  return postJson(
    "generativelanguage.googleapis.com",
    `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GOOGLE_API_KEY)}`,
    body,
    45_000,
  );
}

// Парсим из 429-тела Gemini подсказку «Please retry in 17.3s» → миллисекунды.
// Если хинта нет — возвращаем 0 (используем штатный backoff).
function extractRetryAfterMs(body) {
  try {
    const msg = body?.error?.message || body?.error?.status || "";
    const m = String(msg).match(/retry in ([\d.]+)\s*s/i);
    if (m) {
      const sec = parseFloat(m[1]);
      if (Number.isFinite(sec) && sec > 0) {
        return Math.min(Math.ceil(sec * 1000) + 2000, VISION_RETRY_AFTER_CAP_MS);
      }
    }
    const details = body?.error?.details;
    if (Array.isArray(details)) {
      for (const d of details) {
        const rd = d?.retryDelay || d?.["@type"]?.includes("RetryInfo") && d?.retryDelay;
        if (rd && typeof rd === "string") {
          const m2 = rd.match(/([\d.]+)s/);
          if (m2) {
            const sec = parseFloat(m2[1]);
            if (Number.isFinite(sec) && sec > 0) {
              return Math.min(Math.ceil(sec * 1000) + 2000, VISION_RETRY_AFTER_CAP_MS);
            }
          }
        }
      }
    }
  } catch {}
  return 0;
}

async function visionRecognize(buffer, mime) {
  // Gemini принимает любой image/*; мы упрощённо ставим mime тот же что у файла.
  const b64 = buffer.toString("base64");
  // Подставляем фактический mime в inline_data
  const body = {
    contents: [
      {
        parts: [
          { text: VISION_PROMPT },
          { inline_data: { mime_type: mime || "image/png", data: b64 } },
        ],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };

  // Прогон всей цепочки моделей; на 429/503 идём дальше с маленькой паузой,
  // чтобы не выжигать минутный квоту-счётчик следующей модели сразу же.
  // Если ВСЯ цепочка упала по 429/503 — ждём VISION_RETRY_PAUSE_MS и пробуем
  // ещё раз (VISION_RETRIES раз). Это вытаскивает большую часть «временных»
  // лимитов на следующей минуте без переноса файла в failed/.
  let lastErr = "vision_all_failed";
  let lastMsg = "";
  // Максимум retry_after, который видели на этом проходе цепочки —
  // используем его как минимальную паузу перед следующим общим retry.
  let maxRetryAfterMs = 0;
  for (let attempt = 0; attempt <= VISION_RETRIES; attempt++) {
    if (attempt > 0) {
      const wait = Math.max(VISION_RETRY_PAUSE_MS, maxRetryAfterMs);
      console.warn(`[vision] вся цепочка упала, retry #${attempt} через ${wait}ms (hint=${maxRetryAfterMs})`);
      await sleep(wait);
      maxRetryAfterMs = 0;
    }
    for (let i = 0; i < VISION_MODELS.length; i++) {
      const model = VISION_MODELS[i];
      const r = await postJson(
        "generativelanguage.googleapis.com",
        `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GOOGLE_API_KEY)}`,
        body,
        45_000,
      );
      if (r.status === 200 && r.body?.candidates?.[0]?.content?.parts?.[0]?.text) {
        try {
          const parsed = JSON.parse(r.body.candidates[0].content.parts[0].text);
          const u = r.body.usageMetadata || {};
          return {
            ok: true,
            model,
            parsed,
            tokens: { in: u.promptTokenCount, out: u.candidatesTokenCount },
          };
        } catch {
          console.warn(`[vision] ${model} вернул невалидный JSON, пробую fallback`);
          if (i < VISION_MODELS.length - 1) await sleep(VISION_BACKOFF_MS);
          continue;
        }
      }
      const code = r.status;
      const errMsg =
        r.body?.error?.message ||
        r.body?.error?.status ||
        JSON.stringify(r.body).slice(0, 200);
      // ЛЮБАЯ не-200 ошибка от конкретной модели — пробуем следующую модель.
      // На 429 уважаем подсказку «retry in Xs» — спим ровно столько,
      // прежде чем дёрнуть следующую модель (иначе она тоже получит 429).
      const retryAfter = code === 429 ? extractRetryAfterMs(r.body) : 0;
      if (retryAfter > maxRetryAfterMs) maxRetryAfterMs = retryAfter;
      console.warn(`[vision] ${model} -> ${code}${retryAfter ? ` retry_after=${retryAfter}ms` : ""}, fallback`);
      lastErr = `vision_${code}`;
      lastMsg = errMsg;
      if (i < VISION_MODELS.length - 1) {
        await sleep(Math.max(VISION_BACKOFF_MS, retryAfter));
      }
    }
  }
  return { ok: false, error: lastErr || "vision_all_failed", message: lastMsg };
}

// ────────── anomaly detector (Gemini text-only) ──────────
async function callGeminiText(prompt, timeoutMs = 30_000) {
  // Анализатор аномалий — вторичный, но тоже страдает от 429. Используем ту же
  // расширенную цепочку моделей с лёгким backoff'ом, без retry'ев (при провале
  // calib всё равно создаётся, просто с anomaly.reason="детектор недоступен").
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };
  for (let i = 0; i < VISION_MODELS.length; i++) {
    const model = VISION_MODELS[i];
    const r = await postJson(
      "generativelanguage.googleapis.com",
      `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GOOGLE_API_KEY)}`,
      body,
      timeoutMs,
    );
    if (r.status === 200 && r.body?.candidates?.[0]?.content?.parts?.[0]?.text) {
      try {
        return { ok: true, model, parsed: JSON.parse(r.body.candidates[0].content.parts[0].text) };
      } catch {
        if (i < VISION_MODELS.length - 1) await sleep(VISION_BACKOFF_MS);
        continue;
      }
    }
    // Любая не-200 → пробуем следующую модель (включая 404 для снятых моделей).
    // На 429 — уважаем retry_after, чтобы не выжечь лимит на следующей модели.
    const retryAfter = r.status === 429 ? extractRetryAfterMs(r.body) : 0;
    if (i < VISION_MODELS.length - 1) {
      await sleep(Math.max(VISION_BACKOFF_MS, retryAfter));
    }
  }
  return { ok: false, error: "gemini_all_failed" };
}

async function loadHistoryContext(currentId, limit = 60) {
  let names = [];
  try {
    names = (await readdir(CALIB_DIR))
      .filter((n) => n.startsWith("calib-") && n.endsWith(".json") && !n.includes(currentId))
      .sort()
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    try {
      const j = JSON.parse(await readFile(join(CALIB_DIR, n), "utf8"));
      out.push({
        id: j.id,
        date: j.date,
        hour: j.hour,
        from: (j.fromAddress || "").slice(0, 60),
        to: (j.toAddress || "").slice(0, 60),
        factE: j.factE ?? null,
        factC: j.factC ?? null,
        etaMin: j.etaMin ?? null,
        demand: j.demand ?? null,
      });
    } catch {
      /* skip */
    }
  }
  return out;
}

async function detectAnomaly(calibRecord, history) {
  if (!GOOGLE_API_KEY) return null;
  const prompt = [
    "Ты — куратор данных для калибровщика тарифов такси в Минске (Yandex Эконом+Комфорт).",
    "Тебе даётся ТЕКУЩАЯ калибровка (только что распознанная из скриншота) и ИСТОРИЯ последних калибровок.",
    "Оцени, является ли текущая запись подозрительной (выброс цены, нестыковка адресов, ошибка распознавания, странный спрос).",
    "",
    "Категории (выбери одну, если suspicious=true):",
    "- price_outlier — цена сильно отличается от похожих маршрутов в близкое время",
    "- geocode_mismatch — адреса не сходятся (один или оба явно не в Минске или нелогичны)",
    "- vision_doubt — есть признаки ошибки распознавания (странные суммы, ETA, demand)",
    "- demand_mismatch — спрос (зелёный/жёлтый/красный) не вяжется с ценой/часом",
    "- context_mismatch — что-то ещё системно странное относительно истории",
    "",
    "Верни СТРОГО JSON по схеме:",
    '{"suspicious": boolean, "severity": "low"|"medium"|"high"|null, "category": string|null, "reason": string, "confidence": number}',
    "reason — короткая фраза по-русски (1-2 предложения, до 200 символов).",
    "confidence — 0..1.",
    "Если данных мало или всё нормально — suspicious=false, severity=null, category=null, reason='ок'.",
    "",
    "ТЕКУЩАЯ:",
    JSON.stringify(
      {
        id: calibRecord.id,
        date: calibRecord.date,
        hour: calibRecord.hour,
        from: calibRecord.fromAddress,
        to: calibRecord.toAddress,
        factE: calibRecord.factE ?? null,
        factC: calibRecord.factC ?? null,
        etaMin: calibRecord.etaMin ?? null,
        demand: calibRecord.demand ?? null,
      },
      null,
      0,
    ),
    "",
    `ИСТОРИЯ (${history.length} последних, новые сверху):`,
    JSON.stringify(history.slice(0, 60), null, 0),
  ].join("\n");

  const r = await callGeminiText(prompt);
  if (!r.ok) {
    return { suspicious: false, severity: null, category: null, reason: `детектор недоступен: ${r.error}`, confidence: 0, model: null, checkedAt: new Date().toISOString() };
  }
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

// ────────── geocoding (Google Geocoding API) ──────────
const MINSK_BBOX = { south: 53.7, north: 54.1, west: 27.3, east: 27.8 };
function inMinsk(lat, lng) {
  return (
    lat >= MINSK_BBOX.south &&
    lat <= MINSK_BBOX.north &&
    lng >= MINSK_BBOX.west &&
    lng <= MINSK_BBOX.east
  );
}

async function geocode(addressRaw) {
  const q = `${addressRaw}, Минск, Беларусь`;
  const r = await getJson(
    "maps.googleapis.com",
    `/maps/api/geocode/json?address=${encodeURIComponent(q)}&language=ru&region=by&key=${encodeURIComponent(GOOGLE_MAPS_KEY)}`,
    15_000,
  );
  if (r.status !== 200 || r.body?.status !== "OK" || !Array.isArray(r.body.results) || r.body.results.length === 0) {
    return { ok: false, error: r.body?.status || `http_${r.status}` };
  }
  // Берём первый результат внутри Минска, если есть
  for (const cand of r.body.results) {
    const loc = cand.geometry?.location;
    if (loc && inMinsk(loc.lat, loc.lng)) {
      return { ok: true, lat: loc.lat, lng: loc.lng, formatted: cand.formatted_address };
    }
  }
  return { ok: false, error: "out_of_minsk" };
}

// Обратное геокодирование: координаты → точный почтовый адрес «улица + дом».
// Vision вытаскивает из скрина либо «Карла Маркса 42» (хорошо), либо POI вроде
// «Дворец спорта», «Минск-Пасс», «Корона», «Комаровский» — по таким адресам
// нельзя обучать модель и нельзя анализировать «откуда заказы». После
// forward-geocode мы знаем lat/lng точно — догоняем точный адрес обратным
// запросом к тому же Google Geocoding API. Берём первый результат с
// result_type=street_address или premise (это самые точные классы; в их
// formatted_address всегда есть номер дома). Если их нет — берём первый
// route/intersection. Если совсем ничего — возвращаем "" (фронт упадёт на
// исходный fromAddress).
async function reverseGeocode(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: "no_coords" };
  }
  const r = await getJson(
    "maps.googleapis.com",
    `/maps/api/geocode/json?latlng=${lat},${lng}&language=ru&region=by&result_type=street_address|premise|subpremise|route&key=${encodeURIComponent(GOOGLE_MAPS_KEY)}`,
    15_000,
  );
  if (r.status !== 200 || r.body?.status !== "OK" || !Array.isArray(r.body.results) || r.body.results.length === 0) {
    return { ok: false, error: r.body?.status || `http_${r.status}` };
  }
  // Берём наиболее «адресный» класс: сначала street_address/premise,
  // потом всё остальное. Это даёт «Карла Маркса 42, Минск, Беларусь».
  const PRIORITY = ["street_address", "premise", "subpremise", "route"];
  let best = null;
  let bestPrio = 99;
  for (const cand of r.body.results) {
    const types = Array.isArray(cand.types) ? cand.types : [];
    let prio = 99;
    for (let i = 0; i < PRIORITY.length; i++) {
      if (types.includes(PRIORITY[i])) {
        prio = Math.min(prio, i);
      }
    }
    if (prio < bestPrio) {
      bestPrio = prio;
      best = cand;
    }
  }
  if (!best) best = r.body.results[0];
  // Очищаем «, Беларусь» / «, Минск, Беларусь» в конце для компактности.
  // На фронте полная строка тоже не помещается — оставляем «улица + дом».
  let formatted = String(best.formatted_address || "").trim();
  formatted = formatted
    .replace(/,?\s*Беларусь\s*$/i, "")
    .replace(/,?\s*Минск\s*$/i, "")
    .trim();
  return { ok: true, formatted };
}

// ────────── extract econom/comfort prices from tariffs ──────────
function pickEconomComfort(tariffs) {
  const E_NAMES = ["эконом", "econom", "economy"];
  const C_NAMES = ["комфорт", "comfort"];
  let econom = null;
  let comfort = null;
  for (const t of tariffs || []) {
    const n = (t.name || "").toLowerCase().trim();
    if (n === "эконом" && !econom) econom = t;
    else if (n === "комфорт" && !comfort) comfort = t;
    else if (E_NAMES.includes(n) && !econom) econom = t;
    else if (C_NAMES.includes(n) && !comfort) comfort = t;
  }
  return { econom, comfort };
}

function isFiniteNum(v, min, max) {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

// ────────── filename → uploadedAt fallback ──────────
// Если meta.json потерян или приёмник его не положил, пробуем достать момент
// загрузки из самого имени файла (screen-receiver кодирует timestamp прямо
// в имя). Поддерживаем два исторических формата:
//   A) screen-YYYY-MM-DD-hHH-XXXX        — точность до часа (UTC)
//   B) screen-YYYYMMDD-HHMMSS-mmm-...    — точность до миллисекунды (UTC)
// Возвращает ISO-строку или null, если ни один формат не подошёл.
// Безопасная сборка ISO из компонентов. Возвращает null, если значения вне
// диапазонов или Date.UTC «нормализовал» дату (напр. месяц 13 → январь
// следующего года) — нам это не подходит, лучше fallback на mtime файла.
function _safeIsoFromParts(y, mo, d, hh, mm, ss, ms) {
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;
  if (ss < 0 || ss > 59) return null;
  if (ms < 0 || ms > 999) return null;
  if (y < 2000 || y > 2100) return null;
  const t = Date.UTC(y, mo - 1, d, hh, mm, ss, ms);
  if (!Number.isFinite(t)) return null;
  const dt = new Date(t);
  // round-trip check: Date.UTC мог незаметно нормализовать (например
  // 31 апреля → 1 мая). Если компоненты не совпадают — отвергаем.
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d ||
    dt.getUTCHours() !== hh ||
    dt.getUTCMinutes() !== mm ||
    dt.getUTCSeconds() !== ss
  ) {
    return null;
  }
  return dt.toISOString();
}

function inferUploadedAtFromFilename(filename) {
  if (typeof filename !== "string") return null;
  // Формат B: ровный timestamp UTC до миллисекунды.
  const b = filename.match(/^screen-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})/);
  if (b) {
    const iso = _safeIsoFromParts(+b[1], +b[2], +b[3], +b[4], +b[5], +b[6], +b[7]);
    if (iso) return iso;
  }
  // Формат A: только дата + час (без минут — ставим :00:00).
  const a = filename.match(/^screen-(\d{4})-(\d{2})-(\d{2})-h(\d{2})-/);
  if (a) {
    const iso = _safeIsoFromParts(+a[1], +a[2], +a[3], +a[4], 0, 0, 0);
    if (iso) return iso;
  }
  return null;
}

// ────────── timestamp resolver ──────────
// Возвращает «время заказа» — момент, когда юзер реально смотрел эти цены /
// делал заказ. Это НЕ время прогона Vision (которое может быть на часы позже).
//
// Приоритет:
//   1) screenLocalTime ("ЧЧ:ММ" из статусбара телефона) + дата из uploadedAt,
//      собранные в Минск-TZ (Europe/Minsk, UTC+3, без DST).
//      Используется только если получившееся время правдоподобно
//      (расхождение с uploadedAt не больше нескольких часов).
//   2) uploadedAt — момент, когда screen-receiver принял файл.
//   3) сейчас — последний фолбэк, если нет ни того ни другого.
function pickOrderTimestamp(uploadedAtIso, screenLocalTime) {
  const uploadedDate = uploadedAtIso ? new Date(uploadedAtIso) : null;
  const upOk = uploadedDate && Number.isFinite(uploadedDate.getTime());

  const m = typeof screenLocalTime === "string"
    ? screenLocalTime.trim().match(/^(\d{1,2}):(\d{2})$/)
    : null;
  if (m && upOk) {
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      // Дата в Минск-TZ из uploadedAt.
      const upMinsk = new Date(uploadedDate.getTime() + 3 * 3600 * 1000);
      const y = upMinsk.getUTCFullYear();
      const mo = upMinsk.getUTCMonth();
      const d = upMinsk.getUTCDate();
      // Кандидат: тот же минский день, час/минута со скрина → обратно в UTC.
      let candidateUtcMs = Date.UTC(y, mo, d, hh, mm, 0) - 3 * 3600 * 1000;

      const diffMs = candidateUtcMs - uploadedDate.getTime();
      // Если получилось в будущем больше чем на 5 минут после upload — скорее
      // всего скрин «вчерашний», который пришёл сегодня после полуночи: ушли
      // на день назад.
      if (diffMs > 5 * 60 * 1000) {
        candidateUtcMs -= 24 * 3600 * 1000;
      }
      const finalDiffMs = Math.abs(candidateUtcMs - uploadedDate.getTime());
      // Если расхождение всё равно > 12 часов — screenLocalTime ненадёжен
      // (другая TZ / нечитаемый статусбар), fallback на uploadedAt.
      if (finalDiffMs <= 12 * 3600 * 1000) {
        return {
          orderAt: new Date(candidateUtcMs).toISOString(),
          source: "screen",
        };
      }
    }
  }

  if (upOk) return { orderAt: uploadedDate.toISOString(), source: "upload" };
  return { orderAt: new Date().toISOString(), source: "now" };
}

// ────────── one-screen processor ──────────
async function moveTo(dir, baseFilename, srcPath, metaPath) {
  const target = join(dir, baseFilename);
  await rename(srcPath, target);
  if (metaPath) {
    try {
      await rename(metaPath, target + ".meta.json");
    } catch {
      /* meta может отсутствовать */
    }
  }
  return target;
}

async function processOne(filename) {
  const srcPath = join(INCOMING, filename);
  const metaPath = srcPath + ".meta.json";

  let meta = null;
  try {
    meta = JSON.parse(await readFile(metaPath, "utf8"));
  } catch {
    // meta.json потеряна или внешний загрузчик её не положил. Чтобы НЕ
    // штамповать «сейчас» как момент загрузки (это ломает калибровку), идём
    // по убывающей надёжности:
    //   1) timestamp, закодированный в имени файла (screen-receiver формат);
    //   2) mtime файла на диске (≈ когда он был сохранён в incoming/);
    //   3) только если ничего не прокатило — текущее время.
    let fallbackUploadedAt = inferUploadedAtFromFilename(filename);
    if (!fallbackUploadedAt) {
      try {
        const st = await stat(srcPath);
        fallbackUploadedAt = st.mtime.toISOString();
      } catch {
        fallbackUploadedAt = new Date().toISOString();
      }
    }
    meta = { uploadedAt: fallbackUploadedAt, uploaderIp: "unknown" };
  }

  const buffer = await readFile(srcPath);
  const mime = meta.mime || (filename.endsWith(".png") ? "image/png" : filename.endsWith(".webp") ? "image/webp" : "image/jpeg");

  console.log(`[process] ${filename} (${buffer.length}b, ip=${meta.uploaderIp})`);

  const v = await visionRecognize(buffer, mime);
  if (!v.ok) {
    const errPath = await moveTo(FAILED, filename, srcPath, metaPath);
    await writeFile(errPath + ".error.json", JSON.stringify({ stage: "vision", ...v, meta }, null, 2));
    console.warn(`  ✗ vision: ${v.error}`);
    return { ok: false, reason: v.error };
  }

  const p = v.parsed || {};
  // Сохраняем raw для отладки/архива
  const rawForLog = { stage: "vision", model: v.model, tokens: v.tokens, parsed: p, meta };

  if (!p.isTaxiApp) {
    const errPath = await moveTo(FAILED, filename, srcPath, metaPath);
    await writeFile(errPath + ".error.json", JSON.stringify({ ...rawForLog, reason: "not_taxi_app" }, null, 2));
    console.warn(`  ✗ не такси-приложение`);
    return { ok: false, reason: "not_taxi_app" };
  }

  const fromAddr = (p.fromAddress || "").trim();
  const toAddr = (p.toAddress || "").trim();
  if (fromAddr.length < 2 || toAddr.length < 2) {
    const errPath = await moveTo(FAILED, filename, srcPath, metaPath);
    await writeFile(errPath + ".error.json", JSON.stringify({ ...rawForLog, reason: "no_addresses" }, null, 2));
    console.warn(`  ✗ нет адресов: from=«${fromAddr}» to=«${toAddr}»`);
    return { ok: false, reason: "no_addresses" };
  }

  const { econom, comfort } = pickEconomComfort(p.tariffs);
  const hasE = econom && isFiniteNum(econom.priceBYN, 0.5, 500);
  const hasC = comfort && isFiniteNum(comfort.priceBYN, 0.5, 500);
  if (!hasE && !hasC) {
    const errPath = await moveTo(FAILED, filename, srcPath, metaPath);
    await writeFile(errPath + ".error.json", JSON.stringify({ ...rawForLog, reason: "no_econom_or_comfort_price" }, null, 2));
    console.warn(`  ✗ нет цен Эконом/Комфорт`);
    return { ok: false, reason: "no_econom_or_comfort_price" };
  }

  // Геокодинг параллельно
  const [g1, g2] = await Promise.all([geocode(fromAddr), geocode(toAddr)]);
  if (!g1.ok || !g2.ok) {
    const errPath = await moveTo(FAILED, filename, srcPath, metaPath);
    await writeFile(errPath + ".error.json", JSON.stringify({ ...rawForLog, reason: "geocode_failed", from: g1, to: g2 }, null, 2));
    console.warn(`  ✗ геокодинг: from=${g1.error || "ok"}, to=${g2.error || "ok"}`);
    return { ok: false, reason: "geocode_failed" };
  }

  // «Время заказа» = момент, когда юзер реально смотрел эти цены.
  // Это критично для калибровки: между загрузкой скрина и обработкой через
  // Vision могут пройти десятки минут (cron каждые 5 мин + батч), а сам скрин
  // мог быть сделан вообще раньше. Поэтому НЕ используем new Date() как
  // источник истины. См. pickOrderTimestamp выше.
  const ts = pickOrderTimestamp(meta.uploadedAt, p.screenLocalTime);
  const orderAt = ts.orderAt;
  const orderAtSource = ts.source; // "screen" | "upload" | "now"

  // date / hour формируются от orderAt в TZ Минска (UTC+3, без DST с 2011).
  const orderDate = new Date(orderAt);
  const minskMs = orderDate.getTime() + 3 * 60 * 60 * 1000;
  const minsk = new Date(minskMs);
  const date = `${minsk.getUTCFullYear()}-${String(minsk.getUTCMonth() + 1).padStart(2, "0")}-${String(minsk.getUTCDate()).padStart(2, "0")}`;
  const hour = minsk.getUTCHours();

  // ETA / tripMin берём из Эконом, иначе из Комфорта
  const etaSrc = (hasE ? econom : comfort) || {};
  const etaMin = isFiniteNum(etaSrc.etaMin, 0, 60) ? etaSrc.etaMin : null;
  const tripMin = isFiniteNum(etaSrc.tripMin, 0, 240) ? etaSrc.tripMin : null;

  const demand = ["green", "yellow", "red"].includes(p.demandColor) ? p.demandColor : "yellow";

  // Делаем calib-id того же формата что у calib-receiver
  const calibId = `calib-${date}-h${String(hour).padStart(2, "0")}-${randomBytes(3).toString("hex")}`;
  const screenLocalTime = typeof p.screenLocalTime === "string" && /^\d{1,2}:\d{2}$/.test(p.screenLocalTime.trim())
    ? p.screenLocalTime.trim()
    : null;
  const processedAt = new Date().toISOString();
  const calibRecord = {
    id: calibId,
    // orderAt — каноническое «когда юзер видел эти цены». Используется
    // калибровкой и аналитикой как момент сравнения.
    orderAt,
    // Откуда взялось orderAt — для трассируемости и фильтрации:
    // "screen" = распознали статусбар, "upload" = взяли время загрузки файла,
    // "now"   = и того и другого не было (редкий corner case).
    orderAtSource,
    // uploadedAt и processedAt оставлены для трассируемости пайплайна,
    // но они НЕ используются как «время заказа».
    uploadedAt: meta.uploadedAt || null,
    screenLocalTime,
    processedAt,
    // receivedAt оставлен ради обратной совместимости со старыми читателями
    // (calib-receiver, dashboard) — это псевдоним processedAt.
    receivedAt: processedAt,
    receivedFromIp: meta.uploaderIp || "screens-pipeline",
    fromAddress: fromAddr,
    toAddress: toAddr,
    // Reverse-geocode по координатам — точный адрес «улица + дом» от
    // Google. Нужен потому что Vision часто отдаёт POI («Дворец спорта»,
    // «Минск-Пасс», «Корона»), а для обучения и анализа важна именно
    // улица + номер дома. Если запрос упал — пишем "" и фронт упадёт
    // на исходный fromAddress (ничего не сломается).
    fromAddressGeo: (await reverseGeocode(g1.lat, g1.lng)).formatted || "",
    toAddressGeo: (await reverseGeocode(g2.lat, g2.lng)).formatted || "",
    fromLat: g1.lat,
    fromLng: g1.lng,
    toLat: g2.lat,
    toLng: g2.lng,
    ...(hasE ? { factE: econom.priceBYN } : {}),
    ...(hasC ? { factC: comfort.priceBYN } : {}),
    ...(etaMin != null ? { etaMin } : {}),
    ...(tripMin != null ? { tripMin } : {}),
    demand,
    date,
    hour,
    source: "screenshot-auto",
    notes: `Распознано из ${meta.originalName || filename} моделью ${v.model}. App=${p.appName || "?"}. orderAt=${orderAtSource}${screenLocalTime ? ` (статусбар ${screenLocalTime})` : ""}.`,
  };

  // Сначала просим Gemini оценить аномальность (это занимает 3-15 сек), и
  // ТОЛЬКО ПОТОМ пишем calib один раз через tmp+rename. Это исключает
  // race-condition: reader (`screen-receiver` /recent-calibs) либо не видит
  // файл вовсе, либо видит готовый JSON целиком — никогда частично.
  try {
    const history = await loadHistoryContext(calibId, 60);
    const anomaly = await detectAnomaly(calibRecord, history);
    if (anomaly) {
      calibRecord.anomaly = anomaly;
      if (anomaly.suspicious) {
        console.log(
          `  ⚠ anomaly: ${anomaly.severity || "?"}/${anomaly.category || "?"} — ${anomaly.reason}`,
        );
      }
    }
  } catch (e) {
    console.warn(`  ! anomaly check failed: ${e?.message || e}`);
  }

  const calibPath = join(CALIB_DIR, `${calibId}.json`);
  const tmpPath = `${calibPath}.tmp.${randomBytes(4).toString("hex")}`;
  await writeFile(tmpPath, JSON.stringify(calibRecord, null, 2));
  await rename(tmpPath, calibPath);

  // Перемещаем оригинал в processed/ под id калибровки
  const ext = filename.match(/\.(jpe?g|png|webp)$/i)?.[0] || ".bin";
  const newName = calibId + ext;
  const processedPath = await moveTo(PROCESSED, newName, srcPath, metaPath);
  await writeFile(processedPath + ".raw.json", JSON.stringify({ stage: "ok", model: v.model, tokens: v.tokens, parsed: p, calibId, geocode: { from: g1, to: g2 } }, null, 2));

  console.log(
    `  ✓ ${calibId} | ${fromAddr} → ${toAddr} | E=${hasE ? econom.priceBYN.toFixed(2) : "—"} C=${hasC ? comfort.priceBYN.toFixed(2) : "—"} | demand=${demand} | orderAt=${orderAtSource}${screenLocalTime ? `(${screenLocalTime})` : ""}`,
  );
  return { ok: true, calibId };
}

// ────────── main ──────────
async function main() {
  const t0 = Date.now();
  let files;
  try {
    files = (await readdir(INCOMING))
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .sort(); // FIFO по имени
  } catch (e) {
    console.error("[process-screens] readdir failed:", e);
    process.exit(1);
  }

  if (files.length === 0) {
    console.log("[process-screens] incoming пуст, выхожу");
    return;
  }

  // Сортировка sort() выше = FIFO по имени файла (имена включают
  // YYYYMMDD-HHMMSS-mmm-SEQ — старшие приходят первыми).
  const batch = files.slice(0, MAX_PER_RUN);
  const remaining = files.length - batch.length;
  console.log(
    `[process-screens] очередь=${files.length}, беру ${batch.length}, ` +
      `останется=${remaining}, concurrency=${CONCURRENCY}`,
  );

  let okCnt = 0;
  let failCnt = 0;

  async function handleOne(f) {
    try {
      const r = await processOne(f);
      if (r.ok) okCnt += 1;
      else failCnt += 1;
    } catch (e) {
      failCnt += 1;
      console.error(`[process-screens] processOne(${f}) crashed:`, e);
      // Файл никогда не теряется: при крэше двигаем в failed/ с описанием ошибки.
      try {
        await rename(join(INCOMING, f), join(FAILED, f));
        await writeFile(
          join(FAILED, f + ".error.json"),
          JSON.stringify({ stage: "crash", error: String(e) }, null, 2),
        );
      } catch {
        /* ignore */
      }
    }
  }

  // Параллельный пул фиксированной ширины: запускаем CONCURRENCY воркеров,
  // каждый забирает следующий файл из общего курсора. Это даёт ~3× ускорение
  // при наплыве и при этом не превышает Gemini rate-limit.
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= batch.length) return;
      await handleOne(batch[i]);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.max(1, CONCURRENCY); w += 1) workers.push(worker());
  await Promise.all(workers);

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (remaining > 0) {
    console.log(
      `[process-screens] готово за ${dt}s: ✓${okCnt} ✗${failCnt}, ` +
        `в очереди ещё ${remaining} — обработаются в следующих тиках cron`,
    );
  } else {
    console.log(
      `[process-screens] готово за ${dt}s: ✓${okCnt} ✗${failCnt}, очередь пуста`,
    );
  }
}

main().catch((e) => {
  console.error("[process-screens] fatal:", e);
  process.exit(1);
});
