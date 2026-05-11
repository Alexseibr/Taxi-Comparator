import { useEffect, useState } from "react";
import { Download, X, Share, Plus } from "lucide-react";

const LS_KEY = "pwa_install_dismissed_v1";
const DISMISS_DAYS = 14;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari использует navigator.standalone, остальные — display-mode media query.
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isIOS(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  // iPad на iOS 13+ маскируется под Mac, ловим ещё по touch-points.
  const iPadOS =
    /Mac/.test(ua) &&
    typeof window.navigator.maxTouchPoints === "number" &&
    window.navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOS;
}

function recentlyDismissed(): boolean {
  try {
    const ts = window.localStorage.getItem(LS_KEY);
    if (!ts) return false;
    const t = Number(ts);
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    window.localStorage.setItem(LS_KEY, String(Date.now()));
  } catch {
    /* noop */
  }
}

/**
 * Баннер «Добавить WB Taxi на главный экран». Появляется через 8 секунд
 * после загрузки, если PWA ещё не установлено и пользователь не отказался
 * в последние 2 недели. На Android/Chrome ловит beforeinstallprompt и
 * показывает кнопку «Установить». На iOS Safari (где промпта нет) рисует
 * мини-инструкцию «Поделиться → На экран Домой».
 */
export function PwaInstallBanner() {
  const [visible, setVisible] = useState(false);
  const [promptEvt, setPromptEvt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (recentlyDismissed()) return;

    let timer: number | null = null;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setPromptEvt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // На iOS события beforeinstallprompt не существует — показываем
    // подсказку «через Поделиться» по таймеру.
    if (isIOS()) {
      timer = window.setTimeout(() => setVisible(true), 8000);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  function close() {
    markDismissed();
    setVisible(false);
    setShowIosHint(false);
  }

  async function handleInstall() {
    if (promptEvt) {
      try {
        await promptEvt.prompt();
        const { outcome } = await promptEvt.userChoice;
        if (outcome === "accepted") {
          setVisible(false);
        } else {
          markDismissed();
          setVisible(false);
        }
      } catch {
        markDismissed();
        setVisible(false);
      }
    } else if (isIOS()) {
      setShowIosHint((v) => !v);
    }
  }

  if (!visible) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[2300] w-[calc(100vw-1.5rem)] max-w-sm"
      style={{
        top: "calc(0.75rem + env(safe-area-inset-top, 0px))",
      }}
      data-testid="pwa-install-banner"
    >
      <div className="rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-start gap-3 px-3 py-3">
          <img
            src="/icon-192.png"
            alt=""
            className="h-12 w-12 rounded-xl shadow-sm shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900">
              Установить WB Taxi
            </div>
            <div className="text-[12px] text-slate-600 leading-snug">
              Добавь на главный экран — будет работать как обычное приложение,
              без браузерной полоски.
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            className="h-8 w-8 -mt-1 -mr-1 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400"
            data-testid="button-pwa-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-3 pb-3">
          <button
            type="button"
            onClick={close}
            className="flex-1 h-9 rounded-lg text-sm text-slate-600 hover:bg-slate-100 active:scale-95"
            data-testid="button-pwa-later"
          >
            Не сейчас
          </button>
          <button
            type="button"
            onClick={handleInstall}
            className="flex-1 h-9 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 active:scale-95 text-white shadow flex items-center justify-center gap-1.5"
            data-testid="button-pwa-install"
          >
            <Download className="h-4 w-4" />
            {isIOS() && !promptEvt ? "Как установить" : "Установить"}
          </button>
        </div>

        {showIosHint && (
          <div className="border-t border-slate-200 bg-slate-50 px-3 py-3 text-[12px] text-slate-700">
            <div className="font-medium mb-1.5">Установка на iPhone:</div>
            <ol className="space-y-1.5">
              <li className="flex items-center gap-1.5">
                <span className="text-slate-500">1.</span>
                <span>Нажми кнопку</span>
                <Share className="h-4 w-4 text-blue-600" />
                <span>«Поделиться» внизу Safari</span>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="text-slate-500">2.</span>
                <span>Выбери</span>
                <Plus className="h-4 w-4" />
                <span>«На экран „Домой"»</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-slate-500">3.</span>
                <span>«Добавить» → иконка появится на главном экране</span>
              </li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
