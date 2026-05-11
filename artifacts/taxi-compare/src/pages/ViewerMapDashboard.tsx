import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import { Target, Flame, Menu as MenuIcon, LogOut } from "lucide-react";

import { wbLogout } from "@/lib/wb-api";
import { useWbCurrentUser } from "@/lib/wb-auth";
import { BasemapPicker } from "@/components/BasemapPicker";
import { MapAttribution } from "@/components/MapAttribution";
import { ScreenUploadFAB } from "@/components/ScreenUploadFAB";
import { RecommendedRoutesFAB } from "@/components/RecommendedRoutesPopover";
import { HelpButton } from "@/components/HelpButton";
import { ViewerOnboarding } from "@/components/ViewerOnboarding";
import { HolesOverlayLayer } from "@/components/HolesOverlayLayer";
import { LiveHexLayer } from "@/components/LiveHexLayer";
import { LiveHexCellDialog } from "@/components/LiveHexCellDialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useBasemap } from "@/lib/basemaps";
import {
  MINSK_CENTER,
  getCurrentScheduleDay,
  scheduleDayToType,
  type DayType,
} from "@/lib/zones";
import type { LiveHex, TariffBreakdown } from "@/lib/live-hex";

function readBoolParam(name: string): boolean {
  if (typeof window === "undefined") return false;
  const v = new URLSearchParams(window.location.search).get(name);
  return v === "1" || v === "true";
}

function writeBoolParam(name: string, val: boolean) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (val) url.searchParams.set(name, "1");
  else url.searchParams.delete(name);
  window.history.replaceState(null, "", url.toString());
}

export default function ViewerMapDashboard() {
  const mapRef = useRef<LeafletMap | null>(null);
  const basemap = useBasemap();
  const [holesOn, setHolesOn] = useState(() => readBoolParam("holes"));
  // «Яндекс»-слой: тепловая карта распознанных сот за последние 6ч.
  // Toggle через пункт в боковом меню (раньше был отдельный FAB-пламя).
  const [liveOn, setLiveOn] = useState(() => readBoolParam("yandex"));
  // true пока пользователь двигает/зумит карту — док делается
  // полупрозрачным и слегка уменьшается, чтобы не загораживать обзор.
  const [mapMoving, setMapMoving] = useState(false);
  const [selectedHex, setSelectedHex] = useState<LiveHex | null>(null);
  const [selectedBreakdown, setSelectedBreakdown] =
    useState<TariffBreakdown | null>(null);
  const [hexDialogOpen, setHexDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const wbUser = useWbCurrentUser();
  const roleLabel =
    wbUser?.role === "admin"
      ? "Админ"
      : wbUser?.role === "antifraud"
        ? "Антифрод"
        : wbUser?.role === "uploader"
          ? "Загрузчик"
          : "Водитель";
  // День и час — «сейчас», как у viewer нет таймлайна. Опрос раз в минуту,
  // чтобы при долгом сидении подсветка дыр догоняла реальный час.
  const [day, setDay] = useState<DayType>(() =>
    scheduleDayToType(getCurrentScheduleDay()),
  );
  const [hour, setHour] = useState<number>(() => new Date().getHours());
  useEffect(() => {
    const id = window.setInterval(() => {
      setDay(scheduleDayToType(getCurrentScheduleDay()));
      setHour(new Date().getHours());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Синк состояния слоёв с URL — можно делиться ссылкой с включёнными слоями.
  useEffect(() => {
    writeBoolParam("holes", holesOn);
  }, [holesOn]);
  useEffect(() => {
    writeBoolParam("yandex", liveOn);
  }, [liveOn]);

  // Подписка на движение карты: пока пользователь панорамирует/зумит —
  // делаем док полупрозрачным; через 600 мс после остановки возвращаем.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let hideTimer: number | null = null;
    const onStart = () => {
      if (hideTimer) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
      setMapMoving(true);
    };
    const onEnd = () => {
      if (hideTimer) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setMapMoving(false), 600);
    };
    map.on("movestart", onStart);
    map.on("zoomstart", onStart);
    map.on("moveend", onEnd);
    map.on("zoomend", onEnd);
    return () => {
      if (hideTimer) window.clearTimeout(hideTimer);
      map.off("movestart", onStart);
      map.off("zoomstart", onStart);
      map.off("moveend", onEnd);
      map.off("zoomend", onEnd);
    };
  }, []);

  const anyLayerOn = holesOn || liveOn;

  return (
    <div className="h-screen w-screen relative overflow-hidden">
      <ViewerOnboarding />
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
        <TileLayer
          key={basemap.id}
          url={basemap.url}
          subdomains={basemap.subdomains}
          maxZoom={basemap.maxZoom}
          detectRetina
        />
        {holesOn && <HolesOverlayLayer day={day} hour={hour} />}
        {liveOn && (
          <LiveHexLayer
            onCellClick={(hex, breakdown) => {
              setSelectedHex(hex);
              setSelectedBreakdown(breakdown);
              setHexDialogOpen(true);
            }}
          />
        )}
      </MapContainer>

      <MapAttribution basemap={basemap} />

      {/* Кнопка «меню» сверху-справа. Внутри — слой Яндекса, выбор подложки,
          помощь. Раньше эти штуки висели отдельными иконками по углам —
          смотрелось «дёшево», теперь убрано в один опрятный sheet. */}
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label={
          anyLayerOn
            ? "Меню (есть включённые слои)"
            : "Меню"
        }
        className="absolute top-3 right-3 z-[850] h-11 w-11 rounded-full bg-white/95 backdrop-blur shadow-lg border border-slate-200 flex items-center justify-center active:scale-95 transition-transform"
        data-testid="button-viewer-menu"
        style={{
          boxShadow:
            "0 8px 20px -6px rgba(15, 23, 42, 0.3), 0 2px 6px rgba(0,0,0,0.1)",
        }}
      >
        <MenuIcon className="h-5 w-5 text-slate-700" strokeWidth={2.5} />
        {anyLayerOn && (
          <span
            className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white animate-pulse"
            data-testid="badge-menu-layers-on"
            aria-hidden="true"
          />
        )}
      </button>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="right" className="z-[2001] w-[320px] sm:w-[360px]">
          <SheetHeader>
            <SheetTitle>Меню</SheetTitle>
          </SheetHeader>

          {wbUser && (
            <div
              className="mt-4 flex items-center gap-3 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 px-3 py-2.5"
              data-testid="menu-user-card"
            >
              <div className="h-10 w-10 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold shrink-0">
                {(wbUser.displayName || wbUser.login)
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">
                  {wbUser.displayName || wbUser.login}
                </div>
                <div className="text-[11px] text-slate-500">
                  {roleLabel} · @{wbUser.login}
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 space-y-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Слои карты
              </div>
              <button
                type="button"
                onClick={() => {
                  setLiveOn((v) => !v);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 hover:bg-slate-50 active:scale-[0.99] transition-all"
                data-testid="button-menu-yandex-layer"
              >
                <div
                  className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                    liveOn
                      ? "bg-amber-500 text-white"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  <Flame className="h-5 w-5" strokeWidth={2.5} />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="text-sm font-medium text-slate-900">
                    Тепловая карта Яндекса
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-snug">
                    Цены по сотам — короткая, средняя, длинная
                  </div>
                </div>
                <div
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                    liveOn
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {liveOn ? "ВКЛ" : "ВЫКЛ"}
                </div>
              </button>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Базовая карта
              </div>
              <BasemapPicker variant="row" />
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Помощь
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3">
                <HelpButton variant="icon" />
                <div className="text-sm text-slate-700">
                  Как пользоваться картой и кнопками
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={async () => {
                  setMenuOpen(false);
                  try {
                    await wbLogout();
                  } catch {
                    /* noop — wbLogout локально дропает токен в любом случае */
                  }
                }}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 active:scale-[0.99] text-rose-700 font-medium px-3 py-3 transition-all"
                data-testid="button-menu-logout"
              >
                <LogOut className="h-5 w-5" strokeWidth={2.2} />
                <span>Выйти</span>
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Bottom dock в стиле iOS: полупрозрачная капсула по центру,
          книга слева, камера в центре (приподнята), «дыры» справа.
          Остальные слои/настройки — в боковом меню (кнопка ☰ сверху-справа). */}
      <div
        className={`absolute left-1/2 z-[850] flex items-end gap-5 rounded-3xl bg-white/95 backdrop-blur-xl px-5 pt-2.5 border border-slate-200 transition-all duration-300 ${
          mapMoving
            ? "-translate-x-1/2 scale-90 opacity-40"
            : "-translate-x-1/2 scale-100 opacity-100"
        }`}
        style={{
          bottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))",
          paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))",
          boxShadow:
            "0 16px 40px -10px rgba(15, 23, 42, 0.45), 0 4px 12px rgba(0,0,0,0.15)",
        }}
        data-testid="dock-viewer-bottom"
        data-moving={mapMoving ? "1" : "0"}
      >
        <div className="flex flex-col items-center gap-1">
          <RecommendedRoutesFAB />
          <span className="text-[10px] font-medium text-slate-600 leading-none">
            Журнал
          </span>
        </div>

        <div
          className="flex flex-col items-center gap-1 -translate-y-3"
          data-testid="dock-center-camera"
        >
          <ScreenUploadFAB />
          <span className="text-[10px] font-semibold text-slate-700 leading-none">
            Скрин
          </span>
        </div>

        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => setHolesOn((v) => !v)}
            data-testid="fab-holes-target-viewer"
            aria-label={
              holesOn
                ? "Скрыть районы-дыры"
                : "Показать районы, где нужны заказы"
            }
            title={
              holesOn
                ? "Скрыть районы-дыры"
                : "Показать районы, где нужны заказы"
            }
            className={`h-14 w-14 rounded-full shadow-2xl flex items-center justify-center text-white transition-all active:scale-95 ${
              holesOn
                ? "bg-emerald-600 hover:bg-emerald-700 ring-2 ring-emerald-300"
                : "bg-rose-600 hover:bg-rose-700"
            }`}
          >
            <Target className="h-6 w-6" strokeWidth={2.5} />
          </button>
          <span
            className={`text-[10px] font-medium leading-none ${holesOn ? "text-emerald-700" : "text-slate-600"}`}
          >
            Дыры
          </span>
        </div>
      </div>

      {/* Подсказки-легенды над доком, чтобы не наезжали на капсулу.
          bottom-28 ≈ высота дока (~88px) + воздух. */}
      {holesOn && (
        <div
          className="absolute bottom-28 left-3 z-[850] max-w-[260px] rounded-md border bg-background/95 backdrop-blur px-2.5 py-1.5 shadow-md text-[11px] leading-tight"
          data-testid="legend-holes-viewer"
        >
          <div className="font-semibold mb-0.5">
            🎯 Где сейчас нужны заказы
          </div>
          <div className="text-muted-foreground">
            🔴 нет данных · 🟠 мало (1–2) · 🟡 средне (3–5) · 🟢 надёжно (6+).
            Делайте скрин из красных/оранжевых районов.
          </div>
        </div>
      )}

      {liveOn && (
        <div
          className="absolute bottom-28 right-3 z-[850] max-w-[280px] rounded-md border bg-background/95 backdrop-blur px-2.5 py-1.5 shadow-md text-[11px] leading-tight"
          data-testid="legend-live-yandex-viewer"
          style={{ marginBottom: holesOn ? 56 : 0 }}
        >
          <div className="font-semibold mb-0.5">🔥 Цены Яндекса сейчас</div>
          <div className="text-muted-foreground">
            🟦 скидка · 🟩 база · 🟨 повышен · 🟧 высокий · 🟥 пик. Тапни по
            соте — увидишь цены на короткую/среднюю/длинную поездку и почему
            такой коэффициент.
          </div>
        </div>
      )}

      <LiveHexCellDialog
        hex={selectedHex}
        breakdown={selectedBreakdown}
        open={hexDialogOpen}
        onOpenChange={setHexDialogOpen}
      />
    </div>
  );
}
