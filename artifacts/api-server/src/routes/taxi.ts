import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, comparisonsTable } from "@workspace/db";
import {
  EstimateTripBody,
  EstimateTripResponse,
  ListProvidersResponse,
  ListPopularRoutesResponse,
  ListRecentComparisonsResponse,
} from "@workspace/api-zod";
import { PROVIDERS } from "../lib/providers";
import { buildEstimate } from "../lib/pricing";
import { getPopularRoutes } from "../lib/popular-routes";
import { getWeatherAt } from "../lib/weather-client";

const router: IRouter = Router();

router.get("/taxi/providers", (_req, res) => {
  const payload = ListProvidersResponse.parse({ providers: PROVIDERS });
  res.json(payload);
});

router.get("/taxi/popular-routes", (_req, res) => {
  const payload = ListPopularRoutesResponse.parse({ routes: getPopularRoutes() });
  res.json(payload);
});

router.get("/taxi/recent-comparisons", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(comparisonsTable)
    .orderBy(desc(comparisonsTable.createdAt))
    .limit(8);

  const payload = ListRecentComparisonsResponse.parse({
    comparisons: rows.map((r) => ({
      id: String(r.id),
      pickupLabel: r.pickupLabel,
      dropoffLabel: r.dropoffLabel,
      distanceKm: r.distanceKm,
      bestProviderName: r.bestProviderName,
      bestPrice: r.bestPrice,
      currency: r.currency,
      createdAt: r.createdAt.toISOString(),
    })),
  });
  res.json(payload);
});

router.post("/taxi/estimate", async (req, res): Promise<void> => {
  const parsed = EstimateTripBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid estimate request");
    res.status(400).json({ error: "Invalid request", details: parsed.error.message });
    return;
  }

  // Fetch current weather from Open-Meteo (cached in memory, 15-min TTL)
  // so the surge hint reflects real-time conditions (rain/snow/temp).
  const wx = await getWeatherAt(new Date()).catch(() => undefined);

  const result = buildEstimate(parsed.data, wx);

  const top = result.results[0];
  if (top) {
    try {
      await db.insert(comparisonsTable).values({
        pickupLabel: parsed.data.pickup.label,
        dropoffLabel: parsed.data.dropoff.label,
        distanceKm: result.distanceKm,
        durationMin: result.durationMin,
        bestProviderId: top.providerId,
        bestProviderName: top.providerName,
        bestPrice: top.cheapest.priceMin,
        currency: top.currency,
      });
    } catch (err) {
      req.log.error({ err }, "Failed to store recent comparison");
    }
  }

  res.json(EstimateTripResponse.parse(result));
});

export default router;
