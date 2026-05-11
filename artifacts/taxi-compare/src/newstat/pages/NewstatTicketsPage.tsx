import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { NewstatLayout } from "../components/NewstatLayout";
import {
  newstatApi,
  type DailySummary,
  type TicketEntityType,
  type TicketListItem,
  type TicketPriority,
  type TicketStatus,
} from "../lib/api";
import { useNewstatDate } from "../lib/use-newstat-date";

function fmtMoney(s: string | number): string {
  return Number(s).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function priorityTone(p: TicketPriority): string {
  switch (p) {
    case "high":   return "bg-rose-100 text-rose-800 border-rose-200";
    case "medium": return "bg-amber-100 text-amber-800 border-amber-200";
    default:       return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function statusTone(s: TicketStatus): string {
  switch (s) {
    case "new":             return "bg-sky-100 text-sky-800 border-sky-200";
    case "in_review":       return "bg-amber-100 text-amber-800 border-amber-200";
    case "confirmed_fraud": return "bg-rose-100 text-rose-800 border-rose-200";
    case "false_positive":  return "bg-emerald-100 text-emerald-800 border-emerald-200";
    default:                return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

const STATUS_LABEL: Record<TicketStatus, string> = {
  new:             "новый",
  in_review:       "в работе",
  confirmed_fraud: "подтверждён",
  false_positive:  "ложный",
  closed:          "закрыт",
};

const ENTITY_LABEL: Record<TicketEntityType, string> = {
  driver: "Водитель",
  client: "Клиент",
  pair:   "Связка",
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  high:   "высокий",
  medium: "средний",
  low:    "низкий",
};

export function NewstatTicketsPage() {
  const [date, setDate] = useNewstatDate();
  const [status, setStatus] = useState<TicketStatus | "">("");
  const [entityType, setEntityType] = useState<TicketEntityType | "">("");
  const [priority, setPriority] = useState<TicketPriority | "">("");
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    (async () => {
      const [t, s] = await Promise.all([
        newstatApi.ticketsList({
          date,
          status: status || undefined,
          entity_type: entityType || undefined,
          priority: priority || undefined,
          limit: 200,
        }),
        newstatApi.dailySummary(date),
      ]);
      if (!alive) return;
      if (t.ok) setTickets(t.data.tickets);
      else setErr(t.error);
      if (s.ok) setSummary(s.data.summary);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [date, status, entityType, priority]);

  const totals = useMemo(() => {
    const moneyAtRisk = tickets.reduce((acc, t) => acc + Number(t.money_at_risk_byn), 0);
    const moneySaved = tickets
      .filter((t) => t.status === "confirmed_fraud")
      .reduce((acc, t) => acc + Number(t.money_saved_byn), 0);
    return { moneyAtRisk, moneySaved };
  }, [tickets]);

  return (
    <NewstatLayout title="Тикеты — антифрод-решения">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Дата:</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border rounded px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Статус:</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TicketStatus | "")}
            className="border rounded px-2 py-1 bg-white"
          >
            <option value="">все</option>
            {(["new","in_review","confirmed_fraud","false_positive","closed"] as TicketStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Тип:</span>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as TicketEntityType | "")}
            className="border rounded px-2 py-1 bg-white"
          >
            <option value="">все</option>
            <option value="driver">Водитель</option>
            <option value="client">Клиент</option>
            <option value="pair">Связка</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Приоритет:</span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TicketPriority | "")}
            className="border rounded px-2 py-1 bg-white"
          >
            <option value="">все</option>
            <option value="high">высокий</option>
            <option value="medium">средний</option>
            <option value="low">низкий</option>
          </select>
        </label>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard
          label="Тикетов открыто"
          value={summary?.tickets_open ?? tickets.filter((t) => t.status === "new").length}
          tone="warn"
          hint="Тикеты в статусе «новый» (требуют решения)."
        />
        <KpiCard
          label="Подтверждённых фродов"
          value={summary?.tickets_confirmed ?? tickets.filter((t) => t.status === "confirmed_fraud").length}
          tone="danger"
          hint="Решения antifraud, по которым применены санкции."
        />
        <KpiCard
          label="Под риском, BYN"
          value={fmtMoney(summary?.tickets_money_at_risk_total ?? totals.moneyAtRisk)}
          tone="warn"
          hint="Сумма money_at_risk_byn по всем тикетам выбранного дня."
        />
        <KpiCard
          label="Сэкономлено, BYN"
          value={fmtMoney(summary?.money_saved_total ?? totals.moneySaved)}
          tone="success"
          hint="Сумма money_saved_byn по подтверждённым тикетам (deny_payout / block_cashback)."
        />
      </section>

      {err && (
        <div className="mb-4 p-3 border border-rose-200 bg-rose-50 text-rose-800 text-sm rounded">
          Ошибка загрузки: {err}
        </div>
      )}

      <div className="overflow-x-auto bg-white border border-slate-200 rounded">
        <table className="w-full text-sm">
          <thead className="text-left bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 w-12">#</th>
              <th className="px-3 py-2">Тип / участники</th>
              <th className="px-3 py-2 w-24 text-right">Риск</th>
              <th className="px-3 py-2 w-24">Приоритет</th>
              <th className="px-3 py-2 w-32 text-right">Под риском</th>
              <th className="px-3 py-2 w-32 text-right">Сэкономлено</th>
              <th className="px-3 py-2 w-32">Статус</th>
              <th className="px-3 py-2 w-24">Прошлых</th>
              <th className="px-3 py-2 w-32">Кому назначен</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">Загрузка…</td></tr>
            )}
            {!loading && tickets.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                Нет тикетов с такими фильтрами.
              </td></tr>
            )}
            {tickets.map((t) => (
              <tr key={t.ticket_id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 tabular-nums text-slate-500">
                  <Link href={`/newstat/tickets/${t.ticket_id}`} className="hover:underline">
                    #{t.ticket_id}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/newstat/tickets/${t.ticket_id}`} className="block hover:underline">
                    <div className="font-medium">
                      {ENTITY_LABEL[t.entity_type]}
                      <span className="text-slate-400"> · {t.risk_type}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {t.driver_id && <>👤 {t.driver_name || t.driver_id}</>}
                      {t.driver_id && t.client_id && " · "}
                      {t.client_id && <>🆔 Client #{t.client_id}</>}
                      <span className="text-slate-400"> · {fmtDate(t.date)}</span>
                    </div>
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {Number(t.risk_score).toFixed(0)}
                </td>
                <td className="px-3 py-2">
                  <span className={"inline-block px-1.5 py-0.5 rounded text-xs border " + priorityTone(t.priority)}>
                    {PRIORITY_LABEL[t.priority]}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(t.money_at_risk_byn)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                  {Number(t.money_saved_byn) > 0 ? fmtMoney(t.money_saved_byn) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={"inline-block px-1.5 py-0.5 rounded text-xs border " + statusTone(t.status)}>
                    {STATUS_LABEL[t.status]}
                  </span>
                  {t.decision && (
                    <div className="text-xs text-slate-500 mt-0.5">{t.decision}</div>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-600">
                  {t.previous_flags_count > 0 ? t.previous_flags_count : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {t.assigned_to || <span className="text-slate-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </NewstatLayout>
  );
}

function KpiCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string | number;
  tone: "warn" | "danger" | "success" | "neutral";
  hint: string;
}) {
  const toneClass: Record<typeof tone, string> = {
    warn:    "border-amber-300",
    danger:  "border-rose-400",
    success: "border-emerald-300",
    neutral: "border-slate-200",
  } as const;
  return (
    <div className={"bg-white border rounded p-3 " + toneClass[tone]} title={hint}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
