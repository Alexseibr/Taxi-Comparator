import { useState } from "react";
import { Target, Camera, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";

type Props = {
  controlledOpen?: boolean;
  onControlledOpenChange?: (v: boolean) => void;
};

export function HolesInfoDialog({
  controlledOpen,
  onControlledOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onControlledOpenChange ?? setInternalOpen;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        {/* Лёгкий overlay — карту видно сквозь него */}
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[2000] bg-black/20 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-[2001] w-[92vw] max-w-[480px] max-h-[88vh] overflow-y-auto translate-x-[-50%] translate-y-[-50%] border bg-background shadow-2xl rounded-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <div className="p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <DialogPrimitive.Title className="flex items-center gap-2 text-lg font-semibold">
                  <Target className="h-5 w-5 text-primary" />
                  «Дыры» на карте цен
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-sm text-muted-foreground mt-1">
                  Цветные круги — точность прогноза цены RWB по зонам Минска
                  (для текущего часа на слайдере).
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  data-testid="btn-holes-info-x"
                >
                  <X className="h-4 w-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>

            <div className="space-y-3 text-sm leading-relaxed">
              <section>
                <h3 className="font-semibold text-sm mb-1.5">Что значат цвета</h3>
                <ul className="space-y-1 text-xs">
                  <li className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full bg-emerald-500/70 border border-emerald-700" />
                    <b>Зелёный</b> — 6+ скринов, прогноз ~95% точный
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full bg-yellow-500/70 border border-yellow-700" />
                    <b>Жёлтый</b> — 3–5 скринов, точность 80–90%
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full bg-orange-500/70 border border-orange-700" />
                    <b>Оранжевый</b> — 1–2 скрина, точность 70–80%
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full bg-red-500/70 border border-red-700 border-dashed" />
                    <b>Красный (дыра)</b> — 0 скринов, оценка по соседям
                  </li>
                </ul>
              </section>

              <section className="bg-muted/50 rounded-md p-2.5 text-xs">
                <b>Подсказка:</b> двигай слайдер времени внизу карты —
                цвета зон обновятся для выбранного часа. Также переключай
                день недели в шапке.
              </section>

              <section>
                <h3 className="font-semibold text-sm mb-1.5">💡 Что делать</h3>
                <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
                  <li>
                    В <b>зелёных/жёлтых</b> зонах цена RWB точна, можно
                    доверять.
                  </li>
                  <li>
                    В <b>красных дырах</b> разница с Yandex может быть до
                    3 BYN — лучше открыть Yandex и сверить.
                  </li>
                </ul>
              </section>

              <section className="bg-primary/5 border border-primary/20 rounded-md p-3">
                <h3 className="font-semibold text-sm mb-1.5 flex items-center gap-1.5">
                  <Camera className="h-4 w-4 text-primary" />
                  Как закрыть дыру (1 минута)
                </h3>
                <ol className="space-y-1 text-xs list-decimal pl-4">
                  <li>Открой Yandex Go, забей маршрут.</li>
                  <li>
                    Скриншот: цена Эконом, цена Комфорт, время подачи (мин).
                  </li>
                  <li>
                    Нажми кнопку{" "}
                    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground align-middle">
                      <Camera className="h-3 w-3" />
                    </span>{" "}
                    справа внизу карты → выбери файл.
                  </li>
                  <li>
                    В течение часа модель пересчитается — твой скрин
                    закроет ячейку дыры.
                  </li>
                </ol>
              </section>

              <p className="text-[11px] text-center text-muted-foreground pt-1">
                Особенно ценны: ночь (1–5), выходные, окраины, аэропорт.
                Спасибо! 🙏
              </p>

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={() => setOpen(false)}
                  data-testid="btn-holes-info-close"
                >
                  Понятно
                </Button>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
