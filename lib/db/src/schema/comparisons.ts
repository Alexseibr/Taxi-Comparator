import { pgTable, text, serial, doublePrecision, timestamp } from "drizzle-orm/pg-core";

export const comparisonsTable = pgTable("comparisons", {
  id: serial("id").primaryKey(),
  pickupLabel: text("pickup_label").notNull(),
  dropoffLabel: text("dropoff_label").notNull(),
  distanceKm: doublePrecision("distance_km").notNull(),
  durationMin: doublePrecision("duration_min").notNull(),
  bestProviderId: text("best_provider_id").notNull(),
  bestProviderName: text("best_provider_name").notNull(),
  bestPrice: doublePrecision("best_price").notNull(),
  currency: text("currency").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Comparison = typeof comparisonsTable.$inferSelect;
export type InsertComparison = typeof comparisonsTable.$inferInsert;
