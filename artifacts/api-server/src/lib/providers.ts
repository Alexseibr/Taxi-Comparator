export interface TariffClass {
  id: string;
  name: string;
  description: string;
  multiplier: number;
  capacity: number;
}

export interface Provider {
  id: string;
  name: string;
  color: string;
  currency: string;
  baseFare: number;
  perKm: number;
  perMinute: number;
  minimumFare: number;
  serviceFee: number;
  bookingEtaMin: number;
  bookingEtaMax: number;
  classes: TariffClass[];
}

const standardClasses: TariffClass[] = [
  {
    id: "economy",
    name: "Эконом",
    description: "Базовый тариф — стандартные машины, оптимальная цена",
    multiplier: 1,
    capacity: 4,
  },
  {
    id: "comfort",
    name: "Комфорт",
    description: "Просторные машины, водители с опытом, доп. удобства",
    multiplier: 1.35,
    capacity: 4,
  },
  {
    id: "business",
    name: "Бизнес",
    description: "Премиальные авто бизнес-класса, повышенный сервис",
    multiplier: 1.95,
    capacity: 4,
  },
  {
    id: "minivan",
    name: "Минивэн",
    description: "Большие машины для компаний и больших групп — до 6 пассажиров",
    multiplier: 1.7,
    capacity: 6,
  },
];

export const PROVIDERS: Provider[] = [
  {
    id: "yandex",
    name: "Яндекс Go",
    color: "#FFCC00",
    currency: "BYN",
    baseFare: 2.7,
    perKm: 0.65,
    perMinute: 0.2,
    minimumFare: 5,
    serviceFee: 0,
    bookingEtaMin: 2,
    bookingEtaMax: 7,
    classes: standardClasses,
  },
];
