// Клиент для отправки замеров на серверный приёмник (calib-receiver).
// Endpoint: https://rwbtaxi.by/api/calib/submit  (через nginx → 127.0.0.1:3010).
//
// При локальной разработке VITE_CALIB_SUBMIT_URL не задан → клиент работает
// в degraded-режиме: возвращает { ok: false, error: "no_endpoint" } и не падает.

import type { DemandLabel } from "./observations";

export type CalibServerPayload = {
  fromAddress: string;
  toAddress: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  factE?: number;
  factC?: number;
  etaMin?: number;
  tripMin?: number;
  km?: number;
  demand: DemandLabel;
  date: string; // YYYY-MM-DD
  hour: number; // 0..23
  source?: string;
  notes?: string;
};

export type CalibServerResult =
  | { ok: true; id: string }
  | { ok: false; error: string; fields?: string[]; status?: number };

function endpoint(): string | null {
  // 1) Явная переменная окружения сборки.
  const url = (import.meta.env.VITE_CALIB_SUBMIT_URL as string | undefined)?.trim();
  if (url) return url;
  // 2) Прод-домен — собираем относительно текущего origin (production build на rwbtaxi.by).
  if (typeof window !== "undefined" && window.location.hostname.endsWith("rwbtaxi.by")) {
    return `${window.location.origin}/api/calib/submit`;
  }
  // 3) Dev — endpoint не задан, не отправляем.
  return null;
}

export function isCalibServerConfigured(): boolean {
  return endpoint() !== null;
}

export async function submitCalibToServer(
  payload: CalibServerPayload,
): Promise<CalibServerResult> {
  const url = endpoint();
  if (!url) return { ok: false, error: "no_endpoint" };
  const token = (import.meta.env.VITE_CALIB_TOKEN as string | undefined)?.trim();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Calib-Token": token } : {}),
      },
      body: JSON.stringify(payload),
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: json?.error ?? `http_${res.status}`,
        fields: Array.isArray(json?.fields) ? json.fields : undefined,
      };
    }
    if (json?.ok && typeof json.id === "string") {
      return { ok: true, id: json.id };
    }
    return { ok: false, error: "bad_response" };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "network_error" };
  }
}
