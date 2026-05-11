// Хук для свежей версии tariff-breakdown.json: cron на VPS перезаписывает
// /data/tariff-breakdown.json раз в час, а билд статически инлайнит JSON
// в bundle. Без runtime-fetch фронт не увидит автообучение.
//
// Логика:
//   1. На первом рендере отдаём static-импорт (build-time снапшот) — UI
//      сразу с цифрами, без skeleton-flash.
//   2. В useEffect делаем fetch свежего файла с cache-bust и подменяем.
//   3. Кэш живёт TTL_MS (5 мин) — для liveHex<6h это критично, иначе
//      открытая вкладка показывает «свежие» данные часовой давности.
//   4. Если fetch упал — остаёмся на static (graceful fallback).
import { useEffect, useState } from "react";
import staticBreakdown from "../../public/data/tariff-breakdown.json";
import type { Baseline } from "./live-hex";

/**
 * Тип формируется из формы статического JSON (build-time снапшот) — это даёт
 * автокомплит для всех специфичных полей (basedOn, byHour, raw, и т.п.), которые
 * не описаны в компактном `TariffBreakdown` из live-hex.ts.
 *
 * НО: в статическом снапшоте baseline пока однофакторный (без perKm). После
 * перехода на гибрид (v19+) серверный JSON содержит perKm, и компоненты должны
 * иметь возможность его прочитать без cast'ов. Поэтому baseline переопределяем
 * через расширяемый тип `Baseline` из live-hex.ts (perKm/r2/mape/n опциональные).
 */
export type TariffBreakdownData = Omit<typeof staticBreakdown, "baseline"> & {
  baseline: { econom: Baseline; comfort: Baseline };
};

const BASE_URL =
  (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ||
  "/";

// 5 минут — баланс: cron на VPS бежит раз в час, но liveHex окно 6ч,
// быстрый refresh после переобучения важнее чем сэкономить запросы.
const TTL_MS = 5 * 60 * 1000;

let cachedData: TariffBreakdownData | null = null;
let cachedAt = 0;
let inflight: Promise<TariffBreakdownData> | null = null;
const subscribers = new Set<(d: TariffBreakdownData) => void>();

function loadFresh(force = false): Promise<TariffBreakdownData> {
  const fresh = cachedData && Date.now() - cachedAt < TTL_MS;
  if (fresh && !force) return Promise.resolve(cachedData!);
  if (inflight) return inflight;
  inflight = fetch(`${BASE_URL}data/tariff-breakdown.json?t=${Date.now()}`, {
    cache: "no-cache",
  })
    .then((r) => (r.ok ? (r.json() as Promise<TariffBreakdownData>) : staticBreakdown))
    .catch(() => cachedData || staticBreakdown)
    .then((d) => {
      cachedData = d;
      cachedAt = Date.now();
      inflight = null;
      // Будим всех подписчиков — это ключ для live-overlay'я: после
      // переобучения карта моментально показывает свежие гексы.
      for (const fn of subscribers) fn(d);
      return d;
    });
  return inflight;
}

export function useTariffBreakdown(): TariffBreakdownData {
  const [data, setData] = useState<TariffBreakdownData>(
    cachedData || (staticBreakdown as TariffBreakdownData),
  );
  useEffect(() => {
    let alive = true;
    const onUpdate = (d: TariffBreakdownData) => {
      if (alive) setData(d);
    };
    subscribers.add(onUpdate);
    // Первый запрос (или переиспользует свежий cache).
    loadFresh().then(onUpdate);
    // Периодический refetch — пока вкладка открыта.
    const id = window.setInterval(() => {
      loadFresh(true);
    }, TTL_MS);
    return () => {
      alive = false;
      subscribers.delete(onUpdate);
      window.clearInterval(id);
    };
  }, []);
  return data;
}
