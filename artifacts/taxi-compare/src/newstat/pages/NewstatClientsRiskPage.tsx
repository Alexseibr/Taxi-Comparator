import { Fragment, useEffect, useMemo, useState } from "react";
import { NewstatLayout } from "../components/NewstatLayout";
import {
  newstatApi,
  type DailyClientRiskRow,
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

export function NewstatClientsRiskPage() {
  const [date, setDate] = useNewstatDate();
  const [rows, setRows] = useState<DailyClientRiskRow[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    (async () => {
      const [r, s] = await Promise.all([
        newstatApi.dailyClientRisks(date),
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
    <NewstatLayout title="Риск по клиентам">
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
          label="Кэшбэк начислен"
          value={summary ? fmtMoney(summary.cashback_total) : "—"}
          unit="BYN"
          tone="neutral"
          hint="Сумма кэшбэка по выполненным безналичным заказам за день."
        />
        <SummaryCard
          label="Кэшбэк под риском"
          value={summary ? fmtMoney(summary.cashback_loss_total) : "—"}
          unit="BYN"
          tone="warn"
          hint="Часть кэшбэка по клиентам с признаками фрод-схемы."
        />
        <SummaryCard
          label="Подозрительных клиентов"
          value={summary ? String(summary.risky_clients_count) : "—"}
          unit="чел."
          tone="neutral"
          hint="Клиенты с total_risk ≥ 30 (минимум один сильный сигнал)."
        />
      </section>

      {err && (
        <div className="mb-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          Ошибка загрузки: {err}
        </div>
      )}

      {!loading && visible.length === 0 && !err && (
        <div className="rounded bg-slate-100 border border-slate-200 p-3 text-sm text-slate-600">
          За {dateRu} модели не нашли клиентов под риском (
          {rows.length === 0 ? "данных за день нет" : `проверено ${rows.length}`}).
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="font-medium mb-2 text-sm">
          Топ по «кэшбэку под риском» — {visible.length}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600 text-xs">
              <tr>
                <th className="p-2 font-medium text-left">Клиент</th>
                <th className="p-2 font-medium text-right">Кэшбэк под риском</th>
                <th className="p-2 font-medium text-right">Один водитель</th>
                <th className="p-2 font-medium text-right">Странная активность</th>
                <th className="p-2 font-medium text-right">Итог риска</th>
                <th className="p-2 font-medium text-right">Кэшбэк, BYN</th>
                <th className="p-2 font-medium text-center">Сигналы</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const isOpen = openId === r.client_id;
                return (
                  <Fragment key={r.client_id}>
                    <tr className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-2">
                        <div className="font-medium">
                          {`Client #${r.client_id}`}
                        </div>
                      </td>
                      <td className="p-2 text-right">
                        <RiskBadge score={Number(r.cashback_exposure)} />
                        <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                          {fmtMoney(r.cashback_money_byn)}
                        </div>
                      </td>
                      <td className="p-2 text-right">
                        <RiskBadge score={Number(r.repeat_driver_dependency)} />
                      </td>
                      <td className="p-2 text-right">
                        <RiskBadge score={Number(r.suspicious_activity)} />
                      </td>
                      <td className="p-2 text-right">
                        <RiskBadge score={Number(r.total_risk)} bold />
                      </td>
                      <td className="p-2 text-right tabular-nums font-semibold">
                        {fmtMoney(r.money_at_risk_byn)}
                      </td>
                      <td className="p-2 text-center text-xs">
                        <button
                          type="button"
                          className="text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline focus:outline-none focus:ring focus:ring-slate-300 rounded px-1"
                          aria-expanded={isOpen}
                          aria-controls={`csignals-${r.client_id}`}
                          onClick={() => setOpenId(isOpen ? null : r.client_id)}
                        >
                          {isOpen ? "▲ скрыть" : "▼ показать"}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50">
                        <td colSpan={7} className="p-3" id={`csignals-${r.client_id}`}>
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
            <b>Кэшбэк под риском</b>: короткие поездки + быстрые подачи + 100%
            безналом + один водитель. Деньги под риском = кэшбэк × скор %.
          </li>
          <li>
            <b>Один водитель</b>: концентрация заказов + доля повторов. Деньги
            по этой оси не считаем — это территория модели «связки».
          </li>
          <li>
            <b>Странная активность</b>: много заказов в день + всё безналом +
            короткие в комбинации с быстрыми подачами.
          </li>
        </ul>
        <div className="mt-2">
          Итоговый риск = максимум из трёх моделей; деньги под риском по клиенту
          = только кэшбэк (сговор пар отдельно). Скор &lt; 30 не учитывается,
          чтобы не шуметь.
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

function SignalsBlock({ row }: { row: DailyClientRiskRow }) {
  const s = row.signals || {};
  const ratios = s.ratios || {};
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
      <div className="bg-white border border-slate-200 rounded p-2">
        <div className="font-medium mb-1">
          Кэшбэк под риском — {Number(row.cashback_exposure).toFixed(1)}{" "}
          <span className="text-slate-400">
            ({fmtMoney(row.cashback_money_byn)} BYN)
          </span>
        </div>
        <div className="text-slate-500 mb-1">
          кэшбэк {fmtMoney(s.cashback_earned_byn ?? 0)} BYN · безнал{" "}
          {fmtMoney(s.noncash_gmv_byn ?? 0)} BYN · заказов {s.total_orders ?? 0}
        </div>
        <KV obj={s.cashback_exposure_breakdown || {}} />
        <div className="mt-1 text-slate-400">
          короткие {ratios.short_trip ?? 0} · быстрые {ratios.fast_arrival ?? 0} · безнал{" "}
          {ratios.noncash ?? 0} · один водитель {ratios.concentration_one_driver ?? 0}
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded p-2">
        <div className="font-medium mb-1">
          Один водитель — {Number(row.repeat_driver_dependency).toFixed(1)}
        </div>
        <KV obj={s.repeat_driver_breakdown || {}} />
        <div className="mt-1 text-slate-400">
          концентрация {ratios.concentration_one_driver ?? 0} · повтор{" "}
          {ratios.repeat_driver ?? 0} · водителей {s.unique_drivers ?? 0}
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded p-2">
        <div className="font-medium mb-1">
          Странная активность — {Number(row.suspicious_activity).toFixed(1)}
        </div>
        <KV obj={s.suspicious_breakdown || {}} />
        <div className="mt-1 text-slate-400">
          заказов {s.total_orders ?? 0} · безнал {ratios.noncash ?? 0} · короткие+быстрые min(
          {ratios.short_trip ?? 0}, {ratios.fast_arrival ?? 0})
        </div>
      </div>
    </div>
  );
}

const KV_LABEL: Record<string, string> = {
  noncash: "безнал",
  short_trip: "короткие поездки",
  fast_arrival: "быстрый подъезд",
  short_fast_combo: "короткие+быстрые",
  concentration_one_driver: "один водитель",
  one_driver: "один водитель",
  repeat: "повтор",
  repeat_driver: "повтор водителя",
  suspicious_combo: "подозрительная комбинация",
  suspicious_noncash: "подозрительный безнал",
  cashback_dependency: "зависимость от кэшбэка",
  client_share_by_pair: "доля связки у клиента",
  driver_share_by_pair: "доля связки у водителя",
  s1_short_trip: "короткие поездки",
  s2_fast_arrival: "быстрый подъезд",
  s3_all_noncash: "100% безнал",
  s4_one_driver: "один водитель",
  s1_concentration: "концентрация на водителе",
  s2_repeat_driver: "повтор водителя",
  s1_high_count: "много заказов",
  s2_all_noncash: "100% безнал",
  s3_short_fast_combo: "короткие+быстрые",
};

function KV({ obj }: { obj: Record<string, number> }) {
  const entries = Object.entries(obj);
  if (entries.length === 0) return <div className="text-slate-400 italic">нет вкладов</div>;
  return (
    <ul className="space-y-0.5">
      {entries.map(([k, v]) => (
        <li key={k} className="flex justify-between gap-2">
          <span className="text-slate-600">{KV_LABEL[k] ?? k}</span>
          <span className="tabular-nums text-slate-800">{Number(v).toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}
