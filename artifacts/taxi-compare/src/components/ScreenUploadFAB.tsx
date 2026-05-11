import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Loader2, X } from "lucide-react";
import {
  uploadScreens,
  isScreensUploadConfigured,
  getScreensQueueStatus,
  getUploadContext,
  type UploadProgress,
} from "@/lib/screens-server";
import { useToast } from "@/hooks/use-toast";

interface Props {
  /** Дополнительные классы (позиционирование) */
  className?: string;
  /** Размер: lg для FAB (мобильный), sm для inline */
  size?: "lg" | "md";
  /** Текст рядом с иконкой (если undefined — иконка одна) */
  label?: string;
}

const LS_LAST_OPERATOR = "rwb_last_operator";

function pluralForm(n: number): string {
  if (n === 1) return "скрин";
  if (n >= 2 && n <= 4) return "скрина";
  return "скринов";
}

function fmtEta(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} сек`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} мин`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

function readLastOperator(): string {
  try {
    return localStorage.getItem(LS_LAST_OPERATOR) || "";
  } catch {
    return "";
  }
}

function writeLastOperator(name: string) {
  try {
    if (name) localStorage.setItem(LS_LAST_OPERATOR, name);
  } catch {
    /* ignore */
  }
}

export function ScreenUploadFAB({
  className = "",
  size = "lg",
  label,
}: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Прогресс батчевой загрузки. Нужен, чтобы пользователь видел
  // «загружаем 17 из 30», а не пустой спиннер на минуту при заливке 100 фоток.
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  // Имя оператора, под которым уйдёт следующая серия. Если null —
  // ещё не разрешено (пользователь не нажимал кнопку или контекст не загружен).
  const [operator, setOperator] = useState<string | null>(null);
  // Состояние модалки «введите имя» (показываем только если по IP мы оператора
  // не помним и в форме ничего не введено).
  const [askOpen, setAskOpen] = useState(false);
  const [askValue, setAskValue] = useState("");
  const [recentNames, setRecentNames] = useState<string[]>([]);
  const datalistId = useId();
  const inputId = useId();
  const { toast } = useToast();
  const configured = isScreensUploadConfigured();

  // При монтировании — сразу подтянем lastOperator из localStorage в форму
  // как «черновик», чтобы при открытии модалки поле уже было заполнено.
  useEffect(() => {
    setAskValue(readLastOperator());
  }, []);

  function openFilePicker() {
    if (ref.current) {
      ref.current.value = "";
      ref.current.click();
    }
  }

  // Фоновая «дозагрузка» свежего контекста — НЕ блокирует открытие picker'а.
  // Обновляет recentNames / knownOperator на следующий клик. Никогда не
  // ставит busy=true.
  function refreshContextInBackground() {
    getUploadContext()
      .then((ctx) => {
        if (!ctx.ok) return;
        setRecentNames(ctx.recentNames);
        if (ctx.knownOperator) {
          setOperator(ctx.knownOperator);
          writeLastOperator(ctx.knownOperator);
        }
      })
      .catch(() => {
        /* фон — глушим, не мешаем UX */
      });
  }

  // ВНИМАНИЕ: handleClick должен быть СИНХРОННЫМ для пути «знаем оператора».
  // На iOS Safari input[type=file].click() работает только если вызван
  // СИНХРОННО из user-gesture (тача). Любой await/setTimeout перед click()
  // ломает picker — он молча игнорируется браузером, и пользователь видит
  // «спиннер крутится, ничего не происходит».
  function handleClick() {
    if (busy || !configured) return;

    const lastOp = readLastOperator();
    if (lastOp) {
      // Уже знаем оператора локально — сразу открываем picker (синхронно,
      // в том же tick, что user-gesture). НЕ ставим busy: спиннер не нужен,
      // нативный диалог выбора файла перекроет UI сам.
      setOperator(lastOp);
      openFilePicker();
      // Параллельно — фоновая синхронизация с сервером (для recentNames
      // и обновления knownOperator по IP). Не блокирует.
      refreshContextInBackground();
      return;
    }

    // Локально оператора не знаем — пробуем узнать его по IP через сервер.
    // Здесь кратковременный busy уместен (запрос с таймаутом 3с в screens-server).
    setBusy(true);
    getUploadContext()
      .then((ctx) => {
        if (ctx.ok) {
          setRecentNames(ctx.recentNames);
          if (ctx.knownOperator) {
            // Сервер опознал по IP — запоминаем и СРАЗУ открываем picker.
            // ВНИМАНИЕ: тут уже после await, на iOS Safari click() может
            // не сработать. Поэтому ВСЁ РАВНО показываем модалку с label,
            // чтобы у пользователя был надёжный второй тап-триггер.
            setOperator(ctx.knownOperator);
            writeLastOperator(ctx.knownOperator);
            setAskValue(ctx.knownOperator);
            setAskOpen(true);
            return;
          }
        }
        // Не знаем — обычная модалка с пустым полем.
        setAskValue("");
        setAskOpen(true);
      })
      .catch(() => {
        // На всякий случай — даже если fetch упал — показываем модалку,
        // чтобы пользователь мог продолжить.
        setAskValue("");
        setAskOpen(true);
      })
      .finally(() => setBusy(false));
  }

  // ИСТОРИЧЕСКАЯ СПРАВКА: была функция confirmAsk(), которая закрывала
  // модалку и через setTimeout(openFilePicker, 0) пыталась открыть picker.
  // На iOS Safari это РАБОТАЛО НЕНАДЁЖНО (setTimeout рвёт user-gesture →
  // input.click() молча игнорировался → «спиннер крутится, ничего не
  // запускается»). Сейчас «Продолжить» — это <label htmlFor={inputId}>,
  // браузер сам открывает picker синхронно по семантике label→input.
  // Enter-handler делает то же руками (см. onKeyDown инпута).

  async function handle(files: FileList | null) {
    if (!files || !files.length) return;
    if (!configured) {
      toast({
        title: "Загрузка скринов недоступна",
        description: "Серверный приёмник пока не настроен.",
        variant: "destructive",
      });
      return;
    }
    // Re-entry guard: если уже идёт загрузка (busy) — игнорируем повторный
    // вызов. Это защищает от двойного onChange (например, если у браузера
    // глючит файловый диалог и он стреляет change-событием дважды).
    if (busy) return;
    // КРИТИЧНО: setBusy(true) ДО любого await — иначе пользователь успеет
    // открыть picker ещё раз и запустить параллельную загрузку под другим
    // именем оператора.
    setBusy(true);
    try {
      // Сначала смотрим состояние очереди — если перегружена, мягко предупреждаем,
      // но загрузку всё равно выполняем (файлы не теряются, встанут в очередь).
      const pre = await getScreensQueueStatus();
      if (pre.ok && pre.level === "overloaded") {
        toast({
          title: "Очередь распознавания загружена",
          description: `Сейчас в обработке ${pre.queueLength} скринов (~${fmtEta(pre.etaSeconds)} ожидания). Ваши снимки встанут в очередь, но лучше прислать чуть позже.`,
        });
      }
      // onProgress обновляет state только если что-то реально изменилось,
      // чтобы не дёргать React на каждом промежуточном emit'е.
      setProgress({ phase: "preparing", done: 0, total: files.length, inFlight: 0, failedChunks: 0 });
      const r = await uploadScreens(Array.from(files), operator, (p) =>
        setProgress(p),
      );
      if (!r.ok) {
        toast({
          title: "Не получилось загрузить",
          description:
            r.error === "all_files_filtered_locally"
              ? "Файлы не подошли: нужны JPEG / PNG / WebP до 10 МБ."
              : `${r.error}${r.status ? ` (HTTP ${r.status})` : ""}`,
          variant: "destructive",
        });
        return;
      }
      const okCount = r.accepted.length;
      const skip = r.rejected.length;
      const lines: string[] = [];
      if (operator) {
        lines.push(`Оператор: ${operator}.`);
      }
      lines.push(`${okCount} ${pluralForm(okCount)} принято.`);
      if (skip > 0) {
        // Человекочитаемое описание причин отказа. Локальные коды
        // (`duplicate_24h:Nm`, `too_large`, `bad_mime:…`) приходят из
        // screens-server.ts, серверные (например `bad_mime:image/heic`,
        // `dup_filename`) — из screen-receiver.mjs.
        const reasonText = (rj: {
          originalName: string;
          reason: string;
        }) => {
          const dup = /^duplicate_24h:(\d+)m$/.exec(rj.reason);
          if (dup) {
            const min = Number(dup[1]);
            const ago =
              min < 60
                ? `${min} мин назад`
                : `${Math.round(min / 60)} ч назад`;
            return `${rj.originalName} (уже загружали ${ago})`;
          }
          if (rj.reason === "too_large") return `${rj.originalName} (больше 10 МБ)`;
          if (rj.reason.startsWith("bad_mime:")) {
            return `${rj.originalName} (формат не поддерживается)`;
          }
          return `${rj.originalName} (${rj.reason})`;
        };
        const reasons = r.rejected.map(reasonText).join(", ");
        lines.push(`Пропущено ${skip}: ${reasons}.`);
      }
      if (r.aborted) {
        lines.push("Лишние файлы отброшены (макс 5 за раз).");
      }
      // ETA на основе текущей очереди после нашего добавления.
      if (typeof r.queueLength === "number" && r.queueLength > 10) {
        const eta =
          typeof r.etaSeconds === "number" ? r.etaSeconds : r.queueLength * 6;
        lines.push(
          `В очереди распознавания ${r.queueLength} штук, ~${fmtEta(eta)} до полной обработки.`,
        );
      } else {
        lines.push(
          "Цены распознаются автоматически — появятся в общем пуле в течение 5 минут.",
        );
      }
      toast({
        title: "Скрины приняты ✓",
        description: lines.join(" "),
      });
      // Триггерим мгновенный refresh пула «Рекомендованные маршруты»:
      // RecommendedRoutesPopover слушает это событие и сразу дёргает
      // /recommended (без ожидания 10-секундного polling-тика). Так
      // оператор видит замену уехавшим парам через ~0.5 с после upload.
      try {
        window.dispatchEvent(
          new CustomEvent("rwb:screens-uploaded", {
            detail: { accepted: okCount },
          }),
        );
      } catch {
        // CustomEvent не поддержан — не критично, останется 10-сек fallback.
      }
    } catch (e) {
      toast({
        title: "Ошибка сети",
        description: (e as Error).message ?? "network_error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
      setProgress(null);
      if (ref.current) ref.current.value = "";
    }
  }

  const isLg = size === "lg";
  const sizeCls = isLg
    ? label
      ? "h-14 px-5 text-sm font-semibold gap-2"
      : "h-14 w-14"
    : label
      ? "h-10 px-3 text-xs font-medium gap-1.5"
      : "h-10 w-10";
  const iconSize = isLg ? "h-7 w-7" : "h-5 w-5";

  return (
    <>
      <input
        ref={ref}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => handle(e.target.files)}
        data-testid="input-fab-screen"
      />
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || !configured}
        className={`rounded-full shadow-2xl flex items-center justify-center text-white transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed ${sizeCls} ${className}`}
        style={{
          background: configured
            ? "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)"
            : "#94a3b8",
          boxShadow: configured
            ? "0 8px 24px -6px rgba(37, 99, 235, 0.6), 0 2px 8px rgba(0,0,0,0.15)"
            : undefined,
        }}
        data-testid="button-fab-screen"
        title={
          configured
            ? "Загрузить скрин(ы) экрана выбора тарифа из мобильного Yandex Go"
            : "Серверный приёмник скринов не настроен"
        }
        aria-label="Загрузить скрин Yandex Go"
      >
        {busy ? (
          <Loader2 className={`${iconSize} animate-spin`} />
        ) : (
          <Camera className={iconSize} />
        )}
        {label && <span className="whitespace-nowrap">{label}</span>}
        </button>

      {/* ─── Overlay прогресса загрузки ─── */}
      {busy && progress && createPortal(
        <div className="fixed inset-0 z-[10001] flex items-end justify-center pb-10 px-4 pointer-events-none">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-4 pointer-events-auto"
               style={{ boxShadow: "0 8px 40px -8px rgba(0,0,0,0.25)" }}>
            {/* Заголовок с иконкой */}
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                {progress.phase === "preparing"
                  ? <Camera className="h-4 w-4 text-blue-600" />
                  : <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 leading-tight">
                  {progress.phase === "preparing" ? "Подготовка скринов…" : "Загрузка на сервер…"}
                </p>
                <p className="text-xs text-slate-500 leading-tight mt-0.5 truncate">
                  {progress.phase === "preparing" && progress.currentFile
                    ? progress.currentFile
                    : progress.failedChunks > 0
                      ? `${progress.failedChunks} чанк(ов) с ошибкой — повтор…`
                      : "Пожалуйста, не закрывайте приложение"}
                </p>
              </div>
              <div className="ml-auto text-right flex-shrink-0">
                <span className="text-lg font-bold text-blue-600 leading-tight tabular-nums">
                  {progress.done}
                </span>
                <span className="text-sm text-slate-400 leading-tight">/{progress.total}</span>
              </div>
            </div>

            {/* Прогресс-бар */}
            <div className="relative h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                style={{
                  width: progress.total > 0
                    ? `${Math.max(4, Math.round((progress.done / progress.total) * 100))}%`
                    : "4%",
                  background: progress.failedChunks > 0
                    ? "linear-gradient(90deg, #f59e0b, #ef4444)"
                    : "linear-gradient(90deg, #3b82f6, #2563eb)",
                }}
              />
              {/* Анимированный shimmer пока идёт uploading */}
              {progress.phase === "uploading" && (
                <div
                  className="absolute inset-0 rounded-full opacity-40"
                  style={{
                    background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)",
                    animation: "shimmer 1.5s infinite",
                    backgroundSize: "200% 100%",
                  }}
                />
              )}
            </div>

            {/* Счётчик под баром */}
            <p className="mt-1.5 text-[11px] text-slate-400 text-right tabular-nums">
              {progress.total > 0
                ? `${Math.round((progress.done / progress.total) * 100)}%`
                : "0%"}
              {progress.phase === "uploading" && progress.inFlight > 0
                ? ` · ${progress.inFlight} в полёте`
                : ""}
            </p>
          </div>
        </div>,
        document.body,
      )}

      {askOpen && createPortal(
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${datalistId}-title`}
          data-testid="dialog-ask-operator"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAskOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3
                  id={`${datalistId}-title`}
                  className="text-base font-semibold text-slate-900"
                >
                  Кто загружает скрины?
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Введите ваше имя или фамилию — оно сохранится для этого
                  устройства, спрашивать снова не будем.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAskOpen(false)}
                className="text-slate-400 hover:text-slate-600 -mt-1 -mr-1"
                aria-label="Закрыть"
                data-testid="button-ask-operator-close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <input
              type="text"
              autoFocus
              list={datalistId}
              value={askValue}
              onChange={(e) => setAskValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const name = askValue.trim().slice(0, 60);
                  if (!name) return;
                  // Синхронно: сохраняем + кликаем по input (имитируем
                  // нажатие на label «Продолжить»).
                  setOperator(name);
                  writeLastOperator(name);
                  if (ref.current) {
                    ref.current.value = "";
                    ref.current.click();
                  }
                  setAskOpen(false);
                }
              }}
              maxLength={60}
              placeholder="Например: Иван"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              data-testid="input-ask-operator"
            />
            <datalist id={datalistId}>
              {recentNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAskOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                data-testid="button-ask-operator-cancel"
              >
                Отмена
              </button>
              {/*
                ВНИМАНИЕ: это <label htmlFor=…>, а НЕ кнопка с onClick.
                Клик по label на input[type=file] СИНХРОННО открывает picker
                в том же user-gesture тике — на iOS Safari это единственный
                надёжный способ. Если бы тут был <button onClick={…}>, то
                после setAskOpen(false) и rerender'а click() уже был бы вне
                user-gesture, и picker молча бы не открывался.
                Сначала фиксируем имя через onClick (синхронно), потом
                браузер сам откроет picker по семантике label→input.
              */}
              <label
                htmlFor={inputId}
                onClick={(e) => {
                  const name = askValue.trim().slice(0, 60);
                  if (!name) {
                    e.preventDefault();
                    return;
                  }
                  // Сохраняем СИНХРОННО, до того как браузер откроет picker.
                  setOperator(name);
                  writeLastOperator(name);
                  // Сбрасываем value, чтобы тот же файл можно было выбрать
                  // повторно (onChange срабатывает только при смене значения).
                  if (ref.current) ref.current.value = "";
                  setAskOpen(false);
                }}
                aria-disabled={!askValue.trim()}
                className={`cursor-pointer select-none rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 ${
                  !askValue.trim() ? "opacity-50 cursor-not-allowed pointer-events-none" : ""
                }`}
                data-testid="button-ask-operator-continue"
              >
                Продолжить
              </label>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
