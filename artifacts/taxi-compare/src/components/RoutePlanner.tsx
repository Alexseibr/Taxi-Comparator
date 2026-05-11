import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, MapPin, Navigation, ArrowRight, Save, AlertTriangle, Gauge, Crosshair, X } from "lucide-react";
import { geocodeAddress, type GeocodeResult } from "@/lib/geocoder";
import { fetchRoute, samplePath, type Route, type RoutePoint } from "@/lib/routing";
import {
  fetchAvgTraffic,
  hasTrafficProvider,
  trafficProviderName,
  trafficTimeMultiplier,
  trafficSurgeMultiplier,
  localTrafficTimeMultiplier,
  multiplierToRatio,
  inferTrafficFromObservations,
  type TrafficSample,
} from "@/lib/traffic";
import {
  BASE_TARIFF,
  basePrice,
  surgeAt,
  predictEconom,
  routeSurgeMultiplier,
  SURGE_BOUNDS,
  TIME_SLOTS,
  DAYS,
  rwbHybridPrice,
  RWB_FLOOR,
  RWB_DEMPING_VS_YA,
  RWB_TARIFF_GRID,
  type DayType,
  type TimeSlot,
  type ObservationPoint,
  type DayKind,
  type TariffSlot,
  type RwbTariff,
} from "@/lib/zones";
import {
  loadUserTrips,
  saveUserTrips,
  type Observation,
} from "@/lib/observations";
import {
  predictPriceRange,
  type PriceQuantile,
  type PriceRangePrediction,
} from "@/lib/pricing-model";

export type PickMode = "from" | "to" | null;

export type ResolvedRoute = {
  from: { label: string; point: RoutePoint };
  to: { label: string; point: RoutePoint };
  route: Route;
};

type Props = {
  day: DayType;
  time: TimeSlot;
  hour: number;
  timeLabel?: string;
  observations: ObservationPoint[];
  onRouteChange: (r: ResolvedRoute | null) => void;
  onClose: () => void;
  pickedFrom: GeocodeResult | null;
  pickedTo: GeocodeResult | null;
  onPickedFromChange: (g: GeocodeResult | null) => void;
  onPickedToChange: (g: GeocodeResult | null) => void;
  pickMode: PickMode;
  onPickModeChange: (m: PickMode) => void;
};

export default function RoutePlanner({
  day,
  time,
  hour,
  timeLabel,
  observations,
  onRouteChange,
  onClose,
  pickedFrom,
  pickedTo,
  onPickedFromChange,
  onPickedToChange,
  pickMode,
  onPickModeChange,
}: Props) {
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [fromResults, setFromResults] = useState<GeocodeResult[]>([]);
  const [toResults, setToResults] = useState<GeocodeResult[]>([]);
  const [route, setRoute] = useState<Route | null>(null);
  const [traffic, setTraffic] = useState<TrafficSample | null>(null);
  const [trafficSource, setTrafficSource] = useState<
    "api" | "observations" | "local" | null
  >(null);
  const [trafficSampleCount, setTrafficSampleCount] = useState<number>(0);
  const [actualMin, setActualMin] = useState<string>("");
  const [savedActualHint, setSavedActualHint] = useState<string | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [yandexPrice, setYandexPrice] = useState<string>("");
  const [savedHint, setSavedHint] = useState<string | null>(null);
  // Серверный CatBoost+H3 диапазон цены (Sprint 3, 2026-05-02). Подгружается
  // асинхронно при изменении маршрута/часа/пробок. null = ещё не загружено
  // или сервер недоступен — UI просто не показывает диапазон.
  const [mlRange, setMlRange] = useState<PriceRangePrediction | null>(null);
  const [mlLoading, setMlLoading] = useState(false);

  const debFromTimer = useRef<number | null>(null);
  const debToTimer = useRef<number | null>(null);

  // Синхронизируем текстовое поле с выбранной точкой (после клика по карте
  // или выбора подсказки).
  useEffect(() => {
    if (pickedFrom) {
      setFromQuery(pickedFrom.displayName);
      setFromResults([]);
    }
  }, [pickedFrom]);
  useEffect(() => {
    if (pickedTo) {
      setToQuery(pickedTo.displayName);
      setToResults([]);
    }
  }, [pickedTo]);

  // Сбрасываем кэш пробок при смене дня/слота/часа: иначе мы бы применили
  // ttMult, замеренный, например, в воскресенье 09:00, к расчёту цены для
  // понедельника 18:00 — и получили бы неверный множитель сёрджа. Пользователь
  // увидит подсказку «Постройте маршрут заново для актуальных пробок».
  useEffect(() => {
    if (traffic) {
      setTraffic(null);
      setTrafficSource(null);
      setTrafficSampleCount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, time, hour]);

  // Дебаунс-геокодинг
  useEffect(() => {
    if (debFromTimer.current) window.clearTimeout(debFromTimer.current);
    if (!fromQuery.trim() || pickedFrom?.displayName === fromQuery) return;
    debFromTimer.current = window.setTimeout(async () => {
      try {
        const r = await geocodeAddress(fromQuery);
        setFromResults(r);
      } catch {
        setFromResults([]);
      }
    }, 350);
  }, [fromQuery, pickedFrom]);
  useEffect(() => {
    if (debToTimer.current) window.clearTimeout(debToTimer.current);
    if (!toQuery.trim() || pickedTo?.displayName === toQuery) return;
    debToTimer.current = window.setTimeout(async () => {
      try {
        const r = await geocodeAddress(toQuery);
        setToResults(r);
      } catch {
        setToResults([]);
      }
    }, 350);
  }, [toQuery, pickedTo]);

  async function handleBuildRoute() {
    if (!pickedFrom || !pickedTo) {
      setError("Выберите оба адреса (вводом или кликом по карте)");
      return;
    }
    setError(null);
    setLoadingRoute(true);
    setRoute(null);
    setTraffic(null);
    setSavedHint(null);
    try {
      const r = await fetchRoute(
        [pickedFrom.lat, pickedFrom.lng],
        [pickedTo.lat, pickedTo.lng],
      );
      setRoute(r);
      onRouteChange({
        from: { label: pickedFrom.displayName, point: [pickedFrom.lat, pickedFrom.lng] },
        to: { label: pickedTo.displayName, point: [pickedTo.lat, pickedTo.lng] },
        route: r,
      });
      // 1) пробуем реальный API (TomTom/HERE)
      let realTraffic: TrafficSample | null = null;
      if (hasTrafficProvider()) {
        const sampled = samplePath(r.path, Math.min(6, r.path.length));
        realTraffic = await fetchAvgTraffic(sampled);
      }
      if (realTraffic) {
        setTraffic(realTraffic);
        setTrafficSource("api");
        setTrafficSampleCount(0);
      } else {
        // Свободная скорость на ЭТОМ маршруте — от OSRM (учитывает что в
        // центре свободная скорость ниже, на магистралях выше).
        const freeFlow =
          r.durationMin > 0 ? (r.distanceKm / r.durationMin) * 60 : 40;
        // 2) пробуем вывести из накопленных наблюдений с замером km/min,
        //    в радиусе ~3 км от середины маршрута, в часе ±1 и том же дне
        const mid = r.path[Math.floor(r.path.length / 2)];
        const inferred = inferTrafficFromObservations(
          { lat: mid[0], lng: mid[1] },
          day,
          Math.floor(hour),
          observations,
          { freeFlowSpeedKmh: freeFlow },
        );
        if (inferred) {
          const ratio = multiplierToRatio(inferred.multiplier);
          setTraffic({
            currentSpeed: inferred.avgSpeed,
            freeFlowSpeed: freeFlow,
            ratio,
            provider: "tomtom",
          });
          setTrafficSource("observations");
          setTrafficSampleCount(inferred.sampleCount);
        } else {
          // 3) fallback — локальная модель пробок Минска по дню/часу
          const localMult = localTrafficTimeMultiplier(day, Math.floor(hour));
          const localRatio = multiplierToRatio(localMult);
          setTraffic({
            currentSpeed: freeFlow * localRatio,
            freeFlowSpeed: freeFlow,
            ratio: localRatio,
            provider: "tomtom",
          });
          setTrafficSource("local");
          setTrafficSampleCount(0);
        }
      }
    } catch (e) {
      setError(`Не удалось построить маршрут: ${(e as Error).message}`);
    } finally {
      setLoadingRoute(false);
    }
  }

  // Расчёт средних коэффициентов вдоль маршрута.
  const calc = useMemo(() => {
    if (!route) return null;
    const samples = samplePath(route.path, 8);
    let comfortAcc = 0;
    let economAcc = 0;
    for (const [lat, lng] of samples) {
      const interp = surgeAt(lat, lng, day, time, observations);
      const eco =
        predictEconom(interp.comfort).hidden ?? interp.econom;
      comfortAcc += interp.comfort;
      economAcc += eco;
    }
    const avgComfort = comfortAcc / samples.length;
    const avgEconom = economAcc / samples.length;
    // v3: тариф плоский (perKm=perMin=0), поэтому пробки больше нельзя
    // протащить через perMin·adjustedMin. Применяем их как мультипликатор
    // ПРЯМО к сёрджу. trafficTimeMultiplier по-прежнему используется для
    // отображения ETA на карте, но к цене он больше не относится.
    const trafficMult = traffic ? trafficTimeMultiplier(traffic.ratio) : 1;
    const trafficSurge = traffic ? trafficSurgeMultiplier(traffic.ratio) : 1;
    const km = route.distanceKm;
    const freeMin = route.durationMin;        // OSRM (свободный поток)
    const min = freeMin * trafficMult;         // ETA с учётом пробок (для UI)
    // route-multiplier: Yandex считает финальный сёрдж по 4 факторам — км,
    // время в пути, район и час. Используем 2D-таблицу (km × tripMin) из
    // routeSurgeMultiplier(): обучена на 139 свежих скринах, LOO-MAPE 19.7%
    // против 36% у одномерной distanceSurgeMultiplier по km. См. zones.ts
    // и scripts/learn-vps.mjs.  tripMin берём «с пробками» — это ближе всего
    // к Yandex tripMinToDest (он тоже учитывает текущий трафик).
    const distSurge = routeSurgeMultiplier(km, min);
    // Сёрдж после пробок зажимаем в SURGE_BOUNDS — те же границы, что и в
    // surgeAt(), чтобы не выйти за разумные пределы при сочетании высокого
    // спроса (×8) и катастрофических пробок (×1.8).
    const clampSurge = (s: number) =>
      Math.max(SURGE_BOUNDS.min, Math.min(SURGE_BOUNDS.max, s));
    const finalComfort = clampSurge(avgComfort * distSurge * trafficSurge);
    const finalEconom = clampSurge(avgEconom * distSurge * trafficSurge);
    const baseEconom = basePrice("econom", km, min);
    const baseComfort = basePrice("comfort", km, min);
    const priceEconom = baseEconom * finalEconom;
    const priceComfort = baseComfort * finalComfort;
    return {
      avgComfort, avgEconom, finalComfort, finalEconom,
      trafficBump: 0, trafficMult, trafficSurge, freeMin,
      baseEconom, baseComfort, priceEconom, priceComfort, km, min,
    };
  }, [route, day, time, observations, traffic]);

  // ML диапазон P10/P50/P90 — серверный CatBoost+H3 (MAPE 18%). При смене
  // маршрута/часа/пробок отменяем предыдущий запрос и шлём новый. demand
  // выводим из avgComfort surge (×>=1.4 → red, ×>=1.0 → yellow).
  useEffect(() => {
    if (!route || !calc || !pickedFrom || !pickedTo) {
      setMlRange(null);
      return;
    }
    const ctl = new AbortController();
    setMlLoading(true);
    const surge = calc.avgComfort;
    const demand: "red" | "yellow" | "green" =
      surge >= 1.4 ? "red" : surge >= 1.0 ? "yellow" : "green";
    const jsDow = new Date().getDay();
    const pyDow = (jsDow + 6) % 7; // 0=Mon..6=Sun
    predictPriceRange(
      {
        fromLat: pickedFrom.lat,
        fromLng: pickedFrom.lng,
        toLat: pickedTo.lat,
        toLng: pickedTo.lng,
        hour,
        dow: pyDow,
        demand,
        minutes: calc.min,
      },
      ctl.signal,
    )
      .then((r) => {
        if (!ctl.signal.aborted) setMlRange(r);
      })
      .finally(() => {
        if (!ctl.signal.aborted) setMlLoading(false);
      });
    return () => ctl.abort();
  }, [route, calc, pickedFrom, pickedTo, hour]);

  function handleSaveCorrection(forClass: "econom" | "comfort") {
    if (!route || !calc || !pickedFrom || !pickedTo) return;
    const yp = parseFloat(yandexPrice.replace(",", "."));
    if (!Number.isFinite(yp) || yp <= 0) {
      setError("Введите положительную цену в Яндексе (BYN)");
      return;
    }
    const base = forClass === "econom" ? calc.baseEconom : calc.baseComfort;
    if (base <= 0) return;
    const effSurge = +(yp / base).toFixed(3);
    const mid = route.path[Math.floor(route.path.length / 2)];
    const id = `route-${Date.now()}-${forClass}`;
    const obs: Observation = {
      id,
      lat: mid[0],
      lng: mid[1],
      day,
      slot: time,
      date: new Date().toISOString().slice(0, 10),
      source: "route-correction",
      notes: `${pickedFrom.displayName.split(",")[0]} → ${pickedTo.displayName.split(",")[0]} · Яндекс ${yp.toFixed(2)} BYN`,
      origin: "user-trip",
      ...(forClass === "comfort"
        ? { comfortSurge: effSurge }
        : { economSurge: effSurge, hiddenEconomSurge: effSurge }),
    };
    const merged = [...loadUserTrips(), obs];
    saveUserTrips(merged);
    setSavedHint(
      `Сохранено: ${forClass === "comfort" ? "Комфорт" : "Эконом"} ×${effSurge.toFixed(2)} в середине маршрута`,
    );
    setError(null);
  }

  // Сохраняет фактическое время поездки как замер (km, min, hour) — это
  // позволит в будущих расчётах для этой зоны/часа использовать реальную
  // скорость пользователя вместо локальной таблицы.
  function handleSaveActualTime() {
    if (!route || !pickedFrom || !pickedTo) return;
    const am = parseFloat(actualMin.replace(",", "."));
    if (!Number.isFinite(am) || am <= 0) {
      setError("Введите положительное время в минутах");
      return;
    }
    const mid = route.path[Math.floor(route.path.length / 2)];
    const speed = route.distanceKm / (am / 60);
    const id = `speed-${Date.now()}`;
    const obs: Observation = {
      id,
      lat: mid[0],
      lng: mid[1],
      day,
      slot: time,
      date: new Date().toISOString().slice(0, 16),
      hour: Math.floor(hour),
      km: route.distanceKm,
      min: am,
      source: "user-speed-measurement",
      notes: `${pickedFrom.displayName.split(",")[0]} → ${pickedTo.displayName.split(",")[0]} · ${route.distanceKm.toFixed(1)}км/${am.toFixed(0)}мин = ${speed.toFixed(1)} км/ч`,
      origin: "user-trip",
    };
    const merged = [...loadUserTrips(), obs];
    saveUserTrips(merged);
    setSavedActualHint(
      `Замер сохранён: ${speed.toFixed(1)} км/ч в этой зоне (${dayLabel}, ${Math.floor(hour)}:00). Будет учтён в будущих прогнозах.`,
    );
    setError(null);
  }

  function handleReset() {
    setRoute(null);
    setTraffic(null);
    setError(null);
    setSavedHint(null);
    setSavedActualHint(null);
    setActualMin("");
    setYandexPrice("");
    setFromQuery("");
    setToQuery("");
    setFromResults([]);
    setToResults([]);
    onPickedFromChange(null);
    onPickedToChange(null);
    onPickModeChange(null);
    onRouteChange(null);
  }

  function handleSwap() {
    const f = pickedFrom;
    const t = pickedTo;
    onPickedFromChange(t);
    onPickedToChange(f);
    setFromQuery(t?.displayName ?? "");
    setToQuery(f?.displayName ?? "");
    setRoute(null);
    onRouteChange(null);
  }

  const dayLabel = DAYS.find((d) => d.id === day)?.label ?? day;
  const slotLabel = TIME_SLOTS.find((t) => t.id === time)?.label ?? time;

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex items-start justify-between gap-2 p-4 border-b">
        <div>
          <div className="flex items-center gap-2 font-semibold text-base">
            <Navigation className="w-4 h-4" />
            Расчёт стоимости маршрута
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Введите адреса или поставьте точки кликом по карте. Можно сравнить
            нашу цену с Яндексом и сохранить корректировку.
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onClick={onClose}
          data-testid="button-close-route"
          title="Закрыть"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {/* From */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs flex items-center gap-1.5">
                <MapPin className="w-3 h-3 text-emerald-600" /> Откуда (А)
              </Label>
              <Button
                type="button"
                size="sm"
                variant={pickMode === "from" ? "default" : "ghost"}
                className="h-6 px-2 text-[11px] gap-1"
                onClick={() =>
                  onPickModeChange(pickMode === "from" ? null : "from")
                }
                data-testid="button-pick-from"
              >
                <Crosshair className="w-3 h-3" />
                {pickMode === "from" ? "Кликните по карте…" : "На карте"}
              </Button>
            </div>
            <Input
              value={fromQuery}
              onChange={(e) => {
                setFromQuery(e.target.value);
                if (pickedFrom && pickedFrom.displayName !== e.target.value) {
                  onPickedFromChange(null);
                }
              }}
              placeholder="напр. Ленина 1"
              data-testid="input-from"
            />
            {!pickedFrom && fromResults.length > 0 && (
              <div className="border rounded-md bg-popover max-h-44 overflow-y-auto relative z-50 shadow-md">
                {fromResults.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    className="w-full text-left text-xs px-2 py-1.5 hover:bg-accent"
                    onClick={() => onPickedFromChange(r)}
                  >
                    {r.displayName}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* To */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs flex items-center gap-1.5">
                <MapPin className="w-3 h-3 text-rose-600" /> Куда (Б)
              </Label>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  onClick={handleSwap}
                  disabled={!pickedFrom && !pickedTo}
                  title="Поменять местами"
                >
                  ↕
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={pickMode === "to" ? "default" : "ghost"}
                  className="h-6 px-2 text-[11px] gap-1"
                  onClick={() =>
                    onPickModeChange(pickMode === "to" ? null : "to")
                  }
                  data-testid="button-pick-to"
                >
                  <Crosshair className="w-3 h-3" />
                  {pickMode === "to" ? "Кликните по карте…" : "На карте"}
                </Button>
              </div>
            </div>
            <Input
              value={toQuery}
              onChange={(e) => {
                setToQuery(e.target.value);
                if (pickedTo && pickedTo.displayName !== e.target.value) {
                  onPickedToChange(null);
                }
              }}
              placeholder="напр. Смирнова 25"
              data-testid="input-to"
            />
            {!pickedTo && toResults.length > 0 && (
              <div className="border rounded-md bg-popover max-h-44 overflow-y-auto relative z-50 shadow-md">
                {toResults.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    className="w-full text-left text-xs px-2 py-1.5 hover:bg-accent"
                    onClick={() => onPickedToChange(r)}
                  >
                    {r.displayName}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleBuildRoute}
              disabled={!pickedFrom || !pickedTo || loadingRoute}
              className="flex-1 gap-2"
              data-testid="button-build-route"
            >
              {loadingRoute ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
              Рассчитать
            </Button>
            <Button variant="ghost" size="sm" onClick={handleReset}>
              Сброс
            </Button>
          </div>

          {error && (
            <div className="text-xs text-rose-600 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Результат */}
          {route && calc && (
            <div className="space-y-3 border-t pt-3">
              <div className="text-[11px] text-muted-foreground">
                {dayLabel} · {slotLabel} · {timeLabel ?? `${String(Math.floor(hour)).padStart(2, "0")}:00`}
                {route.fallback && (
                  <span className="ml-2 text-amber-600">
                    (грубая оценка, OSRM недоступен)
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded border p-2">
                  <div className="text-muted-foreground">Длина</div>
                  <div className="font-mono text-base font-bold">
                    {calc.km.toFixed(1)} км
                  </div>
                </div>
                <div className="rounded border p-2">
                  <div className="text-muted-foreground">Без пробок</div>
                  <div className="font-mono text-base font-bold">
                    {Math.round(calc.freeMin)} мин
                  </div>
                </div>
                <div className="rounded border p-2">
                  <div className="text-muted-foreground">С пробками</div>
                  <div
                    className={`font-mono text-base font-bold ${
                      calc.trafficMult > 1.5
                        ? "text-rose-600"
                        : calc.trafficMult > 1.2
                          ? "text-amber-600"
                          : "text-emerald-700"
                    }`}
                  >
                    {Math.round(calc.min)} мин
                  </div>
                </div>
              </div>

              <div className="rounded border p-2 text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
                  <Gauge className="w-3 h-3" /> Пробки
                </div>
                {traffic && (
                  <div>
                    <div className="font-mono">
                      {Math.round(traffic.currentSpeed)} /{" "}
                      {Math.round(traffic.freeFlowSpeed)} км/ч ·{" "}
                      <span
                        className={
                          traffic.ratio < 0.5
                            ? "text-rose-600 font-bold"
                            : traffic.ratio < 0.75
                              ? "text-amber-600"
                              : "text-emerald-600"
                        }
                      >
                        {Math.round(traffic.ratio * 100)}%
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      Время × {calc.trafficMult.toFixed(2)} ·{" "}
                      {trafficSource === "api"
                        ? `${trafficProviderName()} (live)`
                        : trafficSource === "observations"
                          ? `по вашим замерам (${trafficSampleCount})`
                          : "локальная модель Минска"}
                    </div>
                  </div>
                )}
                {!traffic && (
                  <div className="text-[11px] text-muted-foreground">
                    Пробки не учтены (нет данных).
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <PriceCard
                  label="Я. Эконом"
                  surge={calc.finalEconom}
                  baseSurge={calc.avgEconom}
                  trafficBump={calc.trafficBump}
                  price={calc.priceEconom}
                  mlRange={mlRange?.E ?? null}
                  mlLoading={mlLoading}
                />
                <PriceCard
                  label="Я. Комфорт"
                  surge={calc.finalComfort}
                  baseSurge={calc.avgComfort}
                  trafficBump={calc.trafficBump}
                  price={calc.priceComfort}
                  mlRange={mlRange?.C ?? null}
                  mlLoading={mlLoading}
                />
              </div>
              {mlRange && (
                <div className="text-[10px] text-muted-foreground -mt-1">
                  Диапазон Я. — серверный CatBoost+H3 ({mlRange.modelVersion.replace("catboost-h3-mq-", "")}, MAPE 18%/17%, h3_dist={mlRange.h3Dist})
                </div>
              )}

              {/* === Цена RWB Taxi (главная) ============================== */}
              <RwbPriceBlock
                km={calc.km}
                min={calc.min}
                hour={hour}
                day={day}
                yaEconom={calc.priceEconom}
                yaComfort={calc.priceComfort}
                surgeEconom={calc.finalEconom}
                surgeComfort={calc.finalComfort}
              />

              <div className="border-t pt-3 space-y-2">
                <Label className="text-xs">Я проехал маршрут за (мин)</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    inputMode="numeric"
                    value={actualMin}
                    onChange={(e) => setActualMin(e.target.value)}
                    placeholder={`напр. ${Math.round(calc.min)}`}
                    data-testid="input-actual-min"
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 shrink-0"
                    onClick={handleSaveActualTime}
                    data-testid="button-save-actual-time"
                  >
                    <Save className="w-3 h-3" /> Замер
                  </Button>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Замер реальной скорости в этой зоне/часе. Накопленные замеры
                  будут использованы для калибровки пробок в будущих расчётах.
                </div>
                {savedActualHint && (
                  <div className="text-[11px] text-emerald-600">
                    {savedActualHint}
                  </div>
                )}
              </div>

              <div className="border-t pt-3 space-y-2">
                <Label className="text-xs">Цена в Яндексе (BYN)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  inputMode="decimal"
                  value={yandexPrice}
                  onChange={(e) => setYandexPrice(e.target.value)}
                  placeholder="напр. 12.40"
                  data-testid="input-yandex-price"
                />
                <div className="text-[11px] text-muted-foreground">
                  Введите цену из Яндекса и нажмите кнопку класса —
                  запишем корректирующее наблюдение и пересчитаем карту.
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => handleSaveCorrection("econom")}
                    data-testid="button-save-econom"
                  >
                    <Save className="w-3 h-3" /> Эконом
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => handleSaveCorrection("comfort")}
                    data-testid="button-save-comfort"
                  >
                    <Save className="w-3 h-3" /> Комфорт
                  </Button>
                </div>
                {savedHint && (
                  <div className="text-[11px] text-emerald-600">
                    {savedHint}
                  </div>
                )}
              </div>
            </div>
          )}

          {!hasTrafficProvider() && (
            <div className="text-[10px] text-muted-foreground border-t pt-3 leading-relaxed">
              <div className="font-semibold mb-1">Как включить пробки:</div>
              Получить бесплатный ключ на{" "}
              <a
                href="https://developer.tomtom.com/"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                developer.tomtom.com
              </a>{" "}
              (2500/день) или{" "}
              <a
                href="https://developer.here.com/"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                developer.here.com
              </a>{" "}
              и положить в окружение сборки переменную{" "}
              <code className="bg-muted px-1 rounded">VITE_TOMTOM_KEY</code> или{" "}
              <code className="bg-muted px-1 rounded">VITE_HERE_KEY</code>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PriceCard({
  label,
  surge,
  baseSurge,
  trafficBump,
  price,
  mlRange,
  mlLoading,
}: {
  label: string;
  surge: number;
  baseSurge: number;
  trafficBump: number;
  price: number;
  mlRange?: PriceQuantile | null;
  mlLoading?: boolean;
}) {
  return (
    <div className="rounded border p-2 space-y-1">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className="font-mono text-lg font-bold">
        {price.toFixed(2)} BYN
      </div>
      <div className="text-[10px] text-muted-foreground">
        ×{surge.toFixed(2)}
        {trafficBump > 0 && (
          <span> = ×{baseSurge.toFixed(2)} + {trafficBump.toFixed(2)}</span>
        )}
      </div>
      {mlRange ? (
        <div className="text-[10px] border-t pt-1 mt-1 space-y-0.5">
          <div className="font-mono text-emerald-700 dark:text-emerald-400">
            {mlRange.low.toFixed(2)}–{mlRange.high.toFixed(2)}
            <span className="text-muted-foreground"> br</span>
          </div>
          <div className="text-muted-foreground">
            ML med {mlRange.med.toFixed(2)} (P10–P90)
          </div>
        </div>
      ) : mlLoading ? (
        <div className="text-[10px] border-t pt-1 mt-1 text-muted-foreground italic">
          ML…
        </div>
      ) : null}
    </div>
  );
}

/**
 * Главный блок RWB Taxi: показывает финальную цену клиенту по гибридной
 * формуле (своя ⚡-сетка + потолок −10% от Я. + пол снизу 7 br).
 * Я.-цена справа — как бенчмарк, чтобы клиент видел экономию.
 */
function RwbPriceBlock({
  km, min, hour, day, yaEconom, yaComfort, surgeEconom, surgeComfort,
}: {
  km: number;
  min: number;
  hour: number;
  day: DayType;
  yaEconom: number;
  yaComfort: number;
  surgeEconom: number;
  surgeComfort: number;
}) {
  const econ = rwbHybridPrice({ cls: "econom",  km, min, hour, day, yaEstimate: yaEconom,  surge: surgeEconom });
  const cmf  = rwbHybridPrice({ cls: "comfort", km, min, hour, day, yaEstimate: yaComfort, surge: surgeComfort });

  const srcLabel = (s: "own" | "ceiling" | "floor") =>
    s === "own"    ? "своя сетка"
  : s === "ceiling" ? `−${Math.round(RWB_DEMPING_VS_YA * 100)}% от Я.`
  : `пол ${RWB_FLOOR.toFixed(0)} br`;

  const slotRu = (s: string) => s === "day" ? "день" : s === "evening" ? "вечер" : "ночь";
  const kindRu = (k: string) => k === "weekday" ? "будни" : "выходные";
  const slotLabel = `${kindRu(cmf.own.kind)}-${slotRu(cmf.own.slot)}`;
  const [showGrid, setShowGrid] = useState(false);
  const [showExplain, setShowExplain] = useState(false);

  return (
    <div className="rounded-lg border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">
          🚕 Цена RWB Taxi
        </div>
        <div className="text-[10px] text-emerald-600 dark:text-emerald-400">
          тариф «{slotLabel}» + потолок −10% Я. + пол {RWB_FLOOR.toFixed(0)} br
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <RwbCard
          label="Эконом"
          finalPrice={econ.finalPrice}
          yaPrice={yaEconom}
          savingsPct={econ.savingsPct}
          source={econ.source}
          own={econ.own}
          ceiling={econ.yaCeiling}
          srcLabel={srcLabel(econ.source)}
          km={km}
          min={min}
        />
        <RwbCard
          label="Комфорт"
          finalPrice={cmf.finalPrice}
          yaPrice={yaComfort}
          savingsPct={cmf.savingsPct}
          source={cmf.source}
          own={cmf.own}
          ceiling={cmf.yaCeiling}
          srcLabel={srcLabel(cmf.source)}
          km={km}
          min={min}
        />
      </div>
      <button
        type="button"
        onClick={() => setShowExplain(v => !v)}
        className="w-full text-[11px] text-emerald-700 dark:text-emerald-300 hover:underline text-left pt-1"
      >
        {showExplain ? "▾" : "▸"} Как мы считаем цену (пошагово)
      </button>
      {showExplain && (
        <RwbCalcExplain econ={econ} cmf={cmf} km={km} min={min} slotLabel={slotLabel} />
      )}
      <button
        type="button"
        onClick={() => setShowGrid(v => !v)}
        className="w-full text-[11px] text-emerald-700 dark:text-emerald-300 hover:underline text-left pt-1"
      >
        {showGrid ? "▾" : "▸"} Сетки тарифов RWB для CRM (6 шт.)
      </button>
      {showGrid && <RwbAllTariffsTable activeKind={cmf.own.kind} activeSlot={cmf.own.slot} />}
    </div>
  );
}

/**
 * Пошаговая раскладка «как родилась финальная цена»: своя сетка → потолок Я. →
 * минимум 7 br. Показывает обе колонки (Эконом и Комфорт), объясняет какой шаг
 * стал решающим (своя/потолок/пол) и почему.
 */
function RwbCalcExplain({
  econ, cmf, km, min, slotLabel,
}: {
  econ: import("@/lib/zones").RwbHybridResult;
  cmf:  import("@/lib/zones").RwbHybridResult;
  km: number;
  min: number;
  slotLabel: string;
}) {
  const dempPct = Math.round(RWB_DEMPING_VS_YA * 100);

  const sourceBadge = (s: "own" | "ceiling" | "floor") => {
    const map = {
      own:     { txt: "своя сетка",     cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200" },
      ceiling: { txt: `потолок −${dempPct}%`, cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200" },
      floor:   { txt: `пол ${RWB_FLOOR} br`,  cls: "bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200" },
    } as const;
    const m = map[s];
    return <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${m.cls}`}>{m.txt}</span>;
  };

  const renderClass = (label: string, r: import("@/lib/zones").RwbHybridResult, ya: number) => {
    const o = r.own;
    const baseSum = Math.max(o.minimum, o.rawSum);
    const surgeUsed = o.surgeApplied > 1.0001;
    return (
      <div className="rounded border bg-white dark:bg-zinc-900 p-2 space-y-1.5 text-[10px] font-mono leading-snug">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-300 font-sans">
            {label}
          </div>
          {sourceBadge(r.source)}
        </div>

        {/* Шаг 1: своя сетка */}
        <div className="space-y-0.5">
          <div className="text-emerald-700 dark:text-emerald-300 font-sans">
            <b>1.</b> Своя сетка <span className="text-muted-foreground">«{slotLabel}»</span>
          </div>
          <div className="pl-3 text-muted-foreground">
            подача {o.tariff.pickup.toFixed(2)} + {o.tariff.perKm}·{km.toFixed(2)} км + {o.tariff.perMin}·{min.toFixed(1)} мин
          </div>
          <div className="pl-3">
            = {o.tariff.pickup.toFixed(2)} + {o.kmCost.toFixed(2)} + {o.minCost.toFixed(2)} = <b>{o.rawSum.toFixed(2)} br</b>
          </div>
          {o.rawSum < o.minimum && (
            <div className="pl-3 text-amber-700 dark:text-amber-300">
              ↑ ниже минимума {o.minimum} br → подняли до {baseSum.toFixed(2)} br
            </div>
          )}
          {surgeUsed ? (
            <div className="pl-3">
              ⚡ ×{o.surgeApplied.toFixed(2)} → <b>{o.price.toFixed(2)} br</b>
            </div>
          ) : (
            <div className="pl-3 text-muted-foreground/80">
              ⚡ surge не применяем (порог 1.5) → <b>{o.price.toFixed(2)} br</b>
            </div>
          )}
        </div>

        {/* Шаг 2: потолок */}
        <div className="space-y-0.5">
          <div className="text-amber-700 dark:text-amber-300 font-sans">
            <b>2.</b> Потолок −{dempPct}% от Я.
          </div>
          <div className="pl-3">
            Я. {ya.toFixed(2)} × {(1 - RWB_DEMPING_VS_YA).toFixed(2)} = <b>{r.yaCeiling.toFixed(2)} br</b>
          </div>
        </div>

        {/* Шаг 3: min(своя, потолок) */}
        <div className="space-y-0.5">
          <div className="text-zinc-700 dark:text-zinc-300 font-sans">
            <b>3.</b> Берём минимум из (1) и (2)
          </div>
          <div className="pl-3">
            min({o.price.toFixed(2)}, {r.yaCeiling.toFixed(2)}) = <b>{r.preFloorPrice.toFixed(2)} br</b>
          </div>
        </div>

        {/* Шаг 4: пол */}
        <div className="space-y-0.5">
          <div className="text-rose-700 dark:text-rose-300 font-sans">
            <b>4.</b> Пол: не ниже {RWB_FLOOR} br
          </div>
          <div className="pl-3">
            max({RWB_FLOOR.toFixed(2)}, {r.preFloorPrice.toFixed(2)}) = <b className="text-emerald-700 dark:text-emerald-300 text-[12px]">{r.finalPrice.toFixed(2)} br</b>
          </div>
        </div>

        <div className="pt-1 border-t text-muted-foreground font-sans">
          {r.reason}
          {r.savingsPct > 0 && (
            <span className="ml-1 font-bold text-emerald-700 dark:text-emerald-300">
              · экономия −{r.savingsPct.toFixed(0)}% vs Я.
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-emerald-700 dark:text-emerald-300 font-sans leading-snug">
        Цена считается в 4 шага. Берём минимальное из «нашей сетки» и «−{dempPct}% от Я.»,
        но не ниже {RWB_FLOOR} br. Так клиент всегда платит дешевле Я. — а водитель не везёт «за бесплатно».
      </div>
      <div className="grid grid-cols-2 gap-2">
        {renderClass("Эконом",  econ, econ.yaEstimate)}
        {renderClass("Комфорт", cmf,  cmf.yaEstimate)}
      </div>
    </div>
  );
}

const SLOT_LABELS: Record<TariffSlot, string> = { day: "день (06–17)", evening: "вечер (17–22)", night: "ночь (22–06)" };
const KIND_LABELS: Record<DayKind, string> = { weekday: "будни", weekend: "выходные" };
const SLOT_ORDER: TariffSlot[] = ["day", "evening", "night"];
const KIND_ORDER: DayKind[] = ["weekday", "weekend"];

function RwbAllTariffsTable({ activeKind, activeSlot }: { activeKind: DayKind; activeSlot: TariffSlot }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => {});
  };

  const fmtTariff = (t: RwbTariff) => `подача ${t.pickup} · мин ${t.minimum} · ${t.perKm} br/км · ${t.perMin} br/мин`;

  const renderClassTable = (cls: "comfort" | "econom") => (
    <div className="space-y-1">
      <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
        {cls === "comfort" ? "Комфорт" : "Эконом"}
      </div>
      <div className="rounded border bg-white dark:bg-zinc-900 overflow-hidden">
        <table className="w-full text-[10px] font-mono">
          <thead className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200">
            <tr>
              <th className="text-left px-1.5 py-1 font-semibold">слот</th>
              <th className="text-right px-1 py-1 font-semibold">подача</th>
              <th className="text-right px-1 py-1 font-semibold">минимум</th>
              <th className="text-right px-1 py-1 font-semibold">br/км</th>
              <th className="text-right px-1 py-1 font-semibold">br/мин</th>
            </tr>
          </thead>
          <tbody>
            {KIND_ORDER.flatMap(kind => SLOT_ORDER.map(slot => {
              const t = RWB_TARIFF_GRID[cls][kind][slot];
              const isActive = kind === activeKind && slot === activeSlot;
              return (
                <tr
                  key={`${kind}-${slot}`}
                  className={`border-t ${isActive ? "bg-emerald-50 dark:bg-emerald-950/40 font-bold" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}
                  onClick={() => copy(fmtTariff(t), `${cls}-${kind}-${slot}`)}
                  style={{ cursor: "pointer" }}
                  title="Клик — скопировать строку тарифа"
                >
                  <td className="px-1.5 py-1">
                    {isActive && <span className="text-emerald-600 mr-0.5">●</span>}
                    {KIND_LABELS[kind]} · {SLOT_LABELS[slot]}
                  </td>
                  <td className="text-right px-1 py-1">{t.pickup.toFixed(2)}</td>
                  <td className="text-right px-1 py-1">{t.minimum.toFixed(2)}</td>
                  <td className="text-right px-1 py-1">{t.perKm.toFixed(2)}</td>
                  <td className="text-right px-1 py-1">{t.perMin.toFixed(2)}</td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const fullJson = JSON.stringify(RWB_TARIFF_GRID, null, 2);

  return (
    <div className="space-y-2 pt-1">
      <div className="text-[10px] text-muted-foreground">
        Цена клиенту = max(минимум, подача + км×br/км + мин×br/мин). Подсветка ● — текущий слот.
        Клик по строке копирует тариф в буфер.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {renderClassTable("comfort")}
        {renderClassTable("econom")}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => copy(fullJson, "json")}
          className="text-[10px] px-2 py-1 rounded border border-emerald-500 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
        >
          📋 Скопировать всё (JSON)
        </button>
        {copied && (
          <span className="text-[10px] text-emerald-700 dark:text-emerald-300">
            ✓ скопировано: {copied}
          </span>
        )}
      </div>
    </div>
  );
}

function RwbCard({
  label, finalPrice, yaPrice, savingsPct, source, own, ceiling, srcLabel, km, min,
}: {
  label: string;
  finalPrice: number;
  yaPrice: number;
  savingsPct: number;
  source: "own" | "ceiling" | "floor";
  own: import("@/lib/zones").RwbOwnBreakdown;
  ceiling: number;
  srcLabel: string;
  km: number;
  min: number;
}) {
  const sourceColor =
    source === "own"     ? "text-emerald-700 dark:text-emerald-300"
  : source === "ceiling" ? "text-amber-700 dark:text-amber-300"
                         : "text-rose-700 dark:text-rose-300";
  return (
    <div className="rounded border bg-white dark:bg-zinc-900 p-2 space-y-1">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className="font-mono text-xl font-bold text-emerald-700 dark:text-emerald-300">
        {finalPrice.toFixed(2)} BYN
      </div>
      <div className="text-[10px] text-muted-foreground">
        Я. ≈ {yaPrice.toFixed(2)} br
        {savingsPct > 0 && (
          <span className="ml-1 font-bold text-emerald-600">
            −{savingsPct.toFixed(0)}%
          </span>
        )}
      </div>
      <div className={`text-[10px] ${sourceColor}`}>
        {srcLabel}
      </div>
      <div className="text-[9px] text-muted-foreground/70 font-mono leading-tight">
        {own.tariff.pickup > 0 && <>{own.tariff.pickup.toFixed(2)} + </>}
        {own.kmCost.toFixed(2)} ({own.tariff.perKm}×{km.toFixed(2)}км) + {own.minCost.toFixed(2)} ({own.tariff.perMin}×{min.toFixed(1)}мин) = {own.rawSum.toFixed(2)}
        {own.rawSum < own.minimum && <> {"<"} мин {own.minimum}</>}
      </div>
      <div className="text-[9px] text-muted-foreground/70 font-mono">
        своя {own.price.toFixed(2)} · потолок {ceiling.toFixed(2)}
      </div>
    </div>
  );
}
