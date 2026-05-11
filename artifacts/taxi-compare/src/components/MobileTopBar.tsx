import type { ReactNode } from "react";
import { Car } from "lucide-react";
import type { TaxiClass } from "@/lib/zones";

type ViewMode = "surge" | "speed" | "fleet";

interface Props {
  cls: TaxiClass;
  onClsChange: (c: TaxiClass) => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  /** Кнопка-гамбургер (рендерится снаружи чтобы открывать общий Sheet) */
  menu: ReactNode;
}

/**
 * Верхняя панель для мобильной версии: тарифы + 3 слоя + гамбургер.
 * Лежит абсолютом над картой (z-[900]) — карта остаётся на весь экран.
 */
export function MobileTopBar({
  cls,
  onClsChange,
  viewMode,
  onViewModeChange,
  menu,
}: Props) {
  return (
    <div
      className="absolute top-0 left-0 right-0 z-[900] bg-card/95 backdrop-blur border-b shadow-md"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
      data-testid="mobile-top-bar"
    >
      <div className="px-2 py-2 flex items-center gap-1.5">
        {/* Гамбургер слева — открывает левую панель навигации */}
        <div className="shrink-0">{menu}</div>

        <div className="flex items-center gap-1 shrink-0">
          <Car className="h-4 w-4 text-primary" />
        </div>

        {/* Тарифы */}
        <div className="flex border rounded-md overflow-hidden text-[11px] shrink-0">
          {(["econom", "comfort"] as TaxiClass[]).map((c) => (
            <button
              key={c}
              onClick={() => onClsChange(c)}
              data-testid={`btn-mobile-class-${c}`}
              className={`px-2 py-1.5 font-medium transition-colors ${
                cls === c
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              {c === "econom" ? "Эконом" : "Комфорт"}
            </button>
          ))}
        </div>

        {/* Слои карты */}
        <div className="flex border rounded-md overflow-hidden text-[11px] flex-1 min-w-0">
          {(
            [
              { id: "surge", label: "Сёрджи" },
              { id: "speed", label: "Скор." },
              { id: "fleet", label: "Парк" },
            ] as { id: ViewMode; label: string }[]
          ).map((v) => (
            <button
              key={v.id}
              onClick={() => onViewModeChange(v.id)}
              data-testid={`btn-mobile-view-${v.id}`}
              className={`flex-1 px-1 py-1.5 font-medium transition-colors ${
                viewMode === v.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
