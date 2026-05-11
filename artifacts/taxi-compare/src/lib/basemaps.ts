import { useSyncExternalStore } from "react";

/**
 * Каталог тайл-подложек карты. Все варианты — легальные, без ключей,
 * с правильной атрибуцией. Юзер выбирает в меню; выбор хранится
 * в localStorage и синхронизируется между всеми экземплярами картинки.
 */

export type BasemapId =
  | "osm"
  | "carto-voyager"
  | "carto-positron"
  | "carto-dark";

export interface Basemap {
  id: BasemapId;
  /** Короткая подпись в UI. */
  label: string;
  /** Подсказка над пиктограммой / в title. */
  description: string;
  /** URL-шаблон Leaflet (с {s}/{z}/{x}/{y}; для CARTO ещё {r} для retina). */
  url: string;
  subdomains: string[];
  /** Атрибуция (HTML). Юр. требование лицензий OSM / CARTO. */
  attribution: string;
  maxZoom: number;
  /** Цвет квадратика-превью в пиклере (имитирует общий тон подложки). */
  preview: string;
  /** Подсказка: подложка тёмная — поверх неё хорошо темные иконки. */
  isDark?: boolean;
}

// Полная атрибуция OSM (юр. требование https://www.openstreetmap.org/copyright).
const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';
// Атрибуция CARTO basemaps (https://carto.com/attributions).
const CARTO_ATTR =
  '&copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

// Намеренно НЕ используем {r} в URL: вместо этого передаём detectRetina
// в TileLayer. Так Leaflet сам выберет zoomOffset для retina-устройств,
// и мы не получим «двойной retina» (когда @2x-тайлы дополнительно
// смещаются ещё и через detectRetina).

export const BASEMAPS: Basemap[] = [
  {
    id: "osm",
    label: "Стандартная",
    description: "OpenStreetMap — привычная подложка",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c"],
    attribution: OSM_ATTR,
    maxZoom: 19,
    preview: "#f2efe9",
  },
  {
    id: "carto-voyager",
    label: "Voyager",
    description: "CARTO Voyager — мягкая, цветная, удобные подписи",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c", "d"],
    attribution: `${OSM_ATTR} &copy; ${CARTO_ATTR}`,
    maxZoom: 19,
    preview: "#e8e4dc",
  },
  {
    id: "carto-positron",
    label: "Светлая",
    description: "CARTO Positron — почти белая, ярко подсвечивает сёрджи",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c", "d"],
    attribution: `${OSM_ATTR} &copy; ${CARTO_ATTR}`,
    maxZoom: 19,
    preview: "#fafafa",
  },
  {
    id: "carto-dark",
    label: "Тёмная",
    description: "CARTO Dark Matter — для ночного режима",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    subdomains: ["a", "b", "c", "d"],
    attribution: `${OSM_ATTR} &copy; ${CARTO_ATTR}`,
    maxZoom: 19,
    preview: "#1a1a1a",
    isDark: true,
  },
];

const LS_KEY = "rwbtaxi:basemap";
const DEFAULT_ID: BasemapId = "osm";

const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}

function readId(): BasemapId {
  if (typeof window === "undefined") return DEFAULT_ID;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw && BASEMAPS.some((b) => b.id === raw)) return raw as BasemapId;
  } catch {
    /* ignore */
  }
  return DEFAULT_ID;
}

function writeId(id: BasemapId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, id);
  } catch {
    /* ignore */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === LS_KEY) notify();
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useBasemapId(): BasemapId {
  return useSyncExternalStore(subscribe, readId, () => DEFAULT_ID);
}

export function useBasemap(): Basemap {
  const id = useBasemapId();
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}

export function setBasemapId(id: BasemapId) {
  // Если выбрали уже активную подложку — не дёргаем подписчиков
  // (избегаем лишних ре-рендеров и пере-крепления тайл-слоя).
  if (id === readId()) return;
  writeId(id);
  notify();
}
