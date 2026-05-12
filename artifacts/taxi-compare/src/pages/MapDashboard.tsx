import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  CircleMarker,
  Polyline,
  Marker,
  Popup,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { cellToBoundary, gridDisk, latLngToCell, cellToLatLng } from "h3-js";
import "leaflet/dist/leaflet.css";
import {
  ZONES,
  TIME_SLOTS,
  SCHEDULE_DAYS,
  scheduleDayToType,
  getCurrentScheduleDay,
  zoomToH3Res,
  type ScheduleDay,
  TaxiClass,
  DayType,
  hourToSlot,
  basePrice,
  surgeColor,
  surgeLabel,
  speedColor,
  speedLabel,
  BASE_TARIFF,
  buildExportJson,
  buildExportCsv,
  MINSK_CENTER,
  MKAD_RADIUS_KM,
  surgeAt,
  distanceKmFromCenter,
  METHODOLOGY,
  predictEconom,
  explainCell,
} from "@/lib/zones";
import { useBasemap } from "@/lib/basemaps";
import { BasemapPicker } from "@/components/BasemapPicker";
import { MapAttribution } from "@/components/MapAttribution";
import {
  inferTrafficFromObservations,
  hasTrafficProvider,
  trafficProviderName,
} from "@/lib/traffic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2,
  Sparkles,
  FileJson,
  FileSpreadsheet,
  HelpCircle,
  Database,
  Loader2,
  X,
  Navigation,
  Calculator,
  Target,
  Flame,
  Camera,
  BarChart3,
} from "lucide-react";
import UserTripsDialog from "@/components/UserTripsDialog";
import { CalibrationAccuracy } from "@/components/CalibrationAccuracy";
import LeaveOneOutDialog from "@/components/LeaveOneOutDialog";
import { AdminCalibComparison } from "@/components/AdminCalibComparison";
import { AdminCoverageMap } from "@/components/AdminCoverageMap";
import { AdminAnomalyReport } from "@/components/AdminAnomalyReport";
import { AdminScreensMap } from "@/components/AdminScreensMap";
import { AdminMlOverview } from "@/components/AdminMlOverview";
import { AdminOperatorStats } from "@/components/AdminOperatorStats";
import { AdminLoginPopover } from "@/components/AdminLoginPopover";
import { AdminPriceMonitorButton } from "@/components/AdminPriceMonitor";
import { HolesInfoDialog } from "@/components/HolesInfoDialog";
import { TariffBreakdownDialog } from "@/components/TariffBreakdownDialog";
import { useTariffBreakdown } from "../lib/useTariffBreakdown";
import { HolesOverlayLayer } from "@/components/HolesOverlayLayer";
import { LiveHexLayer } from "@/components/LiveHexLayer";
import { WeatherStripe } from "@/components/WeatherStripe";
import { EventsBadge } from "@/components/EventsBadge";
import { DemandForecastPanel } from "@/components/DemandForecastPanel";
import { LiveHexCellDialog } from "@/components/LiveHexCellDialog";
import type { LiveHex, TariffBreakdown } from "@/lib/live-hex";
import PriceSimulator from "@/components/PriceSimulator";
import RoutePlanner, { type ResolvedRoute, type PickMode } from "@/components/RoutePlanner";
import { FleetLayer } from "@/components/FleetLayer";
import { FleetHexLayer } from "@/components/FleetHexLayer";
import {
  distributeFleet,
  distributeFleetToHexes,
  fleetColor,
  fleetLabel,
} from "@/lib/fleet";
import { reverseGeocode, type GeocodeResult } from "@/lib/geocoder";
import {
  useExternalObservations,
  useUserTrips,
} from "@/hooks/use-observations";
import { useIsMobile } from "@/hooks/use-mobile";
import { useIsAdmin } from "@/lib/admin-auth";
import { useWbCurrentUser } from "@/lib/wb-auth";
import ViewerMapDashboard from "@/pages/ViewerMapDashboard";
import { MobileTopBar } from "@/components/MobileTopBar";
import { MobileBottomBar } from "@/components/MobileBottomBar";
import { MobileMenuSheet } from "@/components/MobileMenuSheet";
import { ScreenUploadFAB } from "@/components/ScreenUploadFAB";
import { RecommendedRoutesFAB, RecommendedRoutesIconButton } from "@/components/RecommendedRoutesPopover";
import { HelpButton } from "@/components/HelpButton";

function letterIcon(letter: string, color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};color:white;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3);font-weight:bold;font-size:13px;font-family:system-ui"><span style="transform:rotate(45deg)">${letter}</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  });
}

const ICON_FROM = letterIcon("А", "#10b981");
const ICON_TO = letterIcon("Б", "#ef4444");

const SAMPLE_KM = 5;
const SAMPLE_MIN = 12;

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ZoomTracker({ onZoomChange }: { onZoomChange: (z: number) => void }) {
  const map = useMapEvents({
    zoomend: () => onZoomChange(map.getZoom()),
  });
  useEffect(() => {
    onZoomChange(map.getZoom());
  }, [map, onZoomChange]);
  return null;
}

function MapClicker({
  enabled,
  onClick,
}: {
  enabled: boolean;
  onClick: (lat: number, lng: number) => void;
}) {
  const map = useMapEvents({
    click: (e) => {
      if (!enabled) return;
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  // Курсор-перекрестье когда активен режим выбора точки.
  useEffect(() => {
    const el = map.getContainer();
    if (enabled) el.style.cursor = "crosshair";
    else el.style.cursor = "";
    return () => {
      el.style.cursor = "";
    };
  }, [enabled, map]);
  return null;
}

function MethodologyDialog({
  controlledOpen,
  onControlledOpenChange,
  hideTrigger,
}: {
  controlledOpen?: boolean;
  onControlledOpenChange?: (o: boolean) => void;
  hideTrigger?: boolean;
} = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled
    ? onControlledOpenChange ?? (() => {})
    : setInternalOpen;
  // Живой снимок: подтягиваем актуальные числа из tariff-breakdown.json,
  // чтобы в диалоге вместо «обучено по 109 калибровкам (MAE=0.033)» было
  // ровно то, что отдаёт прод сейчас (после очередного cron-обучения
  // числа меняются — раньше тут был статический текст и устаревал).
  // Тайп-каст через unknown: реальный JSON на проде содержит больше полей,
  // чем static-снапшот (yandexTrend24h, liveHex, builtAt — добавлены недавно
  // на стороне cron-скрипта и в сборке могут отсутствовать у статического
  // импорта). Поэтому работаем как с opaque-объектом.
  const tbAny = useTariffBreakdown() as unknown as {
    yandexTrend24h?: {
      multiplierE: number; multiplierC: number; nE: number; nC: number;
      windowHours: number; shiftE: number; shiftC: number;
    };
    liveHex?: Record<string, { shrunken?: number; ageMinM?: number }>;
    baseline?: { econom?: { n?: number } };
    builtAt?: string;
    generatedAt?: string;
  };
  const yt = tbAny.yandexTrend24h;
  const liveHexEntries = Object.values(tbAny.liveHex || {});
  const liveHexCount = liveHexEntries.length;
  const liveYellow = liveHexEntries.filter((h) => (h.shrunken || 0) >= 1.10)
    .length;
  const baselineN = tbAny.baseline?.econom?.n ?? null;
  const builtAtRaw = tbAny.builtAt || tbAny.generatedAt || null;
  const lastBuilt = builtAtRaw ? new Date(builtAtRaw) : null;
  const liveAgeMin = liveHexCount
    ? Math.min(...liveHexEntries.map((h) => h.ageMinM ?? 9999))
    : null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8"
            data-testid="btn-methodology"
          >
            <HelpCircle className="w-3.5 h-3.5 mr-1" />
            Methodology
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Обоснование коэффициентов</DialogTitle>
          <DialogDescription>
            Как считается сёрдж в каждом гексагоне, откуда берутся множители
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-4 text-sm">
            <CalibrationAccuracy />

            {/* ─── Живой снимок: что прямо сейчас в модели карты ─── */}
            <section
              className="bg-emerald-50/80 border border-emerald-200 rounded p-3 space-y-1.5 text-xs"
              data-testid="methodology-live-snapshot"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-semibold text-emerald-900">
                  📡 Живой снимок модели
                </h3>
                {lastBuilt && (
                  <span className="text-[10px] text-emerald-700">
                    обновлено {lastBuilt.toLocaleString("ru-RU", {
                      day: "2-digit", month: "2-digit",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div className="bg-white/70 rounded px-2 py-1.5">
                  <div className="text-emerald-700/70">Калибровок</div>
                  <div className="font-mono font-semibold">
                    {baselineN ?? "—"}
                  </div>
                </div>
                <div className="bg-white/70 rounded px-2 py-1.5">
                  <div className="text-emerald-700/70">Live-гексов</div>
                  <div className="font-mono font-semibold">
                    {liveHexCount}
                    {liveYellow > 0 && (
                      <span className="ml-1 text-amber-700">
                        (🟡 {liveYellow})
                      </span>
                    )}
                  </div>
                </div>
                <div className="bg-white/70 rounded px-2 py-1.5">
                  <div className="text-emerald-700/70">YT24h Эконом</div>
                  <div className="font-mono font-semibold">
                    {yt ? `×${yt.multiplierE.toFixed(3)}` : "—"}
                    {yt && (
                      <span className="ml-1 text-[10px] text-emerald-700">
                        n={yt.nE}
                      </span>
                    )}
                  </div>
                </div>
                <div className="bg-white/70 rounded px-2 py-1.5">
                  <div className="text-emerald-700/70">YT24h Комфорт</div>
                  <div className="font-mono font-semibold">
                    {yt ? `×${yt.multiplierC.toFixed(3)}` : "—"}
                    {yt && (
                      <span className="ml-1 text-[10px] text-emerald-700">
                        n={yt.nC}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {liveAgeMin != null && (
                <div className="text-[10px] text-emerald-800/80">
                  Самый свежий live-скрин: <b>{liveAgeMin} мин назад</b>.
                  Модель автоматически переучивается раз в час; вкладка
                  обновляет цифры каждые 5 минут без перезагрузки.
                </div>
              )}
            </section>

            <section className="bg-muted/40 rounded p-3 space-y-2">
              <h3 className="font-semibold">
                Многослойная модель сёрджа (Live · YT24h · Зоны)
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Цвет каждого гекса — это итог трёх слоёв, наложенных друг на
                друга: <b>зональный</b> прогноз (база), <b>Yandex-trend24h</b>{" "}
                (глобальная поправка по последним 24ч) и <b>live-overlay</b>{" "}
                (локальная замена по свежим скринам &lt;6ч). Модель
                «живая» — каждое новое распознанное наблюдение в течение часа
                попадает в обучение.
              </p>
              <ol className="list-decimal pl-5 space-y-1 text-xs">
                <li>
                  <b>Точка-якорь (зона):</b> у каждой зоны Минска есть тип
                  (центр, спальник, ТЦ, премиум, промзона, транспортный узел,
                  аэропорт) и базовое значение Комфорт-сёрджа на «субботу
                  вечер» (часть зон — measured из ваших скриншотов 25.04, часть
                  — экспертная оценка по типу).
                </li>
                <li>
                  <b>Множитель день × время × тип зоны:</b> к якорю
                  применяется коэффициент, который зависит от типа зоны и
                  желаемого среза (см. ниже разбор по каждому типу).
                </li>
                <li>
                  <b>Эконом из Комфорта (по live-данным):</b> когда в гексе
                  есть свежие скрины, Эконом-сёрдж берётся{" "}
                  <b>напрямую из факта</b>, минуя hidden-модель. Без live —
                  применяется hb(cmf) по {baselineN ?? "200+"} калибровкам:
                  <ul className="list-disc pl-5">
                    <li>cmf &lt; 1.0 → hb ≈ 0.89 (низкий спрос → стимул)</li>
                    <li>cmf 1.0..1.2 → hb растёт 0.89 → 0.96 (переход)</li>
                    <li>cmf 1.2..5.0 → hb ≈ 0.96 (есть спрос → сжатая скидка)</li>
                    <li>cmf ≥ 5.0 → hb ≈ 0.97 (междугородние)</li>
                  </ul>
                  Yandex даёт скидку на Эконом и при низком, и при
                  экстремальном спросе; в умеренном (×1.5–2.5) скидка пропадает.
                </li>
                <li>
                  <b>Гексы и IDW:</b> для каждой соты — взвешенное среднее по
                  4 ближайшим зонам (вес = 1/d²). Resolution растёт с зумом.
                </li>
                <li>
                  <b>Yandex-trend24h booster (глобальный):</b> медиана
                  fact / baseline-OLS-прогноза по всем калибровкам за
                  последние 24ч. Сейчас{" "}
                  {yt ? (
                    <>
                      <b>×{yt.multiplierE.toFixed(3)}</b> для Эконома (n=
                      {yt.nE}) и <b>×{yt.multiplierC.toFixed(3)}</b> для
                      Комфорта (n={yt.nC})
                    </>
                  ) : (
                    "недоступно"
                  )}
                  . Множитель применяется ко всем гексам, у которых нет
                  локального live. Shrinkage k=10 — при малом n тренд
                  стягивается к 1.0, чтобы не врать на шуме.
                </li>
                <li>
                  <b>Live-overlay (локальный, &lt;6ч):</b> если в радиусе{" "}
                  ~0.7 км от центра гекса нашлось ≥2 свежих скринов —
                  зональный прогноз для этого гекса{" "}
                  <b>заменяется фактом</b> (медиана surge с shrinkage k=3).
                  Сейчас активно <b>{liveHexCount}</b> live-гексов
                  {liveYellow > 0 ? (
                    <>
                      , из них <b>{liveYellow}</b> жёлтых/красных (≥×1.10)
                    </>
                  ) : null}
                  . Это позволяет видеть пиковые цены в районе раньше, чем
                  они «успокоятся» в часовой OLS-регрессии.
                </li>
              </ol>
            </section>
            {Object.entries(METHODOLOGY).map(([type, m]) => (
              <section key={type} className="border rounded p-3">
                <h3 className="font-semibold text-sm mb-1.5">
                  {m.title}{" "}
                  <span className="text-xs text-muted-foreground font-mono">
                    ({type})
                  </span>
                </h3>
                <ul className="text-xs space-y-1 list-disc pl-5">
                  {m.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </section>
            ))}
            <section className="bg-amber-50 border border-amber-200 rounded p-3 text-xs">
              <h3 className="font-semibold mb-1">Что эта модель НЕ учитывает</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Точную погоду (дождь / снег) — реальный сёрдж может быть выше.</li>
                <li>Концерты, матчи, госмероприятия — точечные всплески.</li>
                <li>
                  <b>Пробки и перекрытия в районах без свежих скринов:</b>{" "}
                  где live-overlay молчит, видна только «типичная» картина для
                  среза день × время. В зонах со свежими скринами (см.
                  жёлтые гексы) пробки и события{" "}
                  <i>уже учтены автоматически</i> — потому что переписывают
                  прогноз фактическим surge.
                </li>
                <li>
                  Внутрислотовые фазы вне live-зон: midday может за 45 мин
                  схлопнуться от ×3.5 до ×1.8. Если в этом гексе нет live —
                  карта покажет усреднение по слоту и недооценит пик.
                </li>
              </ul>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

type HexCell = {
  id: string;
  boundary: [number, number][];
  centerLatLng: [number, number];
  surge: number;
  comfortSurge: number;
  economSurge: number;
  hiddenSurge?: number;
  source: "measured" | "blended" | "predicted";
  topZoneName: string;
  topZoneId: string;
  /** Средняя скорость по замерам в этом гексе (км/ч). null если данных нет. */
  avgSpeed: number | null;
  /** Сколько замеров вошло в среднее. */
  speedSamples: number;
  /** true → сёрдж переписан live-overlay'ем (скрины <6ч). false → зональная модель × yandex-trend. */
  liveOverride: boolean;
  /** Возраст самого нового/старого скрина в этом гексе, минут. null если нет live. */
  liveAge: { minM: number; maxM: number; n: number } | null;
};

// Inline haversine, чтобы не зависеть от приватного хелпера в lib/zones.ts.
function haversineKmInline(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]), lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

type ViewMode = "surge" | "speed" | "fleet";

function HexExplainHeader({ hex, cls }: { hex: HexCell; cls: TaxiClass }) {
  const zone = ZONES.find((z) => z.id === hex.topZoneId)!;
  const color = surgeColor(hex.surge);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className="font-mono text-xl font-bold tabular-nums"
          style={{ color }}
        >
          ×{hex.surge.toFixed(2)}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {cls === "econom" ? "Эконом" : "Комфорт"} · {surgeLabel(hex.surge)}
        </span>
        {hex.source === "measured" && (
          <Badge className="bg-emerald-600 gap-1 text-[10px]">
            <CheckCircle2 className="w-2.5 h-2.5" />
            замер
          </Badge>
        )}
        {hex.source === "blended" && (
          <Badge variant="secondary" className="text-[10px]">смешан</Badge>
        )}
        {hex.source === "predicted" && (
          <Badge variant="outline" className="text-[10px] text-rose-600">
            прогноз
          </Badge>
        )}
      </div>
      <div className="text-[11px] font-semibold leading-tight truncate">
        {zone.nameRu}
      </div>
    </div>
  );
}

function HexExplainPopup({
  hex,
  cls,
  day,
  time,
  hour,
  hideHeader = false,
  viewMode = "surge",
}: {
  hex: HexCell;
  cls: TaxiClass;
  day: DayType;
  time: import("@/lib/zones").TimeSlot;
  hour: number;
  hideHeader?: boolean;
  viewMode?: ViewMode;
}) {
  const zone = ZONES.find((z) => z.id === hex.topZoneId)!;
  const exp = explainCell(zone, day, time, hex.comfortSurge, !!hex.hiddenSurge);
  const tariff = BASE_TARIFF[cls];
  const minimum = tariff.minimum;
  const color = surgeColor(hex.surge);
  const tariffBreakdown = useTariffBreakdown();
  const empBase = tariffBreakdown.baseline[cls];
  const refKm = 5, refMin = 12;
  const baselineRaw = empBase.base + empBase.perMin * refMin + (empBase.perKm ?? 0) * refKm;
  const basePriceNoSurge = Math.max(minimum, baselineRaw);
  const finalRefPrice = basePriceNoSurge * hex.surge;
  return (
    <div className="text-xs space-y-2">
      {viewMode === "speed" && (
        <div className="rounded border bg-muted/30 p-2 space-y-1">
          <div className="font-semibold text-[11px]">
            Скорость в этой зоне
          </div>
          {hex.avgSpeed !== null ? (
            <>
              <div className="text-[11px] leading-snug">
                Средняя:{" "}
                <span
                  className="font-mono font-bold"
                  style={{ color: speedColor(hex.avgSpeed) }}
                >
                  {hex.avgSpeed.toFixed(1)} км/ч
                </span>{" "}
                · {speedLabel(hex.avgSpeed)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                По {hex.speedSamples}{" "}
                {hex.speedSamples === 1 ? "замеру" : "замерам"} в радиусе 1.5 км
                · {exp.dayRu} · {String(hour).padStart(2, "0")}:00 (±1 ч).
              </div>
              <div className="text-[10px] text-muted-foreground italic pt-1 border-t">
                Гармоническое среднее по темпу (мин/км). Для оценки времени
                поездки и пробочного множителя используется в маршруте А→Б.
              </div>
            </>
          ) : (
            <>
              <div className="text-[11px] leading-snug">
                <span className="font-mono text-muted-foreground">— нет данных —</span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                В радиусе 1.5 км для этого часа (±1 ч) и дня нет ваших замеров.
                Поездите по этому району и сохраните «Замер» в маршруте А→Б —
                цвет соты появится.
              </div>
            </>
          )}
        </div>
      )}
      {!hideHeader && (
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-bold text-sm leading-tight">{exp.zoneNameRu}</div>
            <div className="text-[10px] text-muted-foreground">
              {exp.zoneTypeRu}
            </div>
          </div>
          {hex.source === "measured" && (
            <Badge className="bg-emerald-600 gap-1 text-[10px] shrink-0">
              <CheckCircle2 className="w-2.5 h-2.5" />
              замер
            </Badge>
          )}
          {hex.source === "blended" && (
            <Badge variant="secondary" className="text-[10px] shrink-0">
              смешан
            </Badge>
          )}
          {hex.source === "predicted" && (
            <Badge
              variant="outline"
              className="text-[10px] text-rose-600 shrink-0"
            >
              прогноз
            </Badge>
          )}
        </div>
      )}

      <div className="rounded border bg-muted/30 p-2 space-y-1.5">
        <div className="font-semibold text-[11px]">Почему такой коэффициент</div>
        <div className="text-[11px] leading-snug">
          <b>{exp.dayRu}, {exp.timeRu}.</b> {exp.reason}.
        </div>

        {/* Цепочка: базовый сёрдж зоны × коэффициент среза = итог */}
        <div className="pt-1 border-t border-border/50 space-y-0.5">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Расчёт сёрджа
          </div>
          <div className="text-[11px] font-mono flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
            <span className="text-muted-foreground">база зоны</span>
            <span className="font-semibold">×{exp.baselineSurge.toFixed(2)}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">коэф. среза</span>
            <span className="font-semibold">×{exp.multiplier.toFixed(2)}</span>
            <span className="text-muted-foreground">=</span>
            <span className="font-bold" style={{ color }}>
              ×{hex.comfortSurge.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Базовая цена → итоговая цена для эталонной поездки */}
        <div className="pt-1 border-t border-border/50 space-y-0.5">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Эталонная поездка ({refKm} км · {refMin} мин)
          </div>
          <div className="text-[11px] font-mono flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
            <span className="text-muted-foreground">без сёрджа</span>
            <span>{basePriceNoSurge.toFixed(2)} BYN</span>
            <span className="text-muted-foreground">×</span>
            <span>{hex.surge.toFixed(2)}</span>
            <span className="text-muted-foreground">=</span>
            <span className="font-bold" style={{ color }}>
              ~{finalRefPrice.toFixed(2)} BYN
            </span>
          </div>
        </div>

        {cls === "econom" && hex.hiddenSurge && (
          <div className="text-[11px] leading-snug pt-1 border-t border-border/50">
            Эконом-сёрдж = Комфорт × hb(cmf):{" "}
            <span className="font-mono font-semibold">×{hex.hiddenSurge.toFixed(2)}</span>.{" "}
            При cmf&lt;1 hb=0.89, при cmf≥1 hb≈0.96, у дальних cmf≥5 hb=0.97.
          </div>
        )}
      </div>

      <HexTariffBlock
        cls={cls}
        hex={hex}
        minimum={minimum}
        color={color}
      />

      <div className="text-[10px] italic text-muted-foreground leading-snug border-t pt-1.5">
        * Значения примерные и считаются для оптимального баланса
        водителей и клиентов в районе. При <b>дефиците</b> авто (дождь, снег,
        концерт, час пик, перекрытия) реальный сёрдж будет <b>выше</b>; при{" "}
        <b>профиците</b> (много свободных машин, спад спроса) — <b>ниже</b>.
        Модель показывает «типичную картину» для выбранного среза день × время.
      </div>
    </div>
  );
}

// Расчёт тарифа в попапе гекса. Все числа берутся из public/data/tariff-breakdown.json,
// собран по реальным yellow+red скринам Yandex Go (см. baseline.econom.n).
// Формула — гибридная 2-факторная OLS: price = base + perMin·мин + perKm·км.
// До v19 perKm подразумевался ≈ 0 — это сильно недооценивало длинные поездки
// (промах +80% на 30+ мин × 7-15 км). С гибридом тот же сегмент даёт +15%.
function HexTariffBlock({
  cls,
  hex,
  minimum,
  color,
}: {
  cls: TaxiClass;
  hex: HexCell;
  minimum: number;
  color: string;
}) {
  const tariffBreakdown = useTariffBreakdown();
  const empBase = tariffBreakdown.baseline[cls];
  const surge = hex.surge;
  const samples: { label: string; km: number; min: number }[] = [
    { label: "Короткая", km: 3, min: 8 },
    { label: "Средняя", km: 5, min: 12 },
    { label: "Длинная", km: 12, min: 30 },
  ];

  return (
    <div className="rounded border p-2 space-y-1.5">
      <div className="font-semibold text-[11px]">
        Расчёт тарифа · {cls === "econom" ? "Эконом" : "Комфорт"}
      </div>

      {/* Базовые параметры — из эмпирики по реальным скринам.
          В v19+ baseline.perKm > 0 (гибрид). На старых JSON или fallback'е perKm
          отсутствует — показываем «≈ 0» как до гибрида. */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
        <span className="text-muted-foreground">База Yandex Go:</span>
        <span className="font-mono">{empBase.base.toFixed(2)} BYN</span>
        <span className="text-muted-foreground">За минуту:</span>
        <span className="font-mono">{empBase.perMin.toFixed(2)} BYN/мин</span>
        <span className="text-muted-foreground">За км:</span>
        <span
          className={
            empBase.perKm && empBase.perKm > 0
              ? "font-mono"
              : "font-mono text-muted-foreground"
          }
        >
          {empBase.perKm && empBase.perKm > 0
            ? `${empBase.perKm.toFixed(2)} BYN/км`
            : "≈ 0 BYN/км*"}
        </span>
        <span className="text-muted-foreground">Минимальная цена:</span>
        <span className="font-mono">{minimum} BYN</span>
        <span className="text-muted-foreground">Текущий коэффициент:</span>
        <span className="font-mono font-bold" style={{ color }}>
          ×{surge.toFixed(2)} {surgeLabel(surge)}
        </span>
      </div>

      {/* Три примера: короткая / средняя / длинная поездка */}
      <div className="border-t pt-1.5 mt-1 space-y-1">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Примеры поездки в этой зоне сейчас
        </div>
        {samples.map((s) => {
          // Гибридная формула: base + perMin·мин + perKm·км. На старом JSON
          // (без perKm) → второй term = 0 → старая 1-факторная формула.
          const perKm = empBase.perKm ?? 0;
          const kmTerm = perKm * s.km;
          const baselineRaw = empBase.base + empBase.perMin * s.min + kmTerm;
          const beforeSurge = Math.max(minimum, baselineRaw);
          const total = beforeSurge * surge;
          const minHit = baselineRaw < minimum;
          return (
            <div
              key={s.label}
              className="text-[11px] leading-tight grid grid-cols-[64px_1fr_auto] items-center gap-1.5"
              data-testid={`tariff-sample-${s.label.toLowerCase()}`}
            >
              <span className="font-medium">{s.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {s.km}км/{s.min}мин · {empBase.base.toFixed(2)}+
                {empBase.perMin.toFixed(2)}×{s.min}
                {perKm > 0 && (
                  <>+{perKm.toFixed(2)}×{s.km}</>
                )}
                ={baselineRaw.toFixed(2)}
                {minHit && (
                  <span className="text-amber-700"> →мин.{minimum}</span>
                )}{" "}
                ×{" "}
                <span style={{ color }}>{surge.toFixed(2)}</span>
              </span>
              <span
                className="font-mono font-bold tabular-nums"
                style={{ color }}
              >
                {total.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="text-[9.5px] text-muted-foreground italic pt-0.5 border-t border-border/30">
        * По {tariffBreakdown.basedOn.usable} скринам Yandex почти не тарифицирует км — только время.
        R²={Math.round((empBase.r2 ?? 0) * 100)}%, MAPE±{Math.round((empBase.mape ?? 0) * 100)}%.
      </div>
    </div>
  );
}

function getCurrentMinuteOfDay(): number {
  const now = new Date();
  const total = now.getHours() * 60 + now.getMinutes();
  // floor к ближайшим 10 мин: 10:06 → 10:00 (а не 10:10).
  // Так slider не показывает «будущее» в режиме автоследования.
  return Math.min(1430, Math.max(0, Math.floor(total / 10) * 10));
}

// Wrapper: для роли viewer (rwb и подобные) показываем упрощённый ViewerMapDashboard
// (только карта + 2 FAB). Для admin/antifraud — полный MapDashboardImpl.
// Условный return стоит в wrapper-компоненте — там до него только один хук
// (useWbCurrentUser), поэтому правила хуков не нарушаются: тяжёлый MapDashboardImpl
// рендерится либо целиком, либо вообще не рендерится.
export default function MapDashboard() {
  const me = useWbCurrentUser();
  if (me?.role === "viewer") return <ViewerMapDashboard />;
  return <MapDashboardImpl />;
}

function MapDashboardImpl() {
  // День недели: храним 7-дневный UI-вариант (пн..вс), к 3-категорийному
  // backend (weekday/saturday/sunday) проектируем через scheduleDayToType.
  // Default — текущий день недели у пользователя.
  const [scheduleDay, setScheduleDay] = useState<ScheduleDay>(() => getCurrentScheduleDay());
  const day: DayType = scheduleDayToType(scheduleDay);
  const [minute, setMinute] = useState<number>(() => getCurrentMinuteOfDay());
  // autoFollow=true → таймлайн и день автоматически догоняют реальное «сейчас»
  // (опрос раз в 30 сек). Любое ручное движение слайдера или клик по другому
  // дню недели — выключает auto-follow. Кнопка «Сейчас» включает обратно.
  const [autoFollow, setAutoFollow] = useState<boolean>(true);
  useEffect(() => {
    if (!autoFollow) return;
    // Сразу синхронизируем (на случай если страница долго была открыта).
    setMinute(getCurrentMinuteOfDay());
    setScheduleDay(getCurrentScheduleDay());
    const id = window.setInterval(() => {
      setMinute(getCurrentMinuteOfDay());
      setScheduleDay(getCurrentScheduleDay());
    }, 30_000);
    return () => window.clearInterval(id);
  }, [autoFollow]);
  const hour = Math.floor(minute / 60);
  const minOfHour = minute % 60;
  const timeLabel = `${String(hour).padStart(2, "0")}:${String(minOfHour).padStart(2, "0")}`;
  const [cls, setCls] = useState<TaxiClass>("comfort");
  const [viewMode, setViewMode] = useState<ViewMode>("surge");
  const [zoom, setZoom] = useState(11);
  const basemap = useBasemap();
  const [totalCars, setTotalCars] = useState<number>(500);
  const [reservePct, setReservePct] = useState<number>(15);
  // 1.0 = обычный день, 0.5 = тихо/ночь, 2.0 = час пик / непогода / праздник
  const [demandScale, setDemandScale] = useState<number>(1.0);
  const [demandForecastOpen, setDemandForecastOpen] = useState<boolean>(false);
  const [selectedHexId, setSelectedHexId] = useState<string | null>(null);
  const [resolvedRoute, setResolvedRoute] = useState<ResolvedRoute | null>(null);
  const [pickedFrom, setPickedFrom] = useState<GeocodeResult | null>(null);
  // Хук подмешивает в карту: (1) yandex-trend24h поверх зональной модели,
  // (2) live-overlay из скринов <6ч для гексов где они есть. См. ниже useMemo<HexCell[]>.
  const tariffBreakdown = useTariffBreakdown();
  const [pickedTo, setPickedTo] = useState<GeocodeResult | null>(null);
  const [pickMode, setPickMode] = useState<PickMode>(null);
  const [routeOpen, setRouteOpen] = useState(false);
  // Controlled state для диалогов — нужно чтобы открывать их программно
  // из мобильного гамбургер-меню (MobileMenuSheet).
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [looOpen, setLooOpen] = useState(false);
  const [calibCompareOpen, setCalibCompareOpen] = useState(false);
  const [coverageMapOpen, setCoverageMapOpen] = useState(false);
  const [anomalyReportOpen, setAnomalyReportOpen] = useState(false);
  const [screensMapOpen, setScreensMapOpen] = useState(false);
  const [mlOverviewOpen, setMlOverviewOpen] = useState(false);
  const [operatorStatsOpen, setOperatorStatsOpen] = useState(false);
  const [holesInfoOpen, setHolesInfoOpen] = useState(false);
  // Слой «Дыры» включён по умолчанию: на странице анализа сразу видно
  // откуда поступали заказы (точки А) и где «дыры» — пустые соты, где
  // данных мало или нет. Раньше требовалось ручное включение через
  // онбординг — это путало пользователей (карта казалась пустой).
  // Онбординг автоматически отмечаем как «показанный», чтобы тогглы
  // в шапке/FAB сразу работали как обычные включить/выключить.
  const [holesLayerOn, setHolesLayerOn] = useState(true);
  // Live-Hex слой Яндекса (огонёк): отдельный toggle. По умолчанию ВЫКЛ
  // в админке — у тебя уже есть «дыры» включёнными, чтобы не стек слоёв.
  const [liveLayerOn, setLiveLayerOn] = useState(false);
  const [selectedLiveHex, setSelectedLiveHex] = useState<LiveHex | null>(null);
  const [selectedLiveBreakdown, setSelectedLiveBreakdown] =
    useState<TariffBreakdown | null>(null);
  const [liveHexDialogOpen, setLiveHexDialogOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem("rwb-holes-onboarded")) {
      localStorage.setItem("rwb-holes-onboarded", "1");
    }
  }, []);
  const toggleHolesLayer = () => {
    setHolesLayerOn((prev) => !prev);
  };
  const handleHolesIntroChange = (open: boolean) => {
    setHolesInfoOpen(open);
    if (!open) {
      try {
        if (
          typeof window !== "undefined" &&
          !localStorage.getItem("rwb-holes-onboarded")
        ) {
          localStorage.setItem("rwb-holes-onboarded", "1");
          setHolesLayerOn(true);
        }
      } catch {}
    }
  };
  const [priceSimOpen, setPriceSimOpen] = useState(false);
  const [tripsOpen, setTripsOpen] = useState(false);
  const isMobile = useIsMobile();
  const isAdmin = useIsAdmin();
  const mapRef = useRef<L.Map | null>(null);

  // Когда панель маршрута открывается/закрывается — карта меняет ширину,
  // нужно сообщить Leaflet чтобы он перерисовал плитки.
  useEffect(() => {
    const t = window.setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 200);
    return () => window.clearTimeout(t);
  }, [routeOpen]);

  // Когда обе точки заданы — сбрасываем режим выбора.
  useEffect(() => {
    if (pickMode === "from" && pickedFrom) setPickMode(null);
    if (pickMode === "to" && pickedTo) setPickMode(null);
  }, [pickMode, pickedFrom, pickedTo]);

  async function handleMapPick(lat: number, lng: number) {
    if (!pickMode) return;
    const target = pickMode;
    // Сразу ставим временный пин по координатам, чтоб не ждать сети.
    const stub: GeocodeResult = {
      lat,
      lng,
      displayName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      type: "point",
    };
    if (target === "from") setPickedFrom(stub);
    else setPickedTo(stub);
    try {
      const real = await reverseGeocode(lat, lng);
      if (target === "from") setPickedFrom(real);
      else setPickedTo(real);
    } catch {
      // оставляем заглушку с координатами
    }
    // Возвращаем панель маршрута
    setRouteOpen(true);
  }

  const time = hourToSlot(hour);
  const timeSlot = TIME_SLOTS.find((t) => t.id === time)!;

  // При смене зума id-сот меняется (другая H3-резолюция), сбрасываем выбор.
  useEffect(() => {
    setSelectedHexId(null);
  }, [zoom]);

  const stats = useMemo(() => {
    const measured = ZONES.filter(
      (z) => z.surge[day][time].source === "measured",
    ).length;
    return { measured, predicted: ZONES.length - measured };
  }, [day, time]);

  // 1. Geometry: depends only on zoom. Heavy gridDisk + cellToBoundary done once per zoom.
  const cellGeometry = useMemo(() => {
    const res = zoomToH3Res(zoom);
    const centerHex = latLngToCell(MINSK_CENTER[0], MINSK_CENTER[1], res);
    // k chosen to just cover MKAD radius (11 km) at each resolution + small margin
    const k = res === 7 ? 8 : res === 8 ? 18 : 45;
    const cells = gridDisk(centerHex, k);
    const out: {
      id: string;
      boundary: [number, number][];
      centerLatLng: [number, number];
    }[] = [];
    for (const cell of cells) {
      const [lat, lng] = cellToLatLng(cell);
      if (distanceKmFromCenter(lat, lng) > MKAD_RADIUS_KM) continue;
      out.push({
        id: cell,
        boundary: cellToBoundary(cell, false) as [number, number][],
        centerLatLng: [lat, lng],
      });
    }
    return out;
  }, [zoom]);

  // 2. Surge overlay: per-cell values for current day/time/cls. Recomputes
  //    when filters change but never re-creates geometry. Hidden surge for
  //    Эконом is derived from the interpolated comfort value via predictEconom
  //    so the formula stays consistent everywhere.
  const externalObs = useExternalObservations();
  const userTrips = useUserTrips();
  const allObservations = useMemo(
    () => [...(externalObs.data ?? []), ...userTrips],
    [externalObs.data, userTrips],
  );

  // selectedHex объявлен ниже — но т.к. это просто find по id, считаем после hexes.

  // ─── Подмешиваем «живые» данные из автообучения поверх зональной модели ────
  // 1) yandex-trend24h — глобальный множитель ×0.95–×1.20, насколько
  //    Yandex отошёл от долгосрочной baseline за последние 24ч.
  //    Применяется ВСЕГДА к зональной модели (даже там где нет свежих скринов),
  //    чтобы карта не отставала от реального движения цен.
  // 2) liveHex — гекс перекрашивается реальным сёрджем по скринам <6ч,
  //    если в нём ≥2 таких скрина. Это ловит локальные пики (концерт, ДТП,
  //    конец смены), которые зональная модель пропускает.
  const yt = tariffBreakdown.yandexTrend24h;
  const liveBoostE = yt?.multiplierE ?? 1;
  const liveBoostC = yt?.multiplierC ?? 1;
  const liveHexEntries = useMemo(
    () => Object.values(tariffBreakdown.liveHex || {}),
    [tariffBreakdown.liveHex],
  );

  const hexes = useMemo<HexCell[]>(() => {
    function findLiveHex(lat: number, lon: number) {
      // 0.7 км — половина диагонали 0.01°-сетки, нормальный радиус «match».
      let best: typeof liveHexEntries[number] | null = null;
      let bestD = 0.7;
      for (const h of liveHexEntries) {
        const d = haversineKmInline([lat, lon], [h.lat, h.lon]);
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      }
      return best;
    }
    return cellGeometry.map((g) => {
      const interp = surgeAt(
        g.centerLatLng[0],
        g.centerLatLng[1],
        day,
        time,
        allObservations,
      );
      const live = findLiveHex(g.centerLatLng[0], g.centerLatLng[1]);
      // Если есть live-скрины — реальный сёрдж по факту (он уже включает
      // и yandex-trend, и локальный пик); иначе — зональная × global trend.
      const liveActive = !!(live && live.surgeE > 0 && live.surgeC > 0);
      let economSurge: number;
      let comfortSurge: number;
      if (liveActive) {
        economSurge = live!.surgeE;
        comfortSurge = live!.surgeC;
      } else {
        economSurge = interp.econom * liveBoostE;
        comfortSurge = interp.comfort * liveBoostC;
      }
      const derivedHidden = predictEconom(comfortSurge).hidden;
      // Когда есть live для Эконома — берём его НАПРЯМУЮ, минуя hidden-модель.
      // Иначе hidden бы перезаписал реальный факт (в predictEconom hidden
      // всегда ≠ undefined → live.surgeE никогда бы не дошёл до карты).
      const surge =
        cls === "econom"
          ? (liveActive ? economSurge : (derivedHidden ?? economSurge))
          : comfortSurge;
      const speedInfo = inferTrafficFromObservations(
        { lat: g.centerLatLng[0], lng: g.centerLatLng[1] },
        day,
        hour,
        allObservations,
        { radiusKm: 1.5 },
      );
      return {
        id: g.id,
        boundary: g.boundary,
        centerLatLng: g.centerLatLng,
        surge,
        comfortSurge,
        economSurge,
        hiddenSurge: derivedHidden,
        source: interp.source,
        topZoneName: interp.topZone.nameEn,
        topZoneId: interp.topZone.id,
        avgSpeed: speedInfo?.avgSpeed ?? null,
        speedSamples: speedInfo?.sampleCount ?? 0,
        liveOverride: liveActive,
        liveAge: liveActive
          ? { minM: live!.ageMinM, maxM: live!.ageMaxM, n: live!.n }
          : null,
      };
    });
  }, [
    cellGeometry, day, time, cls, hour, allObservations,
    liveHexEntries, liveBoostE, liveBoostC,
  ]);

  const selectedHex = useMemo(
    () => (selectedHexId ? hexes.find((h) => h.id === selectedHexId) ?? null : null),
    [hexes, selectedHexId],
  );

  // Распределение парка по зонам (только когда нужно — учитывая viewMode).
  // Пересчёт лёгкий: ZONES.length × hourToSlot, можно держать всегда.
  const fleetSummary = useMemo(
    () =>
      distributeFleet(totalCars, hour, day, {
        reservePct: reservePct / 100,
        demandScale,
      }),
    [totalCars, reservePct, demandScale, hour, day],
  );

  // Сглаженный surge: для каждой соты усредняем по 1-кольцу соседей с весами
  // (self 0.5, среднее по соседям 0.5). Так уходит «шахматка» зелёный↔красный
  // у соседних клеток — переходы становятся плавными, ступенчатая шкала
  // surgeColor() проявляется уже не на отдельной соте, а на градиенте.
  // На больших зумах (≥13) усиливаем сглаживание до 2-кольца — там соты
  // мельче и резкие границы заметнее. h.surge оставляем как есть для
  // подписей в попапе/легенде, чтобы цифры совпадали с шкалой.
  const smoothedSurgeById = useMemo(() => {
    const base = new Map<string, number>();
    for (const h of hexes) base.set(h.id, h.surge);
    const out = new Map<string, number>();
    const ringK = zoom >= 13 ? 2 : 1;
    for (const h of hexes) {
      const ring = gridDisk(h.id, ringK);
      let sumNb = 0;
      let nb = 0;
      for (const id of ring) {
        if (id === h.id) continue;
        const v = base.get(id);
        if (v !== undefined) {
          sumNb += v;
          nb += 1;
        }
      }
      if (nb === 0) {
        out.set(h.id, h.surge);
      } else {
        out.set(h.id, h.surge * 0.5 + (sumNb / nb) * 0.5);
      }
    }
    return out;
  }, [hexes, zoom]);

  // На зуме ≥12 — мелкая раскладка по сотам (исключая лес/воду/аэропорт).
  // Считаем только когда реально нужно показать — чтобы не нагружать карту.
  const useHexFleet = viewMode === "fleet" && zoom >= 12;
  const fleetHexSummary = useMemo(() => {
    if (!useHexFleet) return null;
    const input = hexes.map((h) => ({
      id: h.id,
      centerLatLng: h.centerLatLng,
      surge: h.comfortSurge,
      topZoneId: h.topZoneId,
    }));
    return distributeFleetToHexes(totalCars, input, hour, day, {
      reservePct: reservePct / 100,
    });
  }, [useHexFleet, hexes, totalCars, hour, day, reservePct]);

  // Возврат к реальному времени — переиспользуется и в desktop-кнопке,
  // и в мобильном bottom-bar.
  function handleNowClick() {
    setMinute(getCurrentMinuteOfDay());
    setScheduleDay(getCurrentScheduleDay());
    setAutoFollow(true);
  }

  function handleExportJson() {
    downloadFile(
      "minsk-taxi-tariff.json",
      buildExportJson(),
      "application/json",
    );
  }

  function handleExportCsv() {
    downloadFile("minsk-taxi-tariff.csv", buildExportCsv(), "text/csv");
  }

  return (
    <div className="flex flex-col h-[100dvh] md:h-[calc(100dvh-4rem-3rem)]">
      {/* Top bar — десктоп */}
      <div className="hidden md:block border-b bg-card">
        <div className="container mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <h1 className="text-base font-bold tracking-tight">
              Прогноз для анализа RWB Taxi
            </h1>
            <p className="text-xs text-muted-foreground">
              Тепловая карта сёрджа по Минску — гексагональная сетка, интерполяция IDW, обрезка по МКАД
            </p>
          </div>

          {/* Кнопка «i» — пошаговая инструкция (десктоп). При новой версии
              на ней пульсирует красный «!» */}
          <HelpButton variant="icon" />

          <div className="flex border rounded-md overflow-hidden text-xs">
            {(["econom", "comfort"] as TaxiClass[]).map((c) => (
              <button
                key={c}
                onClick={() => setCls(c)}
                data-testid={`btn-class-${c}`}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  cls === c
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted"
                }`}
              >
                {c === "econom" ? "Эконом" : "Комфорт"}
              </button>
            ))}
          </div>

          <div
            className="flex border rounded-md overflow-hidden text-xs"
            title="Слой карты: цены или скорости движения"
          >
            <button
              onClick={() => setViewMode("surge")}
              data-testid="btn-view-surge"
              className={`px-3 py-1.5 font-medium transition-colors ${
                viewMode === "surge"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              Сёрджи
            </button>
            <button
              onClick={() => setViewMode("speed")}
              data-testid="btn-view-speed"
              className={`px-3 py-1.5 font-medium transition-colors ${
                viewMode === "speed"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              Скорости
            </button>
            <button
              onClick={() => setViewMode("fleet")}
              data-testid="btn-view-fleet"
              title="Распределение собственного парка по районам"
              className={`px-3 py-1.5 font-medium transition-colors ${
                viewMode === "fleet"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              Парк
            </button>
          </div>

          {/* Кнопка прогноза спроса — доступна в любом режиме */}
          <button
            onClick={() => setDemandForecastOpen((p) => !p)}
            data-testid="btn-demand-forecast-toggle"
            title="24-часовой прогноз спроса: surge по часам с учётом погоды и событий"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
              demandForecastOpen
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-muted border-input"
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Прогноз
          </button>

          {/* Переключатель подложки карты — десктопная шапка */}
          <BasemapPicker variant="row" />

          <div className="flex border rounded-md overflow-hidden text-xs">
            {SCHEDULE_DAYS.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  setScheduleDay(d.id);
                  setAutoFollow(false);
                }}
                data-testid={`btn-day-${d.id}`}
                title={d.label}
                className={`px-2.5 py-1.5 font-medium transition-colors ${
                  scheduleDay === d.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted"
                }`}
              >
                {d.short}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <Badge variant="outline" className="gap-1 text-xs" title="Зон с измеренным сёрджем">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              {stats.measured}
            </Badge>
            <Badge variant="outline" className="gap-1 text-xs" title="Зон с прогнозом">
              <Sparkles className="w-3 h-3 text-violet-600" />
              {stats.predicted}
            </Badge>
            <Badge
              variant="outline"
              className="gap-1 text-xs"
              title={`Дополнительные наблюдения: ${externalObs.data?.length ?? 0} из observations.json + ${userTrips.length} ваших поездок`}
            >
              {externalObs.isLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Database className="w-3 h-3 text-sky-600" />
              )}
              +{(externalObs.data?.length ?? 0) + userTrips.length}
            </Badge>
            {hasTrafficProvider() && (
              <Badge
                className="gap-1 text-xs bg-emerald-600 hover:bg-emerald-600"
                title={`Real-time пробки: ${trafficProviderName()} активен. Используется в маршруте А→Б.`}
                data-testid="badge-traffic-provider"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                </span>
                {trafficProviderName()}
              </Badge>
            )}
          </div>

          {/* Книжка с рекомендованными адресами А→Б (нажать → Yandex Go) */}
          <RecommendedRoutesIconButton />

          {/* Methodology / Сверка с Я. / Экспорт — только администратору */}
          {isAdmin && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8"
                onClick={() => setMethodologyOpen(true)}
                data-testid="btn-methodology"
              >
                <HelpCircle className="w-3.5 h-3.5 mr-1" />
                Methodology
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 gap-1"
                onClick={() => setLooOpen(true)}
                data-testid="btn-loo"
              >
                Сверка с Я.
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 gap-1"
                onClick={() => setCalibCompareOpen(true)}
                data-testid="btn-calib-compare"
                title="Таблица «план vs факт» по последним распознанным скринам Yandex"
              >
                Скрины: план/факт
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 gap-1 border-sky-300 text-sky-700 hover:bg-sky-50"
                onClick={() => setScreensMapOpen(true)}
                data-testid="btn-screens-map"
                title="Карта стартовых точек скриншотов Yandex Go за 7 дней с фильтром по времени"
              >
                📍 Карта скринов
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 gap-1"
                onClick={() => setCoverageMapOpen(true)}
                data-testid="btn-coverage-map"
                title="Карта дыр: где у модели мало данных и нужны новые скрины"
              >
                🎯 Карта дыр
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 gap-1 border-violet-300 text-violet-700 hover:bg-violet-50"
                onClick={() => setAnomalyReportOpen(true)}
                data-testid="btn-anomaly-report"
                title="AI-куратор: краткий отчёт + список заказов с подозрением на ошибку распознавания/выброс"
              >
                🤖 Аномалии
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 gap-1 border-rose-300 text-rose-700 hover:bg-rose-50"
                onClick={() => setMlOverviewOpen(true)}
                data-testid="btn-ml-overview"
                title="Top-5 пар с худшей точностью модели + heatmap покрытия 24×7 (час × день недели). Куда отправить калибровщика и какие смены догрузить."
              >
                📊 ML обзор
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-8 gap-1 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                onClick={() => setOperatorStatsOpen(true)}
                data-testid="btn-operator-stats"
                title="Сколько скринов каждый оператор загрузил за сегодня / неделю / месяц. Видно перекосы по нагрузке и кому платить премию за объём."
              >
                👥 Операторы
              </Button>
              <AdminPriceMonitorButton variant="toolbar" />
            </>
          )}
          <TariffBreakdownDialog />
          <Button
            size="sm"
            variant="outline"
            className="gap-2 text-xs h-8"
            onClick={() => setPriceSimOpen(true)}
            data-testid="btn-price-simulator"
          >
            <Calculator className="w-3.5 h-3.5" />
            Калькулятор
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs gap-1 h-8"
            onClick={() => setTripsOpen(true)}
            data-testid="btn-user-trips"
          >
            📷 Мои поездки
            {userTrips.length > 0 && (
              <span className="ml-0.5 inline-flex items-center justify-center text-[10px] bg-emerald-100 text-emerald-700 rounded-full px-1.5 min-w-[18px]">
                {userTrips.length}
              </span>
            )}
          </Button>
          <Button
            variant={routeOpen ? "default" : "outline"}
            size="sm"
            className="gap-2 text-xs h-8"
            onClick={() => setRouteOpen((o) => !o)}
            data-testid="button-open-route"
          >
            <Navigation className="w-3.5 h-3.5" />
            Маршрут А→Б
            {pickMode && (
              <span className="text-[10px] bg-amber-500 text-black px-1 rounded">
                ставим {pickMode === "from" ? "А" : "Б"}
              </span>
            )}
          </Button>

          {isAdmin && (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportJson}
                data-testid="btn-export-json"
                className="text-xs h-8"
              >
                <FileJson className="w-3.5 h-3.5 mr-1" />
                JSON
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportCsv}
                data-testid="btn-export-csv"
                className="text-xs h-8"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />
                CSV
              </Button>
            </div>
          )}

          <Button
            size="sm"
            variant={holesLayerOn ? "default" : "outline"}
            className="gap-1.5 text-xs h-8"
            onClick={toggleHolesLayer}
            data-testid="btn-toggle-holes-layer"
            title="Показать/скрыть карту дыр на карте"
          >
            🎯 Дыры {holesLayerOn ? "вкл" : ""}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1 text-xs h-8 px-2"
            onClick={() => setHolesInfoOpen(true)}
            data-testid="btn-holes-info-open"
            title="Что такое «дыры» — короткая инструкция"
          >
            ?
          </Button>
          <AdminLoginPopover />
        </div>
      </div>

      {/* Map + Route panel side-by-side */}
      <div className="flex-1 flex min-h-0 relative">
      <div className="flex-1 relative min-w-0">
        <MapContainer
          ref={mapRef}
          center={MINSK_CENTER}
          zoom={11}
          minZoom={10}
          maxZoom={14}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
          attributionControl={false}
        >
          <ZoomTracker onZoomChange={setZoom} />
          <MapClicker enabled={pickMode !== null} onClick={handleMapPick} />
          {/* Динамическая подложка. key={basemap.id} заставляет Leaflet
              корректно перекрепить tile-слой при смене источника.
              Атрибуция выводится через свой <MapAttribution/> ниже,
              а не через стандартный AttributionControl Leaflet
              (поэтому attributionControl={false} на MapContainer). */}
          <TileLayer
            key={basemap.id}
            url={basemap.url}
            subdomains={basemap.subdomains}
            maxZoom={basemap.maxZoom}
            detectRetina
          />

          {/* Hex grid: либо сёрджи, либо средние скорости по замерам.
              Когда включён слой «Дыр» — основной hex-grid скрываем,
              чтобы соты дыр не накладывались на круги спроса. */}
          {!holesLayerOn && hexes.map((h) => {
            const isSelected = selectedHexId === h.id;
            const hasSpeed = h.avgSpeed !== null;
            // В режиме «сёрджи» окрашиваем по сглаженному surge —
            // переходы между соседями становятся плавными.
            const surgeForFill = smoothedSurgeById.get(h.id) ?? h.surge;
            const color =
              viewMode === "speed"
                ? hasSpeed
                  ? speedColor(h.avgSpeed!)
                  : "#94a3b8" // серый — нет данных
                : surgeColor(surgeForFill);
            // В режиме скоростей соты без замеров рисуем еле заметно,
            // чтоб не закрывать карту. В режиме «Парк» сильно затемняем сетку,
            // чтобы кружки распределения по зонам были хорошо видны.
            const fillOpacity =
              viewMode === "fleet"
                ? 0.08
                : viewMode === "speed" && !hasSpeed
                  ? 0.06
                  : isSelected
                    ? 0.7
                    : 0.55;
            const strokeOpacity =
              viewMode === "fleet"
                ? 0.15
                : viewMode === "speed" && !hasSpeed
                  ? 0.15
                  : isSelected
                    ? 1
                    : 0.7;
            return (
              <Polygon
                key={h.id}
                positions={h.boundary}
                pathOptions={{
                  color: isSelected ? "#0f172a" : color,
                  fillColor: color,
                  fillOpacity,
                  weight: isSelected ? 2.5 : 0.5,
                  opacity: strokeOpacity,
                }}
                eventHandlers={{
                  click: () => setSelectedHexId(h.id),
                }}
              />
            );
          })}

          {/* Слой распределения собственного парка.
              На общем зуме — крупные кружки по 25 районам.
              На приближении (zoom ≥ 12) — раскладка по сотам, без леса/воды. */}
          {!holesLayerOn && viewMode === "fleet" && !useHexFleet && (
            <FleetLayer summary={fleetSummary} />
          )}
          {!holesLayerOn && viewMode === "fleet" && useHexFleet && fleetHexSummary && (
            <FleetHexLayer
              hexes={hexes.map((h) => ({ id: h.id, boundary: h.boundary }))}
              summary={fleetHexSummary}
              labelThreshold={Math.max(2, Math.round(fleetHexSummary.meanCarsPerHabitable * 1.2))}
            />
          )}

          {/* Линия маршрута — только когда маршрут уже построен */}
          {resolvedRoute && (
            <>
              <Polyline
                positions={resolvedRoute.route.path}
                pathOptions={{
                  color: "#0f172a",
                  weight: 5,
                  opacity: 0.85,
                }}
              />
              <Polyline
                positions={resolvedRoute.route.path}
                pathOptions={{
                  color: "#fbbf24",
                  weight: 2.5,
                  opacity: 1,
                  dashArray: "1, 8",
                }}
              />
            </>
          )}

          {/* Маркеры А и Б — показываем как только точки выбраны (даже без маршрута) */}
          {pickedFrom && (
            <Marker position={[pickedFrom.lat, pickedFrom.lng]} icon={ICON_FROM} />
          )}
          {pickedTo && (
            <Marker position={[pickedTo.lat, pickedTo.lng]} icon={ICON_TO} />
          )}

          {/* Anchor markers — measured zones (скрываем под слоем «Дыр») */}
          {!holesLayerOn && ZONES.filter((z) => z.surge[day][time].source === "measured").map(
            (z) => (
              <CircleMarker
                key={z.id}
                center={z.center}
                radius={4}
                pathOptions={{
                  color: "#059669",
                  fillColor: "#10b981",
                  fillOpacity: 1,
                  weight: 2,
                }}
              >
                <Popup>
                  <div className="text-xs space-y-1">
                    <div className="font-bold">{z.nameEn}</div>
                    <div className="text-muted-foreground">{z.nameRu}</div>
                    <Badge className="bg-emerald-600 gap-1 text-[10px]">
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      Measured anchor
                    </Badge>
                    {z.surge[day][time].notes && (
                      <div className="italic text-muted-foreground pt-1">
                        {z.surge[day][time].notes}
                      </div>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            ),
          )}

          {holesLayerOn && <HolesOverlayLayer day={day} hour={hour} />}
          {liveLayerOn && (
            <LiveHexLayer
              onCellClick={(hex, breakdown) => {
                setSelectedLiveHex(hex);
                setSelectedLiveBreakdown(breakdown);
                setLiveHexDialogOpen(true);
              }}
            />
          )}
        </MapContainer>

        {/* Плашка текущей погоды — оператор сразу видит почему сёрдж
            в районе мог подняться (дождь / метель / жара / мороз).
            Размещается absolute поверх карты, в правом верхнем углу. */}
        <WeatherStripe />
        {/* Плашка активных городских событий — праздники, матчи, концерты.
            Отображается только когда есть активное событие. */}
        <EventsBadge />

        {/* Прогноз спроса 24ч — абсолютный попап над картой слева снизу.
            Открывается кнопкой «Прогноз» в шапке. Закрывается повторным кликом. */}
        {demandForecastOpen && (
          <div
            className="absolute bottom-2 left-2 z-[1000] w-[min(420px,calc(100vw-1rem))] rounded-xl border bg-background/97 shadow-2xl backdrop-blur-sm"
            data-testid="demand-forecast-panel-wrapper"
          >
            <div className="flex items-center justify-between px-3 pt-2.5 pb-1 border-b">
              <span className="text-xs font-semibold flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-primary" />
                Прогноз спроса — 24 часа
              </span>
              <button
                type="button"
                onClick={() => setDemandForecastOpen(false)}
                className="rounded p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Закрыть прогноз"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <DemandForecastPanel />
          </div>
        )}

        {/* Своя плашка атрибуции — без «🇺🇦 Leaflet», и поднята над
            нижним мобильным баром (см. MapAttribution.tsx). */}
        <MapAttribution basemap={basemap} />

        {/* Selected hex panel — top sheet, replaces leaflet popup */}
        {selectedHex && (
          <div
            className="absolute top-2 left-2 right-2 sm:left-3 sm:right-auto sm:max-w-md z-[1000]"
            data-testid="selected-hex-panel"
          >
            <div className="rounded-lg border bg-background shadow-xl">
              <div className="flex items-start justify-between gap-2 p-3 pb-2">
                <div className="flex-1 min-w-0">
                  <HexExplainHeader hex={selectedHex} cls={cls} />
                </div>
                <button
                  onClick={() => setSelectedHexId(null)}
                  className="shrink-0 rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Закрыть"
                  data-testid="button-close-hex"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-3 pb-3 max-h-[55vh] overflow-y-auto">
                <HexExplainPopup
                  hex={selectedHex}
                  cls={cls}
                  day={day}
                  time={time}
                  hour={hour}
                  hideHeader
                  viewMode={viewMode}
                />
              </div>
            </div>
          </div>
        )}

        {/* Compact legend — bottom right (зависит от слоя) */}
        <div className="absolute bottom-2 right-2 z-[500] rounded-md border bg-background/95 backdrop-blur px-2 py-1.5 shadow-md text-[10px]">
          {holesLayerOn ? (
            <>
              <div className="text-muted-foreground mb-1 leading-none">
                Покрытие скринов
              </div>
              <div className="flex items-center gap-0.5">
                {[
                  { c: "#ef4444", l: "0" },
                  { c: "#f97316", l: "1–2" },
                  { c: "#eab308", l: "3–5" },
                  { c: "#10b981", l: "≥6" },
                ].map((s) => (
                  <div key={s.c} className="flex flex-col items-center w-9">
                    <div
                      className="w-full h-2 rounded-sm"
                      style={{ backgroundColor: s.c }}
                    />
                    <span className="leading-tight">{s.l}</span>
                  </div>
                ))}
              </div>
            </>
          ) : viewMode === "fleet" ? (
            <>
              <div className="text-muted-foreground mb-1 leading-none">
                Баланс парка (машин / спрос)
              </div>
              <div className="flex items-center gap-0.5">
                {[
                  { c: "#ef4444", l: "<45%" },
                  { c: "#f97316", l: "70" },
                  { c: "#eab308", l: "95" },
                  { c: "#84cc16", l: "100" },
                  { c: "#10b981", l: ">130" },
                ].map((s) => (
                  <div key={s.c} className="flex flex-col items-center w-9">
                    <div
                      className="w-full h-2 rounded-sm"
                      style={{ backgroundColor: s.c }}
                    />
                    <span className="leading-tight">{s.l}</span>
                  </div>
                ))}
              </div>
            </>
          ) : viewMode === "surge" ? (
            <>
              <div className="text-muted-foreground mb-1 leading-none">
                Сёрдж
              </div>
              <div className="flex items-center gap-0.5">
                {[
                  { c: "#10b981", l: "<1" },
                  { c: "#84cc16", l: "1" },
                  { c: "#eab308", l: "1.3" },
                  { c: "#f97316", l: "1.7" },
                  { c: "#ef4444", l: "2.2" },
                  { c: "#7c3aed", l: ">4" },
                ].map((s) => (
                  <div key={s.c} className="flex flex-col items-center w-7">
                    <div
                      className="w-full h-2 rounded-sm"
                      style={{ backgroundColor: s.c }}
                    />
                    <span className="leading-tight">{s.l}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="text-muted-foreground mb-1 leading-none">
                Скорость, км/ч ·{" "}
                <span className="text-foreground">
                  {hexes.filter((h) => h.avgSpeed !== null).length} / {hexes.length}{" "}
                  сот с замерами
                </span>
              </div>
              <div className="flex items-center gap-0.5">
                {[
                  { c: "#7c2d12", l: "<15" },
                  { c: "#dc2626", l: "20" },
                  { c: "#f97316", l: "28" },
                  { c: "#eab308", l: "36" },
                  { c: "#84cc16", l: "45" },
                  { c: "#16a34a", l: ">45" },
                ].map((s) => (
                  <div key={s.c} className="flex flex-col items-center w-7">
                    <div
                      className="w-full h-2 rounded-sm"
                      style={{ backgroundColor: s.c }}
                    />
                    <span className="leading-tight">{s.l}</span>
                  </div>
                ))}
                <div className="flex flex-col items-center w-9 ml-1 border-l pl-1">
                  <div
                    className="w-full h-2 rounded-sm"
                    style={{ backgroundColor: "#94a3b8", opacity: 0.4 }}
                  />
                  <span className="leading-tight">нет</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* === Мобильная версия: верхняя/нижняя панели и FAB === */}
        <div className="md:hidden">
          <MobileTopBar
            cls={cls}
            onClsChange={setCls}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            menu={
              <MobileMenuSheet
                scheduleDay={scheduleDay}
                onScheduleDayChange={(d) => {
                  setScheduleDay(d);
                  setAutoFollow(false);
                }}
                measuredCount={stats.measured}
                predictedCount={stats.predicted}
                observationCount={allObservations.length}
                trafficProvider={trafficProviderName()}
                onOpenRoute={() => setRouteOpen(true)}
                onOpenTrips={() => setTripsOpen(true)}
                onOpenCalculator={() => setPriceSimOpen(true)}
                onOpenMethodology={() => setMethodologyOpen(true)}
                onOpenLeaveOneOut={() => setLooOpen(true)}
                onOpenCalibCompare={() => setCalibCompareOpen(true)}
                onOpenCoverageMap={() => setCoverageMapOpen(true)}
                onOpenAnomalyReport={() => setAnomalyReportOpen(true)}
                onOpenHolesInfo={() => setHolesInfoOpen(true)}
                holesLayerOn={holesLayerOn}
                onToggleHolesLayer={toggleHolesLayer}
                onExportJson={handleExportJson}
                onExportCsv={handleExportCsv}
              />
            }
          />
          {/* Кнопка «i» — пошаговая инструкция, слева сверху над MobileTopBar
              не помещается, поэтому слева внизу над капсулой-доком.
              Пульсирует красным «!» при новой версии инструкции. */}
          <HelpButton className="absolute bottom-44 left-3 z-[850]" />

          {/* Нижний док в стиле iOS — единый визуальный язык с viewer-версией.
              Слева Журнал (рекомендованные адреса), по центру (приподнято) Скрин,
              справа Дыры и Огонёк (тепловая карта Яндекса). */}
          <div
            className="absolute left-1/2 -translate-x-1/2 z-[850] flex items-end gap-4 rounded-3xl bg-white/95 backdrop-blur-xl px-4 pt-2.5 border border-slate-200"
            style={{
              bottom: "calc(5.5rem + env(safe-area-inset-bottom, 0px))",
              paddingBottom:
                "calc(0.5rem + env(safe-area-inset-bottom, 0px))",
              boxShadow:
                "0 16px 40px -10px rgba(15, 23, 42, 0.45), 0 4px 12px rgba(0,0,0,0.15)",
            }}
            data-testid="dock-admin-bottom"
          >
            <div className="flex flex-col items-center gap-1">
              <RecommendedRoutesFAB />
              <span className="text-[10px] font-medium text-slate-600 leading-none">
                Журнал
              </span>
            </div>

            <div
              className="flex flex-col items-center gap-1 -translate-y-3"
              data-testid="dock-admin-camera"
            >
              <ScreenUploadFAB />
              <span className="text-[10px] font-semibold text-slate-700 leading-none">
                Скрин
              </span>
            </div>

            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={toggleHolesLayer}
                data-testid="fab-holes-target"
                aria-label={
                  holesLayerOn
                    ? "Скрыть дыры на карте"
                    : "Показать дыры на карте"
                }
                title={
                  holesLayerOn
                    ? "Скрыть дыры на карте"
                    : "Показать дыры на карте"
                }
                className={`h-14 w-14 rounded-full shadow-2xl flex items-center justify-center text-white transition-all active:scale-95 ${
                  holesLayerOn
                    ? "bg-emerald-600 hover:bg-emerald-700 ring-2 ring-emerald-300"
                    : "bg-rose-600 hover:bg-rose-700"
                }`}
              >
                <Target className="h-6 w-6" strokeWidth={2.5} />
              </button>
              <span
                className={`text-[10px] font-medium leading-none ${holesLayerOn ? "text-emerald-700" : "text-slate-600"}`}
              >
                Дыры
              </span>
            </div>

            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => setLiveLayerOn((p) => !p)}
                data-testid="fab-live-yandex"
                aria-label={
                  liveLayerOn
                    ? "Скрыть тепловую карту Яндекса"
                    : "Показать тепловую карту Яндекса"
                }
                title={
                  liveLayerOn
                    ? "Скрыть тепловую карту Яндекса"
                    : "Цены Яндекса по сотам — тапни, чтобы открыть"
                }
                className={`h-14 w-14 rounded-full shadow-2xl flex items-center justify-center text-white transition-all active:scale-95 ${
                  liveLayerOn
                    ? "bg-amber-500 hover:bg-amber-600 ring-2 ring-amber-300"
                    : "bg-yellow-500 hover:bg-yellow-600"
                }`}
              >
                <Flame className="h-6 w-6" strokeWidth={2.5} />
              </button>
              <span
                className={`text-[10px] font-medium leading-none ${liveLayerOn ? "text-amber-700" : "text-slate-600"}`}
              >
                Яндекс
              </span>
            </div>
          </div>
          <MobileBottomBar
            minute={minute}
            onMinuteChange={(v) => {
              setMinute(v);
              setAutoFollow(false);
            }}
            autoFollow={autoFollow}
            onNowClick={handleNowClick}
            timeLabel={timeLabel}
            timeSlotLabel={timeSlot.label}
            timeSlotEmoji={timeSlot.emoji}
            timeSlotHours={timeSlot.hours}
            hexCount={hexes.length}
            zoom={zoom}
            h3Res={zoomToH3Res(zoom)}
            dayLabel={
              SCHEDULE_DAYS.find((d) => d.id === scheduleDay)?.label ??
              scheduleDay
            }
          />
        </div>
      </div>

      {/* Боковая панель маршрута — на md+ толкает карту, на узких лежит overlay-ом */}
      {routeOpen && (
        <div className="absolute inset-0 z-[1100] bg-background md:relative md:inset-auto md:z-auto md:w-[400px] md:shrink-0 md:border-l">
          <RoutePlanner
            day={day}
            time={time}
            hour={hour}
            timeLabel={timeLabel}
            observations={allObservations}
            onRouteChange={setResolvedRoute}
            onClose={() => setRouteOpen(false)}
            pickedFrom={pickedFrom}
            pickedTo={pickedTo}
            onPickedFromChange={setPickedFrom}
            onPickedToChange={setPickedTo}
            pickMode={pickMode}
            onPickModeChange={setPickMode}
          />
        </div>
      )}
      </div>

      {/* Bottom slider — десктоп (на мобильном слайдер живёт в MobileBottomBar) */}
      <div className="hidden md:block border-t bg-card">
        {viewMode === "fleet" && (
          <div className="container mx-auto px-6 pt-3 pb-1 border-b">
            <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-xl">🚖</span>
                <div>
                  <div className="font-semibold">
                    Парк: <span className="text-primary">{fleetSummary.totalCars}</span> авто
                    · на линии {fleetSummary.onShift}
                    {fleetSummary.offShift > 0 && (
                      <span className="text-muted-foreground"> · в смене {fleetSummary.offShift}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Прогноз спроса: {fleetSummary.totalDemand.toFixed(0)} одноврем. ·{" "}
                    общий баланс:{" "}
                    <span
                      className="font-semibold"
                      style={{ color: fleetColor(fleetSummary.globalRatio) }}
                    >
                      {fleetLabel(fleetSummary.globalRatio)} ({(fleetSummary.globalRatio * 100).toFixed(0)}%)
                    </span>
                  </div>
                  {useHexFleet && fleetHexSummary && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Сетка сот · {fleetHexSummary.habitableCount} жилых ячеек ·{" "}
                      <span className="text-amber-600">
                        отброшено {fleetHexSummary.excludedCount}
                      </span>{" "}
                      (лес/вода/аэропорт) · среднее {fleetHexSummary.meanCarsPerHabitable.toFixed(1)} авто/соту
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <div className="flex items-center gap-1.5" title="Машины не на линии: пересменка, обед, ремонт, нет водителя. Эти авто не принимают заказы.">
                  <span className="text-muted-foreground">
                    Не на линии (резерв):
                  </span>
                  <div className="flex border rounded-md overflow-hidden">
                    {[10, 15, 20, 25, 30].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setReservePct(p)}
                        data-testid={`btn-reserve-${p}`}
                        className={`px-2 py-1 ${
                          reservePct === p
                            ? "bg-primary text-primary-foreground"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        {p}%
                      </button>
                    ))}
                  </div>
                </div>
                <div
                  className="flex items-center gap-1.5"
                  title="Сколько одновременно пассажиров заказывает такси по городу. Тихо = ночь/выходные, обычно = будни, час пик = утро/вечер, непогода = дождь/снег и праздники."
                >
                  <span className="text-muted-foreground">
                    Интенсивность спроса:
                  </span>
                  <div className="flex border rounded-md overflow-hidden">
                    {[
                      { v: 0.5, label: "тихо" },
                      { v: 1.0, label: "обычно" },
                      { v: 1.5, label: "пик" },
                      { v: 2.0, label: "непогода" },
                    ].map((opt) => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setDemandScale(opt.v)}
                        data-testid={`btn-demand-${opt.v}`}
                        className={`px-2 py-1 ${
                          demandScale === opt.v
                            ? "bg-primary text-primary-foreground"
                            : "bg-background hover:bg-muted"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground -mt-1 mb-1 leading-tight">
              <span className="font-medium text-foreground">Как читать:</span>{" "}
              <b>На линии</b> — авто, которые сейчас могут брать заказы.{" "}
              <b>В смене (резерв)</b> — стоят на пересменке/отдыхе/ремонте.{" "}
              <b>Прогноз спроса</b> — расчёт сколько одновременно пассажиров заказывают такси
              в выбранный день и час; зависит от площади районов, типа (центр/спальник/вокзал) и сёрджей,
              а множитель «интенсивность» подстраивает его под обычный/час пик/непогоду.
              Почасовой прогноз с погодой и событиями — кнопка <b>«Прогноз»</b> в шапке.
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground whitespace-nowrap w-24">
                Кол-во авто:
              </span>
              <Slider
                value={[totalCars]}
                min={50}
                max={2000}
                step={10}
                onValueChange={(v) => setTotalCars(v[0])}
                data-testid="slider-fleet-size"
                className="flex-1"
              />
              <input
                type="number"
                value={totalCars}
                min={50}
                max={2000}
                step={10}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setTotalCars(Math.max(50, Math.min(2000, n)));
                }}
                data-testid="input-fleet-size"
                className="w-20 px-2 py-1 text-xs border rounded text-right tabular-nums"
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-1">
              {[100, 250, 500, 750, 1000, 1500, 2000].map((n) => (
                <span key={n}>{n}</span>
              ))}
            </div>
          </div>
        )}
        <div className="container mx-auto px-6 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{timeSlot.emoji}</span>
              <div>
                <div className="text-sm font-semibold">
                  {timeSlot.label} · {timeLabel}
                </div>
                <div className="text-xs text-muted-foreground">
                  Слот: {timeSlot.hours} · Шаг 10 мин · Zoom {zoom} · Hex res{" "}
                  {zoomToH3Res(zoom)} · {hexes.length} ячеек
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setMinute(getCurrentMinuteOfDay());
                  setScheduleDay(getCurrentScheduleDay());
                  setAutoFollow(true);
                }}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  autoFollow
                    ? "bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600"
                    : "hover:bg-accent"
                }`}
                data-testid="button-time-now"
                title={
                  autoFollow
                    ? "Слайдер синхронизирован с реальным временем (двигается каждые 30 сек). Нажмите чтобы вручную выбрать день/время."
                    : "Вернуться к реальному времени"
                }
              >
                {autoFollow ? "● Реальное время" : "Сейчас"}
              </button>
              <span className="text-xs text-muted-foreground">
                {autoFollow
                  ? "Слайдер двигается сам — перетащите для прогноза на другое время"
                  : "Перетащите слайдер или нажмите «Сейчас» для возврата к реальному времени"}
              </span>
            </div>
          </div>
          <Slider
            value={[minute]}
            min={0}
            max={1430}
            step={10}
            onValueChange={(v) => {
              setMinute(v[0]);
              setAutoFollow(false);
            }}
            data-testid="slider-time"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-1">
            {[0, 4, 8, 12, 16, 20, 23].map((h) => (
              <span key={h}>{String(h).padStart(2, "0")}:00</span>
            ))}
          </div>
        </div>
      </div>

      {/* Controlled-инстансы диалогов: открываются программно (из desktop
          toolbar или мобильного гамбургер-меню), без собственных триггеров. */}
      <MethodologyDialog
        controlledOpen={methodologyOpen}
        onControlledOpenChange={setMethodologyOpen}
        hideTrigger
      />
      <LeaveOneOutDialog
        controlledOpen={looOpen}
        onControlledOpenChange={setLooOpen}
        hideTrigger
      />
      <AdminAnomalyReport
        open={anomalyReportOpen}
        onClose={() => setAnomalyReportOpen(false)}
      />
      <AdminCalibComparison
        open={calibCompareOpen}
        onClose={() => setCalibCompareOpen(false)}
      />
      <AdminCoverageMap
        open={coverageMapOpen}
        onClose={() => setCoverageMapOpen(false)}
      />
      <AdminScreensMap
        open={screensMapOpen}
        onClose={() => setScreensMapOpen(false)}
      />
      <AdminMlOverview
        open={mlOverviewOpen}
        onClose={() => setMlOverviewOpen(false)}
        onCellClick={(dow, hour) => {
          // dow: 0=Mon..6=Sun (Python weekday), маппим в ScheduleDay.
          const SCHEDULE_BY_DOW = [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
          ] as const;
          setScheduleDay(SCHEDULE_BY_DOW[dow]);
          setMinute(hour * 60); // переводим в minute-of-day, hour=floor(min/60)
          setHolesLayerOn(true); // включаем оверлей дыр (если был выкл)
          setMlOverviewOpen(false); // закрываем модалку — оператор увидит карту
        }}
      />
      <AdminOperatorStats
        open={operatorStatsOpen}
        onClose={() => setOperatorStatsOpen(false)}
      />
      <HolesInfoDialog
        controlledOpen={holesInfoOpen}
        onControlledOpenChange={handleHolesIntroChange}
      />
      <PriceSimulator
        controlledOpen={priceSimOpen}
        onControlledOpenChange={setPriceSimOpen}
        hideTrigger
      />
      <UserTripsDialog
        controlledOpen={tripsOpen}
        onControlledOpenChange={setTripsOpen}
        hideTrigger
      />
      <LiveHexCellDialog
        hex={selectedLiveHex}
        breakdown={selectedLiveBreakdown}
        open={liveHexDialogOpen}
        onOpenChange={setLiveHexDialogOpen}
      />
    </div>
  );
}
