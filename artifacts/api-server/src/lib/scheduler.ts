import { db, tariffSnapshotsTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { MINSK_ROUTES } from "./minsk-routes";
import { captureRouteSnapshot } from "./snapshot";
import { slotStart, SNAPSHOT_SLOT_MS } from "./slots";
import { logger } from "./logger";

/** Keep at most 7 days of snapshots in the table. */
const RETENTION_DAYS = 7;

/**
 * Stagger live Yandex requests to avoid bursting 20 calls at once which
 * would look like a bot. Spread across ~30s.
 */
const PER_ROUTE_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function captureAllRoutes(now: Date): Promise<{
  inserted: number;
  liveCount: number;
  modelCount: number;
}> {
  const slot = slotStart(now);

  // Capture each route sequentially with a small delay between calls so the
  // request rate to taxi.yandex.ru stays well under any reasonable
  // anti-abuse threshold.
  const allSnaps: Awaited<ReturnType<typeof captureRouteSnapshot>> = [];
  for (let i = 0; i < MINSK_ROUTES.length; i++) {
    const route = MINSK_ROUTES[i]!;
    try {
      const snaps = await captureRouteSnapshot(route, slot);
      allSnaps.push(...snaps);
    } catch (err) {
      logger.error(
        { err, routeId: route.id },
        "Capture for a single route threw — skipping",
      );
    }
    if (i < MINSK_ROUTES.length - 1) await sleep(PER_ROUTE_DELAY_MS);
  }

  const liveCount = allSnaps.filter((s) => s.source === "live").length;
  const modelCount = allSnaps.length - liveCount;

  if (allSnaps.length === 0) {
    return { inserted: 0, liveCount: 0, modelCount: 0 };
  }

  // DB-enforced idempotency via the unique (route_id, class_id, captured_at)
  // index. Concurrent schedulers / restart-spam are safe: duplicate rows are
  // silently dropped instead of producing duplicates or constraint errors.
  const inserted = await db
    .insert(tariffSnapshotsTable)
    .values(
      allSnaps.map((snap) => ({
        routeId: snap.routeId,
        capturedAt: snap.capturedAt,
        classId: snap.classId,
        className: snap.className,
        priceMin: snap.priceMin,
        priceMax: snap.priceMax,
        surgeMultiplier: snap.surgeMultiplier,
        distanceKm: snap.distanceKm,
        durationMin: snap.durationMin,
        currency: snap.currency,
        source: snap.source,
      })),
    )
    .onConflictDoNothing({
      target: [
        tariffSnapshotsTable.routeId,
        tariffSnapshotsTable.classId,
        tariffSnapshotsTable.capturedAt,
      ],
    })
    .returning({ id: tariffSnapshotsTable.id });

  logger.info(
    {
      slot: slot.toISOString(),
      attempted: allSnaps.length,
      inserted: inserted.length,
      liveCount,
      modelCount,
      routes: MINSK_ROUTES.length,
    },
    inserted.length === 0
      ? "Tariff snapshot slot already filled (no-op)"
      : "Tariff snapshot written",
  );
  return { inserted: inserted.length, liveCount, modelCount };
}

async function purgeOld(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await db
    .delete(tariffSnapshotsTable)
    .where(lt(tariffSnapshotsTable.capturedAt, cutoff));
}

let timer: NodeJS.Timeout | null = null;

export function startSnapshotScheduler(): void {
  if (timer) return;

  // Take the first snapshot immediately (idempotent against the current slot
  // so restart-spam is safe), then align the interval. The first capture
  // can take ~30s due to the per-route delay.
  void captureAllRoutes(new Date()).catch((err) => {
    logger.error({ err }, "Initial tariff snapshot failed");
  });

  // Schedule the next tick at the next slot boundary, then run every slot.
  const now = Date.now();
  const nextSlot = Math.ceil(now / SNAPSHOT_SLOT_MS) * SNAPSHOT_SLOT_MS;
  const initialDelay = Math.max(1000, nextSlot - now);

  setTimeout(() => {
    void captureAllRoutes(new Date()).catch((err) => {
      logger.error({ err }, "Tariff snapshot failed");
    });
    void purgeOld().catch((err) => {
      logger.error({ err }, "Snapshot retention purge failed");
    });
    timer = setInterval(() => {
      void captureAllRoutes(new Date()).catch((err) => {
        logger.error({ err }, "Tariff snapshot failed");
      });
      void purgeOld().catch((err) => {
        logger.error({ err }, "Snapshot retention purge failed");
      });
    }, SNAPSHOT_SLOT_MS);
  }, initialDelay);

  logger.info(
    {
      intervalMs: SNAPSHOT_SLOT_MS,
      intervalMinutes: SNAPSHOT_SLOT_MS / 60_000,
      firstAlignedSlotInMs: initialDelay,
    },
    "Snapshot scheduler started",
  );
}

export function stopSnapshotScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
