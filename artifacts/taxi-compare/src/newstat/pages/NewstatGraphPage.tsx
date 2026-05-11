import { useEffect, useState } from "react";
import { Link } from "wouter";
import { NewstatLayout } from "../components/NewstatLayout";
import {
  newstatApi,
  type GraphCluster,
  type GraphClusterType,
} from "../lib/api";

const TYPE_LABEL: Record<GraphClusterType, string> = {
  cashback_ring: "Кэшбэк-кольцо",
  driver_farm:   "Ферма водителя",
  mixed_fraud:   "Смешанный фрод",
  mixed:         "Смешанный",
};

const TYPE_TONE: Record<GraphClusterType, string> = {
  cashback_ring: "bg-rose-100 text-rose-800 border-rose-200",
  driver_farm:   "bg-amber-100 text-amber-800 border-amber-200",
  mixed_fraud:   "bg-purple-100 text-purple-800 border-purple-200",
  mixed:         "bg-slate-100 text-slate-700 border-slate-200",
};

function fmtMoney(s: string | number): string {
  return Number(s).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtNum(n: number): string {
  return Number(n).toLocaleString("ru-RU");
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function NewstatGraphPage() {
  const [items, setItems] = useState<GraphCluster[]>([]);
  const [total, setTotal] = useState(0);
  const [suspiciousOnly, setSuspiciousOnly] = useState(true);
  const [typeFilter, setTypeFilter] = useState<GraphClusterType | "">("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    (async () => {
      const r = await newstatApi.graphClusters({
        suspicious: suspiciousOnly ? true : undefined,
        cluster_type: typeFilter || undefined,
        limit: 200,
      });
      if (!alive) return;
      if (r.ok) {
        setItems(r.data.items);
        setTotal(r.data.total);
      } else {
        setErr(r.error);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [suspiciousOnly, typeFilter]);

  return (
    <NewstatLayout title="Граф связей">
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-sm text-slate-600 leading-relaxed">
            Кластеры — группы водителей и клиентов, связанные «сильными» поездками
            (повтор &gt; 60% или массовый кэшбэк/коротыш). Окно — 30 дней.
            Подозрительные кластеры подсвечены красным.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 items-center text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={suspiciousOnly}
                onChange={(e) => setSuspiciousOnly(e.target.checked)}
              />
              <span>Только подозрительные</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-slate-600">Тип:</span>
              <select
                className="border border-slate-300 rounded px-2 py-1 bg-white"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as GraphClusterType | "")}
              >
                <option value="">все</option>
                <option value="cashback_ring">Кэшбэк-кольцо</option>
                <option value="driver_farm">Ферма водителя</option>
                <option value="mixed_fraud">Смешанный фрод</option>
                <option value="mixed">Смешанный</option>
              </select>
            </label>
            <span className="text-slate-500 ml-auto">Всего: {total}</span>
          </div>
        </div>

        {err && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-4 py-2 text-sm">
            Ошибка: {err}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr>
                <th className="px-3 py-2">Кластер</th>
                <th className="px-3 py-2">Тип</th>
                <th className="px-3 py-2 text-right">Узлов</th>
                <th className="px-3 py-2 text-right">Водит.</th>
                <th className="px-3 py-2 text-right">Клиент.</th>
                <th className="px-3 py-2 text-right">Заказов</th>
                <th className="px-3 py-2 text-right">GMV, BYN</th>
                <th className="px-3 py-2 text-right">Кэшбэк-риск, BYN</th>
                <th className="px-3 py-2 text-right">Avg риск</th>
                <th className="px-3 py-2">Окно</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                    Загрузка…
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                    Кластеров не найдено.
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((c) => (
                  <tr
                    key={c.cluster_id}
                    className={`border-t border-slate-100 hover:bg-slate-50 ${
                      c.is_suspicious ? "bg-rose-50/40" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/newstat/graph/${encodeURIComponent(c.cluster_id)}`}
                        className="text-sky-700 hover:underline font-mono text-xs"
                      >
                        {c.cluster_id}
                      </Link>
                      {c.is_suspicious && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 rounded border text-[10px] bg-rose-100 text-rose-800 border-rose-200 align-middle">
                          подозрит.
                        </span>
                      )}
                      <div className="text-xs text-slate-500 mt-0.5">{c.reason?.reason}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded border text-xs ${
                          TYPE_TONE[c.cluster_type] ?? TYPE_TONE.mixed
                        }`}
                      >
                        {TYPE_LABEL[c.cluster_type] ?? c.cluster_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{fmtNum(c.nodes_count)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(c.drivers_count)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(c.clients_count)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(c.total_orders)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(c.total_gmv)}</td>
                    <td className="px-3 py-2 text-right font-medium text-rose-700">
                      {fmtMoney(c.total_collusion_loss_risk)}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtMoney(c.avg_risk_score)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {fmtDate(c.window_from)} — {fmtDate(c.window_to)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </NewstatLayout>
  );
}
