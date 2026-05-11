import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { INSTRUCTION_STEPS } from "@/lib/instructions";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Пошаговая инструкция «Далее → Далее → Готово». Без пояснений «зачем».
 * Контент — массив `INSTRUCTION_STEPS` в lib/instructions.tsx.
 */
export function InstructionsDialog({ open, onClose }: Props) {
  const [idx, setIdx] = useState(0);
  const total = INSTRUCTION_STEPS.length;

  // Каждый раз при открытии — начинаем сначала.
  useEffect(() => {
    if (open) setIdx(0);
  }, [open]);

  const next = useCallback(() => {
    setIdx((i) => (i + 1 < total ? i + 1 : i));
  }, [total]);

  const prev = useCallback(() => {
    setIdx((i) => (i > 0 ? i - 1 : 0));
  }, []);

  const isLast = idx === total - 1;
  const step = INSTRUCTION_STEPS[idx];
  if (!step) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-md w-[95vw] sm:w-full p-0 gap-0 overflow-hidden"
        data-testid="dialog-instructions"
      >
        <DialogHeader className="px-4 pt-4 pb-3 border-b">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-base">
              Как пользоваться
            </DialogTitle>
            <span
              className="text-xs text-muted-foreground tabular-nums"
              data-testid="text-instr-progress"
            >
              {idx + 1} / {total}
            </span>
          </div>
          <DialogDescription className="sr-only">
            Пошаговая инструкция по использованию сервиса. Шаг {idx + 1} из{" "}
            {total}.
          </DialogDescription>
          {/* Прогресс-бар */}
          <div className="mt-2 h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${((idx + 1) / total) * 100}%` }}
            />
          </div>
        </DialogHeader>

        <div className="px-5 py-6 min-h-[280px] flex flex-col items-center text-center">
          {/* Визуальная подсказка-копия реальной кнопки */}
          <div className="mb-4 flex items-center justify-center min-h-[60px]">
            <div className="relative">
              {step.icon}
              {/* Пульсирующее кольцо привлечения внимания */}
              <span
                className="absolute -inset-2 rounded-full border-2 border-primary/40 animate-ping pointer-events-none"
                aria-hidden="true"
              />
            </div>
          </div>

          <h3 className="text-lg font-semibold mb-1">{step.title}</h3>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">
            {step.hint}
          </p>
          <div className="text-sm leading-relaxed text-foreground/90 max-w-[34ch]">
            {step.body}
          </div>
        </div>

        <div className="border-t px-3 py-3 flex items-center justify-between gap-2 bg-muted/30">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={prev}
            disabled={idx === 0}
            data-testid="btn-instr-prev"
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            Назад
          </Button>

          {/* Точки прогресса */}
          <div className="flex items-center gap-1">
            {INSTRUCTION_STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Шаг ${i + 1}: ${s.title}`}
                aria-current={i === idx ? "step" : undefined}
                onClick={() => setIdx(i)}
                className={`h-1.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 ${
                  i === idx
                    ? "w-5 bg-primary"
                    : i < idx
                    ? "w-1.5 bg-primary/60"
                    : "w-1.5 bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>

          {isLast ? (
            <Button
              type="button"
              size="sm"
              onClick={onClose}
              data-testid="btn-instr-done"
              className="gap-1"
            >
              <Check className="h-4 w-4" />
              Готово
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={next}
              data-testid="btn-instr-next"
              className="gap-1"
            >
              Далее
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default InstructionsDialog;
