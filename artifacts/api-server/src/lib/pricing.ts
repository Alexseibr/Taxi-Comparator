import { PROVIDERS, type Provider } from "./providers";
import { findYandexCityForCoord, type CityProviderTariff } from "./cities";
import { computeSurge } from "./surge-model";
import type { WeatherContext } from "./weather-client";

const EARTH_RADIUS_KM = 6371;

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface Place {
  label: string;
  coordinate: Coordinate;
}

export interface ClassEstimate {
  classId: string;
  className: string;
  classDescription: string;
  priceMin: number;
  priceMax: number;
  etaMin: number;
  currency: string;
  live?: boolean;
}

export interface ProviderEstimate {
  providerId: string;
  providerName: string;
  providerColor: string;
  currency: string;
  surgeMultiplier: number;
  cheapest: ClassEstimate;
  classes: ClassEstimate[];
}

export interface EstimateResult {
  distanceKm: number;
  durationMin: number;
  currency: string;
  bestProviderId: string;
  savingsVsMostExpensive: number;
  results: ProviderEstimate[];
  generatedAt: string;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function haversineKm(a: Coordinate, b: Coordinate): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// Realistic city driving multiplier on top of straight-line haversine distance.
const ROUTE_FACTOR = 1.32;

export function estimateRoadDistanceKm(a: Coordinate, b: Coordinate): number {
  return Math.max(0.3, haversineKm(a, b) * ROUTE_FACTOR);
}

// Average city speed including stops/lights, in km/h.
const AVG_SPEED_KMH = 40;

export function estimateDurationMin(distanceKm: number): number {
  return Math.max(2, (distanceKm / AVG_SPEED_KMH) * 60);
}

// Deterministic-but-varied per-provider surge so multiple comparisons of the
// same trip are stable, but different providers feel like they have different
// real-time conditions.
function deterministicSurge(seedKey: string, hint: number): number {
  let hash = 0;
  for (let i = 0; i < seedKey.length; i++) {
    hash = (hash * 31 + seedKey.charCodeAt(i)) >>> 0;
  }
  // 0..1
  const normalized = (hash % 1000) / 1000;
  const localSurge = 1 + normalized * 0.25; // up to +25% local condition
  return Math.round(localSurge * hint * 100) / 100;
}

function roundPrice(value: number): number {
  return Math.round(value);
}

function priceForClass(
  provider: Provider,
  distanceKm: number,
  durationMin: number,
  surge: number,
  multiplier: number,
): { priceMin: number; priceMax: number } {
  const subtotal =
    provider.baseFare +
    provider.perKm * distanceKm +
    provider.perMinute * durationMin;
  const totalAtClass = (subtotal * multiplier + provider.serviceFee) * surge;
  const minimum = provider.minimumFare * multiplier;
  const center = Math.max(totalAtClass, minimum);
  // Estimates are returned as a band — providers always quote ranges.
  const spread = Math.max(40, center * 0.08);
  return {
    priceMin: roundPrice(center - spread / 2),
    priceMax: roundPrice(center + spread / 2),
  };
}

export interface EstimateInput {
  pickup: Place;
  dropoff: Place;
  passengers?: number;
  surgeHint?: number;
}

function roundTo(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function buildYandexCityEstimate(
  city: CityProviderTariff,
  distanceKm: number,
  durationMin: number,
  surge: number,
  passengers: number,
): ProviderEstimate | null {
  const yandex = PROVIDERS.find((p) => p.id === "yandex")!;
  const eligible = city.classes.filter((c) => c.capacity >= passengers);
  if (eligible.length === 0) return null;

  const classes: ClassEstimate[] = eligible.map((cls) => {
    // Tiered per-km: the first `longDistanceThresholdKm` km are billed at
    // `perKm`; anything beyond is billed at the higher `longDistancePerKm`.
    // Falls back to flat `perKm` if no tier is configured.
    const threshold = cls.longDistanceThresholdKm ?? Infinity;
    const longRate = cls.longDistancePerKm ?? cls.perKm;
    const baseKm = Math.min(distanceKm, threshold);
    const longKm = Math.max(distanceKm - threshold, 0);
    const distanceCost = cls.perKm * baseKm + longRate * longKm;
    const subtotal = cls.pickupCost + distanceCost + cls.perMin * durationMin;
    const total = Math.max(cls.minimumFare, subtotal) * surge;
    const spread = Math.max(0.5, total * 0.08);
    return {
      classId: cls.id,
      className: cls.name,
      classDescription: cls.description,
      priceMin: roundTo(total - spread / 2, 1),
      priceMax: roundTo(total + spread / 2, 1),
      etaMin: cls.bookingEtaMin,
      currency: city.currency,
    };
  });

  const cheapest = classes.reduce((acc, cur) =>
    cur.priceMin < acc.priceMin ? cur : acc,
  );

  return {
    providerId: yandex.id,
    providerName: yandex.name,
    providerColor: yandex.color,
    currency: city.currency,
    surgeMultiplier: surge,
    cheapest,
    classes,
  };
}

export function buildEstimate(input: EstimateInput, wx?: WeatherContext): EstimateResult {
  const distanceKm =
    Math.round(
      estimateRoadDistanceKm(input.pickup.coordinate, input.dropoff.coordinate) *
        10,
    ) / 10;
  const durationMin = Math.round(estimateDurationMin(distanceKm));

  // If a live surge hint was passed (e.g. scraped from Yandex), honour it.
  // Otherwise derive from the time-of-day + weather + events model so the
  // estimate reflects current real-world conditions even without live data.
  const surgeHint =
    input.surgeHint ??
    computeSurge(new Date(), `${input.pickup.coordinate.lat.toFixed(2)},${input.pickup.coordinate.lng.toFixed(2)}`, 0.7, wx).multiplier;

  const seedBase =
    `${input.pickup.coordinate.lat.toFixed(2)},${input.pickup.coordinate.lng.toFixed(2)}->${input.dropoff.coordinate.lat.toFixed(2)},${input.dropoff.coordinate.lng.toFixed(2)}`;

  const passengers = Math.max(1, Math.min(6, input.passengers ?? 1));

  // City-specific override: when pickup is in Minsk, return only Yandex Go
  // with the proper structured Belarusian-ruble tariff (other providers do
  // not effectively operate in Minsk).
  const yandexCity = findYandexCityForCoord(input.pickup.coordinate);
  if (yandexCity) {
    const surge = deterministicSurge(`yandex|${seedBase}`, surgeHint);
    const onlyYandex = buildYandexCityEstimate(
      yandexCity,
      distanceKm,
      durationMin,
      surge,
      passengers,
    );
    const results = onlyYandex ? [onlyYandex] : [];
    return {
      distanceKm,
      durationMin,
      currency: yandexCity.currency,
      bestProviderId: results[0]?.providerId ?? "",
      savingsVsMostExpensive: 0,
      results,
      generatedAt: new Date().toISOString(),
    };
  }

  const results: ProviderEstimate[] = PROVIDERS.flatMap((provider) => {
    const surge = deterministicSurge(`${provider.id}|${seedBase}`, surgeHint);

    const eligibleClasses = provider.classes.filter(
      (cls) => cls.capacity >= passengers,
    );
    if (eligibleClasses.length === 0) return [];

    const classes: ClassEstimate[] = eligibleClasses.map((cls) => {
      const { priceMin, priceMax } = priceForClass(
        provider,
        distanceKm,
        durationMin,
        surge,
        cls.multiplier,
      );
      const etaMin =
        provider.bookingEtaMin +
        Math.round(
          (provider.bookingEtaMax - provider.bookingEtaMin) *
            ((cls.multiplier - 1) / 1),
        );
      return {
        classId: cls.id,
        className: cls.name,
        classDescription: cls.description,
        priceMin,
        priceMax,
        etaMin: Math.max(provider.bookingEtaMin, Math.min(provider.bookingEtaMax, etaMin)),
        currency: provider.currency,
      };
    });

    const cheapest = classes.reduce((acc, cur) =>
      cur.priceMin < acc.priceMin ? cur : acc,
    );

    return [
      {
        providerId: provider.id,
        providerName: provider.name,
        providerColor: provider.color,
        currency: provider.currency,
        surgeMultiplier: surge,
        cheapest,
        classes,
      },
    ];
  }).sort((a, b) => a.cheapest.priceMin - b.cheapest.priceMin);

  const bestProviderId = results[0]?.providerId ?? "";
  const cheapestPrice = results[0]?.cheapest.priceMin ?? 0;
  const mostExpensive = results.reduce(
    (acc, cur) => (cur.cheapest.priceMin > acc ? cur.cheapest.priceMin : acc),
    cheapestPrice,
  );

  return {
    distanceKm,
    durationMin,
    currency: PROVIDERS[0]!.currency,
    bestProviderId,
    savingsVsMostExpensive: Math.max(0, mostExpensive - cheapestPrice),
    results,
    generatedAt: new Date().toISOString(),
  };
}
