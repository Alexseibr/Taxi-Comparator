#!/usr/bin/env python3
"""
Sprint 3: CatBoost + H3 + MultiQuantile.

Учим CatBoost модель с гексагональными гео-фичами (H3) и multi-quantile loss
для трёх квантилей: 0.1 (нижняя граница), 0.5 (точечный прогноз), 0.9 (верхняя).

На выходе:
  • prediction_low   (P10)  — гарантированно дешевле в 90% случаев
  • prediction_med   (P50)  — точечный прогноз (медиана)
  • prediction_high  (P90)  — гарантированно дороже в 90% случаев
  • diapason_width = high - low  — мера уверенности модели
"""

import json
import sys
from pathlib import Path
from datetime import datetime
from collections import Counter

import numpy as np
import pandas as pd
import h3
from catboost import CatBoostRegressor, Pool
from sklearn.model_selection import KFold

CALIB_DIR = Path('/tmp/calib-data/calib')
WEATHER_FILE = Path('/tmp/calib-data/weather-index.json')
OUT_FILE = Path('/home/runner/workspace/artifacts/taxi-compare/scripts/_catboost-h3-result.json')

H3_RES_FROM = 8   # ~460м — район
H3_RES_TO = 8


def haversine_km(lat1, lng1, lat2, lng2):
    R = 6371
    p = np.pi / 180
    a = (np.sin((lat2 - lat1) * p / 2) ** 2 +
         np.cos(lat1 * p) * np.cos(lat2 * p) * np.sin((lng2 - lng1) * p / 2) ** 2)
    return 2 * R * np.arcsin(np.sqrt(a))


def load_records():
    weather = json.loads(WEATHER_FILE.read_text())['data']
    records = []
    skipped = Counter()
    for f in sorted(CALIB_DIR.glob('calib-*.json')):
        try:
            j = json.loads(f.read_text())
        except Exception:
            skipped['parse'] += 1
            continue
        if not isinstance(j.get('factE'), (int, float)) or not isinstance(j.get('factC'), (int, float)):
            skipped['noFact'] += 1
            continue
        if j.get('anomaly', {}) and j['anomaly'].get('suspicious'):
            skipped['anomaly'] += 1
            continue
        try:
            lat1, lng1, lat2, lng2 = float(j['fromLat']), float(j['fromLng']), float(j['toLat']), float(j['toLng'])
        except Exception:
            skipped['noGeo'] += 1
            continue
        km = haversine_km(lat1, lng1, lat2, lng2)
        if not (0.3 <= km <= 60):
            skipped['badKm'] += 1
            continue
        trip_min = j.get('tripMin') if isinstance(j.get('tripMin'), (int, float)) and 1 <= j['tripMin'] <= 240 else None
        eta_min = j.get('etaMin') if isinstance(j.get('etaMin'), (int, float)) and 1 <= j['etaMin'] <= 240 else None
        if eta_min is not None and (km / eta_min) * 60 > 60:
            eta_min = None
        minutes = trip_min if trip_min is not None else eta_min
        if minutes is None:
            skipped['noTime'] += 1
            continue
        ideal_min = (km * 60) / 24
        eta_excess = max(0.0, minutes / ideal_min - 1)
        h = ((j.get('hour', 0) % 24) + 24) % 24
        demand = (j.get('demand') or j.get('demandColor') or '').lower()
        date = j.get('date') or (j.get('receivedAt', '')[:10] if j.get('receivedAt') else '')
        if not date:
            skipped['noDate'] += 1
            continue
        try:
            dow = datetime.strptime(date, '%Y-%m-%d').weekday()  # 0=Mon..6=Sun (note: != JS getDay)
        except Exception:
            skipped['badDate'] += 1
            continue
        wkey = f"{date}T{h:02d}"
        w = weather.get(wkey, {})

        # H3 features
        hex_from = h3.latlng_to_cell(lat1, lng1, H3_RES_FROM)
        hex_to = h3.latlng_to_cell(lat2, lng2, H3_RES_TO)
        try:
            h3_dist = h3.grid_distance(hex_from, hex_to)
        except Exception:
            h3_dist = -1

        records.append({
            'km': km,
            'minutes': float(minutes),
            'eta_excess': eta_excess,
            'hour': h,
            'dow': dow,
            'demand': demand or 'unknown',
            'is_red': 1 if demand == 'red' else 0,
            'is_yellow': 1 if demand == 'yellow' else 0,
            'is_short': 1 if km < 1.5 else 0,
            'is_morn': 1 if 7 <= h <= 9 else 0,
            'is_eve': 1 if 15 <= h <= 19 else 0,
            'is_night': 1 if h >= 22 or h <= 5 else 0,
            'is_weekend': 1 if dow in (5, 6) else 0,
            # H3
            'hex_from': hex_from,
            'hex_to': hex_to,
            'h3_dist': h3_dist,
            # weather (опционально)
            'temp': w.get('temp', np.nan),
            'rain_mm': w.get('rain', 0.0),
            'wind': w.get('wind', np.nan),
            'humidity': w.get('humidity', np.nan),
            # targets
            'factE': float(j['factE']),
            'factC': float(j['factC']),
        })
    return pd.DataFrame(records), skipped


def evaluate(y_true, p_med, p_low, p_high, label=''):
    err = np.abs(p_med - y_true) / y_true
    in_band = ((y_true >= p_low) & (y_true <= p_high)).mean()
    band_w = (p_high - p_low).mean()
    band_w_rel = ((p_high - p_low) / np.maximum(1e-3, p_med)).mean()
    return {
        'mae': float(np.mean(np.abs(p_med - y_true))),
        'mape': float(err.mean()),
        'medape': float(np.median(err)),
        'hit10': float((err <= 0.10).mean()),
        'hit15': float((err <= 0.15).mean()),
        'hit25': float((err <= 0.25).mean()),
        'hit50': float((err <= 0.50).mean()),
        'in_band_p10_p90': float(in_band),
        'band_width_byn': float(band_w),
        'band_width_rel': float(band_w_rel),
        'n': int(len(y_true)),
    }


def train_one(df, target, label):
    print(f'\n═══ Training CatBoost MultiQuantile for {label} (n={len(df)}) ═══')

    cat_features = ['hex_from', 'hex_to', 'demand']
    num_features = ['km', 'minutes', 'eta_excess', 'hour', 'dow', 'h3_dist',
                    'is_red', 'is_yellow', 'is_short',
                    'is_morn', 'is_eve', 'is_night', 'is_weekend',
                    'temp', 'rain_mm', 'wind', 'humidity']
    features = num_features + cat_features
    X = df[features].copy()
    for c in cat_features:
        X[c] = X[c].astype(str)
    y = df[target].values

    # 5-fold CV для honest out-of-sample
    kf = KFold(n_splits=5, shuffle=True, random_state=42)
    oof_low = np.zeros(len(df))
    oof_med = np.zeros(len(df))
    oof_high = np.zeros(len(df))

    for fold, (tr, te) in enumerate(kf.split(X)):
        m = CatBoostRegressor(
            loss_function='MultiQuantile:alpha=0.1,0.5,0.9',
            iterations=600,
            depth=6,
            learning_rate=0.05,
            l2_leaf_reg=3.0,
            cat_features=cat_features,
            random_seed=42 + fold,
            verbose=False,
        )
        m.fit(X.iloc[tr], y[tr], cat_features=cat_features)
        preds = m.predict(X.iloc[te])  # shape (n, 3)
        oof_low[te] = preds[:, 0]
        oof_med[te] = preds[:, 1]
        oof_high[te] = preds[:, 2]
        print(f'  fold {fold + 1}/5  n_train={len(tr)}  n_test={len(te)}')

    # apply floor
    floor = 5.0 if label == 'E' else 6.0
    oof_low = np.maximum(floor, oof_low)
    oof_med = np.maximum(floor, oof_med)
    oof_high = np.maximum(floor, oof_high)

    metrics = evaluate(y, oof_med, oof_low, oof_high, label)
    print(f'\n[CatBoost {label}] OOF (5-fold honest):')
    for k, v in metrics.items():
        if isinstance(v, float):
            print(f'    {k:18} {v * 100:.1f}%' if 'hit' in k or 'mape' in k or 'in_band' in k else f'    {k:18} {v:.3f}')
        else:
            print(f'    {k:18} {v}')

    # на финальной модели (full data) — те же квантили что и в OOF (где было OK)
    # alpha=0.05/0.95 на 1319 точках слишком экстремально → нестабильное упорядочивание.
    final = CatBoostRegressor(
        loss_function='MultiQuantile:alpha=0.1,0.5,0.9',
        iterations=600, depth=6, learning_rate=0.05, l2_leaf_reg=3.0,
        cat_features=cat_features, random_seed=42, verbose=False,
    )
    final.fit(X, y, cat_features=cat_features)
    importances = sorted(zip(features, final.get_feature_importance()), key=lambda x: -x[1])
    print(f'\n[CatBoost {label}] feature importance (top 10):')
    for name, imp in importances[:10]:
        print(f'    {name:18} {imp:6.2f}')

    # save .cbm
    model_dir = Path('/opt/rwbtaxi-newstat-ml/models')
    model_dir.mkdir(parents=True, exist_ok=True)
    cbm_path = model_dir / f'price_{label}_active.cbm'
    final.save_model(str(cbm_path))
    print(f'    ✓ saved → {cbm_path}')

    return {
        'metrics': metrics,
        'feature_importance': [{'name': n, 'imp': float(i)} for n, i in importances],
        'cbm_path': str(cbm_path),
        'features_num': num_features,
        'features_cat': cat_features,
    }


def main():
    print(f'Loading calibs from {CALIB_DIR}...')
    df, skipped = load_records()
    print(f'Loaded {len(df)} records (skipped: {dict(skipped)})')
    print(f'  unique hex_from: {df["hex_from"].nunique()}')
    print(f'  unique hex_to:   {df["hex_to"].nunique()}')
    print(f'  unique pairs:    {(df["hex_from"] + "→" + df["hex_to"]).nunique()}')

    resE = train_one(df, 'factE', 'E')
    resC = train_one(df, 'factC', 'C')

    OUT_FILE.write_text(json.dumps({
        'version': 'catboost-h3-multiquantile',
        'trained_at': datetime.utcnow().isoformat(),
        'n_total': len(df),
        'h3_resolution': H3_RES_FROM,
        'E': {k: v for k, v in resE.items() if k != 'oof_predictions'},
        'C': {k: v for k, v in resC.items() if k != 'oof_predictions'},
    }, indent=2))
    print(f'\n✓ saved → {OUT_FILE}')

    # Compare to v3 OLS baseline
    print('\n═══ COMPARISON: v3 OLS baseline vs CatBoost+H3 (Эконом) ═══')
    print(f'  metric          │  v3 OLS  │  CatBoost+H3  │  Δ')
    print(f'  ────────────────┼──────────┼───────────────┼──────')
    print(f'  MAPE (LOO/CV)   │  24.9%   │  {resE["metrics"]["mape"] * 100:5.1f}%        │  {(resE["metrics"]["mape"] * 100 - 24.9):+.2f} п.п.')
    print(f'  hit ±10%        │  27%     │  {resE["metrics"]["hit10"] * 100:.0f}%           │  {(resE["metrics"]["hit10"] * 100 - 27):+.0f} п.п.')
    print(f'  hit ±25%        │  60%     │  {resE["metrics"]["hit25"] * 100:.0f}%           │  {(resE["metrics"]["hit25"] * 100 - 60):+.0f} п.п.')
    print(f'  median APE      │  ~21%    │  {resE["metrics"]["medape"] * 100:5.1f}%        │  {(resE["metrics"]["medape"] * 100 - 21):+.2f} п.п.')
    print(f'  in P10..P90     │   —      │  {resE["metrics"]["in_band_p10_p90"] * 100:.0f}%           │  (target: 80%)')
    print(f'  band width      │   —      │  ±{resE["metrics"]["band_width_byn"] / 2:.2f} BYN     │  ({resE["metrics"]["band_width_rel"] * 100:.0f}% от цены)')


if __name__ == '__main__':
    main()
