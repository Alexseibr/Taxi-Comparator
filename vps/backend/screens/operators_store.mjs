// operators_store.mjs — кеш «IP → имя оператора» + общий список последних имён.
//
// Назначение: при загрузке скринов через FAB ("синяя камера на карте") мы
// хотим спрашивать имя сотрудника ТОЛЬКО один раз с конкретного устройства/IP.
// При следующем заходе с того же IP сразу подставляем сохранённое имя.
//
// Хранилище — простой JSON-файл, обновляется атомарно (tmp + rename), писать
// нечасто (в среднем раз в несколько минут), debounce 1с против шторма
// одновременных загрузок.
//
// Формат файла:
// {
//   "ipToOperator": { "<ip>": { "name": "Иван", "lastAt": "2026-05-01T..." } },
//   "names":        { "<lower(name)>": { "display": "Иван", "count": 5,
//                                         "lastAt": "2026-05-01T..." } }
// }

import { writeFile, readFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

const MAX_NAME_LEN = 60;
const PERSIST_DEBOUNCE_MS = 1_000;
const RECENT_NAMES_LIMIT_DEFAULT = 100;
// IP-маппинг живёт долго (90 дней) — переустановки IP у одного оператора
// в пределах NAT/CGNAT — норма, имя стабильно. Чистим при старте.
const IP_TTL_MS = 90 * 24 * 60 * 60 * 1000;

let FILE_PATH = "";
let state = { ipToOperator: {}, names: {} };
let inited = false;
let pendingTimer = null;
let writeInFlight = null;

function nowIso() {
  return new Date().toISOString();
}

export function normalizeOperatorName(raw) {
  if (typeof raw !== "string") return "";
  // Убираем управляющие символы, схлопываем пробелы.
  const s = raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  return s.length > MAX_NAME_LEN ? s.slice(0, MAX_NAME_LEN).trim() : s;
}

function pruneOldIps() {
  const cutoff = Date.now() - IP_TTL_MS;
  for (const [ip, rec] of Object.entries(state.ipToOperator)) {
    const t = rec?.lastAt ? Date.parse(rec.lastAt) : 0;
    if (!t || t < cutoff) delete state.ipToOperator[ip];
  }
}

export async function init(filePath) {
  if (!filePath) throw new Error("operators_store.init: filePath required");
  FILE_PATH = filePath;
  try {
    const raw = await readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    state = {
      ipToOperator:
        parsed && typeof parsed.ipToOperator === "object" && parsed.ipToOperator
          ? parsed.ipToOperator
          : {},
      names:
        parsed && typeof parsed.names === "object" && parsed.names
          ? parsed.names
          : {},
    };
    pruneOldIps();
  } catch (e) {
    if (e?.code !== "ENOENT") {
      console.warn(
        `[operators_store] read failed (${e?.message || e}), starting fresh`,
      );
    }
    state = { ipToOperator: {}, names: {} };
  }
  inited = true;
  // Периодический prune (раз в сутки) — иначе TTL соблюдался бы только при
  // рестарте сервиса и ipToOperator неограниченно бы рос.
  // unref(), чтобы интервал не держал event loop при тестах.
  const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
  const t = setInterval(() => {
    const before = Object.keys(state.ipToOperator).length;
    pruneOldIps();
    const after = Object.keys(state.ipToOperator).length;
    if (before !== after) {
      console.log(
        `[operators_store] periodic prune: ${before} → ${after} IPs (TTL ${IP_TTL_MS / 86400000}d)`,
      );
      schedulePersist();
    }
  }, PRUNE_EVERY_MS);
  if (typeof t.unref === "function") t.unref();
}

function schedulePersist() {
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    persistNow().catch((e) =>
      console.error(`[operators_store] persist failed: ${e?.message || e}`),
    );
  }, PERSIST_DEBOUNCE_MS);
  // Не блокируем shutdown процесса этим таймером.
  if (typeof pendingTimer.unref === "function") pendingTimer.unref();
}

async function persistNow() {
  if (!FILE_PATH) return;
  // Сериализуем последовательно — два параллельных rename на один файл = баг.
  if (writeInFlight) {
    try {
      await writeInFlight;
    } catch {
      /* ignore */
    }
  }
  writeInFlight = (async () => {
    const dir = dirname(FILE_PATH);
    try {
      await mkdir(dir, { recursive: true });
    } catch {
      /* ignore */
    }
    const tmp = `${FILE_PATH}.tmp.${randomBytes(4).toString("hex")}`;
    const json = JSON.stringify(state, null, 2);
    await writeFile(tmp, json);
    await rename(tmp, FILE_PATH);
  })();
  try {
    await writeInFlight;
  } finally {
    writeInFlight = null;
  }
}

export function getOperatorByIp(ip) {
  if (!inited) return null;
  if (!ip || typeof ip !== "string") return null;
  const rec = state.ipToOperator[ip];
  if (!rec || typeof rec.name !== "string" || !rec.name) return null;
  return rec.name;
}

export function recordUpload(ip, name) {
  if (!inited) return;
  const norm = normalizeOperatorName(name);
  if (!norm) return;
  const ts = nowIso();
  if (ip && typeof ip === "string") {
    state.ipToOperator[ip] = { name: norm, lastAt: ts };
  }
  const key = norm.toLowerCase();
  const cur = state.names[key];
  if (cur) {
    cur.display = norm; // на случай разной капитализации — берём последнюю
    cur.count = (cur.count || 0) + 1;
    cur.lastAt = ts;
  } else {
    state.names[key] = { display: norm, count: 1, lastAt: ts };
  }
  schedulePersist();
}

export function listRecentNames(limit = RECENT_NAMES_LIMIT_DEFAULT) {
  if (!inited) return [];
  const arr = Object.values(state.names);
  arr.sort((a, b) => {
    // По убыванию lastAt; при равенстве — по убыванию count.
    const ta = a?.lastAt ? Date.parse(a.lastAt) : 0;
    const tb = b?.lastAt ? Date.parse(b.lastAt) : 0;
    if (tb !== ta) return tb - ta;
    return (b?.count || 0) - (a?.count || 0);
  });
  return arr.slice(0, Math.max(0, limit | 0)).map((r) => r.display);
}

// Для тестов / админских ручек, если понадобится.
export function _debugSnapshot() {
  return JSON.parse(JSON.stringify(state));
}
