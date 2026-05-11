import { useQuery } from "@tanstack/react-query";

type LooBucket = { n: number; mae: number | null; mape: number | null };
type LooCategory = LooBucket & { within10pct: number; within20pct: number };
type LooReport = {
  generatedAt: string;
  n: number;
  overall: {
    n: number;
    mae: number | null;
    mape: number | null;
    within10pct: number;
    within20pct: number;
  };
  buckets: Record<string, LooBucket>;
  categories?: Record<string, LooCategory>;
};

// Цифры предыдущей коррекции — захардкожены для отображения дельты.
// Обновляются вручную после каждой большой правки модели.
// 11-й прогон сохранил алгоритм 10-го (попытки стратификации по категории
// маршрута дали ХУЖЕ из-за дефицита данных), поэтому база та же — 28%.
const PREV_OVERALL = { mape: 28.0, within10: 25, within20: 34 };
const PREV_BUCKETS: Record<string, number> = {
  "<1": 47.3,
  "1-2": 20.2,
  "2-3": 28.1,
  "≥3": 44.2,
};

function fmtDelta(curr: number, prev: number, lowerBetter = true): string {
  const d = curr - prev;
  if (Math.abs(d) < 0.05) return "";
  const sign = d > 0 ? "+" : "";
  const ok = lowerBetter ? d < 0 : d > 0;
  return ` (${sign}${d.toFixed(1)}${ok ? " ✓" : ""})`;
}

const BUCKET_ORDER = ["<1", "1-2", "2-3", "≥3"] as const;
const BUCKET_LABEL: Record<string, string> = {
  "<1": "⚡<1 (низкий спрос)",
  "1-2": "⚡1–2 (норма)",
  "2-3": "⚡2–3 (повышенный)",
  "≥3": "⚡≥3 (загородные)",
};

export function CalibrationAccuracy() {
  const q = useQuery<LooReport>({
    queryKey: ["loo-report"],
    queryFn: async () => {
      const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
      const res = await fetch(`${base}data/loo.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });

  if (q.isLoading)
    return (
      <section className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded p-3 text-xs">
        Загружаю метрики…
      </section>
    );

  if (q.isError || !q.data)
    return (
      <section className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded p-3 text-xs">
        Не удалось загрузить loo.json — карта работает, но метрики недоступны.
      </section>
    );

  const r = q.data;
  const pct = (a: number, b: number) =>
    b ? Math.round((a / b) * 100) : 0;

  return (
    <section
      data-testid="calibration-accuracy"
      className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded p-3 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-sm">
          Точность модели после коррекции
        </h3>
        <span className="text-[10px] text-muted-foreground font-mono">
          обновлено {new Date(r.generatedAt).toLocaleString("ru-RU", {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Leave-one-out по {r.overall.n} заказам с открытым ⚡N. Каждый раз
        модель «забывает» одну точку и пытается её предсказать на остальных.
      </p>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-white/60 dark:bg-black/20 rounded p-2">
          <div className="text-[10px] text-muted-foreground uppercase">
            MAPE
          </div>
          <div className="text-lg font-bold tabular-nums">
            {r.overall.mape}%
          </div>
          <div className="text-[10px] text-muted-foreground">
            было {PREV_OVERALL.mape}%
            {fmtDelta(r.overall.mape ?? 0, PREV_OVERALL.mape)}
          </div>
        </div>
        <div className="bg-white/60 dark:bg-black/20 rounded p-2">
          <div className="text-[10px] text-muted-foreground uppercase">
            ±10%
          </div>
          <div className="text-lg font-bold tabular-nums">
            {r.overall.within10pct}/{r.overall.n}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {pct(r.overall.within10pct, r.overall.n)}% — было{" "}
            {PREV_OVERALL.within10}/{r.overall.n}
          </div>
        </div>
        <div className="bg-white/60 dark:bg-black/20 rounded p-2">
          <div className="text-[10px] text-muted-foreground uppercase">
            ±20%
          </div>
          <div className="text-lg font-bold tabular-nums">
            {r.overall.within20pct}/{r.overall.n}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {pct(r.overall.within20pct, r.overall.n)}% — было{" "}
            {PREV_OVERALL.within20}/{r.overall.n}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-[11px] font-semibold text-muted-foreground">
          По бакетам ⚡N
        </div>
        <table className="w-full text-[11px] tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left font-normal">Бакет</th>
              <th className="text-right font-normal">n</th>
              <th className="text-right font-normal">MAPE</th>
              <th className="text-right font-normal">было</th>
              <th className="text-right font-normal">Δ</th>
            </tr>
          </thead>
          <tbody>
            {BUCKET_ORDER.map((b) => {
              const cur = r.buckets[b];
              if (!cur || !cur.n) return null;
              const prev = PREV_BUCKETS[b];
              const d = (cur.mape ?? 0) - prev;
              const better = d < -0.05;
              return (
                <tr key={b} className="border-t border-emerald-200/60 dark:border-emerald-900/60">
                  <td className="text-left">{BUCKET_LABEL[b]}</td>
                  <td className="text-right">{cur.n}</td>
                  <td className="text-right font-medium">{cur.mape}%</td>
                  <td className="text-right text-muted-foreground">{prev}%</td>
                  <td
                    className={`text-right ${
                      better
                        ? "text-emerald-700 dark:text-emerald-400"
                        : Math.abs(d) < 0.5
                          ? "text-muted-foreground"
                          : "text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {d > 0 ? "+" : ""}
                    {d.toFixed(1)}
                    {better ? " ✓" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {r.categories && (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground">
            По типу маршрута
          </div>
          <table className="w-full text-[11px] tabular-nums">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left font-normal">Тип</th>
                <th className="text-right font-normal">n</th>
                <th className="text-right font-normal">MAPE</th>
                <th className="text-right font-normal">±10%</th>
                <th className="text-right font-normal">±20%</th>
              </tr>
            </thead>
            <tbody>
              {(["intra", "outbound", "far"] as const).map((c) => {
                const cur = r.categories?.[c];
                if (!cur) return null;
                const label =
                  c === "intra"
                    ? "🏙️ В пределах Минска"
                    : c === "outbound"
                      ? "🏘️ В пригород (Гатово, Боровляны)"
                      : "🌍 Дальние (>50 км: Сутоки, Морочь)";
                const isWeak = cur.n < 10 || (cur.mape ?? 0) > 35;
                return (
                  <tr
                    key={c}
                    className="border-t border-emerald-200/60 dark:border-emerald-900/60"
                  >
                    <td className="text-left">{label}</td>
                    <td
                      className={`text-right ${cur.n < 10 ? "text-amber-700 dark:text-amber-400 font-semibold" : ""}`}
                    >
                      {cur.n}
                    </td>
                    <td
                      className={`text-right font-medium ${isWeak ? "text-amber-700 dark:text-amber-400" : ""}`}
                    >
                      {cur.mape}%
                    </td>
                    <td className="text-right">
                      {cur.within10pct}/{cur.n}
                    </td>
                    <td className="text-right">
                      {cur.within20pct}/{cur.n}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
            ⚠ Outbound и far — &lt;10 точек на категорию. Промахи в этих
            бакетах — следствие дефицита данных, а не алгоритма. Следующие
            калибровки целенаправленно набирают пригородные направления.
          </p>
        </div>
      )}

      <details className="text-[11px] mt-1">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Что изменилось в этой версии (11-й прогон)
        </summary>
        <ul className="list-disc pl-5 pt-1 space-y-1 text-muted-foreground">
          <li>
            <b>Введён классификатор типа маршрута:</b> intra (внутри Минска),
            outbound (Гатово, Боровляны, Ждановичи), far (&gt;50 км — Сутоки,
            Морочь). Категория видна для каждого заказа в разборе и в
            таблице выше.
          </li>
          <li>
            <b>Стратификация регрессии по категории — отвергнута.</b>{" "}
            Пробовали два варианта (фильтр peers и категория как 4-я фича) —
            оба дали MAPE 35–37% вместо 28%. Причина не алгоритмическая, а
            data-side: 60 точек × 4 слота × 3 категории — слишком разреженно
            (особенно outbound: 8 точек, far: 4 точки на сейчас).
          </li>
          <li>
            <b>Главный вывод для следующих калибровок:</b> алгоритм оставлен
            как был (MAPE 28% — оптимум для текущей выборки). План — набрать
            ≥15 outbound и ≥10 far точек, после этого включить категорийную
            регрессию (код {`lstsqN`} уже готов).
          </li>
          <li>
            <b>Разбор каждого заказа теперь показывает категорию маршрута</b>{" "}
            (intra/outbound/far) — чтобы видеть, в какой категории промах.
          </li>
        </ul>
      </details>
    </section>
  );
}
