import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { fetchWbPairs, type WbPairs } from "@/lib/wb-api";

function fmtNum(n: number, frac = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
}
function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

type Props = {
  refreshKey?: number;
  fromTs?: string | null;
  toTs?: string | null;
};

export function WbClientDriverPairs({ refreshKey = 0, fromTs, toTs }: Props) {
  const [data, setData] = useState<WbPairs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchWbPairs(50, { fromTs: fromTs ?? null, toTs: toTs ?? null })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e?.message || "load_failed"));
    return () => {
      cancelled = true;
    };
  }, [refreshKey, fromTs, toTs]);

  if (error) {
    return (
      <Card className="p-4 text-sm text-red-600">
        Не удалось загрузить связки: {error}
      </Card>
    );
  }
  if (!data) {
    return <Card className="p-4 text-sm text-muted-foreground">Загрузка…</Card>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="p-4 space-y-2">
        <div className="font-medium">ТОП клиентов</div>
        <div className="text-xs text-muted-foreground">
          Сортировка по числу заказов. Кликните по ID — детали клиента.
        </div>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-1.5 pr-2">Client ID</th>
                <th className="py-1.5 pr-2 text-right">Заказов</th>
                <th className="py-1.5 pr-2 text-right">Отмен</th>
                <th className="py-1.5 pr-2 text-right">GMV</th>
                <th className="py-1.5 pr-2 text-right">Водителей</th>
              </tr>
            </thead>
            <tbody>
              {data.topClients.map((c) => (
                <tr
                  key={c.clientId}
                  className="border-b last:border-b-0 hover:bg-muted/30"
                >
                  <td className="py-1 pr-2 font-mono text-xs">
                    <Link
                      href={`/wb/client/${encodeURIComponent(c.clientId)}`}
                      className="underline hover:text-primary"
                    >
                      {c.clientId}
                    </Link>
                  </td>
                  <td className="py-1 pr-2 text-right">{c.total}</td>
                  <td className="py-1 pr-2 text-right text-orange-700">
                    {c.cancelled}{" "}
                    <span className="text-xs">({fmtPct(c.cancelRate)})</span>
                  </td>
                  <td className="py-1 pr-2 text-right">{fmtNum(c.gmvSum, 2)}</td>
                  <td className="py-1 pr-2 text-right">{c.uniqueDrivers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="font-medium">ТОП водителей</div>
        <div className="text-xs text-muted-foreground">
          Сортировка по числу заказов. Кликните по ID — детали водителя.
        </div>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-1.5 pr-2">Driver ID</th>
                <th className="py-1.5 pr-2 text-right">Заказов</th>
                <th className="py-1.5 pr-2 text-right">Отмен</th>
                <th className="py-1.5 pr-2 text-right">GMV</th>
                <th className="py-1.5 pr-2 text-right">Клиентов</th>
              </tr>
            </thead>
            <tbody>
              {data.topDrivers.map((d) => (
                <tr
                  key={d.driverId}
                  className="border-b last:border-b-0 hover:bg-muted/30"
                >
                  <td className="py-1 pr-2 font-mono text-xs">
                    <Link
                      href={`/wb/driver/${encodeURIComponent(d.driverId)}`}
                      className="underline hover:text-primary"
                    >
                      {d.driverId}
                    </Link>
                  </td>
                  <td className="py-1 pr-2 text-right">{d.total}</td>
                  <td className="py-1 pr-2 text-right text-orange-700">
                    {d.cancelled}{" "}
                    <span className="text-xs">({fmtPct(d.cancelRate)})</span>
                  </td>
                  <td className="py-1 pr-2 text-right">{fmtNum(d.gmvSum, 2)}</td>
                  <td className="py-1 pr-2 text-right">{d.uniqueClients}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="font-medium">Повторные связки клиент ↔ водитель</div>
        <div className="text-xs text-muted-foreground">
          Один и тот же водитель забирал клиента ≥ 2 раз. Может быть лояльность,
          а может — попытка обхода рандомизации.
        </div>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-1.5 pr-2">Client</th>
                <th className="py-1.5 pr-2">Driver</th>
                <th className="py-1.5 pr-2 text-right">Раз</th>
                <th className="py-1.5 pr-2 text-right">Готово</th>
                <th className="py-1.5 pr-2 text-right">Отмен</th>
                <th className="py-1.5 pr-2 text-right">GMV</th>
              </tr>
            </thead>
            <tbody>
              {data.topPairs.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-3 text-center text-muted-foreground"
                  >
                    Повторов не найдено
                  </td>
                </tr>
              ) : (
                data.topPairs.map((p) => (
                  <tr
                    key={`${p.clientId}|${p.driverId}`}
                    className="border-b last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="py-1 pr-2 font-mono text-xs">
                      <Link
                        href={`/wb/client/${encodeURIComponent(p.clientId)}`}
                        className="underline hover:text-primary"
                      >
                        {p.clientId}
                      </Link>
                    </td>
                    <td className="py-1 pr-2 font-mono text-xs">
                      <Link
                        href={`/wb/driver/${encodeURIComponent(p.driverId)}`}
                        className="underline hover:text-primary"
                      >
                        {p.driverId}
                      </Link>
                    </td>
                    <td className="py-1 pr-2 text-right font-semibold">
                      {p.total}
                    </td>
                    <td className="py-1 pr-2 text-right">{p.completed}</td>
                    <td className="py-1 pr-2 text-right text-orange-700">
                      {p.cancelled}
                    </td>
                    <td className="py-1 pr-2 text-right">
                      {fmtNum(p.gmvSum, 2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
