// server.mjs — основной HTTP-сервер newstat (порт 3012).
// Маршрутизация: nginx срезает префикс /api/newstat/, к нам приходит "/health" и т.п.
import express from "express";
import pinoHttp from "pino-http";
import "dotenv/config";

import { logger } from "./lib/logger.mjs";
import { query } from "./lib/db.mjs";
import { authRouter } from "./routes/auth.mjs";
import { settingsRouter } from "./routes/settings.mjs";
import { shiftsRouter } from "./routes/shifts.mjs";
import { uploadRouter } from "./routes/upload.mjs";
import { ticketsRouter } from "./routes/tickets.mjs";
import { graphRouter } from "./routes/graph.mjs";
import { mlRouter } from "./routes/ml.mjs";
import { secureRouter } from "./routes/secure.mjs";
import { hiddenLinksRouter } from "./routes/hidden_links.mjs";
import { workbenchRouter } from "./routes/workbench.mjs";
import { adminUsersRouter } from "./routes/admin_users.mjs";
import { parsingExportRouter } from "./routes/parsing_export.mjs";
import { uploadsExportRouter } from "./routes/uploads_export.mjs";
import { uploadsStatsRouter } from "./routes/uploads_stats.mjs";
import { screenImageRouter } from "./routes/screen_image.mjs";
import { tariffComparisonRouter } from "./routes/tariff_comparison.mjs";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback");
app.use(pinoHttp({ logger }));
app.use(express.json({ limit: "32mb" }));

// ── базовое ─────────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  try {
    const r = await query("SELECT 1 AS ok, now() AS ts");
    res.json({ ok: true, db: r.rows[0].ok === 1, ts: r.rows[0].ts });
  } catch (e) {
    req.log.error(e, "health db error");
    res.status(503).json({ ok: false, error: "db_down" });
  }
});

app.get("/version", (_req, res) => {
  res.json({ name: "rwbtaxi-newstat", version: "0.2.0", node: process.version });
});

// ── модули ──────────────────────────────────────────────────────────
app.use("/auth", authRouter);
app.use("/settings", settingsRouter);
app.use("/shifts", shiftsRouter);
app.use("/tickets", ticketsRouter); // T015: Fraud Decision Workflow
app.use("/graph", graphRouter); // T020: Graph Fraud Analysis
app.use("/ml", mlRouter); // T014: ML CatBoost
app.use("/secure", secureRouter);           // T018: PII-protected endpoints (admin only)
app.use("/hidden-links", hiddenLinksRouter); // T019: Hidden Links — device/IP fraud clusters
app.use("/workbench", workbenchRouter);      // T016/Workbench: антифрод рабочее место
app.use("/admin", adminUsersRouter);         // /admin/users — управление пользователями (только admin)
app.use("/parsing", parsingExportRouter);    // T007: /parsing/export.xlsx — экспорт парсинга скриншотов
app.use("/parsing", uploadsExportRouter);    // T008: /parsing/uploads.xlsx — отчёт по импорту скриншотов
app.use("/parsing", uploadsStatsRouter);     // T009: /parsing/uploads-stats — JSON-агрегатор для UI «Статистика по скринам»
app.use("/parsing", screenImageRouter);      // T009: /parsing/screen/:id — отдача исходного jpg/png
app.use("/parsing", tariffComparisonRouter); // T013: /parsing/tariff-comparison — Yandex vs WB по BYN/км и BYN/мин
app.use("/", uploadRouter); // /upload, /recompute, /batches, /orders/sample, /daily/*

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not_found", path: req.url });
});

// глобальный обработчик ошибок
app.use((err, req, res, _next) => {
  req.log?.error(err, "unhandled");
  res.status(500).json({ ok: false, error: "server_error" });
});

// Async-роуты Express 4 не ловят отвергнутые промисы. Логируем подробно,
// но НЕ маскируем баги — для unhandledRejection не падаем (часто это безобидный
// race), а для uncaughtException выходим: состояние процесса непредсказуемо,
// systemd с Restart=on-failure поднимет новый.
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error
    ? { msg: reason.message, stack: reason.stack, code: reason.code }
    : { msg: String(reason) };
  logger.error({ err }, "unhandledRejection (kept alive — fix the missing await/catch)");
});
process.on("uncaughtException", (err) => {
  logger.fatal(
    { err: { msg: err.message, stack: err.stack, code: err.code } },
    "uncaughtException — exiting for clean systemd restart",
  );
  // Дать pino дописать в файл, потом выйти.
  setTimeout(() => process.exit(1), 200).unref();
});

const PORT = Number(process.env.PORT || 3012);
app.listen(PORT, "127.0.0.1", () => {
  logger.info({ port: PORT }, "rwbtaxi-newstat listening");
});
