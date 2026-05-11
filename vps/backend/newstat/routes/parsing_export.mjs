// routes/parsing_export.mjs — экспорт распарсенных скриншотов Yandex Go в Excel.
// GET /parsing/export.xlsx?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Источник: /var/www/rwbtaxi/data/calib/calib-*.json (создаются cron'ом
// /opt/rwbtaxi-screens/process-screens.mjs, по 1 файлу на скриншот).
//
// Защита:
//  - requireAuth(["admin","antifraud"]) — операция тяжёлая (read+parse N файлов
//    + сборка xlsx в памяти), поэтому только для аутентифицированных ролей.
//  - MAX_DAYS=31 — предохранитель от запросов «весь архив» (DoS / OOM).
//  - MAX_FILES=20000 — жёсткий cap по числу файлов в окне.
import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { requireAuth } from "../lib/auth.mjs";

export const parsingExportRouter = express.Router();

const CALIB_DIR = process.env.CALIB_DIR || "/var/www/rwbtaxi/data/calib";
const MAX_DAYS = Number(process.env.PARSING_EXPORT_MAX_DAYS || 31);
const MAX_FILES = Number(process.env.PARSING_EXPORT_MAX_FILES || 20000);

// Минск = UTC+3 круглый год (фиксированный сдвиг, без переходов на летнее время).
const MINSK_OFFSET_MS = 3 * 60 * 60 * 1000;

function isDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function daysBetweenInclusive(from, to) {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / 86400000) + 1;
}

// Возвращает локальную (Минск) дату записи в формате YYYY-MM-DD.
// Приоритет: o.date (это уже локальная дата от парсера); fallback на orderAt
// со сдвигом UTC→Минск, чтобы избежать off-by-one на полуночи.
function recordLocalDate(o) {
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

function haversineKm(la1, lo1, la2, lo2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(la2 - la1);
  const dLng = toRad(lo2 - lo1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

parsingExportRouter.get(
  "/export.xlsx",
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
      for (const n of names) {
        if (!n.startsWith("calib-") || !n.endsWith(".json")) continue;
        if (items.length >= MAX_FILES) break;
        try {
          const raw = await fs.readFile(path.join(CALIB_DIR, n), "utf8");
          const o = JSON.parse(raw);
          const d = recordLocalDate(o);
          if (!d || d < from || d > to) continue;
          items.push(o);
        } catch {
          /* битый файл — пропускаем молча */
        }
      }

      items.sort((a, b) =>
        String(a.orderAt || "").localeCompare(String(b.orderAt || "")),
      );

      const wb = new ExcelJS.Workbook();
      wb.creator = "rwbtaxi-newstat";
      wb.created = new Date();
      const ws = wb.addWorksheet("Парсинг скриншотов");

      // Дату умышленно бьём на три отдельные числовые колонки (Год/Месяц/День):
      // так удобнее в сводных таблицах Excel — фильтр по месяцу/году не требует
      // парсинга строки и не зависит от локали клиента.
      ws.columns = [
        { header: "Год", key: "year", width: 6 },
        { header: "Месяц", key: "month", width: 7 },
        { header: "День", key: "day", width: 6 },
        { header: "Время", key: "time", width: 8 },
        { header: "Откуда", key: "from", width: 36 },
        { header: "Куда", key: "to", width: 36 },
        { header: "Время в пути, мин", key: "tripMin", width: 16 },
        { header: "Расстояние, км", key: "distKm", width: 14 },
        { header: "Эконом, BYN", key: "factE", width: 12 },
        { header: "Эконом ETA, мин", key: "etaE", width: 16 },
        { header: "Комфорт, BYN", key: "factC", width: 13 },
        { header: "Комфорт ETA, мин", key: "etaC", width: 17 },
        { header: "Загрузка", key: "demand", width: 12 },
        { header: "Подозрительно", key: "susp", width: 13 },
        { header: "Оператор", key: "operator", width: 18 },
        { header: "ID", key: "id", width: 38 },
      ];
      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true };
      headerRow.alignment = { horizontal: "center", vertical: "middle" };
      headerRow.height = 22;
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: 16 },
      };

      for (const o of items) {
        let distKm = o.matchedRecommendation?.expectedDistanceKm ?? null;
        if (
          distKm == null &&
          typeof o.fromLat === "number" &&
          typeof o.toLat === "number" &&
          typeof o.fromLng === "number" &&
          typeof o.toLng === "number"
        ) {
          // Прямая дистанция × 1.35 — типичный коэффициент детура для городских маршрутов.
          distKm = +(
            haversineKm(o.fromLat, o.fromLng, o.toLat, o.toLng) * 1.35
          ).toFixed(2);
        }
        // recordLocalDate возвращает 'YYYY-MM-DD' в МСК+3 (Минск); парсим
        // строкой, чтобы не зависеть от часового пояса процесса.
        const dStr = recordLocalDate(o) || "";
        const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dStr);
        const year = dm ? Number(dm[1]) : null;
        const month = dm ? Number(dm[2]) : null;
        const day = dm ? Number(dm[3]) : null;
        ws.addRow({
          year,
          month,
          day,
          time:
            o.screenLocalTime ||
            (o.orderAt
              ? new Date(Date.parse(o.orderAt) + MINSK_OFFSET_MS)
                  .toISOString()
                  .slice(11, 16)
              : ""),
          from: o.fromAddress || o.fromAddressGeo || "",
          to: o.toAddress || o.toAddressGeo || "",
          tripMin: o.tripMin ?? null,
          distKm,
          factE: o.factE ?? null,
          // ETA подачи в скрине Yandex Go — одно значение для активного тарифа.
          // В калибре нет раздельных etaE/etaC, поэтому одинаковое etaMin
          // показываем в обеих колонках для удобства аналитики.
          etaE: o.etaMin ?? null,
          factC: o.factC ?? null,
          etaC: o.etaMin ?? null,
          demand: o.demand || "",
          susp: o.anomaly?.suspicious ? "да" : "нет",
          operator: o.operator || "",
          id: o.id || "",
        });
      }

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="parsing-${from}_${to}.xlsx"`,
      );
      res.setHeader("X-Total-Rows", String(items.length));
      res.setHeader("Cache-Control", "no-store");
      await wb.xlsx.write(res);
      res.end();
    } catch (e) {
      next(e);
    }
  },
);
