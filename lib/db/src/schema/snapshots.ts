import {
  pgTable,
  text,
  serial,
  doublePrecision,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const tariffSnapshotsTable = pgTable(
  "tariff_snapshots",
  {
    id: serial("id").primaryKey(),
    routeId: text("route_id").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    classId: text("class_id").notNull(),
    className: text("class_name").notNull(),
    priceMin: doublePrecision("price_min").notNull(),
    priceMax: doublePrecision("price_max").notNull(),
    surgeMultiplier: doublePrecision("surge_multiplier").notNull(),
    distanceKm: doublePrecision("distance_km").notNull(),
    durationMin: doublePrecision("duration_min").notNull(),
    currency: text("currency").notNull(),
    /**
     * Where the snapshot came from:
     *  - "live"  — real prices fetched from taxi.yandex.ru/3.0/routestats
     *  - "model" — synthetic prices computed from the local surge model
     *              (used as fallback when the live fetch fails or is rate-limited)
     */
    source: text("source").notNull().default("model"),
  },
  (t) => ({
    byRouteCapturedAt: index("tariff_snapshots_route_captured_idx").on(
      t.routeId,
      t.capturedAt,
    ),
    byCapturedAt: index("tariff_snapshots_captured_at_idx").on(t.capturedAt),
    // Database-enforced idempotency: at most one row per (route, class, slot).
    // This is the single source of truth — the scheduler relies on
    // INSERT ... ON CONFLICT DO NOTHING against this constraint to be safe
    // against concurrent runs and process restarts.
    uniqRouteClassSlot: uniqueIndex("tariff_snapshots_unique_slot_idx").on(
      t.routeId,
      t.classId,
      t.capturedAt,
    ),
  }),
);

export type TariffSnapshot = typeof tariffSnapshotsTable.$inferSelect;
export type InsertTariffSnapshot = typeof tariffSnapshotsTable.$inferInsert;
