import { useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { Slider } from "@/components/ui/slider";

interface Props {
  minute: number;
  onMinuteChange: (v: number) => void;
  autoFollow: boolean;
  onNowClick: () => void;
  timeLabel: string;
  timeSlotLabel: string;
  timeSlotEmoji: string;
  timeSlotHours: string;
  hexCount: number;
  zoom: number;
  h3Res: number;
  dayLabel: string;
}

/**
 * Нижняя панель для мобильной версии.
 * По умолчанию свернута: только временной слайдер + handle ↑.
 * Развёрнута: + кнопка «Сейчас», описание слота, день.
 */
export function MobileBottomBar(p: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-[800] bg-card/95 backdrop-blur border-t shadow-2xl"
      style={{
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
      data-testid="mobile-bottom-bar"
    >
      {/* Handle с временем + кнопка «Сейчас» (видны всегда) */}
      <div className="flex items-center px-2 py-1 gap-2">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex-1 flex items-center justify-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors min-w-0"
          aria-label={expanded ? "Свернуть детали" : "Развернуть детали"}
          data-testid="button-bottom-toggle"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronUp className="h-4 w-4 shrink-0" />
          )}
          <span className="text-[11px] font-medium tabular-nums truncate">
            {p.timeSlotEmoji} {p.dayLabel} · {p.timeLabel}
          </span>
        </button>
        <button
          type="button"
          onClick={p.onNowClick}
          className={`text-[10px] px-2 py-1 rounded border whitespace-nowrap transition-colors shrink-0 ${
            p.autoFollow
              ? "bg-emerald-500 text-white border-emerald-500"
              : "hover:bg-accent"
          }`}
          data-testid="button-mobile-now"
        >
          {p.autoFollow ? "● реальное" : "Сейчас"}
        </button>
      </div>

      {/* Раскрывающиеся детали */}
      {expanded && (
        <div className="px-3 pb-2 pt-2 border-t text-xs space-y-1">
          <div className="font-semibold leading-tight">
            {p.timeSlotEmoji} {p.timeSlotLabel} · {p.timeLabel}
          </div>
          <div className="text-[10px] text-muted-foreground leading-snug">
            Слот {p.timeSlotHours} · шаг 10 мин · {p.hexCount} ячеек · zoom{" "}
            {p.zoom} (h3 r{p.h3Res})
          </div>
          <div className="text-[10px] text-muted-foreground leading-snug">
            {p.autoFollow
              ? "Слайдер двигается сам — перетащите для прогноза на другое время."
              : "Перетащите слайдер или нажмите «Сейчас» для возврата."}
          </div>
        </div>
      )}

      {/* Слайдер времени — всегда виден */}
      <div className="px-3 pb-2 pt-1">
        <Slider
          value={[p.minute]}
          min={0}
          max={1430}
          step={10}
          onValueChange={(v) => p.onMinuteChange(v[0])}
          data-testid="slider-time-mobile"
        />
        <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5 px-0.5">
          {[0, 6, 12, 18, 23].map((h) => (
            <span key={h}>{String(h).padStart(2, "0")}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
