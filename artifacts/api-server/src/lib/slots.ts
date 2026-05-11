/**
 * Snapshot slot helpers shared between the scheduler (which writes
 * snapshots aligned to slot boundaries) and the history endpoint (which must
 * align its forecast to the same boundaries so observed and forecast series
 * meet exactly at "now").
 *
 * The slot is 20 min. At this cadence we keep the request rate
 * to taxi.yandex.ru low (20 routes × ~10 req/day) which is necessary to
 * avoid IP throttling, while still capturing surge changes throughout the day.
 */
export const SNAPSHOT_SLOT_MS = 20 * 60 * 1000;

/** Floor a Date to the start of its current snapshot slot, in UTC. */
export function slotStart(date: Date): Date {
  return new Date(Math.floor(date.getTime() / SNAPSHOT_SLOT_MS) * SNAPSHOT_SLOT_MS);
}

/** Ceil a Date to the start of the *next* snapshot slot, in UTC. */
export function nextSlotStart(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / SNAPSHOT_SLOT_MS) * SNAPSHOT_SLOT_MS);
}
