import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import {
  fetchWbHeatmap,
  type WbHeatmap,
  type WbStatusFilter,
} from "@/lib/wb-api";
import { WbShell } from "@/components/wb/WbShell";
import { WbHeatmapMatrix } from "@/components/wb/WbHeatmapMatrix";
import { WbDistanceHistogram } from "@/components/wb/WbDistanceHistogram";
import { WbBarChart } from "@/components/wb/WbBarChart";
import { WbGeoHeatmap } from "@/components/wb/WbGeoHeatmap";
import {
  WbDateRangePicker,
  rangeFromPreset,
  type WbDateRangeValue,
} from "@/components/wb/WbDateRangePicker";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const STATUS_OPTIONS: Array<{ value: WbStatusFilter; label: string }> = [
  { value: "all", label: "Все статусы" },
  { value: "completed", label: "Выполненные" },
  { value: "cancelled", label: "Отменённые" },
  { value: "open", label: "Открытые" },
];

function Inner() {
  const [data, setData] = useState<WbHeatmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<WbDateRangeValue>(() => rangeFromPreset("all"));
  const [status, setStatus] = useState<WbStatusFilter>("all");
  const [colorMode, setColorMode] = useState<"density" | "cancel" | "price" | "self_ride">("density");

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);
    fetchWbHeatmap({ fromTs: range.fromTs, toTs: range.toTs }, status)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e?.message || "load_failed"));
    return () => {
      cancelled = true;
    };
  }, [range.fromTs, range.toTs, status]);

  const pickupPoints = useMemo(() => data?.geo?.pickup ?? [], [data]);
  const meta = data?.meta;

  return (
    <div className="container mx-auto p-4 space-y-4 max-w-[1400px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Тепловые карты</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Где формируются заказы, в какие часы и дни. Период и статус
            применяются ко всем графикам.
          </p>
        </div>
        <WbDateRangePicker value={range} onChange={setRange} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Статус заказа:</span>
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setStatus(opt.value)}
            className={`text-xs px-3 py-1 rounded border transition ${
              status === opt.value
                ? "bg-foreground text-background border-foreground"
                : "bg-background hover:bg-muted"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {error && (
        <Card className="p-4 text-sm text-red-600">
          Не удалось загрузить тепловые карты: {error}
        </Card>
      )}

      {!data && !error && (
        <Card className="p-4 text-sm text-muted-foreground">Загрузка…</Card>
      )}

      {data && (
        <>
          {meta && (
            <Card className="p-3 text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
              <span>
                Заказов в периоде:{" "}
                <b className="text-foreground">{meta.total}</b>
              </span>
              <span>
                С координатами:{" "}
                <b className="text-foreground">{meta.withCoords}</b> (
                {(meta.coverage * 100).toFixed(1)}%)
              </span>
              {data.geo && (
                <span>
                  Уникальных точек подачи:{" "}
                  <b className="text-foreground">{data.geo.buckets}</b>
                </span>
              )}
            </Card>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Где формируются заказы</h2>
              <div className="text-xs flex items-center gap-2">
                <span className="text-muted-foreground">Цвет по:</span>
                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${colorMode === "density" ? "bg-foreground text-background" : "bg-background"}`}
                  onClick={() => setColorMode("density")}
                >
                  плотности
                </button>
                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${colorMode === "cancel" ? "bg-foreground text-background" : "bg-background"}`}
                  onClick={() => setColorMode("cancel")}
                >
                  доле отмен
                </button>
                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${colorMode === "price" ? "bg-foreground text-background" : "bg-background"}`}
                  onClick={() => setColorMode("price")}
                >
                  цене
                </button>
                <button
                  type="button"
                  className={`px-2 py-1 rounded border ${colorMode === "self_ride" ? "bg-foreground text-background" : "bg-background"}`}
                  onClick={() => setColorMode("self_ride")}
                  title="Подача и высадка совпадают (<300 м) — водитель мог сам себя «заказать»"
                >
                  самозаказы
                </button>
              </div>
            </div>
            <WbGeoHeatmap points={pickupPoints} colorMode={colorMode} />
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">По времени</h2>
            <WbHeatmapMatrix cells={data.cells} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <WbBarChart
                title="По дням недели"
                hint="Всего заказов и доля отмен (оранжевое)."
                rows={data.byWeekday.map((r) => ({
                  label: WEEKDAYS[r.weekday],
                  total: r.total,
                  cancelled: r.cancelled,
                }))}
                highlightCancel
              />
              <WbBarChart
                title="По часам суток"
                hint="Часы — UTC. Оранжевое — доля отмен."
                rows={data.byHour.map((r) => ({
                  label: String(r.hour).padStart(2, "0"),
                  total: r.total,
                  cancelled: r.cancelled,
                }))}
                highlightCancel
              />
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Цены по часам</h2>
            <p className="text-xs text-muted-foreground">
              Считается только по выполненным заказам. В этих данных нет
              отдельного поля «тариф», поэтому показаны: средний чек заказа
              (gmv) и средняя цена за километр.
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <WbBarChart
                title="Средний чек заказа, BYN"
                hint="Часы — UTC. Среднее по выполненным заказам в этом часе."
                rows={data.byHour.map((r) => ({
                  label: String(r.hour).padStart(2, "0"),
                  total: r.avgGmv ?? 0,
                }))}
              />
              <WbBarChart
                title="Цена за километр, BYN/км"
                hint="Часы — UTC. Среднее по выполненным заказам в этом часе."
                rows={data.byHour.map((r) => ({
                  label: String(r.hour).padStart(2, "0"),
                  total: r.avgPricePerKm ?? 0,
                }))}
              />
            </div>
          </div>

          <WbDistanceHistogram rows={data.byDistance} />
        </>
      )}
    </div>
  );
}

export default function WbHeatmapsPage() {
  return (
    <WbShell>
      <Inner />
    </WbShell>
  );
}
