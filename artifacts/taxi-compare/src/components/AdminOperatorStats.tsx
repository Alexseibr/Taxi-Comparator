// Админ-виджет «Продуктивность операторов»: показывает кто сколько
// скринов загрузил за сегодня / неделю / месяц. Нужен чтобы увидеть
// перекосы по нагрузке (один оператор делает 600/день, остальные 50)
// и кому платить премию за объём.
//
// Источник — endpoint /api/screens/operators-stats, читает meta-файлы
// в data/screens/{incoming,processed,failed}, агрегирует по полю
// `operator` (его пишет ScreenUploadFAB при загрузке). Агрегаты
// кэшируются на сервере 60 сек, поэтому дёргать можно часто без вреда.

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, AlertCircle, Users } from "lucide-react";
import {
  fetchOperatorStats,
  type OperatorStatsRow,
} from "@/lib/screens-server";

type Props = {
  open: boolean;
  onClose: () => void;
};

const AUTO_REFRESH_MS = 60 * 1000;

function fmtAge(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  return `${d} д назад`;
}

export function AdminOperatorStats({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<OperatorStatsRow[]>([]);
  const [totals, setTotals] = useState<{
    today: number;
    week: number;
    month: number;
  } | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetchOperatorStats();
      if (!r.ok) {
        setErr(r.error);
        setRows([]);
        setTotals(null);
        setGeneratedAt(null);
      } else {
        setRows(r.operators);
        setTotals({
          today: r.totalToday,
          week: r.totalWeek,
          month: r.totalMonth,
        });
        setGeneratedAt(r.generatedAt);
      }
    } catch (e) {
      setErr((e as Error).message || "network_error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    reload();
    const t = setInterval(reload, AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [open, reload]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600" />
            Продуктивность операторов
          </DialogTitle>
          <DialogDescription>
            Сколько скринов Yandex Go каждый оператор загрузил.
            Цифры обновляются автоматически раз в минуту.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {generatedAt
              ? `Срез: ${new Date(generatedAt).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`
              : "—"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={reload}
            disabled={loading}
            className="h-7 text-xs gap-1"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Обновить
          </Button>
        </div>

        {err && (
          <div className="flex items-center gap-2 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded p-2">
            <AlertCircle className="h-4 w-4" />
            {err}
          </div>
        )}

        {totals && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded border bg-slate-50 p-2">
              <div className="text-[11px] text-muted-foreground">Сегодня</div>
              <div className="text-lg font-semibold tabular-nums">
                {totals.today.toLocaleString("ru-RU")}
              </div>
            </div>
            <div className="rounded border bg-slate-50 p-2">
              <div className="text-[11px] text-muted-foreground">За неделю</div>
              <div className="text-lg font-semibold tabular-nums">
                {totals.week.toLocaleString("ru-RU")}
              </div>
            </div>
            <div className="rounded border bg-slate-50 p-2">
              <div className="text-[11px] text-muted-foreground">За месяц</div>
              <div className="text-lg font-semibold tabular-nums">
                {totals.month.toLocaleString("ru-RU")}
              </div>
            </div>
          </div>
        )}

        <div className="border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Оператор</th>
                <th className="text-right px-3 py-2">Сегодня</th>
                <th className="text-right px-3 py-2">7д</th>
                <th className="text-right px-3 py-2">30д</th>
                <th className="text-right px-3 py-2">Последний</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="text-center py-6 text-muted-foreground">
                    Пока нет данных за последние 30 дней.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const isAnon = r.name === "(без имени)";
                return (
                  <tr
                    key={r.name}
                    className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}
                  >
                    <td className={`px-3 py-1.5 ${isAnon ? "italic text-muted-foreground" : "font-medium"}`}>
                      {r.name}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.today > 0 ? r.today.toLocaleString("ru-RU") : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {r.week.toLocaleString("ru-RU")}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {r.month.toLocaleString("ru-RU")}
                    </td>
                    <td className="px-3 py-1.5 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {fmtAge(r.lastAtIso)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground">
          «(без имени)» — скрины загружены без указания оператора в FAB-форме.
          Попросите коллег вписывать имя — это нужно для подсчёта премии и отчётности.
        </p>
      </DialogContent>
    </Dialog>
  );
}
