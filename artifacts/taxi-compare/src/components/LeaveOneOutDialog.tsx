import React, { useEffect, useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";

type RouteCategory = "intra" | "outbound" | "far";

type LooItem = {
  id: string;
  date: string;
  slot: string;
  routeCategory?: RouteCategory;
  from: string;
  to: string;
  km: number;
  min: number;
  ttMult: number;
  factC: number;
  factE: number;
  yaSurgeC: number;
  predictedSurge: number;
  predictedC: number;
  err: number;
  errPct: number;
  absPct: number;
  verdict: "good" | "overshoot" | "undershoot";
  isAnomaly?: boolean;
  fallback: string | null;
  reason: string;
};

type AnomalyItem = {
  id: string;
  date: string;
  slot: string;
  routeCategory: RouteCategory;
  from: string;
  to: string;
  km: number;
  factC: number;
  predictedC: number;
  errPct: number;
  absPct: number;
  verdict: LooItem["verdict"];
  yaSurgeC: number | null;
  h3Cell: string | null;
  fromZone: string | null;
  ttMult: number;
  reason: string;
};

type AnomalyBlock = {
  threshold: number;
  n: number;
  ofTotal: number;
  shareOfData: number;
  items: AnomalyItem[];
};

type LooCategoryAgg = {
  n: number;
  mae: number | null;
  mape: number | null;
  within10pct: number;
  within20pct: number;
};

type FactorMode = "weather" | "peak" | "fromZone" | "hour" | "holiday";

type H3CellInfo = {
  mu: number;
  n: number;
  lat: number;
  lng: number;
  smoothed: boolean;
};

type HourInfo = {
  mu: number;
  n: number;
  smoothed: boolean;
};

type FactorAdjustment = {
  mode: FactorMode;
  active: boolean;
  coefs: Record<string, number> | null;
  cells?: Record<string, H3CellInfo>;
  hours?: Record<string, HourInfo>;
  scheme?: string;
  reason: string;
  observed: Record<string, number>;
  mapeBefore: number | null;
  mapeAfter: number | null;
  improvedPp: number | null;
};

const OBS_LABEL: Record<string, string> = {
  wetN: "с дождём", snowN: "со снегом",
  peakN: "час пик", offN: "вне пика",
  holidayN: "праздник", regularN: "обычные",
  totalCells: "H3-ячеек", fittedCells: "n≥3", activeCells: "активных", withCoords: "с координатами",
  totalHours: "часов", fittedHours: "n≥3", activeHours: "активных", withHour: "с часом",
};

type CategoryMultiplier = {
  label: string;
  active: boolean;
  mult: number;
  n: number;
  mapeBefore: number | null;
  mapeAfter: number | null;
  improvedPp: number | null;
  reason: string;
};

type LooReport = {
  generatedAt: string;
  n: number;
  overall: {
    n: number;
    mae: number;
    mape: number;
    within10pct: number;
    within20pct: number;
  };
  buckets: Record<string, { n: number; mae: number | null; mape: number | null }>;
  categories?: Record<RouteCategory, LooCategoryAgg>;
  factorAdjustments?: FactorAdjustment[];
  categoryMultipliers?: { outbound: CategoryMultiplier; far: CategoryMultiplier };
  anomalies?: AnomalyBlock;
  items: LooItem[];
};

const FACTOR_LABEL: Record<FactorMode, { icon: string; title: string; hint: string }> = {
  weather:  { icon: "🌧️", title: "Погода",          hint: "Open-Meteo: дождь / снег / температура" },
  peak:     { icon: "⏰", title: "Час пик",          hint: "Будни 07-09 / 17-19" },
  fromZone: { icon: "🗺️", title: "H3-зона старта",  hint: "Гексы ~1.4 км по координатам, фит per-cell + сглаживание с соседями" },
  hour:     { icon: "🕒", title: "Час суток",        hint: "Корректирует слотовую регрессию на провалы внутри слота: per-hour median + сглаживание ±1 час" },
  holiday:  { icon: "🎉", title: "Праздник РБ",      hint: "Гос. праздники Беларуси 2025-2026" },
};

const CATEGORY_LABEL: Record<RouteCategory, { short: string; long: string }> = {
  intra:    { short: "🏙️ Минск",     long: "🏙️ В пределах Минска" },
  outbound: { short: "🏘️ пригород", long: "🏘️ В пригород (Гатово, Боровляны)" },
  far:      { short: "🌍 дальний",   long: "🌍 Дальние (>50 км)" },
};

const VERDICT_BADGE: Record<LooItem["verdict"], { label: string; cls: string }> = {
  good:        { label: "✅ попали",    cls: "bg-green-100 text-green-800 border-green-300" },
  overshoot:   { label: "⚠ переоценка", cls: "bg-amber-100 text-amber-900 border-amber-300" },
  undershoot:  { label: "⚠ недооценка", cls: "bg-red-100 text-red-800 border-red-300" },
};

interface LeaveOneOutDialogProps {
  controlledOpen?: boolean;
  onControlledOpenChange?: (v: boolean) => void;
  hideTrigger?: boolean;
}

export default function LeaveOneOutDialog({
  controlledOpen,
  onControlledOpenChange,
  hideTrigger,
}: LeaveOneOutDialogProps = {}) {
  const [data, setData] = useState<LooReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onControlledOpenChange ?? setInternalOpen;

  useEffect(() => {
    if (!open || data) return;
    const url = `${import.meta.env.BASE_URL}data/loo.json`;
    setErr(null);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        setErr(null);
        setData(j);
      })
      .catch((e) => setErr(String(e?.message ?? e)));
  }, [open, data]);

  const sortedItems = useMemo(() => {
    if (!data) return [];
    // последние сверху (по дате потом по id), а внутри даты — сначала промахи
    return [...data.items].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      // в одной дате — большие |err%| сверху
      return b.absPct - a.absPct;
    });
  }, [data]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-8"
          data-testid="btn-loo"
        >
          <Activity className="w-3.5 h-3.5 mr-1" />
          Сверка с Я.
        </Button>
      </DialogTrigger>
      )}
      <DialogContent className="w-[calc(100vw-1rem)] max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Сверка прогноза с Яндекс (leave-one-out)</DialogTitle>
          <DialogDescription>
            Для каждого замера модель пересчитывалась без него и предсказывала Cmf.
            Это честная метрика — модель никогда не «видела» точку, которую предсказывает.
          </DialogDescription>
        </DialogHeader>

        {err && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
            Не смог загрузить отчёт: {err}.
            Запустите <code className="bg-white px-1 rounded">pnpm learn</code> и пересоберите.
          </div>
        )}

        {!data && !err && <div className="text-sm text-muted-foreground">Загружаю…</div>}

        {data && (
          <ScrollArea className="max-h-[72vh] pr-4">
            <div className="space-y-4 text-sm">
              {/* SUMMARY */}
              <section className="bg-muted/40 rounded p-3">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                  <div><b>n</b> = {data.overall.n} замеров с открытым ⚡N</div>
                  <div><b>MAE</b> = {data.overall.mae} br</div>
                  <div><b>MAPE</b> = {data.overall.mape}%</div>
                  <div>в ±10%: {data.overall.within10pct}/{data.overall.n}</div>
                  <div>в ±20%: {data.overall.within20pct}/{data.overall.n}</div>
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Сгенерировано: {new Date(data.generatedAt).toLocaleString("ru-RU")}
                </div>
              </section>

              {/* ANOMALIES — точки с |err| ≥ 30% — кандидаты на ручную перепроверку */}
              {data.anomalies && data.anomalies.n > 0 && (
                <section
                  className="border border-rose-300 bg-rose-50/60 rounded p-3"
                  data-testid="anomalies-block"
                >
                  <h3 className="font-semibold mb-1 text-rose-900">
                    🚨 Аномалии прогноза
                    <span className="ml-2 text-[11px] font-normal text-rose-700/80">
                      |err| ≥ {data.anomalies.threshold}% · {data.anomalies.n} из{" "}
                      {data.anomalies.ofTotal} ({data.anomalies.shareOfData}%)
                    </span>
                  </h3>
                  <p className="text-[10px] text-rose-800/80 mb-2">
                    Эти замеры модель промахнула сильнее всего. Скорее всего здесь
                    либо ошибка ввода, либо реальный сдвиг сёрджа в ячейке/слоте,
                    где соседних точек мало. Кандидаты на повторный замер.
                  </p>
                  <div className="space-y-1.5">
                    {data.anomalies.items.map((a) => {
                      const sign = a.errPct >= 0 ? "+" : "";
                      const verdictMeta = VERDICT_BADGE[a.verdict];
                      return (
                        <div
                          key={a.id}
                          className="bg-white border border-rose-200 rounded px-2 py-1.5 text-[11px]"
                          data-testid={`anomaly-${a.id}`}
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="font-mono text-[10px] text-rose-700">
                              #{a.id} · {a.date} · {a.slot}
                            </div>
                            <Badge
                              variant="outline"
                              className={"text-[10px] " + verdictMeta.cls}
                            >
                              {verdictMeta.label} {sign}
                              {a.errPct}%
                            </Badge>
                          </div>
                          <div className="mt-0.5 text-[11px]">
                            <b>{a.from}</b> → <b>{a.to}</b>
                            <span className="ml-2 text-muted-foreground">
                              {a.km} км · {CATEGORY_LABEL[a.routeCategory].short}
                            </span>
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-rose-900">
                            факт = {a.factC} br · прогноз = {a.predictedC} br
                            {a.yaSurgeC != null && (
                              <span className="ml-2">⚡{a.yaSurgeC.toFixed(2)}</span>
                            )}
                            {a.h3Cell && (
                              <span className="ml-2 text-rose-700/70">
                                · H3 {a.h3Cell.slice(0, 7)}…
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            {a.reason}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* FACTOR ADJUSTMENTS (Yandex-style multipliers) */}
              {data.factorAdjustments && data.factorAdjustments.length > 0 && (
                <section>
                  <h3 className="font-semibold mb-2">
                    Активные факторы Яндекса
                    <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                      (множители поверх baseline ⚡N — включаются только если улучшают MAPE ≥ 0.2 п.п.)
                    </span>
                  </h3>
                  <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
                    ⚠ Методологическая оговорка: множители подобраны на тех же
                    точках LOO, на которых меряем итоговый MAPE (без nested
                    cross-validation). Реальный gain на новых данных скорее всего
                    будет на 0.3–0.7 п.п. ниже отчётного.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {data.factorAdjustments.map((f) => {
                      const meta = FACTOR_LABEL[f.mode];
                      return (
                        <div
                          key={f.mode}
                          className={
                            "border rounded p-2 text-xs " +
                            (f.active
                              ? "bg-emerald-50 border-emerald-300"
                              : "bg-slate-50 border-slate-200")
                          }
                          data-testid={`factor-${f.mode}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-medium">
                              <span className="mr-1">{meta.icon}</span>
                              {meta.title}
                            </div>
                            <Badge
                              variant="outline"
                              className={
                                "text-[10px] " +
                                (f.active
                                  ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                                  : "bg-slate-100 text-slate-600 border-slate-300")
                              }
                            >
                              {f.active ? "✓ активен" : "○ ждёт данных"}
                            </Badge>
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{meta.hint}</div>
                          <div className="mt-1.5 text-[11px]">{f.reason}</div>
                          {f.active && f.mode === "fromZone" && f.cells && Object.keys(f.cells).length > 0 && (
                            <div className="mt-1.5">
                              <div className="text-[10px] font-medium text-emerald-900 mb-1">
                                Топ-5 H3-ячеек по силе сдвига:
                              </div>
                              <div className="space-y-0.5 font-mono text-[10px] text-emerald-900">
                                {Object.entries(f.cells)
                                  .sort((a, b) => Math.abs(b[1].mu - 1) - Math.abs(a[1].mu - 1))
                                  .slice(0, 5)
                                  .map(([cid, c]) => (
                                    <div key={cid} className="flex justify-between">
                                      <span>
                                        {c.lat.toFixed(3)}, {c.lng.toFixed(3)}
                                        <span className="ml-1 text-emerald-700/70">
                                          {c.smoothed ? "▲ smoothed" : "○ raw"}
                                        </span>
                                      </span>
                                      <span>
                                        ×{c.mu.toFixed(2)}
                                        <span className="ml-1 text-emerald-700/70">n={c.n}</span>
                                      </span>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}
                          {f.active && f.mode === "hour" && f.hours && Object.keys(f.hours).length > 0 && (
                            <div className="mt-1.5">
                              <div className="text-[10px] font-medium text-emerald-900 mb-1">
                                Активные часы суток (топ-8 по силе сдвига):
                              </div>
                              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-emerald-900">
                                {Object.entries(f.hours)
                                  .sort((a, b) => Math.abs(b[1].mu - 1) - Math.abs(a[1].mu - 1))
                                  .slice(0, 8)
                                  .map(([h, info]) => (
                                    <div key={h} className="flex justify-between">
                                      <span>
                                        {String(h).padStart(2, "0")}:00
                                        <span className="ml-1 text-emerald-700/70">
                                          {info.smoothed ? "▲" : "○"}
                                        </span>
                                      </span>
                                      <span>
                                        ×{info.mu.toFixed(2)}
                                        <span className="ml-1 text-emerald-700/70">n={info.n}</span>
                                      </span>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}
                          {f.active && f.mode !== "fromZone" && f.mode !== "hour" && f.coefs && (
                            <div className="mt-1 font-mono text-[10px] text-emerald-900">
                              {Object.entries(f.coefs).map(([k, v]) => (
                                <span key={k} className="mr-2">
                                  {k}×{(v as number).toFixed(2)}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            замеров:{" "}
                            <b>
                              {Object.entries(f.observed || {})
                                .map(([k, v]) => `${OBS_LABEL[k] ?? k}: ${v}`)
                                .join(" · ")}
                            </b>
                            {f.improvedPp !== null && f.improvedPp !== 0 && (
                              <span className="ml-2">
                                · MAPE: {f.mapeBefore?.toFixed(1)}% →{" "}
                                <b className="text-emerald-700">{f.mapeAfter?.toFixed(1)}%</b>{" "}
                                (Δ −{f.improvedPp.toFixed(2)} п.п.)
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* BUCKETS */}
              <section>
                <h3 className="font-semibold mb-2">Точность по бакетам ⚡N</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {Object.entries(data.buckets).map(([k, v]) => (
                    <div
                      key={k}
                      className="bg-white border rounded p-2 text-xs"
                      data-testid={`bucket-${k}`}
                    >
                      <div className="font-mono text-[11px] text-muted-foreground">⚡{k}</div>
                      <div>n = {v.n}</div>
                      {v.n > 0 && (
                        <>
                          <div>MAE = <b>{v.mae}</b> br</div>
                          <div>MAPE = <b>{v.mape}%</b></div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* CATEGORY BREAKDOWN */}
              {data.categories && (
                <section>
                  <h3 className="font-semibold mb-2">Точность по типу маршрута</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {(Object.keys(CATEGORY_LABEL) as RouteCategory[]).map((cat) => {
                      const c = data.categories?.[cat];
                      if (!c) return null;
                      const lowConfidence = c.n < 10;
                      return (
                        <div
                          key={cat}
                          className={
                            "border rounded p-2 text-xs " +
                            (lowConfidence
                              ? "bg-amber-50 border-amber-300"
                              : "bg-white border-slate-200")
                          }
                          data-testid={`category-${cat}`}
                        >
                          <div className="font-medium">{CATEGORY_LABEL[cat].long}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            n = {c.n}
                            {lowConfidence && (
                              <span className="ml-1 text-amber-700">· мало данных</span>
                            )}
                          </div>
                          {c.n > 0 && c.mae !== null && c.mape !== null && (
                            <div className="mt-1">
                              MAE = <b>{c.mae}</b> br · MAPE = <b>{c.mape}%</b>
                              <div className="text-[10px] text-muted-foreground">
                                в ±10%: {c.within10pct}/{c.n} · в ±20%: {c.within20pct}/{c.n}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Дальние и пригородные маршруты пока с высокой ошибкой — нужно
                    больше калибровочных замеров за пределами МКАД.
                  </p>
                </section>
              )}

              {/* CATEGORY MULTIPLIERS (outbound / far) */}
              {data.categoryMultipliers && (
                <section>
                  <h3 className="font-semibold mb-2">
                    Множители для outbound / far
                    <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                      (отдельный коэффициент для маршрутов за МКАД, обучается на медиане factC/predictedC)
                    </span>
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {(["outbound", "far"] as const).map((k) => {
                      const m = data.categoryMultipliers?.[k];
                      if (!m) return null;
                      return (
                        <div
                          key={k}
                          className={
                            "border rounded p-2 text-xs " +
                            (m.active
                              ? "bg-emerald-50 border-emerald-300"
                              : "bg-slate-50 border-slate-200")
                          }
                          data-testid={`category-mult-${k}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-medium">
                              {k === "outbound" ? "🏘️ Outbound (Гатово, Боровляны…)" : "🌍 Far (>50 км)"}
                            </div>
                            <Badge
                              variant="outline"
                              className={
                                "text-[10px] " +
                                (m.active
                                  ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                                  : "bg-slate-100 text-slate-600 border-slate-300")
                              }
                            >
                              {m.active ? `✓ ×${m.mult.toFixed(2)}` : "○ ждёт данных"}
                            </Badge>
                          </div>
                          <div className="mt-1 text-[11px]">{m.reason}</div>
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            n = {m.n}
                            {m.mapeBefore !== null && m.mapeAfter !== null && (
                              <span className="ml-2">
                                MAPE: {m.mapeBefore.toFixed(1)}% →{" "}
                                <b className={m.active ? "text-emerald-700" : ""}>
                                  {m.mapeAfter.toFixed(1)}%
                                </b>
                                {m.improvedPp !== null && m.improvedPp > 0 && (
                                  <span className="ml-1">
                                    (Δ −{m.improvedPp.toFixed(1)} п.п.)
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Множитель ВКЛЮЧАЕТСЯ при |×−1| &gt; 0.15 и улучшении MAPE
                    ≥ 3 п.п. Применяется поверх baseline-прогноза только для
                    точек этой категории. Intra-Минск не затрагивается.
                  </p>
                </section>
              )}

              {/* ITEMS TABLE */}
              <section>
                <h3 className="font-semibold mb-2">
                  Последние замеры ({sortedItems.length}, сверху последние и крупнейшие промахи)
                </h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 bg-muted/80 z-10">
                      <tr className="text-left">
                        <th className="p-1.5 border-b">№</th>
                        <th className="p-1.5 border-b">Маршрут</th>
                        <th className="p-1.5 border-b">Тип</th>
                        <th className="p-1.5 border-b text-right">км</th>
                        <th className="p-1.5 border-b text-right">⚡Я.</th>
                        <th className="p-1.5 border-b text-right">⚡наш</th>
                        <th className="p-1.5 border-b text-right">факт Cmf</th>
                        <th className="p-1.5 border-b text-right">прогноз Cmf</th>
                        <th className="p-1.5 border-b text-right">Δ%</th>
                        <th className="p-1.5 border-b">Вердикт</th>
                        <th className="p-1.5 border-b">Обоснование</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedItems.map((it) => (
                        <tr key={`${it.date}-${it.slot}-${it.id}`} className="border-b hover:bg-muted/30 align-top">
                          <td className="p-1.5 font-mono">{it.id}</td>
                          <td className="p-1.5">
                            <div>{it.from}</div>
                            <div className="text-muted-foreground">→ {it.to}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {it.date} · {it.slot}
                            </div>
                          </td>
                          <td className="p-1.5 whitespace-nowrap text-[10px]">
                            {it.routeCategory ? CATEGORY_LABEL[it.routeCategory].short : "—"}
                          </td>
                          <td className="p-1.5 text-right">{it.km}</td>
                          <td className="p-1.5 text-right font-mono">{it.yaSurgeC.toFixed(2)}</td>
                          <td className="p-1.5 text-right font-mono">
                            {it.predictedSurge.toFixed(2)}
                            {it.fallback && (
                              <div className="text-[9px] text-muted-foreground">{it.fallback}</div>
                            )}
                          </td>
                          <td className="p-1.5 text-right font-mono">{it.factC}</td>
                          <td className="p-1.5 text-right font-mono">{it.predictedC}</td>
                          <td
                            className={
                              "p-1.5 text-right font-mono " +
                              (it.absPct < 10
                                ? "text-green-700"
                                : it.absPct < 25
                                ? "text-amber-700"
                                : "text-red-700")
                            }
                          >
                            {it.errPct >= 0 ? "+" : ""}
                            {it.errPct.toFixed(0)}%
                          </td>
                          <td className="p-1.5">
                            <Badge
                              variant="outline"
                              className={"text-[10px] " + VERDICT_BADGE[it.verdict].cls}
                            >
                              {VERDICT_BADGE[it.verdict].label}
                            </Badge>
                          </td>
                          <td className="p-1.5 text-[10px] max-w-[300px]">{it.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="bg-blue-50 border border-blue-200 rounded p-3 text-xs">
                <h3 className="font-semibold text-blue-900 mb-1">Как это считается</h3>
                <p className="text-blue-900/80">
                  Для каждого замера M внутри его слота (например, <code>sunday-midday</code>) мы
                  обучаем линейную регрессию <code>⚡N ≈ a + b·км + c·мин</code> на ВСЕХ остальных
                  точках слота, затем подставляем (км, мин) точки M и получаем
                  <code> ⚡наш</code>. Цена Cmf = ⚡наш × 10 br. Δ% = (прогноз − факт) / факт.
                  Для слотов с n &lt; 4 регрессия не определена — используется среднее по
                  оставшимся точкам (помечено <code>mean-by-slot</code>).
                </p>
              </section>

              <section className="bg-violet-50 border border-violet-200 rounded p-3 text-xs">
                <h3 className="font-semibold text-violet-900 mb-1">
                  🗺 Это не модель карты
                </h3>
                <p className="text-violet-900/80">
                  Сверка выше показывает качество <b>прогноза цены маршрута A→B</b>{" "}
                  (зональная модель + поправка Yandex-trend24h). На главной
                  карте сёрдж работает <b>трёхслойно</b>: к зональному
                  прогнозу добавляется глобальный множитель Yandex-trend24h{" "}
                  <i>и</i> локальный <b>live-overlay</b> — если в радиусе{" "}
                  ~0.7 км от центра гекса есть ≥2 свежих скринов
                  (&lt;6 часов), зональный прогноз для этого гекса заменяется{" "}
                  <b>фактическим surge</b>. Поэтому многие аномалии выше
                  (особенно «модель не сработала, ×1.00») на карте уже
                  исправлены — там, где есть свежие наблюдения, цвет гекса
                  показывает реальную пиковую цену. Полное описание — кнопка{" "}
                  <i>Methodology</i> на главной.
                </p>
              </section>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
