// «Рекомендованные адреса» — список А→Б, который сервер генерирует автоматически
// из якорных точек Минска. Пользователь нажимает на адрес — одновременно (а)
// открывается Yandex Go с уже подставленным маршрутом А→Б через AppMetrica
// deeplink и (б) на сервер уходит бронь, у всех остальных пользователей адрес
// сразу становится зачёркнутым (Занято), потом исчезает совсем, а снизу
// добавляется новый. Раньше было два действия — чекбокс + клик по ссылке —
// теперь одно: «тапнул и пошёл заказывать».
//
// Для адресов без координат (фолбэк, когда у якоря не заполнены lat/lng и
// собрать deeplink нельзя) остался старый чекбокс — пользователь может
// зарезервировать вручную, потом залить скрин обычным способом.
//
// Файл экспортирует три варианта триггера + сам модал:
//   - <RecommendedRoutesDialog open onOpenChange/>  — controlled-модал
//   - <RecommendedRoutesIconButton/>                — outline-книжечка (рядом с
//                                                     «Выбрать скриншот(ы)»)
//   - <RecommendedRoutesFAB className/>             — плавающая круглая кнопка
//                                                     для главного экрана,
//                                                     рядом с камерой-FAB
//
// Содержимое всегда открывается полноэкранным модалом (Dialog по центру),
// чтобы и на десктопе, и на мобиле список не вылезал за viewport.

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Loader2, Clock, RefreshCcw, MapPin, Flame, Snowflake, Sparkles, RotateCcw, Plane, Trees } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  fetchRecommendedRoutes,
  isScreensUploadConfigured,
  reserveRoute,
  type RecommendedRoute,
} from "@/lib/screens-server";
import { getOrCreateClientId } from "@/lib/client-id";

// ─────────── feature probe (один раз за сессию) ───────────
type ProbeState = "pending" | "available" | "unavailable";
let probeState: ProbeState = "pending";
let probePromise: Promise<ProbeState> | null = null;

function probeFeature(): Promise<ProbeState> {
  if (probeState !== "pending") return Promise.resolve(probeState);
  if (probePromise) return probePromise;
  if (!isScreensUploadConfigured()) {
    probeState = "unavailable";
    return Promise.resolve(probeState);
  }
  probePromise = fetchRecommendedRoutes()
    .then((r) => {
      probeState = r.ok ? "available" : "unavailable";
      return probeState;
    })
    .catch(() => {
      probeState = "unavailable";
      return probeState;
    });
  return probePromise;
}

// Открывает заказ в Yandex Go с уже подставленными адресами А→Б и
// тарифом «эконом». На мобильном (iOS/Android) — через AppMetrica
// universal link Я.Такси (3.redirect.appmetrica.yandex.com/route),
// этот линк официально используется партнёрами Я.Такси и открывает
// именно приложение Yandex Go (если установлено) на экране
// «Заказать», иначе ведёт на страницу установки в App Store / Google
// Play с deferred deep-link (после установки попадаешь в маршрут).
//
// На десктопе Yandex Go не существует, поэтому fallback на Я.Карты в
// режиме «такси» (там есть кнопка «Заказать такси», но это веб-flow).
function buildOrderUrl(r: RecommendedRoute): string | null {
  if (
    r.fromLat == null || r.fromLng == null ||
    r.toLat == null   || r.toLng == null
  ) return null;

  const aLat = r.fromLat.toFixed(6);
  const aLng = r.fromLng.toFixed(6);
  const bLat = r.toLat.toFixed(6);
  const bLng = r.toLng.toFixed(6);

  const isMobile =
    typeof navigator !== "undefined" &&
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isMobile) {
    // Публичный AppMetrica tracking_id для Yandex Go (используется во
    // всех партнёрских ссылках Я.Такси). ref пустой — не привязываем
    // заказ к таксопарку-партнёру (если в будущем зарегистрируемся
    // как партнёр Я.Такси, сюда подставим свой ref).
    const params = new URLSearchParams({
      "start-lat": aLat,
      "start-lon": aLng,
      "end-lat": bLat,
      "end-lon": bLng,
      "tariffClass": "econom",
      "appmetrica_tracking_id": "1178268795219780156",
      "ref": "",
    });
    return `https://3.redirect.appmetrica.yandex.com/route?${params.toString()}`;
  }

  // Десктоп — taxi.yandex.by/order (веб-версия БЫ с прямым заказом).
  // gfrom/gto = "lat,lon", ref=2334692 (партнёрский id rwbtaxi).
  const dParams = new URLSearchParams({
    gfrom: `${aLat},${aLng}`,
    gto:   `${bLat},${bLng}`,
    tariff: "econom",
    lang:   "ru",
    utm_source: "rwbtaxi",
    utm_medium: "2334692",
    ref:    "2334692",
  });
  return `https://taxi.yandex.by/order?${dParams.toString()}`;
}

// ─────────── Локальное «скрытие» взятых маршрутов ───────────
// После того как пользователь тапнул адрес (и ушёл в Yandex Go), мы хотим
// убрать этот адрес из его списка через 3 секунды — чтобы при возврате в
// PWA он не глядел на свою же зачёркнутую строчку с таймером «ещё 117с».
// У ДРУГИХ пользователей адрес продолжает быть скрыт ~2 мин (это серверная
// бронь), потом снова появляется.
//
// Map хранится в module scope, потому что DialogContent (shadcn) unmount-ит
// контент при закрытии модалки — обычный useState потерялся бы. Map<routeId,
// hiddenUntilMs(client time)>; TTL = серверная длина брони (2 мин с запасом),
// чтобы после истечения брони, если сервер снова отдаст ту же пару якорей,
// она опять стала видимой.
const HIDE_DELAY_MS = 3000;
// Серверная бронь — 20 минут (см. RESERVATION_TTL_MS на сервере), плюс
// небольшой запас, чтобы локальное скрытие не «промигнуло» появлением
// до того, как сервер очистит бронь. Если в эти 20 минут оператор
// загрузил скрин — бронь снимется на /upload, но в локальном hidden
// запись остаётся ещё до 20 мин — это нормально, пара уже отработана.
const HIDE_TTL_MS = 20 * 60 * 1000 + 10_000;
const localHidden = new Map<string, number>();

function cleanLocalHidden(): boolean {
  const now = Date.now();
  let changed = false;
  for (const [id, until] of localHidden) {
    if (until <= now) {
      localHidden.delete(id);
      changed = true;
    }
  }
  return changed;
}

function useFeatureAvailable(): ProbeState {
  const [s, setS] = useState<ProbeState>(probeState);
  useEffect(() => {
    let cancelled = false;
    if (probeState === "pending") {
      probeFeature().then((x) => {
        if (!cancelled) setS(x);
      });
    } else {
      setS(probeState);
    }
    return () => {
      cancelled = true;
    };
  }, []);
  return s;
}

// ─────────── controlled-модал со списком ───────────
export function RecommendedRoutesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [items, setItems] = useState<RecommendedRoute[]>([]);
  const [loadedRealAt, setLoadedRealAt] = useState<number>(0);
  const [serverNowAtLoad, setServerNowAtLoad] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, forceTick] = useState(0); // re-render каждую секунду для countdown

  const clientId = getOrCreateClientId();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchRecommendedRoutes(clientId);
      if (r.ok) {
        setItems(r.routes);
        setServerNowAtLoad(r.now);
        setLoadedRealAt(Date.now());
      } else {
        setError(r.error);
      }
    } catch (e) {
      setError((e as Error).message || "network_error");
    } finally {
      setLoading(false);
    }
  }, []);

  // подгружаем при открытии и потом раз в 10 сек, пока модал открыт
  // (страховка: ловим брони других клиентов, которых нам не запушил никто)
  useEffect(() => {
    if (!open) return;
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [open, refresh]);

  // Мгновенный refresh после upload скринов: ScreenUploadFAB шлёт
  // window-event 'rwb:screens-uploaded', и пара только что отработанных
  // адресов сразу заменяется новыми (без ожидания 10-сек тика). Особенно
  // важно при работе нескольких операторов — успевают подхватывать пары,
  // которые освободились секунду назад.
  useEffect(() => {
    if (!open) return;
    const onUploaded = () => {
      void refresh();
    };
    window.addEventListener("rwb:screens-uploaded", onUploaded);
    return () => window.removeEventListener("rwb:screens-uploaded", onUploaded);
  }, [open, refresh]);

  // refs для тикера ниже — чтобы не пересоздавать setInterval на каждое
  // обновление items / drift, но при этом видеть актуальные значения.
  const itemsRef = useRef<RecommendedRoute[]>(items);
  itemsRef.current = items;
  const driftRef = useRef<number>(serverNowAtLoad - loadedRealAt);
  driftRef.current = serverNowAtLoad - loadedRealAt;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // 1с тик: (а) перерисовка для countdown + чистка просроченных localHidden,
  // (б) если у кого-то истекла 2-минутная бронь — сразу триггерим refresh,
  // чтобы исчезнувший адрес тут же заменился новым снизу (без ожидания
  // 10-сек polling).
  useEffect(() => {
    if (!open) return;
    let refreshing = false;
    const id = setInterval(() => {
      cleanLocalHidden();
      forceTick((n) => n + 1);
      const now = Date.now() + driftRef.current;
      const hasExpired = itemsRef.current.some(
        (it) => it.reservedUntil != null && it.reservedUntil <= now,
      );
      if (hasExpired && !refreshing) {
        refreshing = true;
        refreshRef
          .current()
          .finally(() => {
            refreshing = false;
          });
      }
    }, 1_000);
    return () => clearInterval(id);
  }, [open]);

  // Прячет тапнутый адрес из ЛОКАЛЬНОГО списка через HIDE_DELAY_MS.
  // Используется и из handleLinkClick (тап по адресу с deeplink), и из
  // handleToggle (чекбокс для адресов без координат) — поведение одинаковое.
  const scheduleLocalHide = useCallback((routeId: string) => {
    setTimeout(() => {
      localHidden.set(routeId, Date.now() + HIDE_TTL_MS);
      forceTick((n) => n + 1);
    }, HIDE_DELAY_MS);
  }, []);

  // Применяет ответ сервера к локальному списку. Используется и из ручного
  // чекбокса (handleToggle) и из тапа по ссылке (handleLinkClick) — логика
  // одинаковая, чтобы не дублировать обработку taken/already_done.
  const applyReserveResult = useCallback(
    (
      routeId: string,
      r: Awaited<ReturnType<typeof reserveRoute>>,
    ): { ok: boolean; errMsg?: string } => {
      if (r.ok) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === routeId
              ? { ...it, reservedUntil: r.until, reservedBy: clientId }
              : it,
          ),
        );
        return { ok: true };
      }
      if (r.error === "taken" && r.reservedUntil) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === routeId
              ? { ...it, reservedUntil: r.reservedUntil!, reservedBy: "other" }
              : it,
          ),
        );
        return { ok: false };
      }
      if (r.error === "already_done") {
        setItems((prev) => prev.filter((it) => it.id !== routeId));
        return { ok: false };
      }
      return { ok: false, errMsg: r.error };
    },
    [clientId],
  );

  const handleToggle = async (route: RecommendedRoute, checked: boolean) => {
    if (!checked) return; // снять галочку нельзя — после клика бронь уходит на сервер
    setBusyId(route.id);
    setError(null);
    try {
      const r = await reserveRoute(route.id, clientId);
      const res = applyReserveResult(route.id, r);
      if (res.ok) {
        // Через 3 сек локально убираем из списка, чтобы оператор видел
        // зачёркивание ровно столько, сколько нужно для подтверждения
        // действия, а не следующие 2 минуты до конца брони.
        scheduleLocalHide(route.id);
      } else if (res.errMsg) {
        setError(res.errMsg);
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message || "network_error");
    } finally {
      setBusyId(null);
    }
  };

  // Тап по ссылке-адресу: одновременно (1) пускаем браузер открыть Yandex Go
  // через нативный переход <a target="_blank">, (2) оптимистично рисуем бронь
  // в UI (адрес сразу зачёркивается у этого пользователя), (3) fire-and-forget
  // отправляем reserveRoute на сервер. Намеренно НЕ await — браузер уйдёт в
  // приложение раньше, чем приедет ответ, но сервер всё равно отработает.
  // preventDefault не вызываем, чтобы переход состоялся синхронно (важно для
  // iOS Safari — async-window.open там блокируется).
  const handleLinkClick = (route: RecommendedRoute) => {
    // Если уже занят — ничего не делаем, ссылка просто откроется.
    if (route.reservedUntil != null && route.reservedUntil > realServerNow) {
      return;
    }
    // Оптимистично — ставим бронь сразу с дефолтным TTL 20 мин (сервер потом
    // пришлёт точное `until` и мы перезапишем в applyReserveResult). 20 мин
    // потому что окно «оператор тапнул адрес — поехал — сделал скрин».
    const optimisticUntil = realServerNow + 20 * 60 * 1000;
    setItems((prev) =>
      prev.map((it) =>
        it.id === route.id
          ? { ...it, reservedUntil: optimisticUntil, reservedBy: clientId }
          : it,
      ),
    );
    // Через 3 сек локально прячем у себя — пользователь успел увидеть
    // что адрес «принят», теперь не нужно держать его в списке со счётчиком.
    // У других серверная бронь продолжается ~2 мин.
    scheduleLocalHide(route.id);
    reserveRoute(route.id, clientId)
      .then((r) => {
        const res = applyReserveResult(route.id, r);
        if (!res.ok && res.errMsg) {
          // Сервер отказал по неизвестной причине — откатим оптимистичный
          // resolve через refresh, чтобы карта брони соответствовала реальной.
          // Локальный hide НЕ снимаем — даже если бронь не приклеилась, юзер
          // уже ушёл в Yandex Go, держать строку перед ним больше не нужно.
          refresh();
        }
      })
      .catch(() => {
        // Сеть упала — синхронизируемся с сервером после возврата.
        refresh();
      });
  };

  // серверное время сейчас (компенсируем дрейф часов клиента)
  const drift = serverNowAtLoad - loadedRealAt;
  const realServerNow = Date.now() + drift;
  const nowClient = Date.now();
  const visible = items.filter((it) => {
    // Локально «скрытые» (юзер только что тапнул) — не показываем,
    // пока их TTL не истечёт.
    const hideUntil = localHidden.get(it.id);
    if (hideUntil != null && hideUntil > nowClient) return false;
    return it.reservedUntil == null || it.reservedUntil > realServerNow;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md w-[95vw] sm:w-full max-h-[85vh] flex flex-col p-0 gap-0"
        data-testid="dialog-recommended-routes"
      >
        <DialogHeader className="px-4 pt-4 pb-2 space-y-1">
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="text-base">
              Рекомендованные адреса
            </DialogTitle>
            <button
              type="button"
              onClick={() => refresh()}
              className="text-muted-foreground hover:text-foreground p-1"
              title="Обновить"
              aria-label="Обновить"
              data-testid="button-recommended-refresh"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
            </button>
          </div>
          <DialogDescription className="text-[11px] leading-snug text-left">
            У каждого оператора — свой список. Нажмите на адрес — откроется
            Yandex Go с готовым маршрутом А→Б, через 3 секунды адрес уйдёт
            из вашего списка. У других этот адрес скрыт ещё 20 минут, чтобы
            не делать скрин дважды (если успели загрузить раньше — освободится
            автоматически). Если на адресе нет иконки <MapPin className="inline h-3 w-3 -mt-0.5 text-blue-600" /> — координат нет,
            открыть приложение нельзя; поставьте галочку слева, чтобы
            забронировать вручную.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="px-4 py-2 text-xs text-destructive border-t">
            Ошибка: {error}
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center border-t">
            Список пуст — все адреса уже разобрали. Проверьте позже.
          </div>
        )}

        <ul className="flex-1 overflow-y-auto divide-y border-t">
          {visible.map((it) => {
            const reserved = it.reservedUntil != null;
            const isMine = reserved && it.reservedBy === clientId;
            const remainingMs = it.reservedUntil
              ? Math.max(0, it.reservedUntil - realServerNow)
              : 0;
            const remainingSec = Math.ceil(remainingMs / 1000);
            return (
              <li
                key={it.id}
                className="px-4 py-3 flex items-start gap-3"
                data-testid={`row-route-${it.id}`}
              >
                {(() => {
                  const yaUrl = buildOrderUrl(it);
                  // Чекбокс показываем только когда у адреса нет deeplink
                  // (нет координат у якорей А или Б). Когда deeplink есть,
                  // основной способ — тапнуть прямо по тексту: и приложение
                  // откроется, и бронь поставится.
                  if (!yaUrl) {
                    return (
                      <Checkbox
                        className="mt-0.5 h-5 w-5"
                        checked={reserved}
                        disabled={reserved || busyId === it.id}
                        onCheckedChange={(v) => handleToggle(it, v === true)}
                        data-testid={`checkbox-route-${it.id}`}
                      />
                    );
                  }
                  return null;
                })()}
                {(() => {
                  const yaUrl = buildOrderUrl(it);
                  const inner = (
                    <div
                      className={`flex-1 text-sm leading-snug ${
                        reserved ? "line-through opacity-60" : ""
                      }`}
                    >
                      <div className="font-medium flex items-start gap-1">
                        <span className="flex-1">{it.from}</span>
                        {yaUrl && (
                          <MapPin
                            className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5"
                            aria-hidden
                          />
                        )}
                      </div>
                      <div className="text-muted-foreground flex items-center gap-1 flex-wrap">
                        <span>→ {it.to}</span>
                        {typeof it.distanceKm === "number" && (
                          <span className="text-[10px] opacity-60 whitespace-nowrap">
                            · {it.distanceKm} км
                          </span>
                        )}
                        {it.bucket === "airport" && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0 rounded bg-violet-100 text-violet-700 border border-violet-200 whitespace-nowrap"
                            title="Поездка с/в Минск-2. Это ~40 км — отдельная категория, такие поездки шумят обычный long-бакет, поэтому считаются отдельно. Большой чек, важно докалибровать."
                          >
                            <Plane className="h-2.5 w-2.5" />
                            аэропорт
                          </span>
                        )}
                        {it.bucket === "suburb" && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0 rounded bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap"
                            title="Пригородный маршрут — хотя бы один адрес вне Минска (Колодищи, Сеница, Заславль и т.п.). У Yandex Go для таких поездок свой загородный тариф, обычная модель цены может промахиваться — отдельный приоритет в выдаче."
                          >
                            <Trees className="h-2.5 w-2.5" />
                            пригород
                          </span>
                        )}
                        {it.weightReason === "hot" && typeof it.mapeE === "number" && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0 rounded bg-rose-100 text-rose-700 border border-rose-200 whitespace-nowrap"
                            title={`Модель цены сильно шумит на этой паре: MAPE ${(it.mapeE * 100).toFixed(0)}% по ${it.n ?? 0} калибровкам — нужна докалибровка.`}
                          >
                            <Flame className="h-2.5 w-2.5" />
                            {(it.mapeE * 100).toFixed(0)}%
                          </span>
                        )}
                        {it.weightReason === "coldslot" && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0 rounded bg-sky-100 text-sky-700 border border-sky-200 whitespace-nowrap"
                            title="В этот час и день недели у нас мало калибровок — пара поднята в выдаче, чтобы заполнить дыру в расписании."
                          >
                            <Snowflake className="h-2.5 w-2.5" />
                            редкий слот
                          </span>
                        )}
                        {it.weightReason === "new" && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0 rounded bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap"
                            title="Эту пару адресов ещё ни разу не калибровали — нужны первые замеры цены."
                          >
                            <Sparkles className="h-2.5 w-2.5" />
                            новая
                          </span>
                        )}
                        {typeof it.recentlyDoneAt === "number" && (() => {
                          // Сервер добил эту пару повторно через multi-pass —
                          // значит свежих не хватило. Покажем сколько часов
                          // прошло с прошлой калибровки, чтобы оператор понимал
                          // «эта пара была сегодня, но мы хотим ещё замер».
                          const ageMs = Date.now() - it.recentlyDoneAt;
                          const ageH = Math.max(1, Math.round(ageMs / 3600_000));
                          return (
                            <span
                              className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0 rounded bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap"
                              title={`Эту пару уже калибровали ~${ageH} ч назад, но свежих пар не хватило — даём её ещё раз, новый замер цены полезен.`}
                            >
                              <RotateCcw className="h-2.5 w-2.5" />
                              повтор {ageH}ч
                            </span>
                          );
                        })()}
                      </div>
                      {reserved && (
                        <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5 not-italic">
                          <Clock className="h-3 w-3" />
                          {isMine
                            ? `Вы взяли · ещё ${remainingSec}с`
                            : `Занято · ещё ${remainingSec}с`}
                        </div>
                      )}
                    </div>
                  );
                  if (!yaUrl) return inner;
                  return (
                    <a
                      href={yaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => handleLinkClick(it)}
                      className="flex-1 text-blue-700 hover:text-blue-900 active:text-blue-950 cursor-pointer no-underline hover:underline focus:outline-none focus:ring-2 focus:ring-blue-300 rounded -m-1 p-1"
                      title="Тап = открыть заказ в Yandex Go с уже выбранными адресами и тарифом «эконом» И одновременно убрать адрес из списка у всех на 2 минуты. На телефоне откроется приложение (или предложит установить). На компьютере — Я.Карты в режиме такси."
                      data-testid={`link-route-${it.id}`}
                    >
                      {inner}
                    </a>
                  );
                })()}
                {busyId === it.id && (
                  <Loader2 className="h-4 w-4 animate-spin mt-1" />
                )}
              </li>
            );
          })}
        </ul>

        <div className="border-t px-4 py-3 flex justify-end">
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            data-testid="button-recommended-close"
          >
            Закрыть
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────── outline-книжечка (для UserTripsDialog рядом с «Выбрать скриншот») ───────────
export function RecommendedRoutesIconButton() {
  const available = useFeatureAvailable();
  const [open, setOpen] = useState(false);
  if (available !== "available") return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-14 w-14 shrink-0"
        title="Рекомендованные адреса"
        onClick={() => setOpen(true)}
        data-testid="button-recommended-routes"
      >
        <BookOpen className="h-5 w-5" />
      </Button>
      <RecommendedRoutesDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

// ─────────── круглая FAB для главного экрана (рядом с камерой) ───────────
export function RecommendedRoutesFAB({
  className = "",
}: {
  className?: string;
}) {
  const available = useFeatureAvailable();
  const [open, setOpen] = useState(false);
  if (available !== "available") return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded-full shadow-2xl flex items-center justify-center h-14 w-14 transition-all active:scale-95 bg-white border border-slate-200 hover:bg-slate-50 ${className}`}
        style={{
          boxShadow:
            "0 8px 24px -6px rgba(15, 23, 42, 0.35), 0 2px 8px rgba(0,0,0,0.12)",
        }}
        title="Рекомендованные адреса"
        aria-label="Рекомендованные адреса"
        data-testid="button-fab-recommended"
      >
        <BookOpen className="h-6 w-6 text-blue-700" />
      </button>
      <RecommendedRoutesDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

// default-экспорт оставляем для обратной совместимости с прежним импортом
export default RecommendedRoutesIconButton;
