#!/usr/bin/env node
// Переобработка processed/*.png|.jpg где у всех тарифов tripMin = null.
// Цель: получить «время в пути» из визуальной подсказки рядом с адресом
// назначения ("Брилевская 4 · 10 мин"), которое старый промпт не видел.
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";

const ROOT = process.env.SCREENS_DIR || "/var/www/rwbtaxi/data/screens";
const PROCESSED = join(ROOT, "processed");
const KEY = process.env.GOOGLE_API_KEY;
if (!KEY) { console.error("GOOGLE_API_KEY missing"); process.exit(1); }

const MAX = Number(process.env.REPARSE_MAX || 200);
const MODEL = process.env.REPARSE_MODEL || "gemini-2.5-flash";

const PROMPT = `Это скриншот мобильного приложения такси в Минске (Yandex Go или похожее).

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
      "etaMin": число минут ДО ПОДАЧИ водителя (показано В КАРТОЧКЕ тарифа, например "7 мин Эконом") или null,
      "tripMin": число минут В ПУТИ (продублируй сюда tripMinToDest — оно одно на все тарифы),
      "surge": число — множитель ⚡ (например 1.5) или null
    }
  ],
  "tripMinToDest": число минут В ПУТИ от точки А до точки Б. ВАЖНО: это НЕ время подачи водителя. В Yandex Go / Bolt время в пути показано РЯДОМ С АДРЕСОМ НАЗНАЧЕНИЯ в формате "<адрес назначения> · X мин" (например "Брилевская 4 · 10 мин"). Также это число дублируется на маршруте на карте у точки Б (например бейдж "10 мин"). Это значение ОДНО для всей поездки и не зависит от тарифа. Если не видишь — null,
  "demandColor": "green" | "yellow" | "red" — общий индикатор спроса/сурджа в приложении или null,
  "screenLocalTime": "ЧЧ:ММ" или null — время РОВНО как видно в статусбаре телефона (часы и минуты в верхней части экрана). Это локальное время Минска (Europe/Minsk, UTC+3). НЕ время «заказан в», НЕ время в карточке тарифа — только верхний статусбар.
}

Правила:
- Цены ОБЯЗАТЕЛЬНО приведи к BYN. Если на экране ₽/RUB/USD — в priceBYN ставь null и в notes поясни.
- Не выдумывай ничего. Если поле не видно — null.
- Адреса бери ровно как на экране (улица + дом, без города/страны).
- Если на экране только один тариф — массив из одного элемента.
- Если это НЕ скрин такси — isTaxiApp:false и пустые tariffs/адреса.`;

function postJson(host, path, body, timeout = 60000) {
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

async function callGemini(b64, mime) {
  const body = {
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };
  return postJson(
    "generativelanguage.googleapis.com",
    `/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(KEY)}`,
    body,
  );
}

const all = readdirSync(PROCESSED);
const setAll = new Set(all);
const candidates = [];
for (const f of all) {
  if (f.endsWith(".raw.json") || f.endsWith(".meta.json") || f.endsWith(".error.json")) continue;
  const rawName = `${f}.raw.json`;
  if (!setAll.has(rawName)) continue;
  let raw; try { raw = JSON.parse(readFileSync(join(PROCESSED, rawName), "utf8")); } catch { continue; }
  if (raw.stage !== "ok" || !raw.parsed?.isTaxiApp) continue;
  const has = (raw.parsed.tariffs || []).some((t) => t.tripMin != null) || raw.parsed.tripMinToDest != null;
  if (has) continue;
  candidates.push({ image: f, rawName });
}

const totalRaws = all.filter((x) => x.endsWith(".raw.json")).length;
console.log(`Кандидатов на переобработку: ${candidates.length} из ${totalRaws}`);
console.log(`Limit: ${MAX}, model: ${MODEL}`);

let processed = 0, gotTripMin = 0, fail = 0;
for (const c of candidates.slice(0, MAX)) {
  const path = join(PROCESSED, c.image);
  const buf = readFileSync(path);
  const lower = c.image.toLowerCase();
  const mime = lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg"
             : lower.endsWith(".webp") ? "image/webp" : "image/png";
  const r = await callGemini(buf.toString("base64"), mime);
  if (r.status !== 200) { fail++; console.warn(`✗ ${c.image}: HTTP ${r.status} ${r.body?.error?.message || r.body?.error || ""}`); await new Promise((rr) => setTimeout(rr, 500)); continue; }
  const text = r.body?.candidates?.[0]?.content?.parts?.[0]?.text;
  let parsed; try { parsed = JSON.parse(text); } catch { fail++; console.warn(`✗ ${c.image}: bad JSON`); continue; }
  if (!parsed?.isTaxiApp) { fail++; continue; }
  // Дублируем tripMinToDest на каждый тариф (как в process-screens.mjs)
  if (typeof parsed.tripMinToDest === "number" && isFinite(parsed.tripMinToDest) && parsed.tripMinToDest > 0 && parsed.tripMinToDest <= 240) {
    for (const t of (parsed.tariffs || [])) if (t.tripMin == null) t.tripMin = parsed.tripMinToDest;
  }
  const rawPath = join(PROCESSED, c.rawName);
  const raw = JSON.parse(readFileSync(rawPath, "utf8"));
  raw.parsed = parsed;
  raw.reparsedAt = new Date().toISOString();
  raw.reparseModel = MODEL;
  writeFileSync(rawPath, JSON.stringify(raw, null, 2));
  const has = (parsed.tariffs || []).some((t) => t.tripMin != null) || parsed.tripMinToDest != null;
  if (has) gotTripMin++;
  processed++;
  if (processed % 10 === 0) console.log(`  ${processed}/${candidates.length} (got tripMin: ${gotTripMin}, fail: ${fail})`);
  await new Promise((rr) => setTimeout(rr, 200));
}
console.log(`Готово: обработано ${processed}, из них с tripMin от Yandex ${gotTripMin}, ошибок ${fail}`);
