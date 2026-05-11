#!/usr/bin/env node
// Авто-обучение тарифа Yandex Go в Минске из распознанных скринов.
// Запускается cron'ом / systemd-timer'ом на VPS, пишет:
//   $OUT_FILE                                  — live-снапшот для фронта
//   $ARCHIVE_DIR/tariff-breakdown-<ts>.json    — снапшот для истории
//   $ARCHIVE_DIR/diff-v<new>-v<old>.json       — изменения vs прошлой версии
//
// Без внешних зависимостей.

'use strict';
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';

const CALIB_DIR    = process.env.CALIB_DIR    || '/var/www/rwbtaxi/data/calib';
const PROCESSED_SCREENS_DIR = process.env.PROCESSED_SCREENS_DIR || '/var/www/rwbtaxi/data/screens/processed';

// id → расширение скрина (.png|.jpg|.jpeg|.webp). Один раз сканим папку
// processed/ при старте, потом O(1) lookup для каждого calib в liveHex.
function buildScreenshotExtIndex() {
  const idx = {};
  if (!existsSync(PROCESSED_SCREENS_DIR)) return idx;
  for (const f of readdirSync(PROCESSED_SCREENS_DIR)) {
    const mm = f.match(/^(calib-[0-9a-z-]+)\.(png|jpe?g|webp)$/i);
    if (mm) idx[mm[1]] = "." + mm[2].toLowerCase();
  }
  return idx;
}
const OUT_FILE     = process.env.OUT_FILE     || '/var/www/rwbtaxi/dist/public/data/tariff-breakdown.json';
const ARCHIVE_DIR  = process.env.ARCHIVE_DIR  || join(dirname(OUT_FILE), 'archive');

// «Городской dogleg»: реальная длина по дорогам ≈ 1.4 × прямая.
const DOGLEG         = Number(process.env.DOGLEG         || 1.4);
// Средняя скорость в Минске (по нашим замерам speedKmh ≈ 17–18).
const AVG_SPEED_KMH  = Number(process.env.AVG_SPEED_KMH  || 18);
const SHRINK_K       = Number(process.env.SHRINK_K       || 5);
const MIN_HEX_N      = Number(process.env.MIN_HEX_N      || 2);
const MIN_DISTRICT_N = Number(process.env.MIN_DISTRICT_N || 2);
// 0.01° по широте 53.9° ≈ 1.1 × 0.66 км. Для bayesian-shrinkage достаточно.
const HEX_GRID_DEG   = Number(process.env.HEX_GRID_DEG   || 0.01);
const TOP_DISTRICTS  = Number(process.env.TOP_DISTRICTS  || 30);
// Live-overlay: гекс показывает реальный сёрдж за последние LIVE_WINDOW_H
// часов поверх «исторической» зональной модели. 6ч = баланс между свежестью
// и плотностью (ночью у нас всего 5–10 скринов в час).
const LIVE_WINDOW_H  = Number(process.env.LIVE_WINDOW_H  || 6);
const LIVE_MIN_N     = Number(process.env.LIVE_MIN_N     || 2);
// Yandex-trend: тот же фильтр что в AdminCalibComparison.computeYandexTrend —
// один outlier ratio=6.94 при n=50 поднимал «+11%» из шума.
const TREND_WINDOW_H = Number(process.env.TREND_WINDOW_H || 24);
const TREND_RATIO_LO = 0.5;
const TREND_RATIO_HI = 2.0;

// ─── утилиты ────────────────────────────────────────────────────────
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// Bayesian-shrinkage медианы к нейтральному прайор'у 1.0:
// при малом n тянет групповой множитель к глобальному, при большом — доверяет данным.
function shrunken(arr, k = SHRINK_K, prior = 1.0) {
  const n = arr.length;
  if (!n) return prior;
  return (n * median(arr) + k * prior) / (n + k);
}
// 1-факторная OLS: y = a + b*x.
function ols1(xs, ys) {
  const n = xs.length;
  if (!n) return { a: 0, b: 0, r2: 0, mape: 0, n: 0 };
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const b = den > 0 ? num / den : 0;
  const a = meanY - b * meanX;
  const tss = ys.reduce((s, v) => s + (v - meanY) ** 2, 0);
  let rss = 0, mapeSum = 0, mapeN = 0;
  for (let i = 0; i < n; i++) {
    const pred = a + b * xs[i];
    rss += (ys[i] - pred) ** 2;
    if (ys[i] > 0) {
      mapeSum += Math.abs((ys[i] - pred) / ys[i]);
      mapeN++;
    }
  }
  return {
    a, b,
    r2: tss > 0 ? Math.max(0, 1 - rss / tss) : 0,
    mape: mapeN > 0 ? mapeSum / mapeN : 0,
    n,
  };
}
// 2-факторная OLS: y = a + b*x1 + c*x2.  // HYBRID_BASELINE_v2
function ols2(xs1, xs2, ys) {
  const n = xs1.length;
  if (!n) return { a: 0, b: 0, c: 0, r2: 0, mape: 0, n: 0 };
  let sy=0,sx1=0,sx2=0,sx1x1=0,sx2x2=0,sx1x2=0,sx1y=0,sx2y=0;
  for (let i=0;i<n;i++) {
    const y=ys[i],x1=xs1[i],x2=xs2[i];
    sy+=y; sx1+=x1; sx2+=x2;
    sx1x1+=x1*x1; sx2x2+=x2*x2; sx1x2+=x1*x2;
    sx1y+=x1*y; sx2y+=x2*y;
  }
  const M=[[n,sx1,sx2],[sx1,sx1x1,sx1x2],[sx2,sx1x2,sx2x2]];
  const v=[sy,sx1y,sx2y];
  const det3=(m)=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  const D=det3(M);
  if (Math.abs(D) < 1e-6) return { a: 0, b: 0, c: 0, r2: 0, mape: 0, n, singular: true };
  const sub=(col)=>{const mm=M.map(r=>r.slice());for(let i=0;i<3;i++)mm[i][col]=v[i];return mm;};
  const a=det3(sub(0))/D, b=det3(sub(1))/D, c=det3(sub(2))/D;
  const meanY=sy/n;
  let tss=0,rss=0,mapeSum=0,mapeN=0;
  for (let i=0;i<n;i++) {
    const y=ys[i], pred=a+b*xs1[i]+c*xs2[i];
    tss+=(y-meanY)*(y-meanY); rss+=(y-pred)*(y-pred);
    if (y>0) { mapeSum+=Math.abs((y-pred)/y); mapeN++; }
  }
  return { a, b, c, r2: tss>0 ? Math.max(0,1-rss/tss) : 0, mape: mapeN>0 ? mapeSum/mapeN : 0, n };
}

const r2 = (d) => Number(d.toFixed(2));
const r3 = (d) => Number(d.toFixed(3));
const r4 = (d) => Number(d.toFixed(4));
function pct(a, b) {
  if (!b) return '';
  const p = ((a - b) / b) * 100;
  return (p >= 0 ? '+' : '') + p.toFixed(1) + '%';
}

// ─── чтение и обогащение скринов ────────────────────────────────────
function readAllCalibs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith('calib-') && f.endsWith('.json'))
    .map((f) => {
      try {
        return { ...JSON.parse(readFileSync(join(dir, f), 'utf8')), _file: f };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
// В calib JSON нет tripMin/tripKm — приближаем через haversine × dogleg / avg-speed.
function enrich(c) {
  const fromLat = Number(c.fromLat), fromLng = Number(c.fromLng);
  const toLat   = Number(c.toLat),   toLng   = Number(c.toLng);
  if (!fromLat || !fromLng || !toLat || !toLng) return null;
  const haversine = haversineKm({ lat: fromLat, lon: fromLng }, { lat: toLat, lon: toLng });
  if (haversine < 0.3) return null;       // отсев кривых GPS-точек
  const tripKm = haversine * DOGLEG;
  // HYBRID_BASELINE_v2: если в скрине Yandex есть реальный ETA (tripMin/etaMin) —
  // используем его, чтобы tripMin и tripKm НЕ были линейно зависимы.
  // Иначе fallback на приближение через AVG_SPEED_KMH (даёт коллинеарность).
  const realMin = Number(c.tripMin) || Number(c.etaMin);
  const tripMin = (realMin && realMin > 0 && realMin < 180)
    ? realMin
    : (tripKm / AVG_SPEED_KMH) * 60;
  const factE = Number(c.factE);
  const factC = Number(c.factC);
  return {
    ...c,
    fromLat, fromLng, toLat, toLng,
    haversine, tripKm, tripMin,
    factE: factE > 0 ? factE : null,
    factC: factC > 0 ? factC : null,
    hour: Number.isInteger(c.hour) ? c.hour : null,
    demand: (c.demand || '').toLowerCase(),
    fromStreet: (c.fromAddress || '').split(',')[0].trim(),
    // receivedAt | createdAt | updatedAt | mtime — нужно для recency-фильтра.
    tsMs: (() => {
      for (const k of ['receivedAt', 'createdAt', 'updatedAt', 'savedAt', 'capturedAt']) {
        const v = c[k];
        if (typeof v === 'string') {
          const t = Date.parse(v);
          if (!isNaN(t)) return t;
        } else if (typeof v === 'number' && v > 1e12) {
          return v;
        }
      }
      // Fallback: парсим из имени файла calib-2026-04-30-h00-xxxx.json
      const m = (c._file || '').match(/calib-(\d{4})-(\d{2})-(\d{2})-h(\d{2})/);
      if (m) {
        return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], 30) - 3 * 3600 * 1000; // Минск UTC+3
      }
      return 0;
    })(),
  };
}

// ─── главная сборка ─────────────────────────────────────────────────
function build() {
  const all = readAllCalibs(CALIB_DIR);
  const enriched = all.map(enrich).filter((c) => c && (c.factE || c.factC));
  const yellow = enriched.filter((c) => c.demand === 'yellow' || !c.demand);
  const red    = enriched.filter((c) => c.demand === 'red');
  const green  = enriched.filter((c) => c.demand === 'green');

  // 1) Honest 1-факторная регрессия на yellow: fact = base + perMin × tripMin.
  const econ = ols1(
    yellow.filter((c) => c.factE).map((c) => c.tripMin),
    yellow.filter((c) => c.factE).map((c) => c.factE),
  );
  const cmf = ols1(
    yellow.filter((c) => c.factC).map((c) => c.tripMin),
    yellow.filter((c) => c.factC).map((c) => c.factC),
  );

  // Гибрид: factE = base + perMin*tripMin + perKm*tripKm.  // HYBRID_BASELINE_v2
  // С реальным tripMin (см. enrich) tripMin/tripKm независимы → OLS-2 устойчива.
  // С защитой от вырождения: если det≈0 → falls back to ols1 (singular flag).
  let econHy = ols2(
    yellow.filter((c) => c.factE).map((c) => c.tripMin),
    yellow.filter((c) => c.factE).map((c) => c.tripKm),
    yellow.filter((c) => c.factE).map((c) => c.factE),
  );
  let cmfHy = ols2(
    yellow.filter((c) => c.factC).map((c) => c.tripMin),
    yellow.filter((c) => c.factC).map((c) => c.tripKm),
    yellow.filter((c) => c.factC).map((c) => c.factC),
  );
  // Sanity-check: если коэф < 0 (физически бессмысленно) — откат к 1-факторной.
  if (econHy.singular || econHy.b < 0 || econHy.c < 0) econHy = { a: econ.a, b: econ.b, c: 0, r2: econ.r2, mape: econ.mape, n: econ.n, fallback: true };
  if (cmfHy.singular  || cmfHy.b  < 0 || cmfHy.c  < 0) cmfHy  = { a: cmf.a,  b: cmf.b,  c: 0, r2: cmf.r2,  mape: cmf.mape,  n: cmf.n,  fallback: true };

  // 2) perKm fallback (если время неизвестно).
  const econKm = ols1(
    yellow.filter((c) => c.factE).map((c) => c.tripKm),
    yellow.filter((c) => c.factE).map((c) => c.factE),
  );
  const cmfKm = ols1(
    yellow.filter((c) => c.factC).map((c) => c.tripKm),
    yellow.filter((c) => c.factC).map((c) => c.factC),
  );

  // 3) Удельные ставки yellow vs red.
  function avgRates(group) {
    const eM = [], eK = [], cM = [], cK = [], spd = [];
    for (const c of group) {
      if (c.factE && c.tripMin > 0) eM.push(c.factE / c.tripMin);
      if (c.factE && c.tripKm > 0) eK.push(c.factE / c.tripKm);
      if (c.factC && c.tripMin > 0) cM.push(c.factC / c.tripMin);
      if (c.factC && c.tripKm > 0) cK.push(c.factC / c.tripKm);
      if (c.tripKm && c.tripMin > 0) spd.push((c.tripKm / c.tripMin) * 60);
    }
    return {
      econom:  { perMin: r2(median(eM)), perKm: r2(median(eK)), n: eM.length },
      comfort: { perMin: r2(median(cM)), perKm: r2(median(cK)), n: cM.length },
      speedKmh: r2(median(spd)),
    };
  }

  // 4) Сёрдж-факторы скрина — отдельно для Эконома и Комфорта.
  function ratios(c) {            // HYBRID_BASELINE_v2
    // Прогноз = гибрид (base + perMin*мин + perKm*км). Сёрдж = fact/pred.
    let E = null, C = null;
    if (c.factE) {
      const pred = econHy.a + econHy.b * c.tripMin + econHy.c * c.tripKm;
      if (pred > 0) E = c.factE / pred;
    }
    if (c.factC) {
      const pred = cmfHy.a + cmfHy.b * c.tripMin + cmfHy.c * c.tripKm;
      if (pred > 0) C = c.factC / pred;
    }
    const both = (E != null && C != null) ? (E + C) / 2 : (E ?? C);
    return { E, C, both };
  }

  // 5) byHour: per-class + смешанный.
  const hE = Array.from({ length: 24 }, () => []);
  const hC = Array.from({ length: 24 }, () => []);
  const hBoth = Array.from({ length: 24 }, () => []);
  for (const c of yellow) {
    if (c.hour === null) continue;
    const r = ratios(c);
    if (r.E != null) hE[c.hour].push(r.E);
    if (r.C != null) hC[c.hour].push(r.C);
    if (r.both != null) hBoth[c.hour].push(r.both);
  }
  const byHour = hBoth.map((arr, h) => ({
    hour: h,
    n: arr.length,
    nE: hE[h].length,
    nC: hC[h].length,
    median: r3(median(arr)),
    shrunken: r3(shrunken(arr)),
    surgeE: r3(shrunken(hE[h])),
    surgeC: r3(shrunken(hC[h])),
  }));

  // 6) byHex (1km grid c bayesian-shrinkage). Per-hex смешанный сёрдж.
  const hexKey = (lat, lon) =>
    `${Math.round(lat / HEX_GRID_DEG)}:${Math.round(lon / HEX_GRID_DEG)}`;
  const hexCenter = (key) => {
    const [a, b] = key.split(':').map(Number);
    return { lat: a * HEX_GRID_DEG, lon: b * HEX_GRID_DEG };
  };
  const hexBuckets = {};
  for (const c of yellow) {
    const r = ratios(c);
    if (r.both == null) continue;
    const k = hexKey(c.fromLat, c.fromLng);
    (hexBuckets[k] ||= []).push({ both: r.both, E: r.E, C: r.C, hour: c.hour });
  }
  const byHex = {};
  for (const [k, arr] of Object.entries(hexBuckets)) {
    if (arr.length < MIN_HEX_N) continue;
    const ctr = hexCenter(k);
    const both = arr.map((x) => x.both);
    const E = arr.map((x) => x.E).filter((v) => v != null);
    const C = arr.map((x) => x.C).filter((v) => v != null);
    const hours = arr.map((x) => x.hour).filter((h) => h !== null);
    byHex[k] = {
      lat: r4(ctr.lat),
      lon: r4(ctr.lon),
      n: arr.length,
      median: r3(median(both)),
      shrunken: r3(shrunken(both)),
      surgeE: r3(shrunken(E)),
      surgeC: r3(shrunken(C)),
      avgHour: hours.length ? Math.round(hours.reduce((s, h) => s + h, 0) / hours.length) : null,
    };
  }

  // 7) byDistrict: per-class + смешанный, по `fromAddress` до запятой.
  const dB = {};   // street → { both: [], E: [], C: [], hours: [] }
  for (const c of yellow) {
    if (!c.fromStreet) continue;
    const r = ratios(c);
    if (r.both == null) continue;
    const k = c.fromStreet;
    (dB[k] ||= { both: [], E: [], C: [], hours: [] });
    dB[k].both.push(r.both);
    if (r.E != null) dB[k].E.push(r.E);
    if (r.C != null) dB[k].C.push(r.C);
    if (c.hour !== null) dB[k].hours.push(c.hour);
  }
  const byDistrict = Object.entries(dB)
    .filter(([_, v]) => v.both.length >= MIN_DISTRICT_N)
    .map(([name, v]) => ({
      name,
      street: name,                                  // alias для совместимости
      n: v.both.length,
      nE: v.E.length,
      nC: v.C.length,
      median: r3(median(v.both)),
      shrunken: r3(shrunken(v.both)),
      surgeE: r3(shrunken(v.E)),
      surgeC: r3(shrunken(v.C)),
      avgHour: v.hours.length ? Math.round(v.hours.reduce((s, h) => s + h, 0) / v.hours.length) : null,
    }))
    .sort((a, b) => Math.abs(b.shrunken - 1) - Math.abs(a.shrunken - 1))
    .slice(0, TOP_DISTRICTS);

  // 8) demandColor multipliers — per-color × per-class.
  function colorMult(group) {
    const E = [], C = [], both = [];
    for (const c of group) {
      const r = ratios(c);
      if (r.E != null) E.push(r.E);
      if (r.C != null) C.push(r.C);
      if (r.both != null) both.push(r.both);
    }
    return {
      n: both.length,
      multiplier: r3(median(both) || 1),
      econom:  r3(shrunken(E)),
      comfort: r3(shrunken(C)),
    };
  }
  const dmYellow = colorMult(yellow);
  const dmRed    = colorMult(red);
  const dmGreen  = colorMult(green);

  // 9a) yandexTrend24h — насколько Yandex отошёл от долгосрочного baseline
  // за последние 24 часа. Применяется глобально к зональной модели карты.
  const nowMs = Date.now();
  const trendCutoff = nowMs - TREND_WINDOW_H * 3600 * 1000;
  const trendE = [], trendC = [];
  for (const c of enriched) {
    if (!c.tsMs || c.tsMs < trendCutoff) continue;
    const r = ratios(c);
    if (r.E != null && r.E >= TREND_RATIO_LO && r.E <= TREND_RATIO_HI) trendE.push(r.E);
    if (r.C != null && r.C >= TREND_RATIO_LO && r.C <= TREND_RATIO_HI) trendC.push(r.C);
  }
  const mE = trendE.length ? median(trendE) : 1;
  const mC = trendC.length ? median(trendC) : 1;
  // Shrinkage к 1.0 при малой выборке (k=10 как в AdminCalibComparison).
  const shrinkTrend = (m, n) => (n > 0 ? (n * m + 10 * 1.0) / (n + 10) : 1);
  const multiplierE = shrinkTrend(mE, trendE.length);
  const multiplierC = shrinkTrend(mC, trendC.length);
  const yandexTrend24h = {
    windowHours: TREND_WINDOW_H,
    nE: trendE.length,
    nC: trendC.length,
    shiftE: r3(multiplierE - 1),
    shiftC: r3(multiplierC - 1),
    multiplierE: r3(multiplierE),
    multiplierC: r3(multiplierC),
    multiplier: r3((multiplierE + multiplierC) / 2),
  };

  // 9b) liveHex — гексы с реальными скринами младше LIVE_WINDOW_H часов.
  // Ключ совпадает с byHex (та же 0.01° сетка), но фильтр по recency.
  // CALIBS_24H_PATCH_v1
  // liveBuckets — за окно сёрджа (6ч): из них считаем surgeE/surgeC/n.
  // calibBuckets — за расширенное окно (24ч): из них берём список скринов
  // для перепроверки в попапе. Это намного больше истории — водитель
  // открывает соту и видит ~20-30 свежих скринов за сутки, а не только
  // 8 за последние 6 часов.
  const liveCutoff = nowMs - LIVE_WINDOW_H * 3600 * 1000;
  const calibCutoff = nowMs - 24 * 3600 * 1000;
  const liveBuckets = {};
  const calibBuckets = {};
  for (const c of yellow.concat(red)) {
    if (!c.tsMs || c.tsMs < calibCutoff) continue;
    const k = hexKey(c.fromLat, c.fromLng);
    // Calib-список для попапа — все валидные за 24ч (даже если цена не
    // распозналась полностью; главное чтобы скрин и адрес были).
    (calibBuckets[k] ||= []).push({
      tsMs: c.tsMs,
      id: (c._file || "").replace(/\.json$/, ""),
      factE: c.factE, factC: c.factC,
      fromAddr: c.fromStreet || c.fromAddress || "",
      matched: c.matchedRecommendation || null, // // MATCHED_PASSTHROUGH_v1
    });
    // Сёрдж — только за 6ч и только с валидным ratios.both.
    if (c.tsMs < liveCutoff) continue;
    const r = ratios(c);
    if (r.both == null) continue;
    (liveBuckets[k] ||= []).push({ both: r.both, E: r.E, C: r.C, tsMs: c.tsMs });
  }
  const liveHex = {};
  const screenExtIdx = buildScreenshotExtIndex();
  for (const [k, arr] of Object.entries(liveBuckets)) {
    if (arr.length < LIVE_MIN_N) continue;
    const ctr = hexCenter(k);
    const both = arr.map((x) => x.both);
    const E = arr.map((x) => x.E).filter((v) => v != null);
    const C = arr.map((x) => x.C).filter((v) => v != null);
    const ages = arr.map((x) => Math.round((nowMs - x.tsMs) / 60000)); // в минутах
    liveHex[k] = {
      lat: r4(ctr.lat),
      lon: r4(ctr.lon),
      n: arr.length,
      nE: E.length,
      nC: C.length,
      median: r3(median(both)),
      shrunken: r3(shrunken(both, 3)), // меньший k для live — данные свежее
      surgeE: r3(shrunken(E, 3)),
      surgeC: r3(shrunken(C, 3)),
      ageMinM: Math.min(...ages),
      ageMaxM: Math.max(...ages),
      // calibs — до 30 свежих скринов из этой соты за 24ч (для перепроверки).
      // Берём из calibBuckets (24ч), а не arr (6ч) — больше истории.
      // Без расширения файла на диске (скрин удалён) — пропускаем.
      calibs: (calibBuckets[k] || [])
        .filter((x) => x.id && screenExtIdx[x.id])
        .sort((a, b) => b.tsMs - a.tsMs)
        .slice(0, 30)
        .map((x) => ({
          id: x.id,
          ext: screenExtIdx[x.id],
          tsMs: x.tsMs,
          ...(x.factE != null ? { priceE: Number(x.factE.toFixed(2)) } : {}),
          ...(x.factC != null ? { priceC: Number(x.factC.toFixed(2)) } : {}),
          ...(x.fromAddr ? { fromAddr: x.fromAddr } : {}),
          // Совпадение скрина с рекомендацией, которую таксист тапнул
          // в нашем приложении за 1-3 мин до загрузки. Если есть —
          // фронт рисует значок 🎯 и показывает «ожидалось А → Б».
          ...(x.matched ? { matched: {
            confidence: x.matched.confidence,
            deltaSec: Math.round(x.matched.deltaMs / 1000),
            fromName: x.matched.expectedFromName,
            toName: x.matched.expectedToName,
            fromDistM: x.matched.fromDistanceM,
            toDistM: x.matched.toDistanceM,
          } } : {}),
        })),
    };
  }

  // 9) Diff vs предыдущей версии.
  let prevVersion = 0, prev = null;
  try {
    if (existsSync(OUT_FILE)) {
      prev = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
      prevVersion = Number(prev.version) || 0;
    }
  } catch {}

  const result = {
    "$comment": "Анализ тарифа Yandex Go в Минске. Автообучение из реальных скринов. Генерируется vps/wb-server/build-tariff-breakdown.mjs.",
    version: prevVersion + 1,
    generatedAt: new Date().toISOString(),
    basedOn: {
      totalCalibs: all.length,
      usable: enriched.length,
      yellow: yellow.length,
      red: red.length,
      green: green.length,
    },
    config: {
      dogleg: DOGLEG,
      avgSpeedKmh: AVG_SPEED_KMH,
      shrinkK: SHRINK_K,
      hexGridDeg: HEX_GRID_DEG,
    },
    baseline: {              // HYBRID_BASELINE_v2
      econom:  { base: r2(econHy.a), perMin: r3(econHy.b), perKm: r3(econHy.c), r2: r3(econHy.r2), mape: r3(econHy.mape), n: econHy.n, fallback: !!econHy.fallback },
      comfort: { base: r2(cmfHy.a),  perMin: r3(cmfHy.b),  perKm: r3(cmfHy.c),  r2: r3(cmfHy.r2),  mape: r3(cmfHy.mape),  n: cmfHy.n,  fallback: !!cmfHy.fallback },
    },
    baselinePerMinOnly: {
      econom:  { base: r2(econ.a), perMin: r3(econ.b), r2: r3(econ.r2), mape: r3(econ.mape), n: econ.n },
      comfort: { base: r2(cmf.a),  perMin: r3(cmf.b),  r2: r3(cmf.r2),  mape: r3(cmf.mape),  n: cmf.n  },
    },
    perKmFallback: {
      econom:  { base: r2(econKm.a), perKm: r3(econKm.b), r2: r3(econKm.r2), mape: r3(econKm.mape) },
      comfort: { base: r2(cmfKm.a),  perKm: r3(cmfKm.b),  r2: r3(cmfKm.r2),  mape: r3(cmfKm.mape) },
    },
    averageRates: { yellow: avgRates(yellow), red: avgRates(red) },
    byHour,
    byDistrict,
    byHex,
    yandexTrend24h,
    liveHex,
    liveWindowHours: LIVE_WINDOW_H,
    demandColor: { yellow: dmYellow, red: dmRed, green: dmGreen },
    // Backward-compat alias для UI: { red: { econom, comfort }, yellow: { econom, comfort } }
    demandMultiplier: {
      yellow: { econom: dmYellow.econom, comfort: dmYellow.comfort },
      red:    { econom: dmRed.econom,    comfort: dmRed.comfort },
    },
    // Каноничное поле для UI (формат: tariff.demand[zone].E/C).  // HYBRID_BASELINE_v2
    demand: {
      yellow: { E: dmYellow.econom, C: dmYellow.comfort, n: dmYellow.n },
      red:    { E: dmRed.econom,    C: dmRed.comfort,    n: dmRed.n    },
      green:  { E: dmGreen.econom,  C: dmGreen.comfort,  n: dmGreen.n  },
    },
  };

  let diff = null;
  if (prev) {
    const lines = [];
    for (const cls of ['econom', 'comfort']) {
      const o = prev.baseline?.[cls], n = result.baseline[cls];
      if (!o || !n) continue;
      if (Math.abs(n.base - o.base) >= 0.05)
        lines.push(`${cls}.base: ${o.base.toFixed(2)} → ${n.base.toFixed(2)} (${pct(n.base, o.base)})`);
      if (Math.abs(n.perMin - o.perMin) >= 0.02)
        lines.push(`${cls}.perMin: ${o.perMin.toFixed(3)} → ${n.perMin.toFixed(3)} (${pct(n.perMin, o.perMin)})`);
    }
    if (Array.isArray(prev.byHour)) {
      for (let h = 0; h < 24; h++) {
        const o = prev.byHour[h], n = result.byHour[h];
        if (!o || !n || o.n < 2 || n.n < 2) continue;
        if (Math.abs(n.shrunken - o.shrunken) >= 0.05)
          lines.push(`hour ${String(h).padStart(2, '0')}: ×${o.shrunken.toFixed(2)} → ×${n.shrunken.toFixed(2)} (${pct(n.shrunken, o.shrunken)}, n=${o.n}→${n.n})`);
      }
    }
    diff = {
      fromVersion: prevVersion,
      toVersion: result.version,
      basedOnDelta: {
        yellow: result.basedOn.yellow - (prev.basedOn?.yellow ?? 0),
        red: result.basedOn.red - (prev.basedOn?.red ?? 0),
      },
      summary: lines.length ? `${lines.length} change(s)` : 'no significant changes',
      changes: lines,
    };
  }

  // 10) Атомарная запись + архив + diff.
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  mkdirSync(ARCHIVE_DIR, { recursive: true });

  const tmp = OUT_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(result, null, 2));
  renameSync(tmp, OUT_FILE);

  const tsTag = result.generatedAt.replace(/[:.]/g, '-').replace(/Z$/, '');
  writeFileSync(join(ARCHIVE_DIR, `tariff-breakdown-${tsTag}.json`), JSON.stringify(result, null, 2));
  if (diff) {
    writeFileSync(join(ARCHIVE_DIR, `diff-v${result.version}-v${prevVersion}.json`), JSON.stringify(diff, null, 2));
  }

  console.log(`✅ ${OUT_FILE}`);
  console.log(`   v${result.version} · ${all.length} calibs → ${enriched.length} usable (${yellow.length} yellow + ${red.length} red + ${green.length} green)`);
  console.log(`   Эконом:   ${result.baseline.econom.base.toFixed(2)} + ${result.baseline.econom.perMin.toFixed(3)}·мин   R²=${result.baseline.econom.r2.toFixed(2)}  MAPE=${(result.baseline.econom.mape * 100).toFixed(1)}%   n=${result.baseline.econom.n}`);
  console.log(`   Комфорт:  ${result.baseline.comfort.base.toFixed(2)} + ${result.baseline.comfort.perMin.toFixed(3)}·мин   R²=${result.baseline.comfort.r2.toFixed(2)}  MAPE=${(result.baseline.comfort.mape * 100).toFixed(1)}%   n=${result.baseline.comfort.n}`);
  console.log(`   byHour:   ${byHour.filter((h) => h.n > 0).length}/24 hours with data`);
  console.log(`   byHex:    ${Object.keys(byHex).length} cells (≥${MIN_HEX_N} samples)`);
  console.log(`   byDistrict: top ${byDistrict.length} of ${Object.keys(dB).length}`);
  console.log(`   demand:   yellow×${dmYellow.multiplier} (E×${dmYellow.econom}, C×${dmYellow.comfort}, n=${dmYellow.n}), red×${dmRed.multiplier} (E×${dmRed.econom}, C×${dmRed.comfort}, n=${dmRed.n})`);
  console.log(`   yandex24h: E×${yandexTrend24h.multiplierE} (${yandexTrend24h.shiftE >= 0 ? '+' : ''}${(yandexTrend24h.shiftE * 100).toFixed(1)}%, n=${yandexTrend24h.nE}), C×${yandexTrend24h.multiplierC} (${yandexTrend24h.shiftC >= 0 ? '+' : ''}${(yandexTrend24h.shiftC * 100).toFixed(1)}%, n=${yandexTrend24h.nC})`);
  console.log(`   liveHex:  ${Object.keys(liveHex).length} cells (last ${LIVE_WINDOW_H}h, ≥${LIVE_MIN_N} samples)`);
  if (diff) {
    console.log(`   diff:     ${diff.summary}`);
    if (diff.changes.length) console.log('   ' + diff.changes.join('\n   '));
  }
}

build();
