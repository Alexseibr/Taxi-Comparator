import { Card } from "@/components/ui/card";

export type WbBarRow = {
  label: string;
  total: number;
  cancelled?: number;
  completed?: number;
};

type Props = {
  title: string;
  rows: WbBarRow[];
  hint?: string;
  highlightCancel?: boolean;
};

export function WbBarChart({ title, rows, hint, highlightCancel }: Props) {
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0);

  return (
    <Card className="p-4 space-y-2">
      <div className="font-medium">{title}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      <div className="space-y-1.5">
        {rows.map((r) => {
          const w = max > 0 ? (r.total / max) * 100 : 0;
          const cancelW =
            r.cancelled != null && r.total > 0
              ? (r.cancelled / r.total) * w
              : 0;
          return (
            <div key={r.label} className="flex items-center gap-2 text-xs">
              <div className="w-12 text-right text-muted-foreground shrink-0">
                {r.label}
              </div>
              <div className="flex-1 bg-muted/30 rounded-sm h-5 relative overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-blue-500/70"
                  style={{ width: `${w}%` }}
                />
                {highlightCancel && (
                  <div
                    className="absolute inset-y-0 left-0 bg-orange-500/80"
                    style={{ width: `${cancelW}%` }}
                  />
                )}
              </div>
              <div className="w-24 text-right tabular-nums shrink-0">
                <b>{r.total.toLocaleString("ru-RU")}</b>
                {r.cancelled != null && r.total > 0 && (
                  <span className="text-orange-700 ml-1">
                    ({((r.cancelled / r.total) * 100).toFixed(0)}%)
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
