import { Fragment, useEffect, useMemo, useState } from "react";
import { NewstatLayout } from "../components/NewstatLayout";
import {
  newstatApi,
  type DailyPairRiskRow,
  type DailySummary,
} from "../lib/api";
import { useNewstatDate } from "../lib/use-newstat-date";

function fmtMoney(s: string | number): string {
  return Number(s).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function riskTone(score: number): string {
  if (score >= 70) return "bg-rose-100 text-rose-800 border-rose-200";
  if (score >= 30) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

export function NewstatPairsRiskPage() {
  const [date, setDate] = useNewstatDate();
  const [rows, setRows] = useState<DailyPairRiskRow[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    (async () => {
      const [r, s] = await Promise.all([
        newstatApi.dailyPairRisks(date),
        newstatApi.dailySummary(date),
      ]);
      if (!alive) return;
      if (r.ok) setRows(r.data.rows);
      else setErr(r.error);
      if (s.ok) setSummary(s.data.summary);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [date]);

  const [yyyy, mm, dd] = date.split("-").map(Number);
  const dateRu = new Date(yyyy, (mm || 1) - 1, dd || 1).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const visible = useMemo(
    () => rows.filter((r) => Number(r.total_risk) > 0),
    [rows],
  );

  return (
    <NewstatLayout title="Связки водитель–клиент">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-slate-500">Дата:</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        />
        <span className="text-sm text-slate-500">{dateRu}</span>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <SummaryCard
          label="Кэшбэк под риском (клиенты)"
          value={summary ? fmtMoney(summary.cashback_loss_total) : "—"}
          unit="BYN"
          tone="warn"
          hint="Итог по клиентам — сколько кэшбэка может быть переплачено из-за фрод-схем."
        />
        <SummaryCard
          label="Сговор пар"
          value={summary ? fmtMoney(summary.collusion_loss_total) : "—"}
          unit="BYN"
          tone="warn"
          hint="Деньги, которые могут оседать у конкретных пар «водитель-клиент»."
        />
        <SummaryCard
          label="Подозрительных пар"
          value={summary ? String(summary.risky_pairs_count) : "—"}
          unit="пар"
          tone="neutral"
          hint="Пары с total_risk ≥ 30 (хотя бы один сильный сигнал)."
        />
      </section>

      {err && (
        <div className="mb-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          Ошибка загрузки: {err}
        </div>
      )}

      {!loading && visible.length === 0 && !err && (
        <div className="rounded bg-slate-100 border border-slate-200 p-3 text-sm text-slate-600">
          За {dateRu} модели не нашли подозрительных пар (
          {rows.length === 0 ? "данных за день нет" : `проверено ${rows.length}`}).
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="font-medium mb-2 text-sm">
          Топ по «деньгам сговора» — {visible.length}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600 text-xs">
              <tr>
                <th className="p-2 font-medium text-left">Пара</th>
                <th className="p-2 font-medium text-right">Заказов</th>
                <th className="p-2 font-medium text-right">Повтор</th>
                <th className="p-2 font-medium text-right">Подозрительность</th>
                <th className="p-2 font-medium text-right">Зависимость кэшбэка</th>
                <th className="p-2 font-medium text-right">Итог риска</th>
                <th className="p-2 font-medium text-right">Сговор, BYN</th>
                <th className="p-2 font-medium text-center">Сигналы</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const key = `${r.driver_id}__${r.client_id}`;
                const isOpen = openKey === key;
                return (
                  <Fragment key={key}>
                    <tr className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-2">
                        <div className="font-medium">
                          {r.driver_name || r.driver_id}
                          <span className="text-slate-400"> ↔ </span>
                          {`Client #${r.client_id}`}
                        </div>
                        <div className="text-xs text-slate-400 tabular-nums">
                          {r.driver_id} · {r.client_id}
                        </div>
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {r.orders_count}
                        <div className="text-[11px] text-slate-400">
                          безнал {fmtMoney(r.noncash_gmv)}
                        </div>
                      </td>
                      <td className="p-2 text-right">
                        <RiskBadge score={Number(r.repeat_ratio)} />
                      </td>
                      <td className="p-2 text-right">
                        <RiskBadge score={Number(r.suspicious_ratio)} />
                      </td>
                      <td className="p-2 text-right">
                        <RiskBadge score={Number(r.cashback_dependency)} />
                      </td>
                      <td className="p-2 text-right">
                        <RiskBadge score={Number(r.total_risk)} bold />
                      </td>
                      <td className="p-2 text-right tabular-nums font-semibold">
                        {fmtMoney(r.collusion_loss_risk_byn)}
                      </td>
                      <td className="p-2 text-center text-xs">
                        <button
                          type="button"
                          className="text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline focus:outline-none focus:ring focus:ring-slate-300 rounded px-1"
                          aria-expanded={isOpen}
                          aria-controls={`psignals-${key}`}
                          onClick={() => setOpenKey(isOpen ? null : key)}
                        >
                          {isOpen ? "▲ скрыть" : "▼ показать"}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50">
                        <td colSpan={8} className="p-3" id={`psignals-${key}`}>
                          <SignalsBlock row={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 leading-relaxed">
        <div className="font-medium mb-1">Как считаются модели</div>
        <ul className="list-disc ml-5 space-y-1">
          <li>
            <b>Повтор</b>: насколько часто пара видится друг с другом за день
            (3 заказа — подозрительно, 10+ — почти точно).
          </li>
          <li>
            <b>Подозрительность</b>: высокая доля безнала (60%) + комбинация
            коротких поездок и быстрых подач (40%).
          </li>
          <li>
            <b>Зависимость кэшбэка</b>: какую долю всех безналичных заказов
            клиента эта пара забирает (50% — подозрительно, 100% — моногамно).
          </li>
        </ul>
        <div className="mt-2">
          Итог риска = максимум из трёх. Деньги сговора = безналичный оборот пары
          × кэшбэк % из настроек × итог риска / 100. Скор &lt; 30 не учитывается.
        </div>
      </section>
    </NewstatLayout>
  );
}

function RiskBadge({ score, bold }: { score: number; bold?: boolean }) {
  return (
    <span
      className={
        "inline-block px-2 py-0.5 rounded text-xs border tabular-nums " +
        riskTone(score) +
        (bold ? " font-semibold" : "")
      }
    >
      {score.toFixed(1)}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  hint: string;
  tone: "ok" | "warn" | "neutral";
}) {
  const border =
    tone === "warn" ? "border-amber-300" : tone === "ok" ? "border-emerald-300" : "border-slate-200";
  return (
    <div className={`rounded-lg bg-white border-2 ${border} p-3 shadow-sm`}>
      <div className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">
        {value} <span className="text-sm font-normal text-slate-500">{unit}</span>
      </div>
      <div className="text-[11px] text-slate-600 mt-1 leading-snug">{hint}</div>
    </div>
  );
}

function SignalsBlock({ row }: { row: DailyPairRiskRow }) {
  const s = row.signals || {};
  const ratios = s.ratios || {};
  const breakdown = s.breakdown || {};
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
      <div className="bg-white border border-slate-200 rounded p-2">
        <div className="font-medium mb-1">
          Повтор — {Number(row.repeat_ratio).toFixed(1)}
        </div>
        <div className="text-slate-500 mb-1">
          заказов: <b>{s.orders_count ?? 0}</b> · безнал {s.noncash_orders ?? 0}
        </div>
        <div className="text-slate-400">
          порог 3 → 10 заказов
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded p-2">
        <div className="font-medium mb-1">
          Подозрительность — {Number(row.suspicious_ratio).toFixed(1)}
        </div>
        <ul className="space-y-0.5">
          <li className="flex justify-between gap-2">
            <span className="text-slate-600">безнал 60%</span>
            <span className="tabular-nums text-slate-800">
              {(breakdown.suspicious_noncash ?? 0).toFixed(2)}
            </span>
          </li>
          <li className="flex justify-between gap-2">
            <span className="text-slate-600">короткие+быстрые 40%</span>
            <span className="tabular-nums text-slate-800">
              {(breakdown.suspicious_combo ?? 0).toFixed(2)}
            </span>
          </li>
        </ul>
        <div className="mt-1 text-slate-400">
          безнал {ratios.noncash ?? 0} · короткие+быстрые/2 {ratios.short_fast_combo ?? 0}
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded p-2">
        <div className="font-medium mb-1">
          Зависимость кэшбэка — {Number(row.cashback_dependency).toFixed(1)}
        </div>
        <div className="text-slate-500 mb-1">
          доля безналичных клиента у этой пары: <b>{ratios.client_share_by_pair ?? 0}</b>
        </div>
        <div className="text-slate-400">
          доля заказов водителя у этого клиента: {ratios.driver_share_by_pair ?? 0}
        </div>
        <div className="mt-1 text-slate-400">
          кэшбэк {s.cashback_pct_used ?? 0}% × безналичный оборот {fmtMoney(s.noncash_gmv ?? 0)} = {fmtMoney(s.cashback_paid_byn ?? 0)} BYN
        </div>
      </div>
    </div>
  );
}
