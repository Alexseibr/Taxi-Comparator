import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { fetchWbStats, type WbStats } from "@/lib/wb-api";
import { WbShell } from "@/components/wb/WbShell";
import { WbUploadCsv } from "@/components/wb/WbUploadCsv";
import {
  WbOrdersTable,
  type WbOrdersForceFilters,
} from "@/components/wb/WbOrdersTable";
import { WbClientDriverPairs } from "@/components/wb/WbClientDriverPairs";
import {
  WbDateRangePicker,
  rangeFromPreset,
  type WbDateRangeValue,
  type WbRangePreset,
} from "@/components/wb/WbDateRangePicker";
import { KpiCard } from "@/components/wb/KpiCard";
import { WbAnomalySection } from "@/components/wb/WbAnomalySection";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Drill =
  | "fraud"
  | "linked"
  | "cross"
  | "shortPickup"
  | "firstSeen"
  | "orders"
  | "completed"
  | "cancelled"
  | "open"
  | "revenue"
  | "avgCheck"
  | null;

const DRILL_LABEL: Record<Exclude<Drill, null>, string> = {
  fraud: "Фрод-подозрения",
  linked: "Связанные поездки",
  cross: "Перекрёстные",
  shortPickup: "Короткая подача",
  firstSeen: "Первые заказы новых клиентов",
  orders: "Все заказы",
  completed: "Завершённые заказы",
  cancelled: "Отменённые заказы",
  open: "Открытые заказы",
  revenue: "Выручка по выполненным",
  avgCheck: "Средний чек по выполненным",
};

const DRILL_VALUES: Exclude<Drill, null>[] = [
  "fraud",
  "linked",
  "cross",
  "shortPickup",
  "firstSeen",
  "orders",
  "completed",
  "cancelled",
  "open",
  "revenue",
  "avgCheck",
];

function drillToFilter(d: Drill): WbOrdersForceFilters | undefined {
  if (d === "fraud") return { fraudSuspect: true };
  if (d === "linked") return { linked: true };
  if (d === "cross") return { cross: true };
  if (d === "shortPickup") return { shortPickup: true };
  if (d === "firstSeen") return { firstSeen: true };
  return undefined;
}

// Маппинг drill → начальный фильтр статуса в таблице заказов.
function drillToInitialStatus(d: Drill): string | undefined {
  if (d === "completed" || d === "revenue" || d === "avgCheck") return "completed";
  if (d === "cancelled") return "cancelled";
  if (d === "open") return "open";
  if (d === "orders") return "all";
  return undefined;
}

// Парсим параметры из URL (preset, fromTs, toTs, drill).
function parseInitialState(): {
  range: WbDateRangeValue;
  drill: Drill;
} {
  const sp = new URLSearchParams(
    typeof window === "undefined" ? "" : window.location.search,
  );
  const presetParam = sp.get("preset") as WbRangePreset | null;
  const fromTs = sp.get("fromTs");
  const toTs = sp.get("toTs");
  const drillRaw = sp.get("drill");
  const drill: Drill = DRILL_VALUES.includes(drillRaw as Exclude<Drill, null>)
    ? (drillRaw as Drill)
    : null;
  let range: WbDateRangeValue;
  if (presetParam && presetParam !== "custom") {
    range = rangeFromPreset(presetParam);
  } else if (fromTs && toTs) {
    // ручной кастом без preset, или preset=custom — реконструируем как custom.
    const a = new Date(fromTs);
    const b = new Date(toTs);
    if (Number.isFinite(a.getTime()) && Number.isFinite(b.getTime())) {
      const len = b.getTime() - a.getTime();
      range = {
        preset: "custom",
        fromTs,
        toTs,
        compareFromTs: new Date(a.getTime() - len).toISOString(),
        compareToTs: fromTs,
      };
    } else {
      range = rangeFromPreset("today");
    }
  } else {
    range = rangeFromPreset("today");
  }
  return { range, drill };
}

function syncUrl(range: WbDateRangeValue, drill: Drill) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams();
  sp.set("preset", range.preset);
  if (range.preset === "custom" && range.fromTs && range.toTs) {
    sp.set("fromTs", range.fromTs);
    sp.set("toTs", range.toTs);
  }
  if (drill) sp.set("drill", drill);
  const next = `${window.location.pathname}?${sp.toString()}`;
  if (window.location.pathname + window.location.search !== next) {
    window.history.replaceState(null, "", next);
  }
}

function WbInner() {
  const initial = useMemo(() => parseInitialState(), []);
  const [range, setRange] = useState<WbDateRangeValue>(initial.range);
  const [drill, setDrill] = useState<Drill>(initial.drill);
  const [stats, setStats] = useState<WbStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Sync URL whenever range or drill changes.
  useEffect(() => {
    syncUrl(range, drill);
  }, [range, drill]);

  // Re-read state from URL on history popstate (back/forward navigation).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      const next = parseInitialState();
      setRange(next.range);
      setDrill(next.drill);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    fetchWbStats({ fromTs: range.fromTs, toTs: range.toTs })
      .then((s) => {
        if (cancelled) return;
        setStats(s);
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
  }, [refreshKey, range.fromTs, range.toTs]);

  const dashboard = stats?.dashboard ?? null;
  const compare = stats?.compare ?? null;

  const rangeQs = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("preset", range.preset);
    if (range.preset === "custom" && range.fromTs && range.toTs) {
      sp.set("fromTs", range.fromTs);
      sp.set("toTs", range.toTs);
    }
    return `&${sp.toString()}`;
  }, [range]);

  return (
    <div className="container mx-auto p-4 space-y-6 max-w-[1400px]">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">ВБ Аналитика · сводка</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Антифрод-доска: KPI за выбранный период с дельтой к предыдущему
            аналогичному, четыре шильдика аномалий и drill-down в список заказов.
          </p>
        </div>
        <Link href="/wb/fraud">
          <Button variant="outline" size="sm">
            Подробный фрод-отчёт →
          </Button>
        </Link>
      </div>

      <Card className="p-4">
        <WbDateRangePicker
          value={range}
          onChange={(v) => {
            setRange(v);
            // при смене периода drill оставляем — пусть фильтр держится.
          }}
        />
      </Card>

      {error && (
        <Card className="p-4 text-sm text-red-600">
          Ошибка загрузки статистики: {error}
        </Card>
      )}

      {loading && !stats ? (
        <Card className="p-6 text-center text-muted-foreground">Загрузка…</Card>
      ) : null}

      {stats && stats.totals.orders === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">
          {range.preset === "all"
            ? "Пока ни одного заказа. Загрузите CSV ниже."
            : "В выбранном периоде нет заказов."}
        </Card>
      ) : null}

      {dashboard && stats && stats.totals.orders > 0 && (
        <>
          {/* Аномалии — самое заметное, выше KPI */}
          <WbAnomalySection dashboard={dashboard} rangeQs={rangeQs} />

          {/* KPI-сетка 4×4 = 16 карточек, в две группы (объёмы и качество) */}
          <div>
            <h2 className="text-lg font-semibold mb-2">Объёмы</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <KpiCard
                label="Заказы"
                value={dashboard.orders}
                compareValue={compare?.orders}
                href={`/wb?drill=orders${rangeQs}`}
                testId="kpi-orders"
              />
              <KpiCard
                label="Завершено"
                value={dashboard.completed}
                compareValue={compare?.completed}
                hint={
                  dashboard.orders
                    ? `${((dashboard.completed / dashboard.orders) * 100).toFixed(1)}% от заказов`
                    : undefined
                }
                href={`/wb?drill=completed${rangeQs}`}
                testId="kpi-completed"
              />
              <KpiCard
                label="Отменено"
                value={dashboard.cancelled}
                compareValue={compare?.cancelled}
                invertDelta
                variant={
                  dashboard.orders &&
                  dashboard.cancelled / dashboard.orders > 0.25
                    ? "warn"
                    : undefined
                }
                hint={
                  dashboard.orders
                    ? `${((dashboard.cancelled / dashboard.orders) * 100).toFixed(1)}% от заказов`
                    : undefined
                }
                href={`/wb?drill=cancelled${rangeQs}`}
                testId="kpi-cancelled"
              />
              <KpiCard
                label="Открытых висит"
                value={dashboard.open}
                compareValue={compare?.open}
                invertDelta
                href={`/wb?drill=open${rangeQs}`}
                testId="kpi-open"
              />
              <KpiCard
                label="Выручка"
                value={dashboard.revenueTotal}
                compareValue={compare?.revenueTotal}
                format="money"
                unit="BYN"
                hint="клик — список выполненных заказов"
                href={`/wb?drill=revenue${rangeQs}`}
                testId="kpi-revenue"
              />
              <KpiCard
                label="Средний чек"
                value={dashboard.avgCheck}
                compareValue={compare?.avgCheck}
                format="money"
                unit="BYN"
                hint="клик — список выполненных заказов"
                href={`/wb?drill=avgCheck${rangeQs}`}
                testId="kpi-avg-check"
              />
              <KpiCard
                label="Активные клиенты"
                value={dashboard.activeClients}
                compareValue={compare?.activeClients}
                href="/wb/clients"
                testId="kpi-active-clients"
              />
              <KpiCard
                label="Активные водители"
                value={dashboard.activeDrivers}
                compareValue={compare?.activeDrivers}
                href="/wb/drivers"
                testId="kpi-active-drivers"
              />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">
              Аудитория и качество поездок
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <KpiCard
                label="Новые клиенты"
                value={dashboard.newClients}
                compareValue={compare?.newClients}
                href={`/wb?drill=firstSeen${rangeQs}`}
                testId="kpi-new-clients"
              />
              <KpiCard
                label="Новые водители"
                value={dashboard.newDrivers}
                compareValue={compare?.newDrivers}
                href="/wb/new-drivers"
                testId="kpi-new-drivers"
              />
              <KpiCard
                label="Всего клиентов (накоп.)"
                value={dashboard.totalClients}
                hint="за всё время до конца окна"
                href="/wb/clients"
                testId="kpi-total-clients"
              />
              <KpiCard
                label="Всего водителей (накоп.)"
                value={dashboard.totalDrivers}
                hint="за всё время до конца окна"
                href="/wb/drivers"
                testId="kpi-total-drivers"
              />
              <KpiCard
                label="Повторные заказы"
                value={dashboard.repeatTrips}
                compareValue={compare?.repeatTrips}
                hint="клиент уже заказывал ранее"
                testId="kpi-repeat-trips"
              />
              <KpiCard
                label="Средняя подача"
                value={dashboard.avgFta}
                compareValue={compare?.avgFta}
                format="decimal"
                unit="мин"
                invertDelta
                testId="kpi-avg-fta"
              />
              <KpiCard
                label="Средняя дистанция"
                value={dashboard.avgKm}
                compareValue={compare?.avgKm}
                format="decimal"
                unit="км"
                testId="kpi-avg-km"
              />
              <KpiCard
                label="Средняя скорость"
                value={dashboard.avgSpeedKmh}
                compareValue={compare?.avgSpeedKmh}
                format="decimal"
                unit="км/ч"
                testId="kpi-avg-speed"
              />
            </div>
          </div>

          {/* Drill-in: если в URL есть ?drill=..., раскрываем таблицу заказов */}
          {drill && (
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-2 flex-wrap">
                <h2 className="text-lg font-semibold">
                  Drill-in: {DRILL_LABEL[drill]}
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDrill(null)}
                  data-testid="btn-close-drill"
                >
                  Закрыть фильтр ✕
                </Button>
              </div>
              <WbOrdersTable
                fromTs={range.fromTs ?? undefined}
                toTs={range.toTs ?? undefined}
                forceFilters={drillToFilter(drill)}
                initialStatus={drillToInitialStatus(drill)}
              />
            </div>
          )}

          {/* Связки и повторы (старая секция) */}
          <div>
            <h2 className="text-lg font-semibold mb-2">Связки и повторы</h2>
            <WbClientDriverPairs
              refreshKey={refreshKey}
              fromTs={range.fromTs}
              toTs={range.toTs}
            />
          </div>

          {/* Все заказы периода */}
          {!drill && (
            <div>
              <h2 className="text-lg font-semibold mb-2">
                Заказы периода
              </h2>
              <WbOrdersTable
                fromTs={range.fromTs ?? undefined}
                toTs={range.toTs ?? undefined}
              />
            </div>
          )}
        </>
      )}

      {/* Загрузка CSV — внизу, чтобы не отвлекать */}
      <div>
        <h2 className="text-lg font-semibold mb-2">Загрузка выгрузок</h2>
        <WbUploadCsv onUploaded={reload} />
      </div>
    </div>
  );
}

export default function WbDashboard() {
  return (
    <WbShell>
      <WbInner />
    </WbShell>
  );
}
