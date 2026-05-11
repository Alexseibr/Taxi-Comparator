import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchWbOrders, type WbOrder } from "@/lib/wb-api";

const PAGE_SIZE = 100;

function fmtNum(n: number | null, frac = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
}
function fmtDateTime(s: string): string {
  if (!s) return "—";
  return s.replace("+00:00", "").replace("T", " ").slice(0, 16);
}
// Подпись типа оплаты по коду из CSV. По текущей выгрузке:
//   "4" → безнал/карта, "0" → наличные. Прочие коды показываем как «код N».
function paymentBadge(pt: string | null | undefined) {
  const s = String(pt ?? "");
  if (s === "4") {
    return (
      <span
        className="rounded px-1.5 py-0.5 text-xs bg-blue-100 text-blue-800"
        data-testid="badge-payment-card"
      >
        безнал
      </span>
    );
  }
  if (s === "0") {
    return (
      <span
        className="rounded px-1.5 py-0.5 text-xs bg-amber-100 text-amber-800"
        data-testid="badge-payment-cash"
      >
        нал
      </span>
    );
  }
  if (!s) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span
      className="rounded px-1.5 py-0.5 text-xs bg-gray-100 text-gray-700"
      data-testid={`badge-payment-other-${s}`}
    >
      код&nbsp;{s}
    </span>
  );
}

function statusBadge(s: string) {
  if (s === "completed") {
    return (
      <span className="rounded px-1.5 py-0.5 text-xs bg-green-100 text-green-800">
        выполнен
      </span>
    );
  }
  if (s === "cancelled") {
    return (
      <span className="rounded px-1.5 py-0.5 text-xs bg-orange-100 text-orange-800">
        отменён
      </span>
    );
  }
  return (
    <span className="rounded px-1.5 py-0.5 text-xs bg-gray-100 text-gray-700">
      открыт
    </span>
  );
}

export type WbOrdersForceFilters = {
  repeat?: boolean;
  cross?: boolean;
  shortPickup?: boolean;
  fraudSuspect?: boolean;
  linked?: boolean;
  firstSeen?: boolean;
};

export function WbOrdersTable({
  initialClientId,
  initialDriverId,
  initialStatus,
  fromTs,
  toTs,
  forceFilters,
}: {
  initialClientId?: string;
  initialDriverId?: string;
  initialStatus?: string;
  fromTs?: string;
  toTs?: string;
  forceFilters?: WbOrdersForceFilters;
}) {
  const [items, setItems] = useState<WbOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState(initialStatus || "all");
  const [date, setDate] = useState("");
  const [clientId, setClientId] = useState(initialClientId || "");
  const [driverId, setDriverId] = useState(initialDriverId || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ffKey = useMemo(() => {
    if (!forceFilters) return "";
    return Object.entries(forceFilters)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .sort()
      .join(",");
  }, [forceFilters]);

  // Колонка «Кэшбэк» появляется только когда мы в drill-in связанных
  // поездок (linked) — ровно тот сценарий, в котором клиенту начислят
  // 30% от безналичного GMV.
  const showCashback = !!forceFilters?.linked;
  // Сколько столбцов в таблице (для колспана пустых рядов).
  const colCount = showCashback ? 13 : 12;

  const queryKey = useMemo(
    () =>
      `${status}|${date}|${clientId}|${driverId}|${offset}|${fromTs || ""}|${toTs || ""}|${ffKey}`,
    [status, date, clientId, driverId, offset, fromTs, toTs, ffKey],
  );

  useEffect(() => {
    setOffset(0);
  }, [fromTs, toTs, ffKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWbOrders({
      limit: PAGE_SIZE,
      offset,
      status,
      date,
      clientId,
      driverId,
      fromTs,
      toTs,
      ...(forceFilters || {}),
    })
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || "load_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Статус</div>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setOffset(0);
            }}
          >
            <SelectTrigger className="w-44" data-testid="select-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="completed">Выполненные</SelectItem>
              <SelectItem value="cancelled">Отменённые</SelectItem>
              <SelectItem value="open">Открытые</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Дата (ГГГГ-ММ-ДД)</div>
          <Input
            value={date}
            placeholder="2026-04-25"
            onChange={(e) => {
              setDate(e.target.value);
              setOffset(0);
            }}
            className="w-36"
            data-testid="input-date"
          />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Client ID</div>
          <Input
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setOffset(0);
            }}
            className="w-56"
            data-testid="input-client-id"
          />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Driver ID</div>
          <Input
            value={driverId}
            onChange={(e) => {
              setDriverId(e.target.value);
              setOffset(0);
            }}
            className="w-56"
            data-testid="input-driver-id"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setStatus("all");
            setDate("");
            setClientId("");
            setDriverId("");
            setOffset(0);
          }}
        >
          Сбросить
        </Button>
        <div className="ml-auto text-sm text-muted-foreground">
          Найдено: <b data-testid="text-orders-total">{total}</b>
        </div>
      </div>

      {error && <div className="text-sm text-red-600">Ошибка: {error}</div>}

      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="py-2 pr-3">Order ID</th>
              <th className="py-2 pr-3">Создан</th>
              <th className="py-2 pr-3">Статус</th>
              <th className="py-2 pr-3">Оплата</th>
              <th className="py-2 pr-3 text-right">км</th>
              <th className="py-2 pr-3 text-right">мин</th>
              <th className="py-2 pr-3 text-right">подача, мин</th>
              <th className="py-2 pr-3 text-right">BYN</th>
              <th className="py-2 pr-3 text-right">BYN/км</th>
              {showCashback && (
                <th className="py-2 pr-3 text-right">кэшбэк, BYN</th>
              )}
              <th className="py-2 pr-3">Client</th>
              <th className="py-2 pr-3">Driver</th>
              <th className="py-2 pr-3">Парк</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="py-6 text-center text-muted-foreground">
                  Загрузка…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="py-6 text-center text-muted-foreground">
                  Нет данных по фильтру
                </td>
              </tr>
            ) : (
              items.map((o) => {
                const isCard = String(o.paymentType ?? "") === "4";
                // Кэшбэк по строке = 30% от gmv для безналичного
                // completed-заказа. На отменённых/наличных — «—».
                const cashback =
                  showCashback &&
                  isCard &&
                  o.status === "completed" &&
                  o.gmv != null &&
                  o.gmv > 0
                    ? o.gmv * 0.3
                    : null;
                return (
                  <tr
                    key={o.orderId}
                    className="border-b last:border-b-0 hover:bg-muted/30"
                    data-testid={`row-order-${o.orderId}`}
                  >
                    <td className="py-1.5 pr-3 font-mono text-xs">{o.orderId}</td>
                    <td className="py-1.5 pr-3">{fmtDateTime(o.createdAt)}</td>
                    <td className="py-1.5 pr-3">{statusBadge(o.status)}</td>
                    <td className="py-1.5 pr-3">{paymentBadge(o.paymentType)}</td>
                    <td className="py-1.5 pr-3 text-right">{fmtNum(o.km, 2)}</td>
                    <td className="py-1.5 pr-3 text-right">{fmtNum(o.tripMin, 1)}</td>
                    <td className="py-1.5 pr-3 text-right">{fmtNum(o.fta, 1)}</td>
                    <td className="py-1.5 pr-3 text-right">{fmtNum(o.gmv, 2)}</td>
                    <td className="py-1.5 pr-3 text-right">
                      {o.gmv && o.km ? fmtNum(o.gmv / o.km, 2) : "—"}
                    </td>
                    {showCashback && (
                      <td
                        className="py-1.5 pr-3 text-right tabular-nums"
                        data-testid={`cell-cashback-${o.orderId}`}
                      >
                        {cashback == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="font-semibold text-red-700 dark:text-red-300">
                            {fmtNum(cashback, 2)}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="py-1.5 pr-3">
                      <Link
                        href={`/wb/client/${encodeURIComponent(o.clientId)}`}
                        className="font-mono text-xs underline hover:text-primary"
                        title="Открыть детали клиента"
                      >
                        {o.clientId}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3">
                      {o.driverId && o.driverId !== "0" ? (
                        <Link
                          href={`/wb/driver/${encodeURIComponent(o.driverId)}`}
                          className="font-mono text-xs underline hover:text-primary"
                          title="Открыть детали водителя"
                        >
                          {o.driverId}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">
                      {o.franchId ? (
                        <Link
                          href={`/wb/franch/${encodeURIComponent(o.franchId)}`}
                          className="font-mono text-xs underline hover:text-primary"
                          title="Открыть детали парка"
                          data-testid={`link-franch-${o.franchId}`}
                        >
                          {o.franchId}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0 || loading}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          ← Назад
        </Button>
        <div className="text-xs text-muted-foreground">
          {offset + 1}–{Math.min(offset + items.length, total)} из {total}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={offset + items.length >= total || loading}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Вперёд →
        </Button>
      </div>
    </Card>
  );
}
