import {
  BASEMAPS,
  setBasemapId,
  useBasemapId,
} from "@/lib/basemaps";

interface Props {
  /**
   * `row` — компактная строчка-сегмент (как Сёрджи/Скорости/Парк),
   *        для десктопной шапки.
   * `grid` — крупные кнопки 2×2 с цветным квадратиком-превью,
   *         для мобильного меню.
   */
  variant?: "row" | "grid";
  className?: string;
}

export function BasemapPicker({ variant = "row", className = "" }: Props) {
  const current = useBasemapId();

  if (variant === "grid") {
    return (
      <div className={`grid grid-cols-2 gap-1.5 ${className}`}>
        {BASEMAPS.map((b) => {
          const active = current === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => setBasemapId(b.id)}
              data-testid={`btn-basemap-${b.id}`}
              title={b.description}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-[11px] font-medium border transition-colors text-left ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-border"
              }`}
            >
              <span
                className="w-3.5 h-3.5 rounded-sm border border-border/50 shrink-0"
                style={{ background: b.preview }}
                aria-hidden="true"
              />
              <span className="truncate">{b.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  // row variant — для десктопной шапки.
  return (
    <div
      className={`flex border rounded-md overflow-hidden text-xs ${className}`}
      title="Подложка карты"
    >
      {BASEMAPS.map((b) => {
        const active = current === b.id;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => setBasemapId(b.id)}
            data-testid={`btn-basemap-${b.id}`}
            title={b.description}
            className={`px-2.5 py-1.5 font-medium transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted"
            }`}
          >
            {b.label}
          </button>
        );
      })}
    </div>
  );
}
