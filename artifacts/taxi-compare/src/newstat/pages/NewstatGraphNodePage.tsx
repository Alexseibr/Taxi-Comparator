import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { NewstatLayout } from "../components/NewstatLayout";
import { newstatApi, type GraphNode, type GraphPartner } from "../lib/api";
import { MlCell } from "./NewstatGraphClusterPage";

function fmtMoney(s: string | number): string {
  return Number(s).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function fmtNum(n: number | string): string {
  return Number(n).toLocaleString("ru-RU");
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function NewstatGraphNodePage() {
  const params = useParams<{ type: string; id: string }>();
  const type = (params.type === "client" ? "client" : "driver") as "driver" | "client";
  const id = decodeURIComponent(params.id ?? "");

  const [node, setNode] = useState<GraphNode | null>(null);
  const [partners, setPartners] = useState<GraphPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    (async () => {
      const r = await newstatApi.graphNode(type, id);
      if (!alive) return;
      if (r.ok) {
        setNode(r.data.node);
        setPartners(r.data.partners);
      } else {
        setErr(r.error);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [type, id]);

  const partnerType = type === "driver" ? "client" : "driver";
  const partnerLabel = type === "driver" ? "Клиент" : "Водитель";

  return (
    <NewstatLayout title={`${type === "driver" ? "Водитель" : "Клиент"} ${id}`}>
      <div className="mb-3 text-sm">
        <Link href="/newstat/graph" className="text-sky-700 hover:underline">← Все кластеры</Link>
      </div>

      {loading && <div className="text-slate-500">Загрузка…</div>}
      {err && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-4 py-2 text-sm">
          Ошибка: {err}
        </div>
      )}

      {node && !loading && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="Заказов" value={fmtNum(node.total_orders)} />
            <Stat label="GMV, BYN" value={fmtMoney(node.total_gmv)} />
            <Stat label="Безнал GMV, BYN" value={fmtMoney(node.total_noncash_gmv)} />
            <Stat label="Партнёров" value={fmtNum(node.unique_partners)} />
            <Stat label="Связей (пар-дат)" value={fmtNum(node.total_connections)} />
            <Stat label="Кэшбэк выдан, BYN" value={fmtMoney(node.total_cashback_generated)} />
            <Stat label="Кэшбэк-риск, BYN" value={fmtMoney(node.total_cashback_risk)} tone="rose" />
            <Stat label="Avg / Max риск" value={`${fmtMoney(node.risk_score_avg)} / ${fmtMoney(node.risk_score_max)}`} />
            {node.cluster_id && (
              <div className="col-span-full text-sm">
                <span className="text-slate-500">Кластер: </span>
                <Link href={`/newstat/graph/${encodeURIComponent(node.cluster_id)}`} className="text-sky-700 hover:underline font-mono text-xs">
                  {node.cluster_id}
                </Link>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-sm font-medium">
              Топ-партнёры (до 50)
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-left">
                <tr>
                  <th className="px-3 py-2">{partnerLabel}</th>
                  <th className="px-3 py-2 text-right">Заказов</th>
                  <th className="px-3 py-2 text-right">Безнал</th>
                  <th className="px-3 py-2 text-right">GMV, BYN</th>
                  <th className="px-3 py-2 text-right">Кэшбэк-риск, BYN</th>
                  <th className="px-3 py-2 text-right">Сила</th>
                  <th className="px-3 py-2 text-right">Pair-риск</th>
                  <th className="px-3 py-2 text-right">ML</th>
                  <th className="px-3 py-2">Период</th>
                </tr>
              </thead>
              <tbody>
                {partners.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-4 text-center text-slate-500">Нет связей.</td></tr>
                )}
                {partners.map((p) => (
                  <tr key={p.partner_id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link
                        href={`/newstat/graph/node/${partnerType}/${encodeURIComponent(p.partner_id)}`}
                        className="text-sky-700 hover:underline"
                      >
                        {p.partner_id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right">{fmtNum(p.orders_count)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(p.noncash_orders)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(p.total_gmv)}</td>
                    <td className="px-3 py-2 text-right text-rose-700">{fmtMoney(p.cashback_loss_risk_byn)}</td>
                    <td className="px-3 py-2 text-right">{Number(p.edge_strength).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(p.pair_risk_score)}</td>
                    <td className="px-3 py-2 text-right">
                      <MlCell score={p.ml_score} disagreement={p.ml_disagreement} />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {fmtDate(p.first_seen_date)}—{fmtDate(p.last_seen_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </NewstatLayout>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "rose" }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`font-semibold ${tone === "rose" ? "text-rose-700" : ""}`}>{value}</div>
    </div>
  );
}
