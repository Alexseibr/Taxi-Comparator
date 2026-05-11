"""
Feature pipeline для ML-модели риска на парах (driver_id, client_id, date).
Источники: pair_risk_daily, daily_pair_stats, graph_edges,
daily_driver_stats, driver_risk_daily, daily_client_stats, client_risk_daily.
"""

from __future__ import annotations

import os
import psycopg
import pandas as pd
from typing import Iterable, Sequence

# Список фичей, которые подаём в модель. Используется и в train, и в predict.
# ВАЖНО: исключены признаки, которые напрямую входят в формулу
# pair_risk_daily.total_risk (target = total_risk>=70), иначе data leakage и AUC=1.0:
#   - p_repeat_ratio, p_suspicious_ratio, p_cashback_dependency (это компоненты total_risk)
#   - d_*_risk, c_*_risk поля (driver_risk_daily/client_risk_daily — производные эвристики)
# Оставлены только «сырые» агрегаты, чтобы модель училась независимому представлению.
FEATURE_COLUMNS: list[str] = [
    # pair-level (raw counts/shares)
    "p_orders",
    "p_noncash_share",
    "p_short_share",
    "p_fast_share",
    "p_avg_check",
    "p_noncash_gmv",
    # graph edge
    "e_days_seen",
    "e_edge_strength",
    "e_cashback_generated",
    # driver-day (raw)
    "d_total_orders",
    "d_unique_clients",
    "d_repeat_client_ratio",
    "d_max_with_one_client",
    "d_noncash_share",
    "d_short_share",
    "d_fast_share",
    "d_avg_arrival",
    "d_avg_trip",
    "d_active_hours_count",
    # client-day (raw)
    "c_total_orders",
    "c_unique_drivers",
    "c_repeat_driver_ratio",
    "c_max_with_one_driver",
    "c_noncash_share",
    "c_cashback_earned",
]

CAT_FEATURES: list[str] = []  # пока числовые

KEY_COLUMNS = ["driver_id", "client_id", "date"]
TARGET_COLUMN = "y"

# threshold по эвристике: pair считается high_risk если total_risk >= TARGET_THRESHOLD
TARGET_THRESHOLD = 70.0

_SQL_BASE = """
SELECT
    pr.driver_id,
    pr.client_id,
    pr.date,
    -- pair
    pr.orders_count                                                AS p_orders,
    CASE WHEN COALESCE(ps.orders_count,0)>0
         THEN ps.noncash_orders::numeric / ps.orders_count ELSE 0 END AS p_noncash_share,
    CASE WHEN COALESCE(ps.orders_count,0)>0
         THEN ps.short_trip_orders::numeric / ps.orders_count ELSE 0 END AS p_short_share,
    CASE WHEN COALESCE(ps.orders_count,0)>0
         THEN ps.fast_arrival_orders::numeric / ps.orders_count ELSE 0 END AS p_fast_share,
    CASE WHEN COALESCE(ps.orders_count,0)>0
         THEN ps.total_gmv / ps.orders_count ELSE 0 END           AS p_avg_check,
    pr.noncash_gmv                                                 AS p_noncash_gmv,
    pr.repeat_ratio                                                AS p_repeat_ratio,
    pr.suspicious_ratio                                            AS p_suspicious_ratio,
    pr.cashback_dependency                                         AS p_cashback_dependency,
    -- edge
    COALESCE(ge.days_seen, 1)                                      AS e_days_seen,
    COALESCE(ge.edge_strength, 0)                                  AS e_edge_strength,
    COALESCE(ge.cashback_generated_byn, 0)                         AS e_cashback_generated,
    -- driver-day
    COALESCE(dd.total_orders, 0)                                   AS d_total_orders,
    COALESCE(dd.unique_clients, 0)                                 AS d_unique_clients,
    COALESCE(dd.repeat_client_ratio, 0)                            AS d_repeat_client_ratio,
    COALESCE(dd.max_orders_with_one_client, 0)                     AS d_max_with_one_client,
    CASE WHEN COALESCE(dd.total_orders,0)>0
         THEN dd.noncash_orders::numeric / dd.total_orders ELSE 0 END AS d_noncash_share,
    CASE WHEN COALESCE(dd.total_orders,0)>0
         THEN dd.short_trip_orders::numeric / dd.total_orders ELSE 0 END AS d_short_share,
    CASE WHEN COALESCE(dd.total_orders,0)>0
         THEN dd.fast_arrival_orders::numeric / dd.total_orders ELSE 0 END AS d_fast_share,
    COALESCE(dd.avg_arrival_minutes, 0)                            AS d_avg_arrival,
    COALESCE(dd.avg_trip_minutes, 0)                               AS d_avg_trip,
    -- popcount(active_hours_mask) — число активных часов в сутках
    (SELECT COUNT(*) FROM generate_series(0,23) h
        WHERE (COALESCE(dd.active_hours_mask,0) & (1 << h)) <> 0)  AS d_active_hours_count,
    COALESCE(dr.guarantee_risk, 0)                                 AS d_guarantee_risk,
    COALESCE(dr.earnings_risk, 0)                                  AS d_earnings_risk,
    COALESCE(dr.collusion_risk, 0)                                 AS d_collusion_risk,
    -- client-day
    COALESCE(dc.total_orders, 0)                                   AS c_total_orders,
    COALESCE(dc.unique_drivers, 0)                                 AS c_unique_drivers,
    COALESCE(dc.repeat_driver_ratio, 0)                            AS c_repeat_driver_ratio,
    COALESCE(dc.max_orders_with_one_driver, 0)                     AS c_max_with_one_driver,
    CASE WHEN COALESCE(dc.total_orders,0)>0
         THEN dc.noncash_orders::numeric / dc.total_orders ELSE 0 END AS c_noncash_share,
    COALESCE(dc.cashback_earned, 0)                                AS c_cashback_earned,
    COALESCE(cr.cashback_exposure, 0)                              AS c_cashback_exposure,
    COALESCE(cr.repeat_driver_dependency, 0)                       AS c_repeat_driver_dependency,
    COALESCE(cr.suspicious_activity, 0)                            AS c_suspicious_activity,
    -- target & heuristic
    pr.total_risk                                                  AS heuristic_total_risk
FROM pair_risk_daily pr
LEFT JOIN daily_pair_stats     ps ON ps.driver_id=pr.driver_id AND ps.client_id=pr.client_id AND ps.date=pr.date
LEFT JOIN graph_edges          ge ON ge.driver_id=pr.driver_id AND ge.client_id=pr.client_id AND ge.date=pr.date
LEFT JOIN daily_driver_stats   dd ON dd.driver_id=pr.driver_id AND dd.date=pr.date
LEFT JOIN driver_risk_daily    dr ON dr.driver_id=pr.driver_id AND dr.date=pr.date
LEFT JOIN daily_client_stats   dc ON dc.client_id=pr.client_id AND dc.date=pr.date
LEFT JOIN client_risk_daily    cr ON cr.client_id=pr.client_id AND cr.date=pr.date
"""


def _connect() -> psycopg.Connection:
    dsn = os.environ["DATABASE_URL"]
    return psycopg.connect(dsn)


def load_training_frame(min_date: str | None = None,
                        max_date: str | None = None) -> pd.DataFrame:
    """Загрузить полный датасет с target."""
    where = []
    params: list = []
    if min_date:
        where.append("pr.date >= %s")
        params.append(min_date)
    if max_date:
        where.append("pr.date <= %s")
        params.append(max_date)
    sql = _SQL_BASE
    if where:
        sql += " WHERE " + " AND ".join(where)

    with _connect() as conn:
        df = pd.read_sql(sql, conn, params=params)

    df[TARGET_COLUMN] = (df["heuristic_total_risk"].astype(float) >= TARGET_THRESHOLD).astype(int)
    return df


def load_predict_frame(keys: Sequence[tuple[str, str, str]]) -> pd.DataFrame:
    """
    Загрузить фичи для конкретного списка ключей (driver_id, client_id, date).
    Используется в /predict.
    """
    if not keys:
        return pd.DataFrame(columns=KEY_COLUMNS + FEATURE_COLUMNS + ["heuristic_total_risk"])
    drivers = [k[0] for k in keys]
    clients = [k[1] for k in keys]
    dates   = [k[2] for k in keys]
    sql = _SQL_BASE + """
        WHERE (pr.driver_id, pr.client_id, pr.date) IN (
            SELECT * FROM unnest(%s::text[], %s::text[], %s::date[])
        )
    """
    with _connect() as conn:
        df = pd.read_sql(sql, conn, params=[drivers, clients, dates])
    return df


def load_all_pairs_for_date(date: str) -> pd.DataFrame:
    """Все пары за конкретную дату — для бэка ETL после recompute."""
    sql = _SQL_BASE + " WHERE pr.date = %s"
    with _connect() as conn:
        df = pd.read_sql(sql, conn, params=[date])
    return df


def feature_matrix(df: pd.DataFrame):
    """Вернуть X (numpy/pd) + опционально y."""
    for col in FEATURE_COLUMNS:
        if col not in df.columns:
            df[col] = 0
    X = df[FEATURE_COLUMNS].astype(float).fillna(0)
    if TARGET_COLUMN in df.columns:
        y = df[TARGET_COLUMN].astype(int).values
    else:
        y = None
    return X, y
