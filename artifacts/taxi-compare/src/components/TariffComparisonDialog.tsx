// TariffComparisonDialog — T013
// Сравнительный анализ тарифов Yandex (скрины calib-*.json) vs WB (orders).
// Endpoint: GET /api/newstat/parsing/tariff-comparison?from=&to=
// Auth: admin/antifraud (Bearer newstat token, SSO-мост при отсутствии).

import { useState, useMemo } from "react";
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
import { Loader2, BarChart3, RefreshCw } from "lucide-react";
import { getToken, setToken, newstatApi } from "@/newstat/lib/api";

const MAX_DAYS = 31;
const DEFAULT_FROM = "2026-04-02";
const DEFAULT_TO = "2026-04-29";
const DIST_BUCKETS = ["0-3", "3-10", "10-25", "25+"] as const;

type Tier = "econom" | "comfort";
type Rate = "byn_per_km" | "byn_per_min";

interface QStats {
  median: number | null;
  p25: number | null;
  p75: number | null;
  count: number;
}
interface CellRate {
  wb: QStats;
  yandex: QStats;
  delta_pct: number | null;
  low_data: boolean;
}
interface Cell {
  hour: number;
  bucket: string;
  byn_per_km: CellRate;
  byn_per_min: CellRate;
}
interface MixAdjusted {
  delta_pct: number | null;
  overlap_cells: number;
  wb_orders_in_overlap: number;
}
interface OverallRate {
  wb: QStats;
  yandex: QStats;
  delta_pct: number | null;
  mix_adjusted?: MixAdjusted;
  note?: string;
}
interface OverallTier {
  byn_per_km: OverallRate;
  byn_per_min: OverallRate;
}
interface ComparisonResp {
  ok: boolean;
  from: string;
  to: string;
  span_days: number;
  generated_at: string;
  duration_ms: number;
  summary: {
    wb: { econom_count: number; comfort_count: number };
    yandex: {
      scanned: number;
      used: number;
      econom_count: number;
      comfort_count: number;
    };
  };
  tariffs: {
    econom: { overall: OverallTier; cells: Cell[] };
    comfort: { overall: OverallTier; cells: Cell[] };
  };
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

function fmtRate(v: number | null, unit: string): string {
  if (v == null) return "—";
  return `${v.toFixed(2)} ${unit}`;
}

function fmtDelta(v: number | null): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

// Цвет ячейки по дельте: дивергентная шкала
// Δ < 0 (Я дешевле WB) — зелёный, Δ > 0 (Я дороже) — красный.
function cellColor(delta: number | null, lowData: boolean): string {
  if (lowData || delta == null) return "bg-zinc-100 text-zinc-400";
  const a = Math.abs(delta);
  if (delta < 0) {
    if (a >= 30) return "bg-emerald-600 text-white";
    if (a >= 15) return "bg-emerald-400 text-white";
    if (a >= 5) return "bg-emerald-200 text-emerald-900";
    return "bg-emerald-50 text-emerald-700";
  }
  if (delta > 0) {
    if (a >= 30) return "bg-red-600 text-white";
    if (a >= 15) return "bg-red-400 text-white";
    if (a >= 5) return "bg-red-200 text-red-900";
    return "bg-red-50 text-red-700";
  }
  return "bg-zinc-100 text-zinc-700";
}

function deltaBadgeColor(v: number | null): string {
  if (v == null) return "text-zinc-500 bg-zinc-100";
  if (v < -5) return "text-emerald-700 bg-emerald-50 border-emerald-300";
  if (v > 5) return "text-red-700 bg-red-50 border-red-300";
  return "text-zinc-700 bg-zinc-100 border-zinc-300";
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export default function TariffComparisonDialog({ open, onOpenChange }: Props) {
  const [from, setFrom] = useState<string>(DEFAULT_FROM);
  const [to, setTo] = useState<string>(DEFAULT_TO);
  const [tier, setTier] = useState<Tier>("econom");
  const [rate, setRate] = useState<Rate>("byn_per_km");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ComparisonResp | null>(null);

  const span = useMemo(() => {
    const a = Date.parse(from + "T00:00:00Z");
    const b = Date.parse(to + "T00:00:00Z");
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
    return Math.round((b - a) / 86400000) + 1;
  }, [from, to]);
  const spanInvalid = !Number.isFinite(span) || span < 1 || span > MAX_DAYS;

  async function handleLoad() {
    setError(null);
    setData(null);
    if (!from || !to || from > to) {
      setError("Укажите корректный диапазон дат");
      return;
    }
    if (spanInvalid) {
      setError(`Период ${span} дн. — лимит ${MAX_DAYS}.`);
      return;
    }
    setLoading(true);
    try {
      const token = await ensureNewstatToken();
      if (!token) throw new Error("Нет доступа: войдите как админ/антифрод.");
      const url = `/api/newstat/parsing/tariff-comparison?from=${encodeURIComponent(
        from,
      )}&to=${encodeURIComponent(to)}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
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
      const j: ComparisonResp = await resp.json();
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const unit = rate === "byn_per_km" ? "BYN/км" : "BYN/мин";
  const tierData = data?.tariffs[tier];
  const overall = tierData?.overall[rate];
  const cells = tierData?.cells ?? [];

  // Построим матрицу [hour 0..23][bucket idx] → CellRate | null
  const matrix = useMemo(() => {
    const m: (CellRate | null)[][] = Array.from({ length: 24 }, () =>
      Array(DIST_BUCKETS.length).fill(null),
    );
    for (const c of cells) {
      const bi = DIST_BUCKETS.indexOf(c.bucket as (typeof DIST_BUCKETS)[number]);
      if (bi < 0) continue;
      m[c.hour][bi] = c[rate];
    }
    return m;
  }, [cells, rate]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-5xl max-h-[90vh] overflow-y-auto"
        data-testid="tariff-comparison-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Сравнение тарифов: Yandex vs WB
          </DialogTitle>
          <DialogDescription>
            Честное сравнение: ставка <b>BYN/км</b> и <b>BYN/мин</b> по
            тарифам, бьём по часу суток × дистанционная корзина.
            WB: только <code>status=completed</code>, маппинг 644=Эконом,
            645=Комфорт. Я: фильтр{" "}
            <code>anomaly.suspicious=false</code>. Медиана + P25/P75. Бакеты с
            count&lt;5 — серые («мало данных»).
          </DialogDescription>
        </DialogHeader>

        {/* Контролы периода и режима */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="tc-from" className="text-xs">
              С
            </Label>
            <Input
              id="tc-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="input-tc-from"
              max={to}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tc-to" className="text-xs">
              По
            </Label>
            <Input
              id="tc-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="input-tc-to"
              min={from}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Тариф</Label>
            <div className="flex rounded border overflow-hidden text-xs">
              <button
                className={`flex-1 px-2 py-1.5 ${tier === "econom" ? "bg-zinc-900 text-white" : "bg-white hover:bg-zinc-50"}`}
                onClick={() => setTier("econom")}
                data-testid="btn-tc-econom"
              >
                Эконом
              </button>
              <button
                className={`flex-1 px-2 py-1.5 ${tier === "comfort" ? "bg-zinc-900 text-white" : "bg-white hover:bg-zinc-50"}`}
                onClick={() => setTier("comfort")}
                data-testid="btn-tc-comfort"
              >
                Комфорт
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Метрика</Label>
            <div className="flex rounded border overflow-hidden text-xs">
              <button
                className={`flex-1 px-2 py-1.5 ${rate === "byn_per_km" ? "bg-indigo-600 text-white" : "bg-white hover:bg-zinc-50"}`}
                onClick={() => setRate("byn_per_km")}
                data-testid="btn-tc-rate-km"
              >
                BYN/км
              </button>
              <button
                className={`flex-1 px-2 py-1.5 ${rate === "byn_per_min" ? "bg-indigo-600 text-white" : "bg-white hover:bg-zinc-50"}`}
                onClick={() => setRate("byn_per_min")}
                data-testid="btn-tc-rate-min"
              >
                BYN/мин
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pb-2">
          <div className="text-[11px] text-muted-foreground">
            Период: <b>{Number.isFinite(span) ? span : "?"}</b> дн.
            {spanInvalid && Number.isFinite(span) && span > MAX_DAYS
              ? ` — лимит ${MAX_DAYS}.`
              : ""}
          </div>
          <Button
            size="sm"
            onClick={handleLoad}
            disabled={loading || spanInvalid}
            data-testid="btn-tc-load"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-1" />
            )}
            {data ? "Обновить" : "Загрузить"}
          </Button>
        </div>

        {error && (
          <div
            className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1"
            data-testid="tc-error"
          >
            Ошибка: {error}
          </div>
        )}

        {data && (
          <>
            {/* KPI overall */}
            <div
              className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3"
              data-testid="tc-kpi"
            >
              <div className="rounded border bg-emerald-50 border-emerald-200 p-3">
                <div className="text-[11px] text-emerald-700 uppercase tracking-wide">
                  WB ({tier === "econom" ? "Эконом" : "Комфорт"})
                </div>
                <div className="text-2xl font-bold text-emerald-900 mt-1">
                  {fmtRate(overall?.wb.median ?? null, unit)}
                </div>
                <div className="text-[11px] text-emerald-700 mt-1">
                  P25 {overall?.wb.p25?.toFixed(2) ?? "—"} / P75{" "}
                  {overall?.wb.p75?.toFixed(2) ?? "—"} • n={overall?.wb.count ?? 0}
                </div>
              </div>
              <div className="rounded border bg-amber-50 border-amber-200 p-3">
                <div className="text-[11px] text-amber-700 uppercase tracking-wide">
                  Yandex ({tier === "econom" ? "Эконом" : "Комфорт"})
                </div>
                <div className="text-2xl font-bold text-amber-900 mt-1">
                  {fmtRate(overall?.yandex.median ?? null, unit)}
                </div>
                <div className="text-[11px] text-amber-700 mt-1">
                  P25 {overall?.yandex.p25?.toFixed(2) ?? "—"} / P75{" "}
                  {overall?.yandex.p75?.toFixed(2) ?? "—"} • n=
                  {overall?.yandex.count ?? 0}
                </div>
              </div>
              <div
                className={`rounded border p-3 ${deltaBadgeColor(overall?.delta_pct ?? null)}`}
              >
                <div className="text-[11px] uppercase tracking-wide opacity-80">
                  Δ Yandex vs WB
                </div>
                <div className="text-2xl font-bold mt-1">
                  {fmtDelta(overall?.delta_pct ?? null)}
                </div>
                <div className="text-[11px] mt-1 opacity-80">
                  «как есть» —{" "}
                  {overall?.delta_pct != null && overall.delta_pct > 0
                    ? "Я дороже WB"
                    : overall?.delta_pct != null && overall.delta_pct < 0
                      ? "Я дешевле WB"
                      : "Близко"}
                </div>
                {overall?.mix_adjusted && (
                  <div
                    className="text-[11px] mt-2 pt-2 border-t border-current/20"
                    title="Mix-adjusted: взвешенная средняя ячеечных Δ% с весом=число WB-заказов в той же ячейке. Устраняет искажение из-за того, что у WB и Я разная структура поездок (час суток × дистанция)."
                    data-testid="tc-mix-adjusted"
                  >
                    скорректировано по миксу WB:{" "}
                    <b>{fmtDelta(overall.mix_adjusted.delta_pct)}</b>{" "}
                    <span className="opacity-60">
                      ({overall.mix_adjusted.overlap_cells} общих ячеек,{" "}
                      {overall.mix_adjusted.wb_orders_in_overlap} WB-зак.)
                    </span>
                  </div>
                )}
              </div>
            </div>
            {rate === "byn_per_min" && overall?.note && (
              <div
                className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-3"
                data-testid="tc-min-note"
              >
                ⚠ Источники длительности несимметричны: у WB —{" "}
                <code>trip_minutes</code> (факт после поездки), у Я —{" "}
                <code>tripMin</code> (оценка из скрина <i>до</i> поездки). BYN/мин —
                справочный показатель; основной — BYN/км.
              </div>
            )}

            {/* Heatmap-таблица: час × дист.корзина, цвет = Δ% */}
            <div className="rounded border overflow-hidden">
              <div className="bg-zinc-50 px-3 py-2 text-xs font-medium border-b flex items-center justify-between">
                <span>
                  Тепловая карта Δ% (Yandex − WB) по часу × дистанция —{" "}
                  {tier === "econom" ? "Эконом" : "Комфорт"}, {unit}
                </span>
                <span className="text-[11px] text-zinc-500">
                  hover для деталей
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="tc-heatmap">
                  <thead>
                    <tr className="bg-zinc-50">
                      <th className="px-2 py-1 text-left font-medium text-zinc-600 border-r">
                        час
                      </th>
                      {DIST_BUCKETS.map((b) => (
                        <th
                          key={b}
                          className="px-2 py-1 text-center font-medium text-zinc-600 border-r last:border-r-0"
                        >
                          {b} км
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.map((row, h) => (
                      <tr key={h} className="border-t">
                        <td className="px-2 py-1 text-zinc-600 border-r tabular-nums">
                          {String(h).padStart(2, "0")}:00
                        </td>
                        {row.map((cell, i) => {
                          const bucket = DIST_BUCKETS[i];
                          if (!cell) {
                            return (
                              <td
                                key={i}
                                className="px-2 py-1 text-center bg-zinc-50 text-zinc-300 border-r last:border-r-0"
                              >
                                —
                              </td>
                            );
                          }
                          const tt = `${tier === "econom" ? "Эконом" : "Комфорт"}, ${h}:00, ${bucket} км
WB: med ${cell.wb.median?.toFixed(2) ?? "—"} ${unit} (P25 ${cell.wb.p25?.toFixed(2) ?? "—"}, P75 ${cell.wb.p75?.toFixed(2) ?? "—"}, n=${cell.wb.count})
Я:  med ${cell.yandex.median?.toFixed(2) ?? "—"} ${unit} (P25 ${cell.yandex.p25?.toFixed(2) ?? "—"}, P75 ${cell.yandex.p75?.toFixed(2) ?? "—"}, n=${cell.yandex.count})
Δ:  ${fmtDelta(cell.delta_pct)}${cell.low_data ? "  (мало данных)" : ""}`;
                          return (
                            <td
                              key={i}
                              className={`px-2 py-1 text-center border-r last:border-r-0 cursor-help font-medium ${cellColor(cell.delta_pct, cell.low_data)}`}
                              title={tt}
                              data-testid={`tc-cell-${h}-${bucket}`}
                            >
                              {cell.low_data
                                ? `(${cell.wb.count}/${cell.yandex.count})`
                                : fmtDelta(cell.delta_pct)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600 border-t flex flex-wrap items-center gap-3">
                <span className="font-medium">Шкала:</span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-3 h-3 bg-emerald-600 rounded-sm" />
                  ≤−30% (Я сильно дешевле)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-3 h-3 bg-emerald-200 rounded-sm" />
                  −5..−30%
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-3 h-3 bg-zinc-100 border rounded-sm" />
                  ±5%
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-3 h-3 bg-red-200 rounded-sm" />
                  +5..+30%
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-3 h-3 bg-red-600 rounded-sm" />
                  ≥+30% (Я сильно дороже)
                </span>
                <span className="inline-flex items-center gap-1 opacity-70">
                  <span className="inline-block w-3 h-3 bg-zinc-50 border rounded-sm" />
                  «мало данных» (n&lt;5) — показываем (WB/Я) счётчики
                </span>
              </div>
            </div>

            {/* Метаданные */}
            <div className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
              Период: {data.from} … {data.to} ({data.span_days} дн.) •
              WB-заказов: эконом <b>{data.summary.wb.econom_count}</b>,
              комфорт <b>{data.summary.wb.comfort_count}</b> • Я-скринов:
              просканировано <b>{data.summary.yandex.scanned}</b>, использовано{" "}
              <b>{data.summary.yandex.used}</b> (эконом{" "}
              {data.summary.yandex.econom_count} / комфорт{" "}
              {data.summary.yandex.comfort_count}) • расчёт{" "}
              {data.duration_ms} мс
            </div>
          </>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="btn-tc-close"
          >
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
