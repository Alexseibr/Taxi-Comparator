import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { NewstatLayout } from "../components/NewstatLayout";
import {
  newstatApi,
  type GraphCluster,
  type GraphClusterEdge,
  type GraphClusterType,
  type GraphNode,
} from "../lib/api";

const TYPE_LABEL: Record<GraphClusterType, string> = {
  cashback_ring: "Кэшбэк-кольцо",
  driver_farm:   "Ферма водителя",
  mixed_fraud:   "Смешанный фрод",
  mixed:         "Смешанный",
};

function fmtMoney(s: string | number): string {
  return Number(s).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function fmtNum(n: number | string): string {
  return Number(n).toLocaleString("ru-RU");
}
// repeat_ratio в graph_edges уже хранится в процентах (0..100), множить не нужно.
function fmtPct(s: string | number, d = 0): string {
  return Number(s).toFixed(d) + "%";
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function NewstatGraphClusterPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id ?? "");

  const [cluster, setCluster] = useState<GraphCluster | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphClusterEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    (async () => {
      const r = await newstatApi.graphCluster(id);
      if (!alive) return;
      if (r.ok) {
        setCluster(r.data.cluster);
        setNodes(r.data.nodes);
        setEdges(r.data.edges);
      } else {
        setErr(r.error);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const drivers = nodes.filter((n) => n.entity_type === "driver");
  const clients = nodes.filter((n) => n.entity_type === "client");

  return (
    <NewstatLayout title={`Кластер ${id}`}>
      <div className="mb-3 text-sm">
        <Link href="/newstat/graph" className="text-sky-700 hover:underline">
          ← Все кластеры
        </Link>
      </div>

      {loading && <div className="text-slate-500">Загрузка…</div>}
      {err && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-4 py-2 text-sm">
          Ошибка: {err}
        </div>
      )}

      {cluster && !loading && (
        <div className="space-y-5">
          {/* Сводка */}
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-base font-semibold">
                {TYPE_LABEL[cluster.cluster_type] ?? cluster.cluster_type}
              </span>
              {cluster.is_suspicious && (
                <span className="inline-block px-2 py-0.5 rounded border text-xs bg-rose-100 text-rose-800 border-rose-200">
                  подозрительный
                </span>
              )}
              <span className="text-sm text-slate-500 ml-auto">
                окно: {fmtDate(cluster.window_from)} — {fmtDate(cluster.window_to)}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Stat label="Узлов / водит. / клиент." value={`${cluster.nodes_count} / ${cluster.drivers_count} / ${cluster.clients_count}`} />
              <Stat label="Заказов" value={fmtNum(cluster.total_orders)} />
              <Stat label="GMV, BYN" value={fmtMoney(cluster.total_gmv)} />
              <Stat label="Безнал GMV, BYN" value={fmtMoney(cluster.total_noncash_gmv)} />
              <Stat label="Кэшбэк выдан, BYN" value={fmtMoney(cluster.total_cashback_generated)} />
              <Stat label="Кэшбэк-риск, BYN" value={fmtMoney(cluster.total_cashback_risk)} tone="rose" />
              <Stat label="Потери под риском, BYN" value={fmtMoney(cluster.total_collusion_loss_risk)} tone="rose" />
              <Stat label="Avg / Max риск" value={`${fmtMoney(cluster.avg_risk_score)} / ${fmtMoney(cluster.max_risk_score)}`} />
            </div>
            {cluster.reason && (
              <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded text-sm space-y-1">
                <div><span className="text-slate-500">Причина: </span>{cluster.reason.reason}</div>
                <div><span className="text-slate-500">Деньги: </span>{cluster.reason.money}</div>
                <div><span className="text-slate-500">Паттерн: </span><code>{cluster.reason.pattern}</code></div>
              </div>
            )}
          </div>

          {/* Узлы */}
          <div className="grid md:grid-cols-2 gap-4">
            <NodeTable title={`Водители (${drivers.length})`} nodes={drivers} />
            <NodeTable title={`Клиенты (${clients.length})`} nodes={clients} />
          </div>

          {/* Топ связи */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-sm font-medium">
              Связи в кластере ({edges.length})
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-left">
                <tr>
                  <th className="px-3 py-2">Водитель</th>
                  <th className="px-3 py-2">Клиент</th>
                  <th className="px-3 py-2 text-right">Заказов</th>
                  <th className="px-3 py-2 text-right">Безнал</th>
                  <th className="px-3 py-2 text-right">Коротыш</th>
                  <th className="px-3 py-2 text-right">Repeat</th>
                  <th className="px-3 py-2 text-right">Сила</th>
                  <th className="px-3 py-2 text-right">Кэшбэк-риск, BYN</th>
                  <th className="px-3 py-2 text-right">Pair-риск</th>
                  <th className="px-3 py-2 text-right">ML</th>
                  <th className="px-3 py-2">Период</th>
                </tr>
              </thead>
              <tbody>
                {edges.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-4 text-center text-slate-500">
                      Нет связей в окне.
                    </td>
                  </tr>
                )}
                {edges.map((e) => (
                  <tr
                    key={`${e.driver_id}/${e.client_id}`}
                    className="border-t border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link
                        href={`/newstat/graph/node/driver/${encodeURIComponent(e.driver_id)}`}
                        className="text-sky-700 hover:underline"
                      >
                        {e.driver_id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link
                        href={`/newstat/graph/node/client/${encodeURIComponent(e.client_id)}`}
                        className="text-sky-700 hover:underline"
                      >
                        {e.client_id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right">{fmtNum(e.orders_count)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(e.noncash_orders)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(e.short_trip_count)}</td>
                    <td className="px-3 py-2 text-right">{fmtPct(e.repeat_ratio)}</td>
                    <td className="px-3 py-2 text-right">{Number(e.edge_strength).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-rose-700">{fmtMoney(e.cashback_loss_risk_byn)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(e.pair_risk_score)}</td>
                    <td className="px-3 py-2 text-right">
                      <MlCell score={e.ml_score} disagreement={e.ml_disagreement} />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {fmtDate(e.first_seen_date)}—{fmtDate(e.last_seen_date)}
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

// Ячейка ML-скоринга: показывает score 0..1 (модель), бейдж «≠» при
// |ml - heuristic/100| > 0.3. Если предсказания нет — короткий dash.
export function MlCell({
  score, disagreement,
}: { score?: string | null; disagreement?: string | null }) {
  if (score == null || score === "") {
    return <span className="text-slate-300" title="нет ML-предсказания">—</span>;
  }
  const s = Number(score);
  const d = disagreement == null ? null : Number(disagreement);
  const tone = s >= 0.7 ? "text-rose-700" : s >= 0.4 ? "text-amber-700" : "text-slate-600";
  const isDisagree = d != null && d > 0.3;
  return (
    <span className="inline-flex items-center gap-1 justify-end">
      <span className={tone} title="вероятность фрода (CatBoost)">{s.toFixed(2)}</span>
      {isDisagree && (
        <span
          className="inline-block px-1 rounded text-[10px] leading-4 bg-amber-100 text-amber-800 border border-amber-200"
          title="ML расходится с эвристикой более чем на 30 п.п."
        >≠</span>
      )}
    </span>
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

function NodeTable({ title, nodes }: { title: string; nodes: GraphNode[] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-sm font-medium">{title}</div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-left">
          <tr>
            <th className="px-3 py-1.5">ID</th>
            <th className="px-3 py-1.5 text-right">Заказов</th>
            <th className="px-3 py-1.5 text-right">GMV, BYN</th>
            <th className="px-3 py-1.5 text-right">Партнёров</th>
            <th className="px-3 py-1.5 text-right">Avg / Max риск</th>
          </tr>
        </thead>
        <tbody>
          {nodes.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-3 text-center text-slate-500">—</td>
            </tr>
          )}
          {nodes.map((n) => (
            <tr key={`${n.entity_type}:${n.entity_id}`} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-3 py-1.5 font-mono text-xs">
                <Link
                  href={`/newstat/graph/node/${n.entity_type}/${encodeURIComponent(n.entity_id)}`}
                  className="text-sky-700 hover:underline"
                >
                  {n.entity_id}
                </Link>
              </td>
              <td className="px-3 py-1.5 text-right">{fmtNum(n.total_orders)}</td>
              <td className="px-3 py-1.5 text-right">{fmtMoney(n.total_gmv)}</td>
              <td className="px-3 py-1.5 text-right">{fmtNum(n.unique_partners)}</td>
              <td className="px-3 py-1.5 text-right">
                {fmtMoney(n.risk_score_avg)} / {fmtMoney(n.risk_score_max)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
