import { useEffect, useMemo, useState } from "react";
import { Polygon, Tooltip, useMap, useMapEvents } from "react-leaflet";
import {
  latLngToCell,
  gridDisk,
  cellToBoundary,
  cellToLatLng,
} from "h3-js";
import {
  ZONES,
  MINSK_CENTER,
  MKAD_RADIUS_KM,
  distanceKmFromCenter,
  zoomToH3Res,
  type DayType,
  type Zone,
} from "@/lib/zones";
import { TYPE_DEMAND_FACTOR } from "@/lib/fleet";
import { fetchRecentCalibs, type RecentCalib } from "@/lib/screens-server";

type Props = {
  day: DayType;
  hour: number;
  hourTolerance?: number;
};

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestZone(lat: number, lng: number): Zone | null {
  let best: Zone | null = null;
  let bestD = Infinity;
  for (const z of ZONES) {
    const d = haversineKm(lat, lng, z.center[0], z.center[1]);
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best;
}

function dayOfWeekToType(jsDay: number): DayType {
  if (jsDay === 0) return "sunday";
  if (jsDay === 6) return "saturday";
  return "weekday";
}

// Цвет соты по количеству скринов в её зоне.
// Дыра (0 скринов) — насыщенный красный.
// Чем больше скринов — тем более прозрачно (фон карты не закрывается).
function bucketColor(n: number): { stroke: string; fill: string; opacity: number } {
  if (n === 0) return { stroke: "#dc2626", fill: "#ef4444", opacity: 0.55 };
  if (n <= 2) return { stroke: "#ea580c", fill: "#f97316", opacity: 0.4 };
  if (n <= 5) return { stroke: "#ca8a04", fill: "#eab308", opacity: 0.28 };
  return { stroke: "#059669", fill: "#10b981", opacity: 0.18 };
}

function bucketLabel(n: number): string {
  if (n === 0) return "🔴 Дыра — нет данных";
  if (n <= 2) return `🟠 Слабо (${n} скрин${n === 1 ? "" : "а"})`;
  if (n <= 5) return `🟡 Норм (${n} скринов)`;
  return `🟢 Точно (${n} скринов)`;
}

function dayLabel(d: DayType): string {
  if (d === "weekday") return "будни";
  if (d === "saturday") return "сб";
  return "вс";
}

// Фактор «обитаемости» — ячейки дальше HABITABILITY_FACTOR × radiusZone
// от центра ближайшей зоны исключаем (лес/поле/вода/ж/д пути проходят
// между зонами, поэтому такие ячейки попадают за лимит).
const HABITABILITY_FACTOR = 1.25;

export function HolesOverlayLayer({ day, hour, hourTolerance = 1 }: Props) {
  const map = useMap();
  const [zoom, setZoom] = useState<number>(() => map.getZoom());
  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  const [calibs, setCalibs] = useState<RecentCalib[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchRecentCalibs(200).then((r) => {
      if (cancelled) return;
      if (r.ok) setCalibs(r.items);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 1) Геометрия сот зависит только от zoom — пересчитываем редко.
  //    На дальнем зуме крупные соты (res 7), на ближнем — мелкие (res 9).
  const cellGeometry = useMemo(() => {
    const res = zoomToH3Res(zoom);
    const centerHex = latLngToCell(MINSK_CENTER[0], MINSK_CENTER[1], res);
    const k = res === 7 ? 8 : res === 8 ? 18 : 45;
    const cells = gridDisk(centerHex, k);
    const out: {
      id: string;
      boundary: [number, number][];
      centerLatLng: [number, number];
    }[] = [];
    for (const cell of cells) {
      const [lat, lng] = cellToLatLng(cell);
      if (distanceKmFromCenter(lat, lng) > MKAD_RADIUS_KM) continue;
      out.push({
        id: cell,
        boundary: cellToBoundary(cell, false) as [number, number][],
        centerLatLng: [lat, lng],
      });
    }
    return out;
  }, [zoom]);

  // 2) Счётчик скринов по зонам — зависит от day/hour и калибровок.
  const countByZone = useMemo(() => {
    const m = new Map<string, number>();
    for (const z of ZONES) m.set(z.id, 0);
    for (const c of calibs) {
      if (c.fromLat == null || c.fromLng == null || c.hour == null) continue;
      const d = new Date(c.receivedAt);
      if (isNaN(d.getTime())) continue;
      if (dayOfWeekToType(d.getDay()) !== day) continue;
      const dh = Math.abs(c.hour - hour);
      const wrap = Math.min(dh, 24 - dh);
      if (wrap > hourTolerance) continue;
      const z = nearestZone(c.fromLat, c.fromLng);
      if (z) m.set(z.id, (m.get(z.id) ?? 0) + 1);
    }
    return m;
  }, [calibs, day, hour, hourTolerance]);

  // 3) Привязка каждой соты к ведущей зоне + habitable фильтр.
  //    Ячейки за пределами habitable (леса, озёра, поля, ж/д пути,
  //    промзоны без спроса, аэропорт) — отбрасываем сразу. Зоны
  //    типа «transport-hub» (вокзалы) и «mall»/«premium» — учитываются
  //    (typeFactor > 0).
  const habitableCells = useMemo(() => {
    type Cell = {
      id: string;
      boundary: [number, number][];
      zone: Zone;
      count: number;
    };
    const out: Cell[] = [];
    for (const g of cellGeometry) {
      const z = nearestZone(g.centerLatLng[0], g.centerLatLng[1]);
      if (!z) continue;
      const tf = TYPE_DEMAND_FACTOR[z.type] ?? 1.0;
      if (tf <= 0) continue; // аэропорт и пр.
      const dKm = haversineKm(
        g.centerLatLng[0],
        g.centerLatLng[1],
        z.center[0],
        z.center[1],
      );
      const limitKm = (z.radiusM / 1000) * HABITABILITY_FACTOR;
      if (dKm > limitKm) continue; // лес/поле/ж/д — между зонами
      out.push({
        id: g.id,
        boundary: g.boundary,
        zone: z,
        count: countByZone.get(z.id) ?? 0,
      });
    }
    return out;
  }, [cellGeometry, countByZone]);

  return (
    <>
      {habitableCells.map((cell) => {
        const c = bucketColor(cell.count);
        return (
          <Polygon
            key={cell.id}
            positions={cell.boundary}
            pathOptions={{
              color: c.stroke,
              fillColor: c.fill,
              fillOpacity: c.opacity,
              weight: 0.6,
              opacity: 0.7,
              dashArray: cell.count === 0 ? "4 3" : undefined,
            }}
          >
            <Tooltip direction="top" sticky offset={[0, -4]}>
              <div className="text-xs leading-tight">
                <div className="font-semibold">{cell.zone.nameRu}</div>
                <div>{bucketLabel(cell.count)}</div>
                <div className="text-muted-foreground">
                  {String(hour).padStart(2, "0")}:00 ±{hourTolerance}ч ·{" "}
                  {dayLabel(day)}
                </div>
                {cell.count === 0 && (
                  <div className="text-red-700 font-medium mt-0.5">
                    Нужны скрины Yandex отсюда!
                  </div>
                )}
              </div>
            </Tooltip>
          </Polygon>
        );
      })}
    </>
  );
}
