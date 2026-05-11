import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { db, tariffSnapshotsTable } from "@workspace/db";
import { MINSK_ROUTES } from "../lib/minsk-routes";
import { findYandexCityForCoord } from "../lib/cities";
import { estimateRoadDistanceKm, estimateDurationMin } from "../lib/pricing";
import { buildRouteSnapshot } from "../lib/snapshot";
import { computeSurge, forecastSurge } from "../lib/surge-model";
import { nextSlotStart, SNAPSHOT_SLOT_MS } from "../lib/slots";
import { getWeatherAt, getWeatherRange } from "../lib/weather-client";
import { listEvents, getEventSurgeMult, getActiveEvents } from "../lib/minsk-events";

const SNAPSHOT_INTERVAL_MIN = SNAPSHOT_SLOT_MS / 60_000;

const router: IRouter = Router();

interface RouteCellResponse {
  classId: string;
  className: string;
  capacity: number;
  priceMin: number | null;
  priceMax: number | null;
  surgeMultiplier: number | null;
  source: "live" | "model" | "none";
}

interface RouteRowResponse {
  routeId: string;
  pickupLabel: string;
  dropoffLabel: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  distanceKm: number;
  durationMin: number;
  volatility: number;
  capturedAt: string | null;
  surgeMultiplier: number | null;
  surgeDriver: string;
  cells: RouteCellResponse[];
}

router.get("/tariff-grid/routes", async (_req, res): Promise<void> => {
  const latestPerRoute = await db.execute<{
    route_id: string;
    class_id: string;
    class_name: string;
    price_min: number;
    price_max: number;
    surge_multiplier: number;
    distance_km: number;
    duration_min: number;
    captured_at: string | Date;
    source: string;
  }>(sql`
    SELECT DISTINCT ON (route_id, class_id)
      route_id, class_id, class_name, price_min, price_max,
      surge_multiplier, distance_km, duration_min, captured_at, source
    FROM tariff_snapshots
    ORDER BY route_id, class_id, captured_at DESC
  `);

  const byRoute = new Map<
    string,
    Map<string, (typeof latestPerRoute.rows)[number]>
  >();
  for (const row of latestPerRoute.rows) {
    if (!byRoute.has(row.route_id)) byRoute.set(row.route_id, new Map());
    byRoute.get(row.route_id)!.set(row.class_id, row);
  }

  const now = new Date();
  const wx = await getWeatherAt(now).catch(() => undefined);

  const rows: RouteRowResponse[] = MINSK_ROUTES.map((route) => {
    const city = findYandexCityForCoord(route.pickup);
    const distanceKm =
      Math.round(estimateRoadDistanceKm(route.pickup, route.dropoff) * 10) / 10;
    const durationMin = Math.round(estimateDurationMin(distanceKm));

    const captured = byRoute.get(route.id);

    const cells: RouteCellResponse[] = (city?.classes ?? []).map((cls) => {
      const snap = captured?.get(cls.id);
      return {
        classId: cls.id,
        className: cls.name,
        capacity: cls.capacity,
        priceMin: snap ? snap.price_min : null,
        priceMax: snap ? snap.price_max : null,
        surgeMultiplier: snap ? snap.surge_multiplier : null,
        source: snap
          ? snap.source === "live"
            ? "live"
            : "model"
          : "none",
      };
    });

    let capturedAt: string | null = null;
    let surgeMultiplier: number | null = null;
    let latestSnap: (typeof latestPerRoute.rows)[number] | null = null;
    for (const snap of captured?.values() ?? []) {
      const capturedDate =
        snap.captured_at instanceof Date
          ? snap.captured_at
          : new Date(snap.captured_at);
      if (!latestSnap) {
        latestSnap = snap;
        capturedAt = capturedDate.toISOString();
      } else {
        const latestDate =
          latestSnap.captured_at instanceof Date
            ? latestSnap.captured_at
            : new Date(latestSnap.captured_at);
        if (capturedDate > latestDate) {
          latestSnap = snap;
          capturedAt = capturedDate.toISOString();
        }
      }
    }
    if (latestSnap) {
      surgeMultiplier = latestSnap.surge_multiplier;
    }
    let surgeDriver = "calm";
    if (capturedAt) {
      surgeDriver = computeSurge(
        new Date(capturedAt),
        route.id,
        route.volatility,
        wx,
      ).driver;
    }

    return {
      routeId: route.id,
      pickupLabel: route.pickupLabel,
      dropoffLabel: route.dropoffLabel,
      pickup: route.pickup,
      dropoff: route.dropoff,
      distanceKm,
      durationMin,
      volatility: route.volatility,
      capturedAt,
      surgeMultiplier,
      surgeDriver,
      cells,
    };
  });

  res.json({
    generatedAt: new Date().toISOString(),
    intervalMinutes: SNAPSHOT_INTERVAL_MIN,
    routes: rows,
  });
});

router.get("/tariff-grid/route/:id/history", async (req, res): Promise<void> => {
  const route = MINSK_ROUTES.find((r) => r.id === req.params.id);
  if (!route) {
    res.status(404).json({ error: "Route not found" });
    return;
  }

  const parsePositiveInt = (
    raw: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number => {
    if (raw == null || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(max, Math.max(min, Math.floor(n)));
  };
  const sinceHours = parsePositiveInt(req.query["hours"], 48, 1, 168);
  const forecastHours = parsePositiveInt(
    req.query["forecastHours"],
    24,
    1,
    72,
  );
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

  const tariff = findYandexCityForCoord(route.pickup);
  const cityClasses = (tariff?.classes ?? []).map((c) => ({
    classId: c.id,
    className: c.name,
  }));

  const rows = await db
    .select()
    .from(tariffSnapshotsTable)
    .where(
      and(
        eq(tariffSnapshotsTable.routeId, route.id),
        gte(tariffSnapshotsTable.capturedAt, since),
      ),
    )
    .orderBy(asc(tariffSnapshotsTable.capturedAt));

  const lastHistoryAt = rows.length
    ? rows[rows.length - 1]!.capturedAt instanceof Date
      ? (rows[rows.length - 1]!.capturedAt as Date)
      : new Date(rows[rows.length - 1]!.capturedAt as unknown as string)
    : new Date();
  const forecastFrom = new Date(lastHistoryAt.getTime() + SNAPSHOT_SLOT_MS);
  const forecastFromAligned = nextSlotStart(
    new Date(forecastFrom.getTime() - 1),
  );

  // Fetch weather for all forecast steps in one cache hit
  const stepMs = SNAPSHOT_INTERVAL_MIN * 60 * 1000;
  const totalSteps = Math.ceil((forecastHours * 60) / SNAPSHOT_INTERVAL_MIN);
  const weatherByStep = await getWeatherRange(
    forecastFromAligned,
    totalSteps,
    stepMs,
  ).catch(() => undefined);

  const fc = forecastSurge(
    forecastFromAligned,
    route.id,
    route.volatility,
    forecastHours,
    SNAPSHOT_INTERVAL_MIN,
    weatherByStep,
  );

  // buildRouteSnapshot is now async — await each step sequentially
  // (weather already pre-fetched in weatherByStep, so each call is CPU-only)
  const forecastSnaps: Array<{
    capturedAt: string;
    classId: string;
    className: string;
    priceMin: number;
    priceMax: number;
    surgeMultiplier: number;
    surgeDriver: string;
    eventName: string | null;
    weatherContrib: number;
  }> = [];

  for (const point of fc) {
    const snaps = await buildRouteSnapshot(route, point.at);
    for (const snap of snaps) {
      forecastSnaps.push({
        capturedAt: point.at.toISOString(),
        classId: snap.classId,
        className: snap.className,
        priceMin: snap.priceMin,
        priceMax: snap.priceMax,
        surgeMultiplier: snap.surgeMultiplier,
        surgeDriver: snap.surgeDriver,
        eventName: point.eventName,
        weatherContrib: Math.round(point.weatherContrib * 100) / 100,
      });
    }
  }

  res.json({
    routeId: route.id,
    pickupLabel: route.pickupLabel,
    dropoffLabel: route.dropoffLabel,
    volatility: route.volatility,
    sinceHours,
    forecastHours,
    classes: cityClasses,
    history: rows.map((r) => ({
      capturedAt:
        r.capturedAt instanceof Date
          ? r.capturedAt.toISOString()
          : new Date(r.capturedAt).toISOString(),
      classId: r.classId,
      className: r.className,
      priceMin: r.priceMin,
      priceMax: r.priceMax,
      surgeMultiplier: r.surgeMultiplier,
      source: r.source === "live" ? "live" : "model",
    })),
    forecast: forecastSnaps,
  });
});

// ─── Demand forecast ──────────────────────────────────────────────────────────
/**
 * GET /api/tariff-grid/demand-forecast
 *
 * Возвращает почасовой прогноз спроса на следующие `hours` часов (до 72).
 * Для каждого часа рассчитывается:
 *   - базовый time-of-day спрос (из surge-модели)
 *   - поправка на погоду (дождь/снег/мороз)
 *   - событийный мультипликатор (праздники, матчи, концерты)
 *   - итоговый уровень: "green" / "yellow" / "red"
 */
router.get("/tariff-grid/demand-forecast", async (req, res): Promise<void> => {
  const raw = req.query["hours"];
  const hours = Math.min(72, Math.max(1, Number(raw) || 24));
  const stepMs = 60 * 60 * 1000; // 1 hour
  const now = new Date();
  // Snap to the current hour boundary
  const startAt = new Date(now);
  startAt.setUTCMinutes(0, 0, 0);

  const totalSteps = hours;
  const weatherRange = await getWeatherRange(startAt, totalSteps, stepMs).catch(
    () => Array.from({ length: totalSteps }, () => ({ isRain: false, isSnow: false, tempC: 15, weatherCode: 0 })),
  );

  // Use a representative "average" route for demand signal (Минск, пл.Победы → Уручье)
  const refRoute = MINSK_ROUTES[0]!;

  const forecast = weatherRange.map((wx, i) => {
    const at = new Date(startAt.getTime() + i * stepMs);
    const surge = computeSurge(at, refRoute.id, refRoute.volatility, wx);

    // Normalise multiplier → demand level
    let demandLevel: "green" | "yellow" | "red";
    if (surge.multiplier >= 1.5) demandLevel = "red";
    else if (surge.multiplier >= 1.2) demandLevel = "yellow";
    else demandLevel = "green";

    const activeEvents = getActiveEvents(at);
    const eventMult = getEventSurgeMult(at);

    // Minsk wall-clock hour (UTC+3)
    const minskHour = (at.getUTCHours() + 3) % 24;

    return {
      at: at.toISOString(),
      minskHour,
      surgeMultiplier: Math.round(surge.multiplier * 100) / 100,
      demandLevel,
      driver: surge.driver,
      weather: {
        isRain: wx.isRain,
        isSnow: wx.isSnow,
        tempC: Math.round(wx.tempC * 10) / 10,
        weatherCode: wx.weatherCode,
        contrib: Math.round(surge.weather * 100) / 100,
      },
      events: {
        active: activeEvents.map((e) => ({ name: e.name, kind: e.kind, surge: e.surge })),
        mult: Math.round(eventMult * 100) / 100,
      },
    };
  });

  res.json({
    generatedAt: now.toISOString(),
    hours,
    forecast,
  });
});

// ─── Events list ──────────────────────────────────────────────────────────────
/**
 * GET /api/tariff-grid/events
 *
 * Возвращает список городских событий Минска в заданном диапазоне.
 * ?from=ISO&to=ISO  (по умолчанию — сейчас + 30 дней)
 */
router.get("/tariff-grid/events", (_req, res): void => {
  const now = new Date();
  const from = now;
  const to = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const events = listEvents(from, to);
  res.json({
    generatedAt: now.toISOString(),
    from: from.toISOString(),
    to: to.toISOString(),
    events,
  });
});

export default router;
