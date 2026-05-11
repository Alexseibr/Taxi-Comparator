import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  fetchWbFranch,
  type WbFranchDetail,
} from "@/lib/wb-api";
import { WbShell } from "@/components/wb/WbShell";
import { WbNav } from "@/components/wb/WbNav";
import { WbBarChart } from "@/components/wb/WbBarChart";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function fmt(n: number, frac = 0) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
}
function pct(n: number) {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

export default function WbFranchPage({ id }: { id: string }) {
  const [data, setData] = useState<WbFranchDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchWbFranch(id)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <WbShell>
        <WbNav />
        <div className="container mx-auto px-4 max-w-[1400px] py-6 text-muted-foreground">
          Загрузка…
        </div>
      </WbShell>
    );
  }
  if (err === "not_found") {
    return (
      <WbShell>
        <WbNav />
        <div className="container mx-auto px-4 max-w-[1400px] py-6">
          <Card className="p-4">
            По парку <b>{id}</b> заказов не найдено.
          </Card>
        </div>
      </WbShell>
    );
  }
  if (err || !data) {
    return (
      <WbShell>
        <WbNav />
        <div className="container mx-auto px-4 max-w-[1400px] py-6 text-red-600">
          Ошибка: {err}
        </div>
      </WbShell>
    );
  }

  const s = data.summary;

  return (
    <WbShell>
      <WbNav />
      <div className="container mx-auto px-4 max-w-[1400px] py-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase text-muted-foreground">Парк</div>
            <h1 className="text-2xl font-bold font-mono">#{data.id}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {s.firstDate || "—"} → {s.lastDate || "—"} · период активности
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/wb/graph?focus=franch:${data.id}&depth=1`}>
              <Button variant="outline" size="sm" data-testid="link-graph-focus">
                Связи →
              </Button>
            </Link>
            <Link href="/wb">
              <Button variant="outline" size="sm">
                ← К сводке
              </Button>
            </Link>
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="Заказов" value={fmt(s.total)} />
          <Kpi label="Выполнено" value={fmt(s.completed)} />
          <Kpi
            label="Отменено"
            value={`${fmt(s.cancelled)} (${pct(
              s.total ? s.cancelled / s.total : 0,
            )})`}
          />
          <Kpi label="GMV" value={`${fmt(s.gmvSum, 2)} BYN`} />
          <Kpi label="Уникальных водителей" value={fmt(s.uniqueDrivers)} />
          <Kpi label="Уникальных клиентов" value={fmt(s.uniqueClients)} />
        </div>

        {/* Графики активности */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <WbBarChart
            title="Активность по часам суток"
            highlightCancel
            rows={data.byHour.map((h) => ({
              label: String(h.hour).padStart(2, "0"),
              total: h.total,
              completed: h.completed,
              cancelled: h.cancelled,
            }))}
          />
          <WbBarChart
            title="Активность по дням недели"
            highlightCancel
            rows={data.byWeekday.map((w) => ({
              label: WEEKDAYS[w.weekday] || String(w.weekday),
              total: w.total,
              completed: w.completed,
              cancelled: w.cancelled,
            }))}
          />
        </div>

        {/* Топ водителей и клиентов */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold">
                Топ водителей парка ({data.topDrivers.length})
              </div>
              <span className="text-xs text-muted-foreground">
                по числу заказов
              </span>
            </div>
            <div className="overflow-x-auto -mx-3 px-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Driver</th>
                    <th className="py-2 pr-3 text-right">Всего</th>
                    <th className="py-2 pr-3 text-right">Отмен%</th>
                    <th className="py-2 pr-3 text-right">GMV</th>
                    <th className="py-2 pr-3 text-right">Клиентов</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topDrivers.slice(0, 30).map((d) => (
                    <tr
                      key={d.driverId}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                    >
                      <td className="py-1.5 pr-3">
                        <Link
                          href={`/wb/driver/${d.driverId}`}
                          className="font-mono text-xs underline hover:text-primary"
                        >
                          {d.driverId}
                        </Link>
                        {d.driverName && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {d.driverName}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{fmt(d.total)}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {pct(d.cancelRate)}
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        {fmt(d.gmvSum, 2)}
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        {fmt(d.uniqueClients)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold">
                Топ клиентов парка ({data.topClients.length})
              </div>
              <span className="text-xs text-muted-foreground">
                по числу заказов
              </span>
            </div>
            <div className="overflow-x-auto -mx-3 px-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Client</th>
                    <th className="py-2 pr-3 text-right">Всего</th>
                    <th className="py-2 pr-3 text-right">Отмен%</th>
                    <th className="py-2 pr-3 text-right">GMV</th>
                    <th className="py-2 pr-3 text-right">Водителей</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topClients.slice(0, 30).map((c) => (
                    <tr
                      key={c.clientId}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                    >
                      <td className="py-1.5 pr-3">
                        <Link
                          href={`/wb/client/${c.clientId}`}
                          className="font-mono text-xs underline hover:text-primary"
                        >
                          {c.clientId}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3 text-right">{fmt(c.total)}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {pct(c.cancelRate)}
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        {fmt(c.gmvSum, 2)}
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        {fmt(c.uniqueDrivers)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </WbShell>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </Card>
  );
}
