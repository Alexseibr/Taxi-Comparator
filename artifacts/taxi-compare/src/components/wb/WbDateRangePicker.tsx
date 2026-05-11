import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Все пресеты считаются по календарю Минска (UTC+3, без DST с 2011 г.).
// Внутри храним fromTs/toTs в UTC ISO — бэк фильтрует по createdAt напрямую.
const MINSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export type WbRangePreset =
  | "all"
  | "today"
  | "yesterday"
  | "last7d"
  | "mtd"
  | "this_month"
  | "last_month"
  | "this_week"
  | "last_week"
  | "custom";

export type WbDateRangeValue = {
  preset: WbRangePreset;
  fromTs: string | null;
  toTs: string | null;
  // compare-окно той же длины, сдвинутое назад. Для "all" не задаётся.
  compareFromTs?: string | null;
  compareToTs?: string | null;
  customFrom?: string;
  customTo?: string;
};

// Полночь указанной даты по Минску, выраженная в UTC.
function startOfMinskDay(d: Date): Date {
  const local = d.getTime() + MINSK_OFFSET_MS;
  const dayStartLocal = Math.floor(local / DAY_MS) * DAY_MS;
  return new Date(dayStartLocal - MINSK_OFFSET_MS);
}
// Первый день месяца указанной даты по Минску, в UTC.
function startOfMinskMonth(d: Date): Date {
  const local = new Date(d.getTime() + MINSK_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  return new Date(Date.UTC(y, m, 1) - MINSK_OFFSET_MS);
}
// Понедельник недели указанной даты по Минску, в UTC.
function startOfMinskIsoWeek(d: Date): Date {
  const a = startOfMinskDay(d);
  // Получаем день недели по Минску.
  const localDow =
    new Date(a.getTime() + MINSK_OFFSET_MS).getUTCDay() || 7; // 1..7
  return new Date(a.getTime() - (localDow - 1) * DAY_MS);
}
function fmtDateInput(d: Date): string {
  // отображаем «локальную» (Минск) дату для html input[type=date]
  const local = new Date(d.getTime() + MINSK_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function withCompare(a: Date, b: Date): {
  compareFromTs: string;
  compareToTs: string;
} {
  const len = b.getTime() - a.getTime();
  return {
    compareFromTs: new Date(a.getTime() - len).toISOString(),
    compareToTs: a.toISOString(),
  };
}

export function rangeFromPreset(
  preset: WbRangePreset,
  custom?: { from?: string; to?: string },
): WbDateRangeValue {
  const now = new Date();
  if (preset === "all") {
    return { preset, fromTs: null, toTs: null };
  }
  if (preset === "today") {
    const a = startOfMinskDay(now);
    const b = new Date(a.getTime() + DAY_MS);
    return {
      preset,
      fromTs: a.toISOString(),
      toTs: b.toISOString(),
      ...withCompare(a, b),
    };
  }
  if (preset === "yesterday") {
    const b = startOfMinskDay(now);
    const a = new Date(b.getTime() - DAY_MS);
    return {
      preset,
      fromTs: a.toISOString(),
      toTs: b.toISOString(),
      ...withCompare(a, b),
    };
  }
  if (preset === "last7d") {
    const b = new Date(startOfMinskDay(now).getTime() + DAY_MS);
    const a = new Date(b.getTime() - 7 * DAY_MS);
    return {
      preset,
      fromTs: a.toISOString(),
      toTs: b.toISOString(),
      ...withCompare(a, b),
    };
  }
  if (preset === "mtd") {
    const a = startOfMinskMonth(now);
    const b = new Date(startOfMinskDay(now).getTime() + DAY_MS);
    return {
      preset,
      fromTs: a.toISOString(),
      toTs: b.toISOString(),
      ...withCompare(a, b),
    };
  }
  if (preset === "this_month") {
    const a = startOfMinskMonth(now);
    // Начало следующего месяца по Минску
    const localA = new Date(a.getTime() + MINSK_OFFSET_MS);
    const b = new Date(
      Date.UTC(localA.getUTCFullYear(), localA.getUTCMonth() + 1, 1) -
        MINSK_OFFSET_MS,
    );
    return {
      preset,
      fromTs: a.toISOString(),
      toTs: b.toISOString(),
      ...withCompare(a, b),
    };
  }
  if (preset === "last_month") {
    const cur = startOfMinskMonth(now);
    const localCur = new Date(cur.getTime() + MINSK_OFFSET_MS);
    const a = new Date(
      Date.UTC(localCur.getUTCFullYear(), localCur.getUTCMonth() - 1, 1) -
        MINSK_OFFSET_MS,
    );
    return {
      preset,
      fromTs: a.toISOString(),
      toTs: cur.toISOString(),
      ...withCompare(a, cur),
    };
  }
  if (preset === "this_week") {
    const a = startOfMinskIsoWeek(now);
    const b = new Date(a.getTime() + 7 * DAY_MS);
    return {
      preset,
      fromTs: a.toISOString(),
      toTs: b.toISOString(),
      ...withCompare(a, b),
    };
  }
  if (preset === "last_week") {
    const cur = startOfMinskIsoWeek(now);
    const a = new Date(cur.getTime() - 7 * DAY_MS);
    return {
      preset,
      fromTs: a.toISOString(),
      toTs: cur.toISOString(),
      ...withCompare(a, cur),
    };
  }
  // custom
  const cf = custom?.from || "";
  const ct = custom?.to || "";
  if (cf && ct) {
    // Локальная (Минск) полночь cf и (ct + 1 день).
    const a = new Date(`${cf}T00:00:00.000Z`);
    a.setTime(a.getTime() - MINSK_OFFSET_MS);
    const b = new Date(`${ct}T00:00:00.000Z`);
    b.setTime(b.getTime() - MINSK_OFFSET_MS + DAY_MS);
    if (Number.isFinite(a.getTime()) && Number.isFinite(b.getTime()) && b > a) {
      return {
        preset: "custom",
        fromTs: a.toISOString(),
        toTs: b.toISOString(),
        customFrom: cf,
        customTo: ct,
        ...withCompare(a, b),
      };
    }
  }
  return {
    preset: "custom",
    fromTs: null,
    toTs: null,
    customFrom: cf,
    customTo: ct,
  };
}

const PRESETS: Array<{ key: WbRangePreset; label: string }> = [
  { key: "today", label: "Сегодня" },
  { key: "yesterday", label: "Вчера" },
  { key: "last7d", label: "7 дней" },
  { key: "mtd", label: "С начала месяца" },
  { key: "this_month", label: "Этот месяц" },
  { key: "last_month", label: "Прошлый месяц" },
  { key: "all", label: "Всё время" },
  { key: "custom", label: "Произвольный" },
];

type Props = {
  value: WbDateRangeValue;
  onChange: (v: WbDateRangeValue) => void;
  className?: string;
};

export function WbDateRangePicker({ value, onChange, className }: Props) {
  const today = useMemo(() => fmtDateInput(new Date()), []);
  const [customFrom, setCustomFrom] = useState(value.customFrom || "");
  const [customTo, setCustomTo] = useState(value.customTo || today);

  const summary = useMemo(() => {
    if (!value.fromTs && !value.toTs) return "Все данные";
    const fmt = (iso: string | null) => {
      if (!iso) return "—";
      // Отображаем по Минску.
      const d = new Date(new Date(iso).getTime() + MINSK_OFFSET_MS);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      return `${day}.${m}.${y}`;
    };
    const a = fmt(value.fromTs);
    const bIso = value.toTs ? new Date(value.toTs).getTime() - 1 : null;
    const b = bIso ? fmt(new Date(bIso).toISOString()) : "—";
    return `${a} — ${b} (Минск)`;
  }, [value]);

  return (
    <div className={cn("space-y-2", className)} data-testid="wb-date-range">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => {
          const active = value.preset === p.key;
          return (
            <Button
              key={p.key}
              size="sm"
              variant={active ? "default" : "outline"}
              onClick={() => {
                if (p.key === "custom") {
                  onChange(
                    rangeFromPreset("custom", {
                      from: customFrom,
                      to: customTo,
                    }),
                  );
                } else {
                  onChange(rangeFromPreset(p.key));
                }
              }}
              data-testid={`btn-range-${p.key}`}
            >
              {p.label}
            </Button>
          );
        })}
      </div>

      {value.preset === "custom" && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col">
            <label className="text-xs text-muted-foreground">с</label>
            <Input
              type="date"
              value={customFrom}
              max={today}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 w-40"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-muted-foreground">
              по (включительно)
            </label>
            <Input
              type="date"
              value={customTo}
              max={today}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 w-40"
            />
          </div>
          <Button
            size="sm"
            onClick={() =>
              onChange(
                rangeFromPreset("custom", { from: customFrom, to: customTo }),
              )
            }
            disabled={!customFrom || !customTo || customFrom > customTo}
          >
            Применить
          </Button>
        </div>
      )}

      <div
        className="text-xs text-muted-foreground"
        data-testid="text-range-summary"
      >
        Период: <span className="font-medium text-foreground">{summary}</span>
      </div>
    </div>
  );
}
