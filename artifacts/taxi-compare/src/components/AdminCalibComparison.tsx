// Админ-таблица «план vs факт» по последним распознанным скринам Yandex Go.
// Тянет данные с /api/screens/recent-calibs (отсортировано сервером DESC),
// для каждого замера считает прогнозную цену по нашей формуле basePrice()
// и показывает расхождение в ₽ и %. Открывается только из админ-секций.

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, X, AlertCircle, Loader2, RotateCw, FileDown, FilterX } from "lucide-react";
import {
  fetchRecentCalibs,
  fetchPipelineStats,
  requeueFailedScreens,
  type RecentCalib,
  type PipelineStats,
} from "@/lib/screens-server";
import { getWbToken } from "@/lib/wb-api";
import {
  surgeAt,
  hourToSlot,
  scheduleDayToType,
  getCurrentScheduleDay,
} from "@/lib/zones";
import {
  predictE,
  predictC,
  modelInfo,
  predictPriceBatch,
  type DemandColor,
  type PriceBatchItem,
  type PriceBatchResult,
  type PriceRangeArgs,
} from "@/lib/pricing-model";
import {
  fetchWeather,
  getIsRain,
  type WeatherMap,
} from "@/lib/weather";
import { AlertTriangle } from "lucide-react";

// Локальный haversine — в zones.ts функция приватная.
function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Оценка времени поездки в Минске (≈24 км/ч с учётом светофоров и пробок).
// Минимум 5 минут — даже на 1 км в реальности набегает столько в плотном городе.
function estimateTripMin(km: number): number {
  return Math.max(5, Math.round(km * 2.5));
}

type Row = {
  c: RecentCalib;
  km: number | null;
  min: number | null;             // приоритет: c.tripMin (со скрина), иначе estimateTripMin(km)
  minSource: "screen" | "est" | null; // показывает откуда взяли минуты
  prognozRawE: number | null;     // прогноз ДО Yandex-trend коррекции
  prognozRawC: number | null;
  prognozE: number | null;        // basePrice("econom") × сёрдж × trendCoefE
  prognozC: number | null;        // basePrice("comfort") × сёрдж × trendCoefC
  surgeE: number | null;          // прогнозный econom-сёрдж по зоне точки А
  surgeC: number | null;          // прогнозный comfort-сёрдж по зоне точки А
  surgeSource: "measured" | "blended" | "predicted" | null;
  deltaE: number | null; // факт - прогноз, ₽
  deltaC: number | null;
  pctE: number | null; // (факт-прогноз)/прогноз * 100
  pctC: number | null;
  // Сильное расхождение: factE/prognozRawE < 0.5 ИЛИ > 2.0 — кандидат
  // на ручную инспекцию (баг OCR / редкий surge / промо-тариф). Такие
  // строки исключаются из расчёта Yandex-trend и из агрегатной статистики.
  isOutlier: boolean;
};

// Время заказа: предпочитаем дату+час из самого скрина (точнее), иначе
// падаем на receivedAt — момент, когда скрин прилетел нам на бэк (это и
// есть фактическое время заказа, если водитель прислал сразу).
function orderDateTime(c: RecentCalib): Date {
  // Полный кейс: и дата и час со скрина.
  if (c.date && c.hour != null) {
    const hh = String(Math.max(0, Math.min(23, c.hour))).padStart(2, "0");
    const d = new Date(`${c.date}T${hh}:00:00`);
    if (!isNaN(d.getTime())) return d;
  }
  // Иначе — целиком receivedAt (ISO от сервера; в браузере getDay/getHours
  // вернёт значения в локальной TZ, которая у нас и водителей = Минск).
  const recv = new Date(c.receivedAt);
  if (!isNaN(recv.getTime())) return recv;
  return new Date();
}

// `trendCoefE/C` — поправка на «Yandex изменил цены за последние 24ч».
// Если медианный (factE/prognozRawE) по последним 24ч стабильно ниже 1
// (Yandex снизил цены) или выше 1 (поднял) — мы умножаем прогноз на этот
// коэф, чтобы догнать рынок. По умолчанию 1.0 (без поправки).
//
// `weather` — карта `YYYY-MM-DDTHH → {isRain, ...}` из Open-Meteo.
// Используется для двух вещей:
//   1) Подача `is_rain` фичи в predictE/C (модель v2 на этом обучена).
//   2) В computeYandexTrend для выбора эталона той же погоды.
function buildRow(
  c: RecentCalib,
  trendCoefE: number = 1,
  trendCoefC: number = 1,
  weather: WeatherMap = new Map(),
): Row {
  let km: number | null = null;
  let min: number | null = null;
  let minSource: Row["minSource"] = null;
  let prognozRawE: number | null = null;
  let prognozRawC: number | null = null;
  let prognozE: number | null = null;
  let prognozC: number | null = null;
  let surgeE: number | null = null;
  let surgeC: number | null = null;
  let surgeSource: Row["surgeSource"] = null;
  if (
    c.fromLat != null &&
    c.fromLng != null &&
    c.toLat != null &&
    c.toLng != null
  ) {
    km = haversineKm(c.fromLat, c.fromLng, c.toLat, c.toLng);
    // Минуты больше НЕ участвуют в формуле (новая data-driven модель
    // учится на km + km² + час + demand — см. src/lib/pricing-model.ts),
    // но мы их по-прежнему показываем юзеру в колонке «мин».
    if (typeof c.tripMin === "number" && c.tripMin > 0) {
      min = c.tripMin;
      minSource = "screen";
    } else {
      min = estimateTripMin(km);
      minSource = "est";
    }
    // ─── НОВАЯ МОДЕЛЬ ────────────────────────────────────────────────
    // Прогноз цены = линейная регрессия из реальных скринов Yandex.
    // Фичи: [1, km, km², is_red, is_yellow, sin(2πh/24), cos(2πh/24)]
    // Веса обучены на 200+ калибровках скриптом scripts/train-from-calibs.mjs.
    // Старая «basePrice × surgeAt × routeSurgeMultiplier» (33% MAPE) выпилена.
    const dt = orderDateTime(c);
    const hour = dt.getHours();
    const demand = (c.demand || null) as DemandColor;
    // v3: главный сигнал — tripMin (фактическое время поездки). Fallback
    // на etaMin (прогноз со скрина) если tripMin отсутствует. День недели
    // (0=вс…6=сб) — новая фича v3 (выходные ≠ будни).
    const etaForModel = c.etaMin ?? c.tripMin ?? null;
    const tripMinForModel = c.tripMin ?? null;
    const dow = dt.getDay();
    // is_rain — для v2 модели; v3 пока без погоды (Спринт 2 enrich).
    const isRain = getIsRain(dt, weather);
    prognozRawE = predictE(km, hour, demand, etaForModel, { isRain, tripMin: tripMinForModel, dow });
    prognozRawC = predictC(km, hour, demand, etaForModel, { isRain, tripMin: tripMinForModel, dow });
    // Сёрдж теперь не используется в формуле — оставлено для отладочного
    // отображения, чтобы юзер видел сколько Yandex показывал ⚡ на скрине.
    const day = scheduleDayToType(getCurrentScheduleDay(dt));
    const slot = hourToSlot(hour);
    const s = surgeAt(c.fromLat, c.fromLng, day, slot);
    surgeC = +s.comfort.toFixed(2);
    surgeE = +s.econom.toFixed(2);
    surgeSource = s.source;
    // С v2 модели Yandex-trend поправка ОТКЛЮЧЕНА (была костылём):
    // новая 13-фичная модель сама учитывает временные пики (morning_peak,
    // evening_rush, night) + дождь, а piecewise-linear по km снимает
    // переоценку коротких. trendCoef всё ещё считается и показывается
    // в шапке как «канарейка» — если коэф уходит от 1.0, значит сезонный
    // сдвиг рынка пора подтянуть переобучением (train-from-calibs-v2.mjs).
    void trendCoefE; void trendCoefC; // unused — оставлены для совместимости вызовов
    prognozE = prognozRawE;
    prognozC = prognozRawC;
  }
  const deltaE =
    prognozE != null && c.factE != null ? c.factE - prognozE : null;
  const deltaC =
    prognozC != null && c.factC != null ? c.factC - prognozC : null;
  const pctE =
    deltaE != null && prognozE && prognozE > 0
      ? (deltaE / prognozE) * 100
      : null;
  const pctC =
    deltaC != null && prognozC && prognozC > 0
      ? (deltaC / prognozC) * 100
      : null;
  // Outlier-флаг считаем по RAW-прогнозу (до trend-коррекции), чтобы
  // корректор сам не подгонял outlier'ы под себя.
  const ratioRawE =
    prognozRawE && prognozRawE > 0 && c.factE != null
      ? c.factE / prognozRawE
      : null;
  const ratioRawC =
    prognozRawC && prognozRawC > 0 && c.factC != null
      ? c.factC / prognozRawC
      : null;
  const isOutlier =
    (ratioRawE != null && (ratioRawE < 0.5 || ratioRawE > 2.0)) ||
    (ratioRawC != null && (ratioRawC < 0.5 || ratioRawC > 2.0));
  return {
    c,
    km,
    min,
    minSource,
    prognozRawE,
    prognozRawC,
    prognozE,
    prognozC,
    surgeE,
    surgeC,
    surgeSource,
    deltaE,
    deltaC,
    pctE,
    pctC,
    isOutlier,
  };
}

// «Yandex-канарейка»: справедливое сравнение like-with-like.
//
// Старая версия брала ВСЕ ratios=fact/prognozRaw за последние 24ч и
// считала медиану. Это давало ложные тревоги: если сейчас понедельник 9:00
// (пик) а 24ч назад было воскресенье 9:00 (низкий спрос), то даже после
// учёта v2-фич модель имеет небольшой остаточный bias по слотам — и
// «канарейка» показывала +14% не потому что Yandex поднял, а потому что
// сравнение было нечестное.
//
// Новая логика — slot+weather aware:
//   • current  = строки в текущем слоте за последние 6ч с такой же погодой
//   • baseline = строки в том же слоте за весь датасет (исключая последние
//     6ч), с такой же погодой (если хватает данных; иначе любая погода)
//   • coef = median(current ratios) / median(baseline ratios)
//
// Если current или baseline < 6 строк — coef=1 и status="not_enough_data".
// Цель: реагировать ТОЛЬКО на «Yandex реально поднял цены в утренний пик
// сегодня сравнительно с утренним пиком вчера/позавчера», а не на разницу
// между разными слотами недели.
type SlotKey =
  | "wd_morning"   // будни 7-9
  | "wd_midday"    // будни 10-15
  | "wd_evening"   // будни 16-19
  | "wd_night"     // будни 20-6
  | "we_morning"   // выходные 7-9
  | "we_midday"    // выходные 10-15
  | "we_evening"   // выходные 16-19
  | "we_night";    // выходные 20-6

const SLOT_LABEL: Record<SlotKey, string> = {
  wd_morning: "будни-утро (7-9)",
  wd_midday:  "будни-обед (10-15)",
  wd_evening: "будни-вечер (16-19)",
  wd_night:   "будни-ночь (20-6)",
  we_morning: "выходные-утро (7-9)",
  we_midday:  "выходные-день (10-15)",
  we_evening: "выходные-вечер (16-19)",
  we_night:   "выходные-ночь (20-6)",
};

function getSlot(d: Date): SlotKey {
  const dow = d.getDay(); // 0=вс, 6=сб
  const isWeekend = dow === 0 || dow === 6;
  const h = d.getHours();
  let part: "morning" | "midday" | "evening" | "night";
  if (h >= 7 && h <= 9) part = "morning";
  else if (h >= 10 && h <= 15) part = "midday";
  else if (h >= 16 && h <= 19) part = "evening";
  else part = "night"; // 20-23 + 0-6
  return (isWeekend ? "we_" : "wd_") + part as SlotKey;
}

type Trend = {
  coefE: number;
  coefC: number;
  // Диагностика для шапки UI:
  slot: SlotKey;
  isRain: 0 | 1;
  currentN: number;       // строк в current-окне (после ratio-фильтра)
  baselineN: number;      // строк в baseline-окне
  windowHours: number;    // длина current-окна
  status:
    | "ok"
    | "no_current"        // нет свежих калибровок в этом слоте
    | "no_baseline"       // нет эталона
    | "not_enough_data"   // суммарно мало
    | "weather_relaxed";  // эталон без фильтра по погоде (мало дождевых записей)
};

function median(xs: number[]): number {
  if (xs.length === 0) return 1;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function computeYandexTrend(
  rowsRaw: Row[],
  weather: WeatherMap,
  now: Date = new Date(),
): Trend {
  const WINDOW_HOURS = 6;
  const cutoffMs = now.getTime() - WINDOW_HOURS * 3600 * 1000;
  const currentSlot = getSlot(now);
  const currentIsRain = getIsRain(now, weather);

  // Робастный фильтр выбросов (ratio ∉ [0.5, 2.0]).
  const RATIO_LO = 0.5;
  const RATIO_HI = 2.0;

  type Bucket = { eRatios: number[]; cRatios: number[] };
  const make = (): Bucket => ({ eRatios: [], cRatios: [] });

  // Группы:
  //   currentSameWx    — текущий слот, последние 6ч, такая же погода
  //   baselineSameWx   — тот же слот, до cutoff, такая же погода
  //   baselineAnyWx    — тот же слот, до cutoff, любая погода (fallback)
  const cur = make();
  const baseSame = make();
  const baseAny = make();

  for (const r of rowsRaw) {
    const dt = orderDateTime(r.c);
    if (getSlot(dt) !== currentSlot) continue;
    const wx = getIsRain(dt, weather);
    const inCurrentWindow = dt.getTime() >= cutoffMs;

    let re: number | null = null;
    let rc: number | null = null;
    if (r.prognozRawE != null && r.prognozRawE > 0 && r.c.factE != null) {
      const x = r.c.factE / r.prognozRawE;
      if (x >= RATIO_LO && x <= RATIO_HI) re = x;
    }
    if (r.prognozRawC != null && r.prognozRawC > 0 && r.c.factC != null) {
      const x = r.c.factC / r.prognozRawC;
      if (x >= RATIO_LO && x <= RATIO_HI) rc = x;
    }
    if (re == null && rc == null) continue;

    if (inCurrentWindow) {
      if (wx === currentIsRain) {
        if (re != null) cur.eRatios.push(re);
        if (rc != null) cur.cRatios.push(rc);
      }
      // Поездки в окне с другой погодой не идут ни в baseline, ни в current.
    } else {
      if (re != null) baseAny.eRatios.push(re);
      if (rc != null) baseAny.cRatios.push(rc);
      if (wx === currentIsRain) {
        if (re != null) baseSame.eRatios.push(re);
        if (rc != null) baseSame.cRatios.push(rc);
      }
    }
  }

  const MIN_CUR = 6;
  const MIN_BASE = 12;
  const clamp = (x: number) => Math.max(0.85, Math.min(1.15, x));

  const curN = Math.max(cur.eRatios.length, cur.cRatios.length);
  let status: Trend["status"] = "ok";
  let baseE = baseSame.eRatios;
  let baseC = baseSame.cRatios;
  // Если по погоде эталон жидковат — расслабляем фильтр погоды.
  if (baseE.length < MIN_BASE || baseC.length < MIN_BASE) {
    baseE = baseAny.eRatios;
    baseC = baseAny.cRatios;
    if (baseE.length >= MIN_BASE && baseC.length >= MIN_BASE) {
      status = "weather_relaxed";
    }
  }
  const baseN = Math.max(baseE.length, baseC.length);

  let coefE = 1;
  let coefC = 1;
  if (curN < MIN_CUR) {
    status = "no_current";
  } else if (baseE.length < MIN_BASE || baseC.length < MIN_BASE) {
    status = baseN === 0 ? "no_baseline" : "not_enough_data";
  } else {
    const baseMedE = median(baseE);
    const baseMedC = median(baseC);
    const curMedE = cur.eRatios.length >= MIN_CUR ? median(cur.eRatios) : baseMedE;
    const curMedC = cur.cRatios.length >= MIN_CUR ? median(cur.cRatios) : baseMedC;
    coefE = baseMedE > 0 ? clamp(curMedE / baseMedE) : 1;
    coefC = baseMedC > 0 ? clamp(curMedC / baseMedC) : 1;
  }

  return {
    coefE,
    coefC,
    slot: currentSlot,
    isRain: currentIsRain,
    currentN: curN,
    baselineN: baseN,
    windowHours: WINDOW_HOURS,
    status,
  };
}

function pctColor(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  const a = Math.abs(pct);
  if (a <= 10) return "text-emerald-700 bg-emerald-50";
  if (a <= 25) return "text-amber-700 bg-amber-50";
  return "text-rose-700 bg-rose-50";
}

function fmtMoney(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

function fmtDelta(v: number | null): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}

function fmtPct(p: number | null): string {
  if (p == null) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(0)}%`;
}

function fmtTime(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mn = String(d.getMinutes()).padStart(2, "0");
    return `${dd}.${mm} ${hh}:${mn}`;
  } catch {
    return iso;
  }
}

function demandDot(demand: string | null): string {
  switch ((demand || "").toLowerCase()) {
    case "green":
      return "bg-emerald-500";
    case "yellow":
      return "bg-amber-400";
    case "red":
      return "bg-rose-500";
    default:
      return "bg-slate-300";
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export function AdminCalibComparison({ open, onClose }: Props) {
  const [items, setItems] = useState<RecentCalib[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<number>(50);
  // Состояние пайплайна распознавания (incoming → vision → calib).
  // Грузим параллельно с recent-calibs и обновляем каждые 30с пока окно открыто.
  const [pipeline, setPipeline] = useState<PipelineStats | null>(null);
  const [pipelineErr, setPipelineErr] = useState<string | null>(null);
  const [requeueing, setRequeueing] = useState(false);
  const [requeueMsg, setRequeueMsg] = useState<string | null>(null);

  // Sprint 4 T04: фильтры выборки + экспорт в Excel.
  // dateFrom/dateTo — YYYY-MM-DD (включительно). demandFilter — Set цветов
  // спроса; пустой = все. tariffFilter — "all" | "E" | "C": ограничивает
  // строки наличием factE/factC. Фильтры действуют ТОЛЬКО локально (UI):
  // ML-batch и items/total приходят с сервера полным набором.
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [demandFilter, setDemandFilter] = useState<string>("all"); // all|red|yellow|green|unknown
  const [tariffFilter, setTariffFilter] = useState<"all" | "E" | "C">("all");
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const r = await fetchRecentCalibs(limit);
    if (r.ok) {
      setItems(r.items);
      setTotal(r.total);
    } else {
      setError(r.error);
      setItems([]);
      setTotal(0);
    }
    setLoading(false);
  }

  async function loadPipeline() {
    const r = await fetchPipelineStats();
    if (r.ok) {
      setPipeline(r);
      setPipelineErr(null);
    } else {
      setPipelineErr(r.error);
    }
  }

  async function onRequeue() {
    const tok = getWbToken();
    if (!tok) {
      setRequeueMsg("Требуется вход в WB-админку (для авторизации).");
      return;
    }
    setRequeueing(true);
    setRequeueMsg(null);
    const r = await requeueFailedScreens(tok);
    setRequeueing(false);
    if (r.ok) {
      setRequeueMsg(
        `Возвращено в очередь: ${r.moved}${r.skipped ? `, пропущено ${r.skipped}` : ""}. Распознавание начнётся в ближайшие 5 минут.`,
      );
      // Обновляем сразу — увидим что incoming вырос, failed упал.
      loadPipeline();
    } else {
      setRequeueMsg(`Ошибка: ${r.error}`);
    }
  }

  useEffect(() => {
    if (open) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, limit]);

  useEffect(() => {
    if (!open) return;
    loadPipeline();
    const id = window.setInterval(loadPipeline, 30_000);
    return () => window.clearInterval(id);
  }, [open]);

  // ─── Sprint 3.1: ML batch результат от CatBoost+H3 ────────────────────
  // На каждый загруженный набор калибровок мы один раз шлём batch-запрос
  // /api/ml/predict-price/batch и складываем результат в Map<calibId, item>.
  // Если ML-сервис не ответил — mlData остаётся null, ML-колонки покажут «—».
  const [mlData, setMlData] = useState<Map<string, PriceBatchItem> | null>(null);
  const [mlMeta, setMlMeta] = useState<{
    modelVersion: string;
    nOk: number;
    nErr: number;
    calibApplied: boolean;
  } | null>(null);
  const [mlLoading, setMlLoading] = useState(false);
  const [mlErr, setMlErr] = useState<string | null>(null);

  // Погода Open-Meteo (Минск). Кэш 30 мин в localStorage. Используется и
  // в predictE/C (фича is_rain), и в канарейке (эталон той же погоды).
  const [weather, setWeather] = useState<WeatherMap>(new Map());
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchWeather().then((w) => {
      if (!cancelled) setWeather(w);
    });
    // Каждые 30 мин обновляем (попадёт в кэш и оттуда же прочитается).
    const id = window.setInterval(() => {
      fetchWeather().then((w) => {
        if (!cancelled) setWeather(w);
      });
    }, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open]);

  // Двухпроходное построение: сначала raw (с погодой, но без trend-
  // коррекции), потом считаем slot+weather aware канарейку, потом
  // финальные строки. С v2 trend-коррекция к prognoz НЕ применяется —
  // буквально оставлены поля coefE/coefC=1.0, канарейка только для
  // мониторинга в шапке.
  const { rows, trend } = useMemo(() => {
    const rowsRaw = items.map((c) => buildRow(c, 1, 1, weather));
    const tr = computeYandexTrend(rowsRaw, weather, new Date());
    const rowsFinal = items.map((c) =>
      buildRow(c, tr.coefE, tr.coefC, weather),
    );
    return { rows: rowsFinal, trend: tr };
  }, [items, weather]);

  // Sprint 4 T04: применяем фильтры. Используется в таблице, агрегатах
  // (stats, mlStats) и Excel-экспорте, чтобы пользователь видел согласованную
  // картину «то что фильтровал → то и показано → то и выгружено».
  // trend и канарейка остаются по полному набору (это глобальные индикаторы).
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (dateFrom || dateTo) {
        const dt = orderDateTime(r.c);
        if (dateFrom) {
          const from = new Date(`${dateFrom}T00:00:00`);
          if (!isNaN(from.getTime()) && dt < from) return false;
        }
        if (dateTo) {
          const to = new Date(`${dateTo}T23:59:59`);
          if (!isNaN(to.getTime()) && dt > to) return false;
        }
      }
      if (demandFilter !== "all") {
        const d = r.c.demand ?? "unknown";
        if (d !== demandFilter) return false;
      }
      if (tariffFilter === "E" && r.c.factE == null) return false;
      if (tariffFilter === "C" && r.c.factC == null) return false;
      return true;
    });
  }, [rows, dateFrom, dateTo, demandFilter, tariffFilter]);

  const filtersActive =
    !!dateFrom || !!dateTo || demandFilter !== "all" || tariffFilter !== "all";

  function resetFilters() {
    setDateFrom("");
    setDateTo("");
    setDemandFilter("all");
    setTariffFilter("all");
  }

  // Экспорт текущей фильтрованной выборки в .xlsx через exceljs (lazy-import,
  // чтобы не раздувать main bundle ~600KB). Колонки повторяют визуальную
  // таблицу + добавляем raw-числа без форматирования (для сводных в Excel).
  async function exportToExcel() {
    setExporting(true);
    setExportErr(null);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "rwbtaxi.by · admin";
      wb.created = new Date();
      const ws = wb.addWorksheet("Калибровки");
      ws.columns = [
        { header: "Время заказа", key: "time", width: 19 },
        { header: "Откуда", key: "from", width: 32 },
        { header: "Куда", key: "to", width: 32 },
        { header: "Км (по прямой)", key: "km", width: 10 },
        { header: "Мин", key: "min", width: 6 },
        { header: "Источник мин", key: "minSrc", width: 10 },
        { header: "Спрос", key: "demand", width: 8 },
        { header: "Факт E", key: "factE", width: 9 },
        { header: "Прогноз OLS E", key: "predE", width: 12 },
        { header: "Δ E ₽", key: "deltaE", width: 9 },
        { header: "Δ E %", key: "pctE", width: 8 },
        { header: "ML E med", key: "mlEMed", width: 9 },
        { header: "ML E low", key: "mlELow", width: 9 },
        { header: "ML E high", key: "mlEHigh", width: 9 },
        { header: "Δ E ML %", key: "mlPctE", width: 9 },
        { header: "Факт C", key: "factC", width: 9 },
        { header: "Прогноз OLS C", key: "predC", width: 12 },
        { header: "Δ C ₽", key: "deltaC", width: 9 },
        { header: "Δ C %", key: "pctC", width: 8 },
        { header: "ML C med", key: "mlCMed", width: 9 },
        { header: "ML C low", key: "mlCLow", width: 9 },
        { header: "ML C high", key: "mlCHigh", width: 9 },
        { header: "Δ C ML %", key: "mlPctC", width: 9 },
        { header: "Outlier", key: "outlier", width: 8 },
      ];
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).alignment = { vertical: "middle" };
      ws.views = [{ state: "frozen", ySplit: 1 }];

      for (const r of filteredRows) {
        const ml = mlData?.get(r.c.id);
        const mlE = ml?.ok ? ml.E : null;
        const mlC = ml?.ok ? ml.C : null;
        const mlPctE =
          mlE && r.c.factE != null && mlE.med > 0
            ? ((r.c.factE - mlE.med) / mlE.med) * 100
            : null;
        const mlPctC =
          mlC && r.c.factC != null && mlC.med > 0
            ? ((r.c.factC - mlC.med) / mlC.med) * 100
            : null;
        ws.addRow({
          time: orderDateTime(r.c),
          from: r.c.fromAddressGeo || r.c.fromAddress || "",
          to: r.c.toAddressGeo || r.c.toAddress || "",
          km: r.km != null ? Number(r.km.toFixed(2)) : null,
          min: r.min,
          minSrc: r.minSource ?? "",
          demand: r.c.demand ?? "",
          factE: r.c.factE,
          predE: r.prognozE != null ? Number(r.prognozE.toFixed(2)) : null,
          deltaE: r.deltaE != null ? Number(r.deltaE.toFixed(2)) : null,
          pctE: r.pctE != null ? Number(r.pctE.toFixed(1)) : null,
          mlEMed: mlE ? Number(mlE.med.toFixed(2)) : null,
          mlELow: mlE ? Number(mlE.low.toFixed(2)) : null,
          mlEHigh: mlE ? Number(mlE.high.toFixed(2)) : null,
          mlPctE: mlPctE != null ? Number(mlPctE.toFixed(1)) : null,
          factC: r.c.factC,
          predC: r.prognozC != null ? Number(r.prognozC.toFixed(2)) : null,
          deltaC: r.deltaC != null ? Number(r.deltaC.toFixed(2)) : null,
          pctC: r.pctC != null ? Number(r.pctC.toFixed(1)) : null,
          mlCMed: mlC ? Number(mlC.med.toFixed(2)) : null,
          mlCLow: mlC ? Number(mlC.low.toFixed(2)) : null,
          mlCHigh: mlC ? Number(mlC.high.toFixed(2)) : null,
          mlPctC: mlPctC != null ? Number(mlPctC.toFixed(1)) : null,
          outlier: r.isOutlier ? "⚠" : "",
        });
      }
      // Формат для столбца времени — ДД.ММ.ГГГГ ЧЧ:ММ.
      ws.getColumn("time").numFmt = "dd.mm.yyyy hh:mm";

      // Лист с метаданными — модель, фильтры, сводные.
      const meta = wb.addWorksheet("Сводка");
      meta.columns = [
        { header: "Поле", key: "k", width: 28 },
        { header: "Значение", key: "v", width: 50 },
      ];
      meta.getRow(1).font = { bold: true };
      const fmtPct = (x: number | null) =>
        x == null ? "—" : `${(x * 100).toFixed(1)}%`;
      meta.addRows([
        { k: "Экспорт сделан", v: new Date().toLocaleString("ru-RU") },
        { k: "Строк всего на сервере", v: total },
        { k: "Строк после фильтров", v: filteredRows.length },
        { k: "Фильтр: дата с", v: dateFrom || "—" },
        { k: "Фильтр: дата по", v: dateTo || "—" },
        { k: "Фильтр: спрос", v: demandFilter },
        { k: "Фильтр: тариф", v: tariffFilter },
        { k: "OLS модель", v: `n=${modelInfo().n}, MAPE E/C ${(modelInfo().mapeE * 100).toFixed(0)}%/${(modelInfo().mapeC * 100).toFixed(0)}%, обучена ${modelInfo().trainedAt}` },
        { k: "ML версия", v: mlMeta?.modelVersion || "—" },
        { k: "ML calib применена", v: mlMeta?.calibApplied ? "да" : "нет" },
        { k: "ML MAPE E/C (на выборке)", v: `${fmtPct(mlStats?.mapeE ?? null)} / ${fmtPct(mlStats?.mapeC ?? null)}` },
        { k: "ML hit±10 E/C", v: `${fmtPct(mlStats?.hit10E ?? null)} / ${fmtPct(mlStats?.hit10C ?? null)}` },
        { k: "ML in_band E/C", v: `${fmtPct(mlStats?.inBandE ?? null)} / ${fmtPct(mlStats?.inBandC ?? null)}` },
      ]);

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `calib-comparison-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : "Ошибка экспорта");
    } finally {
      setExporting(false);
    }
  }

  // Sprint 3.1: батч-запрос на ML после загрузки items. Один HTTP вместо 1300.
  // Шлём ВСЕ калибровки с валидными координатами (без demand требований —
  // сервер принимает demand:"unknown"). На малых выборках 50 строк ~80мс.
  useEffect(() => {
    if (!open) return;
    if (items.length === 0) {
      setMlData(null);
      setMlMeta(null);
      return;
    }
    const ctl = new AbortController();
    setMlLoading(true);
    setMlErr(null);
    const args: { id: string; req: PriceRangeArgs }[] = [];
    for (const c of items) {
      if (c.fromLat == null || c.fromLng == null || c.toLat == null || c.toLng == null) continue;
      const dt = orderDateTime(c);
      const hour = dt.getHours();
      const jsDow = dt.getDay();
      const dow = (jsDow + 6) % 7; // js (0=Sun) → python (0=Mon)
      const minutes = c.tripMin ?? c.etaMin ?? null;
      // Sprint 4 T02: дата заказа YYYY-MM-DD для is_holiday/day_of_month/is_payday
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      const dateStr = `${yyyy}-${mm}-${dd}`;
      args.push({
        id: c.id,
        req: {
          fromLat: c.fromLat,
          fromLng: c.fromLng,
          toLat: c.toLat,
          toLng: c.toLng,
          hour,
          dow,
          demand: (c.demand as DemandColor) ?? null,
          minutes,
          date: dateStr,
        },
      });
    }
    predictPriceBatch(
      args.map((a) => a.req),
      ctl.signal,
    )
      .then((res: PriceBatchResult | null) => {
        if (ctl.signal.aborted) return;
        if (!res) {
          setMlData(null);
          setMlMeta(null);
          setMlErr("ML-сервис недоступен");
          return;
        }
        const m = new Map<string, PriceBatchItem>();
        for (let i = 0; i < res.results.length; i++) {
          const item = res.results[i];
          const id = args[item.idx]?.id;
          if (id) m.set(id, item);
        }
        setMlData(m);
        setMlMeta({
          modelVersion: res.modelVersion,
          nOk: res.nOk,
          nErr: res.nErr,
          calibApplied: res.calibApplied,
        });
      })
      .catch(() => {
        if (ctl.signal.aborted) return;
        setMlData(null);
        setMlMeta(null);
        setMlErr("Ошибка ML-запроса");
      })
      .finally(() => {
        if (!ctl.signal.aborted) setMlLoading(false);
      });
    return () => {
      ctl.abort();
    };
  }, [open, items]);

  // ML-метрики (по тем же rows, но используя ML-прогнозы вместо v3-OLS).
  // Пропускаем строки где ML не вернул ok-ответ или нет factE/factC.
  // Также — in_band: доля строк где fact ∈ [low, high] (после калибровки).
  const mlStats = useMemo(() => {
    if (!mlData) return null;
    const eApe: number[] = [];
    const cApe: number[] = [];
    let inBandE = 0, inBandC = 0, nBandE = 0, nBandC = 0;
    for (const r of filteredRows) {
      const it = mlData.get(r.c.id);
      if (!it || !it.ok) continue;
      if (it.E && r.c.factE != null && r.c.factE > 0) {
        eApe.push(Math.abs((r.c.factE - it.E.med) / r.c.factE));
        nBandE++;
        if (r.c.factE >= it.E.low && r.c.factE <= it.E.high) inBandE++;
      }
      if (it.C && r.c.factC != null && r.c.factC > 0) {
        cApe.push(Math.abs((r.c.factC - it.C.med) / r.c.factC));
        nBandC++;
        if (r.c.factC >= it.C.low && r.c.factC <= it.C.high) inBandC++;
      }
    }
    const median = (xs: number[]) => {
      if (xs.length === 0) return null;
      const s = [...xs].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };
    const mean = (xs: number[]) =>
      xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
    const hit = (xs: number[], thr: number) =>
      xs.length === 0 ? null : xs.filter((x) => x <= thr).length / xs.length;
    return {
      n: nBandE,
      mapeE: mean(eApe),
      mapeC: mean(cApe),
      medApeE: median(eApe),
      medApeC: median(cApe),
      hit10E: hit(eApe, 0.10),
      hit10C: hit(cApe, 0.10),
      hit25E: hit(eApe, 0.25),
      hit25C: hit(cApe, 0.25),
      inBandE: nBandE > 0 ? inBandE / nBandE : null,
      inBandC: nBandC > 0 ? inBandC / nBandC : null,
    };
  }, [filteredRows, mlData]);

  // Сводная статистика по средней |Δ%| и доле «попаданий» (|Δ%| ≤ 10).
  // Считаем БЕЗ outlier-строк (ratio ∉ [0.5, 2.0]) — иначе один скрин
  // с факт×6 убивает среднюю «точность модели». Outlier'ы показываются
  // отдельным счётчиком + значком ⚠ в строке.
  const stats = useMemo(() => {
    const clean = filteredRows.filter((r) => !r.isOutlier);
    const eVals = clean.map((r) => r.pctE).filter((x): x is number => x != null);
    const cVals = clean.map((r) => r.pctC).filter((x): x is number => x != null);
    const avg = (xs: number[]) =>
      xs.length === 0
        ? null
        : xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length;
    const hits = (xs: number[]) =>
      xs.length === 0
        ? null
        : xs.filter((x) => Math.abs(x) <= 10).length / xs.length;
    return {
      avgE: avg(eVals),
      avgC: avg(cVals),
      hitE: hits(eVals),
      hitC: hits(cVals),
      n: clean.length,
      nOutliers: filteredRows.length - clean.length,
    };
  }, [filteredRows]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-[min(100vw,1200px)] w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] h-[calc(100vh-2rem)] sm:h-[calc(100vh-4rem)] p-0 overflow-hidden flex flex-col"
        data-testid="dialog-admin-calib"
      >
        <DialogHeader className="px-4 py-3 border-b shrink-0">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-base">
              План vs факт по скринам Yandex
            </DialogTitle>
            <div className="flex items-center gap-1.5">
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="text-xs border rounded px-2 h-8"
                data-testid="select-calib-limit"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1"
                onClick={load}
                disabled={loading}
                data-testid="btn-calib-refresh"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Обновить
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1"
                onClick={exportToExcel}
                disabled={exporting || filteredRows.length === 0}
                data-testid="btn-calib-export-xlsx"
                title={
                  filteredRows.length === 0
                    ? "Нет данных для экспорта"
                    : `Скачать ${filteredRows.length} строк в .xlsx`
                }
              >
                {exporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileDown className="h-3.5 w-3.5" />
                )}
                Excel
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={onClose}
                data-testid="btn-calib-close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground mt-1">
            <span>
              Показано: <b>{filteredRows.length}</b>
              {filtersActive && rows.length !== filteredRows.length && (
                <> (из {rows.length} после фильтра)</>
              )}{" "}
              из <b>{total}</b>
            </span>
            <span>·</span>
            <span title={`модель обучена ${modelInfo().trainedAt}`}>
              Модель: n=<b>{modelInfo().n}</b>, MAPE E/C{" "}
              <b>
                {(modelInfo().mapeE * 100).toFixed(0)}%/
                {(modelInfo().mapeC * 100).toFixed(0)}%
              </b>
              , hit±10 E/C{" "}
              <b>
                {Math.round(modelInfo().hit10E * 100)}%/
                {Math.round(modelInfo().hit10C * 100)}%
              </b>
              {" · "}
              {modelInfo().ageDays < 1
                ? "сегодня"
                : `${Math.round(modelInfo().ageDays)} дн назад`}
            </span>
            {stats.n > 0 && (
              <>
                <span>·</span>
                <span>
                  Среднее |Δ| — Эконом{" "}
                  <b
                    className={
                      stats.avgE != null && stats.avgE <= 15
                        ? "text-emerald-700"
                        : "text-amber-700"
                    }
                  >
                    {stats.avgE != null ? `${stats.avgE.toFixed(1)}%` : "—"}
                  </b>
                  , Комфорт{" "}
                  <b
                    className={
                      stats.avgC != null && stats.avgC <= 15
                        ? "text-emerald-700"
                        : "text-amber-700"
                    }
                  >
                    {stats.avgC != null ? `${stats.avgC.toFixed(1)}%` : "—"}
                  </b>
                </span>
                <span>·</span>
                <span>
                  Попадание ±10% — E{" "}
                  <b>
                    {stats.hitE != null
                      ? `${Math.round(stats.hitE * 100)}%`
                      : "—"}
                  </b>{" "}
                  / C{" "}
                  <b>
                    {stats.hitC != null
                      ? `${Math.round(stats.hitC * 100)}%`
                      : "—"}
                  </b>
                </span>
                {stats.nOutliers > 0 && (
                  <>
                    <span>·</span>
                    <span
                      className="text-amber-700"
                      title="Строки с большим расхождением (factE/прогноз вне 0.5–2.0): редкий сильный surge / промо-тариф / баг OCR. Не учитываются в средних, помечены ⚠ в таблице."
                    >
                      ⚠ выбросов: <b>{stats.nOutliers}</b> (исключены)
                    </span>
                  </>
                )}
              </>
            )}
          </div>
          {/* ─── Sprint 3.1: ML CatBoost+H3 метрики ───────────────── */}
          <div
            className="flex flex-wrap items-center gap-1.5 text-[11px] text-emerald-900/90 mt-1 bg-emerald-50/70 border border-emerald-200/60 rounded px-2 py-1"
            data-testid="ml-stats-bar"
          >
            <span className="font-semibold">🧠 ML CatBoost+H3:</span>
            {mlLoading && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                загрузка batch…
              </span>
            )}
            {mlErr && !mlLoading && (
              <span className="text-rose-700">⚠ {mlErr}</span>
            )}
            {!mlLoading && !mlErr && mlMeta && mlStats && mlStats.n > 0 && (
              <>
                <span title={mlMeta.modelVersion}>
                  v{mlMeta.modelVersion.replace(/^catboost-h3-mq-/, "")}
                </span>
                <span>·</span>
                <span>
                  n=<b>{mlStats.n}</b>
                </span>
                <span>·</span>
                <span>
                  MAPE E/C{" "}
                  <b>
                    {mlStats.mapeE != null
                      ? `${(mlStats.mapeE * 100).toFixed(1)}%`
                      : "—"}
                    /
                    {mlStats.mapeC != null
                      ? `${(mlStats.mapeC * 100).toFixed(1)}%`
                      : "—"}
                  </b>
                </span>
                <span>·</span>
                <span title="Медианная относительная ошибка — устойчива к выбросам">
                  med APE{" "}
                  <b>
                    {mlStats.medApeE != null
                      ? `${(mlStats.medApeE * 100).toFixed(1)}%`
                      : "—"}
                    /
                    {mlStats.medApeC != null
                      ? `${(mlStats.medApeC * 100).toFixed(1)}%`
                      : "—"}
                  </b>
                </span>
                <span>·</span>
                <span>
                  hit±10 E/C{" "}
                  <b>
                    {mlStats.hit10E != null
                      ? `${Math.round(mlStats.hit10E * 100)}%`
                      : "—"}
                    /
                    {mlStats.hit10C != null
                      ? `${Math.round(mlStats.hit10C * 100)}%`
                      : "—"}
                  </b>
                </span>
                <span>·</span>
                <span>
                  hit±25 E/C{" "}
                  <b>
                    {mlStats.hit25E != null
                      ? `${Math.round(mlStats.hit25E * 100)}%`
                      : "—"}
                    /
                    {mlStats.hit25C != null
                      ? `${Math.round(mlStats.hit25C * 100)}%`
                      : "—"}
                  </b>
                </span>
                <span>·</span>
                <span
                  title="Доля факт-цен попавших в [P10, P90] после калибровки. Целевой 80%."
                  className={
                    mlStats.inBandE != null && mlStats.inBandE >= 0.7
                      ? ""
                      : "text-amber-700"
                  }
                >
                  in_band E/C{" "}
                  <b>
                    {mlStats.inBandE != null
                      ? `${Math.round(mlStats.inBandE * 100)}%`
                      : "—"}
                    /
                    {mlStats.inBandC != null
                      ? `${Math.round(mlStats.inBandC * 100)}%`
                      : "—"}
                  </b>
                </span>
                {mlMeta.calibApplied && (
                  <>
                    <span>·</span>
                    <span title="quantile_calib.json применена — диапазон расширен под target 80%">
                      🎯 calib
                    </span>
                  </>
                )}
                {mlMeta.nErr > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-amber-700">
                      ⚠ ошибок: <b>{mlMeta.nErr}</b>
                    </span>
                  </>
                )}
              </>
            )}
            {!mlLoading && !mlErr && (!mlMeta || mlStats?.n === 0) && (
              <span className="text-muted-foreground">нет данных</span>
            )}
          </div>
          {/* ─── Плашка slot+weather aware канарейки ─── */}
          {(() => {
            const slotLabel = SLOT_LABEL[trend.slot];
            const wxLabel = trend.isRain ? "дождь" : "сухо";

            // Статусы «нет данных» — серая нейтральная плашка-инфо.
            if (
              trend.status === "no_current" ||
              trend.status === "no_baseline" ||
              trend.status === "not_enough_data"
            ) {
              const reason =
                trend.status === "no_current"
                  ? `нет свежих калибровок (последние ${trend.windowHours}ч)`
                  : trend.status === "no_baseline"
                    ? "нет эталона (мало истории по этому слоту)"
                    : `данных мало: текущих=${trend.currentN}, эталонных=${trend.baselineN}`;
              return (
                <div
                  className="mt-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700"
                  data-testid="yandex-trend-badge"
                >
                  <b>📊 Канарейка тренда:</b> текущий слот —{" "}
                  <b>{slotLabel}, {wxLabel}</b>. Сравнение с прошлыми такими
                  же часами невозможно — {reason}. Прогноз показан
                  «как есть» (без поправки).
                </div>
              );
            }

            const eShift = trend.coefE - 1;
            const cShift = trend.coefC - 1;
            // Триггер «тревоги» — отклонение хотя бы у одного класса > 5%.
            const eOn = Math.abs(eShift) > 0.05;
            const cOn = Math.abs(cShift) > 0.05;
            const isAlert = eOn || cOn;

            const wxNote =
              trend.status === "weather_relaxed"
                ? " (эталон: любая погода — мало записей с такой же)"
                : "";

            // Спокойная инфо-плашка когда канарейка в зелёной зоне.
            if (!isAlert) {
              return (
                <div
                  className="mt-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-900"
                  data-testid="yandex-trend-badge"
                >
                  <b>✓ Канарейка спокойна.</b> Текущий слот —{" "}
                  <b>{slotLabel}, {wxLabel}</b> ({trend.windowHours}ч,
                  n_now={trend.currentN}, n_base={trend.baselineN}
                  {wxNote}). Yandex в этом слоте сегодня не сильно
                  отличается от обычного: ×{trend.coefE.toFixed(2)} E /×
                  {trend.coefC.toFixed(2)} C.
                </div>
              );
            }

            // Тревога — Yandex реально отличается от эталона того же слота.
            const direction = eShift < 0 || cShift < 0 ? "down" : "up";
            const tone =
              direction === "down"
                ? "bg-amber-50 text-amber-900 border-amber-200"
                : "bg-violet-50 text-violet-900 border-violet-200";
            const arrow = direction === "down" ? "📉" : "📈";
            const verb = direction === "down" ? "снизил" : "поднял";
            return (
              <div
                className={`mt-1 rounded border px-2 py-1 text-[11px] ${tone}`}
                data-testid="yandex-trend-badge"
              >
                <b>{arrow} Yandex {verb} цены</b> в текущем слоте{" "}
                <b>{slotLabel}, {wxLabel}</b>:{" "}
                {eOn && (
                  <span>
                    Эконом{" "}
                    <b>
                      {eShift > 0 ? "+" : ""}
                      {Math.round(eShift * 100)}%
                    </b>
                  </span>
                )}
                {eOn && cOn && <span>, </span>}
                {cOn && (
                  <span>
                    Комфорт{" "}
                    <b>
                      {cShift > 0 ? "+" : ""}
                      {Math.round(cShift * 100)}%
                    </b>
                  </span>
                )}
                {" "}(n_now={trend.currentN}, n_base={trend.baselineN}
                {wxNote}). Сравнение like-with-like: те же часы суток,
                тот же тип дня, та же погода — значит это не «утро vs
                вечер», а реальный сдвиг рынка. Канарейка: ×
                {trend.coefE.toFixed(2)} E /×{trend.coefC.toFixed(2)} C —
                если задержится на 2-3 дня, пора переобучить модель.
              </div>
            );
          })()}
        </DialogHeader>

        {/* ─── Плашка состояния пайплайна распознавания ─── */}
        {(pipeline || pipelineErr) && (
          <div className="px-3 py-2 border-b bg-slate-50/60 shrink-0 text-[11px]">
            {pipelineErr && !pipeline && (
              <div className="text-rose-700">
                Не удалось получить статус пайплайна: {pipelineErr}
              </div>
            )}
            {pipeline && (() => {
              // Считаем долю распознанных за 24ч — если меньше 70%, подсветим.
              const u24 = pipeline.last24h.uploaded;
              const okRate =
                u24 > 0 ? pipeline.last24h.ok / u24 : null;
              const stale =
                pipeline.lastSuccessMinAgo != null &&
                pipeline.lastSuccessMinAgo > 60;
              const hasFailed = pipeline.last24h.failed > 0;
              const reasons = Object.entries(pipeline.failedReasons).sort(
                (a, b) => b[1] - a[1],
              );
              const tone =
                stale || (okRate != null && okRate < 0.5)
                  ? "text-rose-700"
                  : okRate != null && okRate < 0.7
                  ? "text-amber-700"
                  : "text-slate-700";
              return (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-slate-700">
                    Пайплайн распознавания:
                  </span>
                  <span className={tone}>
                    24ч — пришло <b>{u24}</b>, распознано{" "}
                    <b>{pipeline.last24h.ok}</b>
                    {okRate != null && (
                      <> ({Math.round(okRate * 100)}%)</>
                    )}
                    , упало <b>{pipeline.last24h.failed}</b>
                  </span>
                  <span>·</span>
                  <span>
                    1ч — пришло <b>{pipeline.last1h.uploaded}</b>, ОК{" "}
                    <b>{pipeline.last1h.ok}</b>, fail{" "}
                    <b>{pipeline.last1h.failed}</b>
                  </span>
                  {pipeline.incomingPending > 0 && (
                    <>
                      <span>·</span>
                      <span>
                        В очереди: <b>{pipeline.incomingPending}</b>
                        {pipeline.oldestPendingMin != null && (
                          <>
                            {" "}
                            (старейший {pipeline.oldestPendingMin} мин назад)
                          </>
                        )}
                      </span>
                    </>
                  )}
                  {pipeline.lastSuccessMinAgo != null && (
                    <>
                      <span>·</span>
                      <span className={stale ? "text-rose-700" : ""}>
                        Последний успех:{" "}
                        <b>{pipeline.lastSuccessMinAgo} мин назад</b>
                      </span>
                    </>
                  )}
                  {hasFailed && reasons.length > 0 && (
                    <>
                      <span>·</span>
                      <span>
                        Причины ошибок:{" "}
                        {reasons.map(([k, v], i) => (
                          <span key={k}>
                            {i > 0 && ", "}
                            <code className="bg-slate-100 px-1 rounded">
                              {k}
                            </code>
                            ×{v}
                          </span>
                        ))}
                      </span>
                    </>
                  )}
                  {pipeline.inFailedRetryable > 0 && (
                    <>
                      <span className="grow" />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] gap-1"
                        onClick={onRequeue}
                        disabled={requeueing}
                        data-testid="btn-requeue-failed"
                      >
                        {requeueing ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCw className="h-3 w-3" />
                        )}
                        Перезапустить failed ({pipeline.inFailedRetryable})
                      </Button>
                    </>
                  )}
                  {requeueMsg && (
                    <div className="basis-full text-[11px] text-slate-600 mt-1">
                      {requeueMsg}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        <div className="flex-1 overflow-auto px-2 sm:px-3 py-2">
          {error && (
            <div className="flex items-center gap-2 text-rose-700 bg-rose-50 px-3 py-2 rounded text-xs mb-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Не удалось загрузить: {error}</span>
            </div>
          )}

          {/* Sprint 4 T04: панель фильтров. Сразу под ошибкой/перед таблицей. */}
          <div
            className="flex flex-wrap items-center gap-1.5 text-[11px] mb-2 px-1"
            data-testid="calib-filters-bar"
          >
            <span className="text-muted-foreground">Фильтры:</span>
            <label className="inline-flex items-center gap-1">
              <span className="text-muted-foreground">с</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="border rounded px-1.5 h-7 text-[11px]"
                data-testid="filter-date-from"
              />
            </label>
            <label className="inline-flex items-center gap-1">
              <span className="text-muted-foreground">по</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="border rounded px-1.5 h-7 text-[11px]"
                data-testid="filter-date-to"
              />
            </label>
            <label className="inline-flex items-center gap-1">
              <span className="text-muted-foreground">спрос</span>
              <select
                value={demandFilter}
                onChange={(e) => setDemandFilter(e.target.value)}
                className="border rounded px-1.5 h-7 text-[11px]"
                data-testid="filter-demand"
              >
                <option value="all">все</option>
                <option value="red">🔴 red</option>
                <option value="yellow">🟡 yellow</option>
                <option value="green">🟢 green</option>
                <option value="unknown">— unknown</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-1">
              <span className="text-muted-foreground">тариф</span>
              <select
                value={tariffFilter}
                onChange={(e) =>
                  setTariffFilter(e.target.value as "all" | "E" | "C")
                }
                className="border rounded px-1.5 h-7 text-[11px]"
                data-testid="filter-tariff"
              >
                <option value="all">оба</option>
                <option value="E">только Эконом</option>
                <option value="C">только Комфорт</option>
              </select>
            </label>
            {filtersActive && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px] gap-1 px-2"
                onClick={resetFilters}
                data-testid="btn-filters-reset"
                title="Сбросить все фильтры"
              >
                <FilterX className="h-3 w-3" />
                сбросить
              </Button>
            )}
            {exportErr && (
              <span className="text-rose-700 ml-auto" data-testid="export-err">
                ⚠ {exportErr}
              </span>
            )}
          </div>

          {!error && filteredRows.length === 0 && !loading && (
            <div className="text-center text-sm text-muted-foreground py-12">
              {filtersActive ? (
                <>
                  Под фильтры ничего не попало.
                  <br />
                  <span className="text-xs">
                    Попробуйте расширить диапазон дат или сбросить фильтры.
                  </span>
                </>
              ) : (
                <>
                  Пока нет распознанных скринов.
                  <br />
                  <span className="text-xs">
                    Загрузите скрины Yandex Go в «📷 Мои поездки» — обработка
                    идёт автоматически каждые 5 минут.
                  </span>
                </>
              )}
            </div>
          )}

          {filteredRows.length > 0 && (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground border-b">
                  <th className="px-2 py-1.5 font-semibold">Время</th>
                  <th className="px-2 py-1.5 font-semibold">Маршрут А → Б</th>
                  <th
                    className="px-2 py-1.5 font-semibold text-right"
                    title="Минуты поездки (приоритет — со скрина Yandex, иначе наша оценка из км). Серый = оценка, чёрный = реальная цифра со скрина."
                  >
                    мин
                  </th>
                  <th className="px-2 py-1.5 font-semibold text-right border-l">
                    Факт E
                  </th>
                  <th className="px-2 py-1.5 font-semibold text-right">
                    Прогноз E
                  </th>
                  <th className="px-2 py-1.5 font-semibold text-right">Δ E</th>
                  <th
                    className="px-2 py-1.5 font-semibold text-right border-l border-emerald-300/60 bg-emerald-50/40"
                    title="ML CatBoost+H3 medianny прогноз Эконом (с указанием диапазона P10..P90 после калибровки)"
                  >
                    🧠 ML E
                  </th>
                  <th
                    className="px-2 py-1.5 font-semibold text-right bg-emerald-50/40"
                    title="(Факт E - ML med E) / ML med E"
                  >
                    Δ E ML
                  </th>
                  <th className="px-2 py-1.5 font-semibold text-right border-l">
                    Факт C
                  </th>
                  <th className="px-2 py-1.5 font-semibold text-right">
                    Прогноз C
                  </th>
                  <th className="px-2 py-1.5 font-semibold text-right">Δ C</th>
                  <th
                    className="px-2 py-1.5 font-semibold text-right border-l border-emerald-300/60 bg-emerald-50/40"
                    title="ML CatBoost+H3 medianny прогноз Комфорт"
                  >
                    🧠 ML C
                  </th>
                  <th
                    className="px-2 py-1.5 font-semibold text-right bg-emerald-50/40"
                    title="(Факт C - ML med C) / ML med C"
                  >
                    Δ C ML
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr
                    key={r.c.id}
                    className={`border-b hover:bg-slate-50/60 align-top ${r.isOutlier ? "bg-amber-50/40" : ""}`}
                    data-testid={`row-calib-${r.c.id}`}
                  >
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full ${demandDot(r.c.demand)}`}
                          title={`Спрос: ${r.c.demand ?? "?"}`}
                        />
                        {r.isOutlier && (
                          <span
                            title={`Сильное расхождение: factE/raw=${r.prognozRawE && r.c.factE ? (r.c.factE / r.prognozRawE).toFixed(2) : "?"}, factC/raw=${r.prognozRawC && r.c.factC ? (r.c.factC / r.prognozRawC).toFixed(2) : "?"}. Возможные причины: редкий surge × N, промо-тариф, баг распознавания скрина. Исключено из расчёта средних и из обучения модели.`}
                            data-testid={`outlier-${r.c.id}`}
                            className="inline-flex"
                          >
                            <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0" />
                          </span>
                        )}
                        <span>{fmtTime(r.c.receivedAt)}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <div
                        className="font-medium leading-tight"
                        title={
                          r.c.fromAddressGeo && r.c.fromAddress &&
                          r.c.fromAddressGeo !== r.c.fromAddress
                            ? `со скрина: ${r.c.fromAddress}`
                            : undefined
                        }
                      >
                        {r.c.fromAddressGeo || r.c.fromAddress || "—"}
                      </div>
                      <div
                        className="text-muted-foreground leading-tight text-[11px]"
                        title={
                          r.c.toAddressGeo && r.c.toAddress &&
                          r.c.toAddressGeo !== r.c.toAddress
                            ? `со скрина: ${r.c.toAddress}`
                            : undefined
                        }
                      >
                        → {r.c.toAddressGeo || r.c.toAddress || "—"}
                      </div>
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        r.minSource === "screen"
                          ? "text-slate-900 font-medium"
                          : "text-muted-foreground italic"
                      }`}
                      title={
                        r.km != null
                          ? `по прямой ≈ ${r.km.toFixed(1)} км · ${
                              r.minSource === "screen"
                                ? "минуты со скрина Yandex"
                                : "минуты — наша оценка из км (со скрина не пришли)"
                            }`
                          : undefined
                      }
                    >
                      {r.min != null ? r.min : "—"}
                    </td>

                    <td className="px-2 py-1.5 text-right tabular-nums font-medium border-l">
                      {fmtMoney(r.c.factE)}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right tabular-nums text-muted-foreground"
                      title={
                        r.surgeE != null
                          ? `прогноз ⚡E ${r.surgeE.toFixed(2)} (${r.surgeSource ?? "?"})`
                          : undefined
                      }
                    >
                      <div>{fmtMoney(r.prognozE)}</div>
                      {r.surgeE != null && (
                        <div className="text-[10px] opacity-60">
                          ⚡{r.surgeE.toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded ${pctColor(r.pctE)}`}
                      >
                        {fmtDelta(r.deltaE)}{" "}
                        <span className="opacity-70">{fmtPct(r.pctE)}</span>
                      </span>
                    </td>
                    {(() => {
                      const ml = mlData?.get(r.c.id);
                      const mlE = ml?.ok ? ml.E : null;
                      const mlPctE =
                        mlE && r.c.factE != null && mlE.med > 0
                          ? ((r.c.factE - mlE.med) / mlE.med) * 100
                          : null;
                      return (
                        <>
                          <td
                            className="px-2 py-1.5 text-right tabular-nums text-emerald-900 border-l border-emerald-200/60 bg-emerald-50/30"
                            title={
                              mlE
                                ? `диапазон P10..P90: ${mlE.low.toFixed(2)}…${mlE.high.toFixed(2)} BYN`
                                : ml?.error || "ML недоступен"
                            }
                          >
                            {mlE ? (
                              <>
                                <div className="font-medium">
                                  {fmtMoney(mlE.med)}
                                </div>
                                <div className="text-[10px] opacity-70">
                                  {mlE.low.toFixed(1)}…{mlE.high.toFixed(1)}
                                </div>
                              </>
                            ) : mlLoading ? (
                              <span className="text-muted-foreground">…</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums bg-emerald-50/30">
                            {mlPctE != null ? (
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded ${pctColor(mlPctE)}`}
                              >
                                {fmtPct(mlPctE)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </>
                      );
                    })()}

                    <td className="px-2 py-1.5 text-right tabular-nums font-medium border-l">
                      {fmtMoney(r.c.factC)}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right tabular-nums text-muted-foreground"
                      title={
                        r.surgeC != null
                          ? `прогноз ⚡C ${r.surgeC.toFixed(2)} (${r.surgeSource ?? "?"})`
                          : undefined
                      }
                    >
                      <div>{fmtMoney(r.prognozC)}</div>
                      {r.surgeC != null && (
                        <div className="text-[10px] opacity-60">
                          ⚡{r.surgeC.toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded ${pctColor(r.pctC)}`}
                      >
                        {fmtDelta(r.deltaC)}{" "}
                        <span className="opacity-70">{fmtPct(r.pctC)}</span>
                      </span>
                    </td>
                    {(() => {
                      const ml = mlData?.get(r.c.id);
                      const mlC = ml?.ok ? ml.C : null;
                      const mlPctC =
                        mlC && r.c.factC != null && mlC.med > 0
                          ? ((r.c.factC - mlC.med) / mlC.med) * 100
                          : null;
                      return (
                        <>
                          <td
                            className="px-2 py-1.5 text-right tabular-nums text-emerald-900 border-l border-emerald-200/60 bg-emerald-50/30"
                            title={
                              mlC
                                ? `диапазон P10..P90: ${mlC.low.toFixed(2)}…${mlC.high.toFixed(2)} BYN`
                                : ml?.error || "ML недоступен"
                            }
                          >
                            {mlC ? (
                              <>
                                <div className="font-medium">
                                  {fmtMoney(mlC.med)}
                                </div>
                                <div className="text-[10px] opacity-70">
                                  {mlC.low.toFixed(1)}…{mlC.high.toFixed(1)}
                                </div>
                              </>
                            ) : mlLoading ? (
                              <span className="text-muted-foreground">…</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums bg-emerald-50/30">
                            {mlPctC != null ? (
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded ${pctColor(mlPctC)}`}
                              >
                                {fmtPct(mlPctC)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </>
                      );
                    })()}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t px-3 py-2 text-[10px] text-muted-foreground shrink-0 space-y-1.5">
          <div>
            <Badge variant="outline" className="mr-1.5 text-[10px]">
              прогноз = OLS(km, km², час, demand) — обучено на скринах Yandex
            </Badge>
            Data-driven линейная регрессия: коэфы подобраны методом наименьших
            квадратов из 200+ калибровок (см. шапку). Фичи — длина по прямой,
            её квадрат, час суток (sin/cos) и цвет ⚡ на скрине (red/yellow/green).
            мин — справочно: реальное время со скрина (чёрным) или оценка из км
            (серым); в формуле НЕ участвуют. ⚡ в колонке — прогноз сёрджа из
            старой зональной модели для отладки, тоже не в формуле. Yandex-trend
            (плашка вверху) — медиана factE/прогноз за 24ч; если уехал от 1.0
            значит модель устарела, переобучите: <code>node scripts/train-from-calibs.mjs</code>.
            Δ показывает, насколько наша модель промахнулась относительно
            фактической цены Yandex.
            <span className="ml-2">
              Цвет Δ:{" "}
              <span className="text-emerald-700">≤10% хорошо</span> ·{" "}
              <span className="text-amber-700">≤25% средне</span> ·{" "}
              <span className="text-rose-700">&gt;25% сильное расхождение</span>
            </span>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded px-2 py-1 text-blue-900/90">
            <b>⚠ Это сверка модели прогноза цены маршрута A→B</b>, а не
            модели карты. На карте сёрдж в каждом гексе считается{" "}
            <b>трёхслойно</b>: зональный прогноз × Yandex-trend24h ×
            live-overlay (свежие скрины &lt;6ч в радиусе ~0.7 км). Поэтому
            аномалии ниже могут уже быть «исправлены» на карте — если в их
            гексе есть свежие наблюдения, карта покажет фактический surge, а
            не OLS-прогноз. Полное описание методики карты — кнопка{" "}
            <i>Methodology</i> на главной.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
