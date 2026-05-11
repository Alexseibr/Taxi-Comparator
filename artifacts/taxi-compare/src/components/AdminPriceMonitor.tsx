import { useState, useEffect, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe,
} from "lucide-react";
import { useIsAdmin } from "@/lib/admin-auth";
import { YandexProbeBookmarklet } from "./YandexProbeBookmarklet";

const MONITORED_ROUTES = [
  {
    label: "Вокзал → Минск-Арена",
    fromAddr: "ул. Вокзальная 17",
    toAddr: "пр. Победителей 111",
    from: { lat: 53.8902, lng: 27.5495 },
    to:   { lat: 53.9347, lng: 27.4825 },
  },
  {
    label: "Немига → Уручье",
    fromAddr: "ул. Немига 12б",
    toAddr: "ул. Ложинская 18",
    from: { lat: 53.9028, lng: 27.5485 },
    to:   { lat: 53.9509, lng: 27.6810 },
  },
  {
    label: "Кунцевщина → Победы",
    fromAddr: "ул. Матусевича 46",
    toAddr: "пр. Независимости 31A",
    from: { lat: 53.9165, lng: 27.4687 },
    to:   { lat: 53.9079, lng: 27.5722 },
  },
  {
    label: "Малиновка → ЦУМ",
    fromAddr: "ул. Есенина 6/1",
    toAddr: "пр. Независимости 54",
    from: { lat: 53.8500, lng: 27.4675 },
    to:   { lat: 53.9145, lng: 27.5876 },
  },
  {
    label: "Вокзал → Кам. Горка",
    fromAddr: "Привокзальная пл. 3",
    toAddr: "ул. Аладовых 13",
    from: { lat: 53.8910, lng: 27.5497 },
    to:   { lat: 53.9221, lng: 27.4561 },
  },
  {
    label: "Победы → Московская",
    fromAddr: "пр. Независимости 31A",
    toAddr: "ул. Волгоградская 23",
    from: { lat: 53.9079, lng: 27.5722 },
    to:   { lat: 53.9343, lng: 27.6193 },
  },
] as const;

interface PriceQuantile {
  low: number;
  med: number;
  high: number;
}

type RouteStatus = "idle" | "loading" | "ok" | "error";

interface RouteResult {
  label: string;
  fromAddr: string;
  toAddr: string;
  status: RouteStatus;
  km?: number;
  E?: PriceQuantile;
  C?: PriceQuantile;
  error?: string;
}

interface MlBatchResponse {
  model_version: string;
  n_ok: number;
  n_err: number;
  results: Array<{
    idx: number;
    ok: boolean;
    km?: number;
    error?: string;
    E?: PriceQuantile;
    C?: PriceQuantile;
  }>;
}

async function fetchMlBatch(routes: typeof MONITORED_ROUTES): Promise<MlBatchResponse> {
  const now = new Date();
  const hour = now.getHours();
  const dow  = (now.getDay() + 6) % 7;

  const body = JSON.stringify({
    rows: routes.map((r) => ({
      from_lat: r.from.lat,
      from_lng: r.from.lng,
      to_lat:   r.to.lat,
      to_lng:   r.to.lng,
      hour,
      dow,
    })),
  });

  const res = await fetch("/api/ml/predict-price/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<MlBatchResponse>;
}

function PriceQ({ q, highlight }: { q?: PriceQuantile; highlight?: boolean }) {
  if (!q) return <span className="text-muted-foreground text-xs">нет</span>;
  return (
    <span className={highlight ? "text-rose-600 font-semibold" : "font-medium"}>
      <span className="text-[11px] text-muted-foreground">{q.low.toFixed(1)}–</span>
      <span>{q.med.toFixed(1)}</span>
      <span className="text-[11px] text-muted-foreground">–{q.high.toFixed(1)}</span>
      <span className="text-[11px] text-muted-foreground"> р</span>
    </span>
  );
}

function RouteRow({ r }: { r: RouteResult }) {
  const cMoreExpensive = r.C && r.E && r.C.med > r.E.med;
  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
      <td className="py-2 pr-3 text-[12px]">
        <div className="font-medium leading-tight">{r.label}</div>
        <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
          {r.fromAddr}
        </div>
        <div className="text-[10px] text-muted-foreground leading-tight">
          → {r.toAddr}
          {r.km ? <span className="ml-1 text-sky-600">{r.km.toFixed(1)} км</span> : ""}
        </div>
      </td>
      <td className="py-2 pr-2 text-[12px] text-center whitespace-nowrap">
        {r.status === "loading" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground mx-auto" />
        ) : r.status === "error" ? (
          <span title={r.error}><AlertTriangle className="h-3.5 w-3.5 text-rose-500 mx-auto" /></span>
        ) : (
          <PriceQ q={r.E} />
        )}
      </td>
      <td className="py-2 text-[12px] text-center whitespace-nowrap">
        {r.status === "loading" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground mx-auto" />
        ) : r.status === "error" ? (
          <span className="text-[10px] text-rose-500">{r.error?.slice(0, 20)}</span>
        ) : (
          <PriceQ q={r.C} highlight={!cMoreExpensive && r.status === "ok"} />
        )}
      </td>
    </tr>
  );
}

type Tab = "ml" | "real";

interface AdminPriceMonitorButtonProps {
  variant?: "icon" | "full" | "toolbar";
  onBeforeOpen?: () => void;
}

export function AdminPriceMonitorButton({
  variant = "icon",
  onBeforeOpen,
}: AdminPriceMonitorButtonProps) {
  const isAdmin = useIsAdmin();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("ml");
  const [results, setResults] = useState<RouteResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [modelVersion, setModelVersion] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setBatchError(null);
    setResults(
      MONITORED_ROUTES.map((r) => ({
        label:    r.label,
        fromAddr: r.fromAddr,
        toAddr:   r.toAddr,
        status:   "loading",
      })),
    );

    try {
      const data = await fetchMlBatch(MONITORED_ROUTES);
      setModelVersion(data.model_version ?? null);
      setResults(
        MONITORED_ROUTES.map((r, i) => {
          const item = data.results.find((x) => x.idx === i);
          if (!item || !item.ok) {
            return {
              label: r.label, fromAddr: r.fromAddr, toAddr: r.toAddr,
              status: "error" as const,
              error: item?.error ?? "нет данных",
            };
          }
          return {
            label:    r.label,
            fromAddr: r.fromAddr,
            toAddr:   r.toAddr,
            status:   "ok",
            km:       item.km,
            E:        item.E ?? undefined,
            C:        item.C ?? undefined,
          };
        }),
      );
      setUpdatedAt(new Date());
    } catch (e) {
      const msg = String(e);
      setBatchError(msg);
      setResults(
        MONITORED_ROUTES.map((r) => ({
          label:    r.label,
          fromAddr: r.fromAddr,
          toAddr:   r.toAddr,
          status:   "error",
          error:    msg,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && tab === "ml" && results.length === 0) {
      refresh();
    }
  }, [open, tab, results.length, refresh]);

  if (!isAdmin) return null;

  const trigger =
    variant === "icon" ? (
      <Button
        variant="outline"
        size="icon"
        className="h-14 w-12 shrink-0 border-amber-300 bg-amber-50/60 hover:bg-amber-100"
        title="Мониторинг цен (только для админа)"
        data-testid="btn-admin-price-monitor"
      >
        <Activity className="h-5 w-5 text-amber-700" />
      </Button>
    ) : variant === "toolbar" ? (
      <Button
        variant="outline"
        size="sm"
        className="text-xs h-8 gap-1.5 border-amber-300 bg-amber-50/60 hover:bg-amber-100"
        title="Мониторинг цен"
        data-testid="btn-toolbar-price-monitor"
      >
        <Activity className="w-3.5 h-3.5 text-amber-700" />
        ML цены
      </Button>
    ) : (
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start gap-2 h-9 border-amber-300 bg-amber-50/60 hover:bg-amber-100"
        data-testid="btn-mobile-price-monitor"
      >
        <Activity className="h-4 w-4 text-amber-700" />
        Мониторинг ML цен
      </Button>
    );

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (v && onBeforeOpen) onBeforeOpen();
        setOpen(v);
      }}
    >
      <SheetTrigger asChild>{trigger}</SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-amber-700" />
            Мониторинг цен
            <Badge
              variant="outline"
              className="text-[10px] border-amber-300 text-amber-700 ml-1"
            >
              admin
            </Badge>
          </SheetTitle>
        </SheetHeader>

        {/* Вкладки */}
        <div className="flex gap-1 mb-4 border-b pb-0">
          <button
            onClick={() => setTab("ml")}
            className={`px-3 py-1.5 text-sm rounded-t-md border-b-2 transition-colors ${
              tab === "ml"
                ? "border-amber-500 text-amber-800 font-semibold bg-amber-50"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              ML-прогноз
            </span>
          </button>
          <button
            onClick={() => setTab("real")}
            className={`px-3 py-1.5 text-sm rounded-t-md border-b-2 transition-colors ${
              tab === "real"
                ? "border-blue-500 text-blue-800 font-semibold bg-blue-50"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" />
              Реальные (BY-IP)
            </span>
          </button>
        </div>

        {/* Вкладка ML */}
        {tab === "ml" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                {updatedAt ? (
                  <>
                    <Clock className="h-3 w-3" />
                    {updatedAt.toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                    {modelVersion && (
                      <span className="text-[10px] opacity-60 ml-1">{modelVersion}</span>
                    )}
                  </>
                ) : (
                  "Нажмите «Обновить»"
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={refresh}
                disabled={loading}
                className="h-7 text-xs gap-1.5"
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Обновить
              </Button>
            </div>

            <div className="text-[11px] text-muted-foreground leading-relaxed bg-muted/40 rounded-md p-2.5 border">
              ⚠ Прогноз CatBoost-модели (P10 · <b>P50</b> · P90).{" "}
              <b>Не реальный скрапинг Яндекс.</b>{" "}
              Используй вкладку «Реальные (BY-IP)» для снятия фактических цен.
            </div>

            {results.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
                Нет данных — нажмите «Обновить»
              </div>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        Маршрут
                      </th>
                      <th className="pb-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        🟡 Эконом
                      </th>
                      <th className="pb-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        🟠 Комфорт
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <RouteRow key={r.label} r={r} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {updatedAt && results.every((r) => r.status === "ok") && (
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Все маршруты — CatBoost ML
              </div>
            )}

            {batchError && (
              <div className="flex items-start gap-1.5 text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-md p-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>ML сервер недоступен: {batchError}</span>
              </div>
            )}
          </div>
        )}

        {/* Вкладка реальные цены */}
        {tab === "real" && <YandexProbeBookmarklet />}
      </SheetContent>
    </Sheet>
  );
}
