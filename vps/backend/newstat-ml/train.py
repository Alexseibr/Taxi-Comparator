"""
Обучение CatBoost-модели риска на парах.
Time-based split: ранние даты → train, поздние → test.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import psycopg
from catboost import CatBoostClassifier, Pool
from sklearn.metrics import roc_auc_score, average_precision_score, accuracy_score

from features import (
    FEATURE_COLUMNS,
    CAT_FEATURES,
    TARGET_COLUMN,
    TARGET_THRESHOLD,
    load_training_frame,
    feature_matrix,
)

MODEL_DIR = Path(os.environ.get("ML_MODEL_DIR", "/opt/rwbtaxi-newstat-ml/models"))


def _time_split(df: pd.DataFrame, test_frac: float = 0.2) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Поздние ~20% дат → test."""
    dates = sorted(df["date"].unique())
    if len(dates) < 2:
        # Слишком мало дат — деградируем до случайного 80/20.
        df = df.sample(frac=1.0, random_state=42).reset_index(drop=True)
        n_test = max(1, int(round(len(df) * test_frac)))
        return df.iloc[:-n_test].copy(), df.iloc[-n_test:].copy()
    n_test_dates = max(1, int(round(len(dates) * test_frac)))
    test_dates = set(dates[-n_test_dates:])
    train_df = df[~df["date"].isin(test_dates)].copy()
    test_df  = df[df["date"].isin(test_dates)].copy()
    return train_df, test_df


def train_and_save(model_version: str | None = None,
                   notes: str | None = None) -> dict[str, Any]:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if model_version is None:
        model_version = datetime.utcnow().strftime("v%Y%m%d_%H%M%S")

    df = load_training_frame()
    if df.empty:
        raise RuntimeError("training frame is empty — нет данных в pair_risk_daily")

    train_df, test_df = _time_split(df, test_frac=0.2)
    X_train, y_train = feature_matrix(train_df)
    X_test,  y_test  = feature_matrix(test_df)

    n_pos_train = int(y_train.sum())
    n_pos_test  = int(y_test.sum())
    n_train     = int(len(y_train))
    n_test      = int(len(y_test))

    if n_pos_train == 0 or n_pos_train == n_train:
        raise RuntimeError(
            f"плохой train split: positives={n_pos_train}/{n_train}. "
            "Нужны и positives, и negatives."
        )

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
        model.fit(train_pool, eval_set=test_pool, use_best_model=True,
                  early_stopping_rounds=50)
    else:
        model.fit(train_pool)

    # метрики
    metrics: dict[str, float | None] = {"auc": None, "pr_auc": None, "accuracy": None}
    if n_pos_test > 0 and n_pos_test < n_test:
        proba_test = model.predict_proba(X_test)[:, 1]
        pred_test  = (proba_test >= 0.5).astype(int)
        metrics["auc"]      = float(roc_auc_score(y_test, proba_test))
        metrics["pr_auc"]   = float(average_precision_score(y_test, proba_test))
        metrics["accuracy"] = float(accuracy_score(y_test, pred_test))

    # топ фичей
    importances = model.get_feature_importance(train_pool)
    top_features = sorted(
        ({"name": n, "importance": float(v)} for n, v in zip(FEATURE_COLUMNS, importances)),
        key=lambda x: x["importance"], reverse=True,
    )[:20]

    # сохранить модель
    model_path = MODEL_DIR / f"model_{model_version}.cbm"
    model.save_model(str(model_path))
    # обновить «latest» симлинк
    latest = MODEL_DIR / "model_latest.cbm"
    if latest.exists() or latest.is_symlink():
        latest.unlink()
    try:
        latest.symlink_to(model_path.name)
    except OSError:
        # fallback: copy
        import shutil
        shutil.copy2(model_path, latest)

    # лог в БД
    target_def = f"pair_risk_daily.total_risk >= {TARGET_THRESHOLD}"
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ml_training_runs
                  (model_version, target_def, n_train, n_test, n_pos_train, n_pos_test,
                   auc, pr_auc, accuracy, top_features, params, notes)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING run_id
                """,
                (model_version, target_def, n_train, n_test, n_pos_train, n_pos_test,
                 metrics["auc"], metrics["pr_auc"], metrics["accuracy"],
                 json.dumps(top_features), json.dumps(params), notes),
            )
            run_id = cur.fetchone()[0]
        conn.commit()

    return {
        "run_id": int(run_id),
        "model_version": model_version,
        "model_path": str(model_path),
        "n_train": n_train,
        "n_test": n_test,
        "n_pos_train": n_pos_train,
        "n_pos_test": n_pos_test,
        "auc": metrics["auc"],
        "pr_auc": metrics["pr_auc"],
        "accuracy": metrics["accuracy"],
        "top_features": top_features[:10],
    }


def load_model(model_version: str | None = None) -> CatBoostClassifier:
    if model_version and model_version != "latest":
        path = MODEL_DIR / f"model_{model_version}.cbm"
    else:
        path = MODEL_DIR / "model_latest.cbm"
    if not path.exists():
        raise FileNotFoundError(f"модель не найдена: {path}")
    model = CatBoostClassifier()
    model.load_model(str(path))
    return model


def model_version_from_latest() -> str | None:
    p = MODEL_DIR / "model_latest.cbm"
    if not p.exists():
        return None
    if p.is_symlink():
        target = os.readlink(str(p))
        # model_<ver>.cbm
        name = Path(target).name
        if name.startswith("model_") and name.endswith(".cbm"):
            return name[len("model_"):-len(".cbm")]
    # fallback: latest run from DB
    try:
        with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT model_version FROM ml_training_runs ORDER BY run_id DESC LIMIT 1")
                row = cur.fetchone()
                return row[0] if row else None
    except Exception:
        return None


if __name__ == "__main__":
    import sys
    notes = sys.argv[1] if len(sys.argv) > 1 else None
    res = train_and_save(notes=notes)
    print(json.dumps(res, indent=2, default=str))
