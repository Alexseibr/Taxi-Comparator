import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useRoute } from "wouter";
import { NewstatLayout } from "../components/NewstatLayout";
import {
  newstatApi,
  type TicketDecision,
  type TicketDetail,
  type TicketEntityType,
  type TicketEvent,
  type TicketHistoryItem,
  type TicketPriority,
  type TicketStatus,
} from "../lib/api";
import { useNewstatUser } from "../lib/auth-store";
import { PairDrawer, type PairRef } from "../components/PairDrawer";
import SignalsView from "../components/SignalsView";

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

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_LABEL: Record<TicketStatus, string> = {
  new: "новый",
  in_review: "в работе",
  confirmed_fraud: "подтверждён",
  false_positive: "ложный",
  closed: "закрыт",
};
const PRIORITY_LABEL: Record<TicketPriority, string> = {
  high: "высокий", medium: "средний", low: "низкий",
};
const ENTITY_LABEL: Record<TicketEntityType, string> = {
  driver: "Водитель", client: "Клиент", pair: "Связка водитель–клиент",
};

const DECISION_LABEL: Record<TicketDecision, string> = {
  allow: "Ложное срабатывание",
  monitor: "Наблюдать",
  deny_payout: "Обнулить гарантию",
  block_cashback: "Заблокировать кэшбэк",
};

const EVENT_ACTION_LABEL: Record<string, string> = {
  created: "создан",
  status_changed: "смена статуса",
  decision_applied: "применено решение",
  comment_added: "комментарий",
  reopened: "переоткрыт",
  closed: "закрыт",
  assigned: "назначен",
};

const ORDER_COL_LABEL: Record<string, string> = {
  order_id: "Заказ",
  score: "Скор",
  gmv: "GMV, BYN",
  km: "Км",
  trip_minutes: "Поездка, мин",
  arrival_minutes: "Подъезд, мин",
  payment_type: "Оплата",
  status: "Статус",
  flags: "Флаги",
  created_at: "Создан",
  driver_id: "Водитель",
  client_id: "Клиент",
};

const PAYMENT_TYPE_LABEL: Record<string, string> = {
  cash: "наличные",
  noncash: "безнал",
  card: "карта",
  unknown: "—",
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  completed: "выполнен",
  cancelled: "отменён",
  canceled: "отменён",
  searching: "поиск",
  unknown: "—",
  in_progress: "в работе",
};

const FLAG_LABEL: Record<string, string> = {
  short: "короткая поездка",
  noncash: "безнал",
  fast_arr: "быстрый подъезд",
  fast_arrival: "быстрый подъезд",
  repeat: "повтор",
  suspicious: "подозрительный",
  cashback: "кэшбэк",
};

function statusTone(s: TicketStatus): string {
  switch (s) {
    case "new":             return "bg-sky-100 text-sky-800 border-sky-200";
    case "in_review":       return "bg-amber-100 text-amber-800 border-amber-200";
    case "confirmed_fraud": return "bg-rose-100 text-rose-800 border-rose-200";
    case "false_positive":  return "bg-emerald-100 text-emerald-800 border-emerald-200";
    default:                return "bg-slate-100 text-slate-600 border-slate-200";
  }
}
function priorityTone(p: TicketPriority): string {
  if (p === "high")   return "bg-rose-100 text-rose-800 border-rose-200";
  if (p === "medium") return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

interface DecisionOption {
  value: TicketDecision;
  label: string;
  hint: string;
  className: string;
  appliesTo: TicketEntityType[];
  /** Подтверждение фрода — comment обязателен (бизнес-правило процесса). */
  requiresComment: boolean;
}

const DECISION_OPTIONS: DecisionOption[] = [
  {
    value: "allow",
    label: "Ложное срабатывание",
    hint: "Тикет переходит в false_positive, выплаты/кэшбэк не трогаем.",
    className: "bg-emerald-600 hover:bg-emerald-700 text-white",
    appliesTo: ["driver", "client", "pair"],
    requiresComment: false,
  },
  {
    value: "monitor",
    label: "Наблюдать",
    hint: "Статус «в работе», никаких санкций. Подходит для пограничных случаев.",
    className: "bg-amber-500 hover:bg-amber-600 text-white",
    appliesTo: ["driver", "client", "pair"],
    requiresComment: false,
  },
  {
    value: "deny_payout",
    label: "Обнулить гарантию водителю",
    hint: "Гарантия водителя за день = 0. Сохранённые деньги = снятая гарантия / предотвращённые потери. Комментарий обязателен.",
    className: "bg-rose-600 hover:bg-rose-700 text-white",
    appliesTo: ["driver", "pair"],
    requiresComment: true,
  },
  {
    value: "block_cashback",
    label: "Заблокировать кэшбэк клиенту",
    hint: "Клиенту перестанут начислять кэшбэк. Сохранённые деньги = кэшбэк / предотвращённые потери. Комментарий обязателен.",
    className: "bg-rose-600 hover:bg-rose-700 text-white",
    appliesTo: ["client", "pair"],
    requiresComment: true,
  },
];

export function NewstatTicketDetailPage() {
  const [, params] = useRoute<{ id: string }>("/newstat/tickets/:id");
  const id = params?.id ?? "";
  const { user } = useNewstatUser();
  const canDecide = user?.role === "admin" || user?.role === "antifraud";

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [history, setHistory] = useState<TicketHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState<TicketDecision | "comment" | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [drawerPair, setDrawerPair] = useState<PairRef | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  async function reload() {
    setLoading(true);
    setErr(null);
    const r = await newstatApi.ticketGet(id);
    if (r.ok) {
      setTicket(r.data.ticket);
      setEvents(r.data.events);
      setHistory(r.data.history);
      setComment(r.data.ticket.comment ?? "");
    } else {
      setErr(r.error);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!id) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const decided = ticket && (ticket.status === "confirmed_fraud" || ticket.status === "false_positive");

  async function applyDecision(decision: TicketDecision) {
    if (!ticket || !canDecide) return;
    setSubmitting(decision);
    setSubmitErr(null);
    const r = await newstatApi.ticketDecision(ticket.ticket_id, {
      decision,
      comment: comment.trim() || undefined,
    });
    setSubmitting(null);
    if (!r.ok) {
      setSubmitErr(`Ошибка: ${r.error}`);
      return;
    }
    await reload();
  }

  async function saveComment() {
    if (!ticket || !canDecide || !comment.trim()) return;
    setSubmitting("comment");
    setSubmitErr(null);
    const r = await newstatApi.ticketComment(ticket.ticket_id, comment.trim());
    setSubmitting(null);
    if (!r.ok) {
      setSubmitErr(`Ошибка: ${r.error}`);
      return;
    }
    await reload();
  }

  const availableDecisions = useMemo(() => {
    if (!ticket) return [];
    return DECISION_OPTIONS.filter((o) => o.appliesTo.includes(ticket.entity_type));
  }, [ticket]);

  return (
    <NewstatLayout title={ticket ? `Тикет #${ticket.ticket_id}` : "Тикет"}>
      <PairDrawer pair={drawerPair} onClose={() => setDrawerPair(null)} />

      <div className="mb-4 flex items-center gap-4 text-sm">
        <Link href="/newstat/tickets" className="text-slate-500 hover:underline">← к списку тикетов</Link>
        {ticket?.entity_type === "pair" && ticket.driver_id && ticket.client_id && (
          <button
            onClick={() => setDrawerPair({ driver_id: ticket.driver_id!, client_id: ticket.client_id! })}
            className="ml-auto px-3 py-1.5 text-xs border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg"
          >
            🔍 Контекст пары
          </button>
        )}
      </div>

      {loading && <div className="text-slate-400">Загрузка…</div>}
      {err && (
        <div className="p-3 border border-rose-200 bg-rose-50 text-rose-800 text-sm rounded">
          Ошибка: {err}
        </div>
      )}

      {ticket && (
        <>
          {/* ── ШАПКА ─────────────────────────────────────────── */}
          <section className="bg-white border border-slate-200 rounded p-4 mb-4">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <span className={"inline-block px-2 py-0.5 rounded text-xs border " + statusTone(ticket.status)}>
                {STATUS_LABEL[ticket.status]}
              </span>
              <span className={"inline-block px-2 py-0.5 rounded text-xs border " + priorityTone(ticket.priority)}>
                приоритет: {PRIORITY_LABEL[ticket.priority]}
              </span>
              <span className="text-sm text-slate-500">
                {ENTITY_LABEL[ticket.entity_type]} · {ticket.risk_type}
              </span>
              <span className="text-sm text-slate-500 ml-auto">{fmtDate(ticket.date)}</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Risk score" value={Number(ticket.risk_score).toFixed(0)} />
              <Stat label="Под риском, BYN" value={fmtMoney(ticket.money_at_risk_byn)} tone="warn" />
              <Stat label="Сэкономлено, BYN" value={fmtMoney(ticket.money_saved_byn)} tone="success" />
              <Stat label="Раньше подтверждали" value={ticket.previous_flags_count} />
            </div>

            <div className="mt-3 text-sm text-slate-500 grid grid-cols-1 md:grid-cols-3 gap-2">
              {ticket.driver_id && (
                <div>
                  Водитель: <b className="text-slate-800">{ticket.driver_name || ticket.driver_id}</b>
                  <span className="text-slate-400"> ({ticket.driver_id})</span>
                </div>
              )}
              {ticket.client_id && (
                <div>
                  Клиент: <b className="text-slate-800">Client #{ticket.client_id}</b>
                  {ticket.client_cashback_blocked && (
                    <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-xs border bg-rose-100 text-rose-800 border-rose-200">
                      кэшбэк заблокирован
                    </span>
                  )}
                </div>
              )}
              <div>
                Создан: {fmtDateTime(ticket.created_at)}
                {ticket.updated_at !== ticket.created_at && (
                  <span className="text-slate-400"> · обновлён {fmtDateTime(ticket.updated_at)}</span>
                )}
              </div>
            </div>
          </section>

          {/* ── РЕШЕНИЕ (кнопки сначала) ─────────────────────── */}
          <section className="bg-white border border-slate-200 rounded p-4 mb-4">
            {decided ? (
              <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border mb-3 ${
                ticket.status === "confirmed_fraud"
                  ? "bg-rose-50 border-rose-200 text-rose-800"
                  : "bg-emerald-50 border-emerald-200 text-emerald-800"
              }`}>
                <span className="text-lg">{ticket.status === "confirmed_fraud" ? "🚨" : "✅"}</span>
                <div>
                  <p className="font-semibold">{STATUS_LABEL[ticket.status]}</p>
                  {ticket.decision && (
                    <p className="text-sm opacity-80">{DECISION_LABEL[ticket.decision]}</p>
                  )}
                </div>
                {ticket.label_status === "labeled" && (
                  <span className="ml-auto text-xs opacity-70">
                    ML метка: {ticket.label_value === 1 ? "fraud (1)" : "false positive (0)"}
                  </span>
                )}
              </div>
            ) : (
              <>
                {!canDecide && (
                  <div className="text-sm text-amber-700 mb-3">
                    Только admin/antifraud могут принимать решение.
                  </div>
                )}

                {/* Основные кнопки */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                  {availableDecisions.map((opt) => {
                    const commentMissing = opt.requiresComment && !comment.trim();
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={!canDecide || submitting !== null || commentMissing}
                        title={commentMissing ? "Сначала введите комментарий." : opt.hint}
                        onClick={() => void applyDecision(opt.value)}
                        className={`px-3 py-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${opt.className}`}
                      >
                        {submitting === opt.value ? "…" : opt.label}
                      </button>
                    );
                  })}
                </div>

                {/* Авто-ML уведомление */}
                <div className="text-xs text-slate-400 mb-3 flex items-center gap-1.5">
                  <span>🤖</span>
                  <span>ML-метка выставляется автоматически: подтверждение → <code>label=1</code>, ложное → <code>label=0</code></span>
                </div>

                {/* Комментарий */}
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Комментарий (обязателен для «Обнулить гарантию» и «Заблокировать кэшбэк»)"
                  className="w-full border rounded p-2 text-sm min-h-[56px] mb-2"
                  maxLength={2000}
                  disabled={!canDecide}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={submitting !== null || !comment.trim()}
                    onClick={() => void saveComment()}
                    className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
                  >
                    {submitting === "comment" ? "…" : "Сохранить комментарий"}
                  </button>
                </div>
              </>
            )}

            {submitErr && (
              <div className="mt-3 text-sm text-rose-700">{submitErr}</div>
            )}
          </section>

          {/* ── ДЕТАЛИ (collapse) ────────────────────────────── */}
          <section className="bg-white border border-slate-200 rounded mb-4">
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 rounded"
            >
              <span className="font-semibold text-sm">
                Детали: сигналы и подозрительные заказы
                <span className="ml-2 text-slate-400 font-normal">
                  ({ticket.suspicious_orders?.length ?? 0} заказов)
                </span>
              </span>
              <span className="text-slate-400 text-xs">{detailsOpen ? "▲ свернуть" : "▼ развернуть"}</span>
            </button>
            {detailsOpen && (
              <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-slate-600 mb-2">Сигналы</h3>
                  <SignalsView signals={ticket.signals} />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-slate-600 mb-2">
                    Подозрительные заказы (топ {ticket.suspicious_orders?.length ?? 0})
                  </h3>
                  <SuspiciousOrdersTable rows={ticket.suspicious_orders ?? []} />
                </div>
              </div>
            )}
          </section>

          {/* ── HISTORY: 7 дней ─────────────────────────────── */}
          {history.length > 1 && (
            <section className="bg-white border border-slate-200 rounded p-4 mb-4">
              <h2 className="font-semibold mb-3">История за 7 дней</h2>
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="px-2 py-1">Дата</th>
                    <th className="px-2 py-1 text-right">Risk</th>
                    <th className="px-2 py-1 text-right">Под риском</th>
                    <th className="px-2 py-1 text-right">Сэкономлено</th>
                    <th className="px-2 py-1">Статус</th>
                    <th className="px-2 py-1">Решение</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-2 py-1">{fmtDate(h.date)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{Number(h.risk_score).toFixed(0)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(h.money_at_risk_byn)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtMoney(h.money_saved_byn)}</td>
                      <td className="px-2 py-1">{STATUS_LABEL[h.status]}</td>
                      <td className="px-2 py-1 text-slate-500">{h.decision ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* ── EVENTS ───────────────────────────────────────── */}
          <section className="bg-white border border-slate-200 rounded p-4 mb-4">
            <h2 className="font-semibold mb-3">События</h2>
            {events.length === 0 ? (
              <div className="text-sm text-slate-400">пока нет</div>
            ) : (
              <ul className="space-y-2">
                {events.map((e) => (
                  <li key={e.id} className="text-sm border-l-2 border-slate-200 pl-3">
                    <div className="text-slate-500 text-xs">
                      {fmtDateTime(e.created_at)} · {e.user_id || "система"}
                    </div>
                    <div className="font-medium">
                      {EVENT_ACTION_LABEL[e.action] ?? e.action}
                      {e.old_status && e.new_status && (
                        <>
                          : <span className="text-slate-500">{STATUS_LABEL[e.old_status]}</span> →{" "}
                          <span>{STATUS_LABEL[e.new_status]}</span>
                        </>
                      )}
                      {e.decision && (
                        <span className="ml-2 text-slate-500">
                          ({DECISION_LABEL[e.decision] ?? e.decision})
                        </span>
                      )}
                    </div>
                    {e.comment && <div className="text-slate-700 mt-1 whitespace-pre-wrap">{e.comment}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </NewstatLayout>
  );
}

function Stat({
  label, value, tone = "neutral",
}: {
  label: string; value: string | number; tone?: "neutral" | "warn" | "success";
}) {
  const cls = tone === "warn"
    ? "border-amber-300"
    : tone === "success"
      ? "border-emerald-300"
      : "border-slate-200";
  return (
    <div className={"border rounded p-2 " + cls}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fmtSimple(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    return v.toLocaleString("ru-RU", { maximumFractionDigits: 4 });
  }
  if (typeof v === "boolean") return v ? "да" : "нет";
  return String(v);
}

function FlagsChips({ flags }: { flags: unknown }) {
  if (!isPlainObject(flags)) return <span>—</span>;
  const active = Object.entries(flags).filter(([, v]) => v === true).map(([k]) => k);
  if (active.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {active.map((k) => (
        <span key={k} className="inline-block px-1.5 py-0.5 rounded text-[11px] bg-rose-50 text-rose-700 border border-rose-200">
          {FLAG_LABEL[k] ?? k}
        </span>
      ))}
    </div>
  );
}

function fmtOrderCell(col: string, v: unknown): ReactNode {
  if (col === "flags") return <FlagsChips flags={v} />;
  if (col === "payment_type" && typeof v === "string") {
    return PAYMENT_TYPE_LABEL[v] ?? v;
  }
  if (col === "status" && typeof v === "string") {
    return ORDER_STATUS_LABEL[v] ?? v;
  }
  if (col === "created_at" && typeof v === "string") {
    return fmtDateTime(v);
  }
  if ((col === "gmv" || col === "score" || col === "km" || col === "trip_minutes" || col === "arrival_minutes")
      && (typeof v === "number" || typeof v === "string")) {
    const n = Number(v);
    if (Number.isFinite(n)) return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  }
  return fmtSimple(v);
}

function SuspiciousOrdersTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows || rows.length === 0) {
    return <div className="text-sm text-slate-400">нет</div>;
  }
  // Колонки берём из первой строки динамически + фиксированный приоритет.
  const preferred = ["order_id", "score", "gmv", "km", "trip_minutes", "arrival_minutes", "payment_type", "status", "flags", "created_at"];
  const allKeys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const cols = preferred.filter((k) => allKeys.includes(k))
    .concat(allKeys.filter((k) => !preferred.includes(k)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-slate-500 bg-slate-50">
          <tr>{cols.map((c) => (
            <th key={c} className="px-2 py-1 font-medium">{ORDER_COL_LABEL[c] ?? c}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {cols.map((c) => (
                <td key={c} className="px-2 py-1 align-top whitespace-pre-wrap break-words">
                  {fmtOrderCell(c, r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
