import { useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { WbPickupPoint } from "@/lib/wb-api";
import { Card } from "@/components/ui/card";

type Props = {
  points: WbPickupPoint[];
  height?: number;
  colorMode?: "density" | "cancel" | "price" | "self_ride";
};

const MINSK_CENTER: [number, number] = [53.9023, 27.5618];

function colorForCancel(rate: number): string {
  if (rate >= 0.7) return "#dc2626";
  if (rate >= 0.4) return "#f59e0b";
  if (rate >= 0.2) return "#eab308";
  return "#16a34a";
}

function colorForDensity(count: number, max: number): string {
  const t = Math.min(1, count / Math.max(1, max));
  if (t >= 0.85) return "#7f1d1d";
  if (t >= 0.6) return "#dc2626";
  if (t >= 0.35) return "#f97316";
  if (t >= 0.15) return "#eab308";
  return "#16a34a";
}

// Цена: дёшево = зелёный, дорого = красный. Нормировка по min/max в наборе.
function colorForPrice(
  price: number | null | undefined,
  min: number,
  max: number,
): string {
  if (price == null || !Number.isFinite(price)) return "#9ca3af";
  if (max <= min) return "#eab308";
  const t = (price - min) / (max - min);
  if (t >= 0.85) return "#7f1d1d";
  if (t >= 0.6) return "#dc2626";
  if (t >= 0.35) return "#f97316";
  if (t >= 0.15) return "#eab308";
  return "#16a34a";
}

// Самозаказы: серый = чисто, жёлтый = 1, оранжевый = 2, красный = 3+
function colorForSelfRide(n: number | undefined): string {
  const v = n ?? 0;
  if (v >= 3) return "#dc2626";
  if (v === 2) return "#f97316";
  if (v === 1) return "#eab308";
  return "#9ca3af";
}

export function WbGeoHeatmap({ points, height = 520, colorMode = "density" }: Props) {
  const maxCount = useMemo(
    () => points.reduce((m, p) => (p.count > m ? p.count : m), 0),
    [points],
  );

  const totalOrders = useMemo(
    () => points.reduce((s, p) => s + p.count, 0),
    [points],
  );

  // Диапазон цен для colorMode="price": учитываем только точки с avgPrice.
  const priceRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      if (p.avgPrice != null && Number.isFinite(p.avgPrice)) {
        if (p.avgPrice < min) min = p.avgPrice;
        if (p.avgPrice > max) max = p.avgPrice;
      }
    }
    if (!Number.isFinite(min)) return { min: 0, max: 0 };
    return { min, max };
  }, [points]);

  const selfRideStats = useMemo(() => {
    let pts = 0;
    let orders = 0;
    for (const p of points) {
      const n = p.selfRideCount ?? 0;
      if (n > 0) {
        pts++;
        orders += n;
      }
    }
    return { pts, orders };
  }, [points]);

  // Для self_ride режима показываем только подозрительные точки сверху.
  const displayPoints = useMemo(() => {
    if (colorMode !== "self_ride") return points;
    return [...points].sort(
      (a, b) => (a.selfRideCount ?? 0) - (b.selfRideCount ?? 0),
    );
  }, [points, colorMode]);

  if (points.length === 0) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Нет точек подачи в выбранном периоде.
      </Card>
    );
  }

  const legendLabels =
    colorMode === "self_ride"
      ? { lo: "чисто", hi: "много самозаказов" }
      : colorMode === "price"
        ? { lo: "дешевле", hi: "дороже" }
        : colorMode === "cancel"
          ? { lo: "редко отменяют", hi: "часто отменяют" }
          : { lo: "мало", hi: "много" };

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-2 border-b flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          Точек: <b className="text-foreground">{points.length}</b>
        </span>
        <span>
          Заказов: <b className="text-foreground">{totalOrders}</b>
        </span>
        <span>
          Макс. в одной точке: <b className="text-foreground">{maxCount}</b>
        </span>
        {colorMode === "price" && priceRange.max > 0 && (
          <span>
            Цены: <b className="text-foreground">{priceRange.min.toFixed(1)}…{priceRange.max.toFixed(1)}</b> BYN
          </span>
        )}
        {colorMode === "self_ride" && (
          <span className="text-red-700">
            Самозаказов: <b>{selfRideStats.orders}</b> в <b>{selfRideStats.pts}</b> точках
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {colorMode === "self_ride" ? (
            <>
              <span className="inline-block w-3 h-3 rounded-full bg-gray-400" />
              {legendLabels.lo}
              <span className="inline-block w-3 h-3 rounded-full bg-yellow-500" />
              <span className="inline-block w-3 h-3 rounded-full bg-orange-500" />
              <span className="inline-block w-3 h-3 rounded-full bg-red-600" />
              {legendLabels.hi}
            </>
          ) : (
            <>
              <span className="inline-block w-3 h-3 rounded-full bg-green-600" />
              {legendLabels.lo}
              <span className="inline-block w-3 h-3 rounded-full bg-yellow-500" />
              <span className="inline-block w-3 h-3 rounded-full bg-orange-500" />
              <span className="inline-block w-3 h-3 rounded-full bg-red-600" />
              {legendLabels.hi}
            </>
          )}
        </span>
      </div>
      <div style={{ height }}>
        <MapContainer
          center={MINSK_CENTER}
          zoom={11}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {displayPoints.map((p, i) => {
            const sr = p.selfRideCount ?? 0;
            // В режиме "самозаказы" чистые точки рисуем мелко и приглушённо,
            // подозрительные — крупнее с обводкой, чтобы выделялись.
            const r =
              colorMode === "self_ride"
                ? sr > 0
                  ? 6 + Math.sqrt(sr) * 3
                  : 3
                : 4 + Math.sqrt(p.count) * 2.5;
            const color =
              colorMode === "self_ride"
                ? colorForSelfRide(sr)
                : colorMode === "price"
                  ? colorForPrice(p.avgPrice, priceRange.min, priceRange.max)
                  : colorMode === "cancel"
                    ? colorForCancel(p.cancelRate)
                    : colorForDensity(p.count, maxCount);
            const fillOpacity =
              colorMode === "self_ride" && sr === 0 ? 0.25 : 0.55;
            const weight =
              colorMode === "self_ride" && sr > 0 ? 2 : 1;
            return (
              <CircleMarker
                key={i}
                center={[p.lat, p.lng]}
                radius={r}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity,
                  weight,
                }}
              >
                <Tooltip direction="top" offset={[0, -4]} opacity={0.95}>
                  <div className="text-xs leading-tight">
                    <div>
                      <b>{p.count}</b> заказ(ов)
                    </div>
                    <div>
                      выполнено: {p.completed}, отменено: {p.cancelled}
                    </div>
                    <div>отмен: {(p.cancelRate * 100).toFixed(0)}%</div>
                    {p.gmvSum > 0 && (
                      <div>оборот: {p.gmvSum.toFixed(2)} BYN</div>
                    )}
                    {p.avgPrice != null && (
                      <div>
                        средний чек: <b>{p.avgPrice.toFixed(2)}</b> BYN
                      </div>
                    )}
                    {sr > 0 && (
                      <div className="text-red-700 mt-1">
                        ⚠ самозаказов: <b>{sr}</b> (подача ≈ высадка)
                      </div>
                    )}
                    <div className="text-muted-foreground mt-1">
                      {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                    </div>
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </Card>
  );
}
