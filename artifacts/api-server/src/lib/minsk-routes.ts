import type { Coordinate } from "./pricing";

export interface MinskRoute {
  id: string;
  pickupLabel: string;
  dropoffLabel: string;
  pickup: Coordinate;
  dropoff: Coordinate;
  /**
   * Volatility 0..1 — how much the route reacts to surge. Airport / nightlife
   * routes spike harder than residential→residential commutes.
   */
  volatility: number;
}

// Hand-curated 20 popular Minsk routes. Coordinates are approximate but
// sufficient for our straight-line distance + 1.35 detour factor that
// estimateRoadDistanceKm uses.
export const MINSK_ROUTES: MinskRoute[] = [
  {
    id: "pobedy-uruchcha",
    pickupLabel: "Площадь Победы",
    dropoffLabel: "Уручье",
    pickup: { lat: 53.9026, lng: 27.5750 },
    dropoff: { lat: 53.9433, lng: 27.6766 },
    volatility: 0.35,
  },
  {
    id: "vokzal-malinovka",
    pickupLabel: "Ж/д вокзал",
    dropoffLabel: "Малиновка",
    pickup: { lat: 53.8911, lng: 27.5503 },
    dropoff: { lat: 53.8483, lng: 27.4709 },
    volatility: 0.55,
  },
  {
    id: "centr-aeroport",
    pickupLabel: "Площадь Независимости",
    dropoffLabel: "Аэропорт (восточная окраина)",
    // Airport is outside city bbox; we approximate the pickup-side endpoint
    // inside the bbox so the snapshot stays in the Minsk tariff. The
    // dropoff is still rendered to the user as the airport.
    pickup: { lat: 53.8939, lng: 27.5481 },
    dropoff: { lat: 53.8825, lng: 27.8400 },
    volatility: 0.85,
  },
  {
    id: "kgorka-chizhovka",
    pickupLabel: "Каменная Горка",
    dropoffLabel: "Чижовка",
    pickup: { lat: 53.9166, lng: 27.4373 },
    dropoff: { lat: 53.8642, lng: 27.6280 },
    volatility: 0.45,
  },
  {
    id: "nemiga-zamok",
    pickupLabel: "Немига",
    dropoffLabel: "ТЦ Замок",
    pickup: { lat: 53.9038, lng: 27.5489 },
    dropoff: { lat: 53.9277, lng: 27.4636 },
    volatility: 0.5,
  },
  {
    id: "borovaya-serebryanka",
    pickupLabel: "Боровая",
    dropoffLabel: "Серебрянка",
    pickup: { lat: 53.9417, lng: 27.6883 },
    dropoff: { lat: 53.8744, lng: 27.6020 },
    volatility: 0.4,
  },
  {
    id: "suharevo-kuncevshina",
    pickupLabel: "Сухарево",
    dropoffLabel: "Кунцевщина",
    pickup: { lat: 53.8861, lng: 27.4400 },
    dropoff: { lat: 53.8900, lng: 27.4500 },
    volatility: 0.3,
  },
  {
    id: "drazhnya-vostok",
    pickupLabel: "Дражня",
    dropoffLabel: "Восток",
    pickup: { lat: 53.9142, lng: 27.6500 },
    dropoff: { lat: 53.9233, lng: 27.6500 },
    volatility: 0.35,
  },
  {
    id: "angarskaya-kurasovshina",
    pickupLabel: "Ангарская",
    dropoffLabel: "Курасовщина",
    pickup: { lat: 53.8716, lng: 27.6500 },
    dropoff: { lat: 53.8420, lng: 27.5180 },
    volatility: 0.4,
  },
  {
    id: "dom-pechati-botsad",
    pickupLabel: "Дом печати",
    dropoffLabel: "Ботанический сад",
    pickup: { lat: 53.9272, lng: 27.5494 },
    dropoff: { lat: 53.9070, lng: 27.5800 },
    volatility: 0.45,
  },
  {
    id: "kolas-pobedy-park",
    pickupLabel: "Площадь Якуба Коласа",
    dropoffLabel: "Парк Победы",
    pickup: { lat: 53.9180, lng: 27.5839 },
    dropoff: { lat: 53.9263, lng: 27.5374 },
    volatility: 0.5,
  },
  {
    id: "arena-loshica",
    pickupLabel: "Минск Арена",
    dropoffLabel: "Лошица",
    pickup: { lat: 53.9241, lng: 27.4824 },
    dropoff: { lat: 53.8395, lng: 27.5867 },
    volatility: 0.6,
  },
  {
    id: "zlug-uruchcha",
    pickupLabel: "Зелёный Луг",
    dropoffLabel: "Уручье",
    pickup: { lat: 53.9550, lng: 27.6010 },
    dropoff: { lat: 53.9433, lng: 27.6766 },
    volatility: 0.3,
  },
  {
    id: "grushevka-serebryanka",
    pickupLabel: "Грушевка",
    dropoffLabel: "Серебрянка",
    pickup: { lat: 53.8806, lng: 27.5180 },
    dropoff: { lat: 53.8744, lng: 27.6020 },
    volatility: 0.4,
  },
  {
    id: "galleria-korona",
    pickupLabel: "ТЦ Galleria",
    dropoffLabel: "ТЦ Корона",
    pickup: { lat: 53.9081, lng: 27.5550 },
    dropoff: { lat: 53.9180, lng: 27.4500 },
    volatility: 0.5,
  },
  {
    id: "centr-vokzal",
    pickupLabel: "Площадь Победы",
    dropoffLabel: "Ж/д вокзал",
    pickup: { lat: 53.9026, lng: 27.5750 },
    dropoff: { lat: 53.8911, lng: 27.5503 },
    volatility: 0.65,
  },
  {
    id: "zapad-vostok",
    pickupLabel: "Запад (Притыцкого)",
    dropoffLabel: "Восток",
    pickup: { lat: 53.9050, lng: 27.4500 },
    dropoff: { lat: 53.9233, lng: 27.6500 },
    volatility: 0.5,
  },
  {
    id: "kalvarya-kurasovshina",
    pickupLabel: "Кальварийская",
    dropoffLabel: "Курасовщина",
    pickup: { lat: 53.9100, lng: 27.5290 },
    dropoff: { lat: 53.8420, lng: 27.5180 },
    volatility: 0.45,
  },
  {
    id: "mayak-malinovka",
    pickupLabel: "Маяк Минска",
    dropoffLabel: "Малиновка",
    pickup: { lat: 53.9100, lng: 27.5950 },
    dropoff: { lat: 53.8483, lng: 27.4709 },
    volatility: 0.5,
  },
  {
    id: "prytyckaha-vostok",
    pickupLabel: "Притыцкого",
    dropoffLabel: "Восток",
    pickup: { lat: 53.9080, lng: 27.4400 },
    dropoff: { lat: 53.9233, lng: 27.6500 },
    volatility: 0.6,
  },
];
