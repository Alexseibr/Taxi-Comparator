import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WbShell } from "@/components/wb/WbShell";
import { useWbCurrentUser } from "@/lib/wb-auth";
import {
  fetchWbDriverFraudReport,
  type WbDriverFraudReportRow,
} from "@/lib/wb-api";

// Преобразуем yyyy-mm-dd в ISO «yyyy-mm-ddT00:00:00» (локальное время) —
// /wb/driver-fraud-report принимает любые ISO-строки и парсит через Date.parse,
// нам важна согласованность с UI-пресетами (ровно полночь по локали).
function dayToIso(d: Date, endOfDay: boolean): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return endOfDay
    ? `${y}-${m}-${day}T23:59:59`
    : `${y}-${m}-${day}T00:00:00`;
}

function isoStartOfDay(daysAgo: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return dayToIso(d, false);
}
function isoEndOfToday(): string {
  return dayToIso(new Date(), true);
}

function fmtMoney(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

type Preset = "7d" | "30d" | "custom";

export default function WbDriverFraudReportPage() {
  const me = useWbCurrentUser();
  // Полная карточка водителя /wb/driver/:id доступна только админу.
  // Антифроду показываем driverId как plain text — отчёт самодостаточен.
  const canDrillDriver = me?.role === "admin";
  const [preset, setPreset] = useState<Preset>("30d");
  // Для custom — храним даты в формате yyyy-mm-dd (HTML date input).
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const monthAgo = new Date(today);
  monthAgo.setDate(today.getDate() - 30);
  const monthAgoStr = `${monthAgo.getFullYear()}-${String(monthAgo.getMonth() + 1).padStart(2, "0")}-${String(monthAgo.getDate()).padStart(2, "0")}`;
  const [fromStr, setFromStr] = useState(monthAgoStr);
  const [toStr, setToStr] = useState(todayStr);

  const range = useMemo(() => {
    if (preset === "7d") return { fromTs: isoStartOfDay(7), toTs: isoEndOfToday() };
    if (preset === "30d") return { fromTs: isoStartOfDay(30), toTs: isoEndOfToday() };
    // custom
    const [fy, fm, fd] = fromStr.split("-").map(Number);
    const [ty, tm, td] = toStr.split("-").map(Number);
    if (!fy || !ty) return { fromTs: isoStartOfDay(30), toTs: isoEndOfToday() };
    const f = new Date(fy, (fm || 1) - 1, fd || 1);
    const t = new Date(ty, (tm || 1) - 1, td || 1);
    return { fromTs: dayToIso(f, false), toTs: dayToIso(t, true) };
  }, [preset, fromStr, toStr]);

  const q = useQuery({
    queryKey: ["wb", "driver-fraud-report", range.fromTs, range.toTs],
    queryFn: () => fetchWbDriverFraudReport({
      fromTs: range.fromTs,
      toTs: range.toTs,
      limit: 500,
    }),
  });

  return (
    <WbShell>
      <div className="container mx-auto px-4 max-w-[1400px] py-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-semibold">Отчёт фрода по водителям</h1>
          <div className="text-xs text-muted-foreground">
            {q.data ? `Найдено водителей: ${q.data.total}` : ""}
          </div>
        </div>

        <Card className="p-3 flex flex-wrap items-end gap-3">
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={preset === "7d" ? "default" : "outline"}
              onClick={() => setPreset("7d")}
              data-testid="preset-7d"
            >
              7 дней
            </Button>
            <Button
              size="sm"
              variant={preset === "30d" ? "default" : "outline"}
              onClick={() => setPreset("30d")}
              data-testid="preset-30d"
            >
              30 дней
            </Button>
            <Button
              size="sm"
              variant={preset === "custom" ? "default" : "outline"}
              onClick={() => setPreset("custom")}
              data-testid="preset-custom"
            >
              Период
            </Button>
          </div>
          {preset === "custom" && (
            <>
              <div className="space-y-1">
                <Label htmlFor="from-date" className="text-xs">С</Label>
                <Input
                  id="from-date"
                  type="date"
                  value={fromStr}
                  onChange={(e) => setFromStr(e.target.value)}
                  className="w-[150px]"
                  data-testid="input-from-date"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="to-date" className="text-xs">По</Label>
                <Input
                  id="to-date"
                  type="date"
                  value={toStr}
                  onChange={(e) => setToStr(e.target.value)}
                  className="w-[150px]"
                  data-testid="input-to-date"
                />
              </div>
            </>
          )}
          <div className="text-xs text-muted-foreground ml-auto">
            Отсортировано по сумме фрод-GMV (auto + ручные пометки).
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">Водитель</th>
                  <th className="px-3 py-2 text-right">Заказы</th>
                  <th className="px-3 py-2 text-right">GMV всего</th>
                  <th className="px-3 py-2 text-right">Авто-фрод (заказов)</th>
                  <th className="px-3 py-2 text-right">Авто-фрод GMV</th>
                  <th className="px-3 py-2 text-right">Ручные (заказов)</th>
                  <th className="px-3 py-2 text-right">Ручные GMV</th>
                  <th className="px-3 py-2 text-right">Итого фрод</th>
                  <th className="px-3 py-2 text-right">Итого фрод GMV</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {q.isLoading && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                      Загрузка…
                    </td>
                  </tr>
                )}
                {q.error && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-red-600">
                      Ошибка: {(q.error as Error).message}
                    </td>
                  </tr>
                )}
                {q.data && q.data.rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                      За период данных нет
                    </td>
                  </tr>
                )}
                {q.data?.rows.map((r: WbDriverFraudReportRow) => {
                  const fraudShare = r.totalGmv > 0 ? r.anyFraudGmv / r.totalGmv : 0;
                  const sharePct = Math.round(fraudShare * 100);
                  const dangerCls =
                    sharePct >= 30
                      ? "text-red-600 font-semibold"
                      : sharePct >= 10
                        ? "text-orange-700"
                        : "text-foreground";
                  return (
                    <tr
                      key={r.driverId}
                      className="border-t hover:bg-muted/30"
                      data-testid={`fraud-row-${r.driverId}`}
                    >
                      <td className="px-3 py-2">
                        {canDrillDriver ? (
                          <Link
                            href={`/wb/driver/${encodeURIComponent(r.driverId)}`}
                            className="text-primary hover:underline font-medium"
                            data-testid={`link-driver-${r.driverId}`}
                          >
                            {r.driverId}
                          </Link>
                        ) : (
                          <span
                            className="font-medium"
                            data-testid={`text-driver-${r.driverId}`}
                          >
                            {r.driverId}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.orders}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.totalGmv)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.autoFraudOrders}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.autoFraudGmv)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.manualFraudOrders}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.manualFraudGmv)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${dangerCls}`}>
                        {r.anyFraudOrders}
                        {sharePct > 0 && (
                          <span className="text-xs text-muted-foreground ml-1">
                            ({sharePct}%)
                          </span>
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${dangerCls}`}>
                        {fmtMoney(r.anyFraudGmv)}
                      </td>
                      <td className="px-3 py-2">
                        {canDrillDriver ? (
                          <Link href={`/wb/driver/${encodeURIComponent(r.driverId)}`}>
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`btn-open-driver-${r.driverId}`}
                            >
                              Открыть
                            </Button>
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </WbShell>
  );
}
