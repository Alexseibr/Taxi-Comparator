// T016.6: ручная разметка ML-кейсов отдельно от тикетов.
// Источник: ml_predictions + pair_risk_daily + LEFT JOIN fraud_training_labels.
// Категории case_type: ML_DISCOVERY / RULE_OVERKILL / STRONG_DISAGREEMENT / LOW_RISK_SAMPLE.
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { NewstatLayout } from "../components/NewstatLayout";
import {
  newstatApi,
  type MlCaseType,
  type MlLabelingRow,
} from "../lib/api";

function fmtMoney(s: number | string | null | undefined): string {
  if (s === null || s === undefined) return "—";
  return Number(s).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtScore(n: number): string {
  return Number.isFinite(n) ? n.toFixed(0) : "—";
}
function scoreTone(score: number): string {
  if (score >= 70) return "bg-rose-100 text-rose-800 border-rose-200";
  if (score >= 40) return "bg-amber-100 text-amber-800 border-amber-200";
  if (score >= 20) return "bg-yellow-50 text-yellow-700 border-yellow-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}
function caseTone(t: MlCaseType): string {
  if (t === "ML_DISCOVERY") return "bg-violet-100 text-violet-800 border-violet-200";
  if (t === "RULE_OVERKILL") return "bg-sky-100 text-sky-800 border-sky-200";
  if (t === "STRONG_DISAGREEMENT") return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}
function caseLabel(t: MlCaseType): string {
  if (t === "ML_DISCOVERY") return "ML_DISCOVERY";
  if (t === "RULE_OVERKILL") return "RULE_OVERKILL";
  if (t === "STRONG_DISAGREEMENT") return "STRONG";
  return "LOW_RISK";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function shiftIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const TYPE_OPTIONS: Array<{ value: "" | MlCaseType; label: string }> = [
  { value: "", label: "Все типы" },
  { value: "ML_DISCOVERY",        label: "ML_DISCOVERY (модель нашла)" },
  { value: "RULE_OVERKILL",       label: "RULE_OVERKILL (правила перегнули)" },
  { value: "STRONG_DISAGREEMENT", label: "STRONG (сильное расхождение)" },
  { value: "LOW_RISK_SAMPLE",     label: "LOW_RISK_SAMPLE (для negatives)" },
];

export function NewstatMlLabelingPage() {
  const [dateFrom, setDateFrom] = useState<string>(shiftIso(-7));
  const [dateTo, setDateTo] = useState<string>(todayIso());
  const [caseType, setCaseType] = useState<"" | MlCaseType>("");
  const [onlyUnlabeled, setOnlyUnlabeled] = useState(true);
  const [minMoney, setMinMoney] = useState<string>("");
  const [minDelta, setMinDelta] = useState<string>("");

  const [rows, setRows] = useState<MlLabelingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [batchOpen, setBatchOpen] = useState(false);
  const [batchCounts, setBatchCounts] = useState({ ml: 30, ovk: 30, str: 30, low: 30 });
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);

  const filterParams = useMemo(() => {
    return {
      date_from: dateFrom,
      date_to: dateTo,
      ...(caseType ? { case_type: caseType } : {}),
      only_unlabeled: (onlyUnlabeled ? "1" : "0") as "1" | "0",
      ...(minMoney ? { min_money_at_risk: Number(minMoney) } : {}),
      ...(minDelta ? { min_delta: Number(minDelta) } : {}),
      limit: 200,
    };
  }, [dateFrom, dateTo, caseType, onlyUnlabeled, minMoney, minDelta]);

  async function load() {
    setLoading(true);
    setErr(null);
    const r = await newstatApi.mlLabelingQueue(filterParams);
    if (r.ok) {
      setRows(r.data.items || []);
    } else {
      setErr(r.error);
      setRows([]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function submitLabel(row: MlLabelingRow, label: 0 | 1) {
    const key = `${row.driver_id}:${row.client_id}:${row.date}`;
    setBusyKey(key);
    const r = await newstatApi.mlLabel({
      entity_type: "pair",
      entity_key: `${row.driver_id}:${row.client_id}`,
      date: row.date,
      label,
    });
    setBusyKey(null);
    if (!r.ok) {
      alert(`Ошибка разметки: ${r.error}`);
      return;
    }
    setRows((prev) =>
      onlyUnlabeled
        ? prev.filter((x) => !(x.driver_id === row.driver_id && x.client_id === row.client_id && x.date === row.date))
        : prev.map((x) =>
            x.driver_id === row.driver_id && x.client_id === row.client_id && x.date === row.date
              ? { ...x, label_value: label, label_id: x.label_id ?? r.data.label_id }
              : x,
          ),
    );
  }

  async function submitBatch() {
    setBatchBusy(true);
    setBatchMsg(null);
    const r = await newstatApi.mlLabelingBatch({
      date_from: dateFrom,
      date_to: dateTo,
      ml_discovery: batchCounts.ml,
      rule_overkill: batchCounts.ovk,
      strong_disagreement: batchCounts.str,
      low_risk_sample: batchCounts.low,
      only_unlabeled: true,
    });
    setBatchBusy(false);
    if (!r.ok) {
      setBatchMsg(`Ошибка: ${r.error}`);
      return;
    }
    setRows(r.data.items || []);
    setBatchMsg(
      `Загружено ${r.data.count} кейсов: ` +
        `ML_DISCOVERY=${r.data.by_type.ML_DISCOVERY || 0}, ` +
        `RULE_OVERKILL=${r.data.by_type.RULE_OVERKILL || 0}, ` +
        `STRONG=${r.data.by_type.STRONG_DISAGREEMENT || 0}, ` +
        `LOW_RISK=${r.data.by_type.LOW_RISK_SAMPLE || 0}`,
    );
    setBatchOpen(false);
  }

  return (
    <NewstatLayout title="ML labeling queue">
      <div className="space-y-4">
        <header className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">ML labeling queue</h1>
            <p className="text-sm text-slate-600">
              Очередь ручной разметки для обучения supervised-модели. Размечайте ✅/❌ — это попадает в
              <code className="mx-1 rounded bg-slate-100 px-1">fraud_training_labels</code> и используется для retrain.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setBatchOpen(true)}
            className="px-3 py-2 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700"
            data-testid="open-batch-dialog"
          >
            Сформировать пачку для разметки
          </button>
        </header>

        {batchMsg && (
          <div className="rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
            {batchMsg}
          </div>
        )}

        <section className="bg-white rounded-lg border border-slate-200 p-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-6">
            <label className="text-sm">
              <span className="block text-slate-600 text-xs mb-0.5">Дата с</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                data-testid="filter-date-from"
              />
            </label>
            <label className="text-sm">
              <span className="block text-slate-600 text-xs mb-0.5">Дата по</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                data-testid="filter-date-to"
              />
            </label>
            <label className="text-sm">
              <span className="block text-slate-600 text-xs mb-0.5">Тип кейса</span>
              <select
                value={caseType}
                onChange={(e) => setCaseType(e.target.value as "" | MlCaseType)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                data-testid="filter-case-type"
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-slate-600 text-xs mb-0.5">min money_at_risk (BYN)</span>
              <input
                type="number" min={0} step="any"
                value={minMoney}
                onChange={(e) => setMinMoney(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="block text-slate-600 text-xs mb-0.5">min |delta|</span>
              <input
                type="number" min={0} max={100} step={1}
                value={minDelta}
                onChange={(e) => setMinDelta(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm flex items-end">
              <span className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyUnlabeled}
                  onChange={(e) => setOnlyUnlabeled(e.target.checked)}
                  data-testid="filter-only-unlabeled"
                />
                <span>Только не размеченные</span>
              </span>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button" onClick={load} disabled={loading}
              className="px-3 py-1.5 rounded bg-slate-800 text-white text-sm hover:bg-slate-900 disabled:opacity-50"
              data-testid="apply-filters"
            >
              {loading ? "Загрузка…" : "Применить фильтры"}
            </button>
            {err && <span className="text-sm text-rose-700">Ошибка: {err}</span>}
          </div>
        </section>

        {batchOpen && (
          <div className="fixed inset-0 z-[2001] flex items-center justify-center bg-black/40 p-4" data-testid="batch-modal">
            <div className="bg-white rounded-lg shadow-xl border border-slate-200 max-w-md w-full p-4 space-y-3">
              <h2 className="text-lg font-semibold">Пачка для разметки</h2>
              <p className="text-sm text-slate-600">
                Выбираем по N кейсов каждого типа из периода {dateFrom} … {dateTo}.
              </p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["ml", "ML_DISCOVERY"], ["ovk", "RULE_OVERKILL"],
                  ["str", "STRONG"],     ["low", "LOW_RISK"],
                ].map(([k, label]) => (
                  <label key={k}>
                    <span className="block text-xs text-slate-600 mb-0.5">{label}</span>
                    <input
                      type="number" min={0} max={500}
                      value={(batchCounts as any)[k]}
                      onChange={(e) =>
                        setBatchCounts((c) => ({ ...c, [k]: Math.max(0, Math.min(500, Number(e.target.value) || 0)) }))
                      }
                      className="w-full rounded border border-slate-300 px-2 py-1.5"
                      data-testid={`batch-count-${k}`}
                    />
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button" onClick={() => setBatchOpen(false)} disabled={batchBusy}
                  className="px-3 py-1.5 rounded border border-slate-300 text-sm"
                >
                  Отмена
                </button>
                <button
                  type="button" onClick={submitBatch} disabled={batchBusy}
                  className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
                  data-testid="batch-submit"
                >
                  {batchBusy ? "Загрузка…" : "Сформировать"}
                </button>
              </div>
            </div>
          </div>
        )}

        <section className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-3 py-2">Дата</th>
                <th className="px-3 py-2">Тип</th>
                <th className="px-3 py-2">Driver</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2 text-right">ML</th>
                <th className="px-3 py-2 text-right">Rule</th>
                <th className="px-3 py-2 text-right">|Δ|</th>
                <th className="px-3 py-2 text-right">Money @ risk</th>
                <th className="px-3 py-2">Тикет</th>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">Действия</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-500">
                  Нет кейсов для текущих фильтров.
                </td></tr>
              )}
              {rows.map((r) => {
                const key = `${r.driver_id}:${r.client_id}:${r.date}`;
                const busy = busyKey === key;
                return (
                  <tr key={key} className="border-t border-slate-100 align-top" data-testid="labeling-row">
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.date}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs border ${caseTone(r.case_type)}`}>
                        {caseLabel(r.case_type)}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link to={`/newstat/graph/node/driver/${r.driver_id}`} className="text-indigo-700 hover:underline">
                        {r.driver_id}
                      </Link>
                      {r.driver_name && <div className="text-[11px] text-slate-500">{r.driver_name}</div>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link to={`/newstat/graph/node/client/${r.client_id}`} className="text-indigo-700 hover:underline">
                        {r.client_id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-xs border ${scoreTone(r.ml_score)}`}>
                        {fmtScore(r.ml_score)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-xs border ${scoreTone(r.rule_score)}`}>
                        {fmtScore(r.rule_score)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{fmtScore(r.abs_delta)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(r.money_at_risk_byn)}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.ticket_id ? (
                        <Link to={`/newstat/tickets/${r.ticket_id}`} className="text-indigo-700 hover:underline">
                          #{r.ticket_id}
                        </Link>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.label_value === 1 && <span className="text-rose-700">fraud</span>}
                      {r.label_value === 0 && <span className="text-emerald-700">false-positive</span>}
                      {r.label_value === null && <span className="text-slate-400">unlabeled</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button" disabled={busy}
                          onClick={() => submitLabel(r, 1)}
                          className="px-2 py-1 rounded text-xs bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                          data-testid="label-fraud"
                        >
                          ✅ Fraud
                        </button>
                        <button
                          type="button" disabled={busy}
                          onClick={() => submitLabel(r, 0)}
                          className="px-2 py-1 rounded text-xs bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          data-testid="label-fp"
                        >
                          ❌ FP
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </NewstatLayout>
  );
}
