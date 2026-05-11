#!/usr/bin/env node
// Генератор разбора цен по конкретному прогону калибровки.
// Берёт data/learned/{loo,dataset}.json + scripts/orders/<run>.results.json,
// формирует markdown с обоснованием цены каждого заказа: маршрут → факт Y →
// наш прогноз → разница → причина.
//
// Использование: node scripts/breakdown.mjs <run-source-file>
//   например: node scripts/breakdown.mjs 2026-04-26-1547.results.json
// На выходе: scripts/breakdowns/<run-stem>.md

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const sourceFile = process.argv[2];
if (!sourceFile) {
  console.error("Использование: node scripts/breakdown.mjs <YYYY-MM-DD-HHMM.results.json>");
  process.exit(1);
}

const stem = sourceFile.replace(/\.results\.json$/, "");
const results = JSON.parse(readFileSync(join(ROOT, "scripts/orders", sourceFile), "utf8"));
const dataset = JSON.parse(readFileSync(join(ROOT, "scripts/learned/dataset.json"), "utf8"));
const loo = JSON.parse(readFileSync(join(ROOT, "scripts/learned/loo.json"), "utf8"));

const dsByOrder = new Map(
  dataset.orders.filter(o => o.sourceFile === sourceFile).map(o => [o.id, o])
);
const looByOrder = new Map(loo.items.map(i => [i.id, i]));

const orders = results.results || results.orders || [];
const isAccountB = stem.endsWith("-B");

// Группируем по точке отправления (для аккаунта A).
const groups = new Map();
for (const o of orders) {
  const from = o.from;
  if (!groups.has(from)) groups.set(from, []);
  groups.get(from).push(o);
}

const lines = [];

// --- Шапка -----------------------------------------------------------------
lines.push(`# Разбор цен — прогон ${stem}`);
lines.push("");
lines.push(`**Дата:** ${results.date} (${results.day})  `);
lines.push(`**Аккаунт:** ${isAccountB ? "**B** (карта •9302) — отдельный пакет, исключён из обучения" : "**A** (основной)"}  `);
lines.push(`**Заказов:** ${orders.length}  `);
if (results.comment) {
  lines.push("");
  lines.push("> " + results.comment.replace(/\n/g, "\n> "));
}
lines.push("");
lines.push("---");
lines.push("");

if (isAccountB) {
  // --- Спец-логика для аккаунта B (нет predictedSurge в loo) ---------------
  lines.push("## Особенность аккаунта B");
  lines.push("");
  lines.push("У этого аккаунта (карта •9302) Yandex показывает открытые ⚡N для **всех** классов (а не только Эконома)");
  lines.push("и значения `<1` для Cmf — что в принципе невозможно при стандартной модели.");
  lines.push("Калибровка обнаружила, что у клиента B `baza_Y` ≈ **9.46 br** вместо обычных **9.91 br** —");
  lines.push("Yandex применяет персональный дисконт −5% к плоской baza Cmf.");
  lines.push("");
  lines.push("Поэтому эти заказы отделены от обучения (фильтр `*-B.results.json` в `learn.mjs`):");
  lines.push("если их смешать с основным датасетом, модель «съедет» на ~5% ниже для всех клиентов.");
  lines.push("");

  for (const o of orders) {
    // Для B берём enriched-поля прямо из results.json (B нет в dataset).
    const km = o.km ?? 0;
    const min = o.min ?? 0;
    const ttMult = o.ttMult ?? 1;
    const baza = (o.factC / o.yaSurgeC).toFixed(2);
    const wouldBe = (o.yaSurgeC * 9.91).toFixed(2);
    const diffBr = (o.factC - parseFloat(wouldBe)).toFixed(2);
    const diffPct = (((o.factC - parseFloat(wouldBe)) / parseFloat(wouldBe)) * 100).toFixed(1);
    lines.push(`### Заказ ${o.id}: ${o.from} → ${o.to}`);
    lines.push("");
    lines.push(`- **Маршрут (TomTom):** ${km.toFixed(2)} км, ${min.toFixed(1)} мин (TomTom mult ${ttMult.toFixed(2)}; Y. показал ${o.yaMin} мин)`);
    lines.push(`- **Yandex факт:** Cmf **${o.factC} br** (⚡${o.yaSurgeC}), Эконом ${o.factE} br`);
    lines.push(`- **baza_Y этого клиента (по факту):** ${baza} br (= factC ÷ ⚡N)`);
    lines.push(`- **Если бы клиент был «обычный» (baza 9.91 br):** Cmf ≈ ${wouldBe} br`);
    lines.push(`- **Дисконт аккаунту B:** ${diffBr} br (${diffPct}%)`);
    lines.push("- **Комментарий со скрина:** " + (o.notes || ""));
    lines.push("");
  }
} else {
  // --- Аккаунт A: разбор каждого заказа через loo --------------------------

  // Сортируем группы по числу заказов (DESC), внутри — по id.
  const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  for (const [from, ordersInGroup] of sortedGroups) {
    lines.push(`## Опорная точка: ${from} (${ordersInGroup.length} заказ${ordersInGroup.length === 1 ? "" : ordersInGroup.length < 5 ? "а" : "ов"})`);
    lines.push("");

    // Sub-summary
    const looEntries = ordersInGroup.map(o => looByOrder.get(o.id)).filter(Boolean);
    if (looEntries.length) {
      const meanAbs = looEntries.reduce((s, e) => s + e.absPct, 0) / looEntries.length;
      const within10 = looEntries.filter(e => e.absPct <= 10).length;
      const overshoots = looEntries.filter(e => e.verdict === "overshoot").length;
      const undershoots = looEntries.filter(e => e.verdict === "undershoot").length;
      lines.push(`> mean MAPE = **${meanAbs.toFixed(1)}%**, в пределах ±10% — ${within10}/${looEntries.length}, переоценок ${overshoots}, недооценок ${undershoots}.`);
      lines.push("");
    }

    for (const o of ordersInGroup.sort((a, b) => a.id.localeCompare(b.id))) {
      const lo = looByOrder.get(o.id);
      const ds = dsByOrder.get(o.id) || {};
      lines.push(`### Заказ ${o.id}: → ${o.to}`);
      lines.push("");
      const km = (ds.km ?? lo?.km ?? 0).toFixed(2);
      const min = (ds.min ?? lo?.min ?? 0).toFixed(1);
      const ttMult = (ds.ttMult ?? lo?.ttMult ?? 1).toFixed(2);
      const catLabel = lo?.routeCategory === "intra"
        ? "🏙️ внутри Минска"
        : lo?.routeCategory === "outbound"
          ? "🏘️ в пригород"
          : lo?.routeCategory === "far"
            ? "🌍 дальний (>50 км)"
            : null;
      lines.push(`- **Маршрут:** ${km} км, ${min} мин (TomTom mult ${ttMult}; Y. показал ${o.yaMin} мин)${catLabel ? ` — ${catLabel}` : ""}`);
      lines.push(`- **Yandex факт:** Cmf **${o.factC} br** (⚡${o.yaSurgeC}), Эконом ${o.factE} br`);
      if (lo) {
        const sign = lo.errPct >= 0 ? "+" : "";
        const verdictRu = {
          good: "совпадение в пределах ±10%",
          undershoot: "недооценка",
          overshoot: "переоценка",
        }[lo.verdict] || lo.verdict;
        // Hidden boost для Эконома по бинарной модели (см. zones.ts hiddenBoost):
        // sC<1.0 → 0.89; 1.0..1.2 → линейный переход; >=1.2 → 0.96; >=5 → 0.97
        let hbE;
        const sC = lo.predictedSurge;
        if (sC < 1.0) hbE = 0.89;
        else if (sC < 1.2) hbE = 0.89 + ((sC - 1.0) / 0.2) * 0.07;
        else if (sC < 5.0) hbE = 0.96;
        else hbE = 0.97;
        const predictedE = lo.predictedC * hbE;
        lines.push(`- **Наша модель:** ⚡${lo.predictedSurge.toFixed(2)} × baza 10 br = **Cmf ${lo.predictedC.toFixed(2)} br**, hb=${hbE.toFixed(2)} → **Эконом ${predictedE.toFixed(2)} br**`);
        lines.push(`- **Δ Cmf:** ${sign}${lo.err.toFixed(2)} br (**${sign}${lo.errPct.toFixed(1)}%**) — ${verdictRu}`);
        const errE = predictedE - o.factE;
        const errEPct = (errE / o.factE) * 100;
        const signE = errEPct >= 0 ? "+" : "";
        lines.push(`- **Δ Эконом:** ${signE}${errE.toFixed(2)} br (${signE}${errEPct.toFixed(1)}%)`);
        lines.push(`- **Почему:** ${lo.reason}`);
      } else {
        lines.push(`- **Наша модель:** нет данных в LOO для этого заказа.`);
      }
      lines.push("");
    }
  }

  // --- Финальная сводка ----------------------------------------------------
  const allLoo = orders.map(o => looByOrder.get(o.id)).filter(Boolean);
  if (allLoo.length) {
    lines.push("---");
    lines.push("");
    lines.push("## Сводная статистика по прогону");
    lines.push("");

    const buckets = [
      { name: "⚡<1 (низкий спрос, дисконт)", fn: e => e.yaSurgeC < 1 },
      { name: "⚡1.0–2.0 (норма)",            fn: e => e.yaSurgeC >= 1 && e.yaSurgeC < 2 },
      { name: "⚡2.0–3.0 (повыш. спрос)",     fn: e => e.yaSurgeC >= 2 && e.yaSurgeC < 3 },
      { name: "⚡≥3 (загородные / outliers)", fn: e => e.yaSurgeC >= 3 },
    ];

    lines.push("| Бакет | n | mean MAPE | В пределах ±10% | Среднее (наш / Y.) |");
    lines.push("|---|---|---|---|---|");
    for (const b of buckets) {
      const items = allLoo.filter(b.fn);
      if (!items.length) continue;
      const mape = items.reduce((s, i) => s + i.absPct, 0) / items.length;
      const w10 = items.filter(i => i.absPct <= 10).length;
      const ratioMean = items.reduce((s, i) => s + i.predictedSurge / i.yaSurgeC, 0) / items.length;
      lines.push(`| ${b.name} | ${items.length} | ${mape.toFixed(1)}% | ${w10}/${items.length} | ×${ratioMean.toFixed(2)} |`);
    }
    lines.push("");

    // Топ-3 промаха
    const worst = [...allLoo].sort((a, b) => b.absPct - a.absPct).slice(0, 5);
    lines.push("### Топ-5 промахов");
    lines.push("");
    for (const w of worst) {
      const sign = w.errPct >= 0 ? "+" : "";
      lines.push(`- **${w.id}** ${w.from} → ${w.to}: факт ${w.factC} br, прогноз ${w.predictedC.toFixed(2)} br (**${sign}${w.errPct.toFixed(1)}%**) — ${w.reason}`);
    }
    lines.push("");

    // Лучшие попадания
    const best = [...allLoo].filter(w => w.absPct <= 5).sort((a, b) => a.absPct - b.absPct).slice(0, 5);
    if (best.length) {
      lines.push("### Топ-5 точных попаданий (≤5%)");
      lines.push("");
      for (const w of best) {
        const sign = w.errPct >= 0 ? "+" : "";
        lines.push(`- **${w.id}** ${w.from} → ${w.to}: факт ${w.factC} br, прогноз ${w.predictedC.toFixed(2)} br (${sign}${w.errPct.toFixed(1)}%)`);
      }
      lines.push("");
    }
  }

  // --- Главные выводы ------------------------------------------------------
  lines.push("---");
  lines.push("");
  lines.push("## Главные выводы прогона");
  lines.push("");
  lines.push("1. **Центр Минска при умеренном спросе (⚡1–2)** — лучшая зона модели: подавляющее большинство попадает в ±10–20%.");
  lines.push("2. **Низкий спрос (⚡<1)** — модель чаще переоценивает, потому что в evening-слот ожидает «нормальный» спрос; для коротких маршрутов (1–3 км) Yandex упирается в свой `minimum_C ≈ 10 br`, а наша формула — в свой ×0.7..0.9 zonal-сёрдж.");
  lines.push("3. **Дальние загородные (>50 км: Вилейка, Морочь, Сутоки, Фаниполь)** — модель упирается в hard-cap `predictedSurge ≤ 6.0` (см. `learn.mjs` L395), реальные ⚡N доходят до 31. Нужно расширить cap или ввести отдельную линейную per-km ветку для дальних.");
  lines.push("4. **Пробок практически нет** (ttMult 1.00..1.03) — расхождения с Yandex НЕ объясняются трафиком, всё в зональном/слотном сёрдже.");
  lines.push("");
}

const outDir = join(ROOT, "scripts/breakdowns");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${stem}.md`);
writeFileSync(outPath, lines.join("\n"));
console.log(`✓ Разбор сохранён: ${outPath} (${lines.length} строк)`);

// Дублируем в public/data/breakdowns/ для деплоя.
const pubDir = join(ROOT, "public/data/breakdowns");
mkdirSync(pubDir, { recursive: true });
const pubPath = join(pubDir, `${stem}.md`);
writeFileSync(pubPath, lines.join("\n"));
console.log(`✓ Копия для деплоя: ${pubPath}`);
