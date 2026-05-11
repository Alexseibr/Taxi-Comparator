#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LEARNED = join(ROOT, "scripts/learned");
mkdirSync(LEARNED, { recursive: true });

const SCREENS = process.env.SCREENS_DIR || "/tmp/rwb-export/screens";

const CMF_MIN = 9.86;
const ECO_MIN = 9.39;
const MINSK_CENTER = [53.9006, 27.5660];

function haversine(a, b) {
  const R = 6371, toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a[0]))*Math.cos(toRad(b[0]))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function centDist(lat, lng) {
  return haversine([lat, lng], MINSK_CENTER);
}
function dayOf(d) { const k = new Date(d).getDay(); return k===0?"sunday":k===6?"saturday":"weekday"; }
function hourOf(d) { return new Date(d).getHours(); }
function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:0;}
function median(a){if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;}

// Generic least squares (Gauss-Jordan)
function lstsqN(X, y) {
  const n = X.length; if (!n) return null;
  const k = X[0].length; if (n < k) return null;
  const A = Array.from({length:k}, () => new Array(k+1).fill(0));
  for (let i=0;i<n;i++) for (let r=0;r<k;r++) { A[r][k] += X[i][r]*y[i]; for (let c=0;c<k;c++) A[r][c] += X[i][r]*X[i][c]; }
  for (let col=0;col<k;col++) {
    let piv = col;
    for (let r=col+1;r<k;r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    if (piv !== col) [A[col],A[piv]] = [A[piv],A[col]];
    const inv = 1/A[col][col];
    for (let c=col;c<=k;c++) A[col][c] *= inv;
    for (let r=0;r<k;r++) { if (r===col) continue; const f = A[r][col]; if (!f) continue; for (let c=col;c<=k;c++) A[r][c] -= f*A[col][c]; }
  }
  return A.map(row => row[k]);
}

// Existing v3 distMul (как в zones.ts)
function distMulV3(km) {
  if (!isFinite(km) || km <= 0) return 1.0;
  if (km < 1.5)  return 1.00;
  if (km < 2.5)  return 0.68;
  if (km < 4.0)  return 0.77;
  if (km < 6.0)  return 0.95;
  if (km < 9.0)  return 1.28;
  if (km < 13.0) return 1.67;
  if (km < 20.0) return 1.76;
  return 1.93;
}

// --- сбор dataset из VPS-скринов ---
const files = readdirSync(SCREENS).filter(f => f.endsWith(".raw.json"));
console.log(`Скринов на диске: ${files.length}`);
const dataset = [];
const skipped = { noTariff: 0, noGeo: 0, noTripMin: 0, noPrice: 0 };
for (const f of files) {
  const raw = JSON.parse(readFileSync(join(SCREENS, f), "utf8"));
  const metaPath = join(SCREENS, f.replace(".raw.json", ".meta.json"));
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
  const p = raw.parsed || {};
  if (!Array.isArray(p.tariffs)) { skipped.noTariff++; continue; }
  // Yandex Go может писать "Комфорт", "Comfort", иногда "Комфорт " с пробелом.
  // Берём ТОЧНО "Комфорт" (без +), и не "Комфорт+", "Бизнес-Комфорт".
  const cmf = p.tariffs.find(t => {
    const n = String(t.name || "").trim().toLowerCase();
    return n === "комфорт" || n === "comfort";
  });
  const eco = p.tariffs.find(t => {
    const n = String(t.name || "").trim().toLowerCase();
    return n === "эконом" || n === "econom" || n === "economy";
  });
  if (!cmf?.priceBYN) { skipped.noPrice++; continue; }
  const geo = raw.geocode || {};
  if (!geo.from?.lat || !geo.to?.lat) { skipped.noGeo++; continue; }
  const km = haversine([geo.from.lat, geo.from.lng], [geo.to.lat, geo.to.lng]);
  const tripMin = cmf.tripMin ?? eco?.tripMin ?? p.tripMinToDest;
  if (!tripMin) { skipped.noTripMin++; continue; }
  // Час берём приоритетно из имени файла: calib-2026-04-29-h09-... → 9.
  // meta.uploadedAt — UTC, а Минск UTC+3, поэтому ночные h00..h02 после
  // конверсии могут уйти в предыдущие сутки. Имя файла уже в локальном времени.
  let hour = NaN, day = "weekday", ts = meta.uploadedAt || raw.reparsedAt;
  const mFn = /-h(\d{2})-/.exec(f);
  if (mFn) hour = parseInt(mFn[1], 10);
  const mDate = /(\d{4})-(\d{2})-(\d{2})-h(\d{2})/.exec(f);
  if (mDate) {
    const [, y, mo, d, h] = mDate;
    const local = new Date(`${y}-${mo}-${d}T${h}:00:00+03:00`);
    if (!isNaN(local.getTime())) {
      day = dayOf(local);
      if (isNaN(hour)) hour = parseInt(h, 10);
    }
  }
  if (isNaN(hour) && ts) hour = hourOf(ts);
  if (day === "weekday" && ts) day = dayOf(ts);
  if (isNaN(hour)) { hour = 12; }
  const factC = cmf.priceBYN;
  const factE = eco?.priceBYN ?? null;
  const yaC = factC / CMF_MIN;
  const yaE = factE != null ? factE / ECO_MIN : null;
  const fromLat = geo.from.lat, fromLng = geo.from.lng;
  const toLat = geo.to.lat, toLng = geo.to.lng;
  dataset.push({
    id: f.replace(".jpg.raw.json","").replace(".png.raw.json","").replace(".raw.json",""),
    ts, day, hour, km: +km.toFixed(3), tripMin,
    factC, factE, yaC, yaE,
    fromAddr: p.fromAddress, toAddr: p.toAddress,
    fromLat, fromLng, toLat, toLng,
    cd: +centDist(fromLat, fromLng).toFixed(3),
    dcd: +centDist(toLat, toLng).toFixed(3),
  });
}
console.log(`Принято в dataset: ${dataset.length}, пропущено: noTariff=${skipped.noTariff}, noPrice=${skipped.noPrice}, noGeo=${skipped.noGeo}, noTripMin=${skipped.noTripMin}`);

// --- helpers ---
function evalModel(name, predFn) {
  const errs = [], absErrs = [];
  for (const o of dataset) {
    const p = predFn(o);
    const err = (o.yaC - p) / o.yaC;
    errs.push(err);
    absErrs.push(Math.abs(err));
  }
  const mape = mean(absErrs) * 100;
  const mae = mean(dataset.map((o,i) => Math.abs(o.yaC - predFn(o))));
  console.log(`  [${name}] MAPE=${mape.toFixed(1)}%  MAE_surge=${mae.toFixed(3)}  bias=${(mean(errs)*100).toFixed(2)}%`);
  return { mape, mae, bias: mean(errs)*100 };
}

console.log("\n=== БАЗОВАЯ ПРОВЕРКА: что предсказывает v3 (только distMul по km) ===");
// surgeAt полагаем = 1.0 (мы не моделируем zone-baseline здесь — это
// делает frontend через ZONES). Сравниваем чистый эффект distMul.
const M0 = evalModel("v3 distMul-only", o => distMulV3(o.km));

console.log("\n=== M1: линейная регрессия yaC = a + b·km ===");
const X1 = dataset.map(o => [1, o.km]);
const y = dataset.map(o => o.yaC);
const b1 = lstsqN(X1, y);
console.log(`  yaC ≈ ${b1[0].toFixed(3)} + ${b1[1].toFixed(4)}·km`);
const M1 = evalModel("M1 a+b·km", o => b1[0] + b1[1]*o.km);

console.log("\n=== M2: yaC = a + b·km + c·tripMin (Yandex время в пути) ===");
const X2 = dataset.map(o => [1, o.km, o.tripMin]);
const b2 = lstsqN(X2, y);
console.log(`  yaC ≈ ${b2[0].toFixed(3)} + ${b2[1].toFixed(4)}·km + ${b2[2].toFixed(4)}·tripMin`);
const M2 = evalModel("M2 a+b·km+c·tripMin", o => b2[0] + b2[1]*o.km + b2[2]*o.tripMin);

console.log("\n=== M3: + час (sin/cos), центральная дистанция, outbound ===");
const X3 = dataset.map(o => [
  1, o.km, o.tripMin,
  Math.sin(o.hour * Math.PI / 12),
  Math.cos(o.hour * Math.PI / 12),
  o.cd,
  Math.max(0, o.dcd - o.cd),
]);
const b3 = lstsqN(X3, y);
const lbls3 = ["intercept","km","tripMin","sin(h)","cos(h)","centDist","outbound"];
console.log("  " + lbls3.map((l,i)=>`${l}=${b3[i].toFixed(4)}`).join("  "));
const M3 = evalModel("M3 +час+район+outbound", o => {
  const x = [1, o.km, o.tripMin, Math.sin(o.hour*Math.PI/12), Math.cos(o.hour*Math.PI/12), o.cd, Math.max(0, o.dcd - o.cd)];
  return x.reduce((s,xi,i) => s + xi*b3[i], 0);
});

console.log("\n=== M4: + day-type (weekday/saturday/sunday) ===");
const X4 = dataset.map(o => [
  1, o.km, o.tripMin,
  Math.sin(o.hour * Math.PI / 12),
  Math.cos(o.hour * Math.PI / 12),
  o.cd,
  Math.max(0, o.dcd - o.cd),
  o.day === "saturday" ? 1 : 0,
  o.day === "sunday" ? 1 : 0,
]);
const b4 = lstsqN(X4, y);
const lbls4 = ["intercept","km","tripMin","sin(h)","cos(h)","centDist","outbound","isSat","isSun"];
let M4;
const dayCounts = dataset.reduce((a,o)=>{a[o.day]=(a[o.day]||0)+1;return a;},{});
console.log(`  распределение по дням: ${JSON.stringify(dayCounts)}`);
if (b4) {
  console.log("  " + lbls4.map((l,i)=>`${l}=${b4[i].toFixed(4)}`).join("  "));
  M4 = evalModel("M4 +день недели", o => {
    const x = [1,o.km,o.tripMin,Math.sin(o.hour*Math.PI/12),Math.cos(o.hour*Math.PI/12),o.cd,Math.max(0,o.dcd-o.cd),o.day==="saturday"?1:0,o.day==="sunday"?1:0];
    return x.reduce((s,xi,i)=>s+xi*b4[i],0);
  });
} else {
  console.log("  ⚠ матрица вырождена (вероятно все данные за один день недели) — модель пропущена");
  M4 = { mape: NaN, mae: NaN, bias: NaN };
}

console.log("\n=== M5: 2D-таблица бакетов (km, tripMin) — empirical multiplier ===");
const KM_BUCKETS  = [0, 2.5, 4, 6, 9, 13, 20, 1e9];
const MIN_BUCKETS = [0, 5, 10, 15, 20, 30, 45, 1e9];
function bucketIdx(v, b){ for(let i=0;i<b.length-1;i++) if(v < b[i+1]) return i; return b.length-2; }
const cells = {}; // "i,j" → [yaC samples]
for (const o of dataset) {
  const i = bucketIdx(o.km, KM_BUCKETS);
  const j = bucketIdx(o.tripMin, MIN_BUCKETS);
  (cells[`${i},${j}`] ??= []).push(o.yaC);
}
// Глобальная медиана как fallback
const globalMed = median(dataset.map(o=>o.yaC));
const cellMed = {};
for (const [k,arr] of Object.entries(cells)) cellMed[k] = { med: +median(arr).toFixed(3), n: arr.length };
function predM5(o){
  const i = bucketIdx(o.km, KM_BUCKETS);
  const j = bucketIdx(o.tripMin, MIN_BUCKETS);
  let cell = cellMed[`${i},${j}`];
  if (!cell || cell.n < 2) {
    // эмпирические соседи
    const candidates = [];
    for (let di=-1; di<=1; di++) for (let dj=-1; dj<=1; dj++) {
      const c = cellMed[`${i+di},${j+dj}`];
      if (c && c.n >= 2) candidates.push(c.med);
    }
    if (candidates.length) return median(candidates);
    return globalMed;
  }
  return cell.med;
}
const M5 = evalModel("M5 2D-bucket km×tripMin", predM5);

console.log("\n=== M6: M5 + час-коррекция (поправка по часу через regression residual) ===");
// За базу берём M5, а residual yaC - M5(o) фитим линейно от sin/cos часа.
// Если все данные в одну категорию дня недели — выкидываем dummy-фичи дня.
const resid = dataset.map(o => o.yaC - predM5(o));
const hasSat = dataset.some(o => o.day === "saturday");
const hasSun = dataset.some(o => o.day === "sunday");
const X6 = dataset.map(o => {
  const r = [1, Math.sin(o.hour*Math.PI/12), Math.cos(o.hour*Math.PI/12)];
  if (hasSat) r.push(o.day==="saturday"?1:0);
  if (hasSun) r.push(o.day==="sunday"?1:0);
  return r;
});
const b6 = lstsqN(X6, resid);
let M6;
if (b6) {
  console.log(`  hour-corr: a=${b6[0].toFixed(4)} sin=${b6[1].toFixed(4)} cos=${b6[2].toFixed(4)}${hasSat?` sat=${b6[3].toFixed(4)}`:""}${hasSun?` sun=${b6[hasSat?4:3].toFixed(4)}`:""}`);
  M6 = evalModel("M6 M5 + час+день-коррекция", o => {
    let corr = b6[0] + b6[1]*Math.sin(o.hour*Math.PI/12) + b6[2]*Math.cos(o.hour*Math.PI/12);
    let idx = 3;
    if (hasSat) { corr += b6[idx++]*(o.day==="saturday"?1:0); }
    if (hasSun) { corr += b6[idx++]*(o.day==="sunday"?1:0); }
    return predM5(o) + corr;
  });
} else {
  console.log("  ⚠ матрица вырождена — пропущено");
  M6 = { mape: NaN, mae: NaN, bias: NaN };
}

// --- Честный LOO для M5 (bucket): для каждого o пересчитываем cellMed без него ---
console.log("\n=== M5-LOO (честно: для каждого скрина выбрасываем его из cells) ===");
function looM5() {
  const errs = [];
  for (let k=0; k<dataset.length; k++) {
    const o = dataset[k];
    const i = bucketIdx(o.km, KM_BUCKETS), j = bucketIdx(o.tripMin, MIN_BUCKETS);
    // соберём ячейку без k-й точки
    const cellArr = [];
    for (let kk=0; kk<dataset.length; kk++) {
      if (kk===k) continue;
      const oo = dataset[kk];
      if (bucketIdx(oo.km, KM_BUCKETS) === i && bucketIdx(oo.tripMin, MIN_BUCKETS) === j) cellArr.push(oo.yaC);
    }
    let pred;
    if (cellArr.length >= 2) pred = median(cellArr);
    else {
      const cands = [];
      for (let di=-1; di<=1; di++) for (let dj=-1; dj<=1; dj++) {
        if (di===0 && dj===0) continue;
        for (let kk=0; kk<dataset.length; kk++) {
          if (kk===k) continue;
          const oo = dataset[kk];
          if (bucketIdx(oo.km, KM_BUCKETS) === i+di && bucketIdx(oo.tripMin, MIN_BUCKETS) === j+dj) cands.push(oo.yaC);
        }
      }
      pred = cands.length ? median(cands) : globalMed;
    }
    errs.push(Math.abs(o.yaC - pred) / o.yaC);
  }
  return mean(errs) * 100;
}
const looM5val = looM5();
console.log(`  LOO M5 = ${looM5val.toFixed(1)}%  (на all=${M5.mape.toFixed(1)}%)`);

// --- LOO для M2..M6 (защита от переобучения) ---
console.log("\n=== LOO (Leave-One-Out cross-validation) ===");
function looMape(features, predFromBeta) {
  const errs = [];
  for (let k=0; k<dataset.length; k++) {
    const trainX = features.filter((_,i) => i!==k);
    const trainY = y.filter((_,i) => i!==k);
    const beta = lstsqN(trainX, trainY);
    if (!beta) continue;
    const p = predFromBeta(features[k], beta);
    const err = Math.abs(y[k] - p) / y[k];
    errs.push(err);
  }
  return mean(errs) * 100;
}
const loo1 = looMape(X1, (x,b)=>b[0]+b[1]*x[1]);
const loo2 = looMape(X2, (x,b)=>b[0]+b[1]*x[1]+b[2]*x[2]);
const loo3 = looMape(X3, (x,b)=>x.reduce((s,xi,i)=>s+xi*b[i],0));
const loo4 = b4 ? looMape(X4, (x,b)=>x.reduce((s,xi,i)=>s+xi*b[i],0)) : NaN;
console.log(`  LOO M1=${loo1.toFixed(1)}%  M2=${loo2.toFixed(1)}%  M3=${loo3.toFixed(1)}%  M4=${isNaN(loo4)?'—':loo4.toFixed(1)+'%'}`);

// --- Сводка ---
const summary = {
  generatedAt: new Date().toISOString(),
  source: SCREENS,
  n: dataset.length,
  cmfMin: CMF_MIN, ecoMin: ECO_MIN,
  models: {
    M0_distMul_v3:   { ...M0, formula: "distMul(km) — текущий бакет в zones.ts" },
    M1_linear_km:    { ...M1, formula: `${b1[0].toFixed(3)} + ${b1[1].toFixed(4)}·km` },
    M2_km_tripMin:   { ...M2, formula: `${b2[0].toFixed(3)} + ${b2[1].toFixed(4)}·km + ${b2[2].toFixed(4)}·tripMin`, beta: b2 },
    M3_full_linear:  { ...M3, formula: lbls3.map((l,i)=>`${b3[i].toFixed(4)}·${l}`).join(" + "), beta: b3, labels: lbls3 },
    M4_with_dow:     b4
      ? { ...M4, formula: lbls4.map((l,i)=>`${b4[i].toFixed(4)}·${l}`).join(" + "), beta: b4, labels: lbls4 }
      : { ...M4, skipped: "singular matrix (нет разнообразия по дню недели)" },
    M5_bucket2d:     { ...M5, kmBuckets: KM_BUCKETS, minBuckets: MIN_BUCKETS, cells: cellMed, globalMedian: +globalMed.toFixed(3) },
    M6_bucket_hour:  { ...M6, hourCoeffs: b6 },
  },
  loo: { M1: loo1, M2: loo2, M3: loo3, M4: loo4 },
  best: null,
};
const candidates = [
  ["M0_distMul_v3", M0.mape], ["M1_linear_km", loo1], ["M2_km_tripMin", loo2],
  ["M3_full_linear", loo3], ["M4_with_dow", loo4], ["M5_bucket2d", M5.mape], ["M6_bucket_hour", M6.mape],
];
candidates.sort((a,b)=>a[1]-b[1]);
summary.best = candidates[0][0];
console.log(`\n🏆 Лучшая модель (по LOO/MAPE): ${candidates[0][0]} = ${candidates[0][1].toFixed(1)}%`);

writeFileSync(join(LEARNED, "vps-route-surge.json"), JSON.stringify(summary, null, 2));
writeFileSync(join(LEARNED, "vps-dataset.json"), JSON.stringify({ generatedAt: new Date().toISOString(), n: dataset.length, orders: dataset }, null, 2));
console.log(`\n→ ${join(LEARNED,'vps-route-surge.json')}`);
console.log(`→ ${join(LEARNED,'vps-dataset.json')}`);
