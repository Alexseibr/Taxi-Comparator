/**
 * EventsBadge — плашка активных городских событий Минска над картой.
 *
 * Тянет список событий из /api/tariff-grid/events (следующие 30 дней),
 * показывает активные прямо сейчас (по client-side времени).
 * Если событий нет — компонент скрыт.
 *
 * Размещается рядом с WeatherStripe: absolute под WeatherStripe справа.
 */

import { useEffect, useState } from "react";
import { Calendar, Zap } from "lucide-react";

interface ApiEvent {
  name: string;
  kind: string;
  startIso: string;
  endIso: string;
  surge: number;
}

interface EventsResponse {
  events: ApiEvent[];
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const EVENTS_URL = `${BASE}/api/tariff-grid/events`;
const REFRESH_MS = 15 * 60 * 1000; // 15 мин

function getActiveNow(events: ApiEvent[]): ApiEvent[] {
  const now = Date.now();
  return events.filter(
    (e) => now >= new Date(e.startIso).getTime() && now <= new Date(e.endIso).getTime(),
  );
}

function kindIcon(kind: string): string {
  switch (kind) {
    case "new_year_eve":   return "🎆";
    case "public_holiday": return "🏛️";
    case "sports_match":   return "⚽";
    case "concert":        return "🎤";
    case "city_event":     return "🏙️";
    default:               return "📅";
  }
}

export function EventsBadge() {
  const [events, setEvents] = useState<ApiEvent[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const resp = await fetch(EVENTS_URL);
        if (!resp.ok) return;
        const data = (await resp.json()) as EventsResponse;
        if (!cancelled) setEvents(data.events ?? []);
      } catch {
        // Silent — badge nécessaire uniquement quand event actif
      }
    };

    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const active = getActiveNow(events);
  if (active.length === 0) return null;

  // Берём событие с максимальным surge для отображения
  const top = active.reduce((acc, e) => (e.surge > acc.surge ? e : acc));
  const isHigh = top.surge >= 1.35;

  const borderColor = isHigh
    ? "border-rose-400 bg-rose-50/95"
    : "border-amber-300 bg-amber-50/95";
  const badgeColor = isHigh
    ? "bg-rose-200 text-rose-800"
    : "bg-amber-200 text-amber-800";

  return (
    <div
      className={`absolute top-12 right-2 z-[1000] flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border shadow-sm backdrop-blur-sm text-xs ${borderColor}`}
      title={active.map((e) => `${e.name} (×${e.surge})`).join("\n")}
      data-testid="events-badge"
    >
      <Calendar className="h-3 w-3 shrink-0 text-amber-700" />
      <span className="leading-none">{kindIcon(top.kind)}</span>
      <span className="font-medium truncate max-w-[140px] sm:max-w-[220px]">
        {top.name}
      </span>
      <span
        className={`hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-[10px] font-semibold ${badgeColor}`}
      >
        <Zap className="h-2.5 w-2.5" />
        ×{top.surge}
      </span>
      {active.length > 1 && (
        <span className="text-[10px] text-muted-foreground">
          +{active.length - 1}
        </span>
      )}
    </div>
  );
}
