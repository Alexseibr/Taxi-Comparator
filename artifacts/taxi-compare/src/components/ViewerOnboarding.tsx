import { useEffect, useState } from "react";
import { BookOpen, Camera, Target, X } from "lucide-react";

const LS_KEY = "viewer_onboarding_v1";

type Step = {
  icon: React.ReactNode;
  title: string;
  text: string;
  highlight: "left" | "center" | "right";
};

const STEPS: Step[] = [
  {
    icon: <BookOpen className="h-6 w-6" />,
    title: "Журнал",
    text: "Здесь — рекомендованные адреса и история твоих отправок. Открой, чтобы увидеть куда ехать дальше.",
    highlight: "left",
  },
  {
    icon: <Camera className="h-6 w-6" />,
    title: "Скрин",
    text: "Главная кнопка по центру. Сделал скрин с ценами Яндекса — отправь его сюда. Это помогает всем.",
    highlight: "center",
  },
  {
    icon: <Target className="h-6 w-6" />,
    title: "Дыры",
    text: "Покажет районы где сейчас не хватает заказов. Делай скрин из красных и оранжевых сот — это особенно ценно.",
    highlight: "right",
  },
];

export function ViewerOnboarding() {
  const [step, setStep] = useState<number>(-1);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(LS_KEY) !== "done") {
        setStep(0);
      }
    } catch {
      /* localStorage может быть недоступен — тогда просто показываем тур */
      setStep(0);
    }
  }, []);

  function finish() {
    try {
      window.localStorage.setItem(LS_KEY, "done");
    } catch {
      /* noop */
    }
    setStep(-1);
  }

  if (step < 0) return null;
  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // Позиционирование «луча-указателя» по нужной кнопке дока.
  // Док находится bottom ~ 8px + safe-area, ширина ~ 240px,
  // центр — кнопка-камера (приподнята). Указатель — клин, идущий
  // от карточки вниз к нужной кнопке.
  const arrowLeft =
    s.highlight === "left"
      ? "calc(50% - 76px)"
      : s.highlight === "right"
        ? "calc(50% + 76px)"
        : "50%";

  return (
    <div
      className="fixed inset-0 z-[2500] flex flex-col justify-end pointer-events-auto"
      data-testid="viewer-onboarding"
    >
      {/* Затемнение фона + дырка вокруг кнопки. Используем простой
          полупрозрачный слой, без точного выреза — для понятности
          поверх дока остаётся читаемая капсула. */}
      <div
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]"
        onClick={finish}
      />

      {/* Стрелка-указатель к нужной кнопке дока */}
      <div
        className="absolute z-[2510] h-16 w-1 bg-amber-400 rounded-full shadow-lg animate-pulse"
        style={{
          left: arrowLeft,
          bottom: "calc(5.5rem + env(safe-area-inset-bottom, 0px))",
          transform: "translateX(-50%)",
        }}
      />
      <div
        className="absolute z-[2510] h-3 w-3 bg-amber-400 rotate-45 shadow-lg"
        style={{
          left: arrowLeft,
          bottom: "calc(5.2rem + env(safe-area-inset-bottom, 0px))",
          transform: "translateX(-50%) rotate(45deg)",
        }}
      />

      {/* Карточка с инструкцией */}
      <div
        className="relative z-[2520] mx-3 mb-[calc(11rem+env(safe-area-inset-bottom,0px))] rounded-2xl bg-white shadow-2xl border border-slate-200 p-4"
        data-testid={`onboarding-step-${step}`}
      >
        <button
          type="button"
          onClick={finish}
          aria-label="Пропустить тур"
          className="absolute top-2 right-2 h-8 w-8 rounded-full hover:bg-slate-100 active:scale-95 flex items-center justify-center text-slate-500"
          data-testid="button-onboarding-skip"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3">
          <div className="h-11 w-11 shrink-0 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
            {s.icon}
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">
              Шаг {step + 1} из {STEPS.length}
            </div>
            <div className="text-base font-semibold text-slate-900 mb-1">
              {s.title}
            </div>
            <div className="text-sm text-slate-600 leading-snug">{s.text}</div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <div className="flex gap-1.5 flex-1">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step
                    ? "w-6 bg-amber-500"
                    : i < step
                      ? "w-1.5 bg-amber-300"
                      : "w-1.5 bg-slate-200"
                }`}
              />
            ))}
          </div>
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="h-9 px-3 rounded-lg text-sm text-slate-600 hover:bg-slate-100 active:scale-95"
              data-testid="button-onboarding-prev"
            >
              Назад
            </button>
          )}
          <button
            type="button"
            onClick={() => (isLast ? finish() : setStep(step + 1))}
            className="h-9 px-4 rounded-lg text-sm font-semibold bg-amber-500 hover:bg-amber-600 active:scale-95 text-white shadow"
            data-testid="button-onboarding-next"
          >
            {isLast ? "Понятно" : "Далее"}
          </button>
        </div>
      </div>
    </div>
  );
}
