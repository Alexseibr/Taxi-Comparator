// routes/ml.mjs — T014/T015 ML API (CatBoost через Python-сервис).
//   GET  /ml/health                  — проверка Python-сервиса
//   GET  /ml/status                  — watchdog (T015.2)
//   GET  /ml/version                 — текущая модель
//   GET  /ml/runs                    — история обучений
//   POST /ml/train                   — weak-supervised retrain (T014)
//   POST /ml/retrain                 — supervised retrain (T015.3)
//   POST /ml/runs/:id/activate       — активировать кандидат (T015.5)
//   POST /ml/predict?date=...        — предсказать и записать в ml_predictions
//   GET  /ml/predictions             — выборка предсказаний с фильтрами

import { Router } from "express";
import { z } from "zod";
import { query, withTx } from "../lib/db.mjs";
import { requireAuth } from "../lib/auth.mjs";
import { getMlWorkflowSettings, applyModeConfig } from "../lib/settings.mjs";
import {
  mlHealth, mlVersion, mlTrain, mlRuns, mlReload,
  mlSupervisedRetrain, mlPredictPairsBatch, persistBatchPredictions,
  predictAndPersistForDates,
} from "../lib/ml.mjs";

// Путь нужен только чтобы вернуть его клиенту в ответе activate (информативно).
// Реальную копию делает Python (он владеет ML-папкой).
const ACTIVE_PAIR_MODEL_FILE = "/opt/rwbtaxi-newstat-ml/models/pair_model_active.cbm";

// In-memory single-flight для тяжёлых/опасных endpoints. Достаточно, потому что
// Node-демон один (systemd `rwbtaxi-newstat`). Если когда-то будет горизонтально
// масштабироваться — заменить на pg_advisory_lock.
const _busy = { activate: false, rescore: false };
function _tryAcquire(key) {
  if (_busy[key]) return false;
  _busy[key] = true;
  return true;
}
function _release(key) { _busy[key] = false; }

export const mlRouter = Router();

mlRouter.get("/health", requireAuth(), async (req, res) => {
  try {
    const data = await mlHealth();
    res.json({ ok: true, ml: data });
  } catch (err) {
    req.log.warn({ err: String(err) }, "ml /health failed");
    res.status(503).json({ ok: false, error: "ml_unreachable" });
  }
});

// Watchdog для UI: один эндпоинт со всеми сигналами здоровья ML-пайплайна.
// Возвращает 200 даже если Python мёртв — UI должен отрисовать баннер сам.
mlRouter.get("/status", requireAuth(), async (req, res) => {
  let ml_service_ok = false;
  let ml_health_detail = null;
  try {
    ml_health_detail = await mlHealth();
    ml_service_ok = true;
  } catch (err) {
    ml_health_detail = { error: String(err?.message || err) };
  }

  // Последнее предсказание и активная модель — из БД.
  const [lastPred, lastRun, activeModel] = await Promise.all([
    query(`SELECT MAX(predicted_at) AS last_predicted_at FROM ml_predictions`),
    query(
      `SELECT run_id, model_type, model_version, status, started_at, finished_at,
              roc_auc, precision_score, recall, f1_score, rows_count, positive_count
         FROM ml_training_runs
        ORDER BY COALESCE(started_at, created_at) DESC
        LIMIT 1`,
    ),
    query(
      `SELECT run_id, model_type, model_version, roc_auc, precision_score, recall, f1_score
         FROM ml_training_runs
        WHERE is_active = true
        ORDER BY model_type
        LIMIT 5`,
    ),
  ]);

  const lastPredAt = lastPred.rows[0]?.last_predicted_at;
  const minutesSince = lastPredAt
    ? Math.floor((Date.now() - new Date(lastPredAt).getTime()) / 60_000)
    : null;

  res.json({
    ok: true,
    ml_service_ok,
    ml_health_detail,
    last_prediction_at: lastPredAt,
    minutes_since_last_prediction: minutesSince,
    last_training_run: lastRun.rows[0] || null,
    active_models: activeModel.rows,
    active_model_version: activeModel.rows[0]?.model_version || null,
  });
});

mlRouter.get("/version", requireAuth(), async (req, res) => {
  try {
    const data = await mlVersion();
    res.json({ ok: true, ...data });
  } catch (err) {
    req.log.warn({ err: String(err) }, "ml /version failed");
    res.status(503).json({ ok: false, error: "ml_unreachable" });
  }
});

// /ml/runs читаем из своей БД (а не из Python /runs), чтобы:
//   а) UI работал даже когда Python недоступен,
//   б) гарантированно отдавать поля is_active/started_at/finished_at/created_by,
//      которых нет в Python-варианте.
mlRouter.get("/runs", requireAuth(), async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  try {
    const r = await query(
      `SELECT
         run_id,
         model_type,
         entity_type,
         model_version,
         status,
         is_active,
         rows_count,
         positive_count,
         negative_count,
         n_train,
         n_test,
         precision_score::float AS precision_score,
         recall::float          AS recall,
         f1_score::float        AS f1_score,
         roc_auc::float         AS roc_auc,
         pr_auc::float          AS pr_auc,
         accuracy::float        AS accuracy,
         model_path,
         error,
         created_by,
         notes,
         started_at,
         finished_at,
         created_at,
         top_features
       FROM ml_training_runs
       ORDER BY COALESCE(started_at, created_at) DESC, run_id DESC
       LIMIT $1`,
      [limit],
    );
    res.json({ ok: true, items: r.rows });
  } catch (err) {
    req.log.error({ err: String(err) }, "ml /runs failed");
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

const TrainBody = z.object({
  notes: z.string().max(500).optional(),
  model_version: z.string().max(64).optional(),
}).strict();

// Обучение модели — операция тяжёлая (минуты CPU) и пишет в state, поэтому
// доступна только админу.
mlRouter.post("/train", requireAuth(["admin"]), async (req, res) => {
  const parsed = TrainBody.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_body", details: parsed.error.flatten() });
  }
  try {
    const data = await mlTrain({
      notes: parsed.data.notes,
      modelVersion: parsed.data.model_version,
    });
    res.json({ ok: true, ...data });
  } catch (err) {
    req.log.error({ err: String(err) }, "ml /train failed");
    res.status(500).json({ ok: false, error: "train_failed", detail: String(err) });
  }
});

// ─────────────────────────────────────────────── /retrain (supervised) ────
const RetrainBody = z.object({
  notes: z.string().max(500).optional(),
}).strict();

mlRouter.post("/retrain", requireAuth(["admin"]), async (req, res) => {
  const parsed = RetrainBody.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_body", details: parsed.error.flatten() });
  }
  // T016.5: pre-check labels. ?force=true обходит ограничение (для админа).
  const force = req.query.force === "1" || req.query.force === "true";
  if (!force) {
    const lbl = await query(
      `SELECT
         COUNT(*)::int                          AS total,
         COUNT(*) FILTER (WHERE label = 1)::int AS positive,
         COUNT(*) FILTER (WHERE label = 0)::int AS negative
       FROM fraud_training_labels`,
    );
    const { total, positive, negative } = lbl.rows[0];
    const reasons = [];
    if (total < 100)   reasons.push(`labels_total<100 (have ${total})`);
    if (positive < 20) reasons.push(`positive<20 (have ${positive})`);
    if (negative < 50) reasons.push(`negative<50 (have ${negative})`);
    if (reasons.length) {
      return res.status(400).json({
        ok: false, error: "not_enough_labels",
        detail: reasons.join("; "),
        counts: { total, positive, negative },
        min_required: { total: 100, positive: 20, negative: 50 },
        hint: "Используйте ?force=true для админ-обхода (на свой страх и риск).",
      });
    }
  }
  try {
    const data = await mlSupervisedRetrain({
      notes: parsed.data.notes,
      createdBy: req.user.login,
    });
    res.json({ ok: true, ...data });
  } catch (err) {
    // 400 от Python (мало лейблов / degenerate dataset) — пробрасываем как 400.
    const code = err.status === 400 ? 400 : 500;
    req.log[code === 400 ? "warn" : "error"](
      { err: { msg: err?.message, status: err?.status } },
      "ml /retrain failed",
    );
    res.status(code).json({
      ok: false,
      error: code === 400 ? "bad_request" : "retrain_failed",
      detail: err?.message || String(err),
    });
  }
});

// ─────────────────────────────────────────── /runs/:id/activate (admin) ────
//
// Активация candidate-модели:
//   1. Валидируем run (status='success', supervised pair, есть model_path).
//   2. Просим Python /reload c model_path: он атомарно копирует файл в свою
//      ML-папку (Node не имеет туда write-доступа из-за ProtectSystem=strict)
//      и перечитывает модель в память.
//   3. После успешного reload — атомарно UPDATE is_active в БД.
//   Предупреждения (низкий ROC-AUC и т.п.) НЕ блокируют активацию.
mlRouter.post("/runs/:id/activate", requireAuth(["admin"]), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: "bad_id" });
  }
  if (!_tryAcquire("activate")) {
    return res.status(409).json({ ok: false, error: "activate_in_progress" });
  }
  try {
    return await _doActivate(id, req, res);
  } finally {
    _release("activate");
  }
});

async function _doActivate(id, req, res) {
  // 1. Считать run + валидировать.
  const r = await query(
    `SELECT run_id, model_type, entity_type, model_version, status, model_path,
            roc_auc, precision_score, recall, f1_score,
            rows_count, positive_count, negative_count
       FROM ml_training_runs WHERE run_id = $1`,
    [id],
  );
  const run = r.rows[0];
  if (!run) return res.status(404).json({ ok: false, error: "run_not_found" });
  if (run.status !== "success") {
    return res.status(400).json({
      ok: false, error: "run_not_successful", detail: `status=${run.status}`,
    });
  }
  if (run.model_type !== "supervised" || run.entity_type !== "pair") {
    return res.status(400).json({
      ok: false, error: "unsupported_run",
      detail: `Только supervised pair-модели активируемы; got model_type=${run.model_type} entity=${run.entity_type}`,
    });
  }
  if (!run.model_path) {
    return res.status(400).json({ ok: false, error: "no_model_path" });
  }

  // 2. Подсчитать предупреждения (но НЕ блокировать).
  const warnings = [];
  const rocAuc = run.roc_auc != null ? Number(run.roc_auc) : null;
  const recall = run.recall  != null ? Number(run.recall)  : null;
  const pos    = run.positive_count != null ? Number(run.positive_count) : null;
  if (rocAuc != null && rocAuc < 0.65) warnings.push(`low_roc_auc:${rocAuc.toFixed(3)}`);
  if (pos    != null && pos < 20)      warnings.push(`few_positives:${pos}`);
  if (recall != null && recall < 0.5)  warnings.push(`low_recall:${recall.toFixed(3)}`);

  // 3. Попросить Python скопировать candidate в active и перечитать модель.
  let reloaded;
  try {
    reloaded = await mlReload({ modelPath: run.model_path });
  } catch (err) {
    req.log.error({ err: { msg: err?.message, status: err?.status }, run_id: id, model_path: run.model_path },
                  "ml /reload failed (activation aborted, DB unchanged)");
    const code = err?.status === 400 ? 400 : 502;
    return res.status(code).json({
      ok: false,
      error: code === 400 ? "bad_model_path" : "ml_reload_failed",
      detail: err?.message || String(err),
    });
  }

  // 4. Файл и память Python обновлены — выставляем флаги в БД.
  try {
    await withTx(async (c) => {
      await c.query(
        `UPDATE ml_training_runs SET is_active = false
           WHERE model_type = $1 AND entity_type = $2 AND is_active = true AND run_id <> $3`,
        [run.model_type, run.entity_type, id],
      );
      await c.query(
        `UPDATE ml_training_runs SET is_active = true WHERE run_id = $1`,
        [id],
      );
    });
  } catch (err) {
    // Редкий случай: модель уже подменена, но БД не отметила активной.
    // Сама модель работает; следующий activate перепишет БД.
    req.log.error({ err: { msg: err?.message }, run_id: id }, "activate db tx failed (reload OK)");
    warnings.push(`db_flag_update_failed:${err?.message || err}`);
  }

  // Повторный reload без model_path: Python перечитает model_version из БД
  // (теперь is_active=true проставлен), и /version начнёт показывать корректное.
  try {
    reloaded = await mlReload();
  } catch (err) {
    // Не критично: файл и БД уже консистентны.
    req.log.warn({ err: { msg: err?.message } }, "post-db reload failed (non-critical)");
  }

  req.log.info(
    { run_id: id, model_version: run.model_version, by: req.user.login, warnings },
    "ml run activated",
  );
  res.json({
    ok: true,
    run_id: id,
    model_type: run.model_type,
    model_version: run.model_version,
    model_path: run.model_path,
    active_pair_model_path: ACTIVE_PAIR_MODEL_FILE,
    reloaded,
    warnings,
  });
}

// ────────────────────────────────────────────── /rescore (admin, T015.6) ────
//
// Прогнать активной supervised-моделью все пары из pair_risk_daily в окне
// [from..to] и записать в ml_predictions. Чанками по batch_size, чтобы не
// перегружать Python (catboost SHAP — O(rows*features)).
//
// create_tickets:true — после rescore автоматически создать тикеты для
// ML_DISCOVERY и STRONG_DISAGREEMENT у пар, у которых тикета ещё нет (T015.10).
const RescoreBody = z.object({
  from:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  batch_size:     z.number().int().min(50).max(1000).optional(),
  max_pairs:      z.number().int().min(1).max(200_000).optional(),
  create_tickets: z.boolean().optional(),
}).strict();

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

mlRouter.post("/rescore", requireAuth(["admin"]), async (req, res) => {
  const parsed = RescoreBody.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_body", details: parsed.error.flatten() });
  }
  if (!_tryAcquire("rescore")) {
    return res.status(409).json({ ok: false, error: "rescore_in_progress" });
  }
  try {
    return await _doRescore(parsed.data, req, res);
  } finally {
    _release("rescore");
  }
});

async function _doRescore(data, req, res) {
  const { from, to } = data;
  const batchSize = data.batch_size ?? 500;
  const maxPairs  = data.max_pairs  ?? 50_000;

  // Гард: окно ≤ 60 дней (защита от случайной перегрузки кластера).
  const dFrom = new Date(`${from}T00:00:00Z`);
  const dTo   = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(dFrom.getTime()) || Number.isNaN(dTo.getTime())) {
    return res.status(400).json({ ok: false, error: "bad_date" });
  }
  if (dTo < dFrom) {
    return res.status(400).json({ ok: false, error: "to_before_from" });
  }
  const spanDays = Math.round((dTo - dFrom) / ONE_DAY_MS) + 1;
  if (spanDays > 60) {
    return res.status(400).json({
      ok: false, error: "span_too_large",
      detail: `span=${spanDays}d > 60d (увеличьте окно итеративно или поправьте лимит)`,
    });
  }

  const t0 = Date.now();

  // 1. Источник пар — pair_risk_daily (там же лежат heuristic-сигналы).
  const r = await query(
    `SELECT driver_id, client_id, date::text AS date
       FROM pair_risk_daily
      WHERE date BETWEEN $1::date AND $2::date
      ORDER BY date, driver_id, client_id
      LIMIT $3`,
    [from, to, maxPairs + 1],
  );
  const pairs = r.rows;
  const truncated = pairs.length > maxPairs;
  if (truncated) pairs.length = maxPairs;

  if (pairs.length === 0) {
    return res.json({
      ok: true, processed: 0, batches: 0, errors: [],
      duration_ms: Date.now() - t0,
      span_days: spanDays, truncated: false,
      model_version: null,
    });
  }

  // 2. Чанками гонять Python /predict/pairs/batch и UPSERT в ml_predictions.
  const errors = [];
  let processed = 0;
  let batches = 0;
  let modelVersion = null;

  for (let off = 0; off < pairs.length; off += batchSize) {
    const chunk = pairs.slice(off, off + batchSize);
    batches += 1;
    try {
      const resp = await mlPredictPairsBatch(chunk);
      modelVersion = resp.model_version || modelVersion;
      const items = resp.items || [];
      if (items.length) {
        await persistBatchPredictions(items, resp.model_version || "unknown");
        processed += items.length;
      }
      req.log.info(
        { batch: batches, requested: chunk.length, scored: items.length,
          model_version: resp.model_version },
        "ml rescore batch ok",
      );
    } catch (err) {
      const msg = err?.message || String(err);
      errors.push({ batch: batches, offset: off, size: chunk.length, error: msg });
      req.log.warn({ batch: batches, off, size: chunk.length, err: msg }, "ml rescore batch failed");
      // Не прерываем: остальные батчи могут пройти. Если упало >5 подряд — bail.
      if (errors.length >= 5 && errors.slice(-5).every((e) => e.batch >= batches - 4)) {
        req.log.error("5 consecutive batch failures → aborting rescore");
        break;
      }
    }
  }

  // 3. Опциональное автосоздание тикетов из disagreements (T015.10).
  // Создаём только ML_DISCOVERY и STRONG_DISAGREEMENT — RULE_OVERKILL это
  // случай когда модель сказала «всё ок», тикет не нужен.
  let ticketsCreated = null;
  let ticketsByType  = null;
  if (data.create_tickets && processed > 0) {
    try {
      const t = await _createTicketsFromDisagreements(from, to, req);
      ticketsCreated = t.created;
      ticketsByType  = t.by_type;
    } catch (err) {
      req.log.error({ err: { msg: err?.message, stack: err?.stack } },
                    "ml rescore: ticket auto-creation failed");
      errors.push({ batch: null, offset: null, size: null,
                    error: `ticket_autocreate: ${err?.message || String(err)}` });
    }
  }

  const duration_ms = Date.now() - t0;
  req.log.info(
    { from, to, span_days: spanDays, total_pairs: pairs.length,
      processed, batches, errors: errors.length, duration_ms,
      model_version: modelVersion, truncated,
      tickets_created: ticketsCreated, tickets_by_type: ticketsByType,
      by: req.user.login },
    "ml rescore finished",
  );
  res.json({
    ok: true,
    from, to, span_days: spanDays,
    total_pairs: pairs.length,
    processed, batches,
    errors,
    truncated,
    model_version: modelVersion,
    tickets_created: ticketsCreated,
    tickets_by_type: ticketsByType,
    duration_ms,
  });
}

// Один SQL-запрос вместо N: INSERT ... SELECT по парам без существующего
// тикета. risk_type вынужденно 'collusion' (CHECK), disagreement_type — в
// signals.source/disagreement_type. ON CONFLICT (entity_key, date) DO NOTHING
// для гонок с UI «Create ticket». RETURNING ticket_id+type → группируем для
// отчёта и пишем по одному event на тикет.
async function _createTicketsFromDisagreements(from, to, req) {
  // T016.2 / T017: правила берём из settings.ml_workflow + MODE_CONFIG.
  const rawCfg = await getMlWorkflowSettings();
  // T017: TRAINING mode — тикеты не создаём вообще.
  if (rawCfg.ml_mode === "TRAINING") {
    req.log.info({ ml_mode: "TRAINING" }, "ml create_tickets skipped — TRAINING mode");
    return { created: 0, byType: {} };
  }
  // Применяем MODE_CONFIG поверх ручных флагов (mode имеет приоритет).
  const cfg = applyModeConfig(rawCfg);

  // Тикеты: ML_DISCOVERY всегда (если включён ml-цикл),
  // STRONG_DISAGREEMENT и RULE_OVERKILL — только при явных флагах.
  // Лимиты: TOP-N за день и общий cap на rescore.
  const ins = await query(
    `WITH base AS (
       SELECT
         mp.entity_id_a                                            AS driver_id,
         mp.entity_id_b                                            AS client_id,
         mp.date                                                   AS date,
         (mp.score * 100)::numeric(5,2)                            AS ml_score,
         COALESCE(prd.total_risk, 0)::numeric(5,2)                 AS rule_score,
         ABS((mp.score * 100) - COALESCE(prd.total_risk, 0))::numeric(5,2) AS abs_delta,
         COALESCE(prd.collusion_loss_risk_byn, 0)::numeric(12,2)   AS money_at_risk,
         prd.signals                                               AS rule_signals,
         mp.top_features                                           AS top_features,
         mp.model_version                                          AS model_version,
         d.name                                                    AS driver_name
       FROM ml_predictions mp
       JOIN pair_risk_daily prd
         ON prd.driver_id = mp.entity_id_a
        AND prd.client_id = mp.entity_id_b
        AND prd.date      = mp.date
       LEFT JOIN drivers d  ON d.id  = mp.entity_id_a
       LEFT JOIN fraud_tickets ft
         ON ft.entity_type = 'pair'
        AND ft.driver_id   = mp.entity_id_a
        AND ft.client_id   = mp.entity_id_b
        AND ft.date        = mp.date
       WHERE mp.entity_type = 'pair'
         AND mp.date BETWEEN $1::date AND $2::date
         AND ft.ticket_id IS NULL
     ),
     typed AS (
       SELECT *,
         CASE
           WHEN ml_score >= $4 AND rule_score <= $5 AND money_at_risk >= $6
             THEN 'ML_DISCOVERY'
           WHEN $9::boolean AND rule_score >= 60 AND ml_score < 30 AND money_at_risk >= $6
             THEN 'RULE_OVERKILL'
           WHEN $8::boolean AND abs_delta >= $7 AND money_at_risk >= $6
             THEN 'STRONG_DISAGREEMENT'
           ELSE NULL
         END AS disagreement_type
       FROM base
     ),
     ranked AS (
       SELECT *,
         ROW_NUMBER() OVER (PARTITION BY date ORDER BY money_at_risk DESC, abs_delta DESC) AS rn_day,
         ROW_NUMBER() OVER (              ORDER BY money_at_risk DESC, abs_delta DESC) AS rn_total
       FROM typed
       WHERE disagreement_type IS NOT NULL
     )
     INSERT INTO fraud_tickets
       (entity_type, driver_id, client_id, date,
        risk_score, risk_type, money_at_risk_byn,
        priority, signals, suspicious_orders,
        previous_flags_count, created_by)
     SELECT
       'pair', driver_id, client_id, date,
       GREATEST(ml_score, rule_score),
       'collusion',
       money_at_risk,
       CASE
         WHEN GREATEST(ml_score, rule_score) >= 70 THEN 'high'
         WHEN GREATEST(ml_score, rule_score) >= 50 THEN 'medium'
         ELSE 'low'
       END,
       jsonb_build_object(
         'source',            'ml_rescore_autocreate',
         'disagreement_type', disagreement_type,
         'ml_score',          ml_score,
         'rule_score',        rule_score,
         'abs_delta',         abs_delta,
         'money_at_risk_byn', money_at_risk,
         'model_version',     model_version,
         'top_features',      top_features,
         'driver_name',       driver_name,
         'rule_signals',      rule_signals
       ),
       '[]'::jsonb,
       0,
       $3
     FROM ranked
     WHERE rn_day <= $10 AND rn_total <= $11
     ON CONFLICT (entity_key, date) DO NOTHING
     RETURNING ticket_id, (signals->>'disagreement_type') AS dtype`,
    [
      from, to, req.user.login,
      cfg.ml_discovery_min_score,
      cfg.ml_discovery_max_rule_score,
      cfg.ticket_min_money_at_risk_byn,
      cfg.disagreement_delta_threshold,
      cfg.enable_strong_disagreement_tickets,
      cfg.enable_rule_overkill_tickets,
      cfg.ticket_max_per_day,
      cfg.ticket_max_per_rescore,
    ],
  );

  const created = ins.rows.length;
  const byType = ins.rows.reduce((acc, r) => {
    acc[r.dtype] = (acc[r.dtype] || 0) + 1;
    return acc;
  }, {});

  // Один INSERT на все события — дешевле N round-trip'ов.
  if (created > 0) {
    const values = [];
    const params = [];
    ins.rows.forEach((r, i) => {
      const o = i * 3;
      values.push(`($${o + 1}, 'created', 'new', $${o + 2}, $${o + 3})`);
      params.push(r.ticket_id, `ml_rescore:${r.dtype}`, req.user.id);
    });
    await query(
      `INSERT INTO fraud_ticket_events (ticket_id, action, new_status, comment, user_id)
       VALUES ${values.join(", ")}`,
      params,
    );
  }

  req.log.info(
    { from, to, created, by_type: byType, by: req.user.login, cfg_snapshot: {
      ml_discovery_min_score: cfg.ml_discovery_min_score,
      ml_discovery_max_rule_score: cfg.ml_discovery_max_rule_score,
      strong_enabled: cfg.enable_strong_disagreement_tickets,
      overkill_enabled: cfg.enable_rule_overkill_tickets,
      max_per_day: cfg.ticket_max_per_day,
      max_per_rescore: cfg.ticket_max_per_rescore,
    } },
    "ml rescore: tickets autocreated",
  );
  return { created, by_type: byType, settings_used: cfg };
}

const PredictQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// Ручной /predict вызывает Python (несколько секунд) и пишет в ml_predictions,
// поэтому доступен админу и антифроду, но не «обычным» пользователям.
mlRouter.post("/predict", requireAuth(["admin", "antifraud"]), async (req, res) => {
  const parsed = PredictQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_query" });
  }
  try {
    const results = await predictAndPersistForDates([parsed.data.date], req.log);
    const r = results[0];
    if (!r.ok) return res.status(503).json({ ok: false, error: "predict_failed", detail: r.error });
    res.json({ ok: true, ...r });
  } catch (err) {
    req.log.error({ err: String(err) }, "ml /predict failed");
    res.status(500).json({ ok: false, error: "predict_failed", detail: String(err) });
  }
});

const PredictionsQuery = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_from:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  driver_id:   z.string().min(1).max(64).optional(),
  client_id:   z.string().min(1).max(64).optional(),
  min_score:   z.coerce.number().min(0).max(1).optional(),
  min_disag:   z.coerce.number().min(0).max(1).optional(),
  order:       z.enum(["score", "disagreement"]).optional(),
  limit:       z.coerce.number().int().min(1).max(500).optional(),
});

mlRouter.get("/predictions", requireAuth(), async (req, res) => {
  const parsed = PredictionsQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_query", details: parsed.error.flatten() });
  }
  const q = parsed.data;
  const where = ["entity_type = 'pair'"];
  const params = [];
  if (q.date)      { params.push(q.date);       where.push(`date = $${params.length}`); }
  if (q.date_from) { params.push(q.date_from);  where.push(`date >= $${params.length}`); }
  if (q.date_to)   { params.push(q.date_to);    where.push(`date <= $${params.length}`); }
  if (q.driver_id) { params.push(q.driver_id);  where.push(`entity_id_a = $${params.length}`); }
  if (q.client_id) { params.push(q.client_id);  where.push(`entity_id_b = $${params.length}`); }
  if (q.min_score !== undefined) { params.push(q.min_score); where.push(`score >= $${params.length}`); }
  if (q.min_disag !== undefined) { params.push(q.min_disag); where.push(`disagreement >= $${params.length}`); }

  const order = q.order === "score"
    ? "score DESC"
    : "disagreement DESC NULLS LAST";
  const limit = q.limit ?? 100;

  const sql = `
    SELECT entity_type, entity_id_a AS driver_id, entity_id_b AS client_id,
           date, model_version, score, heuristic_score, disagreement, predicted_at
    FROM ml_predictions
    WHERE ${where.join(" AND ")}
    ORDER BY ${order}
    LIMIT ${limit}
  `;
  try {
    const r = await query(sql, params);
    res.json({ ok: true, items: r.rows, count: r.rowCount });
  } catch (err) {
    req.log.error({ err: String(err) }, "ml /predictions failed");
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// ────────────────────────────────────────── /disagreements (T015.8) ────
//
// JOIN ml_predictions × pair_risk_daily × fraud_tickets для UI-странички
// «куда смотреть антифроду»: пары, где ML и правила существенно расходятся.
//
// disagreement_type:
//   ML_DISCOVERY        — ml_score≥80 и rule_score<50 (модель нашла то,
//                         что правила пропустили — кандидат на новый
//                         сценарий фрода).
//   RULE_OVERKILL       — rule_score≥60 и ml_score<30 (правила перегнули,
//                         модель не подтверждает — кандидат на правило
//                         с false-positive).
//   STRONG_DISAGREEMENT — |ml-rule|≥30, не из первых двух (просто шум,
//                         ради него тоже стоит посмотреть глазами).
//
// Возвращаемые score'ы — оба в шкале 0..100, как привычно для UI.
const DisagreementsQuery = z.object({
  date:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type:           z.enum(["ML_DISCOVERY", "RULE_OVERKILL", "STRONG_DISAGREEMENT"]).optional(),
  only_unlabeled: z.string().optional(), // "1"/"true"
  min_delta:      z.coerce.number().min(0).max(100).optional(),
  min_money:      z.coerce.number().min(0).optional(),
  driver_id:      z.string().trim().min(1).max(64).optional(),
  client_id:      z.string().trim().min(1).max(64).optional(),
  limit:          z.coerce.number().int().min(1).max(2000).optional(),
}).strict();

mlRouter.get("/disagreements", requireAuth(), async (req, res) => {
  const parsed = DisagreementsQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_query", details: parsed.error.flatten() });
  }
  const q = parsed.data;
  const onlyUnlabeled = q.only_unlabeled === "1" || q.only_unlabeled === "true";
  const limit = q.limit ?? 200;

  // Параметризуем по индексу, чтобы не бояться SQL-инъекций.
  // Базовая сборка пар: ml_predictions + pair_risk_daily на ту же дату.
  // ml_predictions.score=0..1 → переводим в 0..100 для consistency UI.
  const params = [q.date]; // $1
  let extraWhere = "";
  if (q.driver_id) { params.push(q.driver_id); extraWhere += ` AND mp.entity_id_a = $${params.length}`; }
  if (q.client_id) { params.push(q.client_id); extraWhere += ` AND mp.entity_id_b = $${params.length}`; }

  // Применяем фильтры на уровне SELECT'а (не WHERE), чтобы фильтровать по
  // вычисляемым колонкам (disagreement_type, abs_delta).
  let typeFilter = "";
  if (q.type) {
    params.push(q.type);
    typeFilter = ` AND disagreement_type = $${params.length}`;
  }
  let deltaFilter = "";
  if (q.min_delta !== undefined) {
    params.push(q.min_delta);
    deltaFilter = ` AND abs_delta >= $${params.length}`;
  }
  let moneyFilter = "";
  if (q.min_money !== undefined) {
    params.push(q.min_money);
    moneyFilter = ` AND money_at_risk_byn >= $${params.length}`;
  }
  let labelFilter = "";
  if (onlyUnlabeled) {
    labelFilter = ` AND (ticket_label_status IS NULL OR ticket_label_status = 'unlabeled')`;
  }

  const sql = `
    WITH base AS (
      SELECT
        mp.entity_id_a                   AS driver_id,
        mp.entity_id_b                   AS client_id,
        to_char(mp.date, 'YYYY-MM-DD')   AS date,
        mp.model_version                 AS model_version,
        ROUND((mp.score * 100)::numeric, 2)::float AS ml_score,
        prd.total_risk::float            AS rule_score,
        ROUND(((mp.score * 100) - prd.total_risk)::numeric, 2)::float AS delta,
        ABS((mp.score * 100) - prd.total_risk)::float AS abs_delta,
        prd.collusion_loss_risk_byn::float AS money_at_risk_byn,
        mp.top_features                  AS top_features,
        ft.ticket_id                     AS ticket_id,
        ft.status                        AS ticket_status,
        ft.label_status                  AS ticket_label_status,
        ft.label_value                   AS ticket_label_value,
        d.name                           AS driver_name
      FROM ml_predictions mp
      JOIN pair_risk_daily prd
        ON prd.driver_id = mp.entity_id_a
       AND prd.client_id = mp.entity_id_b
       AND prd.date      = mp.date
      LEFT JOIN fraud_tickets ft
        ON ft.entity_type = 'pair'
       AND ft.driver_id   = mp.entity_id_a
       AND ft.client_id   = mp.entity_id_b
       AND ft.date        = mp.date
      LEFT JOIN drivers d  ON d.id  = mp.entity_id_a
      WHERE mp.entity_type = 'pair'
        AND mp.date = $1::date
        ${extraWhere}
    ),
    typed AS (
      SELECT *,
        CASE
          WHEN ml_score >= 80 AND rule_score < 50 THEN 'ML_DISCOVERY'
          WHEN rule_score >= 60 AND ml_score < 30 THEN 'RULE_OVERKILL'
          WHEN abs_delta >= 30                    THEN 'STRONG_DISAGREEMENT'
          ELSE NULL
        END AS disagreement_type
      FROM base
    )
    SELECT *
    FROM typed
    WHERE disagreement_type IS NOT NULL
      ${typeFilter}
      ${deltaFilter}
      ${moneyFilter}
      ${labelFilter}
    ORDER BY abs_delta DESC, money_at_risk_byn DESC
    LIMIT ${limit}
  `;

  try {
    const r = await query(sql, params);
    res.json({ ok: true, date: q.date, count: r.rowCount, items: r.rows });
  } catch (err) {
    req.log.error({ err: String(err) }, "ml /disagreements failed");
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// POST /ml/disagreements/ticket — создать (или вернуть существующий) тикет
// для конкретной пары/даты по результату ml-disagreement. Используется
// кнопкой "Create ticket" на UI. risk_type вынужденно = 'collusion' (CHECK
// в БД), а disagreement_type сохраняется в signals.
const CreateDisagreementTicketBody = z.object({
  driver_id:         z.string().trim().min(1).max(64),
  client_id:         z.string().trim().min(1).max(64),
  date:              z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  disagreement_type: z.enum(["ML_DISCOVERY", "RULE_OVERKILL", "STRONG_DISAGREEMENT"]),
}).strict();

mlRouter.post("/disagreements/ticket", requireAuth(["admin", "antifraud"]), async (req, res) => {
  const parsed = CreateDisagreementTicketBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_body", details: parsed.error.flatten() });
  }
  const { driver_id, client_id, date, disagreement_type } = parsed.data;

  try {
    // 1. Уже есть тикет? — отдадим его (UI откроет).
    const ex = await query(
      `SELECT ticket_id, status, label_status FROM fraud_tickets
        WHERE entity_type = 'pair' AND driver_id = $1 AND client_id = $2 AND date = $3`,
      [driver_id, client_id, date],
    );
    if (ex.rows[0]) {
      return res.json({ ok: true, ticket_id: ex.rows[0].ticket_id, existed: true,
                        status: ex.rows[0].status, label_status: ex.rows[0].label_status });
    }

    // 2. Не было — собрать свежие скоры из ml_predictions + pair_risk_daily и создать.
    const rs = await query(
      `SELECT
         (mp.score * 100)::numeric(5,2)   AS ml_score,
         prd.total_risk                    AS rule_score,
         prd.collusion_loss_risk_byn       AS money_at_risk,
         prd.signals                       AS rule_signals,
         mp.top_features                   AS top_features,
         mp.model_version                  AS model_version,
         d.name                            AS driver_name
       FROM ml_predictions mp
       JOIN pair_risk_daily prd
         ON prd.driver_id = mp.entity_id_a
        AND prd.client_id = mp.entity_id_b
        AND prd.date      = mp.date
       LEFT JOIN drivers d  ON d.id  = mp.entity_id_a
       WHERE mp.entity_type = 'pair'
         AND mp.entity_id_a = $1
         AND mp.entity_id_b = $2
         AND mp.date = $3::date`,
      [driver_id, client_id, date],
    );
    if (!rs.rows[0]) {
      return res.status(404).json({ ok: false, error: "no_prediction_data" });
    }
    const r = rs.rows[0];
    // Используем большее из ml и rule в качестве risk_score, чтобы тикет
    // не сортировался в самый конец из-за низкого rule.
    const riskScore = Math.max(Number(r.ml_score) || 0, Number(r.rule_score) || 0);
    const priority = riskScore >= 70 ? "high" : riskScore >= 50 ? "medium" : "low";

    const ins = await query(
      `INSERT INTO fraud_tickets
         (entity_type, driver_id, client_id, date,
          risk_score, risk_type, money_at_risk_byn,
          priority, signals, suspicious_orders,
          previous_flags_count, created_by)
       VALUES
         ('pair', $1, $2, $3,
          $4, 'collusion', $5,
          $6, $7::jsonb, '[]'::jsonb,
          0, $8)
       ON CONFLICT (entity_key, date) DO NOTHING
       RETURNING ticket_id`,
      [
        driver_id, client_id, date,
        riskScore, r.money_at_risk ?? 0,
        priority,
        JSON.stringify({
          source: "ml_disagreement",
          disagreement_type,
          ml_score: r.ml_score,
          rule_score: r.rule_score,
          model_version: r.model_version,
          top_features: r.top_features,
          driver_name: r.driver_name,
          rule_signals: r.rule_signals,
        }),
        req.user.login,
      ],
    );
    if (ins.rows[0]) {
      const ticketId = ins.rows[0].ticket_id;
      await query(
        `INSERT INTO fraud_ticket_events (ticket_id, action, new_status, comment, user_id)
         VALUES ($1, 'created', 'new', $2, $3)`,
        [ticketId, `ml_disagreement:${disagreement_type}`, req.user.id],
      );
      req.log.info({ ticket_id: ticketId, driver_id, client_id, date, disagreement_type, by: req.user.login },
                   "ml disagreement ticket created");
      return res.json({ ok: true, ticket_id: ticketId, existed: false });
    }
    // race: между нашими SELECT и INSERT кто-то создал такой тикет.
    const re = await query(
      `SELECT ticket_id, status, label_status FROM fraud_tickets
        WHERE entity_type = 'pair' AND driver_id = $1 AND client_id = $2 AND date = $3`,
      [driver_id, client_id, date],
    );
    return res.json({ ok: true, ticket_id: re.rows[0].ticket_id, existed: true,
                      status: re.rows[0].status, label_status: re.rows[0].label_status });
  } catch (err) {
    req.log.error({ err: { msg: err?.message, stack: err?.stack } }, "ml /disagreements/ticket failed");
    res.status(500).json({ ok: false, error: "create_ticket_failed" });
  }
});

// ────────────────────────────────────────────────────── T016.3 labeling queue ────
//
// Источник правды для разметки: ml_predictions + pair_risk_daily, без обязательного
// тикета. Категории (case_type):
//   ML_DISCOVERY        — ml_score >= ml_discovery_min_score AND rule_score < ml_discovery_max_rule_score
//   RULE_OVERKILL       — rule_score >= 60 AND ml_score < 30
//   STRONG_DISAGREEMENT — abs(rule - ml) >= disagreement_delta_threshold
//   LOW_RISK_SAMPLE     — rule_score < 30 AND ml_score < 30
//
// only_unlabeled — LEFT JOIN fraud_training_labels (entity_key='driver_id:client_id')
// и фильтр label.id IS NULL.

const CASE_TYPES = ["ML_DISCOVERY", "RULE_OVERKILL", "STRONG_DISAGREEMENT", "LOW_RISK_SAMPLE"];

/** Строит SELECT ...candidates с case_type и labeled-флагом. */
function _labelingBaseSql(cfg) {
  return `
    WITH base AS (
      SELECT
        mp.entity_id_a                                         AS driver_id,
        mp.entity_id_b                                         AS client_id,
        to_char(mp.date, 'YYYY-MM-DD')                         AS date,
        mp.date                                                AS date_raw,
        mp.model_version                                       AS model_version,
        ROUND((mp.score * 100)::numeric, 2)::float             AS ml_score,
        prd.total_risk::float                                  AS rule_score,
        ROUND(((mp.score * 100) - prd.total_risk)::numeric, 2)::float AS delta,
        ABS((mp.score * 100) - prd.total_risk)::float          AS abs_delta,
        prd.collusion_loss_risk_byn::float                     AS money_at_risk_byn,
        mp.top_features                                        AS top_features,
        ft.ticket_id                                           AS ticket_id,
        ft.status                                              AS ticket_status,
        ft.label_status                                        AS ticket_label_status,
        ftl.id                                                 AS label_id,
        ftl.label                                              AS label_value,
        d.name                                                 AS driver_name
      FROM ml_predictions mp
      JOIN pair_risk_daily prd
        ON prd.driver_id = mp.entity_id_a
       AND prd.client_id = mp.entity_id_b
       AND prd.date      = mp.date
      LEFT JOIN fraud_tickets ft
        ON ft.entity_type = 'pair'
       AND ft.driver_id   = mp.entity_id_a
       AND ft.client_id   = mp.entity_id_b
       AND ft.date        = mp.date
      LEFT JOIN fraud_training_labels ftl
        ON ftl.entity_type = 'pair'
       AND ftl.entity_key  = mp.entity_id_a || ':' || mp.entity_id_b
       AND ftl.date        = mp.date
      LEFT JOIN drivers d  ON d.id  = mp.entity_id_a
      WHERE mp.entity_type = 'pair'
    ),
    typed AS (
      SELECT *,
        CASE
          WHEN ml_score >= ${Number(cfg.ml_discovery_min_score)}
           AND rule_score < ${Number(cfg.ml_discovery_max_rule_score)}
            THEN 'ML_DISCOVERY'
          WHEN rule_score >= 60 AND ml_score < 30
            THEN 'RULE_OVERKILL'
          WHEN abs_delta >= ${Number(cfg.disagreement_delta_threshold)}
            THEN 'STRONG_DISAGREEMENT'
          WHEN rule_score < 30 AND ml_score < 30
            THEN 'LOW_RISK_SAMPLE'
          ELSE NULL
        END AS case_type
      FROM base
    )
  `;
}

const LabelingQueueQuery = z.object({
  date_from:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_to:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  case_type:          z.enum(["ML_DISCOVERY", "RULE_OVERKILL", "STRONG_DISAGREEMENT", "LOW_RISK_SAMPLE"]).optional(),
  only_unlabeled:     z.string().optional(), // "1"/"true"/"0"/"false"
  min_money_at_risk:  z.coerce.number().min(0).optional(),
  min_delta:          z.coerce.number().min(0).max(100).optional(),
  limit:              z.coerce.number().int().min(1).max(2000).optional(),
}).strict();

mlRouter.get("/labeling-queue", requireAuth(["admin", "antifraud"]), async (req, res) => {
  const parsed = LabelingQueueQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_query", details: parsed.error.flatten() });
  }
  const q = parsed.data;
  const cfg = await getMlWorkflowSettings();
  // По умолчанию показываем только не размеченные.
  const onlyUnlabeled = q.only_unlabeled === undefined
    || q.only_unlabeled === "1" || q.only_unlabeled === "true";
  const limit = q.limit ?? 200;

  const params = [q.date_from, q.date_to];
  let extra = "";
  if (q.case_type) { params.push(q.case_type); extra += ` AND case_type = $${params.length}`; }
  if (q.min_money_at_risk !== undefined) {
    params.push(q.min_money_at_risk); extra += ` AND money_at_risk_byn >= $${params.length}`;
  }
  if (q.min_delta !== undefined) {
    params.push(q.min_delta); extra += ` AND abs_delta >= $${params.length}`;
  }
  if (onlyUnlabeled) extra += ` AND label_id IS NULL`;

  const sql = `${_labelingBaseSql(cfg)}
    SELECT * FROM typed
    WHERE case_type IS NOT NULL
      AND date_raw BETWEEN $1::date AND $2::date
      ${extra}
    ORDER BY money_at_risk_byn DESC NULLS LAST, abs_delta DESC
    LIMIT ${limit}
  `;

  try {
    const r = await query(sql, params);
    res.json({ ok: true, count: r.rowCount, items: r.rows, settings: cfg });
  } catch (err) {
    req.log.error({ err: String(err) }, "ml /labeling-queue failed");
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// POST /ml/labeling-batch — сформировать пачку из N кейсов каждого типа.
const LabelingBatchBody = z.object({
  date_from:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_to:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ml_discovery:        z.number().int().min(0).max(1000).optional(),
  rule_overkill:       z.number().int().min(0).max(1000).optional(),
  strong_disagreement: z.number().int().min(0).max(1000).optional(),
  low_risk_sample:     z.number().int().min(0).max(1000).optional(),
  only_unlabeled:      z.boolean().optional(),
}).strict();

mlRouter.post("/labeling-batch", requireAuth(["admin", "antifraud"]), async (req, res) => {
  const parsed = LabelingBatchBody.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_body", details: parsed.error.flatten() });
  }
  const b = parsed.data;
  const cfg = await getMlWorkflowSettings();
  const limits = {
    ML_DISCOVERY:        b.ml_discovery        ?? 30,
    RULE_OVERKILL:       b.rule_overkill       ?? 30,
    STRONG_DISAGREEMENT: b.strong_disagreement ?? 30,
    LOW_RISK_SAMPLE:     b.low_risk_sample     ?? 30,
  };
  const onlyUnlabeled = b.only_unlabeled !== false;

  const orderBy = {
    ML_DISCOVERY:        "money_at_risk_byn DESC NULLS LAST, ml_score DESC",
    RULE_OVERKILL:       "abs_delta DESC, money_at_risk_byn DESC NULLS LAST",
    STRONG_DISAGREEMENT: "abs_delta DESC, money_at_risk_byn DESC NULLS LAST",
    LOW_RISK_SAMPLE:     "random()",
  };

  const unionParts = [];
  for (const t of CASE_TYPES) {
    const lim = limits[t];
    if (!lim) continue;
    unionParts.push(`(SELECT * FROM typed
                      WHERE case_type = '${t}'
                        AND date_raw BETWEEN $1::date AND $2::date
                        ${onlyUnlabeled ? "AND label_id IS NULL" : ""}
                      ORDER BY ${orderBy[t]}
                      LIMIT ${lim})`);
  }
  if (!unionParts.length) {
    return res.json({ ok: true, count: 0, items: [], by_type: {} });
  }

  const sql = `${_labelingBaseSql(cfg)}
    ${unionParts.join("\n    UNION ALL\n    ")}
  `;

  try {
    const r = await query(sql, [b.date_from, b.date_to]);
    const byType = r.rows.reduce((acc, row) => {
      acc[row.case_type] = (acc[row.case_type] || 0) + 1;
      return acc;
    }, {});
    res.json({ ok: true, count: r.rowCount, items: r.rows, by_type: byType, limits, settings: cfg });
  } catch (err) {
    req.log.error({ err: String(err) }, "ml /labeling-batch failed");
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// POST /ml/label — ручная разметка пары/даты без обязательного тикета.
//
// Если для (driver_id, client_id, date) уже есть тикет — проставляем source_ticket_id
// и обновляем label_status/value на тикете (чтобы /tickets/:id показывал labeled).
// Если тикета нет — label сохраняется в fraud_training_labels с source_ticket_id=NULL.
const LabelBody = z.object({
  entity_type: z.enum(["pair"]),                     // T016 пока только pair
  entity_key:  z.string().regex(/^[^:]+:[^:]+$/),    // "driver_id:client_id"
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label:       z.union([z.literal(0), z.literal(1)]),
  comment:     z.string().trim().max(2000).optional(),
}).strict();

mlRouter.post("/label", requireAuth(["admin", "antifraud"]), async (req, res) => {
  const parsed = LabelBody.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_body", details: parsed.error.flatten() });
  }
  const { entity_type, entity_key, date, label, comment } = parsed.data;
  const [driverId, clientId] = entity_key.split(":");

  try {
    const result = await withTx(async (c) => {
      // 1. snapshot скоров на дату.
      const ml = await c.query(
        `SELECT (score * 100)::float AS ml_score
           FROM ml_predictions
          WHERE entity_type = 'pair'
            AND entity_id_a = $1 AND entity_id_b = $2
            AND date <= $3::date
          ORDER BY date DESC LIMIT 1`,
        [driverId, clientId, date],
      );
      const rs = await c.query(
        `SELECT total_risk::float AS rule_score, collusion_loss_risk_byn::float AS money
           FROM pair_risk_daily
          WHERE driver_id = $1 AND client_id = $2 AND date = $3::date`,
        [driverId, clientId, date],
      );
      const mlScore   = ml.rows[0]?.ml_score   ?? null;
      const ruleScore = rs.rows[0]?.rule_score ?? null;
      const delta     = mlScore != null && ruleScore != null
        ? Math.abs(Number(mlScore) - Number(ruleScore)) : null;

      // 2. найти тикет если есть.
      const tx = await c.query(
        `SELECT ticket_id FROM fraud_tickets
          WHERE entity_type = 'pair' AND driver_id = $1 AND client_id = $2 AND date = $3::date`,
        [driverId, clientId, date],
      );
      const sourceTicketId = tx.rows[0]?.ticket_id ?? null;

      // 3. UPSERT в fraud_training_labels.
      const ins = await c.query(
        `INSERT INTO fraud_training_labels
           (entity_type, entity_key, date, label, source_ticket_id,
            ml_score, rule_score, graph_score, final_score, delta,
            reviewed_by, comment)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7,NULL,$8,$9,$10,$11)
         ON CONFLICT (entity_type, entity_key, date, COALESCE(source_ticket_id, 0))
         DO UPDATE SET
           label       = EXCLUDED.label,
           ml_score    = EXCLUDED.ml_score,
           rule_score  = EXCLUDED.rule_score,
           final_score = EXCLUDED.final_score,
           delta       = EXCLUDED.delta,
           reviewed_by = EXCLUDED.reviewed_by,
           reviewed_at = now(),
           comment     = EXCLUDED.comment
         RETURNING id, source_ticket_id`,
        [
          entity_type, entity_key, date, label, sourceTicketId,
          mlScore, ruleScore, ruleScore, delta,
          req.user.login, comment ?? null,
        ],
      );

      // 4. Если есть тикет — синхронизировать label_status на нём.
      if (sourceTicketId) {
        await c.query(
          `UPDATE fraud_tickets
              SET label_status = 'labeled',
                  label_value  = $2,
                  labeled_at   = now(),
                  labeled_by   = $3
            WHERE ticket_id = $1`,
          [sourceTicketId, label, req.user.login],
        );
        await c.query(
          `INSERT INTO fraud_ticket_events
             (ticket_id, action, new_status, comment, user_id)
           VALUES ($1, 'labeled', NULL, $2, $3)`,
          [sourceTicketId, `ml_label:${label}${comment ? `:${comment.slice(0, 200)}` : ""}`, req.user.id],
        );
      }
      return { label_id: ins.rows[0].id, source_ticket_id: sourceTicketId };
    });

    req.log.info(
      { entity_key, date, label, has_ticket: !!result.source_ticket_id, by: req.user.login },
      "ml label saved",
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    req.log.error({ err: String(err) }, "ml /label failed");
    res.status(500).json({ ok: false, error: "label_failed", detail: String(err?.message || err) });
  }
});

// GET /ml/labels-summary — метрики для UI /newstat/ml.
mlRouter.get("/labels-summary", requireAuth(), async (_req, res) => {
  const cfg = await getMlWorkflowSettings();
  const today = new Date().toISOString().slice(0, 10);
  try {
    // Все labels: общее, positive (label=1), negative (label=0).
    const lbl = await query(
      `SELECT
         COUNT(*)::int                              AS labels_total,
         COUNT(*) FILTER (WHERE label = 1)::int     AS labels_positive,
         COUNT(*) FILTER (WHERE label = 0)::int     AS labels_negative,
         COUNT(*) FILTER (WHERE reviewed_at >= now() - interval '7 days')::int
                                                    AS labels_last_7d
       FROM fraud_training_labels`,
    );

    // Unlabeled disagreements: пары с case_type != null за последние 30 дней без label.
    const dis = await query(
      `WITH base AS (
         SELECT mp.entity_id_a, mp.entity_id_b, mp.date,
                (mp.score * 100) AS ml_score,
                COALESCE(prd.total_risk, 0) AS rule_score,
                ABS((mp.score * 100) - COALESCE(prd.total_risk, 0)) AS abs_delta
           FROM ml_predictions mp
           LEFT JOIN pair_risk_daily prd
             ON prd.driver_id = mp.entity_id_a
            AND prd.client_id = mp.entity_id_b
            AND prd.date      = mp.date
           LEFT JOIN fraud_training_labels ftl
             ON ftl.entity_type = 'pair'
            AND ftl.entity_key  = mp.entity_id_a || ':' || mp.entity_id_b
            AND ftl.date        = mp.date
          WHERE mp.entity_type = 'pair'
            AND mp.date >= current_date - 30
            AND ftl.id IS NULL
       )
       SELECT COUNT(*)::int AS unlabeled_disagreements
         FROM base
        WHERE (ml_score >= $1 AND rule_score < $2)
           OR (rule_score >= 60 AND ml_score < 30)
           OR (abs_delta >= $3)`,
      [cfg.ml_discovery_min_score, cfg.ml_discovery_max_rule_score, cfg.disagreement_delta_threshold],
    );

    // Тикеты, созданные ML-цепочкой сегодня.
    const tk = await query(
      `SELECT COUNT(*)::int AS tickets_created_from_ml_today
         FROM fraud_tickets
        WHERE created_at::date = $1::date
          AND signals->>'source' IN ('ml_rescore_autocreate', 'ml_disagreement')`,
      [today],
    );

    res.json({
      ok: true,
      ...lbl.rows[0],
      ...dis.rows[0],
      ...tk.rows[0],
      settings: cfg,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "db_error", detail: String(err?.message || err) });
  }
});
