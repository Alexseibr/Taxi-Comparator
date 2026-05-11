// Админ-виджет «A/B сравнение моделей»: даёт оператору честный ответ
// на вопрос «новая модель лучше старой или нет?». Без этого мы катим
// переобучения вслепую — может MAPE упало, может выросло.
//
// Делает только GET-запросы к существующим эндпоинтам ML — никаких
// серверных правок не нужно:
//   • /version          — что сейчас активно (sv_20260501_200318 и т.д.)
//   • /metrics/history  — переобучения price-модели: old (baseline-эвристика)
//                          vs new (только что обученная) vs active (та что
//                          реально отдаёт /predict-price).
//   • /runs             — история тренировок fraud-моделей с AUC/F1/Precision.
//
// Логика:
//   1) Price (CatBoost+H3) — берём последний snapshot, показываем тройку
//      Baseline / Новая / Активная по MAPE_E и MAPE_C. Дельта = «насколько
//      новая лучше старого baseline».
//   2) Fraud (supervised) — берём 2 последних success-рана, считаем дельту
//      по каждой метрике (AUC, F1, Precision, Recall) и сравниваем top-5
//      признаков (что добавилось / выпало из топа).

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  GitCompare,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react";
import {
  fetchMlVersion,
  fetchMlPriceHistory,
  fetchMlRuns,
  type MlVersion,
  type MlPriceSnapshot,
  type MlFraudRun,
} from "@/lib/ml-client";

type Props = {
  open: boolean;
  onClose: () => void;
};

const AUTO_REFRESH_MS = 5 * 60 * 1000;

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtNum(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

/** Правило: для MAPE — снижение это хорошо, для AUC/F1 — рост это хорошо. */
function deltaBadge(
  curr: number | null,
  prev: number | null,
  lowerIsBetter: boolean,
) {
  if (curr === null || prev === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const d = curr - prev;
  if (Math.abs(d) < 1e-6) {
    return (
      <span className="text-xs text-muted-foreground inline-flex items-center gap-0.5">
        <Minus className="h-3 w-3" />
        0
      </span>
    );
  }
  const better = lowerIsBetter ? d < 0 : d > 0;
  const Icon = better ? TrendingDown : TrendingUp;
  // Визуально: «лучше» — зелёный, «хуже» — красный, независимо от знака.
  // У MAPE отрицательное лучше, у AUC положительное лучше.
  const color = better ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                       : "text-rose-700 bg-rose-50 border-rose-200";
  const sign = d > 0 ? "+" : "";
  // Для MAPE показываем процентные пункты (×100), для AUC — голые числа.
  const txt = lowerIsBetter
    ? `${sign}${(d * 100).toFixed(2)} п.п.`
    : `${sign}${d.toFixed(4)}`;
  return (
    <span className={`text-xs inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border ${color}`}>
      <Icon className="h-3 w-3" />
      {txt}
    </span>
  );
}

export function AdminModelABCompare({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [version, setVersion] = useState<MlVersion | null>(null);
  const [priceHistory, setPriceHistory] = useState<MlPriceSnapshot[]>([]);
  const [runs, setRuns] = useState<MlFraudRun[]>([]);

  const reload = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [v, ph, rs] = await Promise.all([
        fetchMlVersion(),
        fetchMlPriceHistory(50),
        fetchMlRuns(20),
      ]);
      if (!v && !ph && !rs) {
        setErr("ML недоступен — проверьте rwbtaxi-newstat-ml на VPS");
        setVersion(null);
        setPriceHistory([]);
        setRuns([]);
      } else {
        setVersion(v);
        setPriceHistory(ph?.items ?? []);
        setRuns(rs ?? []);
      }
    } catch (e) {
      setErr((e as Error).message || "network_error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void reload();
    const t = setInterval(() => void reload(), AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [open]);

  // Последний snapshot price-модели и предыдущий (если есть).
  // /metrics/history возвращает старое-первым, поэтому last = items[items.length-1].
  const priceCurr = priceHistory.length > 0 ? priceHistory[priceHistory.length - 1] : null;
  const pricePrev = priceHistory.length > 1 ? priceHistory[priceHistory.length - 2] : null;

  // Из всех runs берём только успешные supervised (это наша основная fraud-модель).
  // weak_supervised нам не интересен — это бутстрап, мы его не катим в прод.
  const supervisedRuns = useMemo(
    () =>
      runs
        .filter((r) => r.modelType === "supervised" && r.status === "success")
        .sort((a, b) => b.runId - a.runId), // свежий первым
    [runs],
  );
  const fraudCurr = supervisedRuns[0] ?? null;
  const fraudPrev = supervisedRuns[1] ?? null;

  // Diff top-5 features между двумя последними supervised runs.
  // Что добавилось в топ — кандидат на «новый сильный сигнал»; что выпало —
  // потеряло важность. Полезно объяснять заказчику почему поведение модели
  // изменилось.
  const featuresDiff = useMemo(() => {
    if (!fraudCurr) return null;
    const top = (r: MlFraudRun) => new Set(r.topFeatures.slice(0, 5).map((f) => f.name));
    const a = top(fraudCurr);
    const b = fraudPrev ? top(fraudPrev) : new Set<string>();
    const added = [...a].filter((x) => !b.has(x));
    const removed = [...b].filter((x) => !a.has(x));
    return { added, removed };
  }, [fraudCurr, fraudPrev]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-violet-600" />
            A/B сравнение моделей
          </DialogTitle>
          <DialogDescription>
            Активная модель vs baseline / предыдущий прогон. Видно стало
            лучше или хуже после очередного переобучения.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {version ? (
              <>
                <span>
                  <b>fraud:</b> {version.activeModelVersion || "—"} ({version.activeSource || "?"})
                </span>
                <span>
                  <b>price:</b> {priceCurr?.modelVersion || "—"}
                </span>
                {priceCurr?.trainedAt && (
                  <span>
                    обучена: {new Date(priceCurr.trainedAt).toLocaleString("ru-RU")}
                  </span>
                )}
              </>
            ) : (
              <span>—</span>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void reload()}
            disabled={loading}
            className="h-7 text-xs gap-1"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Обновить
          </Button>
        </div>

        {err && (
          <div className="flex items-center gap-2 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded p-2">
            <AlertCircle className="h-4 w-4" />
            {err}
          </div>
        )}

        {/* ────────── Price (CatBoost+H3) ────────── */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Модель цены (CatBoost+H3)</h3>
          <p className="text-xs text-muted-foreground">
            «Старая» — эвристика-baseline (то что было до ML). «Новая» —
            модель из последнего переобучения. «Активная» — та что реально
            обслуживает <code>/predict-price</code>. Если «активная» ≠ «новая»,
            значит свежая модель не прошла QA и не залита.
          </p>

          {!priceCurr ? (
            <div className="text-sm text-muted-foreground py-4 text-center border rounded">
              {loading ? "Загружаем…" : "Нет ни одного прогона переобучения price-модели"}
            </div>
          ) : (
            <div className="border rounded overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">Метрика</th>
                    <th className="text-right px-3 py-2">Старая (baseline)</th>
                    <th className="text-right px-3 py-2">Новая</th>
                    <th className="text-right px-3 py-2">Активная</th>
                    <th className="text-right px-3 py-2">Δ Новая − Старая</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-white">
                    <td className="px-3 py-1.5 font-medium">MAPE Эконом</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtPct(priceCurr.mapeEOld)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtPct(priceCurr.mapeENew)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtPct(priceCurr.mapeEActive)}</td>
                    <td className="px-3 py-1.5 text-right">{deltaBadge(priceCurr.mapeENew, priceCurr.mapeEOld, true)}</td>
                  </tr>
                  <tr className="bg-slate-50/50">
                    <td className="px-3 py-1.5 font-medium">MAPE Комфорт</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtPct(priceCurr.mapeCOld)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtPct(priceCurr.mapeCNew)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtPct(priceCurr.mapeCActive)}</td>
                    <td className="px-3 py-1.5 text-right">{deltaBadge(priceCurr.mapeCNew, priceCurr.mapeCOld, true)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="px-3 py-1.5 text-[11px] text-muted-foreground bg-slate-50 border-t flex flex-wrap gap-x-3">
                <span>snapshot: {priceCurr.snapshot}</span>
                <span>калибровок в обучении: {priceCurr.nCalibs}</span>
                <span>статус: {priceCurr.status}</span>
              </div>

              {pricePrev && (
                <div className="px-3 py-2 text-[11px] text-muted-foreground border-t bg-amber-50/60">
                  <b>Предыдущий snapshot ({pricePrev.snapshot}):</b>
                  {" "}MAPE-E старая→активная: {fmtPct(pricePrev.mapeEOld)} → {fmtPct(pricePrev.mapeEActive)};
                  {" "}MAPE-C: {fmtPct(pricePrev.mapeCOld)} → {fmtPct(pricePrev.mapeCActive)}.
                </div>
              )}
            </div>
          )}
        </section>

        {/* ────────── Fraud (supervised) ────────── */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Антифрод-модель (supervised, пары driver↔client)</h3>
          <p className="text-xs text-muted-foreground">
            Сравнение последнего успешного прогона с предыдущим. Δ зелёная —
            метрика выросла (это хорошо для AUC/F1/Precision/Recall).
          </p>

          {!fraudCurr ? (
            <div className="text-sm text-muted-foreground py-4 text-center border rounded">
              {loading ? "Загружаем…" : "Нет успешных supervised-прогонов"}
            </div>
          ) : (
            <div className="border rounded overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">Метрика</th>
                    <th className="text-right px-3 py-2">
                      Текущая (run #{fraudCurr.runId})
                    </th>
                    <th className="text-right px-3 py-2">
                      Предыдущая {fraudPrev ? `(run #${fraudPrev.runId})` : ""}
                    </th>
                    <th className="text-right px-3 py-2">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["AUC ROC", fraudCurr.auc, fraudPrev?.auc ?? null] as const,
                      ["PR AUC", fraudCurr.prAuc, fraudPrev?.prAuc ?? null] as const,
                      ["F1", fraudCurr.f1, fraudPrev?.f1 ?? null] as const,
                      ["Precision", fraudCurr.precision, fraudPrev?.precision ?? null] as const,
                      ["Recall", fraudCurr.recall, fraudPrev?.recall ?? null] as const,
                      ["Accuracy", fraudCurr.accuracy, fraudPrev?.accuracy ?? null] as const,
                    ]
                  ).map(([name, curr, prev], i) => (
                    <tr key={name} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                      <td className="px-3 py-1.5 font-medium">{name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(curr)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmtNum(prev)}</td>
                      <td className="px-3 py-1.5 text-right">{deltaBadge(curr, prev, false)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-1.5 text-[11px] text-muted-foreground bg-slate-50 border-t flex flex-wrap gap-x-3">
                <span>версия: {fraudCurr.modelVersion}</span>
                <span>выборка: {fraudCurr.rowsCount} (+{fraudCurr.positiveCount} / −{fraudCurr.negativeCount})</span>
                <span>train/test: {fraudCurr.nTrain}/{fraudCurr.nTest}</span>
              </div>

              {fraudCurr.topFeatures.length > 0 && (
                <div className="border-t p-3 space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">
                    Top-5 признаков по важности (текущая модель):
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {fraudCurr.topFeatures.slice(0, 5).map((f) => (
                      <span
                        key={f.name}
                        className="text-[11px] px-1.5 py-0.5 rounded border bg-violet-50 text-violet-800 border-violet-200 tabular-nums"
                      >
                        {f.name} · {f.importance.toFixed(1)}
                      </span>
                    ))}
                  </div>
                  {featuresDiff && (featuresDiff.added.length > 0 || featuresDiff.removed.length > 0) && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] pt-1">
                      {featuresDiff.added.length > 0 && (
                        <span className="text-emerald-700">
                          ➕ добавилось в топ: {featuresDiff.added.join(", ")}
                        </span>
                      )}
                      {featuresDiff.removed.length > 0 && (
                        <span className="text-rose-700">
                          ➖ выпало из топа: {featuresDiff.removed.join(", ")}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {supervisedRuns.length > 2 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              История последних прогонов антифрода
            </h3>
            <div className="border rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-1">#</th>
                    <th className="text-left px-2 py-1">Версия</th>
                    <th className="text-right px-2 py-1">AUC</th>
                    <th className="text-right px-2 py-1">F1</th>
                    <th className="text-right px-2 py-1">Precision</th>
                    <th className="text-right px-2 py-1">Recall</th>
                    <th className="text-right px-2 py-1">N(train/test)</th>
                  </tr>
                </thead>
                <tbody>
                  {supervisedRuns.slice(0, 10).map((r, i) => (
                    <tr key={r.runId} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                      <td className="px-2 py-1 tabular-nums">{r.runId}</td>
                      <td className="px-2 py-1 font-mono text-[10px]">{r.modelVersion}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.auc)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.f1)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.precision)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtNum(r.recall)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{r.nTrain}/{r.nTest}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
