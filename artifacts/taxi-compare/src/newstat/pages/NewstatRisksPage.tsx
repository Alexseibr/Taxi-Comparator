import { Fragment, useEffect, useMemo, useState } from "react";
import { NewstatLayout } from "../components/NewstatLayout";
import {
  newstatApi,
  type DailyDriverRiskRow,
  type DailySummary,
} from "../lib/api";
import { useNewstatDate } from "../lib/use-newstat-date";

function fmtMoney(s: string | number): string {
  return Number(s).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Цвет фона по риску: 0..30 нейтрально, 30..70 янтарно, 70..100 красно.
function riskTone(score: number): string {
  if (score >= 70) return "bg-rose-100 text-rose-800 border-rose-200";
  if (score >= 30) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

export function NewstatRisksPage() {
  const [date, setDate] = useNewstatDate();
  const [rows, setRows] = useState<DailyDriverRiskRow[]>([]);
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
        newstatApi.dailyDriverRisks(date),
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

  // Safari/Mobile-friendly: явная локальная конструкция вместо T00:00:00.
  const [yyyy, mm, dd] = date.split("-").map(Number);
  const dateRu = new Date(yyyy, (mm || 1) - 1, dd || 1).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const visible = useMemo(() => {
    // С главного экрана нас интересуют только заметные кейсы.
    // Чисто нулевые риски прячем — у активных водителей их сотни.
    return rows.filter((r) => Number(r.total_risk) > 0);
  }, [rows]);

  return (
    <NewstatLayout title="Риск по водителям">
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

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <SummaryCard
          label="Всего под риском"
          value={summary ? fmtMoney(summary.risk_money_total) : "—"}
          unit="BYN"
          tone="warn"
          hint="Сумма по всем категориям риска по водителям за день."
        />
        <SummaryCard
          label="Гарантия"
          value={summary ? fmtMoney(summary.risk_money_guarantee) : "—"}
          unit="BYN"
          tone="neutral"
          hint="Выплаты qualified-водителям с признаками формальной отработки."
        />
        <SummaryCard
          label="Накрутка / GMV"
          value={summary ? fmtMoney(summary.risk_money_earnings) : "—"}
          unit="BYN"
          tone="neutral"
          hint="Доля GMV под подозрением (отмены, нал+короткие, концентрация)."
        />
        <SummaryCard
          label="Сговор (1 клиент)"
          value={summary ? fmtMoney(summary.risk_money_collusion) : "—"}
          unit="BYN"
          tone="neutral"
          hint="Безналичный GMV на топ-клиента с высоким повтором."
        />
      </section>

      {err && (
        <div className="mb-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          Ошибка загрузки: {err}
        </div>
      )}

      {!loading && visible.length === 0 && !err && (
        <div className="rounded bg-slate-100 border border-slate-200 p-3 text-sm text-slate-600">
          За {dateRu} модели не нашли водителей под риском (
          {rows.length === 0 ? "данных за день нет" : `проверено ${rows.length}`}).
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="font-medium mb-2 text-sm">
          Топ по «деньгам под риском» — {visible.length}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600 text-xs">
              <tr>
                <th className="p-2 font-medium text-left">Водитель</th>
                <th className="p-2 font-medium text-right">Гарантия</th>
                <th className="p-2 font-medium text-right">Накрутка</th>
                <th className="p-2 font-medium text-right">Сговор</th>
                <th className="p-2 font-medium text-right">Итог риска</th>
                <th className="p-2 font-medium text-right">Деньги, BYN</th>
                <th className="p-2 font-medium text-center">Сигналы</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const isOpen = openId === r.driver_id;
                return (
                  <Fragment key={r.driver_id}>
                    <tr className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-2">
                        <div className="font-medium">{r.driver_name || r.driver_id}</div>
                        <div className="text-xs text-slate-400">{r.driver_id}</div>
                      </td>
                      <td className="p-2 text-right">
                        <RiskBadge score={Number(r.guarantee_risk)} />
                        <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                          {fmtMoney(r.guarantee_money_byn)}
                        </div>
                      </td>
                      <td className="p-2 text-right">
                        <RiskBadge score={Number(r.earnings_risk)} />
                        <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                          {fmtMoney(r.earnings_money_byn)}
                        </div>
                      </td>
                      <td className="p-2 text-right">
                        <RiskBadge score={Number(r.collusion_risk)} />
                        <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                          {fmtMoney(r.collusion_money_byn)}
                        </div>
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
                          aria-controls={`signals-${r.driver_id}`}
                          onClick={() => setOpenId(isOpen ? null : r.driver_id)}
                        >
                          {isOpen ? "▲ скрыть" : "▼ показать"}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50">
                        <td colSpan={7} className="p-3" id={`signals-${r.driver_id}`}>
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
            <b>Гарантия</b>: только для «отработавших» (qualified) — короткие
            поездки, быстрые подачи, повтор клиентов, мало заказов на час смены.
            Деньги под риском — выплата по гарантии, пропорционально score.
          </li>
          <li>
            <b>Накрутка</b>: высокий процент отмен, доля коротких поездок,
            «нал + короткие», концентрация на одном клиенте. Деньги — 10% от GMV
            водителя, пропорционально score.
          </li>
          <li>
            <b>Сговор</b>: концентрация заказов на одном клиенте + повтор. Деньги
            — оценка безналичного GMV с топ-клиентом (точнее посчитаем в
            pair-модели).
          </li>
        </ul>
        <div className="mt-2">
          Итоговый риск = max из трёх моделей; деньги под риском суммируются (это
          разные категории). Скор &lt; 30 не учитывается в деньгах, чтобы не
          шуметь.
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

// Раскрытие сигналов: показываем коэффициенты и вклады.
function SignalsBlock({ row }: { row: DailyDriverRiskRow }) {
  const s = row.signals || {};
  const ratios = s.ratios || {};
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
      <div className="bg-white border border-slate-200 rounded p-2">
        <div className="font-medium mb-1">
          Гарантия — {Number(row.guarantee_risk).toFixed(1)}{" "}
          <span className="text-slate-400">
            ({fmtMoney(row.guarantee_money_byn)} BYN)
          </span>
        </div>
        <div className="text-slate-500 mb-1">
          допущен: {s.qualified ? "да" : "нет"} · выплата {fmtMoney(s.payout_byn ?? 0)} BYN ·
          часов смены {s.shift_hours ?? 0}
        </div>
        <KV obj={s.guarantee || {}} />
        <div className="mt-1 text-slate-400">
          короткие {ratios.short_trip ?? 0} · быстрые {ratios.fast_arrival ?? 0} · повтор{" "}
          {ratios.repeat_client ?? 0} · заказов/час {ratios.orders_per_shift_hour ?? 0}
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded p-2">
        <div className="font-medium mb-1">
          Накрутка — {Number(row.earnings_risk).toFixed(1)}{" "}
          <span className="text-slate-400">
            ({fmtMoney(row.earnings_money_byn)} BYN)
          </span>
        </div>
        <KV obj={s.earnings || {}} />
        <div className="mt-1 text-slate-400">
          отмены {ratios.cancel ?? 0} · нал {ratios.cash ?? 0} · короткие{" "}
          {ratios.short_trip ?? 0} · концентрация {ratios.concentration_one_client ?? 0}
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded p-2">
        <div className="font-medium mb-1">
          Сговор — {Number(row.collusion_risk).toFixed(1)}{" "}
          <span className="text-slate-400">
            ({fmtMoney(row.collusion_money_byn)} BYN)
          </span>
        </div>
        <KV obj={s.collusion || {}} />
        <div className="mt-1 text-slate-400">
          концентрация {ratios.concentration_one_client ?? 0} · повтор{" "}
          {ratios.repeat_client ?? 0}
        </div>
      </div>
    </div>
  );
}

const KV_LABEL: Record<string, string> = {
  noncash: "безнал",
  cash: "наличные",
  cancel: "отмены",
  short_trip: "короткие поездки",
  fast_arrival: "быстрый подъезд",
  short_fast_combo: "короткие+быстрые",
  orders_per_shift_hour: "заказов/час",
  concentration_one_driver: "один водитель",
  concentration_one_client: "один клиент",
  one_driver: "один водитель",
  one_client: "один клиент",
  repeat: "повтор",
  repeat_driver: "повтор водителя",
  repeat_client: "повтор клиента",
  suspicious_combo: "подозрительная комбинация",
  suspicious_noncash: "подозрительный безнал",
  qualified: "допущен",
  payout_byn: "выплата, BYN",
  shift_hours: "часов смены",
  s1_short_trip: "короткие поездки",
  s2_fast_arrival: "быстрый подъезд",
  s3_repeat_client: "повтор клиента",
  s4_low_activity: "низкая активность",
  e1_cancel: "отмены",
  e2_short_trip: "короткие поездки",
  e3_cash_short: "короткие за наличные",
  e4_concentration: "концентрация на одном клиенте",
  c1_concentration: "концентрация на одном клиенте",
  c2_repeat_client: "повтор клиента",
  noncash_top_client_estimate_byn: "оценка по топ-клиенту, BYN",
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
