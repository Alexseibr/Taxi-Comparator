import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { WbHeatmapCell } from "@/lib/wb-api";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

type Mode = "total" | "cancel" | "gmv";

function valueOf(c: WbHeatmapCell, m: Mode): number {
  if (m === "total") return c.total;
  if (m === "cancel") return c.cancelled;
  return c.gmvSum;
}

function colorFor(v: number, max: number, mode: Mode): string {
  if (max <= 0 || v <= 0) return "transparent";
  const t = Math.min(1, v / max);
  if (mode === "cancel") {
    // оранжевый
    const a = 0.1 + 0.85 * t;
    return `rgba(234, 88, 12, ${a.toFixed(3)})`;
  }
  if (mode === "gmv") {
    // зелёный
    const a = 0.1 + 0.85 * t;
    return `rgba(22, 163, 74, ${a.toFixed(3)})`;
  }
  // синий
  const a = 0.1 + 0.85 * t;
  return `rgba(37, 99, 235, ${a.toFixed(3)})`;
}

export function WbHeatmapMatrix({ cells }: { cells: WbHeatmapCell[][] }) {
  const [mode, setMode] = useState<Mode>("total");
  const [hover, setHover] = useState<{ w: number; h: number } | null>(null);

  const max = useMemo(() => {
    let m = 0;
    for (const row of cells) for (const c of row) m = Math.max(m, valueOf(c, mode));
    return m;
  }, [cells, mode]);

  const total = useMemo(() => {
    let t = 0;
    for (const row of cells) for (const c of row) t += valueOf(c, mode);
    return t;
  }, [cells, mode]);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-medium">Час × День недели</div>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant={mode === "total" ? "default" : "outline"}
            onClick={() => setMode("total")}
            data-testid="heatmap-mode-total"
          >
            Заказы
          </Button>
          <Button
            size="sm"
            variant={mode === "cancel" ? "default" : "outline"}
            onClick={() => setMode("cancel")}
            data-testid="heatmap-mode-cancel"
          >
            Отмены
          </Button>
          <Button
            size="sm"
            variant={mode === "gmv" ? "default" : "outline"}
            onClick={() => setMode("gmv")}
            data-testid="heatmap-mode-gmv"
          >
            Выручка
          </Button>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        Чем темнее ячейка — тем больше значение. Всего за период:{" "}
        <b>
          {total.toLocaleString("ru-RU", {
            maximumFractionDigits: mode === "gmv" ? 0 : 0,
          })}
          {mode === "gmv" ? " BYN" : ""}
        </b>
        . Наведите на ячейку — увидите детали.
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="w-8" />
              {Array.from({ length: 24 }).map((_, h) => (
                <th
                  key={h}
                  className="font-normal text-muted-foreground text-center"
                  style={{ minWidth: 22 }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map((wd, w) => (
              <tr key={w}>
                <td className="text-muted-foreground pr-1 text-right">{wd}</td>
                {Array.from({ length: 24 }).map((_, h) => {
                  const c = cells[w]?.[h] ?? { total: 0, completed: 0, cancelled: 0, cancelRate: 0, gmvSum: 0 };
                  const v = valueOf(c, mode);
                  return (
                    <td
                      key={h}
                      className="text-center cursor-pointer rounded-sm"
                      style={{
                        background: colorFor(v, max, mode),
                        minWidth: 22,
                        height: 22,
                        outline:
                          hover && hover.w === w && hover.h === h
                            ? "1px solid rgba(0,0,0,0.4)"
                            : "1px solid rgba(0,0,0,0.05)",
                      }}
                      onMouseEnter={() => setHover({ w, h })}
                      onMouseLeave={() => setHover(null)}
                      title={`${WEEKDAYS[w]} ${h}:00\nЗаказов: ${c.total}\nВыполнено: ${c.completed}\nОтмен: ${c.cancelled} (${(c.cancelRate * 100).toFixed(0)}%)\nGMV: ${c.gmvSum.toFixed(0)} BYN`}
                      data-testid={`cell-${w}-${h}`}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hover && (
        <div className="text-xs text-muted-foreground">
          {WEEKDAYS[hover.w]} {hover.h}:00 — заказов:{" "}
          <b>{cells[hover.w][hover.h].total}</b>, отмен:{" "}
          <b>{cells[hover.w][hover.h].cancelled}</b> (
          {(cells[hover.w][hover.h].cancelRate * 100).toFixed(0)}%), GMV:{" "}
          <b>{cells[hover.w][hover.h].gmvSum.toLocaleString("ru-RU")}</b> BYN
        </div>
      )}
    </Card>
  );
}
