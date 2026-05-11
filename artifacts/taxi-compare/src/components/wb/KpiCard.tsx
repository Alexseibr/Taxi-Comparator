import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

type Variant = "default" | "warn" | "alert" | "ok";

type Props = {
  label: string;
  value: number | string;
  hint?: string;
  compareValue?: number | null;
  // Если true — рост значения это плохо (например, отмены). Знак дельты инвертируется.
  invertDelta?: boolean;
  href?: string;
  icon?: React.ReactNode;
  variant?: Variant;
  unit?: string;
  format?: "int" | "money" | "decimal" | "percent";
  testId?: string;
};

function fmt(value: number | string, format?: Props["format"]): string {
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "—";
  if (format === "money") {
    return new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (format === "decimal") {
    return new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(value);
  }
  if (format === "percent") {
    return `${(value * 100).toFixed(1)}%`;
  }
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

function deltaPercent(current: number, prev: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prev)) return null;
  if (prev === 0) {
    if (current === 0) return 0;
    return null; // деление на ноль — не показываем процент
  }
  return (current - prev) / Math.abs(prev);
}

function variantClasses(v: Variant | undefined): string {
  switch (v) {
    case "alert":
      return "border-red-300 bg-red-50/50 dark:bg-red-900/10";
    case "warn":
      return "border-amber-300 bg-amber-50/50 dark:bg-amber-900/10";
    case "ok":
      return "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-900/10";
    default:
      return "";
  }
}

export function KpiCard({
  label,
  value,
  hint,
  compareValue,
  invertDelta,
  href,
  icon,
  variant,
  unit,
  format,
  testId,
}: Props) {
  let deltaNode: React.ReactNode = null;
  if (
    typeof value === "number" &&
    typeof compareValue === "number" &&
    Number.isFinite(compareValue)
  ) {
    const d = deltaPercent(value, compareValue);
    if (d != null) {
      const isUp = d > 0;
      const isDown = d < 0;
      // good/bad: рост обычно хорошо, но invertDelta переворачивает.
      const good = invertDelta ? d < 0 : d > 0;
      const bad = invertDelta ? d > 0 : d < 0;
      const cls = good
        ? "text-emerald-600 dark:text-emerald-400"
        : bad
          ? "text-red-600 dark:text-red-400"
          : "text-muted-foreground";
      const arrow = isUp ? "↑" : isDown ? "↓" : "→";
      const pct = `${(Math.abs(d) * 100).toFixed(d === 0 ? 0 : 1)}%`;
      deltaNode = (
        <div className={cn("text-xs mt-1 flex items-center gap-1", cls)}>
          <span>{arrow}</span>
          <span>{pct}</span>
          <span className="text-muted-foreground">
            ({fmt(compareValue, format)})
          </span>
        </div>
      );
    } else {
      deltaNode = (
        <div className="text-xs mt-1 text-muted-foreground">
          было: {fmt(compareValue, format)}
        </div>
      );
    }
  }

  const inner = (
    <Card
      className={cn(
        "p-4 transition-colors min-h-[140px] flex flex-col",
        href && "hover:bg-accent/40 hover:shadow-md cursor-pointer",
        variantClasses(variant),
      )}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium line-clamp-2">
          {label}
        </div>
        {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tabular-nums">
          {fmt(value, format)}
        </span>
        {unit ? (
          <span className="text-xs text-muted-foreground">{unit}</span>
        ) : null}
      </div>
      {deltaNode}
      {hint ? (
        <div className="text-xs text-muted-foreground mt-auto pt-2">{hint}</div>
      ) : null}
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}
