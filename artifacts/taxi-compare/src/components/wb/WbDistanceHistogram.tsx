import { Card } from "@/components/ui/card";
import type { WbHeatmap } from "@/lib/wb-api";

export function WbDistanceHistogram({ rows }: { rows: WbHeatmap["byDistance"] }) {
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0);
  const totalAll = rows.reduce((s, r) => s + r.total, 0);
  return (
    <Card className="p-4 space-y-3">
      <div>
        <div className="font-medium">По дистанциям</div>
        <div className="text-xs text-muted-foreground">
          Распределение всех заказов по интервалам километров. Оранжевая часть —
          доля отмен внутри бина.
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((r) => {
          const w = max > 0 ? (r.total / max) * 100 : 0;
          const cancelW = r.total > 0 ? (r.cancelled / r.total) * w : 0;
          const sharePct = totalAll > 0 ? (r.total / totalAll) * 100 : 0;
          return (
            <div key={r.label} className="text-sm">
              <div className="flex justify-between mb-0.5">
                <div>{r.label}</div>
                <div className="text-xs text-muted-foreground">
                  {sharePct.toFixed(1)}% всех · отмен{" "}
                  {(r.cancelRate * 100).toFixed(0)}% · GMV{" "}
                  {r.gmvSum.toLocaleString("ru-RU", { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="bg-muted/30 rounded-sm h-6 relative overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-blue-500/70"
                  style={{ width: `${w}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 bg-orange-500/80"
                  style={{ width: `${cancelW}%` }}
                />
                <div className="absolute inset-0 flex items-center px-2 text-xs font-medium">
                  {r.total.toLocaleString("ru-RU")}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
