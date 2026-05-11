import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { WbDashboardSnapshot } from "@/lib/wb-api";

type MoneyLine = {
  label: string;
  // null → рендерим «—» (заглушка/нет данных). 0 → «0 BYN», тоже валидно.
  value: number | null;
};

type Tile = {
  key: "fraud" | "linked" | "cross" | "shortPickup";
  label: string;
  desc: string;
  value: number;
  total: number;
  href: string;
  testId: string;
  // tiers: <= soft → жёлтый, ≤ med → оранжевый, > med → красный.
  tiers: { soft: number; med: number };
  // Денежные подписи под счётчиком. Для фрода — две строки (GMV + доход
  // водителя), для остальных — одна (кэшбэк клиента).
  money: MoneyLine[];
};

function pickColor(value: number, total: number, tiers: { soft: number; med: number }): {
  border: string;
  bg: string;
  text: string;
  label: string;
} {
  if (value === 0) {
    return {
      border: "border-emerald-300",
      bg: "bg-emerald-50/60 dark:bg-emerald-900/10",
      text: "text-emerald-700 dark:text-emerald-300",
      label: "ок",
    };
  }
  const share = total > 0 ? value / total : 0;
  if (value > tiers.med || share > 0.05) {
    return {
      border: "border-red-400",
      bg: "bg-red-50 dark:bg-red-950/30",
      text: "text-red-700 dark:text-red-300",
      label: "критично",
    };
  }
  if (value > tiers.soft || share > 0.02) {
    return {
      border: "border-orange-400",
      bg: "bg-orange-50 dark:bg-orange-950/30",
      text: "text-orange-700 dark:text-orange-300",
      label: "внимание",
    };
  }
  return {
    border: "border-amber-300",
    bg: "bg-amber-50/70 dark:bg-amber-900/20",
    text: "text-amber-700 dark:text-amber-300",
    label: "немного",
  };
}

function fmtBYN(n: number): string {
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type Props = {
  dashboard: WbDashboardSnapshot;
  // Если задан период в URL — пробросим в drill-in.
  rangeQs: string;
};

export function WbAnomalySection({ dashboard, rangeQs }: Props) {
  const total = dashboard.orders || 1;
  const tiles: Tile[] = [
    {
      key: "fraud",
      label: "Фрод-подозрения",
      desc: "Самозаказы, фейк-GPS, аномалии скорости и пересечения",
      value: dashboard.fraudSuspectTrips,
      total,
      href: `/wb?drill=fraud${rangeQs}`,
      testId: "tile-fraud",
      tiers: { soft: 5, med: 30 },
      money: [
        { label: "GMV", value: dashboard.fraudGmvBYN },
        { label: "доход вод.", value: dashboard.fraudDriverPayoutBYN },
      ],
    },
    {
      key: "linked",
      label: "Связанные поездки",
      desc: "Пары клиент–водитель с ≥2 совместными заказами",
      value: dashboard.linkedTrips,
      total,
      href: `/wb?drill=linked${rangeQs}`,
      testId: "tile-linked",
      tiers: { soft: 30, med: 100 },
      money: [{ label: "кэшбэк ≈", value: dashboard.linkedCashbackBYN }],
    },
    {
      key: "cross",
      label: "Перекрёстные",
      desc: "Водитель заказал у другого + пара ≥3 раз/день",
      value: dashboard.crossTrips,
      total,
      href: `/wb?drill=cross${rangeQs}`,
      testId: "tile-cross",
      tiers: { soft: 5, med: 30 },
      money: [{ label: "кэшбэк ≈", value: dashboard.crossCashbackBYN }],
    },
    {
      key: "shortPickup",
      label: "Короткая подача",
      desc: "Водитель доехал до клиента быстрее 2 минут",
      value: dashboard.shortPickupTrips,
      total,
      href: `/wb?drill=shortPickup${rangeQs}`,
      testId: "tile-shortpickup",
      tiers: { soft: 10, med: 40 },
      money: [{ label: "кэшбэк ≈", value: dashboard.shortPickupCashbackBYN }],
    },
  ];

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Аномалии в выбранном периоде</h2>
        <span className="text-xs text-muted-foreground">
          клик — список заказов
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((t) => {
          const c = pickColor(t.value, t.total, t.tiers);
          const share = total > 0 ? (t.value / total) * 100 : 0;
          const moneyTextCls =
            t.value === 0
              ? "text-muted-foreground"
              : t.key === "fraud"
                ? "text-red-700 dark:text-red-300"
                : "text-red-700 dark:text-red-300";
          return (
            <Link key={t.key} href={t.href}>
              <Card
                className={cn(
                  "p-4 transition hover:shadow-md cursor-pointer border-2",
                  c.border,
                  c.bg,
                )}
                data-testid={t.testId}
              >
                <div className="flex items-baseline justify-between">
                  <div className="text-sm font-medium">{t.label}</div>
                  <div
                    className={cn(
                      "text-[10px] uppercase tracking-wide font-semibold",
                      c.text,
                    )}
                  >
                    {c.label}
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span
                    className={cn(
                      "text-3xl font-bold tabular-nums",
                      c.text,
                    )}
                  >
                    {t.value.toLocaleString("ru-RU")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {share.toFixed(1)}% заказов
                  </span>
                </div>
                <div
                  className="mt-1.5 space-y-0.5"
                  data-testid={`money-${t.key}`}
                >
                  {t.money.map((m, idx) => (
                    <div
                      key={idx}
                      className="flex items-baseline gap-1.5"
                      data-testid={`money-${t.key}-${idx}`}
                    >
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {m.label}
                      </span>
                      <span
                        className={cn(
                          "text-base font-semibold tabular-nums",
                          m.value == null || t.value === 0
                            ? "text-muted-foreground"
                            : moneyTextCls,
                        )}
                      >
                        {m.value == null
                          ? "—"
                          : `${fmtBYN(m.value)} BYN`}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {t.desc}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
