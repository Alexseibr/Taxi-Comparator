import { useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Tooltip,
  LayersControl,
  LayerGroup,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Card } from "@/components/ui/card";
import type { WbRouteCluster, WbTripPoint } from "@/lib/wb-api";

const MINSK_CENTER: [number, number] = [53.9023, 27.5618];

type Props = {
  points: WbTripPoint[];
  routes: WbRouteCluster[];
  height?: number;
  title?: string;
};

function pointColor(p: WbTripPoint): string {
  if (p.isSelfRide) return "#dc2626";
  if (p.speedAnomaly === "fake_gps") return "#7f1d1d";
  if (p.speedAnomaly === "too_fast") return "#f97316";
  if (p.speedAnomaly === "too_slow") return "#a16207";
  if (p.status === "cancelled") return "#94a3b8";
  if (p.status === "completed") return "#16a34a";
  return "#6b7280";
}

function badgeForPoint(p: WbTripPoint): string {
  const parts: string[] = [];
  if (p.isSelfRide) parts.push("самозаказ");
  if (p.speedAnomaly === "fake_gps") parts.push("160+ км/ч");
  if (p.speedAnomaly === "too_fast") parts.push("слишком быстро");
  if (p.speedAnomaly === "too_slow") parts.push("растянуто");
  return parts.join(", ");
}

function fitBounds(points: WbTripPoint[]): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const p of points) {
    if (p.latIn < minLat) minLat = p.latIn;
    if (p.latIn > maxLat) maxLat = p.latIn;
    if (p.lngIn < minLng) minLng = p.lngIn;
    if (p.lngIn > maxLng) maxLng = p.lngIn;
    if (p.latOut != null && p.lngOut != null) {
      if (p.latOut < minLat) minLat = p.latOut;
      if (p.latOut > maxLat) maxLat = p.latOut;
      if (p.lngOut < minLng) minLng = p.lngOut;
      if (p.lngOut > maxLng) maxLng = p.lngOut;
    }
  }
  if (!Number.isFinite(minLat)) return null;
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

export function WbTripMap({
  points,
  routes,
  height = 480,
  title = "Карта поездок",
}: Props) {
  const bounds = useMemo(() => fitBounds(points), [points]);
  const maxRouteCount = useMemo(
    () => routes.reduce((m, r) => (r.count > m ? r.count : m), 1),
    [routes],
  );

  const stats = useMemo(() => {
    const selfRide = points.filter((p) => p.isSelfRide).length;
    const fakeGps = points.filter((p) => p.speedAnomaly === "fake_gps").length;
    const tooFast = points.filter((p) => p.speedAnomaly === "too_fast").length;
    const tooSlow = points.filter((p) => p.speedAnomaly === "too_slow").length;
    const cancelled = points.filter((p) => p.status === "cancelled").length;
    return { selfRide, fakeGps, tooFast, tooSlow, cancelled, total: points.length };
  }, [points]);

  if (!points.length) {
    return (
      <Card className="p-4">
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted-foreground mt-1">
          Нет заказов с координатами для отображения.
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap px-1">
        <div className="font-medium">{title}</div>
        <div className="text-xs text-muted-foreground space-x-3">
          <span>всего точек: {stats.total}</span>
          {stats.selfRide > 0 && (
            <span className="text-red-700">самозаказов: {stats.selfRide}</span>
          )}
          {(stats.fakeGps + stats.tooFast) > 0 && (
            <span className="text-orange-700">
              скорость↑: {stats.fakeGps + stats.tooFast}
            </span>
          )}
          {stats.tooSlow > 0 && (
            <span className="text-amber-700">растянуто: {stats.tooSlow}</span>
          )}
          {stats.cancelled > 0 && (
            <span className="text-slate-600">отмены: {stats.cancelled}</span>
          )}
        </div>
      </div>
      <div style={{ height }}>
        <MapContainer
          center={MINSK_CENTER}
          zoom={12}
          bounds={bounds || undefined}
          boundsOptions={{ padding: [20, 20] }}
          style={{ height: "100%", width: "100%", borderRadius: 6 }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <LayersControl position="topright" collapsed={false}>
            <LayersControl.Overlay checked name="Точки заказов">
              <LayerGroup>
                {points.map((p) => {
                  const isAnomaly =
                    p.isSelfRide ||
                    p.speedAnomaly === "fake_gps" ||
                    p.speedAnomaly === "too_fast" ||
                    p.speedAnomaly === "too_slow";
                  const color = pointColor(p);
                  const badge = badgeForPoint(p);
                  return (
                    <CircleMarker
                      key={p.orderId}
                      center={[p.latIn, p.lngIn]}
                      radius={isAnomaly ? 6 : 4}
                      pathOptions={{
                        color,
                        fillColor: color,
                        fillOpacity: 0.85,
                        weight: isAnomaly ? 2 : 1,
                      }}
                    >
                      <Tooltip direction="top" offset={[0, -2]} opacity={0.95}>
                        <div className="text-xs space-y-0.5">
                          <div className="font-mono">#{p.orderId}</div>
                          <div>
                            {p.km != null ? `${p.km.toFixed(1)} км` : "—"}
                            {p.tripMin != null ? ` · ${p.tripMin.toFixed(0)} мин` : ""}
                            {p.gmv != null ? ` · ${p.gmv.toFixed(2)} BYN` : ""}
                          </div>
                          <div className="text-muted-foreground">
                            {p.createdAt?.replace("T", " ").slice(0, 16) || ""}
                          </div>
                          {badge && (
                            <div className="font-semibold text-red-700">⚠ {badge}</div>
                          )}
                        </div>
                      </Tooltip>
                    </CircleMarker>
                  );
                })}
                {points
                  .filter((p) => p.latOut != null && p.lngOut != null)
                  .map((p) => (
                    <CircleMarker
                      key={`out-${p.orderId}`}
                      center={[p.latOut as number, p.lngOut as number]}
                      radius={2.5}
                      pathOptions={{
                        color: "#0ea5e9",
                        fillColor: "#0ea5e9",
                        fillOpacity: 0.5,
                        weight: 0.5,
                      }}
                    />
                  ))}
              </LayerGroup>
            </LayersControl.Overlay>
            <LayersControl.Overlay checked name="Топ повторяющихся маршрутов">
              <LayerGroup>
                {routes.map((r) => {
                  const t = r.count / maxRouteCount;
                  const weight = 2 + t * 5;
                  const color =
                    t >= 0.7 ? "#dc2626" : t >= 0.4 ? "#f97316" : "#eab308";
                  return (
                    <Polyline
                      key={r.key}
                      positions={[
                        [r.pickupLat, r.pickupLng],
                        [r.dropoffLat, r.dropoffLng],
                      ]}
                      pathOptions={{ color, weight, opacity: 0.75 }}
                    >
                      <Tooltip direction="top" sticky>
                        <div className="text-xs space-y-0.5">
                          <div className="font-semibold">
                            ×{r.count} раз · {r.distM} м
                          </div>
                          <div>
                            ср. {r.avgKm} км · {r.avgGmv} BYN
                          </div>
                        </div>
                      </Tooltip>
                    </Polyline>
                  );
                })}
              </LayerGroup>
            </LayersControl.Overlay>
          </LayersControl>
        </MapContainer>
      </div>
      <div className="text-[11px] text-muted-foreground px-1 leading-tight">
        Зелёные — выполненные, серые — отменённые, красные — подача≈высадка
        (самозаказ), оранжевые — слишком быстро, тёмно-красные — невозможная
        скорость, янтарные — растянуто. Маленькие синие точки — высадки. Линии
        — топ повторяющихся маршрутов, толщина и цвет по числу повторов.
      </div>
    </Card>
  );
}
