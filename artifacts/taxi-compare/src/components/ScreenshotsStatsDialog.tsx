// ScreenshotsStatsDialog — отчёт по импорту скриншотов в браузере (T009).
// Источники:
//   GET /api/newstat/parsing/uploads-stats?from&to → дерево IP→день→items + сводка по устройствам
//   GET /api/newstat/parsing/screen/:id          → сам jpg/png (защищён auth)
//
// Устройства склеиваются на бэке через iPhone IMG-counter (один телефон может
// ходить из разных IP). Поэтому есть две вкладки: «По устройствам» и «По IP».
//
// Превью картинок (Bearer-protected) грузим через fetch+blob+URL.createObjectURL
// и шарим через простой in-memory cache, чтобы один скрин не качался дважды.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  Camera,
  ChevronRight,
  Smartphone,
  Globe2,
  AlertTriangle,
  X,
} from "lucide-react";
import { getToken, setToken, newstatApi } from "@/newstat/lib/api";

const MAX_DAYS = 31;

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function localDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
async function ensureNewstatToken(): Promise<string | null> {
  const existing = getToken();
  if (existing) return existing;
  try {
    const r = await newstatApi.sso();
    if (r.ok && r.data?.token) {
      setToken(r.data.token);
      return r.data.token;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ─────────────────────── Types (mirror backend shape) ───────────────────────
interface ScreenItem {
  id: string;
  uploadedAt: string;
  uploadedTime: string;
  source: string;
  jpg: string;
  suspicious: boolean;
  anomalyCategory: string;
  anomalySeverity: string;
  fromAddress: string;
  toAddress: string;
  factC: number | null;
}
interface DayBucket {
  day: string;
  total: number;
  suspicious: number;
  items: ScreenItem[];
}
interface IpRow {
  ip: string;
  deviceId: string;
  deviceType: string;
  isHub?: boolean;
  total: number;
  suspicious: number;
  firstSeen: string;
  lastSeen: string;
  sources: { source: string; count: number }[];
  operators?: { name: string; count: number }[];
  days: DayBucket[];
}
interface DeviceRow {
  id: string;
  type: string;
  ips: string[];
  total: number;
  suspicious: number;
  daysCount: number;
  firstSeen: string;
  lastSeen: string;
  imgMin: number | null;
  imgMax: number | null;
  mergedBy?: string[];
  hubIps?: string[];
  operators?: { name: string; count: number }[];
}
interface AddressLink {
  a: string;
  b: string;
  address: string;
  aCount: number;
  bCount: number;
  uniqueIps: number;
  sameDevice: boolean;
}
interface StatsResponse {
  ok: boolean;
  from: string;
  to: string;
  total: number;
  ipsCount: number;
  devicesCount: number;
  hubsCount?: number;
  truncated: boolean;
  devices: DeviceRow[];
  ips: IpRow[];
  addressLinks?: AddressLink[];
}

// ─────────────────────── Auth-protected image cache ───────────────────────
// Один Map на жизнь компонента. Ключ = id скрина, значение = object URL.
//
// Возвращаемый объект {load, dispose} стабилен по идентичности между рендерами:
// и сами функции, и обёртка обёрнуты в useCallback/useMemo, чтобы дочерние
// компоненты (AuthImage, Lightbox), у которых cache стоит в зависимостях
// useEffect, не запускали свои эффекты лишний раз при каждом ререндере родителя.
type ImageCache = {
  load: (id: string) => Promise<string | null>;
  dispose: () => void;
};
function useImageCache(): ImageCache {
  const cache = useRef<Map<string, string>>(new Map());
  const inflight = useRef<Map<string, Promise<string | null>>>(new Map());

  const load = useCallback(async (id: string): Promise<string | null> => {
    const existing = cache.current.get(id);
    if (existing) return existing;
    const inFlight = inflight.current.get(id);
    if (inFlight) return inFlight;
    const p = (async () => {
      const token = await ensureNewstatToken();
      if (!token) return null;
      const resp = await fetch(`/api/newstat/parsing/screen/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      cache.current.set(id, url);
      return url;
    })();
    inflight.current.set(id, p);
    try {
      return await p;
    } finally {
      inflight.current.delete(id);
    }
  }, []);

  const dispose = useCallback(() => {
    for (const url of cache.current.values()) URL.revokeObjectURL(url);
    cache.current.clear();
  }, []);

  // Гарантированный cleanup при размонтировании компонента — даже если
  // диалог никогда не «закрывался» через onOpenChange (например,
  // переход по роуту с открытым диалогом).
  useEffect(() => {
    return () => {
      for (const url of cache.current.values()) URL.revokeObjectURL(url);
      cache.current.clear();
    };
  }, []);

  return useMemo(() => ({ load, dispose }), [load, dispose]);
}

// ─────────────────────── AuthImage (lazy thumbnail) ───────────────────────
function AuthImage({
  id,
  cache,
  onClick,
  className = "",
}: {
  id: string;
  cache: ReturnType<typeof useImageCache>;
  onClick?: () => void;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  // Lazy: грузим только когда контейнер попал в viewport
  useEffect(() => {
    if (!ref.current || visible) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisible(true);
      },
      { rootMargin: "200px" },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    cache.load(id).then((u) => {
      if (!alive) return;
      if (u) setUrl(u);
      else setErr(true);
    });
    return () => {
      alive = false;
    };
  }, [visible, id, cache]);

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`relative bg-muted border rounded overflow-hidden flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-blue-400 transition ${className}`}
      title="Кликните для увеличения"
    >
      {url ? (
        <img
          src={url}
          alt={id}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : err ? (
        <span className="text-[9px] text-red-500">нет файла</span>
      ) : (
        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

// ─────────────────────── Lightbox (full-screen preview) ───────────────────────
function Lightbox({
  id,
  cache,
  onClose,
}: {
  id: string;
  cache: ReturnType<typeof useImageCache>;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    cache.load(id).then((u) => setUrl(u));
  }, [id, cache]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="screenshot-lightbox"
    >
      <button
        className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2 hover:bg-black/80"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Закрыть"
      >
        <X className="w-5 h-5" />
      </button>
      <div className="absolute top-4 left-4 text-white text-xs bg-black/50 px-2 py-1 rounded">
        {id}
      </div>
      {url ? (
        <img
          src={url}
          alt={id}
          className="max-w-full max-h-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      )}
    </div>
  );
}

// ─────────────────────── Subviews ───────────────────────
function ItemRow({
  it,
  cache,
  onPreview,
}: {
  it: ScreenItem;
  cache: ReturnType<typeof useImageCache>;
  onPreview: (id: string) => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 p-1.5 rounded text-[11px] hover:bg-blue-50 ${it.suspicious ? "bg-amber-50" : ""}`}
    >
      <AuthImage
        id={it.id}
        cache={cache}
        onClick={() => onPreview(it.id)}
        className="w-12 h-16 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[10px] text-muted-foreground truncate">
          {it.uploadedTime || "—"} · {it.jpg || "(без имени)"}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">
          {it.source}
          {it.suspicious && (
            <span className="ml-1 text-amber-700 inline-flex items-center gap-0.5">
              <AlertTriangle className="w-2.5 h-2.5" />
              {it.anomalyCategory || "подозр"}
            </span>
          )}
        </div>
        {(it.fromAddress || it.toAddress) && (
          <div className="text-[10px] text-muted-foreground truncate">
            {it.fromAddress} → {it.toAddress}
          </div>
        )}
      </div>
    </div>
  );
}

function DayBlock({
  d,
  cache,
  onPreview,
}: {
  d: DayBucket;
  cache: ReturnType<typeof useImageCache>;
  onPreview: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded ml-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1 hover:bg-blue-50 text-left text-xs"
      >
        <ChevronRight
          className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="font-medium">{d.day}</span>
        <span className="text-muted-foreground">
          · {d.total} скр{d.suspicious > 0 && `, ⚠ ${d.suspicious}`}
        </span>
      </button>
      {open && (
        <div className="px-1 pb-1 space-y-0.5 max-h-96 overflow-y-auto">
          {d.items.map((it) => (
            <ItemRow
              key={it.id}
              it={it}
              cache={cache}
              onPreview={onPreview}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function IpBlock({
  ip,
  cache,
  onPreview,
  showDeviceId = false,
}: {
  ip: IpRow;
  cache: ReturnType<typeof useImageCache>;
  onPreview: (id: string) => void;
  showDeviceId?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const typeIcon =
    ip.deviceType === "iPhone" || ip.deviceType === "Android" ? (
      <Smartphone className="w-3 h-3 text-emerald-700" />
    ) : (
      <Globe2 className="w-3 h-3 text-muted-foreground" />
    );
  return (
    <div className="border rounded">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-blue-50 text-left text-sm"
      >
        <ChevronRight
          className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {typeIcon}
        <span className="font-mono">{ip.ip}</span>
        <span className="text-xs text-muted-foreground">[{ip.deviceType}]</span>
        {ip.isHub && (
          <span
            className="text-[10px] px-1 rounded bg-amber-100 text-amber-800 border border-amber-300"
            title="Публичный/CGNAT IP — через него ходят разные телефоны. Не используется для склейки устройств."
          >
            HUB/CGNAT
          </span>
        )}
        {showDeviceId && ip.ip !== ip.deviceId && (
          <span className="text-[10px] text-blue-600">
            ↔ {ip.deviceId}
          </span>
        )}
        {ip.operators && ip.operators.length > 0 && (
          <span
            className="text-[10px] px-1 rounded bg-violet-100 text-violet-800 border border-violet-200"
            title={`Операторы, заходившие с этого IP:\n${ip.operators.map((o) => `${o.name}: ${o.count}`).join("\n")}`}
          >
            👤 {ip.operators[0].name}
            {ip.operators.length > 1 && ` +${ip.operators.length - 1}`}
          </span>
        )}
        <span className="ml-auto text-xs">
          <b>{ip.total}</b> скр
          {ip.suspicious > 0 && (
            <span className="text-amber-700 ml-1">⚠ {ip.suspicious}</span>
          )}
          <span className="text-muted-foreground ml-1">
            · {ip.days.length} дн
          </span>
        </span>
      </button>
      {open && (
        <div className="p-1 space-y-1">
          {ip.days.map((d) => (
            <DayBlock
              key={d.day}
              d={d}
              cache={cache}
              onPreview={onPreview}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceBlock({
  dev,
  ips,
  cache,
  onPreview,
}: {
  dev: DeviceRow;
  ips: IpRow[];
  cache: ReturnType<typeof useImageCache>;
  onPreview: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasHub = (dev.hubIps?.length || 0) > 0;
  const mergedBy = dev.mergedBy || [];
  return (
    <div
      className={`border rounded ${hasHub ? "border-amber-300 bg-amber-50/40" : "border-emerald-200 bg-emerald-50/30"}`}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm ${hasHub ? "hover:bg-amber-50" : "hover:bg-emerald-50"}`}
      >
        <ChevronRight
          className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Smartphone
          className={`w-3.5 h-3.5 ${hasHub ? "text-amber-700" : "text-emerald-700"}`}
        />
        <span className="font-medium">{dev.type}</span>
        <span className="text-xs text-muted-foreground">
          {dev.ips.length} IP
          {dev.imgMin !== null &&
            dev.imgMax !== null &&
            ` · IMG_${dev.imgMin}…${dev.imgMax}`}
        </span>
        {mergedBy.map((m) => (
          <span
            key={m}
            className="text-[10px] px-1 rounded bg-blue-100 text-blue-800 border border-blue-200"
            title={
              m.startsWith("exact-img")
                ? "Склеено по точному совпадению имени файла IMG_NNNN на двух IP"
                : "Склеено по перекрытию счётчика IMG между IP (один iPhone, разные сети)"
            }
          >
            {m}
          </span>
        ))}
        {hasHub && (
          <span
            className="text-[10px] px-1 rounded bg-amber-100 text-amber-800 border border-amber-300"
            title="В кластере есть публичные/CGNAT IP — кластеризация только по личному счётчику IMG, а не по адресу"
          >
            HUBs:{dev.hubIps!.length}
          </span>
        )}
        {dev.operators && dev.operators.length > 0 && (
          <span
            className="text-[10px] px-1 rounded bg-violet-100 text-violet-800 border border-violet-200"
            title={`Операторы устройства:\n${dev.operators.map((o) => `${o.name}: ${o.count}`).join("\n")}`}
          >
            👤 {dev.operators[0].name}
            {dev.operators.length > 1 && ` +${dev.operators.length - 1}`}
          </span>
        )}
        <span className="ml-auto text-xs">
          <b>{dev.total}</b> скр
          {dev.suspicious > 0 && (
            <span className="text-amber-700 ml-1">⚠ {dev.suspicious}</span>
          )}
          <span className="text-muted-foreground ml-1">
            · {dev.daysCount} дн
          </span>
        </span>
      </button>
      {open && (
        <div className="p-1 space-y-1">
          <div className="text-[10px] text-muted-foreground px-2">
            IP в кластере: {dev.ips.join(", ")}
            {dev.ips.length === 1 && " · одиночный IP, склейки не было"}
          </div>
          {dev.operators && dev.operators.length > 0 && (
            <div className="text-[10px] px-2 text-violet-800">
              Операторы:{" "}
              {dev.operators.map((o) => `${o.name} (${o.count})`).join(", ")}
            </div>
          )}
          {ips.map((ip) => (
            <IpBlock key={ip.ip} ip={ip} cache={cache} onPreview={onPreview} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────── Main dialog ───────────────────────
interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export default function ScreenshotsStatsDialog({ open, onOpenChange }: Props) {
  const [from, setFrom] = useState(localDaysAgo(7));
  const [to, setTo] = useState(todayLocal());
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const cache = useImageCache();

  // Освобождаем blob-URLs при закрытии диалога (плюс отдельный
  // unmount-cleanup внутри useImageCache на случай, если компонент
  // размонтируют, не закрывая диалог).
  useEffect(() => {
    if (!open) cache.dispose();
  }, [open, cache]);

  async function loadStats() {
    setError(null);
    setData(null);
    setLoading(true);
    try {
      const token = await ensureNewstatToken();
      if (!token) throw new Error("Нет доступа: войдите как админ/антифрод.");
      const resp = await fetch(
        `/api/newstat/parsing/uploads-stats?from=${from}&to=${to}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (resp.status === 401) {
        setToken(null);
        throw new Error("Сессия истекла. Войдите заново.");
      }
      if (!resp.ok) {
        let msg = `HTTP ${resp.status}`;
        try {
          const j = await resp.json();
          if (j?.error) msg += ` — ${j.error}`;
        } catch {
          /* */
        }
        throw new Error(msg);
      }
      const j = (await resp.json()) as StatsResponse;
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Группировка IP-строк под устройства для вкладки «По устройствам»
  const ipsByDevice = useMemo(() => {
    const m = new Map<string, IpRow[]>();
    if (!data) return m;
    for (const ip of data.ips) {
      if (!m.has(ip.deviceId)) m.set(ip.deviceId, []);
      m.get(ip.deviceId)!.push(ip);
    }
    return m;
  }, [data]);

  // Сводка по операторам — агрегация из devices.operators
  const { operatorSummary, untaggedCount } = useMemo(() => {
    if (!data) return { operatorSummary: [], untaggedCount: 0 };
    const opMap = new Map<string, { total: number; suspicious: number; devicesSet: Set<string> }>();
    let tagged = 0;
    for (const dev of data.devices) {
      if (!dev.operators || dev.operators.length === 0) continue;
      for (const op of dev.operators) {
        if (!opMap.has(op.name)) opMap.set(op.name, { total: 0, suspicious: 0, devicesSet: new Set() });
        const entry = opMap.get(op.name)!;
        entry.total += op.count;
        entry.devicesSet.add(dev.id);
        tagged += op.count;
      }
      // подозрительные — берём из IP под этим устройством, пропорционально
      const devIps = ipsByDevice.get(dev.id) || [];
      const totalSusp = devIps.reduce((s, ip) => s + ip.suspicious, 0);
      if (totalSusp > 0 && dev.operators.length > 0) {
        const totalOps = dev.operators.reduce((s, o) => s + o.count, 0);
        for (const op of dev.operators) {
          const entry = opMap.get(op.name);
          if (entry) entry.suspicious += Math.round(totalSusp * (op.count / Math.max(totalOps, 1)));
        }
      }
    }
    const summary = [...opMap.entries()]
      .map(([name, e]) => ({ name, total: e.total, suspicious: e.suspicious, devices: e.devicesSet.size }))
      .sort((a, b) => b.total - a.total);
    return { operatorSummary: summary, untaggedCount: Math.max(0, data.total - tagged) };
  }, [data, ipsByDevice]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
          data-testid="screenshots-stats-dialog"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="w-4 h-4" />
              Статистика по скринам
            </DialogTitle>
            <DialogDescription>
              Кто и сколько скринов прислал. Раскрывайте узлы для просмотра
              самих скринов. Один телефон, ходящий из разных сетей, склеивается
              в одно «устройство» по серийным номерам IMG_NNNN (iPhone).
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-end gap-2 py-1 border-b pb-3">
            <div className="space-y-1">
              <Label className="text-xs">С</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 text-xs"
                max={to || todayLocal()}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">По</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 text-xs"
                min={from || undefined}
                max={todayLocal()}
              />
            </div>
            <Button
              size="sm"
              onClick={loadStats}
              disabled={loading || !from || !to}
              data-testid="btn-screenshots-stats-load"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : null}
              Показать
            </Button>
            {data && (
              <div className="ml-2 text-xs text-muted-foreground self-center">
                {data.total} скр · {data.devicesCount} устройств ·{" "}
                {data.ipsCount} IP
                {(data.hubsCount ?? 0) > 0 && (
                  <span
                    className="ml-2 text-amber-700"
                    title="Публичные/CGNAT IP — через них ходят разные телефоны, не используются для склейки"
                  >
                    · {data.hubsCount} HUB/CGNAT
                  </span>
                )}
                {data.truncated && (
                  <span className="ml-2 text-amber-700">⚠ обрезано лимитом</span>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
              Ошибка: {error}
            </div>
          )}

          <div className="flex-1 overflow-hidden min-h-0">
            {!data && !loading && (
              <div className="text-center text-muted-foreground text-sm py-12">
                Выберите период и нажмите «Показать»
              </div>
            )}
            {data && (
              <Tabs defaultValue="devices" className="h-full flex flex-col min-h-0">
                <TabsList className="self-start shrink-0">
                  <TabsTrigger value="operators">
                    По операторам ({operatorSummary.length})
                  </TabsTrigger>
                  <TabsTrigger value="devices">
                    По устройствам ({data.devicesCount})
                  </TabsTrigger>
                  <TabsTrigger value="ips">По IP ({data.ipsCount})</TabsTrigger>
                  <TabsTrigger value="links">
                    Связи ({data.addressLinks?.length ?? 0})
                  </TabsTrigger>
                </TabsList>
                <TabsContent
                  value="operators"
                  className="flex-1 overflow-y-auto min-h-0 mt-2"
                >
                  {operatorSummary.length === 0 ? (
                    <div className="text-center text-muted-foreground text-sm py-8">
                      Нет данных об операторах за этот период
                    </div>
                  ) : (
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b bg-muted/40 text-left">
                          <th className="px-2 py-1.5 font-medium">Оператор</th>
                          <th className="px-2 py-1.5 font-medium text-right">Скринов</th>
                          <th className="px-2 py-1.5 font-medium text-right">Подозр.</th>
                          <th className="px-2 py-1.5 font-medium text-right">% подозр.</th>
                          <th className="px-2 py-1.5 font-medium text-right">Устройств</th>
                        </tr>
                      </thead>
                      <tbody>
                        {operatorSummary.map((op) => (
                          <tr key={op.name} className="border-b hover:bg-muted/20">
                            <td className="px-2 py-1.5 font-medium">
                              <span className="inline-flex items-center gap-1">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 border border-violet-200">
                                  👤 {op.name}
                                </span>
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono">{op.total}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-amber-700">
                              {op.suspicious > 0 ? `⚠ ${op.suspicious}` : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right text-muted-foreground">
                              {op.total > 0 ? `${Math.round((op.suspicious / op.total) * 100)}%` : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right text-muted-foreground">{op.devices}</td>
                          </tr>
                        ))}
                        <tr className="bg-muted/30 font-medium">
                          <td className="px-2 py-1.5">Без оператора</td>
                          <td className="px-2 py-1.5 text-right font-mono">{untaggedCount}</td>
                          <td className="px-2 py-1.5 text-right" />
                          <td className="px-2 py-1.5 text-right" />
                          <td className="px-2 py-1.5 text-right" />
                        </tr>
                      </tbody>
                    </table>
                  )}
                </TabsContent>
                <TabsContent
                  value="devices"
                  className="flex-1 overflow-y-auto min-h-0 space-y-1 mt-2"
                >
                  {data.devices.map((dev) => (
                    <DeviceBlock
                      key={dev.id}
                      dev={dev}
                      ips={ipsByDevice.get(dev.id) || []}
                      cache={cache}
                      onPreview={setPreview}
                    />
                  ))}
                </TabsContent>
                <TabsContent
                  value="ips"
                  className="flex-1 overflow-y-auto min-h-0 space-y-1 mt-2"
                >
                  {data.ips.map((ip) => (
                    <IpBlock
                      key={ip.ip}
                      ip={ip}
                      cache={cache}
                      onPreview={setPreview}
                      showDeviceId
                    />
                  ))}
                </TabsContent>
                <TabsContent
                  value="links"
                  className="flex-1 overflow-y-auto min-h-0 space-y-2 mt-2"
                >
                  <div className="text-xs text-muted-foreground">
                    Возможные связи между IP по общему «домашнему» адресу
                    (≥3 заказов с обеих сторон, адрес видело ≤3 IP). Это{" "}
                    <b>подсказка</b>, а не автосклейка: одинаковый стартовый
                    адрес может быть совпадением. Хабы/CGNAT исключены.
                  </div>
                  {(data.addressLinks?.length ?? 0) === 0 && (
                    <div className="text-center text-muted-foreground text-sm py-8">
                      Связей по адресу не найдено
                    </div>
                  )}
                  {data.addressLinks?.map((l, i) => (
                    <div
                      key={i}
                      className={`border rounded px-2 py-1.5 text-sm ${l.sameDevice ? "border-emerald-200 bg-emerald-50/30" : "border-blue-200 bg-blue-50/30"}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        {l.sameDevice ? (
                          <span
                            className="text-[10px] px-1 rounded bg-emerald-100 text-emerald-800 border border-emerald-300"
                            title="Уже в одном устройстве по другому сигналу"
                          >
                            ✓ same device
                          </span>
                        ) : (
                          <span
                            className="text-[10px] px-1 rounded bg-blue-100 text-blue-800 border border-blue-300"
                            title="Возможно тот же человек, но без подтверждения по IMG-счётчику"
                          >
                            ? possibly same
                          </span>
                        )}
                        <span className="font-mono text-xs">{l.a}</span>
                        <span className="text-muted-foreground">↔</span>
                        <span className="font-mono text-xs">{l.b}</span>
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {l.aCount}× / {l.bCount}× · видит {l.uniqueIps} IP
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        «{l.address}»
                      </div>
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {preview && (
        <Lightbox
          id={preview}
          cache={cache}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
