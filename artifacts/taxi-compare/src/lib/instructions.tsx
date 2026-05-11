import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  BookOpen,
  Camera,
  Layers,
  MapPin,
  Menu as MenuIcon,
  Sliders,
  Target,
  Timer,
} from "lucide-react";

/**
 * ВАЖНО для разработчиков:
 * При любом существенном изменении в инструкции (новый шаг, изменение
 * порядка действий, изменение UI-элементов на которые ссылаемся) —
 * УВЕЛИЧИВАЙТЕ INSTRUCTIONS_VERSION. После этого у всех пользователей
 * автоматически загорится красная точка с «!» возле кнопки «i», чтобы
 * привлечь внимание к новому контенту.
 */
export const INSTRUCTIONS_VERSION = 1;

const LS_KEY = "rwbtaxi:instructions:lastSeenVersion";

export interface InstructionStep {
  id: string;
  title: string;
  body: ReactNode;
  /** Иконка для визуальной подсказки — копия реальной кнопки в UI. */
  icon: ReactNode;
  /** Где искать в интерфейсе. */
  hint: string;
}

export const INSTRUCTION_STEPS: InstructionStep[] = [
  {
    id: "tariff",
    title: "Выбор тарифа",
    icon: (
      <div className="flex border rounded-md overflow-hidden text-xs">
        <span className="px-2.5 py-1.5 bg-primary text-primary-foreground font-medium">
          Эконом
        </span>
        <span className="px-2.5 py-1.5 bg-background font-medium">
          Комфорт
        </span>
      </div>
    ),
    hint: "Сверху слева, рядом с иконкой машины",
    body: (
      <>
        Сверху слева переключите{" "}
        <span className="font-semibold">Эконом</span> или{" "}
        <span className="font-semibold">Комфорт</span> — карта пересчитается
        под выбранный тариф.
      </>
    ),
  },
  {
    id: "layer",
    title: "Что показывать на карте",
    icon: (
      <div className="flex items-center gap-1 text-blue-600">
        <Layers className="h-5 w-5" />
        <span className="text-xs font-semibold">Сёрджи / Скор. / Парк</span>
      </div>
    ),
    hint: "Сверху, справа от выбора тарифа",
    body: (
      <>
        Три кнопки сверху —{" "}
        <span className="font-semibold">Сёрджи</span>,{" "}
        <span className="font-semibold">Скор.</span> и{" "}
        <span className="font-semibold">Парк</span>. Переключают,
        что окрашивает шестиугольники: коэффициент цены, скорость движения
        или плотность машин.
      </>
    ),
  },
  {
    id: "time",
    title: "Время и день",
    icon: <Timer className="h-7 w-7 text-amber-600" />,
    hint: "Слайдер внизу экрана + день недели в меню",
    body: (
      <>
        Снизу — слайдер времени.{" "}
        <span className="font-semibold">«Вторник · 10:10»</span> = текущее
        время прогноза. Двигайте — карта обновится. Чтобы вернуться к
        реальному времени, нажмите кнопку{" "}
        <span className="font-semibold text-emerald-700">
          «реальное»
        </span>{" "}
        справа.
      </>
    ),
  },
  {
    id: "zones",
    title: "Зоны спроса",
    icon: (
      <div className="flex items-center gap-1">
        <span className="inline-block w-5 h-5 rounded-sm bg-emerald-400" />
        <span className="inline-block w-5 h-5 rounded-sm bg-amber-400" />
        <span className="inline-block w-5 h-5 rounded-sm bg-red-500" />
      </div>
    ),
    hint: "Цветные шестиугольники на карте",
    body: (
      <>
        Цвет шестиугольника = цена/спрос в этой точке.{" "}
        <span className="font-semibold text-emerald-700">Зелёный</span> —
        дёшево.{" "}
        <span className="font-semibold text-amber-700">Жёлтый</span> —
        средне.{" "}
        <span className="font-semibold text-rose-700">Красный</span> —
        дорого/высокий спрос. Тапните по соте — увидите цифры.
      </>
    ),
  },
  {
    id: "book",
    title: "Книжка с рекомендациями",
    icon: (
      <div className="rounded-full bg-white border border-slate-300 shadow-md h-12 w-12 flex items-center justify-center">
        <BookOpen className="h-6 w-6 text-blue-700" />
      </div>
    ),
    hint: "Справа внизу, синяя книжка",
    body: (
      <>
        Когда есть свежие рекомендации — справа внизу появляется{" "}
        <span className="font-semibold text-blue-700">синяя книжка</span> с
        цифрой. Внутри — список маршрутов{" "}
        <span className="font-semibold">А → Б</span>, которые сейчас выгодны.
        Если книжки не видно — рекомендаций пока нет.
      </>
    ),
  },
  {
    id: "book-mark",
    title: "Взять адрес в работу",
    icon: (
      <div className="rounded-full bg-blue-100 border border-blue-300 h-10 w-10 flex items-center justify-center">
        <MapPin className="h-5 w-5 text-blue-700" />
      </div>
    ),
    hint: "Внутри книжки — тап по адресу со значком булавки",
    body: (
      <>
        Открыли книжку — нажмите{" "}
        <span className="font-semibold">прямо по строке адреса</span>{" "}
        (там, где справа значок{" "}
        <MapPin className="inline h-3.5 w-3.5 -mt-0.5 text-blue-600" />). Сразу
        откроется <span className="font-semibold">Yandex Go</span> с готовым
        маршрутом А→Б и тарифом «эконом», а сам адрес исчезнет из списка у
        всех на 2 минуты — никто другой его параллельно брать не будет. Если
        у адреса нет значка булавки (нет координат), поставьте галочку слева
        вручную.
      </>
    ),
  },
  {
    id: "upload",
    title: "Загрузить скрин Yandex Go",
    icon: (
      <div className="rounded-full bg-blue-600 shadow-md h-12 w-12 flex items-center justify-center">
        <Camera className="h-6 w-6 text-white" />
      </div>
    ),
    hint: "Справа внизу, синяя камера",
    body: (
      <>
        В <span className="font-semibold">Yandex Go</span> откройте экран
        выбора тарифа. Сделайте скриншот так, чтобы было видно адрес «Откуда
        / Куда» и цену. Вернитесь сюда, нажмите{" "}
        <span className="font-semibold text-blue-700">синюю камеру</span>{" "}
        справа внизу и выберите{" "}
        <span className="font-semibold">от 1 до 5 фото</span>. Распознаются
        автоматически.
      </>
    ),
  },
  {
    id: "queue",
    title: "Если очередь большая",
    icon: <Timer className="h-7 w-7 text-rose-600" />,
    hint: "Появится подсказка после загрузки",
    body: (
      <>
        Загружайте всегда — файлы{" "}
        <span className="font-semibold">никогда не теряются</span>. Если
        очередь распознавания большая, появится подсказка{" "}
        <span className="italic">«попробуйте чуть позже»</span> — это просьба
        растянуть загрузку, не запрет. Что раньше прислали — то первым и
        обработается.
      </>
    ),
  },
  {
    id: "holes",
    title: "«Дыры» — где не хватает данных",
    icon: (
      <div className="rounded-full bg-rose-600 shadow-md h-12 w-12 flex items-center justify-center">
        <Target className="h-6 w-6 text-white" strokeWidth={2.5} />
      </div>
    ),
    hint: "Справа внизу, красный «прицел»",
    body: (
      <>
        Красный <span className="font-semibold">«прицел»</span> справа —
        включает слой «дыр». Серые соты на карте — туда нужны скрины в
        первую очередь. Сделайте поездку через одну из таких сот и пришлите
        скрин — спасибо.
      </>
    ),
  },
  {
    id: "menu",
    title: "Меню — всё остальное",
    icon: (
      <div className="rounded-md border bg-background h-10 w-10 flex items-center justify-center shadow-sm">
        <MenuIcon className="h-5 w-5" />
      </div>
    ),
    hint: "Сверху справа, три полоски",
    body: (
      <>
        Сверху справа — <span className="font-semibold">меню</span>. Там:
        день недели, мои поездки и скрины, маршрут{" "}
        <span className="font-semibold">А → Б</span>, калькулятор тарифа,
        переключатель «дыр» и описание сервиса.
      </>
    ),
  },
];

/* ────────── External store: общее состояние для всех HelpButton ──────────
 * Используем useSyncExternalStore + локальный набор подписчиков + слушатель
 * window 'storage', чтобы:
 *  1) оба экземпляра HelpButton (мобильный + десктопный) синхронно гасили «!»
 *     при клике в любом из них — даже если один скрыт CSS-ом;
 *  2) при изменении localStorage из другой вкладки бэйдж тут же обновился;
 *  3) после возврата фокуса на вкладку — состояние ре-валидировалось.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
function notify() {
  for (const l of listeners) l();
}

function readSeen(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeSeen(v: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, String(v));
  } catch {
    /* ignore */
  }
}

// Слушаем чужие вкладки и возврат фокуса (один раз на модуль).
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === LS_KEY) notify();
  });
  window.addEventListener("focus", notify);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") notify();
  });
}

function subscribe(cb: Listener) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Хук: показывает, есть ли непросмотренная новая версия инструкции.
 * `markSeen()` сразу обновляет localStorage и оповещает все экземпляры.
 */
export function useInstructionsBadge() {
  const seen = useSyncExternalStore(
    subscribe,
    readSeen,
    () => 0, // SSR snapshot
  );
  const hasUpdate = seen < INSTRUCTIONS_VERSION;

  function markSeen() {
    writeSeen(INSTRUCTIONS_VERSION);
    notify();
  }

  return { hasUpdate, markSeen };
}

/** Полностью сбросить «увиденность» (для тестов/админа). */
export function resetInstructionsSeen() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  notify();
}
