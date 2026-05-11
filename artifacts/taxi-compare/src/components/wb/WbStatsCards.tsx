import { Card } from "@/components/ui/card";
import type { WbStats } from "@/lib/wb-api";

function fmtNum(n: number, frac = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
}
function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU");
}
function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

type Props = { stats: WbStats };

export function WbStatsCards({ stats }: Props) {
  const t = stats.totals;
  const a = stats.averages;
  const r = stats.regression;
  const completionRate = t.orders ? t.completed / t.orders : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Всего заказов" value={fmtInt(t.orders)} testId="stat-total" />
        <Stat
          label="Выполнено"
          value={fmtInt(t.completed)}
          sub={fmtPct(completionRate)}
          testId="stat-completed"
        />
        <Stat
          label="Отменено"
          value={fmtInt(t.cancelled)}
          sub={fmtPct(t.cancelRate)}
          testId="stat-cancelled"
          tone="warn"
        />
        <Stat
          label="Уникальных клиентов"
          value={fmtInt(t.uniqueClients)}
          testId="stat-clients"
        />
        <Stat
          label="Уникальных водителей"
          value={fmtInt(t.uniqueDrivers)}
          testId="stat-drivers"
        />
        <Stat
          label="Средний чек, BYN"
          value={fmtNum(a.gmv?.avg ?? 0, 2)}
          sub={`медиана ${fmtNum(a.gmv?.median ?? 0, 2)}`}
          testId="stat-gmv"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat
          label="Средняя дистанция, км"
          value={fmtNum(a.distanceKm?.avg ?? 0, 2)}
          sub={`медиана ${fmtNum(a.distanceKm?.median ?? 0, 2)}`}
          testId="stat-km"
        />
        <Stat
          label="Среднее время поездки"
          value={`${fmtNum(a.tripMin?.avg ?? 0, 1)} мин`}
          sub={`медиана ${fmtNum(a.tripMin?.median ?? 0, 1)} мин`}
          testId="stat-trip"
        />
        <Stat
          label="Среднее время подачи"
          value={`${fmtNum(a.ftaMin?.avg ?? 0, 1)} мин`}
          sub={`медиана ${fmtNum(a.ftaMin?.median ?? 0, 1)} мин`}
          testId="stat-fta"
        />
        <Stat
          label="Цена за км, BYN"
          value={fmtNum(a.pricePerKm?.avg ?? 0, 2)}
          sub={`медиана ${fmtNum(a.pricePerKm?.median ?? 0, 2)}`}
          testId="stat-ppk"
        />
        <Stat
          label="Цена за минуту, BYN"
          value={fmtNum(a.pricePerMin?.avg ?? 0, 2)}
          sub={`медиана ${fmtNum(a.pricePerMin?.median ?? 0, 2)}`}
          testId="stat-ppm"
        />
        <Stat
          label="Средняя скорость, км/ч"
          value={fmtNum(a.speedKmh?.avg ?? 0, 1)}
          sub={`медиана ${fmtNum(a.speedKmh?.median ?? 0, 1)}`}
          testId="stat-speed"
        />
      </div>

      {r && (
        <Card className="p-4">
          <div className="text-sm font-medium mb-1">
            Линейная регрессия цены (по выполненным заказам)
          </div>
          <div className="font-mono text-base" data-testid="text-regression">
            цена ≈ {fmtNum(r.intercept, 2)} + {fmtNum(r.perKm, 2)} × км +{" "}
            {fmtNum(r.perMin, 2)} × мин
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            BYN = базовая часть + плата за расстояние + плата за время поездки.
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  testId,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  testId?: string;
  tone?: "warn";
}) {
  return (
    <Card className="p-3" data-testid={testId}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-xl font-semibold mt-1 ${
          tone === "warn" ? "text-orange-600" : ""
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}
