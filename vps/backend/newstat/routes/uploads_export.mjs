// routes/uploads_export.mjs — экспорт «всё по импорту скриншотов» в Excel.
// GET /parsing/uploads.xlsx?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Источник: /var/www/rwbtaxi/data/calib/calib-*.json — те же файлы что и
// /parsing/export.xlsx, но здесь интересуют МЕТА-поля загрузки:
//  - receivedFromIp / receivedAt / uploadedAt / processedAt — когда и откуда
//  - source — канал (screenshot-auto / screenshot-import / rwb-form / smoke-test)
//  - notes — содержит исходное имя jpg (`Распознано из 1000479776.jpg ...`)
//  - anomaly — флаг подозрительности от LLM-валидатора
//
// Листы:
//  1. Загрузки   — построчный список (1 строка = 1 скриншот)
//  2. По IP      — агрегат: всего, first_seen, last_seen, дней, % от total, suspicious
//  3. По дням×IP — pivot для графика активности
//  4. По каналам — split по source
//  5. Дубликаты  — если один и тот же jpg прошёл pipeline более одного раза
//
// Защита: requireAuth(["admin","antifraud"]), MAX_DAYS=31 (как в /parsing/export).

import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { requireAuth } from "../lib/auth.mjs";

export const uploadsExportRouter = express.Router();

const CALIB_DIR = process.env.CALIB_DIR || "/var/www/rwbtaxi/data/calib";
const MAX_DAYS = Number(process.env.PARSING_EXPORT_MAX_DAYS || 31);
const MAX_FILES = Number(process.env.PARSING_EXPORT_MAX_FILES || 20000);
// Жёсткая защита от больших архивов: даже если в диапазон попадает мало файлов,
// мы не должны читать (parse JSON) больше N файлов суммарно за один запрос.
const MAX_SCAN_FILES = Number(process.env.PARSING_EXPORT_MAX_SCAN_FILES || 100000);
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
// Дата ЗАКАЗА (Минск) — оставлена как информационное поле в листе «Загрузки»,
// чтобы можно было сопоставить заказ со скриншотом. Для фильтрации/группировки
// используется uploadLocalDate(), см. ниже.
function orderLocalDate(o) {
  if (typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(o.date)) {
    return o.date.slice(0, 10);
  }
  if (typeof o.orderAt === "string") {
    const t = Date.parse(o.orderAt);
    if (Number.isFinite(t)) {
      return new Date(t + MINSK_OFFSET_MS).toISOString().slice(0, 10);
    }
  }
  return "";
}
// Дата ЗАГРУЗКИ скриншота в Минске — основа отчёта. Берём первое доступное:
// uploadedAt > receivedAt > processedAt. Для самых старых записей всех трёх
// может не быть — вернём "", такие пойдут в pivot-колонку «Без даты».
function uploadIsoCandidate(o) {
  return o.uploadedAt || o.receivedAt || o.processedAt || "";
}
function uploadLocalDate(o) {
  const iso = uploadIsoCandidate(o);
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t + MINSK_OFFSET_MS).toISOString().slice(0, 10);
}
function fmtMinskDateTime(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + MINSK_OFFSET_MS);
  return d.toISOString().replace("T", " ").slice(0, 19);
}
// Достаём имя файла из notes. Берём ПОСЛЕДНЕЕ совпадение, чтобы не зацепить
// случайный «.jpg» внутри URL/префикса. Поддерживаем кириллицу/пробелы.
function jpgFromNotes(notes) {
  if (!notes || typeof notes !== "string") return "";
  const matches = [...notes.matchAll(NOTES_JPG_RE)];
  if (matches.length === 0) return "";
  return matches[matches.length - 1][1].trim();
}

uploadsExportRouter.get(
  "/uploads.xlsx",
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
          // Главный отбор: по дате ЗАГРУЗКИ скриншота (Минск), а не дате заказа.
          const d = uploadLocalDate(o);
          if (!d || d < from || d > to) continue;
          items.push(o);
        } catch {
          /* skip битые файлы */
        }
      }
      if (truncatedScan || truncatedMatched) {
        req.log?.warn(
          { scanned, matched: items.length, truncatedScan, truncatedMatched },
          "uploads_export_truncated",
        );
      }

      // Сортируем по uploadedAt (если есть) или по orderAt — нужно для «first/last seen».
      items.sort((a, b) => {
        const ka = a.uploadedAt || a.receivedAt || a.orderAt || "";
        const kb = b.uploadedAt || b.receivedAt || b.orderAt || "";
        return String(ka).localeCompare(String(kb));
      });

      // ── Агрегаты ──────────────────────────────────────────────────────────
      const total = items.length;
      const byIp = new Map(); // ip → { total, first, last, days:Set, susp, sources:Map }
      const bySource = new Map(); // source → { total, susp, ips:Set }
      const byIpDay = new Map(); // ip → Map<dayKey, count>  dayKey = "YYYY-MM-DD" | "—"
      const byJpg = new Map(); // jpgFile → count
      const allDays = new Set();
      const NO_DATE = "—";
      let hasNoDate = false;

      for (const o of items) {
        const ip = o.receivedFromIp || "—";
        const src = o.source || "—";
        const operator = (typeof o.operator === "string" && o.operator) || "";
        // День загрузки (Минск). Если все три upload-таймстампа отсутствуют —
        // запись попадает в bucket "—" (колонка «Без даты»).
        const day = uploadLocalDate(o) || NO_DATE;
        if (day === NO_DATE) hasNoDate = true;
        const upMinsk = fmtMinskDateTime(uploadIsoCandidate(o));
        const susp = !!o.anomaly?.suspicious;

        // by IP
        if (!byIp.has(ip)) {
          byIp.set(ip, {
            total: 0,
            first: upMinsk,
            last: upMinsk,
            days: new Set(),
            susp: 0,
            sources: new Map(),
            operators: new Map(),
          });
        }
        const rIp = byIp.get(ip);
        rIp.total++;
        if (susp) rIp.susp++;
        // В «дни активности» считаем только реальные даты, без «—».
        if (day !== NO_DATE) rIp.days.add(day);
        if (upMinsk && (!rIp.first || upMinsk < rIp.first)) rIp.first = upMinsk;
        if (upMinsk && (!rIp.last || upMinsk > rIp.last)) rIp.last = upMinsk;
        rIp.sources.set(src, (rIp.sources.get(src) || 0) + 1);
        if (operator) {
          rIp.operators.set(operator, (rIp.operators.get(operator) || 0) + 1);
        }

        // by source
        if (!bySource.has(src)) {
          bySource.set(src, { total: 0, susp: 0, ips: new Set() });
        }
        const rSrc = bySource.get(src);
        rSrc.total++;
        if (susp) rSrc.susp++;
        rSrc.ips.add(ip);

        // by IP × day (pivot) — кладём ВСЕГДА (включая bucket "—"), чтобы
        // итог по строке IP всегда совпадал с суммой ячеек по этой строке.
        if (day !== NO_DATE) allDays.add(day);
        if (!byIpDay.has(ip)) byIpDay.set(ip, new Map());
        const m = byIpDay.get(ip);
        m.set(day, (m.get(day) || 0) + 1);

        // duplicates
        const jpg = jpgFromNotes(o.notes);
        if (jpg) byJpg.set(jpg, (byJpg.get(jpg) || 0) + 1);
      }

      // ── Workbook ──────────────────────────────────────────────────────────
      const wb = new ExcelJS.Workbook();
      wb.creator = "rwbtaxi-newstat";
      wb.created = new Date();

      // Лист 1 — Загрузки (детально)
      const ws1 = wb.addWorksheet("Загрузки");
      ws1.columns = [
        { header: "ID скриншота", key: "id", width: 38 },
        { header: "Дата загрузки (Минск)", key: "uploadedDay", width: 14 },
        { header: "Загружен (Минск)", key: "uploaded", width: 20 },
        { header: "Принят сервером (Минск)", key: "received", width: 22 },
        { header: "Обработан (Минск)", key: "processed", width: 20 },
        { header: "IP отправителя", key: "ip", width: 18 },
        { header: "Канал", key: "source", width: 18 },
        { header: "Исходный jpg", key: "jpg", width: 22 },
        { header: "Дата заказа (Минск)", key: "orderDate", width: 14 },
        { header: "Время заказа (Минск)", key: "orderTime", width: 14 },
        { header: "Подозрительно", key: "susp", width: 13 },
        { header: "Категория аномалии", key: "anomCat", width: 18 },
        { header: "Severity", key: "anomSev", width: 10 },
        { header: "Модель LLM", key: "model", width: 18 },
        { header: "Оператор", key: "operator", width: 18 },
      ];
      ws1.getRow(1).font = { bold: true };
      ws1.getRow(1).alignment = { horizontal: "center" };
      ws1.views = [{ state: "frozen", ySplit: 1 }];
      ws1.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 15 } };
      for (const o of items) {
        ws1.addRow({
          id: o.id || "",
          uploadedDay: uploadLocalDate(o),
          uploaded: fmtMinskDateTime(o.uploadedAt),
          received: fmtMinskDateTime(o.receivedAt),
          processed: fmtMinskDateTime(o.processedAt),
          ip: o.receivedFromIp || "",
          source: o.source || "",
          jpg: jpgFromNotes(o.notes),
          orderDate: orderLocalDate(o),
          orderTime: o.screenLocalTime || "",
          susp: o.anomaly?.suspicious ? "да" : "нет",
          anomCat: o.anomaly?.category || "",
          anomSev: o.anomaly?.severity || "",
          model: o.anomaly?.model || "",
          operator: o.operator || "",
        });
      }

      // Лист 2 — По IP
      const ws2 = wb.addWorksheet("По IP");
      ws2.columns = [
        { header: "IP", key: "ip", width: 18 },
        { header: "Всего скриншотов", key: "total", width: 16 },
        { header: "% от всех", key: "pct", width: 10 },
        { header: "Дней активных", key: "days", width: 14 },
        { header: "Первая загрузка", key: "first", width: 20 },
        { header: "Последняя загрузка", key: "last", width: 20 },
        { header: "Подозрительных", key: "susp", width: 14 },
        { header: "% подозрительных", key: "suspPct", width: 16 },
        { header: "Каналы (split)", key: "sources", width: 40 },
        { header: "Операторы (split)", key: "operators", width: 40 },
      ];
      ws2.getRow(1).font = { bold: true };
      ws2.getRow(1).alignment = { horizontal: "center" };
      ws2.views = [{ state: "frozen", ySplit: 1 }];
      ws2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 } };
      const ipsSorted = [...byIp.entries()].sort((a, b) => b[1].total - a[1].total);
      for (const [ip, r] of ipsSorted) {
        const sourcesStr = [...r.sources.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([s, c]) => `${s}: ${c}`)
          .join("; ");
        const operatorsStr = [...r.operators.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([n, c]) => `${n}: ${c}`)
          .join("; ");
        ws2.addRow({
          ip,
          total: r.total,
          pct: total > 0 ? +((r.total / total) * 100).toFixed(2) : 0,
          days: r.days.size,
          first: r.first || "",
          last: r.last || "",
          susp: r.susp,
          suspPct: r.total > 0 ? +((r.susp / r.total) * 100).toFixed(2) : 0,
          sources: sourcesStr,
          operators: operatorsStr,
        });
      }

      // Лист 3 — По дням × IP (pivot)
      // ИТОГО по строке = сумма ячеек по этой строке (включая колонку «Без даты»),
      // что гарантирует совпадение с totalcount по IP.
      const ws3 = wb.addWorksheet("По дням × IP");
      const days = [...allDays].sort();
      const dayKeys = [...days];
      if (hasNoDate) dayKeys.push(NO_DATE);
      const dayHeader = (d) => (d === NO_DATE ? "Без даты" : d);
      ws3.columns = [
        { header: "IP", key: "ip", width: 18 },
        ...dayKeys.map((d) => ({ header: dayHeader(d), key: d, width: 11 })),
        { header: "Итого", key: "total", width: 10 },
      ];
      ws3.getRow(1).font = { bold: true };
      ws3.getRow(1).alignment = { horizontal: "center" };
      ws3.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
      for (const [ip] of ipsSorted) {
        const m = byIpDay.get(ip) || new Map();
        const row = { ip };
        let rowSum = 0;
        for (const d of dayKeys) {
          const v = m.get(d) || 0;
          row[d] = v;
          rowSum += v;
        }
        row.total = rowSum;
        ws3.addRow(row);
      }
      if (ipsSorted.length > 0) {
        const totalRow = { ip: "ИТОГО" };
        let grand = 0;
        for (const d of dayKeys) {
          let s = 0;
          for (const [, m] of byIpDay) s += m.get(d) || 0;
          totalRow[d] = s;
          grand += s;
        }
        totalRow.total = grand;
        const r = ws3.addRow(totalRow);
        r.font = { bold: true };
      }

      // Лист 4 — По каналам
      const ws4 = wb.addWorksheet("По каналам");
      ws4.columns = [
        { header: "Канал", key: "source", width: 22 },
        { header: "Всего", key: "total", width: 10 },
        { header: "% от всех", key: "pct", width: 10 },
        { header: "Уникальных IP", key: "ips", width: 16 },
        { header: "Подозрительных", key: "susp", width: 14 },
        { header: "% подозрительных", key: "suspPct", width: 16 },
      ];
      ws4.getRow(1).font = { bold: true };
      ws4.getRow(1).alignment = { horizontal: "center" };
      const srcSorted = [...bySource.entries()].sort(
        (a, b) => b[1].total - a[1].total,
      );
      for (const [src, r] of srcSorted) {
        ws4.addRow({
          source: src,
          total: r.total,
          pct: total > 0 ? +((r.total / total) * 100).toFixed(2) : 0,
          ips: r.ips.size,
          susp: r.susp,
          suspPct: r.total > 0 ? +((r.susp / r.total) * 100).toFixed(2) : 0,
        });
      }

      // Лист 5 — Дубликаты исходных jpg
      const ws5 = wb.addWorksheet("Дубликаты jpg");
      ws5.columns = [
        { header: "Исходный jpg", key: "jpg", width: 26 },
        { header: "Сколько раз", key: "cnt", width: 12 },
      ];
      ws5.getRow(1).font = { bold: true };
      const dups = [...byJpg.entries()].filter(([, c]) => c > 1);
      dups.sort((a, b) => b[1] - a[1]);
      for (const [j, c] of dups) ws5.addRow({ jpg: j, cnt: c });
      if (dups.length === 0) {
        ws5.addRow({ jpg: "— дубликатов нет —", cnt: "" });
      }

      // ── Ответ ────────────────────────────────────────────────────────────
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="uploads-${from}_${to}.xlsx"`,
      );
      res.setHeader("X-Total-Rows", String(total));
      res.setHeader("X-Unique-Ips", String(byIp.size));
      res.setHeader("X-Unique-Sources", String(bySource.size));
      res.setHeader("Cache-Control", "no-store");
      await wb.xlsx.write(res);
      res.end();
    } catch (e) {
      next(e);
    }
  },
);
