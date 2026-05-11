// Прокладка маршрута между двумя точками.
// Используем публичный demo-сервер OSRM (router.project-osrm.org) — бесплатно,
// без ключа. Если он недоступен — fallback на прямую линию × 1.3 (грубая оценка
// реального расстояния по дорогам в городской застройке).

export type RoutePoint = [number, number]; // [lat, lng]

export type Route = {
  distanceKm: number;
  durationMin: number;
  /** Полилиния маршрута для отрисовки на карте. */
  path: RoutePoint[];
  /** Был ли использован fallback (не реальный маршрут). */
  fallback: boolean;
};

const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";

function haversineKm(a: RoutePoint, b: RoutePoint): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

export async function fetchRoute(
  from: RoutePoint,
  to: RoutePoint,
  signal?: AbortSignal,
): Promise<Route> {
  // OSRM ждёт lng,lat
  const coords = `${from[1]},${from[0]};${to[1]},${to[0]}`;
  const url = `${OSRM_URL}/${coords}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const json = (await res.json()) as {
      code: string;
      routes?: Array<{
        distance: number; // м
        duration: number; // с
        geometry: { coordinates: Array<[number, number]> }; // lng,lat
      }>;
    };
    if (json.code !== "Ok" || !json.routes?.length) {
      throw new Error(`OSRM code=${json.code}`);
    }
    const r = json.routes[0];
    const path: RoutePoint[] = r.geometry.coordinates.map(
      ([lng, lat]) => [lat, lng] as RoutePoint,
    );
    return {
      distanceKm: r.distance / 1000,
      durationMin: r.duration / 60,
      path,
      fallback: false,
    };
  } catch (err) {
    // Fallback: грубая оценка. Используем «свободную» скорость 50 км/ч,
    // чтобы пробочный множитель в RoutePlanner мог поверх неё применить
    // адекватную поправку на трафик (без двойного учёта пробок).
    const km = haversineKm(from, to) * 1.3;
    const min = (km / 50) * 60;
    return {
      distanceKm: km,
      durationMin: min,
      path: [from, to],
      fallback: true,
    };
  }
}

/**
 * Сэмплирует точки вдоль полилинии (равномерно по индексу) — пригождается для
 * запросов пробок и для усреднения сёрджа по гексам, через которые проходит
 * маршрут.
 */
export function samplePath(path: RoutePoint[], n: number): RoutePoint[] {
  if (path.length <= n) return path.slice();
  const step = (path.length - 1) / (n - 1);
  const out: RoutePoint[] = [];
  for (let i = 0; i < n; i++) {
    out.push(path[Math.round(i * step)]);
  }
  return out;
}
