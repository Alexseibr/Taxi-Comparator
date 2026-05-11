// Тонкий клиент к FastAPI ML-сервису (`/opt/rwbtaxi-newstat-ml` на VPS, порт 3013).
// На бэке есть несколько endpoint-ов которые читает screen-receiver, но они же
// нужны фронту для админ-виджетов. Nginx проксирует `/api/ml/* → :3013/*` и
// инжектит X-Shared-Secret сам — поэтому фронт ходит без секрета.
//
// Эндпойнты:
//   /routes/errors    — per-pair MAPE (ошибка модели), ключ "{anchorIdA}__{anchorIdB}"
//   /routes/coverage  — матрица 24×7 «сколько калибровок в этом слоте» (час × dow)
//   /orders/distribution — пропорции коротких/средних/длинных поездок (исп. сервер для квот)

function mlBase(): string {
  // Локальный dev — у нас нет ML, отдадим заведомо несуществующий префикс,
  // чтобы fetch упал быстро и виджет показал пустое состояние.
  if (typeof window === "undefined") return "/api/ml";
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0") return "/api/ml";
  return `${window.location.origin}/api/ml`;
}

export type MlPairError = {
  /** Уникальный ключ пары — "{anchorIdA}__{anchorIdB}". Раскрывается красиво в UI. */
  key: string;
  /** Сколько калибровок попало в эту пару. Минимум 5 (фильтр на стороне ML). */
  n: number;
  /** MAPE по эконом-классу, доля 0..1 (0.42 = 42% ошибки). Главная метрика «плохости» пары. */
  mapeE: number;
  /** MAPE по комфорт-классу, для сравнения. */
  mapeC: number;
  /** Тот же MAPE-эконом в процентах (0..100), как Python считает — для прямого вывода. */
  mapePct: number;
  /** Последняя свежая калибровка, ISO-строка. Стареющие пары важно докалибровать. */
  lastSeenIso: string;
};

export type MlErrorsResponse = {
  generatedAt: string;
  nCalibsTotal: number;
  nCalibsMatched: number;
  nPairs: number;
  pairs: MlPairError[];
};

/** Тянем pair-MAPE и сразу превращаем dict в массив, отсортированный по убыванию ошибки. */
export async function fetchRouteErrors(): Promise<MlErrorsResponse | null> {
  try {
    const res = await fetch(`${mlBase()}/routes/errors`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      generatedAt?: string;
      nCalibsTotal?: number;
      nCalibsMatched?: number;
      nPairs?: number;
      pairs?: Record<
        string,
        {
          n?: number;
          mapeE?: number;
          mapeC?: number;
          mapePct?: number;
          lastSeenIso?: string;
        }
      >;
    };
    const pairsObj = json.pairs ?? {};
    const pairs: MlPairError[] = Object.entries(pairsObj)
      .map(([key, v]) => ({
        key,
        n: typeof v.n === "number" ? v.n : 0,
        mapeE: typeof v.mapeE === "number" ? v.mapeE : 0,
        mapeC: typeof v.mapeC === "number" ? v.mapeC : 0,
        mapePct: typeof v.mapePct === "number" ? v.mapePct : 0,
        lastSeenIso: typeof v.lastSeenIso === "string" ? v.lastSeenIso : "",
      }))
      .sort((a, b) => b.mapeE - a.mapeE);
    return {
      generatedAt: json.generatedAt ?? "",
      nCalibsTotal: json.nCalibsTotal ?? 0,
      nCalibsMatched: json.nCalibsMatched ?? 0,
      nPairs: json.nPairs ?? pairs.length,
      pairs,
    };
  } catch {
    return null;
  }
}

export type MlCoverageCell = {
  hour: number;   // 0..23
  dow: number;    // 0..6 (0 = пн в нашей конвенции; см. Python-сторону)
  n: number;      // всего калибровок в этом слоте
  nRed: number;   // помеченные как «плохие» (большая ошибка модели)
  nYellow: number;
  nGreen: number; // «хорошие», точное совпадение факт vs модель
  nUnknown: number;
};

export type MlCoverageResponse = {
  generatedAt: string;
  byHourDow: MlCoverageCell[]; // ровно 24*7=168 ячеек
};

export async function fetchCoverage(): Promise<MlCoverageResponse | null> {
  try {
    const res = await fetch(`${mlBase()}/routes/coverage`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      generatedAt?: string;
      byHourDow?: Array<Partial<MlCoverageCell>>;
    };
    const arr = Array.isArray(json.byHourDow) ? json.byHourDow : [];
    const cells: MlCoverageCell[] = arr.map((c) => ({
      hour: typeof c.hour === "number" ? c.hour : 0,
      dow: typeof c.dow === "number" ? c.dow : 0,
      n: typeof c.n === "number" ? c.n : 0,
      nRed: typeof c.nRed === "number" ? c.nRed : 0,
      nYellow: typeof c.nYellow === "number" ? c.nYellow : 0,
      nGreen: typeof c.nGreen === "number" ? c.nGreen : 0,
      nUnknown: typeof c.nUnknown === "number" ? c.nUnknown : 0,
    }));
    return {
      generatedAt: json.generatedAt ?? "",
      byHourDow: cells,
    };
  } catch {
    return null;
  }
}

// ───────────── /version, /metrics/history, /runs (для A/B сравнения) ─────────────
// Используются виджетом AdminModelABCompare. На бэке всё уже есть, фронт
// только агрегирует «активная vs baseline» и «текущий run vs предыдущий».

export type MlVersion = {
  modelVersion: string;
  activeModelVersion: string;
  activeSource: string;
  activePairModelPath: string;
  activePairModelPresent: boolean;
};

export async function fetchMlVersion(): Promise<MlVersion | null> {
  try {
    const res = await fetch(`${mlBase()}/version`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    return {
      modelVersion: String(j.model_version ?? ""),
      activeModelVersion: String(j.active_model_version ?? ""),
      activeSource: String(j.active_source ?? ""),
      activePairModelPath: String(j.active_pair_model_path ?? ""),
      activePairModelPresent: Boolean(j.active_pair_model_present),
    };
  } catch {
    return null;
  }
}

/** Один snapshot из /metrics/history — переобучение price-модели (CatBoost+H3). */
export type MlPriceSnapshot = {
  ts: string;            // ISO
  snapshot: string;      // 20260502_180504
  status: string;        // OK / FAIL
  nCalibs: number;       // сколько калибровок участвовало
  nTrainRows: number;
  /** Baseline эвристика «как было до ML» — нужно для A/B. */
  mapeEOld: number;
  /** Новая модель которую только что обучили. */
  mapeENew: number;
  /** Сейчас активная (могла отличаться если new провалила QA). */
  mapeEActive: number;
  mapeCOld: number;
  mapeCNew: number;
  mapeCActive: number;
  modelVersion: string;
  trainedAt: string;
};

export type MlPriceHistory = {
  items: MlPriceSnapshot[];
  nTotal: number;
};

export async function fetchMlPriceHistory(
  limit = 50,
): Promise<MlPriceHistory | null> {
  try {
    const res = await fetch(`${mlBase()}/metrics/history?limit=${limit}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { items?: any[]; n_total?: number };
    const arr = Array.isArray(j.items) ? j.items : [];
    const items: MlPriceSnapshot[] = arr.map((it: any) => ({
      ts: String(it.ts ?? ""),
      snapshot: String(it.snapshot ?? ""),
      status: String(it.status ?? ""),
      nCalibs: Number(it.n_calibs) || 0,
      nTrainRows: Number(it.n_train_rows) || 0,
      mapeEOld: Number(it.mape_e_old) || 0,
      mapeENew: Number(it.mape_e_new) || 0,
      mapeEActive: Number(it.mape_e_active) || 0,
      mapeCOld: Number(it.mape_c_old) || 0,
      mapeCNew: Number(it.mape_c_new) || 0,
      mapeCActive: Number(it.mape_c_active) || 0,
      modelVersion: String(it.model_version ?? ""),
      trainedAt: String(it.trained_at ?? ""),
    }));
    return { items, nTotal: Number(j.n_total) || items.length };
  } catch {
    return null;
  }
}

/** Один тренировочный прогон fraud-модели (supervised / weak_supervised). */
export type MlFraudRun = {
  runId: number;
  modelType: string;          // supervised | weak_supervised
  entityType: string;         // pair | client | driver
  modelVersion: string;       // sv_20260501_200318
  status: string;             // success | failed
  rowsCount: number;
  positiveCount: number;
  negativeCount: number;
  nTrain: number;
  nTest: number;
  /** Метрики из cross-validation. Все в виде числа 0..1. */
  auc: number | null;
  prAuc: number | null;
  accuracy: number | null;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  /** Top-N важных признаков (в порядке убывания). Для diff между моделями. */
  topFeatures: { name: string; importance: number }[];
};

export async function fetchMlRuns(limit = 20): Promise<MlFraudRun[] | null> {
  try {
    const res = await fetch(`${mlBase()}/runs?limit=${limit}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { items?: any[] };
    const arr = Array.isArray(j.items) ? j.items : [];
    return arr.map((it: any) => {
      const num = (v: unknown): number | null => {
        if (v === null || v === undefined || v === "") return null;
        const n = typeof v === "string" ? parseFloat(v) : Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const tf = Array.isArray(it.top_features) ? it.top_features : [];
      return {
        runId: Number(it.run_id) || 0,
        modelType: String(it.model_type ?? ""),
        entityType: String(it.entity_type ?? ""),
        modelVersion: String(it.model_version ?? ""),
        status: String(it.status ?? ""),
        rowsCount: Number(it.rows_count) || 0,
        positiveCount: Number(it.positive_count) || 0,
        negativeCount: Number(it.negative_count) || 0,
        nTrain: Number(it.n_train) || 0,
        nTest: Number(it.n_test) || 0,
        auc: num(it.auc),
        prAuc: num(it.pr_auc),
        accuracy: num(it.accuracy),
        precision: num(it.precision_score),
        recall: num(it.recall),
        f1: num(it.f1_score),
        topFeatures: tf.map((f: any) => ({
          name: String(f.name ?? ""),
          importance: Number(f.importance) || 0,
        })),
      };
    });
  } catch {
    return null;
  }
}

/**
 * Превращаем технический ключ пары "nemiga__pervomayskaya" в человекочитаемое
 * "Немига → Первомайская". Фронту имена якорей напрямую не доступны (ML-сторона
 * не отдаёт справочник), поэтому делаем мягкую транслитерацию:
 *   - underscore-id → kebab-case → строчная транслитерация → Капитализация слов.
 * Если ничего не нашли — отдаём оригинал как есть (лучше технический id чем пусто).
 */
export function prettifyPairKey(key: string): { from: string; to: string } {
  const [a = "", b = ""] = key.split("__");
  return { from: prettifyAnchorId(a), to: prettifyAnchorId(b) };
}

/**
 * Словарь slug → русское имя. Сгенерирован один раз из anchors-minsk.json
 * (79 точек на момент 2026-05-02). Если в anchors добавили новые точки —
 * fallback ниже всё равно даст человекочитаемое (хоть и ASCII) имя.
 *
 * Почему словарь, а не передача с сервера: ML на VPS отдаёт ключ
 * "{slugA}__{slugB}" без названий. Чтобы сервер начал отдавать имена,
 * нужна правка FastAPI + миграция формата ответа — это на следующую итерацию.
 */
const ANCHOR_NAMES: Record<string, string> = {
  "airport-minsk2": "Аэропорт Минск-2",
  "akademiya-nauk": "Академия Наук",
  "ambulatoryya-parkovaya-ulica-10": "Амбулаторыя",
  "avtovokzal-vostochny": "Автовокзал Восточный",
  "avtozavodskaya": "Автозаводская",
  "beauty-house-ulica-zhukovskogo-28-3": "Beauty House",
  "belorusneft-18-ulica-babushkina-1a": "Белоруснефть № 18",
  "belorusneft-56-ulica-vaupshasova-53": "Белоруснефть № 56",
  "belposhta-parkovaya-ulica-10": "Белпошта",
  "bufet-ds-ulica-russiyanova-51": "Буфет ДС",
  "chizhovka": "Чижовка",
  "cum": "ЦУМ Минск",
  "dana-mall": "Дана Молл",
  "dizel-servis-kulturnaya-ulica-7": "Дизель-сервис",
  "domino-c-ulica-nesterova-58": "Domino'c",
  "doner-king-lineinaya-ulica-27": "Doner King",
  "dorors-48-profsoyuznaya-ulica-19": "Дорорс № 48",
  "dorors-magazin-30-lineinaya-ulica-8a": "ДорОРС Магазин №30",
  "drozdy": "Дрозды",
  "dvorets-sporta": "Дворец спорта",
  "evroopt-market-ulica-pavlovskogo-52": "Евроопт Market",
  "fizkulturna-azdaraulenchy-kompleks-iba-g-ulica-programmistov-9": "ФАК (IBA Group)",
  "frunzenskaya": "Фрунзенская",
  "institut-kultury": "Институт Культуры",
  "kafe-ulica-tyulenina-26-ulica-tyulenina-26": "Кафе (Тюленина 26)",
  "kamennaya-gorka": "Каменная Горка",
  "korona-kg": "Корона Каменная Горка",
  "kuncevshchina": "Кунцевщина",
  "kurasovshchina": "Курасовщина",
  "lesapark-angarskaya-2-angarskaya-ulica-70": "Лесопарк Ангарская-2",
  "loshica": "Лошица (Маяковского)",
  "malinovka": "Малиновка",
  "mayak-centralnaya-ulica-126": "Маяк",
  "mihalovo": "Михалово",
  "minsk-arena": "Минск-Арена",
  "minsk-kryshtal-ulica-chkalova-17": "МИНСК КРЫШТАЛЬ",
  "mogilevskaya": "Могилёвская",
  "moskovskaya": "Московская",
  "nemiga": "Немига",
  "obekt-parkovaya-ulica-8-parkovaya-ulica-8": "Объект (Парковая 8)",
  "obekt-sadovaya-ulica-77-sadovaya-ulica-77": "Объект (Садовая 77)",
  "obekt-ulica-babushkina-4a-ulica-babushkina-4a": "Объект (Бабушкина 4а)",
  "obekt-ulica-krasina-169-2-ulica-krasina-169-2": "Объект (Красина 169-2)",
  "obekt-ulica-krasina-201-ulica-krasina-201": "Объект (Красина 201)",
  "obekt-ulica-rivvip-3-ulica-rivvip-3": "Объект (Риввип 3)",
  "obekt-ulica-zhukovskogo-82-ulica-zhukovskogo-82": "Объект (Жуковского 82)",
  "ofisy-i-sklad-ulica-babushkina-17a": "Офисы и склад",
  "otdelenie-529-285-ulica-russiyanova-36a": "Отделение №529/285",
  "oz-ulica-zhukovskogo-28a": "OZ",
  "palazzo": "ТЦ Палаццо",
  "park-cheluskincev": "Парк Челюскинцев",
  "partizanskaya": "Партизанская",
  "pervomayskaya": "Первомайская",
  "picca-tempo-prospekt-pobeditelei-84": "Пицца Темпо",
  "ploshchad-lenina": "Площадь Ленина",
  "ploshchad-pobedy": "Площадь Победы",
  "poliklinika-minskaya-ulica-5-minskaya-ulica-5": "Поликлиника (Минская 5)",
  "pro-zapas-parkovaya-ulica-2": "Pro Запас",
  "ptich-poselkovaya-ulica-1a": "Птичь",
  "rmrtehservis-ooo-minskaya-ulica-67": "РМРтехсервис",
  "rodny-kut-parkovaya-ulica-6": "Родны кут",
  "rynok-ulica-timiryazeva-129-k2-ulica-timiryazeva-129-k2": "Рынок (Тимирязева)",
  "rynok-zhdanovich": "Рынок Жданович",
  "serebryanka": "Серебрянка",
  "servis-angarskaya-ulica-36-angarskaya-ulica-36": "Сервис (Ангарская 36)",
  "servis-lineinaya-ulica-1-lineinaya-ulica-1": "Сервис (Линейная 1)",
  "servis-ulica-timiryazeva-129-k1-ulica-timiryazeva-129-k1": "Сервис (Тимирязева)",
  "sklad-magazina-tehnosad-gorny-pereulok-1a": "Склад «Техносад»",
  "suharevo": "Сухарево",
  "svetofor-mkad-4-i-kilometr-75": "Светофор (МКАД)",
  "tc-galileo": "ТЦ Galileo (вокзал)",
  "tda-spektrt-ks-ulica-krasina-167": "ТДА «Спектртэкс»",
  "universam-baikalskii-angarskaya-ulica-38k2": "Универсам Байкальский",
  "uruchye": "Уручье",
  "vokzal": "Главный ж/д вокзал",
  "vostok": "Восток",
  "yakuba-kolasa": "Площадь Якуба Коласа",
  "zelyony-lug": "Зелёный Луг",
  "zhdanovickaya-ssh-parkovaya-ulica-8": "Ждановицкая СШ",
};

function prettifyAnchorId(id: string): string {
  if (!id) return "?";
  // Сначала пытаемся словарь — в нём 79 живых точек с правильными русскими именами.
  const fromDict = ANCHOR_NAMES[id];
  if (fromDict) return fromDict;
  // Fallback: для новых slug-ов (которые мы ещё не положили в словарь) —
  // транслит-капитализация. Лучше технический id чем "?".
  return id
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
