/**
 * Minimal client for the public taxi.yandex.ru pricing endpoint.
 *
 * The web client of taxi.yandex.ru talks to ya-authproxy.taxi.yandex.ru via
 * three calls:
 *   1. GET  https://taxi.yandex.ru/ru_ru/         → Set-Cookie session
 *   2. POST https://ya-authproxy.taxi.yandex.ru/csrf_token  → { sk, max-age-seconds }
 *   3. POST https://ya-authproxy.taxi.yandex.ru/3.0/routestats
 *           with { route: [[lng,lat], ...], tariff_requirements: [...], ... }
 *
 * The third call returns `service_levels` carrying per-class price strings
 * (e.g. "5,8 $SIGN$$CURRENCY$") and `paid_options.value` (the surge multiplier).
 *
 * We deliberately use plain fetch (no headless browser) — the endpoints accept
 * any session cookie the homepage hands out, and the csrf token rotates hourly.
 *
 * NOTE on terms-of-service: this hits a public endpoint that is also used by
 * the customer-facing taxi.yandex.ru widget. Automated polling is technically
 * against Yandex's ToS; we keep the request rate intentionally low (one call
 * per route every 150 min) to avoid impacting their service. Failures fall
 * back to the local synthetic model so the product never goes down.
 */

import { logger } from "./logger";

const BASE = "https://ya-authproxy.taxi.yandex.ru";
const HOMEPAGE = "https://taxi.yandex.ru/ru_ru/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const CSRF_VALIDITY_MS = 50 * 60 * 1000;
const COOKIE_VALIDITY_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;

interface CookieJar {
  header: string;
  acquiredAt: number;
}

interface CsrfToken {
  value: string;
  acquiredAt: number;
}

let cookieJar: CookieJar | null = null;
let csrfToken: CsrfToken | null = null;

/** Yandex tariff classes we care about, in their preferred display order. */
export const YANDEX_CLASSES = ["econom", "business"] as const;
export type YandexClassId = (typeof YANDEX_CLASSES)[number];

export interface RouteStatsEntry {
  classId: YandexClassId;
  className: string;
  /** Total price in BYN (or whatever currency the zone uses). */
  price: number;
  surgeMultiplier: number;
  surgeLabel: string | null;
}

function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(t),
  );
}

function parseSetCookies(headers: Headers): string {
  // Node 20+ supports getSetCookie; fall back to raw .get otherwise.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list: string[] = (headers as any).getSetCookie?.() ?? [];
  const map = new Map<string, string>();
  for (const sc of list) {
    const [pair] = sc.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    map.set(name, value);
  }
  return [...map.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}

async function refreshCookies(): Promise<CookieJar> {
  const resp = await fetchWithTimeout(HOMEPAGE, {
    headers: { "user-agent": UA, "accept-language": "ru-RU,ru;q=0.9" },
  });
  if (!resp.ok) {
    throw new Error(`Yandex homepage GET failed: ${resp.status}`);
  }
  const header = parseSetCookies(resp.headers);
  if (!header) {
    throw new Error("Yandex homepage returned no Set-Cookie");
  }
  const jar = { header, acquiredAt: Date.now() };
  cookieJar = jar;
  csrfToken = null; // any cached csrf belongs to the previous session
  return jar;
}

async function ensureCookies(): Promise<CookieJar> {
  if (cookieJar && Date.now() - cookieJar.acquiredAt < COOKIE_VALIDITY_MS) {
    return cookieJar;
  }
  return refreshCookies();
}

async function refreshCsrf(jar: CookieJar): Promise<CsrfToken> {
  const resp = await fetchWithTimeout(`${BASE}/csrf_token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: jar.header,
      referer: "https://taxi.yandex.ru/",
      origin: "https://taxi.yandex.ru",
      "x-requested-with": "XMLHttpRequest",
      "user-agent": UA,
    },
    body: "{}",
  });
  if (!resp.ok) {
    throw new Error(`csrf_token failed: ${resp.status}`);
  }
  const data = (await resp.json()) as { sk?: string };
  if (!data.sk) {
    throw new Error("csrf_token response missing `sk`");
  }
  const tok = { value: data.sk, acquiredAt: Date.now() };
  csrfToken = tok;
  return tok;
}

async function ensureCsrf(jar: CookieJar): Promise<CsrfToken> {
  if (csrfToken && Date.now() - csrfToken.acquiredAt < CSRF_VALIDITY_MS) {
    return csrfToken;
  }
  return refreshCsrf(jar);
}

/**
 * Yandex returns prices like `"5,8 $SIGN$$CURRENCY$"`. Parse the leading
 * number (with comma decimal separator) into a regular number.
 */
function parsePriceString(s: string | undefined): number | null {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const num = Number.parseFloat(m[1].replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

interface RawServiceLevel {
  class?: string;
  name?: string;
  price?: string;
  paid_options?: {
    value?: number;
    alert_properties?: { label?: string };
  };
}

interface RawRoutestatsResponse {
  service_levels?: RawServiceLevel[];
  currency_rules?: { code?: string };
}

/**
 * Fetch the current per-class prices for a Minsk route from taxi.yandex.ru.
 *
 * Throws if the network call fails, response is malformed, or no service
 * levels we care about are returned. Callers should catch and fall back
 * to the local model.
 */
export async function fetchYandexRouteStats(
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number },
): Promise<RouteStatsEntry[]> {
  const jar = await ensureCookies();
  let csrf = await ensureCsrf(jar);

  const body = {
    route: [
      [pickup.lng, pickup.lat],
      [dropoff.lng, dropoff.lat],
    ],
    selected_class: "",
    format_currency: true,
    requirements: { coupon: "" },
    summary_version: 2,
    is_lightweight: false,
    supports_paid_options: true,
    tariff_requirements: YANDEX_CLASSES.map((c) => ({
      class: c,
      requirements: { coupon: "" },
    })),
    use_toll_roads: false,
    supported_markup: "tml-0.1",
    extended_description: true,
  };

  const callRoutestats = async (jarToUse: CookieJar, csrfToUse: CsrfToken) =>
    fetchWithTimeout(`${BASE}/3.0/routestats`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: jarToUse.header,
        referer: "https://taxi.yandex.ru/",
        origin: "https://taxi.yandex.ru",
        "x-csrf-token": csrfToUse.value,
        "x-requested-with": "XMLHttpRequest",
        accept: "application/json",
        "user-agent": UA,
      },
      body: JSON.stringify(body),
    });

  let resp = await callRoutestats(jar, csrf);

  // 401/403/419 → likely cookie or csrf went stale. Refresh once and retry.
  if (resp.status === 401 || resp.status === 403 || resp.status === 419) {
    logger.warn(
      { status: resp.status },
      "Yandex routestats auth-rejected; refreshing session",
    );
    const freshJar = await refreshCookies();
    const freshCsrf = await refreshCsrf(freshJar);
    csrf = freshCsrf;
    resp = await callRoutestats(freshJar, freshCsrf);
  }

  if (!resp.ok) {
    throw new Error(`routestats HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as RawRoutestatsResponse;
  const slArr = data.service_levels;
  if (!Array.isArray(slArr) || slArr.length === 0) {
    throw new Error("routestats: empty service_levels");
  }

  const wanted = new Set<string>(YANDEX_CLASSES);
  const out: RouteStatsEntry[] = [];
  for (const sl of slArr) {
    if (!sl.class || !wanted.has(sl.class)) continue;
    const price = parsePriceString(sl.price);
    if (price == null) continue;
    out.push({
      classId: sl.class as YandexClassId,
      className: sl.name ?? sl.class,
      price,
      surgeMultiplier:
        typeof sl.paid_options?.value === "number" && sl.paid_options.value > 0
          ? sl.paid_options.value
          : 1,
      surgeLabel: sl.paid_options?.alert_properties?.label ?? null,
    });
  }
  if (out.length === 0) {
    throw new Error("routestats: no recognized classes in response");
  }
  return out;
}

/** Reset cached cookies & csrf — exported for tests / forced refresh. */
export function resetYandexSession(): void {
  cookieJar = null;
  csrfToken = null;
}
