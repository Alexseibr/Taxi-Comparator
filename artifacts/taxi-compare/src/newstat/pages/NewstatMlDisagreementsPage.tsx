import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { NewstatLayout } from "../components/NewstatLayout";
import {
  newstatApi,
  type MlDisagreementRow,
  type MlDisagreementType,
} from "../lib/api";
import { useNewstatDate } from "../lib/use-newstat-date";

function fmtMoney(s: number | string | null | undefined): string {
  if (s === null || s === undefined) return "—";
  return Number(s).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

function typeTone(t: MlDisagreementType): string {
  if (t === "ML_DISCOVERY") return "bg-violet-100 text-violet-800 border-violet-200";
  if (t === "RULE_OVERKILL") return "bg-sky-100 text-sky-800 border-sky-200";
  return "bg-amber-100 text-amber-800 border-amber-200";
}

function typeLabel(t: MlDisagreementType): string {
  if (t === "ML_DISCOVERY") return "ML нашёл новый";
  if (t === "RULE_OVERKILL") return "Правила перегнули";
  return "Сильное расхождение";
}

function typeHint(t: MlDisagreementType): string {
  if (t === "ML_DISCOVERY")
    return "Модель уверена (≥80), правила пропустили (<50). Кандидат на новый сценарий фрода.";
  if (t === "RULE_OVERKILL")
    return "Правила сработали (≥60), модель не подтверждает (<30). Возможен false-positive в правилах.";
  return "|ML − правила| ≥ 30. Просто сильное расхождение, требует ручной проверки.";
}

const TYPE_OPTIONS: Array<{ value: "" | MlDisagreementType; label: string }> = [
  { value: "", label: "Все типы" },
  { value: "ML_DISCOVERY", label: "ML_DISCOVERY (модель нашла)" },
  { value: "RULE_OVERKILL", label: "RULE_OVERKILL (правила перегнули)" },
  { value: "STRONG_DISAGREEMENT", label: "STRONG (просто сильно расходятся)" },
];

export function NewstatMlDisagreementsPage() {
  const [date, setDate] = useNewstatDate();
  const [type, setType] = useState<"" | MlDisagreementType>("");
  const [onlyUnlabeled, setOnlyUnlabeled] = useState(false);
  const [minDelta, setMinDelta] = useState<string>("");
  const [minMoney, setMinMoney] = useState<string>("");
  const [driverId, setDriverId] = useState<string>("");
  const [clientId, setClientId] = useState<string>("");

  const [rows, setRows] = useState<MlDisagreementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    (async () => {
      const r = await newstatApi.mlDisagreements({
        date,
        type: type || undefined,
        only_unlabeled: onlyUnlabeled ? "1" : undefined,
        min_delta: minDelta ? Number(minDelta) : undefined,
        min_money: minMoney ? Number(minMoney) : undefined,
        driver_id: driverId.trim() || undefined,
        client_id: clientId.trim() || undefined,
        limit: 500,
      });
      if (!alive) return;
      if (r.ok) setRows(r.data.items);
      else setErr(r.error);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [date, type, onlyUnlabeled, minDelta, minMoney, driverId, clientId]);

  const [yyyy, mm, dd] = date.split("-").map(Number);
  const dateRu = new Date(yyyy, (mm || 1) - 1, dd || 1).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const summary = useMemo(() => {
    const c: Record<MlDisagreementType, number> = {
      ML_DISCOVERY: 0,
      RULE_OVERKILL: 0,
      STRONG_DISAGREEMENT: 0,
    };
    let unlabeled = 0;
    for (const r of rows) {
      c[r.disagreement_type]++;
      if (!r.ticket_id || r.ticket_label_status === "unlabeled") unlabeled++;
    }
    return { c, unlabeled };
  }, [rows]);

  async function handleCreateTicket(r: MlDisagreementRow) {
    const key = `${r.driver_id}|${r.client_id}|${r.date}`;
    setCreatingKey(key);
    try {
      const res = await newstatApi.mlDisagreementCreateTicket({
        driver_id: r.driver_id,
        client_id: r.client_id,
        date: r.date,
        disagreement_type: r.disagreement_type,
      });
      if (res.ok) {
        navigate(`/newstat/tickets/${res.data.ticket_id}`);
      } else {
        alert(`Не удалось создать тикет: ${res.error}`);
      }
    } finally {
      setCreatingKey(null);
    }
  }

  return (
    <NewstatLayout title="ML-расхождения с правилами">
      <p className="text-sm text-slate-500 mb-4 max-w-3xl">
        Здесь видно пары «водитель — клиент», по которым ML-модель и rule-based
        антифрод не сошлись. Это две точки роста: <b>ML_DISCOVERY</b> подсказывает
        новые сценарии фрода, <b>RULE_OVERKILL</b> — false-positive у правил.
        Создание тикета даёт возможность разметить наблюдение и подкормить им
        следующий retrain.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="flex flex-col">
          <span className="text-xs text-slate-500 mb-1">Дата</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
          <span className="text-xs text-slate-400 mt-0.5">{dateRu}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-slate-500 mb-1">Тип расхождения</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "" | MlDisagreementType)}
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-slate-500 mb-1">Δ ≥ (0..100)</span>
          <input
            type="number" min={0} max={100} step={5}
            value={minDelta}
            onChange={(e) => setMinDelta(e.target.value)}
            placeholder="0"
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-slate-500 mb-1">Деньги ≥ (BYN)</span>
          <input
            type="number" min={0} step={10}
            value={minMoney}
            onChange={(e) => setMinMoney(e.target.value)}
            placeholder="0"
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-slate-500 mb-1">driver_id</span>
          <input
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            placeholder="любой"
            className="border rounded px-2 py-1 text-sm font-mono"
          />
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-slate-500 mb-1">client_id</span>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="любой"
            className="border rounded px-2 py-1 text-sm font-mono"
          />
        </div>
        <label className="flex items-center gap-2 text-sm md:col-span-2 mt-4">
          <input
            type="checkbox"
            checked={onlyUnlabeled}
            onChange={(e) => setOnlyUnlabeled(e.target.checked)}
          />
          Только неразмеченные (без тикета или ticket.label_status='unlabeled')
        </label>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <CountCard label="ML_DISCOVERY"        value={summary.c.ML_DISCOVERY}        tone="bg-violet-50 border-violet-200 text-violet-800" />
        <CountCard label="RULE_OVERKILL"       value={summary.c.RULE_OVERKILL}       tone="bg-sky-50 border-sky-200 text-sky-800" />
        <CountCard label="STRONG_DISAGREEMENT" value={summary.c.STRONG_DISAGREEMENT} tone="bg-amber-50 border-amber-200 text-amber-800" />
        <CountCard label="Не размечено"        value={summary.unlabeled}             tone="bg-slate-50 border-slate-200 text-slate-700" />
      </section>

      {err && (
        <div className="border border-rose-200 bg-rose-50 text-rose-800 rounded p-3 mb-4 text-sm">
          Ошибка загрузки: {err}
        </div>
      )}
      {loading && <div className="text-sm text-slate-500">Загрузка…</div>}

      {!loading && !err && (
        <div className="overflow-x-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left  px-3 py-2 w-8"></th>
                <th className="text-left  px-3 py-2">Тип</th>
                <th className="text-left  px-3 py-2">Driver</th>
                <th className="text-left  px-3 py-2">Client</th>
                <th className="text-right px-3 py-2">ML</th>
                <th className="text-right px-3 py-2">Правила</th>
                <th className="text-right px-3 py-2">Δ</th>
                <th className="text-right px-3 py-2">Деньги, BYN</th>
                <th className="text-left  px-3 py-2">Тикет</th>
                <th className="text-left  px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-slate-400">
                    Нет расхождений по выбранным фильтрам.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const key = `${r.driver_id}|${r.client_id}|${r.date}`;
                const open = openKey === key;
                return (
                  <Fragment key={key}>
                    <tr className="border-t hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <button
                          className="text-slate-400 hover:text-slate-700"
                          onClick={() => setOpenKey(open ? null : key)}
                          aria-label="Развернуть"
                        >
                          {open ? "▾" : "▸"}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block text-xs px-2 py-0.5 rounded border ${typeTone(r.disagreement_type)}`}
                          title={typeHint(r.disagreement_type)}
                        >
                          {typeLabel(r.disagreement_type)}
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
                        <span className={`inline-block text-xs font-semibold px-1.5 py-0.5 rounded border ${scoreTone(r.ml_score)}`}>
                          {fmtScore(r.ml_score)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={`inline-block text-xs font-semibold px-1.5 py-0.5 rounded border ${scoreTone(r.rule_score)}`}>
                          {fmtScore(r.rule_score)}
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold ${r.delta >= 0 ? "text-violet-700" : "text-sky-700"}`}>
                        {r.delta >= 0 ? "+" : ""}{fmtScore(r.delta)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.money_at_risk_byn)}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.ticket_id ? (
                          <Link to={`/newstat/tickets/${r.ticket_id}`} className="text-indigo-700 hover:underline">
                            #{r.ticket_id}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        {r.ticket_label_status === "labeled" && (
                          <div className={`mt-0.5 inline-block text-[10px] px-1.5 py-0.5 rounded border ${
                            r.ticket_label_value === 1
                              ? "bg-rose-100 text-rose-800 border-rose-200"
                              : "bg-emerald-100 text-emerald-800 border-emerald-200"
                          }`}>
                            {r.ticket_label_value === 1 ? "fraud" : "fp"}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.ticket_id ? (
                          <Link
                            to={`/newstat/tickets/${r.ticket_id}`}
                            className="text-xs px-2 py-1 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                          >
                            Открыть
                          </Link>
                        ) : (
                          <button
                            onClick={() => handleCreateTicket(r)}
                            disabled={creatingKey === key}
                            className="text-xs px-2 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            {creatingKey === key ? "…" : "Создать тикет"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-t bg-slate-50/50">
                        <td colSpan={10} className="px-6 py-3">
                          <div className="text-xs text-slate-500 mb-1">
                            <b>{typeLabel(r.disagreement_type)}.</b> {typeHint(r.disagreement_type)}
                            {r.model_version && (
                              <span className="ml-2 font-mono text-[11px]">model={r.model_version}</span>
                            )}
                          </div>
                          {Array.isArray(r.top_features) && r.top_features.length > 0 ? (
                            <div className="mt-2">
                              <div className="text-xs text-slate-500 mb-1">Топ признаков (SHAP):</div>
                              <table className="text-xs">
                                <tbody>
                                  {r.top_features.slice(0, 5).map((f, i) => (
                                    <tr key={i}>
                                      <td className="pr-3 py-0.5 font-mono">{f.feature}</td>
                                      <td className="pr-3 py-0.5 tabular-nums">{f.value === null ? "—" : String(f.value)}</td>
                                      <td className="pr-3 py-0.5 tabular-nums text-slate-500">
                                        shap={Number(f.importance).toFixed(3)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="text-xs text-slate-400 mt-1">SHAP-объяснений нет (старая модель?).</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </NewstatLayout>
  );
}

function CountCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`border rounded p-3 ${tone}`}>
      <div className="text-xs">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
