// routes/uploads_stats.mjs — JSON-агрегатор для UI «Статистика по скринам».
// GET /parsing/uploads-stats?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Та же база что и /parsing/uploads.xlsx (calib-*.json), но возвращает дерево
// IP → день → список скриншотов, чтобы UI мог раскрывать его inline.
// Auth: requireAuth(["admin","antifraud"]).

import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { requireAuth } from "../lib/auth.mjs";

export const uploadsStatsRouter = express.Router();

const CALIB_DIR = process.env.CALIB_DIR || "/var/www/rwbtaxi/data/calib";
const MAX_DAYS = Number(process.env.PARSING_EXPORT_MAX_DAYS || 31);
const MAX_FILES = Number(process.env.PARSING_EXPORT_MAX_FILES || 20000);
const MAX_SCAN_FILES = Number(
  process.env.PARSING_EXPORT_MAX_SCAN_FILES || 100000,
);
const MINSK_OFFSET_MS = 3 * 60 * 60 * 1000;
// Имена файлов в notes реально встречаются как ASCII-токены без пробелов:
//   IMG_2040.png, IMG_0296.jpeg, 1000479776.jpg, Screenshot_…_yandex.taxi.jpg
// Поэтому regex строгий — без \s и юникод-классов; берём ПОСЛЕДНЕЕ совпадение
// как фактическое имя файла, отбрасывая префиксы вида «Распознано из …».
const NOTES_JPG_RE = /([A-Za-z0-9._\-]+\.(?:jpe?g|png|webp))/gi;

function isDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function daysBetweenInclusive(from, to) {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / 86400000) + 1;
}
function uploadIso(o) {
  return o.uploadedAt || o.receivedAt || o.processedAt || "";
}
function uploadLocalDate(o) {
  const iso = uploadIso(o);
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t + MINSK_OFFSET_MS).toISOString().slice(0, 10);
}
function fmtMinskDateTime(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t + MINSK_OFFSET_MS).toISOString().replace("T", " ").slice(0, 19);
}
function fmtMinskTime(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t + MINSK_OFFSET_MS).toISOString().slice(11, 19);
}
function jpgFromNotes(notes) {
  if (!notes || typeof notes !== "string") return "";
  const m = [...notes.matchAll(NOTES_JPG_RE)];
  if (m.length === 0) return "";
  return m[m.length - 1][1].trim();
}

uploadsStatsRouter.get(
  "/uploads-stats",
  requireAuth(["admin", "antifraud"]),
  async (req, res, next) => {
    try {
      const from = String(req.query.from || "");
      const to = String(req.query.to || "");
      if (!isDate(from) || !isDate(to)) {
        return res
          .status(400)
          .json({ ok: false, error: "from/to_required_YYYY-MM-DD" });
      }
      if (from > to) {
        return res.status(400).json({ ok: false, error: "from_gt_to" });
      }
      const span = daysBetweenInclusive(from, to);
      if (!Number.isFinite(span) || span > MAX_DAYS) {
        return res
          .status(400)
          .json({ ok: false, error: "range_too_wide", max_days: MAX_DAYS });
      }

      let names;
      try {
        names = await fs.readdir(CALIB_DIR);
      } catch (e) {
        req.log?.error(
          { err: e?.message, dir: CALIB_DIR },
          "calib_dir_read_failed",
        );
        return res
          .status(500)
          .json({ ok: false, error: "calib_dir_unavailable" });
      }

      const items = [];
      let scanned = 0;
      let truncatedScan = false;
      let truncatedMatched = false;
      for (const n of names) {
        if (!n.startsWith("calib-") || !n.endsWith(".json")) continue;
        if (items.length >= MAX_FILES) {
          truncatedMatched = true;
          break;
        }
        if (scanned >= MAX_SCAN_FILES) {
          truncatedScan = true;
          break;
        }
        scanned++;
        try {
          const raw = await fs.readFile(path.join(CALIB_DIR, n), "utf8");
          const o = JSON.parse(raw);
          const d = uploadLocalDate(o);
          if (!d || d < from || d > to) continue;
          items.push(o);
        } catch {
          /* skip */
        }
      }

      // ── Группировка по IP → день → items[]
      const tree = new Map();
      // Доп.признаки для типизации/склейки в устройства
      const ipJpgs = new Map(); // ip → string[]   (имена jpg)
      const imgToIps = new Map(); // "IMG_2040.png" (lowercased) → Set<ip>
      // iPhone IMG-counter с временем загрузки — для bridge-склейки
      // ip → [{ n: 2040, t: "2026-04-27T12:34:00Z" }, ...]
      const ipImgs = new Map();
      // Домашние адреса: ip → Map<from_addr, count>; и обратный индекс адрес→Set<ip>
      const ipFromAddrs = new Map();
      const fromAddrToIps = new Map();

      for (const o of items) {
        const ip = o.receivedFromIp || "unknown";
        const day = uploadLocalDate(o);
        const upIso = uploadIso(o);
        const susp = !!o.anomaly?.suspicious;
        const src = o.source || "—";
        const jpg = jpgFromNotes(o.notes);

        const operator =
          typeof o.operator === "string" && o.operator ? o.operator : "";

        if (!tree.has(ip)) {
          tree.set(ip, {
            total: 0,
            suspicious: 0,
            firstSeen: upIso,
            lastSeen: upIso,
            sources: new Map(),
            days: new Map(),
            operators: new Map(),
          });
        }
        const ipNode = tree.get(ip);
        ipNode.total++;
        if (susp) ipNode.suspicious++;
        if (upIso && (!ipNode.firstSeen || upIso < ipNode.firstSeen))
          ipNode.firstSeen = upIso;
        if (upIso && (!ipNode.lastSeen || upIso > ipNode.lastSeen))
          ipNode.lastSeen = upIso;
        ipNode.sources.set(src, (ipNode.sources.get(src) || 0) + 1);
        if (operator) {
          ipNode.operators.set(
            operator,
            (ipNode.operators.get(operator) || 0) + 1,
          );
        }

        if (!ipNode.days.has(day)) {
          ipNode.days.set(day, { total: 0, suspicious: 0, items: [] });
        }
        const dayNode = ipNode.days.get(day);
        dayNode.total++;
        if (susp) dayNode.suspicious++;
        dayNode.items.push({
          id: o.id || "",
          uploadedAt: fmtMinskDateTime(upIso),
          uploadedTime: fmtMinskTime(upIso),
          source: src,
          jpg,
          suspicious: susp,
          anomalyCategory: o.anomaly?.category || "",
          anomalySeverity: o.anomaly?.severity || "",
          fromAddress: o.fromAddress || "",
          toAddress: o.toAddress || "",
          factC: typeof o.factC === "number" ? o.factC : null,
          operator: operator || null,
        });

        if (jpg) {
          if (!ipJpgs.has(ip)) ipJpgs.set(ip, []);
          ipJpgs.get(ip).push(jpg);
          // iPhone-counter: IMG_NNNN.* — основа union-find
          const m = /^IMG_(\d{1,5})\./i.exec(jpg);
          if (m) {
            const key = jpg.toLowerCase();
            if (!imgToIps.has(key)) imgToIps.set(key, new Set());
            imgToIps.get(key).add(ip);
            if (!ipImgs.has(ip)) ipImgs.set(ip, []);
            ipImgs.get(ip).push({ n: Number(m[1]), t: upIso || "" });
          }
        }
        const fromA = (o.fromAddress || "").trim();
        if (fromA) {
          if (!ipFromAddrs.has(ip)) ipFromAddrs.set(ip, new Map());
          const m = ipFromAddrs.get(ip);
          m.set(fromA, (m.get(fromA) || 0) + 1);
          if (!fromAddrToIps.has(fromA)) fromAddrToIps.set(fromA, new Set());
          fromAddrToIps.get(fromA).add(ip);
        }
      }

      // ── Многосигнальная склейка устройств
      //
      // Сигналы:
      //   1) STRONG — точное совпадение IMG_NNNN: один и тот же файл прислали
      //      с двух IP. Очень редкое событие, почти всегда означает один телефон.
      //   2) MEDIUM — IMG-bridge: счётчики двух IP перекрываются ИЛИ соседствуют
      //      (gap ≤ MAX_BRIDGE_GAP), и при сортировке по времени порядок номеров
      //      почти монотонен (доля инверсий ≤ MAX_BRIDGE_INV_RATE). Именно так
      //      выглядит один реальный iPhone, ходящий из разных Wi-Fi.
      //   3) WEAK  — общий «домашний» fromAddress (≥3 раз у обоих IP, видело
      //      ≤MAX_HOME_ADDR_UNIQ_IPS уникальных IP). Только для подсветки связей
      //      в UI; в union-find НЕ участвует, т.к. центральные адреса дают много
      //      ложных мостов.
      //
      // Из bridge-склейки и адресных связей исключаются IP-«хабы» — публичные
      // Wi-Fi/CGNAT/прокси, через которые ходят разные телефоны:
      //   - IMG-диапазон > MAX_NORMAL_IMG_SPAN номеров (≈ один человек реально
      //     не делает столько фото за период)
      //   - скорость загрузок > MAX_NORMAL_VELOCITY фото/день
      const MAX_BRIDGE_GAP = 200;
      const MAX_BRIDGE_INV_RATE = 0.20;
      const MAX_BRIDGE_BACK_STEP = 50; // допуск инверсии номера в одной точке
      const MAX_NORMAL_IMG_SPAN = 500;
      const MAX_NORMAL_VELOCITY = 50; // фото/день
      const HOME_ADDR_MIN_PER_IP = 3;
      const MAX_HOME_ADDR_UNIQ_IPS = 3;

      // detect IP-hubs (по iPhone-снимкам)
      const hubs = new Set();
      // Кэшируем диапазон IMG, чтобы не пересчитывать в bridgeMatch.
      // Считаем мин/макс циклом (без spread) — у хаба может быть тысячи фото,
      // и Math.max(...arr) на больших массивах роняет стек.
      const ipImgRange = new Map();
      for (const [ip, arr] of ipImgs.entries()) {
        if (arr.length === 0) continue;
        let minN = arr[0].n;
        let maxN = arr[0].n;
        let tMin = Infinity;
        let tMax = -Infinity;
        for (const x of arr) {
          if (x.n < minN) minN = x.n;
          if (x.n > maxN) maxN = x.n;
          const t = Date.parse(x.t);
          if (!Number.isNaN(t)) {
            if (t < tMin) tMin = t;
            if (t > tMax) tMax = t;
          }
        }
        ipImgRange.set(ip, { min: minN, max: maxN });
        if (arr.length < 3) continue;
        if (maxN - minN > MAX_NORMAL_IMG_SPAN) {
          hubs.add(ip);
          continue;
        }
        if (tMin !== Infinity && tMax !== -Infinity) {
          const days = Math.max((tMax - tMin) / 86400000, 0.5);
          if (arr.length / days > MAX_NORMAL_VELOCITY) hubs.add(ip);
        }
      }

      // union-find
      const parent = new Map();
      const mergedReasons = new Map(); // root → { exact:Set<ip>, bridge:Set<ip> }
      const find = (x) => {
        let cur = x;
        while ((parent.get(cur) ?? cur) !== cur) {
          const p = parent.get(cur) ?? cur;
          parent.set(cur, parent.get(p) ?? p);
          cur = parent.get(cur);
        }
        return cur;
      };
      const union = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
      };
      for (const ip of tree.keys()) parent.set(ip, ip);

      // Сигнал 1: STRONG — exact-IMG
      for (const ips of imgToIps.values()) {
        if (ips.size < 2) continue;
        const arr = [...ips];
        for (let i = 1; i < arr.length; i++) union(arr[0], arr[i]);
        // помечаем как «склеено по точному совпадению»
        for (const ip of arr) {
          const root = find(ip);
          if (!mergedReasons.has(root))
            mergedReasons.set(root, { exact: new Set(), bridge: new Set() });
          for (const other of arr) {
            if (other !== ip) mergedReasons.get(root).exact.add(other);
          }
        }
      }

      // Сигнал 2: MEDIUM — IMG-bridge между не-хабами
      function bridgeMatch(a, b) {
        const A = ipImgs.get(a);
        const B = ipImgs.get(b);
        if (!A || !B || A.length < 3 || B.length < 3) return false;
        const ra = ipImgRange.get(a);
        const rb = ipImgRange.get(b);
        if (!ra || !rb) return false;
        // перекрытие ИЛИ соседство в пределах MAX_BRIDGE_GAP
        if (ra.max + MAX_BRIDGE_GAP < rb.min) return false;
        if (rb.max + MAX_BRIDGE_GAP < ra.min) return false;
        // темпоральная согласованность: сортируем по времени (прямое сравнение
        // ISO-строк корректно и быстрее, чем localeCompare), считаем инверсии
        const all = A.concat(B).sort((x, y) =>
          x.t < y.t ? -1 : x.t > y.t ? 1 : 0,
        );
        let inv = 0;
        for (let i = 1; i < all.length; i++) {
          if (all[i].n < all[i - 1].n - MAX_BRIDGE_BACK_STEP) inv++;
        }
        const rate = inv / Math.max(all.length - 1, 1);
        return rate <= MAX_BRIDGE_INV_RATE;
      }
      const nonHubs = [...tree.keys()].filter(
        (ip) => !hubs.has(ip) && (ipImgs.get(ip)?.length || 0) >= 3,
      );
      for (let i = 0; i < nonHubs.length; i++) {
        for (let j = i + 1; j < nonHubs.length; j++) {
          const a = nonHubs[i];
          const b = nonHubs[j];
          if (bridgeMatch(a, b)) {
            union(a, b);
            const root = find(a);
            if (!mergedReasons.has(root))
              mergedReasons.set(root, { exact: new Set(), bridge: new Set() });
            // обе стороны как мосты
            mergedReasons.get(root).bridge.add(a);
            mergedReasons.get(root).bridge.add(b);
          }
        }
      }

      // Сигнал 3: WEAK — общий «домашний» fromAddress.
      // НЕ склеивает в union-find (центральные адреса дают ложные мосты),
      // зато подсвечивается отдельным блоком «возможные связи через адрес».
      //
      // Идём по обратному индексу адрес→IPs: пары рождаются только для тех IP,
      // которые реально делят адрес — O(K) по числу совпадений вместо O(N²).
      const addressLinks = []; // [{ a, b, address, aCount, bCount, uniqueIps }]
      const seenPair = new Set();
      for (const [addr, ipSet] of fromAddrToIps.entries()) {
        if (ipSet.size < 2 || ipSet.size > MAX_HOME_ADDR_UNIQ_IPS) continue;
        const arr = [...ipSet].filter((ip) => !hubs.has(ip));
        if (arr.length < 2) continue;
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            const a = arr[i];
            const b = arr[j];
            const ca = ipFromAddrs.get(a)?.get(addr) || 0;
            const cb = ipFromAddrs.get(b)?.get(addr) || 0;
            if (ca < HOME_ADDR_MIN_PER_IP || cb < HOME_ADDR_MIN_PER_IP)
              continue;
            const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`;
            if (seenPair.has(pairKey)) continue;
            seenPair.add(pairKey);
            addressLinks.push({
              a,
              b,
              address: addr,
              aCount: ca,
              bCount: cb,
              uniqueIps: ipSet.size,
              sameDevice: find(a) === find(b),
            });
          }
        }
      }

      // ── Тип устройства по IP (на основе имён jpg, отправленных с этого IP)
      function ipDeviceType(ip) {
        const jpgs = ipJpgs.get(ip) || [];
        let iphone = 0;
        let android = 0;
        for (const j of jpgs) {
          if (/^IMG_\d{1,5}\./i.test(j)) iphone++;
          else if (/^\d{7,12}\./.test(j)) android++;
        }
        if (iphone > android && iphone > 0) return "iPhone";
        if (android > 0) return "Android";
        return "другое";
      }

      // ── В выходную форму
      const ips = [...tree.entries()]
        .map(([ip, n]) => ({
          ip,
          deviceId: find(ip),
          deviceType: ipDeviceType(ip),
          isHub: hubs.has(ip),
          total: n.total,
          suspicious: n.suspicious,
          firstSeen: fmtMinskDateTime(n.firstSeen),
          lastSeen: fmtMinskDateTime(n.lastSeen),
          operators: [...n.operators.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({ name, count })),
          sources: [...n.sources.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([s, c]) => ({ source: s, count: c })),
          days: [...n.days.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([day, d]) => ({
              day,
              total: d.total,
              suspicious: d.suspicious,
              items: d.items.sort((a, b) =>
                String(b.uploadedAt).localeCompare(String(a.uploadedAt)),
              ),
            })),
        }))
        .sort((a, b) => b.total - a.total);

      // ── Сводка по устройствам (агрегация поверх IP)
      const devMap = new Map();
      for (const ipRow of ips) {
        const dev = ipRow.deviceId;
        if (!devMap.has(dev)) {
          devMap.set(dev, {
            id: dev,
            ips: [],
            types: new Map(),
            total: 0,
            suspicious: 0,
            days: new Set(),
            firstSeen: ipRow.firstSeen,
            lastSeen: ipRow.lastSeen,
            imgMin: null,
            imgMax: null,
            operators: new Map(),
          });
        }
        const d = devMap.get(dev);
        d.ips.push(ipRow.ip);
        d.types.set(
          ipRow.deviceType,
          (d.types.get(ipRow.deviceType) || 0) + ipRow.total,
        );
        d.total += ipRow.total;
        d.suspicious += ipRow.suspicious;
        for (const day of ipRow.days) d.days.add(day.day);
        for (const op of ipRow.operators || []) {
          d.operators.set(op.name, (d.operators.get(op.name) || 0) + op.count);
        }
        if (ipRow.firstSeen && (!d.firstSeen || ipRow.firstSeen < d.firstSeen))
          d.firstSeen = ipRow.firstSeen;
        if (ipRow.lastSeen && (!d.lastSeen || ipRow.lastSeen > d.lastSeen))
          d.lastSeen = ipRow.lastSeen;
        // диапазон IMG-counter по этому устройству
        for (const day of ipRow.days) {
          for (const it of day.items) {
            const m = /^IMG_(\d{1,5})\./i.exec(it.jpg || "");
            if (m) {
              const n = Number(m[1]);
              if (d.imgMin === null || n < d.imgMin) d.imgMin = n;
              if (d.imgMax === null || n > d.imgMax) d.imgMax = n;
            }
          }
        }
      }
      const devices = [...devMap.values()]
        .map((d) => {
          const main = [...d.types.entries()].sort((a, b) => b[1] - a[1])[0];
          const reasons = mergedReasons.get(d.id);
          // Объединение в одно устройство случилось ТОЛЬКО если в кластере
          // больше одного IP. Тогда показываем «по чему склеено».
          const mergedBy = [];
          if (d.ips.length > 1) {
            if (reasons && reasons.exact.size > 0)
              mergedBy.push(`exact-img:${reasons.exact.size}`);
            if (reasons && reasons.bridge.size > 0)
              mergedBy.push(`img-bridge:${reasons.bridge.size}`);
          }
          const hubIps = d.ips.filter((ip) => hubs.has(ip));
          return {
            id: d.id,
            type: main ? main[0] : "—",
            ips: d.ips.sort(),
            total: d.total,
            suspicious: d.suspicious,
            daysCount: d.days.size,
            firstSeen: d.firstSeen,
            lastSeen: d.lastSeen,
            imgMin: d.imgMin,
            imgMax: d.imgMax,
            mergedBy,
            hubIps,
            operators: [...d.operators.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([name, count]) => ({ name, count })),
          };
        })
        .sort((a, b) => b.total - a.total);

      res.set("Cache-Control", "no-store");
      return res.json({
        ok: true,
        from,
        to,
        total: items.length,
        ipsCount: ips.length,
        devicesCount: devices.length,
        hubsCount: hubs.size,
        scanned,
        truncated: truncatedScan || truncatedMatched,
        devices,
        ips,
        // Связи по «домашнему адресу» — для отдельного блока в UI «возможные
        // связи». В union-find не участвуют (см. комментарий выше).
        addressLinks,
      });
    } catch (e) {
      next(e);
    }
  },
);
