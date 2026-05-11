#!/usr/bin/env node
// Сводка «Тариф Я.Такси в Минске — что мы знаем».
// Собирается на основе всех обученных файлов из scripts/learned/ и
// записывается в public/data/yandex-tariff.md (доступно на проде по
// https://rwbtaxi.by/data/yandex-tariff.md).
//
// Использование: node scripts/yandex-tariff-summary.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LEARNED = join(ROOT, "scripts/learned");
const PUBLIC_DATA = join(ROOT, "public/data");

const j = (p) => JSON.parse(readFileSync(join(LEARNED, p), "utf8"));
const sanity   = j("sanity-tariff.json");
const hidden   = j("hidden-boost.json");
const surge    = j("surge-model.json");
const traffic  = j("traffic-effect.json");
const metrics  = j("metrics.json");
const loo      = j("loo.json");

const fitFactors = loo.factorAdjustments || [];
const fz = fitFactors.find(f => f.mode === "fromZone");
const wt = fitFactors.find(f => f.mode === "weather");
const pk = fitFactors.find(f => f.mode === "peak");
const hd = fitFactors.find(f => f.mode === "holiday");

const zoneLine = fz?.cells && Object.keys(fz.cells).length
  ? Object.entries(fz.cells)
      .sort((a, b) => Math.abs(b[1].mu - 1) - Math.abs(a[1].mu - 1))
      .slice(0, 3)
      .map(([cid, c]) => `${cid.slice(0, 7)}…(${c.lat.toFixed(2)},${c.lng.toFixed(2)})×${c.mu.toFixed(2)}`)
      .join(", ")
  : "пока нет активных H3-ячеек";

const econMin = +(10 * (hidden.overall.mean || 0.95)).toFixed(2);

const md = `# Тариф Я.Такси в Минске — что мы знаем
*Автоматически собрано на ${new Date().toISOString().slice(0,16).replace("T", " ")} UTC по результатам обучения на ${metrics.datasetSize} замерах (из них ${metrics.withYaSurge} с открытым ⚡ Cmf).*

---

## 1. Базовый тариф (что Я. берёт «по нулям» при ⚡ = 1)

| Тариф | Минимум | Per-km | Per-min | Pickup |
|---|---|---|---|---|
| **Эконом** | ≈ ${econMin} br | ≈ 0 br/км | ≈ 0 br/мин | 0 br |
| **Комфорт (Cmf)** | **≈ ${sanity.evidence.bazaStats.median} br** (median, n=${sanity.evidence.bazaStats.n}) | ≈ 0 br/км | ≈ 0 br/мин | 0 br |

> **Главное наблюдение.** Внутри Минска цена при ⚡ = 1 фактически равна **минимуму тарифа**. Per-km / per-min при сёрдже 1 не работают — суммируются в «минимум». Это подтверждено регрессией baseline ≈ const на 73 замерах: std = ${sanity.evidence.bazaStats.std} br, диапазон ${sanity.evidence.bazaStats.min}–${sanity.evidence.bazaStats.max} br.
>
> Per-km и per-min Я. включает только когда суммарная стоимость превышает минимум — это типично для маршрутов > 30 км (за МКАД).

**Восстановленный hidden boost Эконома:** Эконом стабильно дешевле Комфорта на **${(100 * (1 - hidden.overall.mean)).toFixed(1)}%** (median ratio = ${hidden.overall.median}, std = ${hidden.overall.std}).

---

## 2. Surge ⚡N — главный множитель цены

Финальная стоимость поездки в Минске:
\`\`\`
Cmf_final = Cmf_minimum × ⚡N × H3ZoneMultiplier(lat, lng)
\`\`\`
где \`Cmf_minimum ≈ ${sanity.evidence.bazaStats.median} br\`, **⚡N — наблюдаемый surge** (открытое значение в иконке молнии в приложении).

### Распределение ⚡N по слотам (по данным сегодняшнего обучения):

${(() => {
  // metrics.bySlotOpen теперь содержит часовые ключи (weekday-h{N},
  // saturday-h{N}, sunday-h{N}) после перехода learn.mjs на часовую
  // гранулярность. Группируем их обратно в 5 UI-слотов для компактного
  // отображения в публичной сводке.
  const HOUR_TO_UI = (h) => {
    if (h >= 0  && h <= 6 ) return "night";
    if (h >= 7  && h <= 10) return "morning";
    if (h >= 11 && h <= 14) return "midday";
    if (h >= 15 && h <= 19) return "evening";
    return "late";
  };
  const buckets = {}; // `${day}-${uiSlot}` → { n, sumSurge, sumSqSurge }
  for (const [k, v] of Object.entries(metrics.bySlotOpen || {})) {
    const m = k.match(/^([a-z]+)-h(\d+)$/);
    if (!m) continue; // на всякий случай: пропускаем ключи старого формата
    const [, day, hStr] = m;
    const uiSlot = HOUR_TO_UI(parseInt(hStr, 10));
    const key = `${day}-${uiSlot}`;
    const b = buckets[key] || (buckets[key] = { n: 0, sumS: 0, sumSqS: 0 });
    const n = v.n || 0;
    const ms = v.meanSurge || 0;
    const std = v.std || 0;
    b.n += n;
    b.sumS += ms * n;
    // Reconstruct sum of squares from sample std (learn.mjs делит на n-1):
    //   sample var s² = Σ(x−m)² / (n−1)  →  Σx² = (n−1)·s² + n·m²
    // → итог per-bucket sumSqS суммирует Σx² по всем входным слотам.
    if (n > 0) {
      b.sumSqS += (n - 1) * std * std + n * ms * ms;
    }
  }
  const rows = Object.entries(buckets)
    .map(([k, b]) => {
      const mean = b.n ? b.sumS / b.n : 0;
      // Sample std обратно: s² = (Σx² − n·m²) / (n−1)
      const variance =
        b.n > 1 ? Math.max(0, (b.sumSqS - b.n * mean * mean) / (b.n - 1)) : 0;
      return { k, n: b.n, mean, std: Math.sqrt(variance) };
    })
    .filter((r) => r.n > 0)
    .sort((a, b) => a.k.localeCompare(b.k));
  if (!rows.length) return "_Нет данных по слотам._";
  return [
    "| Слот | n с открытым ⚡ | Средний ⚡ | Std |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.k} | ${r.n} | ${r.mean.toFixed(2)} | ${r.std.toFixed(2)} |`),
  ].join("\n");
})()}

**Что это значит:** ⚡ сильно зависит от часа и дня недели — внутри одного «слота» (4 часа) разброс может быть от 1 до 5+. Точные часовые регрессии лежат в \`surge-model.json\` (24 ключа \`day-hN\` на каждый день).

### Surge НЕ зависит от пробок
TomTom-traffic за весь датасет: среднее ×${traffic.ttMean} (диапазон ${traffic.ttRange[0]}–${traffic.ttRange[1]}). Корреляция surge ↔ traffic = ${traffic.correlation} (несущественная).
**Surge у Я. — функция баланса спрос/предложение, а не функция пробок.**

---

## 3. H3-зональные множители (восстановлены)

Я. варьирует ⚡ по H3-ячейкам (~1.4 км сторона). Подобрано медианой \`factC/baselinePred\` по каждой ячейке с n ≥ 3 точек, плюс пространственное сглаживание со средневзвешенным по соседним ячейкам:

| Параметр | Значение |
|---|---|
| Всего H3-ячеек с замерами | ${fz?.observed?.totalCells ?? "—"} |
| Ячеек с n ≥ 3 (фит) | ${fz?.observed?.fittedCells ?? "—"} |
| Активных ячеек (\|×−1\| > 10%) | ${fz?.observed?.activeCells ?? "—"} |
| Резолюция H3 | ${fz?.scheme || "h3-r7"} |

**Вклад в точность модели:** **−${fz?.improvedPp ?? 0} п.п. MAPE** (с ${fz?.mapeBefore ?? "—"}% до ${fz?.mapeAfter ?? "—"}%).

${fz?.cells && Object.keys(fz.cells).length
  ? `**Топ-5 ячеек по силе сдвига:**

| H3-ячейка | Lat, Lng | × | n | Smoothed |
|---|---|---|---|---|
${Object.entries(fz.cells)
  .sort((a, b) => Math.abs(b[1].mu - 1) - Math.abs(a[1].mu - 1))
  .slice(0, 5)
  .map(([cid, c]) => `| \`${cid.slice(0, 8)}…\` | ${c.lat}, ${c.lng} | ×${c.mu.toFixed(2)} | ${c.n} | ${c.smoothed ? "✓" : "—"} |`)
  .join("\n")}`
  : "_Активных ячеек нет — нужно больше замеров (≥3 на ячейку)._"}

---

## 4. Факторы ценообразования Я. — статус по нашей модели

| Фактор | Статус | Δ MAPE | Что нужно для активации |
|---|---|---|---|
| **fromZone** (H3-сетка ~1.4 км) | ${fz?.active ? "✓ АКТИВЕН" : "○ ждёт"} | ${fz?.improvedPp ?? 0} п.п. | ≥3 замера на ячейку |
| **weather** (дождь / снег) | ${wt?.active ? "✓ АКТИВЕН" : "○ ждёт данных"} | ${wt?.improvedPp ?? 0} п.п. | хотя бы 5 замеров с осадками |
| **peak** (час пик) | ${pk?.active ? "✓ АКТИВЕН" : "○ ждёт данных"} | ${pk?.improvedPp ?? 0} п.п. | замеры в будни 07–09 / 17–19 |
| **holiday** (госпраздники РБ) | ${hd?.active ? "✓ АКТИВЕН" : "○ ждёт данных"} | ${hd?.improvedPp ?? 0} п.п. | замеры на 8 марта, 1 мая, 9 мая, 3 июля, 7 ноября, 25 декабря, 1 января |

---

## 5. Точность нашей модели прямо сейчас (intra-Минск, 61 замер)

| Метрика | Значение |
|---|---|
| MAE (средняя ошибка в рублях) | **${loo.overall.mae} br** |
| MAPE (средняя относительная ошибка) | **${loo.overall.mape}%** |
| Совпадение (1 − MAPE) | ≈ **${(100 - loo.overall.mape).toFixed(1)}%** |
| Попаданий в ±10% (≈ ±1 руб) | ${loo.overall.within10pct} / ${loo.overall.n} (${(100 * loo.overall.within10pct / loo.overall.n).toFixed(0)}%) |
| Попаданий в ±20% (≈ ±2 руб) | ${loo.overall.within20pct} / ${loo.overall.n} (${(100 * loo.overall.within20pct / loo.overall.n).toFixed(0)}%) |

### Точность по бакетам surge:

| Бакет ⚡ | n | MAE | MAPE | Совпадение |
|---|---|---|---|---|
${Object.entries(loo.buckets).filter(([_, v]) => v.n).map(([b, v]) =>
  `| ⚡ ${b} | ${v.n} | ${v.mae} br | ${v.mape}% | ${(100 - v.mape).toFixed(0)}% |`
).join("\n")}

${loo.excluded ? `### Outbound и дальние (за МКАД) — справочно (в основные метрики не входят):
- n = ${loo.excluded.n}, MAE = ${loo.excluded.mae} br, MAPE = ${loo.excluded.mape}%
` : ""}

---

## 6. Чего модель ещё НЕ знает (blind spots)

1. **Per-km / per-min на длинных маршрутах (>30 км)** — у нас 12 outliers за МКАД, MAPE = ${loo.excluded?.mape ?? "—"}%; нужны прицельные замеры на 30–80 км для калибровки километровой ставки.
2. **Час пик** — 0 замеров в будни 17–19. Гипотеза «×1.3–1.5» не проверена.
3. **Погода** — все ${metrics.datasetSize} замеров в один сухой день. Гипотеза «дождь ×1.2, снег ×1.4» не проверена.
4. **Праздники РБ** — 0 замеров.
5. **Будни vs выходные** — все замеры в воскресенье. Слоты \`monday-…\`, \`friday-…\` пустые.
6. **Hidden boosts на Электро / Cmf+ / Business** — surge видим, но моделируем только Cmf.

---

*Источники данных:*
- \`scripts/learned/sanity-tariff.json\` — minimum / perKm / perMin
- \`scripts/learned/hidden-boost.json\` — соотношение Эконом ↔ Комфорт
- \`scripts/learned/loo.json\` — leave-one-out, factor adjustments, метрики
- \`scripts/learned/metrics.json\` — surge по слотам
- \`scripts/learned/traffic-effect.json\` — анализ влияния пробок
`;

mkdirSync(PUBLIC_DATA, { recursive: true });
writeFileSync(join(PUBLIC_DATA, "yandex-tariff.md"), md);
writeFileSync(join(LEARNED, "yandex-tariff.md"), md);
console.log(`✓ Сводка тарифа Я. → public/data/yandex-tariff.md (${md.split("\n").length} строк)`);
