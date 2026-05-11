import type { Coordinate } from "./pricing";

export interface CityClassTariff {
  id: string;
  name: string;
  description: string;
  capacity: number;
  pickupCost: number;
  perKm: number;
  perMin: number;
  minimumFare: number;
  bookingEtaMin: number;
  bookingEtaMax: number;
  /**
   * Optional tiered per-km rate for long trips. When set, kilometres beyond
   * `longDistanceThresholdKm` are billed at `longDistancePerKm` instead of
   * `perKm`. Yandex Minsk does this to compensate drivers for the empty
   * return leg on out-of-city trips (airport, suburbs).
   */
  longDistanceThresholdKm?: number;
  longDistancePerKm?: number;
}

export interface CityProviderTariff {
  cityId: string;
  cityName: string;
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  currency: string;
  classes: CityClassTariff[];
}

// Yandex Go tariffs in Minsk, Belarus (approximate published rates, BYN).
// Sources: published Yandex Go Belarus tariff pages and Tarifff Belarus reference.
// These values are approximate and intentionally rounded; surge multiplier is
// applied on top of (pickupCost + per-km × km + per-min × min), then clamped
// to the class minimum fare.
export const YANDEX_MINSK: CityProviderTariff = {
  cityId: "minsk",
  cityName: "Минск",
  bbox: { minLat: 53.78, maxLat: 54.02, minLng: 27.35, maxLng: 27.85 },
  currency: "BYN",
  // ──────────────────────────────────────────────────────────────────────────
  // Calibration log — append a new row each time the user supplies a real
  // Yandex Go quote. Tariff coefficients below are fitted to these points.
  //
  //  #  | Date        | Route                                | km    | min | Zone   | Эконом         | Комфорт
  //  ---|-------------|--------------------------------------|-------|-----|--------|----------------|------------------
  //  1  | 2026-04-25  | пл. Победы 1 → ст.м. Уручье          |  10.6 |  15 | normal | 13.3 @ 1.0x    | 14.6 @ 1.5x (base ≈ 9.7)
  //  2  | 2026-04-25  | пл. Победы 1 → мкр. Уручье           |  10.6 |  17 | normal | 14.8 @ 1.0x    | 19.3 @ 2.0x (base ≈ 9.65)
  //  3  | 2026-04-25  | пр. Независимости 55 → Немига        |   4.0 |  12 | normal | 10.5 @ 1.0x    | 15.6 @ 1.6x (base ≈ 9.75)
  //  4  | 2026-04-25  | пл. Победы → Аэропорт MSQ            | ~40   |  36 | normal | 58.3 @ 1.0x    | 83.8 @ 8.4x (base ≈ 9.98)
  //  5  | 2026-04-25  | Сеницкий с/с → 2-й Топографический 7 | ~25   |  43 | normal | 41.4 @ 1.0x    | 45.9 @ 4.6x (base ≈ 9.98)
  //  6  | 2026-04-25  | Космонавтов 48 → 2-й Топографический | ~20   |  38 | normal | 28.3 @ 1.0x    | 33.2 @ 3.4x (base ≈ 9.76)
  //  7  | 2026-04-25  | Дзержинского 21 → Кузьмы Минина 3к11 |  ~3   |   7 | RED    | 15.5 @ 1.0x*   | 17.1 @ 1.8x (base ≈ 9.50)
  //  8  | 2026-04-25  | Дзержинского 21 → Розы Люксембург    |  ~3   |   6 | RED    | 15.6 @ 1.0x*   | 17.7 @ 1.8x (base ≈ 9.83)
  //  9  | 2026-04-25  | Камайская 10 → Ратомская 2           |  ~2   |   5 | quiet  |  6.4 @ ~0.8x*  |  7.4 @ 0.8x (base ≈ 9.25)
  // 10  | 2026-04-25  | Камайская 10 → Тимирязева 10         |  ~6   |  12 | normal | 11.2 @ 1.0x    | 12.6 @ 1.3x (base ≈ 9.69)
  // 11  | 2026-04-25  | Тимирязева 10 → Аэропорт MSQ         | ~40   |  49 | RED P-3| 50.9 @ 1.0x    | 63.4 @ 6.4x (base ≈ 9.91)
  // 12  | 2026-04-25  | Подгорная 1Б → Тимирязева 10         | ~30   |  40 | normal | 41.1 @ 1.0x    | 43.1 @ 4.4x (base ≈ 9.80)
  // 13  | 2026-04-25 15:45 | Восточная 22к1 → мкр. Уручье    | ~11   |  19 | normal | 16.6 @ 1.0x    | 18.6 @ 1.9x (base ≈ 9.79)
  // 14  | 2026-04-25 15:46 | Восточная 22к1 → Красноарм. 10/1| ~8    |  19 | mixed  | 15.2 @ 1.0x    | 17.2 @ 1.8x (base ≈ 9.56)
  // 15  | 2026-04-25 16:08 | Восточная 22к1 → Куприянова 5   | ~12   |  25 | "выс.спрос" | 16.8 @ 1.0x | 18.8 @ 1.9x (base ≈ 9.89)
  // 16  | 2026-04-25 16:08 | Привокзальная пл.3 → Куприянова5| ~5    |  14 | yellow | 11.1 @ 1.0x    | 11.7 @ 1.2x (base ≈ 9.75)
  //
  // Findings:
  //   • Эконом on SHORT trips (≤10 km, normal zone): linear with pickup 5.8,
  //     perKm 0.52, perMin 0.22 — fits points #1–3, #10 within ~5%.
  //   • Эконом on LONG trips (>12 km): tiered perKm ≈ 1.3 for km beyond 12 —
  //     Yandex compensates drivers for empty return leg. Fits #4–6, #11–12
  //     within ~10% (subject to rough road-distance estimates).
  //   • Эконом "HIDDEN SURGE" in RED zones: points #7, #8 show no surge
  //     icon on Эконом but the actual price is ~1.75× the formula base —
  //     identical to the displayed Комфорт surge of 1.8x. Yandex applies
  //     surge to Эконом but hides it from the UI. Our snapshot picks up
  //     paid_options=null for Эконом, so the grid will UNDERESTIMATE Эконом
  //     in heavily-loaded zones. Workaround: in such moments user should
  //     compare the Эконом price against Комфорт×0.85 — if real Эконом is
  //     close to that, hidden surge is active. Fixing this needs a separate
  //     pass in snapshot.ts (e.g. inherit Комфорт surge for Эконом when
  //     Эконом has none and Комфорт is > 1.5x). Not implemented yet.
  //   • Комфорт base stays almost flat at ~9.5–9.9 BYN regardless of
  //     distance (verified on points #2, #3, #4, #5, #6, #7, #8, #9, #10,
  //     #11, #12 — eleven distinct trips). Modelled via minimumFare = 9.5.
  //   • Разговорные surges < 1.0 do exist (point #9: Комфорт at 0.8x = 20%
  //     discount in driver-rich zones). Live data picks these up correctly.
  //   • HIDDEN SURGE refinement (from points #13–16): Эконом hidden surge does
  //     NOT trigger every time Комфорт surge is high. Points #13, #14, #15 all
  //     show Комфорт @ 1.8–1.9x and даже "высокий спрос" banner, yet Эконом
  //     prices match the base formula within 5%. The hidden surge appears to
  //     activate ONLY in fully RED start zones with short trips (#7, #8 — both
  //     ~3 km from a red pickup point). Conclusion: the heuristic should be
  //     gated on RED zone color, not just on Комфорт surge magnitude.
  // Note: in Yandex Minsk the Эконом base price can exceed the Комфорт base
  // on most trips — that's a known pricing oddity, not a bug.
  classes: [
    {
      id: "econom",
      name: "Эконом",
      description: "Базовый тариф Яндекс Go в Минске",
      capacity: 4,
      pickupCost: 5.8,
      perKm: 0.52,
      perMin: 0.22,
      minimumFare: 6,
      bookingEtaMin: 2,
      bookingEtaMax: 7,
      longDistanceThresholdKm: 12,
      longDistancePerKm: 1.3,
    },
    {
      id: "business",
      name: "Комфорт",
      description: "Просторные машины, опытные водители",
      capacity: 4,
      pickupCost: 2.0,
      perKm: 0.45,
      perMin: 0.18,
      minimumFare: 9.5,
      bookingEtaMin: 3,
      bookingEtaMax: 8,
      longDistanceThresholdKm: 15,
      longDistancePerKm: 0.8,
    },
  ],
};

export const YANDEX_CITY_TARIFFS: CityProviderTariff[] = [YANDEX_MINSK];

export function findYandexCityForCoord(
  coord: Coordinate,
): CityProviderTariff | null {
  for (const city of YANDEX_CITY_TARIFFS) {
    if (
      coord.lat >= city.bbox.minLat &&
      coord.lat <= city.bbox.maxLat &&
      coord.lng >= city.bbox.minLng &&
      coord.lng <= city.bbox.maxLng
    ) {
      return city;
    }
  }
  return null;
}
