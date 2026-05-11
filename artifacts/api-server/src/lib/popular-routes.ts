import { estimateRoadDistanceKm } from "./pricing";

export interface PopularRouteSeed {
  id: string;
  label: string;
  pickup: { label: string; coordinate: { lat: number; lng: number } };
  dropoff: { label: string; coordinate: { lat: number; lng: number } };
}

const SEED: PopularRouteSeed[] = [
  {
    id: "msk-shr-center",
    label: "Шереметьево → Центр Москвы",
    pickup: {
      label: "Аэропорт Шереметьево, Москва",
      coordinate: { lat: 55.9726, lng: 37.4146 },
    },
    dropoff: {
      label: "Красная площадь, Москва",
      coordinate: { lat: 55.7539, lng: 37.6208 },
    },
  },
  {
    id: "msk-vko-center",
    label: "Внуково → Центр Москвы",
    pickup: {
      label: "Аэропорт Внуково, Москва",
      coordinate: { lat: 55.6042, lng: 37.2864 },
    },
    dropoff: {
      label: "Тверская улица, Москва",
      coordinate: { lat: 55.7639, lng: 37.6058 },
    },
  },
  {
    id: "spb-led-center",
    label: "Пулково → Центр Санкт-Петербурга",
    pickup: {
      label: "Аэропорт Пулково, Санкт-Петербург",
      coordinate: { lat: 59.8003, lng: 30.2625 },
    },
    dropoff: {
      label: "Невский проспект, Санкт-Петербург",
      coordinate: { lat: 59.9343, lng: 30.3351 },
    },
  },
  {
    id: "msk-business",
    label: "Москва-Сити → Парк Горького",
    pickup: {
      label: "Москва-Сити, Москва",
      coordinate: { lat: 55.7494, lng: 37.5378 },
    },
    dropoff: {
      label: "Парк Горького, Москва",
      coordinate: { lat: 55.7298, lng: 37.6017 },
    },
  },
];

export function getPopularRoutes() {
  return SEED.map((r) => ({
    ...r,
    distanceKm:
      Math.round(
        estimateRoadDistanceKm(r.pickup.coordinate, r.dropoff.coordinate) * 10,
      ) / 10,
  }));
}
