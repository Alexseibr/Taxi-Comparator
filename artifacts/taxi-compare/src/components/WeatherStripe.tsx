// Плашка текущей погоды поверх карты спроса.
// Оператор видит «прямо сейчас» в Минске: температура, ветер, осадки,
// и цветовую подсказку «насколько погода тянет сёрдж вверх».
//
// Источник: Open-Meteo (общий кэш с lib/weather.ts, ходим раз в 30 минут).
// Если open-meteo недоступен — виджет молча скрывается, чтобы не мешать
// карте ошибкой.
//
// Размещается через absolute поверх MapContainer в MapDashboard, выше
// нижнего бара. На мобиле компактная плашка справа сверху, на десктопе
// чуть шире с более явной подписью.

import { useEffect, useState } from "react";
import { Wind, Droplets, RefreshCcw, Clock } from "lucide-react";
import {
  fetchCurrentWeather,
  fetchUpcomingPrecip,
  describeWeatherCode,
  weatherSurgeHint,
  type CurrentWeather,
  type UpcomingPrecip,
} from "@/lib/weather";

const REFRESH_MS = 5 * 60 * 1000; // тянем заново каждые 5 минут (под капотом 30-мин LS-кэш)

export function WeatherStripe() {
  const [w, setW] = useState<CurrentWeather | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingPrecip | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      // Тянем параллельно — оба используют общий LS-кэш, второй вызов
      // обычно мгновенный (читает уже распарсенный ответ).
      const [cur, up] = await Promise.all([
        fetchCurrentWeather(),
        fetchUpcomingPrecip(),
      ]);
      if (!cancelled) {
        setW(cur);
        setUpcoming(up);
        setLoading(false);
      }
    };
    void tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (loading || !w) {
    // Не показываем «загрузка…» — лишний шум поверх карты.
    // Если open-meteo лёг — просто пустое место (виджет необязательный).
    return null;
  }

  const desc = describeWeatherCode(w.weatherCode);
  const hint = weatherSurgeHint(w);

  // Цвет рамки: 0=серый (норм), 1=янтарный (сёрдж вероятен), 2=красный (точно сёрдж).
  // Оператор сразу видит «карта спроса красная — посмотри сюда, погода объясняет».
  const borderColor =
    hint.level === 2
      ? "border-rose-400 bg-rose-50/95"
      : hint.level === 1
        ? "border-amber-300 bg-amber-50/95"
        : "border-gray-200 bg-white/95";

  const tempStr = `${Math.round(w.tempC)}°`;
  const apparentDiff = Math.abs(w.apparentC - w.tempC);
  const showApparent = apparentDiff >= 3; // показываем «ощущается как» только если разница ≥3°
  const tooltipParts = [
    `${desc.label} ${tempStr}`,
    `ощущается как ${Math.round(w.apparentC)}°`,
    `ветер ${Math.round(w.windKmh)} км/ч (порывы ${Math.round(w.gustKmh)})`,
    `влажность ${w.humidity}%`,
    w.precipitationMm > 0 ? `осадки ${w.precipitationMm.toFixed(1)} мм/ч` : null,
    w.snowfallCm > 0 ? `снег ${w.snowfallCm.toFixed(1)} см/ч` : null,
    hint.reasons.length > 0 ? `\nфакторы сёрджа: ${hint.reasons.join(", ")}` : null,
    `\nобновлено: ${w.timeIso.slice(11, 16)}`,
  ].filter(Boolean);

  return (
    <div
      className={`absolute top-2 right-2 z-[1000] flex items-center gap-2 px-2.5 py-1.5 rounded-lg border shadow-sm backdrop-blur-sm text-xs ${borderColor}`}
      title={tooltipParts.join("\n")}
      data-testid="weather-stripe"
    >
      <span className="text-base leading-none" aria-label={desc.label}>
        {desc.icon}
      </span>
      <span className="font-semibold tabular-nums">{tempStr}</span>
      {showApparent && (
        <span className="text-muted-foreground tabular-nums hidden sm:inline">
          (ощущ. {Math.round(w.apparentC)}°)
        </span>
      )}
      <span className="flex items-center gap-0.5 text-muted-foreground tabular-nums">
        <Wind className="h-3 w-3" />
        {Math.round(w.windKmh)}
        <span className="text-[10px] opacity-70">км/ч</span>
      </span>
      <span className="hidden sm:flex items-center gap-0.5 text-muted-foreground tabular-nums">
        <Droplets className="h-3 w-3" />
        {w.humidity}
        <span className="text-[10px] opacity-70">%</span>
      </span>
      {hint.level >= 1 && (
        <span
          className={`hidden md:inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-[10px] font-medium ${
            hint.level === 2
              ? "bg-rose-200 text-rose-800"
              : "bg-amber-200 text-amber-800"
          }`}
        >
          <RefreshCcw className="h-2.5 w-2.5" />
          сёрдж: {hint.reasons.slice(0, 2).join(", ")}
        </span>
      )}
      {/* Прогноз 1-3ч — оператор заранее видит «через 2ч начнётся дождь»,
          можно поднять резерв авто до того как сёрдж скакнёт.
          Показываем только если в текущий момент осадков НЕТ (иначе уже
          видно по основной строке) — чтобы не дублировать. */}
      {upcoming && hint.level === 0 && (
        <span
          className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-[10px] font-medium bg-sky-100 text-sky-800 border border-sky-200"
          title={`Прогноз open-meteo на ближайшие 3 часа: ${upcoming.label}. Можно заранее усилить смену.`}
          data-testid="weather-upcoming"
        >
          <Clock className="h-2.5 w-2.5" />
          <span className="text-sm leading-none">{upcoming.icon}</span>
          <span className="hidden sm:inline">{upcoming.label}</span>
          <span className="sm:hidden">через {upcoming.inHours}ч</span>
        </span>
      )}
    </div>
  );
}
