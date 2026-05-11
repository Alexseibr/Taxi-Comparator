// lib/ml.mjs — клиент к Python ML-сервису (FastAPI на 127.0.0.1:3013)
// и UPSERT предсказаний в ml_predictions.

import { withTx } from "./db.mjs";

const ML_BASE_URL = process.env.ML_BASE_URL || "http://127.0.0.1:3013";
const ML_SHARED_SECRET = process.env.ML_SHARED_SECRET || "";
const ML_TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS || 30_000);

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (ML_SHARED_SECRET) h["X-Shared-Secret"] = ML_SHARED_SECRET;
  return h;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = ML_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function mlHealth() {
  const r = await fetchWithTimeout(`${ML_BASE_URL}/health`, { method: "GET" }, 5_000);
  if (!r.ok) throw new Error(`ml health http ${r.status}`);
  return r.json();
}

export async function mlVersion() {
  const r = await fetchWithTimeout(`${ML_BASE_URL}/version`, {
    method: "GET", headers: authHeaders(),
  }, 5_000);
  if (!r.ok) throw new Error(`ml version http ${r.status}`);
  return r.json();
}

export async function mlTrain({ notes, modelVersion } = {}) {
  const r = await fetchWithTimeout(`${ML_BASE_URL}/train`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ notes: notes ?? null, model_version: modelVersion ?? null }),
  }, 5 * 60_000);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body?.detail || `ml train http ${r.status}`;
    throw new Error(msg);
  }
  return body;
}

export async function mlPredictByDate(date, modelVersion = null) {
  const r = await fetchWithTimeout(`${ML_BASE_URL}/predict`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ date, model_version: modelVersion }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body?.detail || `ml predict http ${r.status}`;
    throw new Error(msg);
  }
  return body; // { model_version, items: [{driver_id, client_id, date, score, heuristic_total_risk, disagreement}] }
}

// Batch /predict/pairs/batch (T015.4). pairKeys: [{driver_id, client_id, date}].
// Возвращает { model_version, items:[{driver_id, client_id, date, ml_score,
// ml_probability, heuristic_total_risk, disagreement, top_features}] }.
export async function mlPredictPairsBatch(pairKeys, { modelVersion = null, topK = 5 } = {}) {
  const r = await fetchWithTimeout(`${ML_BASE_URL}/predict/pairs/batch`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      pair_keys: pairKeys,
      model_version: modelVersion,
      top_k: topK,
    }),
  }, 60_000);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body?.detail || `ml batch http ${r.status}`;
    throw new Error(msg);
  }
  return body;
}

// Supervised retrain (T015.3). Может занимать минуту+.
export async function mlSupervisedRetrain({ notes, createdBy } = {}) {
  const r = await fetchWithTimeout(`${ML_BASE_URL}/retrain`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ notes: notes ?? null, created_by: createdBy ?? null }),
  }, 5 * 60_000);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body?.detail || `ml retrain http ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return body;
}

// Перечитать активную модель в Python. Опционально передать modelPath
// candidate-файла — Python сам атомарно скопирует его в pair_model_active.cbm
// (так Node-сервису не нужен write-доступ к ML-папке). Если упало — бросаем.
export async function mlReload({ modelPath } = {}) {
  const body = modelPath ? { model_path: modelPath } : {};
  const r = await fetchWithTimeout(`${ML_BASE_URL}/reload`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  }, 30_000);
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = out?.detail || `ml reload http ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.body = out;
    throw err;
  }
  return out;
}

export async function mlRuns(limit = 20) {
  const r = await fetchWithTimeout(`${ML_BASE_URL}/runs?limit=${limit}`, {
    method: "GET", headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`ml runs http ${r.status}`);
  return r.json();
}

// UPSERT предсказаний в ml_predictions. Делаем bulk insert через unnest.
// items: [{driver_id, client_id, date, score(0..1), heuristic_total_risk?,
//          disagreement?, top_features?}]. top_features — массив объектов
// {feature, value, importance} для аудита/UI; пишется в jsonb-колонку.
export async function persistPredictions(items, modelVersion) {
  if (!items?.length) return { inserted: 0 };

  await withTx(async (c) => {
    const ent_type = items.map(() => "pair");
    const ent_a    = items.map((x) => String(x.driver_id));
    const ent_b    = items.map((x) => String(x.client_id));
    const dates    = items.map((x) => x.date);
    const versions = items.map(() => modelVersion);
    const scores   = items.map((x) => Number(x.score));
    const heur     = items.map((x) =>
      x.heuristic_total_risk == null ? null : Number(x.heuristic_total_risk));
    const disag    = items.map((x) =>
      x.disagreement == null ? null : Number(x.disagreement));
    const tops     = items.map((x) =>
      x.top_features == null ? null : JSON.stringify(x.top_features));

    await c.query(
      `INSERT INTO ml_predictions
         (entity_type, entity_id_a, entity_id_b, date, model_version,
          score, heuristic_score, disagreement, top_features, predicted_at)
       SELECT t.entity_type, t.entity_id_a, t.entity_id_b, t.date, t.model_version,
              t.score, t.heuristic_score, t.disagreement,
              COALESCE(t.top_features::jsonb, '[]'::jsonb), now()
       FROM unnest(
         $1::text[], $2::text[], $3::text[], $4::date[], $5::text[],
         $6::numeric[], $7::numeric[], $8::numeric[], $9::text[]
       ) AS t(entity_type, entity_id_a, entity_id_b, date, model_version,
              score, heuristic_score, disagreement, top_features)
       ON CONFLICT (entity_type, entity_id_a, entity_id_b, date)
       DO UPDATE SET
         model_version  = EXCLUDED.model_version,
         score          = EXCLUDED.score,
         heuristic_score= EXCLUDED.heuristic_score,
         disagreement   = EXCLUDED.disagreement,
         top_features   = COALESCE(EXCLUDED.top_features, ml_predictions.top_features),
         predicted_at   = EXCLUDED.predicted_at`,
      [ent_type, ent_a, ent_b, dates, versions, scores, heur, disag, tops],
    );
  });

  return { inserted: items.length };
}

// Адаптер: BatchPredict-ответ от Python имеет ml_probability/ml_score, а ETL
// и ml_predictions работают со score (0..1). Перепаковываем и сохраняем.
export async function persistBatchPredictions(batchItems, modelVersion) {
  const items = batchItems.map((x) => ({
    driver_id: x.driver_id,
    client_id: x.client_id,
    date: x.date,
    score: Number(x.ml_probability),
    heuristic_total_risk: x.heuristic_total_risk,
    disagreement: x.disagreement,
    top_features: x.top_features,
  }));
  return persistPredictions(items, modelVersion);
}

// Высокоуровневая функция: для каждой даты в `dates` запросить predict у Python
// и записать в БД. Если Python упал — логируем, но не падаем (ETL не должен сломаться).
export async function predictAndPersistForDates(dates, log) {
  const results = [];
  for (const d of dates) {
    try {
      const resp = await mlPredictByDate(d);
      const r = await persistPredictions(resp.items || [], resp.model_version || "unknown");
      results.push({ date: d, ok: true, count: r.inserted, model_version: resp.model_version });
      log?.info({ date: d, count: r.inserted, model_version: resp.model_version }, "ml predictions persisted");
    } catch (err) {
      results.push({ date: d, ok: false, error: String(err) });
      log?.warn({ date: d, err: String(err) }, "ml predict failed (skip)");
    }
  }
  return results;
}
