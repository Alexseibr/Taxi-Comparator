// Геокодинг и автокомплит адресов в Минске.
//
// Приоритет (с 27.04.2026): Google Places Text Search → Nominatim (OSM).
// Google основной, потому что:
//   • поиск с опечатками («тим» → «Тимирязева»),
//   • работает на коротких префиксах (≥2 символа),
//   • сразу возвращает координаты + аккуратный formattedAddress.
// Nominatim — fallback на случай отказа Google (квота, сеть, отсутствие ключа).
//
// Все возвращаемые displayName уже укорочены через shortenMinskAddress —
// в UI пользователь видит «3-й Подольский переулок, 18» вместо длинного
// OSM-формата «18, 3-й Подольский переулок, Сельхозпосёлок, Советский район…».
//
// Ключи (оба public в JS-бандле — обязательно ограничьте по HTTP-referrer
// в Google Cloud Console и/или собственном инстансе Nominatim):
//   VITE_GOOGLE_MAPS_KEY — Google Places Text Search + Place Details
//   (Nominatim — без ключа, ~1 req/sec, для пользовательского ввода хватает)

import { shortenMinskAddress } from "./short-address";

export type GeocodeResult = {
  lat: number;
  lng: number;
  /** Короткий человеко-читаемый адрес («ул. Тимирязева, 12»). */
  displayName: string;
  /** Полный исходный адрес (для подсказки/тултипа в UI, если надо). */
  fullAddress?: string;
  type: string;
};

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;

// Узкий viewbox строго по городу Минск (без области).
// left,top,right,bottom = lng_min, lat_max, lng_max, lat_min
const MINSK_VIEWBOX = "27.40,53.99,27.79,53.83";
// Прямоугольник города для пост-фильтра (грубо).
const MINSK_BOUNDS = { latMin: 53.82, latMax: 54.0, lngMin: 27.38, lngMax: 27.81 };
// Центр Минска и радиус для locationBias в Google Places.
const MINSK_CENTER = { lat: 53.9, lng: 27.5667 };
const MINSK_RADIUS_M = 15000;

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const GOOGLE_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_REVERSE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

const cache = new Map<string, GeocodeResult[]>();
const reverseCache = new Map<string, GeocodeResult>();

function inMinskBounds(lat: number, lng: number): boolean {
  return (
    lat >= MINSK_BOUNDS.latMin &&
    lat <= MINSK_BOUNDS.latMax &&
    lng >= MINSK_BOUNDS.lngMin &&
    lng <= MINSK_BOUNDS.lngMax
  );
}

// Отбрасываем адреса из области (не из самого города Минск) — для Nominatim,
// который часто подмешивает пригороды.
function isMinskCity(displayName: string, lat: number, lng: number): boolean {
  const dn = displayName.toLowerCase();
  if (
    dn.includes("минский район") ||
    dn.includes("мінскі раён") ||
    dn.includes("минская область") ||
    dn.includes("мінская вобласць") ||
    dn.includes("сельский совет") ||
    dn.includes("сельсавет") ||
    dn.includes("сельсовет") ||
    dn.includes("агрогородок") ||
    dn.includes("аграгарадок")
  ) {
    return false;
  }
  if (!dn.includes("минск") && !dn.includes("мінск")) return false;
  return inMinskBounds(lat, lng);
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Places Text Search (основной)
// ─────────────────────────────────────────────────────────────────────────────

type GooglePlace = {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
};

async function geocodeGoogle(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  if (!GOOGLE_KEY) return [];
  const body = {
    textQuery: query,
    languageCode: "ru",
    regionCode: "BY",
    locationBias: {
      circle: {
        center: {
          latitude: MINSK_CENTER.lat,
          longitude: MINSK_CENTER.lng,
        },
        radius: MINSK_RADIUS_M,
      },
    },
    pageSize: 6,
  };
  const res = await fetch(GOOGLE_TEXT_SEARCH_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.location,places.types",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { places?: GooglePlace[] };
  if (!json.places || !json.places.length) return [];
  const out: GeocodeResult[] = [];
  for (const p of json.places) {
    const lat = p.location?.latitude;
    const lng = p.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (!inMinskBounds(lat, lng)) continue;
    const full =
      p.formattedAddress ||
      [p.displayName?.text, "Минск, Беларусь"].filter(Boolean).join(", ");
    out.push({
      lat,
      lng,
      displayName: shortenMinskAddress(full),
      fullAddress: full,
      type: p.types?.[0] ?? "place",
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Nominatim (fallback)
// ─────────────────────────────────────────────────────────────────────────────

async function geocodeNominatim(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({
    q: `${query}, Минск, Беларусь`,
    format: "json",
    limit: "5",
    countrycodes: "by",
    viewbox: MINSK_VIEWBOX,
    bounded: "1",
    "accept-language": "ru",
  });
  const url = `${NOMINATIM_URL}?${params.toString()}`;
  const res = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Геокодер вернул ${res.status}`);
  const json = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
    type: string;
  }>;
  const all: GeocodeResult[] = json.map((r) => ({
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    displayName: shortenMinskAddress(r.display_name),
    fullAddress: r.display_name,
    type: r.type,
  }));
  return all.filter((r) => isMinskCity(r.fullAddress ?? r.displayName, r.lat, r.lng));
}

// ─────────────────────────────────────────────────────────────────────────────
// Публичный API: пробует Google, при пустом ответе или ошибке — Nominatim.
// Очень короткие запросы (<2 символов) не отправляем никуда.
// ─────────────────────────────────────────────────────────────────────────────

export async function geocodeAddress(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const key = q.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  let results: GeocodeResult[] = [];
  if (GOOGLE_KEY) {
    try {
      results = await geocodeGoogle(q, signal);
    } catch {
      results = [];
    }
  }
  // Если Google пуст или нет ключа, и запрос ≥3 символов — пробуем Nominatim
  // (он на префиксах «тим» возвращает мусор, поэтому короче 3 не зовём).
  if (results.length === 0 && q.length >= 3) {
    try {
      results = await geocodeNominatim(q, signal);
    } catch {
      // молча — UI покажет «ничего не найдено»
    }
  }
  cache.set(key, results);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reverse geocode: координата → короткий адрес.
// Google Geocoding API при наличии ключа, иначе Nominatim reverse.
// ─────────────────────────────────────────────────────────────────────────────

async function reverseGoogle(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<GeocodeResult | null> {
  if (!GOOGLE_KEY) return null;
  const params = new URLSearchParams({
    latlng: `${lat},${lng}`,
    language: "ru",
    region: "by",
    key: GOOGLE_KEY,
  });
  const res = await fetch(`${GOOGLE_REVERSE_URL}?${params.toString()}`, {
    signal,
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    status?: string;
    results?: Array<{ formatted_address?: string; types?: string[] }>;
  };
  if (j.status !== "OK" || !j.results?.length) return null;
  const r = j.results[0];
  const full = r.formatted_address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return {
    lat,
    lng,
    displayName: shortenMinskAddress(full),
    fullAddress: full,
    type: r.types?.[0] ?? "point",
  };
}

async function reverseNominatim(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<GeocodeResult> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: "json",
    "accept-language": "ru",
    zoom: "18",
  });
  const url = `${NOMINATIM_REVERSE_URL}?${params.toString()}`;
  const res = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    return {
      lat,
      lng,
      displayName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      type: "point",
    };
  }
  const j = (await res.json()) as {
    lat?: string;
    lon?: string;
    display_name?: string;
    type?: string;
  };
  const full = j.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return {
    lat: j.lat ? parseFloat(j.lat) : lat,
    lng: j.lon ? parseFloat(j.lon) : lng,
    displayName: shortenMinskAddress(full),
    fullAddress: full,
    type: j.type || "point",
  };
}

export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<GeocodeResult> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = reverseCache.get(key);
  if (cached) return cached;

  let result: GeocodeResult | null = null;
  if (GOOGLE_KEY) {
    try {
      result = await reverseGoogle(lat, lng, signal);
    } catch {
      result = null;
    }
  }
  if (!result) {
    result = await reverseNominatim(lat, lng, signal);
  }
  reverseCache.set(key, result);
  return result;
}
