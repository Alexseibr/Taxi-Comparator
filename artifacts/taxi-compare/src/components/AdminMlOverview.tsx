// Админ-виджет «ML обзор»: даёт оператору быстрый ответ на два вопроса:
//   1) Какие пары сейчас сильнее всего шумят (Top-5 MAPE) — куда послать
//      калибровщика в первую очередь.
//   2) В каких часах × днях недели у нас провал по данным (heatmap 24×7) —
//      какие смены добавить в график.
//
// Источник — FastAPI ML на :3013, проксируется через nginx /api/ml/* (см. lib/ml-client.ts).
// Данные обновляются раз в час cron-ом на VPS, поэтому никакого live-стриминга не нужно —
// просто GET по кнопке «обновить». Если ML лежит — показываем пустые состояния
// без шума (модальный диалог может открываться даже когда ML недоступен).

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, AlertCircle, Flame, Calendar } from "lucide-react";
import {
  fetchRouteErrors,
  fetchCoverage,
  prettifyPairKey,
  type MlPairError,
  type MlCoverageCell,
} from "@/lib/ml-client";

type Props = {
  open: boolean;
  onClose: () => void;
  /**
   * Опц. колбэк: оператор кликнул по ячейке heatmap (dow=0..6 Mon..Sun, hour=0..23).
   * Родитель может, например, открыть «Карта дыр» с фильтром по этому часу-дню.
   * Если не передан — клик по ячейке ничего не делает.
   */
  onCellClick?: (dow: number, hour: number) => void;
};

const DOW_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
// Снимок ML на VPS обновляется кроном раз в час. Перетягиваем чуть чаще
// (5 мин) на случай ручного запуска aggregate-route-stats.py — оператор
// сразу увидит свежие цифры. fetchRouteErrors/fetchCoverage сами кэшируются
// сервером, поэтому это дёшево.
const AUTO_REFRESH_MS = 5 * 60 * 1000;

export function AdminMlOverview({ open, onClose, onCellClick }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pairs, setPairs] = useState<MlPairError[]>([]);
  const [coverage, setCoverage] = useState<MlCoverageCell[]>([]);
  const [meta, setMeta] = useState<{
    generatedAt: string;
    nCalibsTotal: number;
    nCalibsMatched: number;
    nPairs: number;
  } | null>(null);

  const reload = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [errors, cov] = await Promise.all([fetchRouteErrors(), fetchCoverage()]);
      if (!errors && !cov) {
        setErr("ML недоступен — проверьте rwbtaxi-newstat-ml на VPS");
        setPairs([]);
        setCoverage([]);
        setMeta(null);
      } else {
        setPairs(errors?.pairs ?? []);
        setCoverage(cov?.byHourDow ?? []);
        setMeta(
          errors
            ? {
                generatedAt: errors.generatedAt,
                nCalibsTotal: errors.nCalibsTotal,
                nCalibsMatched: errors.nCalibsMatched,
                nPairs: errors.nPairs,
              }
            : null,
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  // Загружаем при открытии + автообновление каждые 5 минут пока диалог открыт.
  // При закрытии интервал чистится — лишних сетевых запросов не делаем.
  useEffect(() => {
    if (!open) return;
    void reload();
    const id = setInterval(() => void reload(), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [open]);

  const top5 = useMemo(() => pairs.slice(0, 5), [pairs]);

  // Для heatmap нужно знать максимум n чтобы нормировать яркость ячейки.
  // Считаем maxN на пик; если коврик пустой — оставим 1 чтобы не делить на 0.
  const maxN = useMemo(
    () => Math.max(1, ...coverage.map((c) => c.n)),
    [coverage],
  );

  // Развернём 1D массив 168 ячеек в матрицу [dow][hour] для удобства рендера.
  // Сервер не гарантирует порядок, поэтому строим Map по (dow,hour).
  const grid = useMemo(() => {
    const g: (MlCoverageCell | null)[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => null),
    );
    for (const c of coverage) {
      if (c.dow >= 0 && c.dow < 7 && c.hour >= 0 && c.hour < 24) {
        g[c.dow][c.hour] = c;
      }
    }
    return g;
  }, [coverage]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            📊 ML обзор: Top-5 ошибок и покрытие 24×7
          </DialogTitle>
          <DialogDescription>
            Куда направить калибровщика и какие часы/смены догрузить
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-muted-foreground">
            {meta && (
              <>
                Снимок: {new Date(meta.generatedAt).toLocaleString("ru-RU")} ·
                калибровок: {meta.nCalibsMatched}/{meta.nCalibsTotal} ·
                распознано пар: {meta.nPairs}
              </>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void reload()}
            disabled={loading}
            data-testid="btn-ml-overview-reload"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            <span className="ml-1">обновить</span>
          </Button>
        </div>

        {err && (
          <div className="flex items-center gap-2 p-3 bg-rose-50 text-rose-700 rounded border border-rose-200 text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {/* ────────── Top-5 MAPE ────────── */}
        <section className="space-y-2">
          <h3 className="flex items-center gap-1 text-sm font-semibold">
            <Flame className="h-4 w-4 text-rose-600" />
            Top-5 пар по ошибке модели цены (MAPE)
          </h3>
          <p className="text-xs text-muted-foreground">
            Чем выше %, тем сильнее модель промахивается на этой паре —
            докалибровка даст максимальный прирост точности.
          </p>
          {top5.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              {loading ? "загружаем…" : "пар с достаточным числом калибровок (≥5) пока нет"}
            </div>
          ) : (
            <div className="border rounded overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-2 font-medium">Пара</th>
                    <th className="text-right p-2 font-medium w-20">MAPE</th>
                    <th className="text-right p-2 font-medium w-12">N</th>
                    <th className="text-right p-2 font-medium w-32">Свежесть</th>
                  </tr>
                </thead>
                <tbody>
                  {top5.map((p) => {
                    const { from, to } = prettifyPairKey(p.key);
                    const ageDays = p.lastSeenIso
                      ? Math.floor(
                          (Date.now() - new Date(p.lastSeenIso).getTime()) /
                            (1000 * 60 * 60 * 24),
                        )
                      : null;
                    const mapeColor =
                      p.mapeE >= 0.3
                        ? "text-rose-700 font-semibold"
                        : p.mapeE >= 0.15
                          ? "text-amber-700"
                          : "text-emerald-700";
                    return (
                      <tr key={p.key} className="border-t">
                        <td className="p-2">
                          <span className="font-medium">{from}</span>
                          <span className="opacity-50 mx-1">→</span>
                          <span className="font-medium">{to}</span>
                        </td>
                        <td className={`text-right p-2 tabular-nums ${mapeColor}`}>
                          {(p.mapeE * 100).toFixed(1)}%
                        </td>
                        <td className="text-right p-2 tabular-nums opacity-70">{p.n}</td>
                        <td className="text-right p-2 text-xs text-muted-foreground">
                          {ageDays === null
                            ? "—"
                            : ageDays === 0
                              ? "сегодня"
                              : `${ageDays} д. назад`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ────────── Heatmap покрытия 24×7 ────────── */}
        <section className="space-y-2 mt-4">
          <h3 className="flex items-center gap-1 text-sm font-semibold">
            <Calendar className="h-4 w-4 text-blue-600" />
            Покрытие калибровками: час × день недели
          </h3>
          <p className="text-xs text-muted-foreground">
            Тёмные ячейки — смены где у модели достаточно данных.
            Светлые — провалы покрытия, нужны новые скрины в эти часы.
          </p>
          {coverage.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              {loading ? "загружаем…" : "нет данных покрытия"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-[10px] border-separate" style={{ borderSpacing: "1px" }}>
                <thead>
                  <tr>
                    <th className="w-8" />
                    {Array.from({ length: 24 }, (_, h) => (
                      <th
                        key={h}
                        className="w-5 text-center font-normal text-muted-foreground"
                      >
                        {h % 3 === 0 ? h : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DOW_LABELS.map((label, dow) => (
                    <tr key={dow}>
                      <td className="w-8 text-right pr-1 text-muted-foreground font-medium">
                        {label}
                      </td>
                      {Array.from({ length: 24 }, (_, h) => {
                        const cell = grid[dow]?.[h];
                        const n = cell?.n ?? 0;
                        // Нормировка яркости: 0 → бледный, max → насыщенный синий.
                        // Используем sqrt чтобы небольшие n тоже были видны (а не «всё бледно»).
                        const intensity = Math.sqrt(n / maxN);
                        const bg =
                          n === 0
                            ? "rgb(243, 244, 246)" // bg-gray-100
                            : `rgba(37, 99, 235, ${0.15 + intensity * 0.75})`; // blue-600
                        const baseTitle =
                          n === 0
                            ? `${label} ${h}:00 — нет калибровок`
                            : `${label} ${h}:00 — ${n} калибровок (зел: ${cell?.nGreen ?? 0}, жёл: ${cell?.nYellow ?? 0}, кр: ${cell?.nRed ?? 0})`;
                        const title = onCellClick
                          ? `${baseTitle}\n(клик → открыть «Карта дыр» для этого часа)`
                          : baseTitle;
                        const interactive = !!onCellClick;
                        return (
                          <td
                            key={h}
                            className={`w-5 h-5 text-center ${interactive ? "cursor-pointer hover:ring-2 hover:ring-rose-400" : ""}`}
                            style={{ background: bg }}
                            title={title}
                            onClick={
                              interactive
                                ? () => onCellClick?.(dow, h)
                                : undefined
                            }
                            data-testid={`heatmap-cell-${dow}-${h}`}
                          >
                            {n > 0 ? (
                              <span
                                className={
                                  intensity > 0.5 ? "text-white" : "text-gray-700"
                                }
                              >
                                {n > 99 ? "·" : n}
                              </span>
                            ) : (
                              ""
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                <span>пусто</span>
                <div className="flex gap-px">
                  {[0.05, 0.2, 0.4, 0.6, 0.8, 1].map((i) => (
                    <div
                      key={i}
                      className="w-4 h-3"
                      style={{
                        background:
                          i < 0.1
                            ? "rgb(243, 244, 246)"
                            : `rgba(37, 99, 235, ${0.15 + i * 0.75})`,
                      }}
                    />
                  ))}
                </div>
                <span>много</span>
              </div>
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
