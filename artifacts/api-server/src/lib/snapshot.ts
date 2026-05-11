import {
  estimateRoadDistanceKm,
  estimateDurationMin,
  type Coordinate,
} from "./pricing";
import { findYandexCityForCoord } from "./cities";
import type { MinskRoute } from "./minsk-routes";
import { computeSurge, type SurgeBreakdown } from "./surge-model";
import { fetchYandexRouteStats } from "./yandex-client";
import { getWeatherAt } from "./weather-client";
import { logger } from "./logger";

export type SnapshotSource = "live" | "model";

export interface RouteClassSnapshot {
  routeId: string;
  classId: string;
  className: string;
  classDescription: string;
  priceMin: number;
  priceMax: number;
  surgeMultiplier: number;
  surgeDriver: SurgeBreakdown["driver"];
  distanceKm: number;
  durationMin: number;
  capacity: number;
  currency: string;
  capturedAt: Date;
  source: SnapshotSource;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Compute the per-class snapshot for a single route at a given moment using
 * ONLY the local synthetic surge model. Used for forecast points (where
 * hitting Yandex 24 times for one drilldown would be wasteful and could
 * trigger throttling) and as the fallback when the live fetch fails.
 *
 * If the pickup coordinate falls outside any configured city tariff, an
 * empty array is returned.
 *
 * Weather is fetched from the in-memory Open-Meteo cache (15-min TTL)
 * and applied to the surge multiplier before pricing.
 */
export async function buildRouteSnapshot(
  route: MinskRoute,
  capturedAt: Date,
): Promise<RouteClassSnapshot[]> {
  const city = findYandexCityForCoord(route.pickup as Coordinate);
  if (!city) return [];

  const distanceKm = round1(
    estimateRoadDistanceKm(route.pickup, route.dropoff),
  );
  const durationMin = Math.round(estimateDurationMin(distanceKm));

  // Fetch current weather for the capture time — uses in-memory cache so
  // this is effectively free after the first call within 15 minutes.
  const wx = await getWeatherAt(capturedAt);
  const surge = computeSurge(capturedAt, route.id, route.volatility, wx);

  return city.classes.map((cls) => {
    const subtotal =
      cls.pickupCost + cls.perKm * distanceKm + cls.perMin * durationMin;
    const total = Math.max(cls.minimumFare, subtotal) * surge.multiplier;
    const spread = Math.max(0.5, total * 0.08);
    return {
      routeId: route.id,
      classId: cls.id,
      className: cls.name,
      classDescription: cls.description,
      priceMin: round1(total - spread / 2),
      priceMax: round1(total + spread / 2),
      surgeMultiplier: round1(surge.multiplier * 100) / 100,
      surgeDriver: surge.driver,
      distanceKm,
      durationMin,
      capacity: cls.capacity,
      currency: city.currency,
      capturedAt,
      source: "model",
    };
  });
}

/**
 * Capture a route snapshot for the scheduler.
 *
 * Pricing model
 * -------------
 * Per-ride prices ALWAYS come from the local formula model
 * (`buildRouteSnapshot`). The taxi.yandex.ru `routestats` endpoint, when
 * called without an authenticated user session, returns only the *minimum*
 * tariff base (literally "от 5,8 BYN" — the field is a class floor price,
 * not a route-aware quote), so it is unsuitable as a price source.
 *
 * Live signal
 * -----------
 * What the public endpoint DOES return reliably is the per-area surge
 * multiplier (`paid_options.value`). That is real, fluctuates with demand,
 * and matches what the Yandex Go app shows. So we:
 *
 *   1. Compute prices from the formula model (weather + events aware).
 *   2. If the live fetch succeeds, **override the model's synthetic surge
 *      with Yandex's real surge** and re-scale the price accordingly.
 *      The cell is then marked source = "live" (live surge applied).
 *   3. If the live fetch fails (network error, rate-limit, ToS block),
 *      keep the model's synthetic surge. source = "model".
 */
export async function captureRouteSnapshot(
  route: MinskRoute,
  capturedAt: Date,
): Promise<RouteClassSnapshot[]> {
  const baseSnapshots = await buildRouteSnapshot(route, capturedAt);
  if (baseSnapshots.length === 0) return [];

  let live: Awaited<ReturnType<typeof fetchYandexRouteStats>> | null = null;
  try {
    live = await fetchYandexRouteStats(route.pickup, route.dropoff);
  } catch (err) {
    logger.warn(
      { routeId: route.id, err: (err as Error).message },
      "Yandex live surge fetch failed; using model surge",
    );
  }

  if (!live || live.length === 0) return baseSnapshots;

  const liveSurgeByClass = new Map(
    live.map((e) => [e.classId as string, e.surgeMultiplier]),
  );
  const modelSurge = baseSnapshots[0].surgeMultiplier;

  let liveHits = 0;
  const out = baseSnapshots.map((snap) => {
    const liveSurge = liveSurgeByClass.get(snap.classId);
    if (liveSurge == null) return snap;
    liveHits++;
    const ratio = modelSurge > 0 ? liveSurge / modelSurge : 1;
    const priceMin = round1(snap.priceMin * ratio);
    const priceMax = round1(snap.priceMax * ratio);
    return {
      ...snap,
      priceMin,
      priceMax,
      surgeMultiplier: round1(liveSurge * 100) / 100,
      source: "live" as const,
    };
  });

  if (liveHits > 0 && liveHits < baseSnapshots.length) {
    logger.info(
      {
        routeId: route.id,
        liveHits,
        modelFill: baseSnapshots.length - liveHits,
      },
      "Partial live surge — kept model surge for missing classes",
    );
  }
  return out;
}
