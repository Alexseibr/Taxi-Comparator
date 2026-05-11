// Семантические ярлыки H3-ячеек Минска: тип района (bar / center / office /
// sleeping / industrial / mall / transport) + узнаваемое имя.
//
// Зачем:
//   1. Читаемый вывод в compare-predict / loo.json: вместо безымянного
//      хеша "871f4ea86ffffff" пишем "Юго-Восток / промзона (industrial)".
//   2. Cold-start prior (TODO): когда в ячейке n=0, не знаем mu, но знаем
//      тип района → можно подставить медиану mu по аналогичным типам.
//   3. Группировки в дашбордах и driver-heatmap.
//
// База — известные ориентиры Минска. Каждый кластер: центр (lat,lng) + радиус.
// Если центр H3-ячейки попадает в радиус → ячейка получает tag.
//
// Порядок в списке важен: точечные/конкретные кластеры идут ПЕРВЫМИ, потом
// большие районы. Возвращается ПЕРВОЕ совпадение.
//
// Координаты — общедоступные ориентиры WGS84. Список расширяется итеративно
// по мере появления новых замеров в новых районах.

import { cellToLatLng } from "h3-js";

const R_EARTH = 6371;
function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

// type: bar | center | office | sleeping | industrial | mall | transport | suburb
export const ZONE_TAGS = [
  // === Точечные кластеры (приоритет, малые радиусы) ========================

  // Bar / nightlife
  { name: "Немига / Раковская / Зыбицкая", type: "bar",       lat: 53.9050, lng: 27.5535, r_km: 0.4 },
  { name: "Октябрьская / Зыбицкая",        type: "bar",       lat: 53.9000, lng: 27.5650, r_km: 0.4 },

  // Transport
  { name: "ЖД вокзал",                     type: "transport", lat: 53.8920, lng: 27.5475, r_km: 0.5 },
  { name: "Аэропорт MSQ",                  type: "transport", lat: 53.8825, lng: 28.0307, r_km: 3.0 },
  { name: "Восточный автовокзал",          type: "transport", lat: 53.8530, lng: 27.6260, r_km: 0.4 },

  // Mall / shopping hub (большинство — на пр. Победителей, западная ось)
  { name: "Dana Mall (пр. Победителей 9)", type: "mall",      lat: 53.9085, lng: 27.5395, r_km: 0.3 },
  { name: "Galleria Minsk (Немига)",       type: "mall",      lat: 53.9070, lng: 27.5480, r_km: 0.3 },
  { name: "Galileo (ЖД вокзал)",           type: "mall",      lat: 53.8920, lng: 27.5475, r_km: 0.3 },
  { name: "Green City (Притыцкого)",       type: "mall",      lat: 53.8985, lng: 27.4245, r_km: 0.4 },
  { name: "Expobel (Победителей 65)",      type: "mall",      lat: 53.9320, lng: 27.5180, r_km: 0.4 },
  { name: "Arena City (Победителей 84)",   type: "mall",      lat: 53.9215, lng: 27.5135, r_km: 0.4 },
  { name: "Palazzo (Победителей 89)",      type: "mall",      lat: 53.9270, lng: 27.5070, r_km: 0.4 },
  { name: "Корона Уручье",                 type: "mall",      lat: 53.9485, lng: 27.6790, r_km: 0.4 },

  // Center / office
  { name: "Площадь Независимости",         type: "center",    lat: 53.8980, lng: 27.5485, r_km: 0.5 },
  { name: "Площадь Победы",                type: "center",    lat: 53.9100, lng: 27.5750, r_km: 0.4 },
  { name: "Якуба Коласа (центр)",          type: "center",    lat: 53.9180, lng: 27.5860, r_km: 0.4 },
  { name: "Купаловская / Свердлова",       type: "center",    lat: 53.9035, lng: 27.5630, r_km: 0.3 },
  { name: "Победителей (бизнес-район)",    type: "office",    lat: 53.9110, lng: 27.5390, r_km: 0.7 },

  // === Промзоны ===========================================================
  { name: "МТЗ (Тракторный завод)",        type: "industrial",lat: 53.9055, lng: 27.6390, r_km: 1.0 },
  { name: "МАЗ",                           type: "industrial",lat: 53.8730, lng: 27.6010, r_km: 1.0 },
  { name: "Шабаны",                        type: "industrial",lat: 53.8385, lng: 27.6755, r_km: 2.2 },
  { name: "Колядичи",                      type: "industrial",lat: 53.8210, lng: 27.5780, r_km: 1.7 },
  { name: "Промрайон Партизанский",        type: "industrial",lat: 53.8755, lng: 27.6330, r_km: 1.5 },
  { name: "Юго-Восток / промзона",         type: "industrial",lat: 53.8720, lng: 27.6650, r_km: 1.5 },

  // === Спальники (большие радиусы — в конце) ==============================
  { name: "Каменная Горка",                type: "sleeping",  lat: 53.9095, lng: 27.4350, r_km: 2.0 },
  { name: "Малиновка",                     type: "sleeping",  lat: 53.8550, lng: 27.4750, r_km: 1.7 },
  { name: "Сухарево",                      type: "sleeping",  lat: 53.8975, lng: 27.4520, r_km: 1.5 },
  { name: "Уручье",                        type: "sleeping",  lat: 53.9510, lng: 27.6900, r_km: 1.8 },
  { name: "Лошица",                        type: "sleeping",  lat: 53.8410, lng: 27.5710, r_km: 1.5 },
  { name: "Чижовка",                       type: "sleeping",  lat: 53.8485, lng: 27.6130, r_km: 1.5 },
  { name: "Серебрянка",                    type: "sleeping",  lat: 53.8675, lng: 27.6020, r_km: 1.3 },
  { name: "Юго-Запад / Грушевка",          type: "sleeping",  lat: 53.8800, lng: 27.5210, r_km: 1.5 },
  { name: "Курасовщина / Брилевичи",       type: "sleeping",  lat: 53.8540, lng: 27.5320, r_km: 1.5 },
  { name: "Зелёный Луг",                   type: "sleeping",  lat: 53.9430, lng: 27.6075, r_km: 1.5 },
  { name: "Восток / Северный посёлок",     type: "sleeping",  lat: 53.9405, lng: 27.6360, r_km: 1.5 },
  { name: "Ангарская",                     type: "sleeping",  lat: 53.9020, lng: 27.6520, r_km: 1.3 },
  { name: "Слобода / Михалово",            type: "sleeping",  lat: 53.8580, lng: 27.5550, r_km: 1.3 },
  { name: "Тракторный посёлок / Дражня",   type: "sleeping",  lat: 53.9000, lng: 27.6660, r_km: 1.2 },
  { name: "Новая Боровая",                 type: "sleeping",  lat: 53.9700, lng: 27.6900, r_km: 1.5 },
  { name: "Веснянка",                      type: "sleeping",  lat: 53.9075, lng: 27.5305, r_km: 0.9 },
  { name: "Сосны / НАН",                   type: "sleeping",  lat: 53.9050, lng: 27.6050, r_km: 0.6 },
  { name: "Степянка",                      type: "sleeping",  lat: 53.9300, lng: 27.6300, r_km: 1.2 },
  { name: "Дрозды",                        type: "sleeping",  lat: 53.9530, lng: 27.5230, r_km: 1.5 },
  { name: "Сурганова / Северный",          type: "sleeping",  lat: 53.9260, lng: 27.5800, r_km: 1.2 },
  { name: "Юго-Запад-Юг (Брилевичи)",      type: "sleeping",  lat: 53.8470, lng: 27.5050, r_km: 1.3 },
];

const MINSK_CENTER = [53.902, 27.560];
const MKAD_R_KM = 12;

// Возвращает { name, type } или null (если координаты невалидны).
// Если точка не попала ни в один именованный кластер — даёт обобщённый
// fallback по геометрии (центр / спальник / пригород).
export function tagFromCoords(lat, lng) {
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }
  for (const z of ZONE_TAGS) {
    const d = haversineKm(lat, lng, z.lat, z.lng);
    if (d <= z.r_km) {
      return { name: z.name, type: z.type, named: true };
    }
  }
  const dCenter = haversineKm(lat, lng, MINSK_CENTER[0], MINSK_CENTER[1]);
  if (dCenter > MKAD_R_KM) return { name: "Пригород",        type: "suburb",   named: false };
  if (dCenter <= 2.5)      return { name: "Центр (общий)",   type: "center",   named: false };
  return                          { name: "Спальник (общий)",type: "sleeping", named: false };
}

export function tagFromH3Cell(cellId) {
  if (!cellId) return null;
  try {
    const [lat, lng] = cellToLatLng(cellId);
    return tagFromCoords(lat, lng);
  } catch {
    return null;
  }
}

// Иконка для типа района (для UI / CLI).
export const TYPE_ICON = {
  bar:        "🍷",
  center:     "🏛",
  office:     "💼",
  sleeping:   "🏘",
  industrial: "🏭",
  mall:       "🛍",
  transport:  "🚉",
  suburb:     "🌲",
};

// Короткое строковое представление: "🏘 Сурганова / Северный (sleeping)".
export function tagSummary(tag) {
  if (!tag) return "—";
  const icon = TYPE_ICON[tag.type] || "📍";
  return `${icon} ${tag.name} (${tag.type})`;
}
