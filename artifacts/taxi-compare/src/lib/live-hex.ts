// Загрузка и интерпретация «живых» сот Яндекса из tariff-breakdown.json.
//
// Серверная пайплайн раз в 5 минут (cron, см. /opt/rwbtaxi-screens/process-screens.mjs)
// перемалывает свежие OCR-распознанные скриншоты Yandex Go и сохраняет:
//   - baseline.econom / baseline.comfort — глобальная регрессия
//     {base, perMin}: голая цена без сёрджа на T минут трипа
//   - byHour[0..23] — почасовой профиль среднего сёрджа за всё время
//   - liveHex — карта свежих сот за последние liveWindowHours (=6ч),
//     ключ "{lat100}:{lon100}" (округление координат до 0.01°), значение
//     {lat, lon, n, nE, nC, surgeE, surgeC, ageMinM, ageMaxM, ...}.
//
// Этот модуль:
//   1) умеет загрузить и кэшировать JSON;
//   2) знает как развернуть ключ соты в прямоугольник 0.01°×0.01°;
//   3) считает «цены сейчас» по бакетам короткая/средняя/длинная для каждой
//      соты — формула цена = (base + perMin·tripMin) × surge;
//   4) генерирует короткое человеко-читаемое объяснение «почему такой тариф»,
//      сравнивая сёрдж соты со среднечасовым профилем + учитывая возраст
//      и количество наблюдений.

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

/**
 * Одна исходная калибровка (скриншот), участвовавшая в усреднении соты.
 * Нужно для перепроверки: тапнул на превью — открыл оригинальный скрин из
 * Yandex Go, видишь те же цены, ту же точку А, тот же сёрдж.
 */
export type LiveHexCalib = {
  /** ID калибровки = имя файла без расширения, напр. "calib-2026-04-30-h00-1233b2" */
  id: string;
  /** Расширение скрина с точкой: ".png" / ".jpg" / ".jpeg" / ".webp" */
  ext: string;
  /** Время калибровки, мс с эпохи (берём из имени файла, точность ±30 мин) */
  tsMs: number;
  /** Цена эконом-класса на скрине, BYN (если распознано) */
  priceE?: number;
  /** Цена комфорт-класса на скрине, BYN (если распознано) */
  priceC?: number;
  /** Адрес точки А с этого скрина (улица + дом) */
  fromAddr?: string;
};

export type LiveHex = {
  /** Ключ "{round(lat*100)}:{round(lon*100)}" — например "5389:2755" */
  id: string;
  /** Центр соты, °N (округлено до 0.01) */
  lat: number;
  /** Центр соты, °E (округлено до 0.01) */
  lon: number;
  /** Всего калибровок в соте за окно (последние liveWindowHours) */
  n: number;
  /** Калибровок класса «эконом» */
  nE: number;
  /** Калибровок класса «комфорт» */
  nC: number;
  /** Сёрдж эконома (отношение факт/baseline). 1.0 = базовый тариф */
  surgeE: number;
  /** Сёрдж комфорта */
  surgeC: number;
  /** Возраст самой свежей калибровки в соте, минут */
  ageMinM: number;
  /** Возраст самой старой калибровки в соте, минут */
  ageMaxM: number;
  /**
   * До 8 свежих скринов из этой соты — для перепроверки коэффициентов в
   * попапе. Серверный билдер уже отсортировал по убыванию tsMs и обогатил
   * расширением картинки. Скрины публично доступны через nginx-alias по
   * пути `/data/screens/<id><ext>`. См. {@link screenshotUrl}.
   */
  calibs?: LiveHexCalib[];
};

/**
 * URL исходного скрина для тапа в попапе соты. Серверный билдер
 * (`build-tariff-breakdown.mjs`) проверяет существование файла на диске
 * прежде чем включить calib в выдачу, поэтому 404 здесь — редкий
 * edge-case (файл удалён руками между генерацией JSON и кликом).
 */
export function screenshotUrl(calib: LiveHexCalib): string {
  return `${BASE}/data/screens/${calib.id}${calib.ext}`;
}

export type Baseline = {
  base: number;
  perMin: number;
  /**
   * Цена за километр (BYN/км). Введено в гибридной 2-факторной OLS:
   *   factE = base + perMin·tripMin + perKm·tripKm.
   * До v19 регрессия была однофакторной (perKm подразумевался ≈ 0). Поле
   * опциональное для обратной совместимости со старыми JSON: если отсутствует,
   * считаем 0 и формула вырождается в старую `base + perMin·t`.
   */
  perKm?: number;
  /** R² подгонки (доля объяснённой дисперсии). 0..1. */
  r2?: number;
  /** Mean Absolute Percentage Error по обучающей выборке. 0..1. */
  mape?: number;
  /** Сколько калибровок участвовало в регрессии (для отображения «доверия»). */
  n?: number;
  /**
   * true, если 2-факторная регрессия выродилась (singular / отрицательный perKm)
   * и мы откатились на 1-факторную. Это сигнал «доверять perKm нельзя, его нет».
   */
  fallback?: boolean;
};

export type ByHourEntry = {
  hour: number;
  n: number;
  shrunken?: number;
  surgeE?: number;
  surgeC?: number;
};

export type TariffBreakdown = {
  version?: number;
  generatedAt?: string;
  baseline: { econom: Baseline; comfort: Baseline };
  byHour?: ByHourEntry[];
  liveHex: Record<string, Omit<LiveHex, "id">>;
  liveWindowHours?: number;
};

/** Бакет «типичный трип» для расчёта цены по соте. */
export type TripBucket = {
  id: "short" | "medium" | "long";
  /** Подпись для UI */
  label: string;
  /** Типичная длина по городу, км — только для подписи */
  approxKm: number;
  /** Длительность трипа в минутах — это и есть `tripMin` в формуле */
  tripMin: number;
};

/**
 * Базовые ориентиры для коротких/средних/длинных поездок по Минску.
 * Цифры выбраны из распределения наших же калибровок (`baseline.econom.n=314`):
 * медиана трипа ≈ 12 мин (≈6 км по среднеминскому трафику ~30 км/ч),
 * 25-й перцентиль ≈ 5 мин, 75-й ≈ 25 мин.
 */
export const TRIP_BUCKETS: TripBucket[] = [
  { id: "short", label: "Короткая", approxKm: 2, tripMin: 5 },
  { id: "medium", label: "Средняя", approxKm: 6, tripMin: 12 },
  { id: "long", label: "Длинная", approxKm: 12, tripMin: 25 },
];

let _cached: { data: TariffBreakdown; loadedAt: number } | null = null;

/** Сбросить кэш — для ручного refresh. */
export function clearTariffBreakdownCache(): void {
  _cached = null;
}

/**
 * Загружает /data/tariff-breakdown.json. Кэширует в памяти на 60 секунд,
 * чтобы при открытии модалки + одновременном hover'е не дёргать сеть лишний раз.
 * При этом в URL добавляем ?t=<minute> чтобы CDN/браузер не возвращал
 * протухший вариант (JSON обновляется на VPS раз в 5 минут).
 */
export async function loadTariffBreakdown(): Promise<TariffBreakdown> {
  const now = Date.now();
  if (_cached && now - _cached.loadedAt < 60_000) {
    return _cached.data;
  }
  const minuteBust = Math.floor(now / 60_000);
  const url = `${BASE}/data/tariff-breakdown.json?t=${minuteBust}`;
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`tariff-breakdown.json HTTP ${res.status}`);
  }
  const data = (await res.json()) as TariffBreakdown;
  _cached = { data, loadedAt: now };
  return data;
}

/** Развернуть карту liveHex из JSON в массив с инжектированным `id`. */
export function liveHexesFromBreakdown(b: TariffBreakdown): LiveHex[] {
  if (!b?.liveHex) return [];
  return Object.entries(b.liveHex).map(([id, h]) => ({ id, ...h }));
}

/**
 * Геометрия соты — мы используем равномерные 0.01° × 0.01° квадраты
 * (так как ключи в JSON именно `round(lat*100):round(lon*100)`).
 * Возвращает [[south,west],[north,east]] для leaflet `Rectangle`.
 */
export function hexBounds(
  hex: { lat: number; lon: number },
): [[number, number], [number, number]] {
  const half = 0.005;
  return [
    [hex.lat - half, hex.lon - half],
    [hex.lat + half, hex.lon + half],
  ];
}

/**
 * Цвет соты по сёрджу. Шкала ориентирована на эконом-класс — он более
 * волатилен и интересен для водителей. Совпадает с цветовой логикой
 * демонстрации сёрджа в админке.
 */
export function hexFillColor(surge: number): {
  fill: string;
  stroke: string;
  opacity: number;
  label: string;
} {
  if (surge < 0.95) {
    return { fill: "#3b82f6", stroke: "#2563eb", opacity: 0.45, label: "Скидка" };
  }
  if (surge < 1.05) {
    return { fill: "#10b981", stroke: "#059669", opacity: 0.45, label: "База" };
  }
  if (surge < 1.15) {
    return { fill: "#facc15", stroke: "#ca8a04", opacity: 0.5, label: "Повышенный" };
  }
  if (surge < 1.3) {
    return { fill: "#f97316", stroke: "#ea580c", opacity: 0.55, label: "Высокий" };
  }
  return { fill: "#ef4444", stroke: "#dc2626", opacity: 0.65, label: "Пик" };
}

/**
 * Голая цена за трип в гибридной 2-факторной модели:
 *   price = (base + perMin·tripMin + perKm·approxKm) × surge,
 * округлённая до 0.10 BYN (Yandex Go обычно показывает с шагом 0.10).
 *
 * Если в baseline нет perKm (старый JSON v18 или regression.fallback=true) —
 * вырождаемся в однофакторную формулу (perKm·км = 0).
 *
 * Это лечит систематическую недооценку длинных поездок: до гибрида в сегменте
 * 30+ мин × 7-15 км промах был ~+80%, после — ~+15% (см. анализ калибровок).
 */
export function priceFor(
  baseline: Baseline,
  bucket: TripBucket,
  surge: number,
): number {
  const raw =
    (baseline.base +
      baseline.perMin * bucket.tripMin +
      (baseline.perKm ?? 0) * bucket.approxKm) *
    surge;
  return Math.round(raw * 10) / 10;
}

export type ExplanationLevel = "info" | "warn";
export type Explanation = { level: ExplanationLevel; text: string };

/**
 * Сгенерировать список «почему такой тариф» — короткие предложения
 * на русском, в порядке важности. Используется в попапе соты.
 *
 * Логика:
 *   - сравнение сёрджа эконома с шкалой (база / повышен / пик);
 *   - сравнение со среднечасовым шрункенным профилем — насколько
 *     больше/меньше обычного для этого часа;
 *   - надёжность: если в соте n<3 — флажок «мало наблюдений»;
 *   - свежесть: если самая свежая старше 60 мин — флажок «данные стынут».
 */
export function explainHex(
  hex: LiveHex,
  byHourEntry: ByHourEntry | null,
  hourNow: number,
): Explanation[] {
  const out: Explanation[] = [];
  const sE = hex.surgeE;

  if (sE >= 1.3) {
    out.push({
      level: "warn",
      text: `Пиковая цена (×${sE.toFixed(2)}) — острый дефицит водителей в районе.`,
    });
  } else if (sE >= 1.15) {
    out.push({
      level: "warn",
      text: `Высокий спрос (×${sE.toFixed(2)}) — заказов больше, чем свободных машин.`,
    });
  } else if (sE >= 1.05) {
    out.push({
      level: "info",
      text: `Лёгкое повышение (×${sE.toFixed(2)}) — обычная картина для часа пик.`,
    });
  } else if (sE >= 0.95) {
    out.push({
      level: "info",
      text: `Базовый тариф (×${sE.toFixed(2)}) — спрос и предложение в равновесии.`,
    });
  } else {
    out.push({
      level: "info",
      text: `Понижено (×${sE.toFixed(2)}) — водителей больше, чем заказов.`,
    });
  }

  // Сравнение с «обычным» сёрджем для этого часа (ставит в контекст).
  const ref = byHourEntry?.shrunken ?? byHourEntry?.surgeE ?? null;
  if (ref && ref > 0) {
    const dev = sE / ref;
    const pct = Math.round(Math.abs(dev - 1) * 100);
    if (dev >= 1.15) {
      out.push({
        level: "warn",
        text: `Это на ${pct}% выше обычного для ${hourNow}:00 (типичный сёрдж в этот час ×${ref.toFixed(2)}).`,
      });
    } else if (dev <= 0.9) {
      out.push({
        level: "info",
        text: `Это на ${pct}% ниже обычного для ${hourNow}:00 (типичный сёрдж в этот час ×${ref.toFixed(2)}).`,
      });
    } else {
      out.push({
        level: "info",
        text: `Близко к обычному для ${hourNow}:00 (типичный сёрдж ×${ref.toFixed(2)}).`,
      });
    }
  }

  // Надёжность: малое n + старые данные.
  if (hex.n < 3) {
    out.push({
      level: "warn",
      text: `Мало наблюдений в соте (${hex.n} скрин${hex.n === 1 ? "" : "ов"}) — оценка приблизительная, могут быть выбросы.`,
    });
  }
  if (hex.ageMinM > 60) {
    const ageH = (hex.ageMinM / 60).toFixed(1);
    out.push({
      level: "warn",
      text: `Самые свежие данные в соте — ${ageH} ч назад. Возможно, ситуация уже изменилась.`,
    });
  } else if (hex.ageMinM < 15) {
    out.push({
      level: "info",
      text: `Свежие данные — последний скрин ${hex.ageMinM} мин назад.`,
    });
  }

  return out;
}
