"""
FastAPI ML-сервис риска для newstat. Слушает 127.0.0.1:3013.
Auth: header X-Shared-Secret == ENV SHARED_SECRET.
"""

from __future__ import annotations

import logging
import os
import shutil
from typing import Any

from fastapi import FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

import numpy as np

import features as ft
import train as tr
import supervised as sv

import threading
from pathlib import Path
import psycopg
from catboost import CatBoostClassifier

ACTIVE_PAIR_MODEL_PATH = Path(
    os.environ.get("ML_ACTIVE_PAIR_MODEL", "/opt/rwbtaxi-newstat-ml/models/pair_model_active.cbm")
)

# Глобальный кэш активной supervised-модели для пар. Lazy-loaded.
# Используется в /predict и /predict/pairs/batch когда model_version не задан.
# Перезагружается через POST /reload после активации нового кандидата (T015.5).
_ACTIVE_LOCK = threading.Lock()
_ACTIVE_MODEL: CatBoostClassifier | None = None
_ACTIVE_VERSION: str | None = None
_ACTIVE_SOURCE: str | None = None  # "supervised" | "weak_supervised_fallback"


def _query_active_supervised_version() -> str | None:
    """model_version у активной supervised-модели из ml_training_runs."""
    try:
        with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT model_version FROM ml_training_runs
                     WHERE model_type='supervised'
                       AND entity_type='pair'
                       AND is_active = true
                     LIMIT 1
                    """
                )
                row = cur.fetchone()
                return row[0] if row else None
    except Exception:
        return None


def _load_active_pair_model_locked() -> tuple[CatBoostClassifier, str, str]:
    """Загрузить активную модель: pair_model_active.cbm → fallback model_latest.cbm."""
    if ACTIVE_PAIR_MODEL_PATH.exists():
        m = CatBoostClassifier()
        m.load_model(str(ACTIVE_PAIR_MODEL_PATH))
        ver = _query_active_supervised_version() or "active"
        return m, ver, "supervised"
    # fallback: weak_supervised model_latest.cbm
    weak = tr.load_model(None)
    weak_ver = tr.model_version_from_latest() or "unknown"
    return weak, weak_ver, "weak_supervised_fallback"


def _ensure_active_model() -> tuple[CatBoostClassifier, str, str]:
    global _ACTIVE_MODEL, _ACTIVE_VERSION, _ACTIVE_SOURCE
    with _ACTIVE_LOCK:
        if _ACTIVE_MODEL is None:
            _ACTIVE_MODEL, _ACTIVE_VERSION, _ACTIVE_SOURCE = _load_active_pair_model_locked()
        return _ACTIVE_MODEL, _ACTIVE_VERSION, _ACTIVE_SOURCE


def _reload_active_model() -> tuple[str, str]:
    """Принудительная перезагрузка после активации; возвращает (version, source)."""
    global _ACTIVE_MODEL, _ACTIVE_VERSION, _ACTIVE_SOURCE
    with _ACTIVE_LOCK:
        _ACTIVE_MODEL, _ACTIVE_VERSION, _ACTIVE_SOURCE = _load_active_pair_model_locked()
        return _ACTIVE_VERSION, _ACTIVE_SOURCE

logger = logging.getLogger("newstat-ml")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

SHARED_SECRET = os.environ.get("SHARED_SECRET", "")
if not SHARED_SECRET:
    logger.warning("SHARED_SECRET is empty — auth disabled")

app = FastAPI(title="rwbtaxi-newstat-ml", version="1.0.0")


def _check_auth(x_shared_secret: str | None) -> None:
    if not SHARED_SECRET:
        return
    if x_shared_secret != SHARED_SECRET:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad shared secret")


# ---------- /health ----------

@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "newstat-ml"}


# ---------- /version ----------

@app.get("/version")
def version(x_shared_secret: str | None = Header(default=None, alias="X-Shared-Secret")) -> dict[str, Any]:
    _check_auth(x_shared_secret)
    weak_v = tr.model_version_from_latest()
    _, active_v, source = _ensure_active_model()
    return {
        "model_version": weak_v,           # обратная совместимость (T014)
        "active_model_version": active_v,  # T015: фактическая активная supervised
        "active_source": source,
        "active_pair_model_path": str(ACTIVE_PAIR_MODEL_PATH),
        "active_pair_model_present": ACTIVE_PAIR_MODEL_PATH.exists(),
    }


# ---------- /reload ----------

class ReloadRequest(BaseModel):
    # Если задан — Python сам атомарно копирует этот candidate в
    # pair_model_active.cbm, затем перечитывает. Так Node-сервису не нужен
    # write-доступ к /opt/rwbtaxi-newstat-ml/models (ProtectSystem=strict).
    model_path: str | None = None


@app.post("/reload")
def reload_endpoint(
    req: ReloadRequest | None = None,
    x_shared_secret: str | None = Header(default=None, alias="X-Shared-Secret"),
) -> dict[str, Any]:
    """Перечитать активную модель в память. Опционально принять model_path
    (candidate-файл) и атомарно сделать его новым active."""
    _check_auth(x_shared_secret)

    if req is not None and req.model_path:
        src = Path(req.model_path).resolve()
        models_dir = ACTIVE_PAIR_MODEL_PATH.parent.resolve()
        # Защитный chroot: путь должен лежать в той же папке, что и active.
        if models_dir not in src.parents and src.parent != models_dir:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f"unsafe_model_path: {src}")
        if not src.exists():
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f"model_file_missing: {src}")
        tmp = ACTIVE_PAIR_MODEL_PATH.with_suffix(ACTIVE_PAIR_MODEL_PATH.suffix + ".tmp")
        try:
            shutil.copyfile(str(src), str(tmp))
            os.replace(str(tmp), str(ACTIVE_PAIR_MODEL_PATH))
        except Exception as e:
            # Best-effort cleanup tmp
            try:
                if tmp.exists():
                    tmp.unlink()
            except Exception:
                pass
            logger.error("activate copy failed: %s", e)
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR,
                                f"copy_failed: {e}")

    new_ver, new_src = _reload_active_model()
    logger.info("active model reloaded: version=%s source=%s", new_ver, new_src)
    return {
        "ok": True,
        "active_model_version": new_ver,
        "active_source": new_src,
        "active_pair_model_present": ACTIVE_PAIR_MODEL_PATH.exists(),
    }


# ---------- /train ----------

class TrainRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    notes: str | None = None
    model_version: str | None = None


@app.post("/train")
def train_endpoint(
    req: TrainRequest,
    x_shared_secret: str | None = Header(default=None, alias="X-Shared-Secret"),
) -> dict[str, Any]:
    _check_auth(x_shared_secret)
    logger.info("train start: %s", req.model_dump())
    res = tr.train_and_save(model_version=req.model_version, notes=req.notes)
    logger.info("train ok: run_id=%s auc=%s pr_auc=%s", res.get("run_id"), res.get("auc"), res.get("pr_auc"))
    return res


# ---------- /predict ----------

class PairKey(BaseModel):
    driver_id: str
    client_id: str
    date: str = Field(description="ISO date YYYY-MM-DD")


class PredictRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    pair_keys: list[PairKey] | None = None
    date: str | None = Field(default=None, description="если задано — предсказать все пары за дату")
    model_version: str | None = None


class PredictItem(BaseModel):
    driver_id: str
    client_id: str
    date: str
    score: float
    heuristic_total_risk: float | None = None
    disagreement: float | None = None


class PredictResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    model_version: str
    items: list[PredictItem]


@app.post("/predict", response_model=PredictResponse)
def predict_endpoint(
    req: PredictRequest,
    x_shared_secret: str | None = Header(default=None, alias="X-Shared-Secret"),
) -> PredictResponse:
    _check_auth(x_shared_secret)

    # выбор источника: либо явные ключи, либо все пары за дату
    if req.date:
        df = ft.load_all_pairs_for_date(req.date)
    elif req.pair_keys:
        keys = [(k.driver_id, k.client_id, k.date) for k in req.pair_keys]
        df = ft.load_predict_frame(keys)
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "need either date or pair_keys")

    if df.empty:
        if req.model_version:
            v = req.model_version
        else:
            _, v, _ = _ensure_active_model()
        return PredictResponse(model_version=v, items=[])

    if req.model_version:
        model = tr.load_model(req.model_version)
        version = req.model_version
    else:
        model, version, _src = _ensure_active_model()
    X, _ = ft.feature_matrix(df)
    proba = model.predict_proba(X)[:, 1]
    items: list[PredictItem] = []
    for i, row in df.iterrows():
        score = float(proba[i])
        heur = float(row["heuristic_total_risk"]) if row.get("heuristic_total_risk") is not None else None
        disagreement = None
        if heur is not None:
            disagreement = abs(score - (heur / 100.0))
        items.append(PredictItem(
            driver_id=str(row["driver_id"]),
            client_id=str(row["client_id"]),
            date=str(row["date"]),
            score=score,
            heuristic_total_risk=heur,
            disagreement=disagreement,
        ))
    return PredictResponse(model_version=version, items=items)


# ---------- /predict/pairs/batch (supervised + SHAP) ----------

class BatchPredictRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    pair_keys: list[PairKey]
    model_version: str | None = None
    top_k: int = Field(default=5, ge=1, le=20)


class TopFeature(BaseModel):
    feature: str
    value: float | None
    importance: float


class BatchPredictItem(BaseModel):
    driver_id: str
    client_id: str
    date: str
    ml_score: float            # 0..100
    ml_probability: float      # 0..1
    heuristic_total_risk: float | None = None
    disagreement: float | None = None
    top_features: list[TopFeature]


class BatchPredictResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    model_version: str
    items: list[BatchPredictItem]


@app.post("/predict/pairs/batch", response_model=BatchPredictResponse)
def predict_pairs_batch(
    req: BatchPredictRequest,
    x_shared_secret: str | None = Header(default=None, alias="X-Shared-Secret"),
) -> BatchPredictResponse:
    """
    Batch-предсказание для пар (driver_id, client_id, date).
    В ответ — ml_score (0..100), вероятность, top_features через SHAP.
    Используется в /ml/rescore и для UI ml-disagreements.
    """
    _check_auth(x_shared_secret)
    if not req.pair_keys:
        v = req.model_version or tr.model_version_from_latest() or "unknown"
        return BatchPredictResponse(model_version=v, items=[])
    if len(req.pair_keys) > 1000:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"too many pair_keys: {len(req.pair_keys)} > 1000",
        )

    keys = [(k.driver_id, k.client_id, k.date) for k in req.pair_keys]
    df = ft.load_predict_frame(keys)

    if req.model_version:
        model = tr.load_model(req.model_version)
        version = req.model_version
    else:
        model, version, _src = _ensure_active_model()

    if df.empty:
        return BatchPredictResponse(model_version=version, items=[])

    X, _ = ft.feature_matrix(df)

    # SHAP: получим вклад каждой фичи в каждое предсказание.
    # Возвращает массив shape (n_samples, n_features+1), последняя колонка — bias.
    pool = __import__("catboost").Pool(X, cat_features=ft.CAT_FEATURES)
    shap_vals = model.get_feature_importance(pool, type="ShapValues")
    # Уберём колонку bias.
    shap_only = shap_vals[:, :-1] if shap_vals.shape[1] == len(ft.FEATURE_COLUMNS) + 1 else shap_vals

    proba = model.predict_proba(X)[:, 1]
    top_k = req.top_k

    items: list[BatchPredictItem] = []
    for i, row in df.reset_index(drop=True).iterrows():
        score_proba = float(proba[i])
        score_pct = round(score_proba * 100.0, 4)
        heur = (
            float(row["heuristic_total_risk"])
            if row.get("heuristic_total_risk") is not None
            else None
        )
        disagreement = None
        if heur is not None:
            disagreement = abs(score_proba - (heur / 100.0))

        # топ-K фичей по abs(shap).
        contrib = shap_only[i]
        order = np.argsort(-np.abs(contrib))[:top_k]
        top: list[TopFeature] = []
        for j in order:
            fname = ft.FEATURE_COLUMNS[j]
            fvalue = row.get(fname)
            try:
                fvalue_f = float(fvalue) if fvalue is not None else None
            except (TypeError, ValueError):
                fvalue_f = None
            top.append(TopFeature(
                feature=fname,
                value=fvalue_f,
                importance=float(contrib[j]),
            ))

        items.append(BatchPredictItem(
            driver_id=str(row["driver_id"]),
            client_id=str(row["client_id"]),
            date=str(row["date"]),
            ml_score=score_pct,
            ml_probability=score_proba,
            heuristic_total_risk=heur,
            disagreement=disagreement,
            top_features=top,
        ))
    return BatchPredictResponse(model_version=version, items=items)


# ---------- /retrain (supervised) ----------

class RetrainRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    notes: str | None = None
    created_by: str | None = None


@app.post("/retrain")
def retrain_endpoint(
    req: RetrainRequest,
    x_shared_secret: str | None = Header(default=None, alias="X-Shared-Secret"),
) -> dict[str, Any]:
    """
    Supervised retrain на основе fraud_training_labels. Сохраняет
    candidate-модель (НЕ активирует). Активация — отдельный admin-вызов
    POST /ml/runs/:id/activate в Node.
    """
    _check_auth(x_shared_secret)
    logger.info("supervised retrain start: %s", req.model_dump())
    try:
        res = sv.retrain_supervised(
            notes=req.notes, created_by=req.created_by,
        )
    except RuntimeError as e:
        msg = str(e)
        # not_enough_labels:N:M
        if msg.startswith("not_enough_labels:"):
            _, have, need = msg.split(":", 2)
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Not enough labels for supervised training (have {have}, need {need})",
            )
        if msg.startswith("degenerate_dataset:"):
            _, rows, pos, neg = msg.split(":", 3)
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Degenerate dataset: rows={rows} pos={pos} neg={neg} — нужны и pos, и neg",
            )
        if msg.startswith("bad_train_split:"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Bad train split ({msg}); добавьте лейблов с других дат",
            )
        if msg == "no_features_for_labels":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Нет фичей под имеющиеся лейблы (даты вне pair_risk_daily?)",
            )
        logger.exception("supervised retrain failed")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, msg)
    except Exception as e:  # noqa: BLE001
        logger.exception("supervised retrain crashed")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e))

    logger.info(
        "supervised retrain ok: run_id=%s rows=%s pos=%s neg=%s metrics=%s warnings=%s",
        res.get("run_id"), res.get("rows_count"), res.get("positive_count"),
        res.get("negative_count"), res.get("metrics"), res.get("warnings"),
    )
    return res


# ---------- /runs ----------

@app.get("/runs")
def runs(x_shared_secret: str | None = Header(default=None, alias="X-Shared-Secret"),
         limit: int = 20) -> dict[str, Any]:
    _check_auth(x_shared_secret)
    import psycopg
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT run_id,
                       model_type, entity_type, model_version, target_def,
                       status, error,
                       rows_count, positive_count, negative_count,
                       n_train, n_test, n_pos_train, n_pos_test,
                       auc, pr_auc, accuracy,
                       roc_auc, precision_score, recall, f1_score,
                       top_features, params, notes,
                       model_path, is_active,
                       started_at, finished_at, created_by, created_at
                FROM ml_training_runs
                ORDER BY run_id DESC LIMIT %s
                """, (limit,),
            )
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    return {"items": rows}
