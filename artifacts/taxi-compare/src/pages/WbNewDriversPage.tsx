import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { fetchWbNewDrivers, type WbNewDriversResponse } from "@/lib/wb-api";
import { WbShell } from "@/components/wb/WbShell";
import {
  WbDateRangePicker,
  rangeFromPreset,
  type WbDateRangeValue,
} from "@/components/wb/WbDateRangePicker";
import { Card } from "@/components/ui/card";

function fmtNum(n: number | null | undefined, frac = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
}
function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}
function fmtDateTime(s: string | null): string {
  if (!s) return "—";
  return s.replace("+00:00", "").slice(0, 16);
}

const SEV_BADGE: Record<string, { label: string; cls: string }> = {
  critical: {
    label: "CRIT",
    cls: "bg-red-600 text-white",
  },
  high: { label: "HIGH", cls: "bg-red-100 text-red-700 border-red-300 border" },
  med: {
    label: "MED",
    cls: "bg-amber-100 text-amber-700 border-amber-300 border",
  },
  low: { label: "LOW", cls: "bg-yellow-50 text-yellow-700 border-yellow-200 border" },
  clean: { label: "OK", cls: "bg-green-50 text-green-700 border-green-200 border" },
};

function SevBadge({ severity }: { severity: string }) {
  const s = SEV_BADGE[severity] || SEV_BADGE.clean;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

function ReasonBadge({
  severity,
  label,
}: {
  severity: string;
  label: string;
}) {
  const cls =
    severity === "critical"
      ? "bg-red-50 text-red-700 border-red-200"
      : severity === "high"
        ? "bg-red-50 text-red-600 border-red-200"
        : severity === "med"
          ? "bg-amber-50 text-amber-700 border-amber-200"
          : "bg-yellow-50 text-yellow-700 border-yellow-200";
  return (
    <span
      className={`inline-block text-[11px] leading-snug px-1.5 py-0.5 rounded border ${cls} mr-1 mb-1`}
    >
      {label}
    </span>
  );
}

function WbNewDriversInner() {
  const [range, setRange] = useState<WbDateRangeValue>(() =>
    rangeFromPreset("today"),
  );
  const [data, setData] = useState<WbNewDriversResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    fetchWbNewDrivers({ fromTs: range.fromTs, toTs: range.toTs })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || "load_failed");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range.fromTs, range.toTs]);

  const summary = useMemo(() => {
    if (!data) return null;
    let crit = 0,
      high = 0,
      med = 0,
      low = 0,
      clean = 0;
    for (const it of data.items) {
      if (it.severity === "critical") crit++;
      else if (it.severity === "high") high++;
      else if (it.severity === "med") med++;
      else if (it.severity === "low") low++;
      else clean++;
    }
    return { crit, high, med, low, clean };
  }, [data]);

  return (
    <div className="container mx-auto p-4 space-y-4 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold">Новые водители</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Водители, у которых самый ранний заказ в системе попадает в выбранный
          период. Сортировка — по уровню подозрительности (score). Кликните по
          ID, чтобы открыть профиль.
        </p>
      </div>

      <Card className="p-4">
        <WbDateRangePicker value={range} onChange={setRange} />
      </Card>

      {error && (
        <Card className="p-4 text-sm text-red-600">Ошибка: {error}</Card>
      )}

      {data && (
        <Card className="p-4 grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Новых водителей</div>
            <div className="text-xl font-semibold" data-testid="text-new-total">
              {data.totalNew}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Critical</div>
            <div className="text-xl font-semibold text-red-600">
              {summary?.crit ?? 0}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">High</div>
            <div className="text-xl font-semibold text-red-500">
              {summary?.high ?? 0}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Med</div>
            <div className="text-xl font-semibold text-amber-600">
              {summary?.med ?? 0}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Low</div>
            <div className="text-xl font-semibold text-yellow-600">
              {summary?.low ?? 0}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Без флагов</div>
            <div className="text-xl font-semibold text-green-600">
              {summary?.clean ?? 0}
            </div>
          </div>
        </Card>
      )}

      {data && data.thresholds && (
        <div className="text-xs text-muted-foreground">
          Пороги по парку: ставка p95 = {fmtNum(data.thresholds.ppkP95)} BYN/км,
          процент отмен p90 = {fmtPct(data.thresholds.cancelP90)}.
        </div>
      )}

      {loading && !data ? (
        <Card className="p-6 text-center text-muted-foreground">Загрузка…</Card>
      ) : null}

      {data && data.totalNew === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">
          В выбранном периоде новых водителей не появилось.
        </Card>
      ) : null}

      {data && data.items.length > 0 && (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-new-drivers">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground bg-muted/40">
                <th className="px-3 py-2">Driver ID</th>
                <th className="px-3 py-2">Первый заказ (UTC)</th>
                <th className="px-3 py-2 text-right">Заказов</th>
                <th className="px-3 py-2 text-right">✓ / ✗ / ◻</th>
                <th className="px-3 py-2 text-right">% отмен</th>
                <th className="px-3 py-2 text-right">Клиентов</th>
                <th className="px-3 py-2">Топ-партнёр</th>
                <th className="px-3 py-2 text-right">BYN/км</th>
                <th className="px-3 py-2 text-right">FTA, мин</th>
                <th className="px-3 py-2 text-right">Скорость, км/ч</th>
                <th className="px-3 py-2 text-right">Score</th>
                <th className="px-3 py-2">Sev</th>
                <th className="px-3 py-2">Флаги</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr
                  key={it.driverId}
                  className="border-b hover:bg-muted/30"
                  data-testid={`row-new-driver-${it.driverId}`}
                >
                  <td className="px-3 py-2 font-mono">
                    <Link
                      href={`/wb/driver/${encodeURIComponent(it.driverId)}`}
                      className="text-primary hover:underline"
                      data-testid={`link-driver-${it.driverId}`}
                    >
                      {it.driverId}
                    </Link>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {fmtDateTime(it.firstSeenAt)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {it.total}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="text-green-600">{it.completed}</span>
                    {" / "}
                    <span className="text-red-600">{it.cancelled}</span>
                    {" / "}
                    <span className="text-yellow-600">{it.open}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {fmtPct(it.cancelRate)}
                  </td>
                  <td className="px-3 py-2 text-right">{it.uniqueClients}</td>
                  <td className="px-3 py-2 font-mono">
                    {it.topPartner ? (
                      <Link
                        href={`/wb/client/${encodeURIComponent(it.topPartner.clientId)}`}
                        className="text-primary hover:underline"
                      >
                        {it.topPartner.clientId}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {it.topPartner ? (
                      <span className="text-xs text-muted-foreground ml-1">
                        ({it.topPartner.count}, {fmtPct(it.topPartner.share)})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtNum(it.avgPpk)}</td>
                  <td className="px-3 py-2 text-right">
                    {fmtNum(it.avgFta, 1)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {fmtNum(it.avgSpeed, 1)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {it.score}
                  </td>
                  <td className="px-3 py-2">
                    <SevBadge severity={it.severity} />
                  </td>
                  <td className="px-3 py-2 max-w-[420px]">
                    {it.reasons.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      it.reasons.map((r, i) => (
                        <ReasonBadge
                          key={i}
                          severity={r.severity}
                          label={r.label}
                        />
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

export default function WbNewDriversPage() {
  return (
    <WbShell>
      <WbNewDriversInner />
    </WbShell>
  );
}
