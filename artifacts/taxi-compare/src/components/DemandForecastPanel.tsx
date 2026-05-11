/**
 * DemandForecastPanel — 24-часовой прогноз спроса.
 *
 * Тянет данные из /api/tariff-grid/demand-forecast?hours=24.
 * Для каждого часа показывает:
 *   - Цветной бар (green / yellow / red) по уровню спроса
 *   - Surge-мультипликатор
 *   - Иконку погоды (дождь / снег) если weather.contrib > 0
 *   - Иконку события если active events
 *
 * Компонент используется как выдвижная панель из нижнего бара карты.
 */

import { useEffect, useState } from "react";
import { Cloud, CloudRain, CloudSnow, Zap, Calendar, TrendingUp } from "lucide-react";

interface WeatherInfo {
  isRain: boolean;
  isSnow: boolean;
  tempC: number;
  weatherCode: number;
  contrib: number;
}

interface EventInfo {
  active: { name: string; kind: string; surge: number }[];
  mult: number;
}

interface ForecastHour {
  at: string;
  minskHour: number;
  surgeMultiplier: number;
  demandLevel: "green" | "yellow" | "red";
  driver: string;
  weather: WeatherInfo;
  events: EventInfo;
}

interface ForecastResponse {
  generatedAt: string;
  hours: number;
  forecast: ForecastHour[];
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const URL_FORECAST = `${BASE}/api/tariff-grid/demand-forecast?hours=24`;
const REFRESH_MS = 10 * 60 * 1000;

const LEVEL_BG: Record<string, string> = {
  green:  "bg-emerald-500",
  yellow: "bg-amber-400",
  red:    "bg-rose-500",
};
const LEVEL_TEXT: Record<string, string> = {
  green:  "text-emerald-700",
  yellow: "text-amber-700",
  red:    "text-rose-700",
};

function pad2(n: number) { return String(n).padStart(2, "0"); }

function WeatherIcon({ wx }: { wx: WeatherInfo }) {
  if (wx.contrib <= 0) return null;
  if (wx.isSnow) return <CloudSnow className="h-3 w-3 text-sky-400 shrink-0" />;
  if (wx.isRain) return <CloudRain className="h-3 w-3 text-sky-500 shrink-0" />;
  if (wx.weatherCode >= 80) return <Cloud className="h-3 w-3 text-gray-400 shrink-0" />;
  return null;
}

function DriverLabel({ driver, events }: { driver: string; events: EventInfo }) {
  if (events.active.length > 0) {
    return (
      <span className="flex items-center gap-0.5 text-amber-600 text-[9px]">
        <Calendar className="h-2.5 w-2.5" />
        <span className="truncate max-w-[80px]">{events.active[0]!.name.split(" ").slice(0, 2).join(" ")}</span>
      </span>
    );
  }
  const labels: Record<string, string> = {
    morning_rush: "утренний пик",
    evening_rush: "вечерний пик",
    nightlife:    "ночной",
    weather:      "погода",
    calm:         "",
  };
  const label = labels[driver] ?? "";
  if (!label) return null;
  return (
    <span className="text-[9px] text-muted-foreground truncate max-w-[70px]">{label}</span>
  );
}

export function DemandForecastPanel() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const resp = await fetch(URL_FORECAST);
        if (!resp.ok) return;
        const json = (await resp.json()) as ForecastResponse;
        if (!cancelled) { setData(json); setLoading(false); }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-20 text-muted-foreground text-xs gap-2">
        <TrendingUp className="h-4 w-4 animate-pulse" />
        Загружаем прогноз спроса…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-muted-foreground text-xs p-3">
        Прогноз недоступен
      </div>
    );
  }

  const maxSurge = Math.max(...data.forecast.map((f) => f.surgeMultiplier));
  const minSurge = Math.min(...data.forecast.map((f) => f.surgeMultiplier));
  const surgeRange = Math.max(0.1, maxSurge - minSurge);

  // Current Minsk hour
  const nowMinskHour = (new Date().getUTCHours() + 3) % 24;

  return (
    <div className="flex flex-col gap-1.5 p-3 select-none" data-testid="demand-forecast-panel">
      {/* Заголовок */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <TrendingUp className="h-3.5 w-3.5" />
          Прогноз спроса на 24 часа
        </div>
        <span className="text-[10px] text-muted-foreground">
          обн. {new Date(data.generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {/* Легенда */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-1">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />низкий</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" />средний</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-500 inline-block" />высокий</span>
        <span className="flex items-center gap-1"><CloudRain className="h-3 w-3 text-sky-500" />дождь</span>
        <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-amber-500" />событие</span>
      </div>

      {/* Бары по часам */}
      <div className="flex items-end gap-0.5 h-16" aria-label="почасовой прогноз спроса">
        {data.forecast.map((f) => {
          const isCurrent = f.minskHour === nowMinskHour;
          const heightPct = 20 + 80 * ((f.surgeMultiplier - minSurge) / surgeRange);
          const hasEvent = f.events.active.length > 0;
          const hasWeather = f.weather.contrib > 0;

          return (
            <div
              key={f.at}
              className="flex flex-col items-center gap-0.5 flex-1 min-w-0 group"
              title={[
                `${pad2(f.minskHour)}:00 — surge ×${f.surgeMultiplier}`,
                f.weather.isRain ? `дождь (+${Math.round(f.weather.contrib * 100)}% surge)` : null,
                f.weather.isSnow ? `снег (+${Math.round(f.weather.contrib * 100)}% surge)` : null,
                f.weather.tempC < -10 ? `мороз ${Math.round(f.weather.tempC)}°C` : null,
                ...f.events.active.map((e) => `${e.name} ×${e.surge}`),
              ].filter(Boolean).join("\n")}
            >
              {/* Иконки над баром */}
              <div className="flex flex-col items-center gap-px h-5 justify-end">
                {hasEvent && <Zap className="h-2.5 w-2.5 text-amber-500 shrink-0" />}
                {hasWeather && !hasEvent && <WeatherIcon wx={f.weather} />}
              </div>

              {/* Сам бар */}
              <div
                className={`w-full rounded-t-[2px] transition-all ${LEVEL_BG[f.demandLevel] ?? "bg-gray-300"} ${
                  isCurrent ? "ring-2 ring-offset-0 ring-blue-400 ring-inset" : ""
                }`}
                style={{ height: `${heightPct}%` }}
              />

              {/* Час */}
              <span
                className={`text-[8px] tabular-nums leading-none ${
                  isCurrent
                    ? "font-bold text-blue-600"
                    : LEVEL_TEXT[f.demandLevel] ?? "text-muted-foreground"
                }`}
              >
                {pad2(f.minskHour)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Текущий час — детали */}
      {(() => {
        const cur = data.forecast.find((f) => f.minskHour === nowMinskHour);
        if (!cur) return null;
        return (
          <div className="flex items-center gap-2 mt-0.5 text-[11px] border-t pt-1.5">
            <span className="font-semibold">Сейчас:</span>
            <span className={`font-bold ${LEVEL_TEXT[cur.demandLevel] ?? ""}`}>
              ×{cur.surgeMultiplier}
            </span>
            <DriverLabel driver={cur.driver} events={cur.events} />
            {cur.weather.isRain && (
              <span className="flex items-center gap-0.5 text-sky-600">
                <CloudRain className="h-3 w-3" />
                <span className="text-[9px]">+{Math.round(cur.weather.contrib * 100)}%</span>
              </span>
            )}
            {cur.weather.isSnow && (
              <span className="flex items-center gap-0.5 text-sky-500">
                <CloudSnow className="h-3 w-3" />
                <span className="text-[9px]">+{Math.round(cur.weather.contrib * 100)}%</span>
              </span>
            )}
            {cur.events.active.length > 0 && (
              <span className="flex items-center gap-0.5 text-amber-600">
                <Calendar className="h-3 w-3" />
                <span className="text-[9px]">×{cur.events.mult}</span>
              </span>
            )}
            <span className="ml-auto text-[9px] text-muted-foreground tabular-nums">
              {Math.round(cur.weather.tempC)}°C
            </span>
          </div>
        );
      })()}
    </div>
  );
}
