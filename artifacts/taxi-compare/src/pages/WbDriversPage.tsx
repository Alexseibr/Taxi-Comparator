import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchWbDrivers, type WbDriverRow } from "@/lib/wb-api";
import { WbShell } from "@/components/wb/WbShell";

const PAGE = 100;

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "total", label: "Заказов" },
  { value: "completed", label: "Выполнено" },
  { value: "cancelled", label: "Отмен" },
  { value: "cancelRate", label: "% отмен" },
  { value: "gmvSum", label: "GMV" },
  { value: "kmSum", label: "Сумма км" },
  { value: "uniqueClients", label: "Уникальных клиентов" },
  { value: "lastDate", label: "Последний заказ" },
];

function fmt(n: number, frac = 0) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
}

function Inner() {
  const [items, setItems] = useState<WbDriverRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState("total");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [minOrders, setMinOrders] = useState("");
  const [maxCancelPct, setMaxCancelPct] = useState("");
  const [minCancelPct, setMinCancelPct] = useState("");
  const [minGmv, setMinGmv] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () =>
      `${sortBy}|${order}|${minOrders}|${maxCancelPct}|${minCancelPct}|${minGmv}|${search}|${offset}`,
    [sortBy, order, minOrders, maxCancelPct, minCancelPct, minGmv, search, offset],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWbDrivers({
      limit: PAGE,
      offset,
      sortBy,
      order,
      minOrders: minOrders ? Number(minOrders) : undefined,
      maxCancelRate:
        maxCancelPct !== "" && Number.isFinite(Number(maxCancelPct))
          ? Number(maxCancelPct) / 100
          : undefined,
      minCancelRate:
        minCancelPct !== "" && Number.isFinite(Number(minCancelPct))
          ? Number(minCancelPct) / 100
          : undefined,
      minGmv: minGmv ? Number(minGmv) : undefined,
      search: search.trim() || undefined,
    })
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => !cancelled && setError(e?.message || "load_failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  return (
    <div className="container mx-auto p-4 space-y-4 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold">Водители ВБ Такси</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Все водители, по которым есть заказы. Кликните по ID — откроется
          детальная аналитика.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 text-sm">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Поиск по ID</div>
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              placeholder="например 4577"
              data-testid="input-search"
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Мин. заказов</div>
            <Input
              type="number"
              value={minOrders}
              onChange={(e) => {
                setMinOrders(e.target.value);
                setOffset(0);
              }}
              placeholder="1"
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Мин. % отмен</div>
            <Input
              type="number"
              value={minCancelPct}
              onChange={(e) => {
                setMinCancelPct(e.target.value);
                setOffset(0);
              }}
              placeholder="0"
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Макс. % отмен</div>
            <Input
              type="number"
              value={maxCancelPct}
              onChange={(e) => {
                setMaxCancelPct(e.target.value);
                setOffset(0);
              }}
              placeholder="100"
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Мин. GMV (BYN)</div>
            <Input
              type="number"
              value={minGmv}
              onChange={(e) => {
                setMinGmv(e.target.value);
                setOffset(0);
              }}
              placeholder="0"
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Сортировать по</div>
            <Select
              value={sortBy}
              onValueChange={(v) => {
                setSortBy(v);
                setOffset(0);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Порядок</div>
            <Select
              value={order}
              onValueChange={(v) => {
                setOrder(v as "asc" | "desc");
                setOffset(0);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">по убыванию</SelectItem>
                <SelectItem value="asc">по возрастанию</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-between items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setMinOrders("");
              setMaxCancelPct("");
              setMinCancelPct("");
              setMinGmv("");
              setSearch("");
              setSortBy("total");
              setOrder("desc");
              setOffset(0);
            }}
          >
            Сбросить фильтры
          </Button>
          <div className="text-sm text-muted-foreground">
            Найдено: <b>{total}</b> водителей
          </div>
        </div>
      </Card>

      {error && (
        <Card className="p-4 text-sm text-red-600">Ошибка: {error}</Card>
      )}

      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr className="text-left text-xs uppercase text-muted-foreground border-b">
              <th className="py-2 px-3">Driver ID</th>
              <th className="py-2 px-3 text-right">Заказов</th>
              <th className="py-2 px-3 text-right">Выполнено</th>
              <th className="py-2 px-3 text-right">Отмен</th>
              <th className="py-2 px-3 text-right">% отмен</th>
              <th className="py-2 px-3 text-right">GMV</th>
              <th className="py-2 px-3 text-right">Σ км</th>
              <th className="py-2 px-3 text-right">Клиентов</th>
              <th className="py-2 px-3">Первый</th>
              <th className="py-2 px-3">Последний</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-6 text-center text-muted-foreground">
                  Загрузка…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-6 text-center text-muted-foreground">
                  Никого не нашли по фильтру
                </td>
              </tr>
            ) : (
              items.map((d) => (
                <tr
                  key={d.driverId}
                  className="border-b last:border-b-0 hover:bg-muted/20"
                >
                  <td className="py-1.5 px-3 font-mono text-xs">
                    <Link
                      href={`/wb/driver/${encodeURIComponent(d.driverId)}`}
                      className="underline hover:text-primary"
                      data-testid={`link-driver-${d.driverId}`}
                    >
                      {d.driverId}
                    </Link>
                  </td>
                  <td className="py-1.5 px-3 text-right font-semibold">
                    {d.total}
                  </td>
                  <td className="py-1.5 px-3 text-right">{d.completed}</td>
                  <td className="py-1.5 px-3 text-right text-orange-700">
                    {d.cancelled}
                  </td>
                  <td className="py-1.5 px-3 text-right text-orange-700">
                    {(d.cancelRate * 100).toFixed(0)}%
                  </td>
                  <td className="py-1.5 px-3 text-right">{fmt(d.gmvSum, 2)}</td>
                  <td className="py-1.5 px-3 text-right">{fmt(d.kmSum, 1)}</td>
                  <td className="py-1.5 px-3 text-right">{d.uniqueClients}</td>
                  <td className="py-1.5 px-3 text-xs text-muted-foreground">
                    {d.firstDate || "—"}
                  </td>
                  <td className="py-1.5 px-3 text-xs text-muted-foreground">
                    {d.lastDate || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0 || loading}
          onClick={() => setOffset(Math.max(0, offset - PAGE))}
        >
          ← Назад
        </Button>
        <div className="text-xs text-muted-foreground">
          {Math.min(offset + 1, total)}–{Math.min(offset + items.length, total)} из{" "}
          {total}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={offset + items.length >= total || loading}
          onClick={() => setOffset(offset + PAGE)}
        >
          Вперёд →
        </Button>
      </div>
    </div>
  );
}

export default function WbDriversPage() {
  return (
    <WbShell>
      <Inner />
    </WbShell>
  );
}
