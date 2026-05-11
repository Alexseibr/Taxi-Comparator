import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { newstatApi, type PairContext } from "../lib/api";

// ── helpers ───────────────────────────────────────────────────────────────────

function scoreColor(v: number | null) {
  if (v === null) return "text-slate-400";
  if (v >= 70) return "text-rose-600 font-bold";
  if (v >= 50) return "text-amber-600 font-semibold";
  return "text-emerald-600";
}

function fmtMoney(v: number | null) {
  if (v === null) return "—";
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Bar({ value, color }: { value: number | null; color: string }) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  return (
    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: number | null }) {
  const color = value !== null && value >= 70 ? "bg-rose-400"
              : value !== null && value >= 50 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-slate-500">{label}</span>
        <span className={scoreColor(value)}>{value !== null ? `${value.toFixed(0)}` : "—"}</span>
      </div>
      <Bar value={value} color={color} />
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  in_review: "bg-yellow-100 text-yellow-700",
  confirmed_fraud: "bg-rose-100 text-rose-700",
  false_positive: "bg-emerald-100 text-emerald-700",
  closed: "bg-slate-100 text-slate-500",
};

// ── PairDrawer ────────────────────────────────────────────────────────────────

export interface PairRef {
  driver_id: string;
  client_id: string;
}

interface Props {
  pair: PairRef | null;
  onClose: () => void;
}

export function PairDrawer({ pair, onClose }: Props) {
  const [ctx, setCtx] = useState<PairContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);

  const load = useCallback(async (driverId: string, clientId: string) => {
    setCtx(null);
    setLoading(true);
    setOrdersOpen(false);
    const r = await newstatApi.pairsContext(driverId, clientId);
    if (r.ok && r.data) setCtx(r.data as PairContext);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (pair) load(pair.driver_id, pair.client_id);
  }, [pair, load]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!pair) return null;

  return (
    <>
      {/* backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-[2000]"
        onClick={onClose}
      />
      {/* drawer */}
      <aside className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-[2001] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-slate-50">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Контекст связки</p>
            <p className="font-mono text-sm font-semibold text-slate-800">
              {pair.driver_id} <span className="text-slate-400 mx-1">→</span> {pair.client_id}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xl font-light leading-none p-1"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Загрузка…
            </div>
          )}

          {!loading && ctx && (
            <>
              {/* Scores */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Риск-скоры</h3>
                <div className="space-y-2.5">
                  <ScoreRow label="Rule score" value={ctx.rule_score} />
                  <ScoreRow label="ML score" value={ctx.ml_score} />
                  <ScoreRow label="Repeat ratio" value={ctx.repeat_ratio} />
                  <ScoreRow label="Suspicious ratio" value={ctx.suspicious_ratio} />
                  <ScoreRow label="Cashback dependency" value={ctx.cashback_dependency} />
                </div>
              </section>

              {/* Money + Device */}
              <section className="grid grid-cols-2 gap-3">
                <div className="bg-rose-50 border border-rose-100 rounded-lg p-3 text-center">
                  <p className="text-xs text-rose-500 mb-1">Деньги под риском</p>
                  <p className="text-lg font-bold text-rose-700 tabular-nums">
                    {fmtMoney(ctx.money_at_risk)} <span className="text-sm font-normal">BYN</span>
                  </p>
                </div>
                <div className="bg-purple-50 border border-purple-100 rounded-lg p-3 text-center">
                  <p className="text-xs text-purple-500 mb-1">Устройств / IP</p>
                  <p className="text-lg font-bold text-purple-700">
                    {ctx.shared_device_count} / {ctx.shared_ip_count}
                  </p>
                  {ctx.shared_device_count > 0 && (
                    <p className="text-xs text-purple-400 mt-0.5">мульти-аккаунт</p>
                  )}
                </div>
              </section>

              {/* Tickets */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Последние тикеты ({ctx.tickets.length})
                </h3>
                {ctx.tickets.length === 0 ? (
                  <p className="text-sm text-slate-400">Тикетов нет</p>
                ) : (
                  <div className="space-y-2">
                    {ctx.tickets.map((t) => (
                      <Link
                        key={t.ticket_id}
                        href={`/newstat/tickets/${t.ticket_id}`}
                        className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                      >
                        <div>
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${STATUS_COLOR[t.status] ?? "bg-slate-100 text-slate-600"}`}>
                            {t.status}
                          </span>
                          <span className="text-xs text-slate-500 ml-2">{t.date}</span>
                          {t.risk_type && (
                            <span className="text-xs text-slate-400 ml-2">{t.risk_type}</span>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold text-slate-700 tabular-nums">
                            {fmtMoney(t.money_at_risk_byn)} BYN
                          </p>
                          <p className="text-xs text-slate-400">score {t.risk_score}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>

              {/* Orders (collapsible) */}
              <section>
                <button
                  onClick={() => setOrdersOpen((v) => !v)}
                  className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 hover:text-slate-700"
                >
                  <span>{ordersOpen ? "▾" : "▸"}</span>
                  Заказы ({ctx.orders.length})
                </button>
                {ordersOpen && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-left text-slate-400 border-b">
                          <th className="pb-1 pr-3">Дата</th>
                          <th className="pb-1 pr-3">Статус</th>
                          <th className="pb-1 pr-3 text-right">GMV</th>
                          <th className="pb-1 pr-3 text-right">Км</th>
                          <th className="pb-1 text-right">Мин</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ctx.orders.map((o) => (
                          <tr key={o.order_id} className="border-b border-slate-50 hover:bg-slate-50">
                            <td className="py-1 pr-3 tabular-nums">{o.order_date}</td>
                            <td className="py-1 pr-3">
                              <span className={`px-1 rounded text-xs ${o.payment_type === "noncash" ? "bg-blue-50 text-blue-600" : "bg-slate-50 text-slate-500"}`}>
                                {o.payment_type ?? "—"}
                              </span>
                            </td>
                            <td className="py-1 pr-3 text-right tabular-nums">
                              {o.gmv != null ? o.gmv.toFixed(2) : "—"}
                            </td>
                            <td className="py-1 pr-3 text-right tabular-nums">
                              {o.km != null ? o.km.toFixed(1) : "—"}
                            </td>
                            <td className="py-1 text-right tabular-nums">
                              {o.trip_minutes != null ? o.trip_minutes.toFixed(0) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Graph / ticket links */}
              <section className="flex flex-wrap gap-2 pt-1 border-t">
                <Link
                  href={`/newstat/graph/node/driver/${encodeURIComponent(pair.driver_id)}`}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Граф водителя →
                </Link>
                <Link
                  href={`/newstat/graph/node/client/${encodeURIComponent(pair.client_id)}`}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Граф клиента →
                </Link>
                <Link
                  href={`/newstat/hidden-links`}
                  className="text-xs text-purple-600 hover:underline"
                >
                  Скрытые связи →
                </Link>
              </section>
            </>
          )}

          {!loading && !ctx && (
            <div className="py-16 text-center text-slate-400 text-sm">
              Нет данных по этой паре
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
