import { useState } from "react";
import { Info } from "lucide-react";
import { useInstructionsBadge } from "@/lib/instructions";
import InstructionsDialog from "@/components/InstructionsDialog";

interface Props {
  /** Дополнительные классы (для позиционирования родителем). */
  className?: string;
  /**
   * `fab` — круглая плавающая кнопка с тенью (по умолчанию, видна всегда).
   * `icon` — компактная квадратная иконка для шапки.
   */
  variant?: "fab" | "icon";
}

/**
 * Кнопка «i» с пошаговой инструкцией. Если в коде поднята
 * INSTRUCTIONS_VERSION и пользователь ещё не открывал новую версию —
 * на иконке пульсирует красный кружок с «!».
 */
export function HelpButton({ className = "", variant = "fab" }: Props) {
  const [open, setOpen] = useState(false);
  const { hasUpdate, markSeen } = useInstructionsBadge();

  function handleOpen() {
    setOpen(true);
    // Помечаем как «увиденное» сразу при открытии — чтобы «!» погас,
    // даже если пользователь закроет до последнего шага.
    if (hasUpdate) markSeen();
  }

  const baseFab =
    "rounded-full shadow-2xl flex items-center justify-center h-12 w-12 transition-all active:scale-95 bg-white border border-slate-200 hover:bg-slate-50";
  const baseIcon =
    "rounded-md border bg-background flex items-center justify-center h-9 w-9 hover:bg-muted transition-colors";

  const baseCls = variant === "fab" ? baseFab : baseIcon;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Инструкция: как пользоваться"
        title="Инструкция: как пользоваться"
        data-testid="btn-help"
        className={`relative shrink-0 ${baseCls} ${className}`}
      >
        <Info
          className={
            variant === "fab"
              ? "h-6 w-6 text-blue-700"
              : "h-5 w-5 text-foreground"
          }
        />
        {hasUpdate && (
          <span
            className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center"
            aria-hidden="true"
            data-testid="badge-help-new"
          >
            <span className="absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75 animate-ping" />
            <span className="relative inline-flex h-5 w-5 rounded-full bg-rose-600 text-white text-[11px] font-bold leading-none items-center justify-center shadow ring-2 ring-white">
              !
            </span>
          </span>
        )}
      </button>

      <InstructionsDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export default HelpButton;
