import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { NewstatLayout } from "../components/NewstatLayout";
import {
  newstatApi,
  type MlLabelsSummary,
  type MlMode,
  type MlRun,
  type MlStatus,
} from "../lib/api";
import {
  fetchMetricsHistory,
  fetchRouteErrors,
  fetchRouteCoverage,
  fetchOrdersDistribution,
  type MetricsHistoryItem,
  type RouteErrorsResult,
  type CoverageResult,
  type DistributionResult,
} from "@/lib/pricing-model";
import { useNewstatUser } from "../lib/auth-store";

// T016.5: те же минимумы должны быть на сервере (POST /ml/retrain).
const RETRAIN_MIN = { total: 100, positive: 20, negative: 50 };

function retrainAvailability(s: MlLabelsSummary | null): {
  level: "ok" | "warn" | "blocked";
  reasons: string[];
} {
  if (!s) return { level: "warn", reasons: ["метрики не загружены"] };
  const reasons: string[] = [];
  if (s.labels_total    < RETRAIN_MIN.total)    reasons.push(`labels_total ${s.labels_total} < ${RETRAIN_MIN.total}`);
  if (s.labels_positive < RETRAIN_MIN.positive) reasons.push(`positive ${s.labels_positive} < ${RETRAIN_MIN.positive}`);
  if (s.labels_negative < RETRAIN_MIN.negative) reasons.push(`negative ${s.labels_negative} < ${RETRAIN_MIN.negative}`);
  if (reasons.length) return { level: "blocked", reasons };
  if (s.labels_last_7d === 0) return { level: "warn", reasons: ["за последние 7 дней не размечено новых кейсов"] };
  return { level: "ok", reasons: [] };
}

function fmtMetric(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(3);
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("ru-RU", { hour12: false });
}

function statusTone(s: string): string {
  if (s === "success") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (s === "running") return "bg-sky-100 text-sky-800 border-sky-200";
  if (s === "failed")  return "bg-rose-100 text-rose-800 border-rose-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function modelTone(m: string): string {
  if (m === "supervised") return "bg-violet-100 text-violet-800 border-violet-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

// Предупреждения по T015.5 (low quality model). Не блокируют активацию,
// но требуют подтверждения у админа.
function modelWarnings(r: MlRun): string[] {
  const w: string[] = [];
  if (r.roc_auc !== null && r.roc_auc < 0.65)        w.push(`ROC-AUC ${fmtMetric(r.roc_auc)} < 0.65`);
  if (r.positive_count !== null && r.positive_count < 20)
    w.push(`positive_count ${r.positive_count} < 20`);
  if (r.recall !== null && r.recall < 0.5)           w.push(`recall ${fmtMetric(r.recall)} < 0.5`);
  return w;
}

const RESCORE_PRESETS: Array<{ days: number; label: string }> = [
  { days: 1,  label: "Сегодня" },
  { days: 3,  label: "Последние 3 дня" },
  { days: 7,  label: "Последние 7 дней" },
  { days: 14, label: "Последние 14 дней" },
];

const ML_MODES: Array<{ value: MlMode; label: string; description: string; color: string }> = [
  { value: "SAFE",       label: "SAFE",       description: "Только ML_DISCOVERY. Минимум шума, до 20 тикетов/день.", color: "emerald" },
  { value: "BALANCED",   label: "BALANCED",   description: "ML_DISCOVERY + STRONG top-50/день.",                    color: "indigo"  },
  { value: "AGGRESSIVE", label: "AGGRESSIVE", description: "ML + STRONG + RULE_OVERKILL. Высокий охват.",          color: "amber"   },
  { value: "TRAINING",   label: "TRAINING",   description: "Тикеты не создаются. Только labeling queue.",          color: "rose"    },
];

function isoDateMinusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function NewstatMlPage() {
  const { user } = useNewstatUser();
  const isAdmin = user?.role === "admin";

  const [status, setStatus] = useState<MlStatus | null>(null);
  const [runs, setRuns] = useState<MlRun[]>([]);
  const [labelsSummary, setLabelsSummary] = useState<MlLabelsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingMode, setSavingMode] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const [rescoreFrom, setRescoreFrom] = useState(isoDateMinusDays(7));
  const [rescoreTo, setRescoreTo] = useState(isoDateMinusDays(0));
  const [createTickets, setCreateTickets] = useState(false);

  // Sprint 4 T03: история MAPE по retrain-ам (источник — nightly Step 5.5).
  const [metricsHistory, setMetricsHistory] = useState<MetricsHistoryItem[] | null>(null);
  const [metricsHistoryErr, setMetricsHistoryErr] = useState<string | null>(null);

  // Phase B: статистика умного генератора маршрутов.
  // routeErrors → топ-10 шумных пар, coverage → heatmap часов×дней,
  // distribution → диагностика квот short/medium/long.
  const [routeErrors, setRouteErrors] = useState<RouteErrorsResult | null>(null);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [distribution, setDistribution] = useState<DistributionResult | null>(null);
  const [routeStatsLoading, setRouteStatsLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    setErr(null);
    const [s, r, ls] = await Promise.all([
      newstatApi.mlStatus(),
      newstatApi.mlRuns(50),
      newstatApi.mlLabelsSummary(),
    ]);
    if (s.ok) setStatus(s.data);
    else setErr(s.error);
    if (r.ok) setRuns(r.data.items);
    else setErr((prev) => prev || r.error);
    if (ls.ok) setLabelsSummary(ls.data);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      newstatApi.mlStatus().then((s) => { if (s.ok) setStatus(s.data); });
      newstatApi.mlLabelsSummary().then((ls) => { if (ls.ok) setLabelsSummary(ls.data); });
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  // Sprint 4 T03: загружаем историю CatBoost-метрик при монтировании +
  // обновляем при ручном refresh. 90 точек ≈ квартал ежесуточных retrain-ов.
  useEffect(() => {
    let cancel = false;
    fetchMetricsHistory(90).then((res) => {
      if (cancel) return;
      if (!res) {
        setMetricsHistoryErr("ML-сервис недоступен");
        setMetricsHistory(null);
      } else {
        setMetricsHistoryErr(null);
        setMetricsHistory(res.items);
      }
    });
    return () => {
      cancel = true;
    };
  }, []);

  // Phase B: route stats для двух новых виджетов внизу страницы.
  // Грузим параллельно, обновляем каждые 5 минут (синхронно с TTL Node-кэша
  // в screen-receiver.mjs). Если файлов ещё нет (`available:false`) —
  // оставляем null, ниже компоненты сами рисуют плейсхолдер.
  useEffect(() => {
    let cancel = false;
    async function loadStats() {
      setRouteStatsLoading(true);
      const [re, cov, dist] = await Promise.all([
        fetchRouteErrors(), fetchRouteCoverage(), fetchOrdersDistribution(),
      ]);
      if (cancel) return;
      setRouteErrors(re && re.available ? re : null);
      setCoverage(cov && cov.available ? cov : null);
      setDistribution(dist && dist.available ? dist : null);
      setRouteStatsLoading(false);
    }
    loadStats();
    const t = setInterval(loadStats, 5 * 60 * 1000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  const retrainAvail = useMemo(() => retrainAvailability(labelsSummary), [labelsSummary]);

  const currentMode: MlMode = labelsSummary?.settings?.ml_mode ?? "BALANCED";

  async function handleModeChange(mode: MlMode) {
    if (!isAdmin || savingMode) return;
    if (!labelsSummary?.settings) return;
    setSavingMode(true);
    setActionMsg(null);
    const r = await newstatApi.saveMlWorkflow({ ...labelsSummary.settings, ml_mode: mode });
    setSavingMode(false);
    if (r.ok) {
      setActionMsg({ tone: "ok", text: `Режим переключён на ${mode}.` });
      const ls = await newstatApi.mlLabelsSummary();
      if (ls.ok) setLabelsSummary(ls.data);
    } else {
      setActionMsg({ tone: "err", text: `Ошибка сохранения режима: ${r.error}` });
    }
  }

  const activeVersion = status?.active_model_version ?? null;
  const labeledCount = useMemo(() => {
    const last = runs.find((r) => r.model_type === "supervised" && r.status === "success");
    return last?.rows_count ?? null;
  }, [runs]);

  async function handleRetrain() {
    if (busy) return;
    let force = false;
    if (retrainAvail.level === "blocked") {
      const ok = confirm(
        "Недостаточно labels для качественного retrain:\n• " +
          retrainAvail.reasons.join("\n• ") +
          "\n\nВсё равно запустить (force=true)? Модель будет низкого качества.",
      );
      if (!ok) return;
      force = true;
    } else if (
      !confirm("Запустить supervised retrain (CatBoost)? Это займёт минуты CPU и создаст новый candidate.")
    ) {
      return;
    }
    setBusy("retrain");
    setActionMsg(null);
    const res = await newstatApi.mlRetrain("manual UI", force ? { force: true } : undefined);
    setBusy(null);
    if (res.ok) {
      setActionMsg({ tone: "ok", text: `Retrain ok: run #${res.data.run_id}, version ${res.data.model_version}.` });
      await refresh();
    } else {
      setActionMsg({ tone: "err", text: `Retrain failed: ${res.error}` });
    }
  }

  async function handleActivate(r: MlRun) {
    if (busy) return;
    if (r.status !== "success") return;
    if (r.is_active) return;
    if (!r.model_path) {
      alert("У этого run нет model_path — активировать нечего.");
      return;
    }
    const w = modelWarnings(r);
    const msg = `Активировать модель ${r.model_version} (run #${r.run_id})?` +
      (w.length ? `\n\n⚠ Предупреждения:\n• ${w.join("\n• ")}\n\nВсё равно продолжить?` : "");
    if (!confirm(msg)) return;
    setBusy(`activate-${r.run_id}`);
    setActionMsg(null);
    const res = await newstatApi.mlActivate(r.run_id);
    setBusy(null);
    if (res.ok) {
      const wmsg = res.data.warnings?.length ? ` (warnings: ${res.data.warnings.join("; ")})` : "";
      setActionMsg({ tone: "ok", text: `Активная модель: ${res.data.active_model_version}${wmsg}` });
      await refresh();
    } else {
      setActionMsg({ tone: "err", text: `Activate failed: ${res.error}` });
    }
  }

  async function handleRescore() {
    if (busy) return;
    if (!rescoreFrom || !rescoreTo) return;
    if (rescoreFrom > rescoreTo) {
      alert("from должна быть ≤ to");
      return;
    }
    const tixHint = createTickets ? "\n\nБудут созданы тикеты для ML_DISCOVERY и STRONG_DISAGREEMENT." : "";
    if (!confirm(`Прогнать ML по парам с ${rescoreFrom} по ${rescoreTo}?${tixHint}`)) return;
    setBusy("rescore");
    setActionMsg(null);
    const res = await newstatApi.mlRescore({
      from: rescoreFrom,
      to: rescoreTo,
      create_tickets: createTickets || undefined,
    });
    setBusy(null);
    if (res.ok) {
      const t = res.data.tickets_created;
      const byType = res.data.tickets_by_type;
      let tx = "";
      if (t != null) {
        const breakdown = byType && Object.keys(byType).length
          ? ` (${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(", ")})`
          : "";
        tx = `, тикетов: ${t}${breakdown}`;
      }
      const errc = res.data.errors?.length ? `, ошибок: ${res.data.errors.length}` : "";
      setActionMsg({
        tone: "ok",
        text: `Rescore: обработано ${res.data.processed}${tx}${errc} за ${(res.data.duration_ms/1000).toFixed(1)}с.`,
      });
      await refresh();
    } else {
      setActionMsg({ tone: "err", text: `Rescore failed: ${res.error}` });
    }
  }

  return (
    <NewstatLayout title="ML управление">
      <p className="text-sm text-slate-500 mb-4 max-w-3xl">
        Цикл supervised: <b>разметка тикетов</b> → <b>retrain</b> (новый candidate) →
        <b> активация</b> админом → <b>rescore</b> прошедших дней под новой моделью.
      </p>

      {/* Статус сервиса и активной модели */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatusCard
          label="ML-сервис"
          value={status?.ml_service_ok ? "Онлайн" : "Недоступен"}
          tone={status?.ml_service_ok ? "ok" : "err"}
          hint="GET /ml/status, обновляется раз в 60с."
        />
        <StatusCard
          label="Активная модель"
          value={activeVersion ?? "—"}
          mono
          tone={activeVersion ? "ok" : "warn"}
          hint="model_version с is_active=true."
        />
        <StatusCard
          label="Последнее предсказание"
          value={
            status?.minutes_since_last_prediction != null
              ? `${status.minutes_since_last_prediction} мин назад`
              : "—"
          }
          tone={
            status?.minutes_since_last_prediction != null && status.minutes_since_last_prediction > 60 * 24
              ? "warn" : "ok"
          }
          hint={status?.last_prediction_at ? fmtDateTime(status.last_prediction_at) : "Нет ml_predictions."}
        />
        <StatusCard
          label="Размеченных строк (последний supervised)"
          value={labeledCount != null ? String(labeledCount) : "—"}
          tone={labeledCount != null && labeledCount >= 50 ? "ok" : "warn"}
          hint="Нужно ≥50 для retrain."
        />
      </section>

      {actionMsg && (
        <div className={`border rounded p-3 mb-4 text-sm ${
          actionMsg.tone === "ok"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-rose-200 bg-rose-50 text-rose-800"
        }`}>
          {actionMsg.text}
        </div>
      )}

      {/* T016.8: Карточки labels */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <LabelCard label="Labels всего" value={labelsSummary?.labels_total} hint="fraud_training_labels" />
        <LabelCard label="Positive (fraud)" value={labelsSummary?.labels_positive} tone="rose" />
        <LabelCard label="Negative (FP)" value={labelsSummary?.labels_negative} tone="emerald" />
        <LabelCard label="За 7 дней" value={labelsSummary?.labels_last_7d} hint="темп разметки" />
        <LabelCard label="Не размечено" value={labelsSummary?.unlabeled_disagreements} hint="ML-расхождений в очереди" tone="amber" />
        <LabelCard label="Тикетов сегодня (ML)" value={labelsSummary?.tickets_created_from_ml_today} hint="из расхождений" />
      </section>

      {/* Sprint 4 T03: История MAPE CatBoost-моделей (price_E / price_C) */}
      <CatboostMetricsHistory items={metricsHistory} err={metricsHistoryErr} />

      {/* Phase B: умный генератор маршрутов — топ шумных пар + heatmap покрытия */}
      <SmartGeneratorPanel
        routeErrors={routeErrors}
        coverage={coverage}
        distribution={distribution}
        loading={routeStatsLoading}
      />

      {/* T017: Mode selector */}
      <section className="border rounded p-4 mb-4 bg-white">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Режим ML workflow</h3>
          {savingMode && <span className="text-xs text-slate-500">Сохраняем…</span>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {ML_MODES.map((m) => {
            const active = currentMode === m.value;
            const ringMap: Record<string, string> = {
              emerald: "ring-emerald-400 bg-emerald-50 border-emerald-300",
              indigo:  "ring-indigo-400  bg-indigo-50  border-indigo-300",
              amber:   "ring-amber-400   bg-amber-50   border-amber-300",
              rose:    "ring-rose-400    bg-rose-50    border-rose-300",
            };
            const labelMap: Record<string, string> = {
              emerald: "text-emerald-800",
              indigo:  "text-indigo-800",
              amber:   "text-amber-800",
              rose:    "text-rose-800",
            };
            return (
              <button
                key={m.value}
                disabled={!isAdmin || savingMode || !labelsSummary}
                onClick={() => void handleModeChange(m.value)}
                data-testid={`ml-mode-${m.value.toLowerCase()}`}
                className={[
                  "text-left border rounded-lg p-3 transition-all",
                  active
                    ? `ring-2 ${ringMap[m.color]} font-semibold`
                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
                  !isAdmin || savingMode || !labelsSummary
                    ? "opacity-50 cursor-not-allowed"
                    : "cursor-pointer",
                ].join(" ")}
              >
                <div className={`font-mono text-xs font-bold mb-1 ${active ? labelMap[m.color] : "text-slate-500"}`}>
                  {m.label}
                </div>
                <div className="text-xs text-slate-500 leading-snug">{m.description}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Действия */}
      <section className="border rounded p-4 mb-6 bg-white">
        <h3 className="text-sm font-semibold mb-3">Действия</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="border rounded p-3 bg-slate-50">
            <div className="text-sm font-medium mb-1 flex items-center gap-2">
              Supervised retrain
              <RetrainBadge level={retrainAvail.level} />
            </div>
            <div className="text-xs text-slate-500 mb-2">
              Берёт <code>fraud_training_labels</code> и обучает новый CatBoost candidate.
              Активацию делает отдельной кнопкой.
            </div>
            {retrainAvail.reasons.length > 0 && (
              <ul className="text-xs text-amber-700 mb-2 list-disc list-inside">
                {retrainAvail.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
            <button
              onClick={handleRetrain}
              disabled={!!busy}
              className={
                "px-3 py-1.5 rounded text-white text-sm disabled:opacity-50 " +
                (retrainAvail.level === "blocked"
                  ? "bg-rose-600 hover:bg-rose-700"
                  : "bg-violet-600 hover:bg-violet-700")
              }
              title={retrainAvail.reasons.join("; ") || "Запустить retrain"}
              data-testid="ml-retrain-btn"
            >
              {busy === "retrain"
                ? "Идёт обучение…"
                : retrainAvail.level === "blocked"
                  ? "Retrain (force)"
                  : "Запустить retrain"}
            </button>
          </div>

          <div className="border rounded p-3 bg-slate-50 lg:col-span-2">
            <div className="text-sm font-medium mb-1">Re-score N дней под активной моделью</div>
            <div className="text-xs text-slate-500 mb-2">
              Прогоняет батчем <code>fraud_features_pair_day</code> через активный CatBoost
              и обновляет <code>ml_predictions</code> (score / disagreement / top_features).
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {RESCORE_PRESETS.map((p) => (
                <button
                  key={p.days}
                  onClick={() => { setRescoreFrom(isoDateMinusDays(p.days - 1)); setRescoreTo(isoDateMinusDays(0)); }}
                  className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-white"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col">
                <span className="text-xs text-slate-500 mb-1">from</span>
                <input
                  type="date" value={rescoreFrom}
                  onChange={(e) => setRescoreFrom(e.target.value)}
                  className="border rounded px-2 py-1 text-sm"
                />
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-slate-500 mb-1">to</span>
                <input
                  type="date" value={rescoreTo}
                  onChange={(e) => setRescoreTo(e.target.value)}
                  className="border rounded px-2 py-1 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={createTickets}
                  onChange={(e) => setCreateTickets(e.target.checked)}
                />
                Создавать тикеты для расхождений
              </label>
              <button
                onClick={handleRescore}
                disabled={!!busy}
                className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy === "rescore" ? "Идёт rescore…" : "Запустить rescore"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Список training runs */}
      <section className="border rounded bg-white">
        <div className="flex items-center justify-between p-3 border-b">
          <h3 className="text-sm font-semibold">Training runs</h3>
          <button
            onClick={refresh}
            className="text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
            disabled={loading}
          >
            {loading ? "…" : "Обновить"}
          </button>
        </div>
        {err && (
          <div className="border-b border-rose-200 bg-rose-50 text-rose-800 p-3 text-sm">
            Ошибка: {err}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left  px-3 py-2">#</th>
                <th className="text-left  px-3 py-2">Тип</th>
                <th className="text-left  px-3 py-2">Версия</th>
                <th className="text-left  px-3 py-2">Статус</th>
                <th className="text-right px-3 py-2">Rows</th>
                <th className="text-right px-3 py-2">Pos</th>
                <th className="text-right px-3 py-2">Neg</th>
                <th className="text-right px-3 py-2">P</th>
                <th className="text-right px-3 py-2">R</th>
                <th className="text-right px-3 py-2">F1</th>
                <th className="text-right px-3 py-2">ROC</th>
                <th className="text-left  px-3 py-2">Когда</th>
                <th className="text-left  px-3 py-2">Кем</th>
                <th className="text-left  px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && !loading && (
                <tr><td colSpan={14} className="px-3 py-8 text-center text-slate-400">Нет training runs.</td></tr>
              )}
              {runs.map((r) => {
                const w = modelWarnings(r);
                return (
                  <tr key={r.run_id} className="border-t hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-mono text-xs">{r.run_id}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block text-xs px-1.5 py-0.5 rounded border ${modelTone(r.model_type)}`}>
                        {r.model_type === "supervised" ? "supervised" : "weak"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.model_version}
                      {r.is_active && (
                        <span className="ml-1 inline-block text-[10px] px-1.5 py-0.5 rounded border bg-emerald-100 text-emerald-800 border-emerald-200">
                          active
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block text-xs px-1.5 py-0.5 rounded border ${statusTone(r.status)}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.rows_count ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.positive_count ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.negative_count ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMetric(r.precision_score)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMetric(r.recall)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMetric(r.f1_score)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMetric(r.roc_auc)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {fmtDateTime(r.finished_at || r.started_at || r.created_at)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{r.created_by || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {r.is_active ? (
                        <span className="text-xs text-emerald-700">активна</span>
                      ) : r.status === "success" && r.model_path ? (
                        <button
                          onClick={() => handleActivate(r)}
                          disabled={!!busy}
                          className="text-xs px-2 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                          title={w.length ? `⚠ ${w.join("; ")}` : ""}
                        >
                          {busy === `activate-${r.run_id}` ? "…" : (w.length ? "Активировать ⚠" : "Активировать")}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                      {r.error && (
                        <div className="text-[10px] text-rose-700 mt-0.5 max-w-[200px] truncate" title={r.error}>
                          {r.error}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </NewstatLayout>
  );
}

function StatusCard({
  label, value, hint, tone = "ok", mono = false,
}: { label: string; value: string; hint?: string; tone?: "ok" | "warn" | "err"; mono?: boolean }) {
  const colors =
    tone === "err"  ? "border-rose-200    bg-rose-50    text-rose-800"   :
    tone === "warn" ? "border-amber-200   bg-amber-50   text-amber-800"  :
                      "border-emerald-200 bg-emerald-50 text-emerald-800";
  return (
    <div className={`border rounded p-3 ${colors}`}>
      <div className="text-xs">{label}</div>
      <div className={`text-base font-semibold ${mono ? "font-mono" : ""}`}>{value}</div>
      {hint && <div className="text-[11px] opacity-70 mt-0.5">{hint}</div>}
    </div>
  );
}

function LabelCard({
  label, value, hint, tone,
}: {
  label: string;
  value: number | undefined;
  hint?: string;
  tone?: "rose" | "emerald" | "amber";
}) {
  const toneClass =
    tone === "rose"    ? "bg-rose-50 border-rose-200 text-rose-900"
  : tone === "emerald" ? "bg-emerald-50 border-emerald-200 text-emerald-900"
  : tone === "amber"   ? "bg-amber-50 border-amber-200 text-amber-900"
  :                      "bg-white border-slate-200 text-slate-900";
  return (
    <div className={`border rounded p-2 ${toneClass}`} data-testid={`labels-card-${label}`}>
      <div className="text-[11px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value ?? "—"}</div>
      {hint && <div className="text-[11px] opacity-70 mt-0.5">{hint}</div>}
    </div>
  );
}

// ─── Sprint 4 T03: график истории CatBoost MAPE ──────────────────────────
// Источник — GET /api/ml/metrics/history (через nginx прокси на :3013).
// Записи появляются после каждого nightly retrain (Step 5.5 в скрипте).
// Показываем mape_e_active / mape_c_active (то что фактически в проде:
// при ROLLBACK == старая модель, при OK == новая).

function fmtPct(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}

function CatboostMetricsHistory({
  items,
  err,
}: {
  items: MetricsHistoryItem[] | null;
  err: string | null;
}) {
  // Готовим точки для recharts. ts → DD.MM, mape_*_active → проценты.
  const data = useMemo(() => {
    if (!items) return [];
    return items.map((it) => {
      const d = new Date(it.ts);
      const dateLabel = isNaN(d.getTime())
        ? it.snapshot ?? ""
        : d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
      return {
        ts: it.ts,
        date: dateLabel,
        mapeE: it.mape_e_active != null ? +(it.mape_e_active * 100).toFixed(2) : null,
        mapeC: it.mape_c_active != null ? +(it.mape_c_active * 100).toFixed(2) : null,
        status: it.status ?? "OK",
        snapshot: it.snapshot,
        nCalibs: it.n_calibs,
        modelVersion: it.model_version,
      };
    });
  }, [items]);

  // Точки rollback хочется выделить отдельно (красные кружки на графике
  // E-линии). Считаем индексы и значения, потом ReferenceDot[].
  const rollbacks = useMemo(
    () =>
      data
        .map((d, i) => ({ ...d, idx: i }))
        .filter((d) => d.status === "ROLLBACK" && d.mapeE != null),
    [data],
  );

  const last = data.length ? data[data.length - 1] : null;
  const prev = data.length > 1 ? data[data.length - 2] : null;
  const deltaE =
    last && prev && last.mapeE != null && prev.mapeE != null
      ? last.mapeE - prev.mapeE
      : null;
  const deltaC =
    last && prev && last.mapeC != null && prev.mapeC != null
      ? last.mapeC - prev.mapeC
      : null;

  return (
    <section
      className="border rounded p-4 mb-4 bg-white"
      data-testid="catboost-metrics-history"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-semibold">История MAPE CatBoost (price_E / price_C)</h3>
          <p className="text-[11px] text-slate-500">
            Точки записываются после каждого ночного retrain. ROLLBACK помечен красным.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          {last && (
            <>
              <div>
                <span className="text-slate-500">Последний MAPE E:</span>{" "}
                <b className="tabular-nums">{last.mapeE != null ? `${last.mapeE.toFixed(1)}%` : "—"}</b>
                {deltaE != null && (
                  <span
                    className={`ml-1 ${deltaE <= 0 ? "text-emerald-700" : "text-rose-700"}`}
                  >
                    {deltaE > 0 ? "+" : ""}
                    {deltaE.toFixed(2)}пп
                  </span>
                )}
              </div>
              <div>
                <span className="text-slate-500">MAPE C:</span>{" "}
                <b className="tabular-nums">{last.mapeC != null ? `${last.mapeC.toFixed(1)}%` : "—"}</b>
                {deltaC != null && (
                  <span
                    className={`ml-1 ${deltaC <= 0 ? "text-emerald-700" : "text-rose-700"}`}
                  >
                    {deltaC > 0 ? "+" : ""}
                    {deltaC.toFixed(2)}пп
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {err && (
        <div className="border border-rose-200 bg-rose-50 text-rose-800 p-2 text-xs rounded mb-2">
          Не удалось загрузить историю: {err}
        </div>
      )}
      {data.length === 0 && !err && (
        <div className="text-xs text-slate-500 text-center py-8">
          История пока пуста. Первая запись появится после ближайшего nightly retrain
          (запускается systemd-таймером раз в сутки).
        </div>
      )}
      {data.length > 0 && (
        <div style={{ width: "100%", height: 260 }} data-testid="catboost-mape-chart">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#64748b" }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickFormatter={(v) => `${v}%`}
                width={40}
              />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                labelFormatter={(_, payload) => {
                  const p = payload?.[0]?.payload as
                    | (typeof data)[number]
                    | undefined;
                  if (!p) return "";
                  const d = new Date(p.ts);
                  return isNaN(d.getTime()) ? p.snapshot ?? "" : d.toLocaleString("ru-RU");
                }}
                formatter={(value: number | string, name) => {
                  const v = typeof value === "number" ? `${value.toFixed(2)}%` : value;
                  return [v, name];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="mapeE"
                name="MAPE Эконом"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="mapeC"
                name="MAPE Комфорт"
                stroke="#0ea5e9"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
              {rollbacks.map((r) => (
                <ReferenceDot
                  key={r.snapshot ?? r.ts}
                  x={r.date}
                  y={r.mapeE ?? 0}
                  r={6}
                  fill="#dc2626"
                  stroke="#fff"
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase B: умный генератор маршрутов /recommended.
// Показывает три блока:
//   1. Топ-5 шумных пар (mapeE↓) — куда нужно догнать калибровок
//   2. Heatmap покрытия 24×4 (час × demand-уровень) — где «дыры» в данных
//   3. Реальное распределение поездок short/medium/long (overall + сейчас)
// Если файлов ещё нет (агрегатор ни разу не запускался) — плейсхолдер.

function SmartGeneratorPanel({
  routeErrors,
  coverage,
  distribution,
  loading,
}: {
  routeErrors: RouteErrorsResult | null;
  coverage: CoverageResult | null;
  distribution: DistributionResult | null;
  loading: boolean;
}) {
  // Текущий час в UTC — для подсветки колонки в heatmap.
  const now = new Date();
  const curHour = now.getUTCHours();

  const top5 = useMemo(() => {
    if (!routeErrors?.pairs) return [];
    return Object.entries(routeErrors.pairs)
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.mapePct - a.mapePct)
      .slice(0, 5);
  }, [routeErrors]);

  // heatmap 24×4: агрегируем byHourDow по часу, суммируем red/yellow/green/n.
  // 4 строки: total (n), red, yellow, green — 24 колонки (часы UTC).
  const hourTotals = useMemo(() => {
    if (!coverage?.byHourDow) return null;
    const acc: Record<number, { n: number; red: number; yellow: number; green: number }> = {};
    for (let h = 0; h < 24; h++) acc[h] = { n: 0, red: 0, yellow: 0, green: 0 };
    for (const c of coverage.byHourDow) {
      if (c.hour < 0 || c.hour > 23) continue;
      acc[c.hour].n += c.n ?? 0;
      acc[c.hour].red += c.nRed ?? 0;
      acc[c.hour].yellow += c.nYellow ?? 0;
      acc[c.hour].green += c.nGreen ?? 0;
    }
    return acc;
  }, [coverage]);
  const maxHourN = useMemo(() => {
    if (!hourTotals) return 0;
    return Math.max(...Object.values(hourTotals).map((v) => v.n), 0);
  }, [hourTotals]);

  if (loading && !routeErrors && !coverage && !distribution) {
    return (
      <section className="border rounded p-4 mb-6 bg-white">
        <h3 className="text-sm font-semibold mb-1">Умный генератор маршрутов</h3>
        <div className="text-xs text-slate-400">Загружаем статистику…</div>
      </section>
    );
  }
  if (!routeErrors && !coverage && !distribution) {
    return (
      <section className="border rounded p-4 mb-6 bg-white">
        <h3 className="text-sm font-semibold mb-1">Умный генератор маршрутов</h3>
        <div className="text-xs text-amber-700">
          Файлы статистики ещё не сгенерированы. Запустите{" "}
          <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">
            aggregate-route-stats.py
          </code>{" "}
          вручную или подождите ночного nightly-ml-retrain.
        </div>
      </section>
    );
  }

  return (
    <section className="border rounded p-4 mb-6 bg-white">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold">Умный генератор маршрутов</h3>
        <span className="text-[11px] text-slate-500">
          Какие пары и слоты часов система сейчас «толкает» в выдачу{" "}
          <code className="bg-slate-100 px-1 py-0.5 rounded">/recommended</code>,
          чтобы заполнить дыры в калибровках.
        </span>
      </div>

      {/* (1) распределение поездок short/medium/long — overall и сейчас */}
      {distribution?.overall && (
        <div className="border rounded p-3 mb-3 bg-slate-50">
          <div className="text-xs font-medium mb-2 text-slate-700">
            Реальное распределение поездок (по которому подбираются квоты выдачи)
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {(["short", "medium", "long"] as const).map((b) => {
              const ov = distribution.overall![b];
              const cur = distribution.byHour?.[curHour];
              const curFrac = cur && cur.n > 0 ? cur[b] / cur.n : null;
              const labels = { short: "≤3 км", medium: "3–10 км", long: ">10 км" };
              return (
                <div key={b} className="bg-white border rounded p-2">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                    {b} · {labels[b]}
                  </div>
                  <div className="font-mono text-base font-semibold text-slate-800">
                    {(ov * 100).toFixed(0)}%
                  </div>
                  <div className="text-[10px] text-slate-400">
                    в этот час: {curFrac == null ? "—" : `${(curFrac * 100).toFixed(0)}%`}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[10px] text-slate-400 mt-2">
            Всего поездок в выборке: {distribution.overall.n}
          </div>
        </div>
      )}

      {/* (2) топ-5 шумных пар */}
      {top5.length > 0 ? (
        <div className="border rounded mb-3 overflow-x-auto bg-slate-50">
          <div className="px-3 py-2 text-xs font-medium text-slate-700 border-b bg-white">
            Топ-5 шумных пар (model price_E MAPE ≥ X%) — куда нужны докалибровки
          </div>
          <table className="min-w-full text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="text-left px-3 py-1.5">#</th>
                <th className="text-left px-3 py-1.5">Пара (anchor → anchor)</th>
                <th className="text-right px-3 py-1.5">MAPE&nbsp;E</th>
                <th className="text-right px-3 py-1.5">MAPE&nbsp;C</th>
                <th className="text-right px-3 py-1.5">N&nbsp;калибр.</th>
                <th className="text-left px-3 py-1.5">Последняя</th>
              </tr>
            </thead>
            <tbody>
              {top5.map((p, i) => {
                const ls = p.lastSeenIso ? new Date(p.lastSeenIso) : null;
                const ageDays = ls ? Math.floor((Date.now() - ls.getTime()) / 86400000) : null;
                const tone =
                  p.mapePct >= 30
                    ? "text-rose-700 font-semibold"
                    : p.mapePct >= 20
                      ? "text-amber-700"
                      : "text-slate-700";
                return (
                  <tr key={p.key} className="border-t hover:bg-white">
                    <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">{p.key}</td>
                    <td className={`px-3 py-1.5 text-right font-mono ${tone}`}>
                      {p.mapePct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                      {p.mapeC != null ? (p.mapeC * 100).toFixed(1) + "%" : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-slate-600">{p.n}</td>
                    <td className="px-3 py-1.5 text-slate-500">
                      {ageDays == null ? "—" : ageDays === 0 ? "сегодня" : `${ageDays}д назад`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-3 py-1.5 text-[10px] text-slate-400 border-t bg-white">
            Эти пары система поднимает в выдаче с весом{" "}
            <code className="bg-slate-100 px-1 rounded">1 + mape × 5</code>. Всего пар с ≥5
            калибровок: {routeErrors?.nPairs ?? 0} (из {routeErrors?.nCalibsTotal ?? 0} калибровок,
            сматчилось к якорям {routeErrors?.nCalibsMatched ?? 0}).
          </div>
        </div>
      ) : (
        <div className="border rounded p-3 mb-3 text-xs text-slate-400 bg-slate-50">
          Пока нет ни одной пары с ≥5 калибровками. Нужно собирать данные дальше.
        </div>
      )}

      {/* (3) heatmap покрытия 24×4 (час × demand-уровень) */}
      {hourTotals && (
        <div className="border rounded p-3 bg-slate-50">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="text-xs font-medium text-slate-700">
              Покрытие калибровками: час × demand-уровень (UTC, 24×4)
            </div>
            <div className="text-[10px] text-slate-400">
              Всего: {coverage?.totals?.n ?? 0} ·{" "}
              <span className="text-rose-600">red {coverage?.byDemand?.red ?? 0}</span> ·{" "}
              <span className="text-amber-600">yellow {coverage?.byDemand?.yellow ?? 0}</span> ·{" "}
              <span className="text-emerald-600">green {coverage?.byDemand?.green ?? 0}</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="text-[10px] font-mono select-none">
              <thead>
                <tr>
                  <th className="px-1 text-right text-slate-400 font-normal w-[44px]">уровень</th>
                  {Array.from({ length: 24 }, (_, h) => (
                    <th key={h} className={`px-0 font-normal w-[18px] text-center ${h === curHour ? "text-rose-600 font-semibold" : "text-slate-400"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["n", "red", "yellow", "green"] as const).map((row) => {
                  const rowLabel = { n: "total", red: "🔴", yellow: "🟡", green: "🟢" }[row];
                  const rowRgb = { n: "99,102,241", red: "239,68,68", yellow: "245,158,11", green: "34,197,94" }[row];
                  const rowMax = Math.max(...Array.from({ length: 24 }, (_, h) => hourTotals[h][row]), 0);
                  return (
                    <tr key={row}>
                      <td className="pr-2 text-right text-slate-500">{rowLabel}</td>
                      {Array.from({ length: 24 }, (_, h) => {
                        const val = hourTotals[h][row];
                        const intensity = rowMax > 0 ? Math.min(1, Math.log(1 + val) / Math.log(1 + rowMax)) : 0;
                        const bg = val === 0 ? "rgb(241,245,249)" : `rgba(${rowRgb},${0.15 + intensity * 0.75})`;
                        const isCurCol = h === curHour;
                        return (
                          <td key={h} className="p-0">
                            <div
                              className={`w-[18px] h-[16px] flex items-center justify-center text-[9px] ${isCurCol ? "ring-1 ring-rose-400 ring-inset" : ""}`}
                              style={{ backgroundColor: bg, color: intensity > 0.5 ? "white" : "#475569" }}
                              title={`${h}:xx ${row}=${val}`}
                            >
                              {val > 0 ? val : ""}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-slate-400 mt-2">
            Текущий час обведён красным. Слоты с n &lt; 3 получают +2 к весу всех пар в этот час
            (boost для заполнения «дыр»).
          </div>
        </div>
      )}
    </section>
  );
}

function RetrainBadge({ level }: { level: "ok" | "warn" | "blocked" }) {
  if (level === "ok")
    return <span className="inline-block rounded px-1.5 py-0.5 text-[11px] border bg-emerald-100 text-emerald-800 border-emerald-200">retrain ready</span>;
  if (level === "warn")
    return <span className="inline-block rounded px-1.5 py-0.5 text-[11px] border bg-amber-100 text-amber-800 border-amber-200">осторожно</span>;
  return <span className="inline-block rounded px-1.5 py-0.5 text-[11px] border bg-rose-100 text-rose-800 border-rose-200">мало labels</span>;
}
