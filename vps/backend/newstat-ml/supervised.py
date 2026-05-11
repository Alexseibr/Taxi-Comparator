"""
Supervised CatBoost-модель риска на парах (driver_id, client_id, date).
Источник лейблов: fraud_training_labels (entity_type='pair', label IN (0,1)).
Источник фичей: тот же _SQL_BASE из features.py.

В отличие от weak-supervised (train.py), модель сохраняется как CANDIDATE:
    /opt/rwbtaxi-newstat-ml/models/pair_model_candidate_<ts>.cbm
и НЕ становится активной автоматически. Оператор-админ активирует её
через POST /ml/runs/:id/activate (T015.5).
"""

from __future__ import annotations

import json
import os
import socket
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import psycopg
from catboost import CatBoostClassifier, Pool
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

from features import (
    CAT_FEATURES,
    FEATURE_COLUMNS,
    feature_matrix,
    load_predict_frame,
)

MODEL_DIR = Path(os.environ.get("ML_MODEL_DIR", "/opt/rwbtaxi-newstat-ml/models"))

# Минимум лейблов для supervised retrain. Меньше — модель просто не выучит.
MIN_LABELS = int(os.environ.get("ML_SUPERVISED_MIN_LABELS", "50"))


# ─────────────────────────────────────────────────────── загрузка лейблов ───
def _load_pair_labels() -> pd.DataFrame:
    """
    Достать актуальные лейблы по парам. Если для одной пары/даты есть
    несколько лейблов из разных тикетов — берём самый свежий по reviewed_at.
    """
    sql = """
        SELECT DISTINCT ON (entity_key, date)
               entity_key, date, label, reviewed_at
          FROM fraud_training_labels
         WHERE entity_type = 'pair'
           AND label IN (0, 1)
         ORDER BY entity_key, date, reviewed_at DESC NULLS LAST, id DESC
    """
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        df = pd.read_sql(sql, conn)
    if df.empty:
        return df
    parts = df["entity_key"].str.split(":", n=1, expand=True)
    df["driver_id"] = parts[0]
    df["client_id"] = parts[1]
    df = df.dropna(subset=["driver_id", "client_id"])
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df[["driver_id", "client_id", "date", "label"]]


def _load_features_for_labels(labels_df: pd.DataFrame) -> pd.DataFrame:
    """
    Подтянуть фичи по тем же (driver_id, client_id, date), что в лейблах.
    Использует существующий load_predict_frame из features.py.
    """
    keys: list[tuple[str, str, str]] = [
        (str(r.driver_id), str(r.client_id), r.date.isoformat())
        for r in labels_df.itertuples(index=False)
    ]
    feat = load_predict_frame(keys)
    if feat.empty:
        return feat
    feat["date"] = pd.to_datetime(feat["date"]).dt.date
    feat["driver_id"] = feat["driver_id"].astype(str)
    feat["client_id"] = feat["client_id"].astype(str)
    return feat


def _time_split(
    df: pd.DataFrame, test_frac: float = 0.2,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    dates = sorted(df["date"].unique())
    if len(dates) < 4:
        # слишком мало дат — fallback на стратифицированный random
        df = df.sample(frac=1.0, random_state=42).reset_index(drop=True)
        n_test = max(1, int(round(len(df) * test_frac)))
        return df.iloc[:-n_test].copy(), df.iloc[-n_test:].copy()
    n_test_dates = max(1, int(round(len(dates) * test_frac)))
    test_dates = set(dates[-n_test_dates:])
    return (
        df[~df["date"].isin(test_dates)].copy(),
        df[df["date"].isin(test_dates)].copy(),
    )


# ─────────────────────────────────────────────────────────────── retrain ────
def retrain_supervised(
    notes: str | None = None,
    created_by: str | None = None,
) -> dict[str, Any]:
    """
    Тренирует supervised CatBoost на лейблах оператора и сохраняет
    кандидат-модель. Возвращает {ok, run_id, model_version, model_path,
    metrics, warnings}.

    Бросает RuntimeError("not_enough_labels:N:M") если меньше MIN_LABELS.
    """
    started_at = datetime.now(timezone.utc)
    ts_tag = started_at.strftime("%Y%m%d_%H%M%S")
    model_version = f"sv_{ts_tag}"
    candidate_path = MODEL_DIR / f"pair_model_candidate_{ts_tag}.cbm"
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    labels_df = _load_pair_labels()
    n_labels = int(len(labels_df))
    if n_labels < MIN_LABELS:
        # ничего в БД не пишем — это пользовательская ошибка, не инцидент
        raise RuntimeError(f"not_enough_labels:{n_labels}:{MIN_LABELS}")

    feat_df = _load_features_for_labels(labels_df)
    if feat_df.empty:
        _log_failure(
            model_version, started_at, created_by,
            error=f"no features for {n_labels} labels (data drift?)",
            rows_count=0, positive_count=0, negative_count=0,
        )
        raise RuntimeError("no_features_for_labels")

    # join по (driver_id, client_id, date)
    df = feat_df.merge(
        labels_df, on=["driver_id", "client_id", "date"], how="inner",
    )
    df = df.rename(columns={"label": "y"})
    rows_count    = int(len(df))
    positive_cnt  = int((df["y"] == 1).sum())
    negative_cnt  = int((df["y"] == 0).sum())

    if rows_count < MIN_LABELS or positive_cnt == 0 or negative_cnt == 0:
        _log_failure(
            model_version, started_at, created_by,
            error=(
                f"degenerate dataset: rows={rows_count} pos={positive_cnt} "
                f"neg={negative_cnt}"
            ),
            rows_count=rows_count, positive_count=positive_cnt,
            negative_count=negative_cnt,
        )
        raise RuntimeError(
            f"degenerate_dataset:{rows_count}:{positive_cnt}:{negative_cnt}"
        )

    train_df, test_df = _time_split(df, test_frac=0.2)
    X_train, y_train = feature_matrix(train_df)
    X_test,  y_test  = feature_matrix(test_df)

    n_train     = int(len(y_train))
    n_test      = int(len(y_test))
    n_pos_train = int(y_train.sum())
    n_pos_test  = int(y_test.sum())

    if n_pos_train == 0 or n_pos_train == n_train:
        _log_failure(
            model_version, started_at, created_by,
            error=f"bad train split: pos={n_pos_train}/{n_train}",
            rows_count=rows_count, positive_count=positive_cnt,
            negative_count=negative_cnt,
        )
        raise RuntimeError(f"bad_train_split:{n_pos_train}:{n_train}")

    params = {
        "iterations": 500,
        "depth": 5,
        "learning_rate": 0.05,
        "loss_function": "Logloss",
        "eval_metric": "AUC",
        "auto_class_weights": "Balanced",
        "random_seed": 42,
        "verbose": False,
        "allow_writing_files": False,
    }
    model = CatBoostClassifier(**params)
    train_pool = Pool(X_train, y_train, cat_features=CAT_FEATURES)
    if n_pos_test > 0 and n_pos_test < n_test:
        test_pool = Pool(X_test, y_test, cat_features=CAT_FEATURES)
        model.fit(
            train_pool, eval_set=test_pool,
            use_best_model=True, early_stopping_rounds=50,
        )
    else:
        model.fit(train_pool)

    metrics: dict[str, float | None] = {
        "roc_auc": None, "pr_auc": None, "accuracy": None,
        "precision": None, "recall": None, "f1": None,
    }
    if n_pos_test > 0 and n_pos_test < n_test:
        proba_test = model.predict_proba(X_test)[:, 1]
        pred_test  = (proba_test >= 0.5).astype(int)
        metrics["roc_auc"]   = float(roc_auc_score(y_test, proba_test))
        metrics["pr_auc"]    = float(average_precision_score(y_test, proba_test))
        metrics["accuracy"]  = float(accuracy_score(y_test, pred_test))
        metrics["precision"] = float(precision_score(y_test, pred_test, zero_division=0))
        metrics["recall"]    = float(recall_score(y_test, pred_test, zero_division=0))
        metrics["f1"]        = float(f1_score(y_test, pred_test, zero_division=0))

    importances = model.get_feature_importance(train_pool)
    top_features = sorted(
        ({"name": n, "importance": float(v)} for n, v in zip(FEATURE_COLUMNS, importances)),
        key=lambda x: x["importance"], reverse=True,
    )[:20]

    model.save_model(str(candidate_path))

    finished_at = datetime.now(timezone.utc)
    target_def = "fraud_training_labels.label (operator labels)"

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ml_training_runs
                  (model_type, entity_type, model_version, target_def,
                   n_train, n_test, n_pos_train, n_pos_test,
                   auc, pr_auc, accuracy,
                   roc_auc, precision_score, recall, f1_score,
                   rows_count, positive_count, negative_count,
                   top_features, params, notes,
                   model_path, status,
                   started_at, finished_at, created_by, is_active)
                VALUES
                  (%s, %s, %s, %s,
                   %s, %s, %s, %s,
                   %s, %s, %s,
                   %s, %s, %s, %s,
                   %s, %s, %s,
                   %s, %s, %s,
                   %s, %s,
                   %s, %s, %s, false)
                RETURNING run_id
                """,
                (
                    "supervised", "pair", model_version, target_def,
                    n_train, n_test, n_pos_train, n_pos_test,
                    metrics["roc_auc"], metrics["pr_auc"], metrics["accuracy"],
                    metrics["roc_auc"], metrics["precision"], metrics["recall"], metrics["f1"],
                    rows_count, positive_cnt, negative_cnt,
                    json.dumps(top_features), json.dumps(params), notes,
                    str(candidate_path), "success",
                    started_at, finished_at, created_by,
                ),
            )
            run_id = cur.fetchone()[0]
        conn.commit()

    warnings: list[str] = []
    if metrics["roc_auc"] is not None and metrics["roc_auc"] < 0.65:
        warnings.append(f"low_roc_auc:{metrics['roc_auc']:.3f}")
    if positive_cnt < 20:
        warnings.append(f"few_positives:{positive_cnt}")
    if metrics["recall"] is not None and metrics["recall"] < 0.5:
        warnings.append(f"low_recall:{metrics['recall']:.3f}")

    return {
        "ok": True,
        "run_id": int(run_id),
        "model_type": "supervised",
        "model_version": model_version,
        "model_path": str(candidate_path),
        "rows_count": rows_count,
        "positive_count": positive_cnt,
        "negative_count": negative_cnt,
        "n_train": n_train,
        "n_test": n_test,
        "metrics": metrics,
        "top_features": top_features[:10],
        "warnings": warnings,
        "is_active": False,
    }


def _log_failure(
    model_version: str, started_at: datetime, created_by: str | None,
    *, error: str, rows_count: int, positive_count: int, negative_count: int,
) -> None:
    """Запись о провалившемся запуске — для UI ml runs page."""
    finished_at = datetime.now(timezone.utc)
    try:
        with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ml_training_runs
                      (model_type, entity_type, model_version,
                       rows_count, positive_count, negative_count,
                       status, error,
                       started_at, finished_at, created_by, is_active)
                    VALUES
                      ('supervised', 'pair', %s,
                       %s, %s, %s,
                       'failed', %s,
                       %s, %s, %s, false)
                    """,
                    (model_version, rows_count, positive_count, negative_count,
                     error, started_at, finished_at, created_by),
                )
            conn.commit()
    except Exception:
        # не маскируем исходный RuntimeError из retrain
        pass


if __name__ == "__main__":
    import sys
    notes = sys.argv[1] if len(sys.argv) > 1 else None
    res = retrain_supervised(notes=notes, created_by="cli")
    print(json.dumps(res, indent=2, default=str))
