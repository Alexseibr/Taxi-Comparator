import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  MapPin,
  Clock,
  X,
  ImageIcon,
  ChevronRight,
  Maximize2,
} from "lucide-react";

type Tariff = {
  name: string;
  price: number | null;
  surge: number | null;
  tripMin: number | null;
};

type ScreenItem = {
  id: string;
  uploadedAt: string;
  fromAddress: string;
  fromAddressGeo: string;
  fromLat: number;
  fromLng: number;
  toAddress: string;
  toAddressGeo: string;
  toLat: number | null;
  toLng: number | null;
  factE: number | null;
  factC: number | null;
  etaMin: number | null;
  tripMin: number | null;
  demand: string | null;
  screenUrl: string;
  anomaly?: { suspicious: boolean; severity: string; reason: string } | null;
};

type ScreenDetails = ScreenItem & {
  tariffs: Tariff[] | null;
  demandColor: string | null;
};

type Props = { open: boolean; onClose: () => void };

const MINSK_CENTER: [number, number] = [53.9, 27.5667];
const WINDOW_MIN = 30; // ширина окна по времени, минут (±15 от позиции)

function fmtMsk(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  // отображаем UTC+3 (Минск) — но iso уже в UTC, добавляем 3ч
  const ms = d.getTime() + 3 * 3600 * 1000;
  const x = new Date(ms);
  const dd = String(x.getUTCDate()).padStart(2, "0");
  const mm = String(x.getUTCMonth() + 1).padStart(2, "0");
  const HH = String(x.getUTCHours()).padStart(2, "0");
  const MM = String(x.getUTCMinutes()).padStart(2, "0");
  return `${dd}.${mm} ${HH}:${MM}`;
}

function fmtMskTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const ms = d.getTime() + 3 * 3600 * 1000;
  const x = new Date(ms);
  return `${String(x.getUTCHours()).padStart(2, "0")}:${String(x.getUTCMinutes()).padStart(2, "0")}`;
}

function demandPill(d: string | null) {
  if (d === "red")
    return (
      <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
        красный
      </Badge>
    );
  if (d === "yellow")
    return (
      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
        жёлтый
      </Badge>
    );
  if (d === "green")
    return (
      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
        зелёный
      </Badge>
    );
  return <Badge variant="outline">·</Badge>;
}

function surgeBadge(s: number | null | undefined) {
  if (typeof s !== "number" || s <= 1.05)
    return <span className="text-slate-500">×{(s ?? 1).toFixed(2)}</span>;
  if (s <= 1.5)
    return <span className="font-semibold text-amber-700">×{s.toFixed(2)}</span>;
  if (s <= 2.0)
    return <span className="font-semibold text-orange-700">×{s.toFixed(2)}</span>;
  if (s <= 3.0)
    return <span className="font-semibold text-red-700">×{s.toFixed(2)}</span>;
  return (
    <span className="font-bold rounded bg-red-600 text-white px-1.5">
      ×{s.toFixed(2)}
    </span>
  );
}

/**
 * Слой кластеризованных маркеров.
 *
 * - Каждый Leaflet-маркер хранит массив id замеров в `options.rwbIds`
 *   (если в одной координате несколько замеров — ID склеены).
 * - Клик по одиночному маркеру → onPickGroup(ids этого маркера + название точки).
 * - Клик по кластеру → собираем ВСЕ ids из всех вложенных маркеров и показываем
 *   их списком справа (НЕ зумим). Юзер может зумить колесом сам — кластер
 *   распадётся на меньшие, а правая панель обновится при следующем клике.
 */
function ClusterLayer({
  items,
  onPickGroup,
}: {
  items: ScreenItem[];
  onPickGroup: (payload: { ids: string[]; label: string }) => void;
}) {
  const map = useMap();
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    const cluster = L.markerClusterGroup({
      maxClusterRadius: 45,
      spiderfyOnMaxZoom: false,
      showCoverageOnHover: false,
      chunkedLoading: true,
      zoomToBoundsOnClick: false,
    });

    const byPoint = new Map<string, ScreenItem[]>();
    for (const it of items) {
      const k = `${it.fromLat.toFixed(5)},${it.fromLng.toFixed(5)}`;
      const arr = byPoint.get(k);
      if (arr) arr.push(it);
      else byPoint.set(k, [it]);
    }

    for (const [, arr] of byPoint) {
      const head = arr[0];
      const ids = arr.map((x) => x.id);
      const icon = L.divIcon({
        className: "rwb-screen-pin",
        html: `<div class="rwb-pin-inner${arr.length > 1 ? " rwb-pin-multi" : ""}">${
          arr.length > 1 ? arr.length : ""
        }</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const m = L.marker([head.fromLat, head.fromLng], {
        icon,
        // храним свои данные на маркере (Leaflet MarkerOptions допускает extra props)
        rwbIds: ids,
        rwbLabel: head.fromAddressGeo || head.fromAddress || "точка",
      } as L.MarkerOptions & { rwbIds: string[]; rwbLabel: string });
      const tip = head.fromAddressGeo || head.fromAddress || "—";
      m.bindTooltip(
        `${tip}${arr.length > 1 ? ` · ${arr.length} замеров` : ""}`,
      );
      m.on("click", () =>
        onPickGroup({
          ids,
          label: head.fromAddressGeo || head.fromAddress || "точка",
        }),
      );
      cluster.addLayer(m);
    }

    cluster.on("clusterclick", (e: L.LeafletEvent) => {
      const c = (e as any).layer as L.MarkerCluster;
      const markers = c.getAllChildMarkers();
      const allIds: string[] = [];
      for (const mk of markers) {
        // @ts-expect-error
        const ids = mk.options.rwbIds as string[] | undefined;
        if (ids) allIds.push(...ids);
      }
      onPickGroup({
        ids: allIds,
        label: `Зона: ${markers.length} точек, ${allIds.length} замеров`,
      });
    });

    map.addLayer(cluster);
    clusterRef.current = cluster;

    return () => {
      map.removeLayer(cluster);
      clusterRef.current = null;
    };
  }, [items, map, onPickGroup]);

  return null;
}

export function AdminScreensMap({ open, onClose }: Props) {
  const [items, setItems] = useState<ScreenItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [useTime, setUseTime] = useState(false);
  const [sliderPos, setSliderPos] = useState(0); // 0..1

  // Текущая выборка справа (от клика по маркеру или кластеру)
  const [picked, setPicked] = useState<{ ids: string[]; label: string } | null>(
    null,
  );
  // Один развёрнутый элемент списка
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Кэш деталей по id, чтобы не запрашивать повторно
  const [detailCache, setDetailCache] = useState<
    Record<string, ScreenDetails>
  >({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  // Полноэкранный просмотр скрина
  const [zoomScreen, setZoomScreen] = useState<string | null>(null);

  // Сбросить состояние при открытии/закрытии диалога
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setPicked(null);
    setExpandedId(null);
    fetch("/api/screens/screens-map?days=7")
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || "load failed");
        setItems(j.items as ScreenItem[]);
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false));
  }, [open]);

  // Каждый раз, когда юзер кликает на новый кластер/маркер — сворачиваем
  // развёрнутую карточку, чтобы правая панель «обновилась».
  const handlePickGroup = useCallback(
    (payload: { ids: string[]; label: string }) => {
      setPicked(payload);
      setExpandedId(null);
    },
    [],
  );

  // Если из-за фильтра по времени точка пропала — снимаем выбор
  useEffect(() => {
    if (!picked) return;
    const visibleSet = new Set(items.map((i) => i.id));
    const remaining = picked.ids.filter((id) => visibleSet.has(id));
    if (remaining.length === 0) {
      setPicked(null);
      setExpandedId(null);
    }
  }, [items, picked]);

  // диапазон времени по данным
  const timeRange = useMemo(() => {
    if (!items.length) return null;
    let min = Infinity,
      max = -Infinity;
    for (const it of items) {
      const t = new Date(it.uploadedAt).getTime();
      if (!isFinite(t)) continue;
      if (t < min) min = t;
      if (t > max) max = t;
    }
    if (!isFinite(min) || !isFinite(max)) return null;
    return { min, max };
  }, [items]);

  // фильтрация по слайдеру (окно ±15 мин)
  const visible = useMemo(() => {
    if (!useTime || !timeRange) return items;
    const center =
      timeRange.min + sliderPos * (timeRange.max - timeRange.min);
    const half = (WINDOW_MIN / 2) * 60_000;
    return items.filter((it) => {
      const t = new Date(it.uploadedAt).getTime();
      return Math.abs(t - center) <= half;
    });
  }, [items, useTime, sliderPos, timeRange]);

  const sliderCenterMs = useMemo(() => {
    if (!timeRange) return null;
    return timeRange.min + sliderPos * (timeRange.max - timeRange.min);
  }, [timeRange, sliderPos]);

  // выбранные замеры — по часу убыванию (новые сверху)
  const pickedItems = useMemo(() => {
    if (!picked) return [];
    const set = new Set(picked.ids);
    const arr = items.filter((it) => set.has(it.id));
    arr.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
    return arr;
  }, [picked, items]);

  // Загружаем детали при разворачивании (если ещё не в кэше)
  const expandItem = useCallback(
    (id: string) => {
      // toggle: если уже открыт — закрываем
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      if (detailCache[id]) return; // уже есть
      setDetailLoadingId(id);
      fetch(`/api/screens/screens-map/details?id=${encodeURIComponent(id)}`)
        .then((r) => r.json())
        .then((j) => {
          if (!j.ok) throw new Error(j.error || "load failed");
          setDetailCache((prev) => ({ ...prev, [id]: j.item as ScreenDetails }));
        })
        .catch((e) => setError(String(e?.message || e)))
        .finally(() =>
          setDetailLoadingId((cur) => (cur === id ? null : cur)),
        );
    },
    [expandedId, detailCache],
  );

  return (
    <>
      <style>{`
        .rwb-screen-pin .rwb-pin-inner{
          width:22px;height:22px;border-radius:50%;
          background:#0ea5e9;border:2px solid #fff;
          box-shadow:0 1px 4px rgba(0,0,0,.4);
          color:#fff;font-size:11px;font-weight:700;
          display:flex;align-items:center;justify-content:center;
          cursor:pointer;
        }
        .rwb-screen-pin .rwb-pin-multi{ background:#f59e0b; }
        .rwb-screens-aside { scrollbar-width: thin; }
      `}</style>

      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-[95vw] w-[95vw] h-[92vh] p-0 flex flex-col gap-0">
          <DialogHeader className="px-4 py-2.5 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4 text-sky-600" />
              Карта замеров Yandex Go — последние 7 дней
              {!loading && items.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {visible.length} / {items.length}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Тулбар времени */}
          <div className="border-b px-4 py-2 flex items-center gap-3 shrink-0 bg-slate-50">
            <div className="flex items-center gap-2">
              <Switch
                id="use-time"
                checked={useTime}
                onCheckedChange={setUseTime}
              />
              <label htmlFor="use-time" className="text-xs cursor-pointer">
                По времени (окно ±15 мин)
              </label>
            </div>
            {useTime && timeRange && (
              <>
                <div className="text-[11px] text-slate-500 whitespace-nowrap">
                  {fmtMsk(new Date(timeRange.min).toISOString())}
                </div>
                <Slider
                  value={[sliderPos * 1000]}
                  onValueChange={(v) => setSliderPos(v[0] / 1000)}
                  min={0}
                  max={1000}
                  step={1}
                  className="flex-1"
                />
                <div className="text-[11px] text-slate-500 whitespace-nowrap">
                  {fmtMsk(new Date(timeRange.max).toISOString())}
                </div>
                <div className="text-xs font-semibold text-sky-700 whitespace-nowrap min-w-[110px] text-right">
                  <Clock className="inline h-3 w-3 mr-1" />
                  {sliderCenterMs &&
                    fmtMsk(new Date(sliderCenterMs).toISOString())}
                </div>
              </>
            )}
            {!useTime && (
              <div className="text-xs text-slate-500">
                Показаны все замеры за последние 7 дней — двиньте тумблер,
                чтобы фильтровать по времени.
              </div>
            )}
          </div>

          {/* Карта + панель */}
          <div className="flex-1 min-h-0 flex">
            {/* Карта (динамическая, ужимается когда открыта панель) */}
            <div className="flex-1 min-w-0 relative">
              {loading && (
                <div className="absolute inset-0 z-[500] bg-white/60 flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-sky-600" />
                </div>
              )}
              {error && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[500] bg-red-50 border border-red-200 text-red-700 px-3 py-1 rounded text-sm">
                  Ошибка: {error}
                </div>
              )}
              <MapContainer
                center={MINSK_CENTER}
                zoom={12}
                maxZoom={18}
                style={{ width: "100%", height: "100%" }}
                attributionControl={false}
              >
                <TileLayer
                  url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                  subdomains={["a", "b", "c", "d"]}
                  maxZoom={19}
                />
                <ClusterLayer items={visible} onPickGroup={handlePickGroup} />
              </MapContainer>
            </div>

            {/* Средняя панель — детали выбранного замера. Появляется только при expandedId,
                занимает фиксированную ширину и полную высоту, показывает скрин целиком
                (object-contain) без обрезки сверху/снизу. */}
            {expandedId && (() => {
              const it = pickedItems.find((x) => x.id === expandedId);
              const det = detailCache[expandedId];
              const isLoading = detailLoadingId === expandedId;
              if (!it) return null;
              return (
                <section
                  className="rwb-screens-detail w-[480px] border-l bg-slate-50 shrink-0 flex flex-col min-h-0"
                  data-testid="screen-detail-panel"
                >
                  <header className="flex items-start justify-between px-3 py-2 border-b bg-white shrink-0">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 leading-tight">
                        {fmtMskTime(it.uploadedAt)}
                        <span className="text-[11px] font-normal text-slate-500 ml-1.5">
                          {fmtMsk(it.uploadedAt).slice(0, 10)}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 truncate mt-0.5">
                        {it.fromAddressGeo || it.fromAddress}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        → {it.toAddressGeo || it.toAddress}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 -mr-1 shrink-0"
                      onClick={() => setExpandedId(null)}
                      title="Закрыть детали"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </header>

                  <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                    {isLoading && (
                      <div className="py-6 flex justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
                      </div>
                    )}

                    {det && (
                      <>
                        {det.screenUrl && (
                          <button
                            onClick={() => setZoomScreen(det.screenUrl)}
                            className="block w-full bg-slate-900 rounded overflow-hidden border hover:border-sky-400 transition relative group"
                            title="Открыть на полный экран"
                          >
                            <img
                              src={det.screenUrl}
                              alt="screen"
                              className="w-full h-auto max-h-[68vh] object-contain mx-auto block"
                            />
                            <div className="absolute top-1 right-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
                              <Maximize2 className="h-3 w-3" />
                              развернуть
                            </div>
                          </button>
                        )}

                        {det.tariffs && det.tariffs.length > 0 && (
                          <table className="w-full text-xs border-collapse bg-white">
                            <thead className="bg-slate-100">
                              <tr>
                                <th className="text-left p-1.5 border">Тариф</th>
                                <th className="text-right p-1.5 border">Цена</th>
                                <th className="text-right p-1.5 border">Сёрдж</th>
                              </tr>
                            </thead>
                            <tbody>
                              {det.tariffs.map((t, i) => (
                                <tr key={i}>
                                  <td className="p-1.5 border">{t.name}</td>
                                  <td className="p-1.5 border text-right tabular-nums">
                                    {t.price?.toFixed(2) ?? "—"}
                                  </td>
                                  <td className="p-1.5 border text-right">
                                    {surgeBadge(t.surge)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}

                        {det.anomaly?.suspicious && (
                          <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800">
                            <div className="font-semibold">
                              ⚠ Аномалия ({det.anomaly.severity})
                            </div>
                            <div className="mt-1">{det.anomaly.reason}</div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </section>
              );
            })()}

            {/* Боковая панель — динамическая, всегда показывает текущую выборку */}
            <aside className="rwb-screens-aside w-[380px] border-l bg-white overflow-y-auto shrink-0">
              {!picked && (
                <div className="p-4 text-sm text-slate-500">
                  <div className="font-semibold text-slate-700 mb-2">
                    Кликните маркер или кластер на карте
                  </div>
                  <p>
                    На карте — стартовые точки заказов из Yandex Go. Оранжевые
                    маркеры с числом — несколько замеров в одной точке. Серые с
                    числом — кластер из нескольких разных точек поблизости.
                  </p>
                  <p className="mt-2">
                    Кликните по маркеру или кластеру — справа появится список
                    замеров. Каждый элемент списка можно развернуть прямо
                    здесь — увидите скриншот, тарифы и сёрдж.
                  </p>
                </div>
              )}

              {picked && (
                <div className="p-3">
                  <div className="flex items-start justify-between mb-2 sticky top-0 bg-white pb-2 z-10 border-b -mx-3 px-3 -mt-3 pt-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-800 leading-tight">
                        {picked.label}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {pickedItems.length} замер{pickedItems.length === 1 ? "" : pickedItems.length < 5 ? "а" : "ов"}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 -mr-1"
                      onClick={() => {
                        setPicked(null);
                        setExpandedId(null);
                      }}
                      title="Закрыть выборку"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="space-y-1.5">
                    {pickedItems.map((it) => {
                      const isOpen = expandedId === it.id;
                      const isLoading = detailLoadingId === it.id;
                      const det = detailCache[it.id];
                      return (
                        <div
                          key={it.id}
                          className={`border rounded transition ${
                            isOpen
                              ? "border-sky-400 bg-sky-50/40 shadow-sm"
                              : "border-slate-200 hover:border-sky-300 hover:bg-sky-50/30"
                          }`}
                        >
                          {/* Шапка — клик открывает детали в средней панели */}
                          <button
                            onClick={() => expandItem(it.id)}
                            className="w-full text-left p-2 flex items-start gap-2"
                            data-testid={`screen-row-${it.id}`}
                          >
                            <ChevronRight
                              className={`h-4 w-4 shrink-0 mt-0.5 transition ${
                                isOpen ? "text-sky-600" : "text-slate-400"
                              }`}
                            />

                            {/* Мини-превью скрина (76×100, обрезано) */}
                            {it.screenUrl ? (
                              <div className="shrink-0 w-[60px] h-[80px] rounded overflow-hidden border bg-slate-100">
                                <img
                                  src={it.screenUrl}
                                  alt=""
                                  loading="lazy"
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ) : (
                              <div className="shrink-0 w-[60px] h-[80px] rounded bg-slate-100 flex items-center justify-center">
                                <ImageIcon className="h-5 w-5 text-slate-400" />
                              </div>
                            )}

                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-mono font-semibold text-slate-800">
                                {fmtMskTime(it.uploadedAt)}
                                <span className="text-[10px] font-sans font-normal text-slate-400 ml-1.5">
                                  {fmtMsk(it.uploadedAt).slice(0, 5)}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-600 truncate mt-0.5">
                                {it.fromAddressGeo || it.fromAddress}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate">
                                → {it.toAddressGeo || it.toAddress}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-1 flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                                {it.factE != null && (
                                  <span className="font-medium text-slate-700">
                                    эк {it.factE.toFixed(1)}
                                  </span>
                                )}
                                {it.factC != null && (
                                  <span>биз {it.factC.toFixed(1)}</span>
                                )}
                                {it.tripMin != null && (
                                  <span>{it.tripMin} мин</span>
                                )}
                                {it.demand && demandPill(it.demand)}
                              </div>
                              {it.anomaly?.suspicious && (
                                <div className="text-[10px] text-red-700 mt-0.5">
                                  ⚠ {it.anomaly.severity}
                                </div>
                              )}
                            </div>
                          </button>

                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </DialogContent>
      </Dialog>

      {/* Полноэкранный просмотр скрина — статический оверлей поверх всего */}
      {zoomScreen && (
        <div
          className="fixed inset-0 z-[2000] bg-black/85 flex items-center justify-center p-4"
          onClick={() => setZoomScreen(null)}
        >
          <Button
            variant="secondary"
            size="sm"
            className="absolute top-3 right-3 z-10"
            onClick={(e) => {
              e.stopPropagation();
              setZoomScreen(null);
            }}
          >
            <X className="h-4 w-4 mr-1" /> Закрыть
          </Button>
          <img
            src={zoomScreen}
            alt="full screen"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
