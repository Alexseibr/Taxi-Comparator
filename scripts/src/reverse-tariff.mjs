#!/usr/bin/env node
/**
 * Обратная инженерия тарифной формулы Yandex Go.
 * Берёт все 7640 снапшотов из VPS PostgreSQL, делает OLS регрессию:
 *
 *   price = base_fee + perKm·km + perMin·min   (до сёрджа, т.е. baza = price/surge)
 *
 * и сравнивает с текущей "плоской" моделью (baza = minimum = const).
 *
 * Запуск:  VPS_DATABASE_URL=... node scripts/src/reverse-tariff.mjs
 */
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const ExcelJS = require(resolve(ROOT, "node_modules/.pnpm/exceljs@4.4.0/node_modules/exceljs"));
const { Client } = require(resolve(ROOT, "node_modules/.pnpm/pg@8.20.0/node_modules/pg"));

// ── DB ───────────────────────────────────────────────────────────────────────
const DB_URL = process.env.VPS_DATABASE_URL;
if (!DB_URL) { console.error("VPS_DATABASE_URL не задан"); process.exit(1); }

const client = new Client({ connectionString: DB_URL });
await client.connect();

const { rows } = await client.query(`
  SELECT
    route_id,
    class_id,
    price_min,
    price_max,
    surge_multiplier  AS surge,
    distance_km       AS km,
    duration_min      AS min,
    EXTRACT(HOUR FROM captured_at AT TIME ZONE 'Europe/Minsk') AS hour,
    EXTRACT(DOW  FROM captured_at AT TIME ZONE 'Europe/Minsk') AS dow
  FROM tariff_snapshots
  WHERE surge_multiplier > 0
  ORDER BY class_id, route_id, captured_at
`);
await client.end();

console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`Загружено ${rows.length} строк из tariff_snapshots`);
console.log(`═══════════════════════════════════════════════════════════\n`);

// ── OLS (Ordinary Least Squares) без внешних зависимостей ───────────────────
// Матричная регрессия: β = (XᵀX)⁻¹ Xᵀy  (3×3 инверсия для base + km + min)
function ols(data /* [{km, min, y}] */) {
  const n = data.length;
  // X = [1, km, min], y = baza
  let S00=0,S10=0,S20=0,S30=0, S01=0,S11=0,S21=0,S31=0, S02=0,S12=0,S22=0,S32=0;
  let Sy=0, Sxy=0, Sxky=0, Sxmy=0, Syy=0;
  for (const r of data) {
    const x1 = r.km, x2 = r.min, y = r.y;
    S00+=1; S10+=x1; S20+=x2; S30+=x1*x1;
    S01+=x1; S11+=x1*x1; S21+=x1*x2; S31+=x1*x1*x1;
    S02+=x2; S12+=x1*x2; S22+=x2*x2; S32+=x2*x2*x2;
    Sy+=y; Sxky+=x1*y; Sxmy+=x2*y; Syy+=y*y;
  }
  // XᵀX = [[n, ΣX1, ΣX2],[ΣX1, ΣX1², ΣX1X2],[ΣX2, ΣX1X2, ΣX2²]]
  // Xᵀy = [Σy, ΣX1·y, ΣX2·y]
  const A = [[n,S10,S20],[S10,S30,S21],[S20,S21,S22]];
  const b = [Sy, Sxky, Sxmy];
  // Инверсия 3×3 через cofactor expansion
  const inv = inv3(A);
  const base  = inv[0][0]*b[0] + inv[0][1]*b[1] + inv[0][2]*b[2];
  const perKm  = inv[1][0]*b[0] + inv[1][1]*b[1] + inv[1][2]*b[2];
  const perMin = inv[2][0]*b[0] + inv[2][1]*b[1] + inv[2][2]*b[2];

  // Метрики
  const yMean = Sy / n;
  let ssTot = 0, ssRes = 0, maeSum = 0;
  for (const r of data) {
    const pred = base + perKm * r.km + perMin * r.min;
    ssRes += (r.y - pred) ** 2;
    ssTot += (r.y - yMean) ** 2;
    maeSum += Math.abs(r.y - pred);
  }
  const r2   = 1 - ssRes / ssTot;
  const rmse = Math.sqrt(ssRes / n);
  const mae  = maeSum / n;
  return { base, perKm, perMin, r2, rmse, mae, n };
}

// Простая линейная регрессия y ~ x (для km и min по отдельности)
function olsSimple(data, field) {
  const n = data.length;
  let sx=0, sy=0, sxx=0, sxy=0, syy=0;
  for (const r of data) { sx+=r[field]; sy+=r.y; sxx+=r[field]**2; sxy+=r[field]*r.y; syy+=r.y**2; }
  const slope = (n*sxy - sx*sy) / (n*sxx - sx**2);
  const intercept = (sy - slope*sx) / n;
  const yMean = sy/n;
  let ssTot=0, ssRes=0, maeSum=0;
  for (const r of data) {
    const pred = intercept + slope*r[field];
    ssRes += (r.y - pred)**2;
    ssTot += (r.y - yMean)**2;
    maeSum += Math.abs(r.y - pred);
  }
  return { intercept, slope, r2: 1 - ssRes/ssTot, mae: maeSum/n, rmse: Math.sqrt(ssRes/n) };
}

function inv3(m) {
  const d = m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])
           -m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])
           +m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  const c = [
    [(m[1][1]*m[2][2]-m[1][2]*m[2][1])/d, -(m[0][1]*m[2][2]-m[0][2]*m[2][1])/d, (m[0][1]*m[1][2]-m[0][2]*m[1][1])/d],
    [-(m[1][0]*m[2][2]-m[1][2]*m[2][0])/d, (m[0][0]*m[2][2]-m[0][2]*m[2][0])/d, -(m[0][0]*m[1][2]-m[0][2]*m[1][0])/d],
    [(m[1][0]*m[2][1]-m[1][1]*m[2][0])/d, -(m[0][0]*m[2][1]-m[0][1]*m[2][0])/d, (m[0][0]*m[1][1]-m[0][1]*m[1][0])/d],
  ];
  return c;
}

// ── Анализ по классам ────────────────────────────────────────────────────────
const CLASSES = ["econom", "business"];
const results = {};

for (const cls of CLASSES) {
  const clsRows = rows.filter(r => r.class_id === cls);
  const baza = clsRows.map(r => ({ km: +r.km, min: +r.min, y: +r.price_min / +r.surge, route: r.route_id }));

  // 1. Плоская модель (baseline)
  const yMean = baza.reduce((s,r)=>s+r.y,0) / baza.length;
  let maeFlat=0, ssResFlat=0, ssTotFlat=0;
  for (const r of baza) {
    maeFlat += Math.abs(r.y - yMean);
    ssResFlat += (r.y - yMean)**2;
    ssTotFlat += (r.y - yMean)**2;
  }
  const flatModel = { base: yMean, perKm: 0, perMin: 0, r2: 0, rmse: Math.sqrt(ssResFlat/baza.length), mae: maeFlat/baza.length };

  // 2. OLS: baza ~ km + min (полная)
  const fullOLS = ols(baza);

  // 3. OLS: baza ~ km только
  const kmOnly = olsSimple(baza, "km");

  // 4. OLS: baza ~ min только
  const minOnly = olsSimple(baza, "min");

  // 5. Средняя baza по маршруту (чтобы исключить шум во времени)
  const byRoute = {};
  for (const r of baza) {
    if (!byRoute[r.route]) byRoute[r.route] = { km:r.km, min:r.min, vals:[] };
    byRoute[r.route].vals.push(r.y);
  }
  const routeData = Object.entries(byRoute).map(([id,v]) => ({
    route: id, km: v.km, min: v.min,
    y: v.vals.reduce((a,b)=>a+b,0)/v.vals.length,
    n: v.vals.length,
    std: Math.sqrt(v.vals.reduce((s,x)=>{const d=x-v.vals.reduce((a,b)=>a+b,0)/v.vals.length;return s+d*d},0)/v.vals.length),
  })).sort((a,b)=>a.km-b.km);

  // 6. OLS по средним маршрутам (20 точек — чище)
  const routeOLS = ols(routeData);
  const routeKmOnly = olsSimple(routeData, "km");

  console.log(`\n────────── ${cls.toUpperCase()} (${baza.length} строк, ${routeData.length} маршрутов) ──────────`);
  console.log(`\n  Baza = price/surge статистика:`);
  const bazaVals = baza.map(r=>r.y);
  const bzMin = Math.min(...bazaVals), bzMax = Math.max(...bazaVals);
  const bzStd = Math.sqrt(baza.reduce((s,r)=>{const d=r.y-yMean;return s+d*d},0)/baza.length);
  console.log(`    mean=${yMean.toFixed(3)}, std=${bzStd.toFixed(3)}, min=${bzMin.toFixed(2)}, max=${bzMax.toFixed(2)}`);

  console.log(`\n  1. Плоская модель (baza = const=${yMean.toFixed(3)}):`);
  console.log(`     R²=0.000, MAE=${flatModel.mae.toFixed(3)} BYN, RMSE=${flatModel.rmse.toFixed(3)}`);

  console.log(`\n  2. OLS по всем строкам: baza = ${fullOLS.base.toFixed(3)} + ${fullOLS.perKm.toFixed(4)}·km + ${fullOLS.perMin.toFixed(4)}·min`);
  console.log(`     R²=${fullOLS.r2.toFixed(4)}, MAE=${fullOLS.mae.toFixed(3)}, RMSE=${fullOLS.rmse.toFixed(3)}`);

  console.log(`\n  3. OLS km-only: baza = ${kmOnly.intercept.toFixed(3)} + ${kmOnly.slope.toFixed(4)}·km`);
  console.log(`     R²=${kmOnly.r2.toFixed(4)}, MAE=${kmOnly.mae.toFixed(3)}`);

  console.log(`\n  4. OLS min-only: baza = ${minOnly.intercept.toFixed(3)} + ${minOnly.slope.toFixed(4)}·min`);
  console.log(`     R²=${minOnly.r2.toFixed(4)}, MAE=${minOnly.mae.toFixed(3)}`);

  console.log(`\n  5. OLS по средним маршрутов (${routeData.length} точек):`);
  console.log(`     baza = ${routeOLS.base.toFixed(3)} + ${routeOLS.perKm.toFixed(4)}·km + ${routeOLS.perMin.toFixed(4)}·min`);
  console.log(`     R²=${routeOLS.r2.toFixed(4)}, MAE=${routeOLS.mae.toFixed(3)}, RMSE=${routeOLS.rmse.toFixed(3)}`);

  console.log(`\n  6. По маршрутам (средняя baza ± std):`);
  for (const r of routeData) {
    const pred = routeOLS.base + routeOLS.perKm*r.km + routeOLS.perMin*r.min;
    const err = r.y - pred;
    console.log(`    ${r.route.padEnd(28)} ${r.km.toString().padStart(4)}км/${r.min.toString().padStart(3)}мин | baza=${r.y.toFixed(2)} ±${r.std.toFixed(2)} | pred=${pred.toFixed(2)} | err=${err>0?'+':''}${err.toFixed(2)}`);
  }

  results[cls] = { baza: yMean, flatModel, fullOLS, kmOnly, minOnly, routeOLS, routeKmOnly, routeData };
}

// ── Сравнение Econom vs Business ──────────────────────────────────────────────
console.log(`\n\n═══ СРАВНЕНИЕ ТАРИФНЫХ СТРУКТУР ═══`);
for (const cls of CLASSES) {
  const r = results[cls].routeOLS;
  console.log(`${cls.padEnd(10)}: base=${r.base.toFixed(3)} BYN + ${r.perKm.toFixed(4)} BYN/km + ${r.perMin.toFixed(4)} BYN/min  (R²=${r.r2.toFixed(4)})`);
}
console.log(`\nИнтерпретация:`);
const ek = results.econom.routeOLS, bk = results.business.routeOLS;
console.log(`  Econom/Business коэф. km:  ${(ek.perKm/bk.perKm).toFixed(3)}x`);
console.log(`  Econom/Business коэф. min: ${(ek.perMin/bk.perMin).toFixed(3)}x`);
console.log(`  Econom/Business base:      ${(ek.base/bk.base).toFixed(3)}x`);

// ── Excel-отчёт ───────────────────────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
wb.creator = "RWBTaxi Tariff Reversal";
wb.created = new Date();

function hdrStyle(bg = "FF1E3A5F") {
  return { font:{bold:true,color:{argb:"FFFFFFFF"},size:11}, fill:{type:"pattern",pattern:"solid",fgColor:{argb:bg}}, alignment:{horizontal:"center",vertical:"middle",wrapText:true} };
}
function numStyle(fmt="0.000") {
  return { font:{size:10}, alignment:{horizontal:"center",vertical:"middle"}, numFmt: fmt };
}

// Лист 1: Результаты регрессии
{
  const ws = wb.addWorksheet("Регрессия тарифа");
  ws.columns = [{width:30},{width:16},{width:16},{width:16},{width:16},{width:16},{width:16}];

  const t = ws.addRow(["Обратная инженерия тарифа Yandex Go · Минск · " + new Date().toLocaleDateString("ru-RU")]);
  ws.mergeCells("A1:G1");
  t.getCell(1).style = {font:{bold:true,size:14,color:{argb:"FF1E3A5F"}}};
  t.height = 26;

  ws.addRow(["baza = price_min / surge_multiplier. Модель: baza = base_fee + perKm·km + perMin·min"]);
  ws.mergeCells("A2:G2");
  ws.getRow(2).getCell(1).style = {font:{size:10,italic:true,color:{argb:"FF555555"}}};
  ws.addRow([]);

  const hdr = ws.addRow(["Модель", "base_fee, BYN", "perKm, BYN/км", "perMin, BYN/мин", "R²", "MAE, BYN", "RMSE, BYN"]);
  hdr.height = 32;
  hdr.eachCell(c => { c.style = hdrStyle(); });

  for (const cls of CLASSES) {
    const R = results[cls];
    ws.addRow([`${cls} · Плоская модель`, R.flatModel.base.toFixed(3), 0, 0, 0, R.flatModel.mae.toFixed(3), R.flatModel.rmse.toFixed(3)]);
    ws.addRow([`${cls} · OLS (все строки)`, R.fullOLS.base.toFixed(3), R.fullOLS.perKm.toFixed(4), R.fullOLS.perMin.toFixed(4), R.fullOLS.r2.toFixed(4), R.fullOLS.mae.toFixed(3), R.fullOLS.rmse.toFixed(3)]);
    ws.addRow([`${cls} · OLS (по маршрутам)`, R.routeOLS.base.toFixed(3), R.routeOLS.perKm.toFixed(4), R.routeOLS.perMin.toFixed(4), R.routeOLS.r2.toFixed(4), R.routeOLS.mae.toFixed(3), R.routeOLS.rmse.toFixed(3)]);
    ws.addRow([]);
  }

  ws.addRow([]);
  const cmp = ws.addRow(["Вывод о соотношении тарифов Econom vs Business"]);
  ws.mergeCells(`A${cmp.number}:G${cmp.number}`);
  cmp.getCell(1).style = {font:{bold:true,size:11,color:{argb:"FF1E3A5F"}}};
  ws.addRow([`Econom base/Business base`, (results.econom.routeOLS.base/results.business.routeOLS.base).toFixed(3)+"x", "", "", "", "", ""]);
  ws.addRow([`Econom perKm/Business perKm`, (results.econom.routeOLS.perKm/results.business.routeOLS.perKm).toFixed(3)+"x", "", "", "", "", ""]);
  ws.addRow([`Econom perMin/Business perMin`, (results.econom.routeOLS.perMin/results.business.routeOLS.perMin).toFixed(3)+"x", "", "", "", "", ""]);
}

// Лист 2: Данные по маршрутам
{
  const ws = wb.addWorksheet("По маршрутам");
  ws.columns = [{width:26},{width:8},{width:8},{width:14},{width:14},{width:14},{width:14},{width:14},{width:14}];

  const hdr = ws.addRow(["Маршрут","км","мин","Econom\nсредн. baza","Econom\nстд.","Business\nсредн. baza","Business\nстд.","Pred Econom","Pred Business"]);
  hdr.height = 36;
  hdr.eachCell(c => { c.style = hdrStyle(); });

  const ekRoutes = {}, bkRoutes = {};
  for (const r of results.econom.routeData)   ekRoutes[r.route] = r;
  for (const r of results.business.routeData) bkRoutes[r.route] = r;
  const allRoutes = results.business.routeData.map(r=>r.route);

  for (const route of allRoutes) {
    const ek = ekRoutes[route] ?? {y:0,std:0,km:0,min:0};
    const bk = bkRoutes[route];
    const predEk = results.econom.routeOLS.base + results.econom.routeOLS.perKm*bk.km + results.econom.routeOLS.perMin*bk.min;
    const predBk = results.business.routeOLS.base + results.business.routeOLS.perKm*bk.km + results.business.routeOLS.perMin*bk.min;
    const r = ws.addRow([route, bk.km, bk.min, ek.y.toFixed(3), ek.std.toFixed(3), bk.y.toFixed(3), bk.std.toFixed(3), predEk.toFixed(3), predBk.toFixed(3)]);
    r.height = 18;
    for (let i=1;i<=9;i++) r.getCell(i).style = {font:{size:10}, alignment:{horizontal:"center",vertical:"middle"}};
    r.getCell(1).style.alignment.horizontal = "left";
  }
}

// Лист 3: Полный датасет (sample)
{
  const ws = wb.addWorksheet("Датасет (выборка)");
  ws.columns = [{width:26},{width:12},{width:10},{width:10},{width:10},{width:12},{width:12},{width:12}];
  const hdr = ws.addRow(["Маршрут","Класс","Цена, BYN","Сёрдж","Baza","км","мин","Час"]);
  hdr.height = 28;
  hdr.eachCell(c => { c.style = hdrStyle(); });

  // sample 200 rows alternating econom/business for illustration
  const sample = rows.filter((_,i)=>i%38===0).slice(0,200);
  for (const r of sample) {
    const bz = (+r.price_min / +r.surge).toFixed(3);
    const row = ws.addRow([r.route_id, r.class_id, +r.price_min, +r.surge, bz, +r.km, +r.min, +r.hour]);
    row.height = 16;
    for (let i=1;i<=8;i++) row.getCell(i).style = {font:{size:9}, alignment:{horizontal:"center",vertical:"middle"}};
    row.getCell(1).style.alignment.horizontal = "left";
    row.getCell(2).style = {font:{size:9,bold:true,color:{argb:r.class_id==="econom"?"FF1565C0":"FF6A1B9A"}}, alignment:{horizontal:"center",vertical:"middle"}};
  }
}

const outXlsx = resolve(ROOT, "tariff-reversal.xlsx");
await wb.xlsx.writeFile(outXlsx);
console.log(`\n✓ Excel сохранён: ${outXlsx}`);

// JSON для фронта
const jsonOut = {
  generatedAt: new Date().toISOString(),
  basedOn: rows.length,
  econom: {
    flatBaseline: results.econom.flatModel.base,
    olsAllRows:   results.econom.fullOLS,
    olsByRoute:   results.econom.routeOLS,
    routeData:    results.econom.routeData,
  },
  business: {
    flatBaseline: results.business.flatModel.base,
    olsAllRows:   results.business.fullOLS,
    olsByRoute:   results.business.routeOLS,
    routeData:    results.business.routeData,
  },
};
const outJson = resolve(ROOT, "artifacts/taxi-compare/scripts/learned/tariff-reversal.json");
writeFileSync(outJson, JSON.stringify(jsonOut, null, 2));
console.log(`✓ JSON сохранён: ${outJson}`);
