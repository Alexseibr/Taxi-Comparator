// Клиент для загрузки скринов мобильного Yandex Go на серверный приёмник
// (rwbtaxi-screens на VPS, /api/screens/upload через nginx → 127.0.0.1:3011).
// На бэкенде Gemini Vision распознаёт цены/адреса/спрос и автоматически
// создаёт calib-*.json в общем пуле — часовой rwbtaxi-auto-calib подхватит.

import { fetchWeather, weatherKey } from "./weather";

function endpoint(): string | null {
  const url = (import.meta.env.VITE_SCREENS_UPLOAD_URL as string | undefined)?.trim();
  if (url) return url;
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    // На любом не-локальном домене считаем, что nginx этого хоста проксирует
    // /api/screens/* на screen-receiver (как сделано на rwbtaxi.by).
    // Локальный vite-dev (localhost) приёмника не имеет — отдаём null,
    // чтобы UI показал «не настроен» и не сыпал ошибками.
    if (h && h !== "localhost" && h !== "127.0.0.1" && h !== "0.0.0.0") {
      return `${window.location.origin}/api/screens/upload`;
    }
  }
  return null;
}

// Базовый URL приёмника без /upload — для соседних endpoints (/recommended, /reserve, /release).
function baseUrl(): string | null {
  const up = endpoint();
  if (!up) return null;
  return up.replace(/\/upload\/?$/, "");
}

export function isScreensUploadConfigured(): boolean {
  return endpoint() !== null;
}

export type ScreenUploadAccepted = {
  id: string;
  originalName: string;
  sizeBytes: number;
};

export type ScreenUploadRejected = {
  originalName: string;
  reason: string;
};

export type QueueLevel = "ok" | "busy" | "overloaded";

export type ScreenUploadResult =
  | {
      ok: true;
      accepted: ScreenUploadAccepted[];
      rejected: ScreenUploadRejected[];
      aborted: boolean;
      // Состояние очереди распознавания на VPS после приёма этих файлов.
      queueLength?: number;
      etaSeconds?: number;
      level?: QueueLevel;
    }
  | { ok: false; error: string; status?: number };

export type QueueStatus = {
  ok: true;
  queueLength: number;
  etaSeconds: number;
  level: QueueLevel;
};

// Лёгкий опрос очереди — фронт зовёт перед большой загрузкой,
// чтобы предупредить пользователя при бэклоге.
export async function getScreensQueueStatus(): Promise<
  QueueStatus | { ok: false; error: string }
> {
  const base = baseUrl();
  if (!base) return { ok: false, error: "no_endpoint" };
  try {
    const res = await fetch(`${base}/queue-status`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* ignore */
    }
    if (!res.ok || !json?.ok) {
      return { ok: false, error: json?.error ?? `http_${res.status}` };
    }
    const lvl = json.level;
    return {
      ok: true,
      queueLength: Number(json.queueLength) || 0,
      etaSeconds: Number(json.etaSeconds) || 0,
      level: lvl === "busy" || lvl === "overloaded" ? lvl : "ok",
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "network_error" };
  }
}

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// ─────────────── Клиентское сжатие фотографий тарифов ───────────────
// Фотки экрана выбора тарифа из мобильного Yandex Go обычно весят 0.8–3 МБ
// (PNG/JPEG с дисплея iPhone в нативном разрешении 1170×2532 и выше).
// Для распознавания нам это избыточно: Gemini Vision всё равно даунскейлит
// вход до ~768px по короткой стороне, поэтому исходное разрешение «уходит
// в мусор». Жмём на клиенте до ширины COMPRESS_MAX_WIDTH и WebP с quality
// COMPRESS_QUALITY — типичное сокращение 5–15× для фото с iPhone, при том
// что цены/тарифы остаются читаемыми (1080px по ширине = ~3.7 px на пиксель
// исходной 4х-плотности, хватает с большим запасом).
//
// Что делаем НЕ-агрессивно:
//   • если файл уже WebP и весит < SKIP_BYTES — оставляем как есть
//     (нет смысла перекодировать, можем даже ухудшить);
//   • если результат сжатия по байтам не меньше оригинала — отдаём оригинал
//     (бывает редко, для маленьких WebP с высоким quality);
//   • любая ошибка декодирования (старый Safari, HEIC, битый файл,
//     отсутствие createImageBitmap) → fallback на оригинал, без падения.
//
// Сервер уже принимает image/webp (см. ALLOWED_MIME в screen-receiver.mjs),
// extFromMime() кладёт расширение `.webp`. Никакие server-side правки
// для WebP не нужны.
const COMPRESS_SKIP_BYTES = 200 * 1024;
const COMPRESS_MAX_WIDTH = 1080;
const COMPRESS_QUALITY = 0.8;

async function compressImage(file: File): Promise<File> {
  // Маленький WebP — не трогаем.
  if (file.type === "image/webp" && file.size < COMPRESS_SKIP_BYTES) return file;
  // Окружение без image bitmap (старые браузеры, SSR, тесты) — fallback.
  if (typeof createImageBitmap !== "function") return file;

  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(file);
    const scale = Math.min(1, COMPRESS_MAX_WIDTH / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));

    let blob: Blob | null = null;
    if (typeof OffscreenCanvas !== "undefined") {
      // Предпочитаем OffscreenCanvas — не трогает DOM, дешевле для GC.
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bmp, 0, 0, w, h);
      try {
        blob = await canvas.convertToBlob({
          type: "image/webp",
          quality: COMPRESS_QUALITY,
        });
        // Некоторые браузеры успешно возвращают blob, но с PNG вместо WebP
        // (convertToBlob не выбрасывает — просто молча фоллбэчит на PNG).
        // В этом случае принудительно перекодируем в JPEG.
        if (blob && blob.type !== "image/webp") {
          blob = await canvas.convertToBlob({
            type: "image/jpeg",
            quality: COMPRESS_QUALITY,
          });
        }
      } catch {
        // Safari < 17 не поддерживает webp в convertToBlob — пробуем JPEG.
        blob = await canvas.convertToBlob({
          type: "image/jpeg",
          quality: COMPRESS_QUALITY,
        });
      }
    } else if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bmp, 0, 0, w, h);
      blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/webp", COMPRESS_QUALITY);
      });
      // iOS Safari: webp encoding не поддерживается → toBlob отдаёт PNG blob
      // (не null!), поэтому проверяем blob.type, а не просто null.
      if (!blob || blob.type !== "image/webp") {
        blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, "image/jpeg", COMPRESS_QUALITY);
        });
      }
    } else {
      return file;
    }

    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "screen";
    const ext = blob.type === "image/webp" ? ".webp" : ".jpg";
    return new File([blob], `${baseName}${ext}`, {
      type: blob.type,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bmp?.close?.();
  }
}

// ─────────────── Дедуп скринов по SHA-256 в localStorage ───────────────
// Защита от случайной двойной отправки одного и того же скрина с одного
// устройства (промахнулись в галерее, повторный тап, оператор не помнит
// что уже грузил эту фотку). Считаем SHA-256 от ОРИГИНАЛЬНОГО файла —
// до сжатия, иначе хэш зависел бы от точности WebP-кодека и дедуп бы
// перестал работать между сессиями. Храним в LS карту hash → {t, n}
// с TTL 24 часа и LRU-кап 200 записей.
//
// Серверного дедупа НЕТ сознательно: между разными устройствами/операторами
// один скрин должен иметь возможность быть отправлен (два оператора могут
// независимо снять одну и ту же подозрительную поездку — это валидный сигнал).
//
// Любая ошибка (нет crypto.subtle, LS заблокирован в Safari Private,
// JSON битый, quota exceeded) → дедуп просто отключается, файл уходит
// как обычно. Без падений UX.
const DEDUP_LS_KEY = "rwb_screen_hashes_v1";
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;
const DEDUP_MAX_ENTRIES = 200;
type DedupEntry = { t: number; n: string };

function readDedupHashes(): Map<string, DedupEntry> {
  const m = new Map<string, DedupEntry>();
  try {
    const raw = localStorage.getItem(DEDUP_LS_KEY);
    if (!raw) return m;
    const obj = JSON.parse(raw) as Record<string, DedupEntry>;
    const now = Date.now();
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v.t === "number" && now - v.t < DEDUP_TTL_MS) {
        m.set(k, { t: v.t, n: typeof v.n === "string" ? v.n : "" });
      }
    }
  } catch {
    /* битый JSON / private mode — пустая карта, дедуп просто пропустится */
  }
  return m;
}

function writeDedupHashes(m: Map<string, DedupEntry>) {
  try {
    let entries = [...m.entries()];
    if (entries.length > DEDUP_MAX_ENTRIES) {
      // LRU по timestamp убывания — оставляем самые свежие
      entries.sort((a, b) => b[1].t - a[1].t);
      entries = entries.slice(0, DEDUP_MAX_ENTRIES);
    }
    const obj: Record<string, DedupEntry> = {};
    for (const [k, v] of entries) obj[k] = v;
    localStorage.setItem(DEDUP_LS_KEY, JSON.stringify(obj));
  } catch {
    /* private mode / quota exceeded — best-effort, не падаем */
  }
}

async function sha256Hex(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const arr = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < arr.length; i++) {
      hex += arr[i].toString(16).padStart(2, "0");
    }
    return hex;
  } catch {
    return null;
  }
}

export type UploadContext =
  | {
      ok: true;
      knownOperator: string | null;
      recentNames: string[];
    }
  | { ok: false; error: string };

// Лёгкий запрос «знаем ли мы оператора по этому IP». Если да — фронт
// молча подставит имя и сразу откроет file picker. Если нет — фронт
// покажет inline-модалку с input + datalist (recentNames).
//
// ВАЖНО: жёсткий таймаут 3000мс. Если сеть медленная или сервер не отвечает,
// fetch без таймаута повиснет на минуты, а кнопка-спиннер крутится навсегда —
// именно эта поломка ломала FAB у части пользователей в реальной эксплуатации.
export async function getUploadContext(timeoutMs = 3000): Promise<UploadContext> {
  const base = baseUrl();
  if (!base) return { ok: false, error: "no_endpoint" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/upload-context`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* ignore */
    }
    if (!res.ok || !json?.ok) {
      return { ok: false, error: json?.error ?? `http_${res.status}` };
    }
    const known =
      typeof json.knownOperator === "string" && json.knownOperator
        ? json.knownOperator
        : null;
    const recent = Array.isArray(json.recentNames)
      ? json.recentNames.filter((s: unknown): s is string => typeof s === "string")
      : [];
    return { ok: true, knownOperator: known, recentNames: recent };
  } catch (e) {
    const err = e as Error & { name?: string };
    if (err?.name === "AbortError") {
      return { ok: false, error: "timeout" };
    }
    return { ok: false, error: err?.message || "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────── Батчевая загрузка пачки скринов ───────────────
// Юзер часто сразу выделяет 30-100 фото в галерее. Один FormData с 100
// файлами — плохая идея: (а) серверный busboy режется на MAX_FILES_PER_REQUEST
// (по умолчанию 30) и молча роняет хвост с aborted=true; (б) мобильный
// upload одного гигантского multipart часто отваливается посередине от
// network drop. Поэтому делим на чанки и шлём параллельно с retry.
//
// Параметры подобраны под мобильный 4G:
//   • CHUNK_SIZE=30 — по запросу пользователя «прогнать 30 за раз». При
//     сжатии WebP ~250 KB на скрин это ~7-8 MB на запрос (nginx разрешает
//     30m), для уверенного 4G/Wi-Fi проходит ~10-20 секунд. На EDGE/3G
//     возможны таймауты — на этот случай ниже CHUNK_RETRIES.
//     ⚠️ Серверный SCREENS_MAX_FILES в /etc/rwbtaxi-calib.env должен быть
//     не меньше CHUNK_SIZE (иначе busboy будет ронять хвост каждого чанка).
//   • CONCURRENCY=2 — два параллельных запроса; больше упирается в
//     апстрим nginx и мобильный TCP, ускорения почти нет, зато выше
//     шанс получить timeout на половине файлов.
//   • RETRIES=2 — сетевая ошибка / 5xx / 429 → ещё две попытки с
//     экспоненциальной задержкой 800ms, 2400ms. 4xx (кроме 429) — отказ
//     навсегда (это либо bad_token либо bad_content_type — retry не поможет).
//
// Аккумулируем результаты всех чанков в один ScreenUploadResult.
// Если все чанки упали — возвращаем error того, что получили последним.
//
// CHUNK_SIZE=5: nginx буферизирует upload целиком перед проксированием,
// поэтому XHR upload.onprogress не работает — всё стреляет только в конце.
// Решение: маленькие чанки → каждый ответ сервера = реальный +5 к done.
// 21 файл → 5 чанков → 5 видимых шагов прогресса вместо одного прыжка 0→21.
// Плюс fake-progress setInterval внутри ожидания чанка — бегунок плавно идёт.
const CHUNK_SIZE = 5;
const CHUNK_CONCURRENCY = 5;
const CHUNK_RETRIES = 2;

export type UploadProgress = {
  /** preparing — сжатие/хэширование файлов на клиенте; uploading — отправка на сервер */
  phase: "preparing" | "uploading";
  done: number;
  total: number;
  inFlight: number;
  failedChunks: number;
  /** Имя текущего обрабатываемого файла (только в фазе preparing) */
  currentFile?: string;
};

type ChunkResult =
  | {
      ok: true;
      accepted: ScreenUploadAccepted[];
      rejected: ScreenUploadRejected[];
      aborted: boolean;
      queueLength?: number;
      etaSeconds?: number;
      level?: QueueLevel;
    }
  | { ok: false; error: string; status?: number; permanent?: boolean };

async function uploadOneChunk(
  url: string,
  token: string | undefined,
  operator: string | null | undefined,
  chunk: Array<{ file: File; originalName: string }>,
  onUploadProgress?: (loaded: number, total: number) => void,
): Promise<ChunkResult> {
  const fd = new FormData();
  // ВАЖНО: текстовые поля кладём ПЕРВЫМИ, чтобы они дошли до busboy на сервере
  // ДО того, как начнётся stream первого файла. В multipart порядок полей
  // сохраняется, и busboy эмитит "field" события строго по порядку, поэтому
  // bb.on("field") должен сработать ДО bb.on("file") для первого скрина —
  // иначе meta первого файла будет без operator/weather.
  const op = (operator ?? "").trim();
  if (op) fd.append("operator", op.slice(0, 60));
  // Погода: open-meteo снимок на текущий час. Один раз на batch (за 30
  // скринов погода не меняется). Если open-meteo лежит — fetchWeather()
  // вернёт пустую Map, и мы просто не приложим поле, бэк сохранит null.
  try {
    const wmap = await fetchWeather();
    const key = weatherKey(new Date());
    const w = wmap.get(key);
    if (w) {
      fd.append(
        "weather",
        JSON.stringify({
          isRain: w.isRain,
          isSnow: w.isSnow,
          tempC: w.tempC,
          key,
        }),
      );
    }
  } catch {
    /* погода — best-effort, никогда не блокирует upload */
  }
  for (const { file, originalName } of chunk) {
    fd.append("files", file, originalName);
  }

  // Используем XMLHttpRequest вместо fetch — только так можно отслеживать
  // реальный прогресс передачи байт через xhr.upload.onprogress.
  // fetch() не даёт никакого upload progress API.
  return new Promise<ChunkResult>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (token) xhr.setRequestHeader("X-Screens-Token", token);
    // Не ставим Content-Type — браузер сам добавит multipart/form-data с boundary.

    if (onUploadProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onUploadProgress(e.loaded, e.total);
      };
    }

    xhr.onload = () => {
      let json: any = null;
      try { json = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status < 200 || xhr.status >= 300) {
        const permanent = xhr.status >= 400 && xhr.status < 500 && xhr.status !== 429;
        resolve({
          ok: false,
          status: xhr.status,
          error: json?.error ?? `http_${xhr.status}`,
          permanent,
        });
        return;
      }
      if (!json?.ok) { resolve({ ok: false, error: "bad_response", permanent: true }); return; }
      const lvl = json.level;
      resolve({
        ok: true,
        accepted: Array.isArray(json.accepted) ? json.accepted : [],
        rejected: Array.isArray(json.rejected) ? json.rejected : [],
        aborted: !!json.aborted,
        queueLength: typeof json.queueLength === "number" ? json.queueLength : undefined,
        etaSeconds: typeof json.etaSeconds === "number" ? json.etaSeconds : undefined,
        level: lvl === "ok" || lvl === "busy" || lvl === "overloaded" ? lvl : undefined,
      });
    };
    xhr.onerror = () => resolve({ ok: false, error: "network_error" });
    xhr.ontimeout = () => resolve({ ok: false, error: "timeout" });
    xhr.send(fd);
  });
}

async function uploadOneChunkWithRetry(
  url: string,
  token: string | undefined,
  operator: string | null | undefined,
  chunk: Array<{ file: File; originalName: string }>,
  onUploadProgress?: (loaded: number, total: number) => void,
): Promise<ChunkResult> {
  let last: ChunkResult = { ok: false, error: "no_attempts" };
  for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = 800 * Math.pow(3, attempt - 1); // 800ms, 2400ms
      await new Promise((r) => setTimeout(r, delay));
    }
    last = await uploadOneChunk(url, token, operator, chunk, onUploadProgress);
    if (last.ok) return last;
    if (last.permanent) return last; // 4xx (не 429) — нет смысла повторять
  }
  return last;
}

export async function uploadScreens(
  files: File[],
  operator?: string | null,
  onProgress?: (p: UploadProgress) => void,
): Promise<ScreenUploadResult> {
  const urlMaybe = endpoint();
  if (!urlMaybe) return { ok: false, error: "no_endpoint" };
  if (!files.length) return { ok: false, error: "no_files" };
  // После проверки выше TypeScript внутри async-замыкания worker() не
  // сохраняет narrow `string | null` → `string` (известный лимит TS),
  // поэтому фиксируем явно типизированную const.
  const url: string = urlMaybe;

  // Локальные «отказы»: дубли по SHA-256 + битый MIME + слишком крупные.
  // Эти причины выводим в UI как обычный rejected[], рядом с серверными.
  const localRejected: ScreenUploadRejected[] = [];
  // Сжатые файлы для отправки + их хэши (хэш — по ОРИГИНАЛУ, до сжатия,
  // иначе дедуп между сессиями сломается из-за плавающих байт WebP).
  // Хэш записываем в LS только ПОСЛЕ того, как сервер реально принял этот
  // файл, чтобы при network-fail / 5xx оператор мог повторить без «уже грузили».
  type Prepared = {
    file: File;
    originalName: string;
    hash: string | null;
  };
  const prepared: Prepared[] = [];
  const dedupMap = readDedupHashes();
  const totalFiles = files.length;
  let preparedCount = 0;
  for (const f of files) {
    // Сообщаем о начале обработки каждого файла — пользователь видит прогресс
    // прямо во время сжатия (это самая долгая часть для больших пачек).
    try {
      onProgress?.({
        phase: "preparing",
        done: preparedCount,
        total: totalFiles,
        inFlight: 0,
        failedChunks: 0,
        currentFile: f.name,
      });
    } catch { /* не критично */ }

    if (!ALLOWED_TYPES.has(f.type)) {
      localRejected.push({
        originalName: f.name,
        reason: `bad_mime:${f.type || "unknown"}`,
      });
      preparedCount++;
      continue;
    }
    if (f.size > MAX_FILE_BYTES) {
      localRejected.push({ originalName: f.name, reason: "too_large" });
      preparedCount++;
      continue;
    }
    const hash = await sha256Hex(f);
    if (hash) {
      const prev = dedupMap.get(hash);
      if (prev) {
        const ageMin = Math.max(1, Math.round((Date.now() - prev.t) / 60000));
        localRejected.push({
          originalName: f.name,
          reason: `duplicate_24h:${ageMin}m`,
        });
        preparedCount++;
        continue;
      }
    }
    const c = await compressImage(f);
    prepared.push({ file: c, originalName: c.name, hash });
    preparedCount++;
  }

  if (!prepared.length) {
    if (localRejected.length > 0) {
      return { ok: true, accepted: [], rejected: localRejected, aborted: false };
    }
    return { ok: false, error: "all_files_filtered_locally" };
  }

  // Делим на чанки по CHUNK_SIZE.
  const chunks: Prepared[][] = [];
  for (let i = 0; i < prepared.length; i += CHUNK_SIZE) {
    chunks.push(prepared.slice(i, i + CHUNK_SIZE));
  }

  const token = (import.meta.env.VITE_SCREENS_TOKEN as string | undefined)?.trim();

  // Прогресс загрузки.
  // Стратегия: nginx буферизирует весь POST перед upstream → XHR onprogress
  // стреляет только в самом конце (бесполезно). Поэтому используем два слоя:
  //   1) Реальный прогресс: CHUNK_SIZE=5 → каждый ответ сервера = точный +5 к done.
  //   2) Fake-progress setInterval внутри каждого чанка: пока чанк в полёте,
  //      плавно двигаем счётчик до ~85% от chunkFileCount (~2сек на файл).
  //      Когда ответ пришёл — убиваем интервал, ставим точное число.
  let completedFiles = 0;
  let inflightFake = 0;   // дробный «фейковый» прогресс текущего чанка (в файлах)
  let inFlight = 0;
  let failedChunks = 0;
  const total = prepared.length;
  // Оценка: ~3000ms на файл (JPEG ~300KB на мобильном 4G/3G)
  const MS_PER_FILE = 3000;

  function emit() {
    const done = completedFiles + Math.round(inflightFake);
    try {
      onProgress?.({ phase: "uploading", done: Math.min(done, total), total, inFlight, failedChunks });
    } catch {
      /* not fatal */
    }
  }
  emit();

  // Пул запросов (CONCURRENCY=1 — последовательно, прогресс понятен пользователю).
  const results: ChunkResult[] = new Array(chunks.length);
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= chunks.length) return;
      inFlight += 1;
      inflightFake = 0;
      emit();

      const chunkFileCount = chunks[i].length;
      // Fake-progress: за MS_PER_FILE * chunkFileCount мс движемся до ~85%
      // от chunkFileCount. Шаг: каждые 200ms.
      const fakeTarget = chunkFileCount * 0.85;
      const fakeDurationMs = MS_PER_FILE * chunkFileCount;
      const fakeStepMs = 200;
      const fakeStepSize = (fakeTarget / fakeDurationMs) * fakeStepMs;
      let fakeTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
        if (inflightFake < fakeTarget) {
          inflightFake = Math.min(inflightFake + fakeStepSize, fakeTarget);
          emit();
        }
      }, fakeStepMs);

      const r = await uploadOneChunkWithRetry(url, token, operator, chunks[i]);

      // Чанк завершён — гасим fake-timer, фиксируем точный результат
      if (fakeTimer !== null) { clearInterval(fakeTimer); fakeTimer = null; }
      inflightFake = 0;
      inFlight -= 1;

      if (r.ok) {
        completedFiles += r.accepted.length + r.rejected.length;
      } else {
        completedFiles += chunkFileCount;
        failedChunks += 1;
      }
      results[i] = r;
      emit();
    }
  }
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(CHUNK_CONCURRENCY, chunks.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  // Аггрегируем все ответы.
  const accepted: ScreenUploadAccepted[] = [];
  const rejected: ScreenUploadRejected[] = [...localRejected];
  let aborted = false;
  let lastQueueLength: number | undefined;
  let lastEtaSeconds: number | undefined;
  let lastLevel: QueueLevel | undefined;
  let lastErr: { error: string; status?: number } | null = null;
  let okChunks = 0;
  for (const r of results) {
    if (!r) continue;
    if (r.ok) {
      okChunks += 1;
      accepted.push(...r.accepted);
      rejected.push(...r.rejected);
      if (r.aborted) aborted = true;
      if (typeof r.queueLength === "number") lastQueueLength = r.queueLength;
      if (typeof r.etaSeconds === "number") lastEtaSeconds = r.etaSeconds;
      if (r.level) lastLevel = r.level;
    } else {
      lastErr = { error: r.error, status: r.status };
      // Файлы упавших чанков попадают в rejected с понятной причиной,
      // чтобы юзер увидел в тосте «3 не дошли (сеть): IMG_0908, IMG_0909…»
      // и мог их повторно перезалить.
      const fc = chunks[results.indexOf(r)];
      if (fc) {
        for (const p of fc) {
          rejected.push({
            originalName: p.originalName,
            reason: r.error?.startsWith("http_")
              ? `network_${r.status ?? "err"}`
              : "network_error",
          });
        }
      }
    }
  }

  // Запоминаем хэши успешно принятых — чтобы при повторной попытке тех же
  // файлов клиентский дедуп их отсёк.
  if (accepted.length) {
    const acceptedNames = new Set(accepted.map((a) => a.originalName));
    let dirty = false;
    for (const p of prepared) {
      if (p.hash && acceptedNames.has(p.originalName)) {
        dedupMap.set(p.hash, { t: Date.now(), n: p.originalName.slice(0, 60) });
        dirty = true;
      }
    }
    if (dirty) writeDedupHashes(dedupMap);
  }

  // Все чанки упали — возвращаем error, чтобы UI показал red toast.
  if (okChunks === 0 && lastErr) {
    return { ok: false, error: lastErr.error, status: lastErr.status };
  }

  return {
    ok: true,
    accepted,
    rejected,
    aborted,
    queueLength: lastQueueLength,
    etaSeconds: lastEtaSeconds,
    level: lastLevel,
  };
}

// ─────────────── Рекомендованные адреса А→Б (с in-memory бронью на VPS) ───────────────

export type RecommendedRoute = {
  id: string;
  from: string;
  to: string;
  note?: string | null;
  bucket?: "short" | "medium" | "long" | "airport" | "suburb"; // дистанционная категория, генерится сервером (airport = пара с Минск-2, suburb = пара где хотя бы один якорь вне city-box)
  distanceKm?: number;                  // приближённое расстояние А→Б по прямой
  // Координаты якорей А и Б. Используются для deep-link в Yandex Maps
  // (открыть готовый маршрут в режиме «такси» при клике на адрес).
  // Могут быть null, если на сервере у якоря не заполнены координаты.
  fromLat?: number | null;
  fromLng?: number | null;
  toLat?: number | null;
  toLng?: number | null;
  // ─── поля умного генератора (Phase B) ───
  // mapeE — текущая ошибка модели цены ECONOM на этой паре (доли, 0..1+).
  // n — количество калибровок, по которым посчитана MAPE. Если ML недоступен
  // или у пары < 5 калибровок — оба поля null/0 и weightReason="new".
  mapeE?: number | null;
  n?: number;
  // weightReason — почему пара поднята в выдаче (для UI badge):
  //   "hot"      — шумная (mape ≥ 25%) → 🔥, нужна срочная докалибровка
  //   "coldslot" — текущий час+день недели слабо покрыт (бустим всё подряд)
  //   "new"      — пара ни разу не калибровалась
  //   null       — обычная пара, идёт в общий рандом
  weightReason?: "hot" | "coldslot" | "new" | null;
  // Если эту пару уже делали скрином и multi-pass добил её повторно
  // (после 1-4ч, потому что свежих не хватило) — в поле лежит unix-ms
  // последней калибровки. Используется для UI badge «↺ повтор Nч».
  // null = пара ещё не была сделана за последние 24ч.
  recentlyDoneAt?: number | null;
  reservedUntil: number | null;     // ms epoch (по серверным часам), null = свободен
  reservedBy: string | null;        // clientId или "other" если занято кем-то
};

export type RecommendedResult =
  | {
      ok: true;
      now: number;                  // серверное время на момент ответа (для дрейфа)
      ttlMs: number;                // длина брони в мс
      routes: RecommendedRoute[];
    }
  | { ok: false; error: string; status?: number };

// ───────────── /operators-stats ─────────────
// Тип строки в дашборде «Продуктивность операторов» (см. AdminOperatorStats).
// Сервер агрегирует meta-файлы по полю operator из FAB-формы.
export type OperatorStatsRow = {
  name: string;
  today: number;
  week: number;
  month: number;
  lastAt: number;          // ms epoch (серверное)
  lastAtIso: string | null;
};

export type OperatorStatsResult =
  | {
      ok: true;
      generatedAt: string;
      totalToday: number;
      totalWeek: number;
      totalMonth: number;
      operators: OperatorStatsRow[];
    }
  | { ok: false; error: string; status?: number };

export async function fetchOperatorStats(): Promise<OperatorStatsResult> {
  const base = baseUrl();
  if (!base) return { ok: false, error: "no_endpoint" };
  try {
    const res = await fetch(`${base}/operators-stats`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* ignore */
    }
    if (!res.ok || !json?.ok) {
      return {
        ok: false,
        status: res.status,
        error: json?.error ?? `http_${res.status}`,
      };
    }
    const operators: OperatorStatsRow[] = Array.isArray(json.operators)
      ? json.operators.map((r: any) => ({
          name: String(r.name ?? "(без имени)"),
          today: Number(r.today) || 0,
          week: Number(r.week) || 0,
          month: Number(r.month) || 0,
          lastAt: Number(r.lastAt) || 0,
          lastAtIso: typeof r.lastAtIso === "string" ? r.lastAtIso : null,
        }))
      : [];
    return {
      ok: true,
      generatedAt: String(json.generatedAt ?? ""),
      totalToday: Number(json.totalToday) || 0,
      totalWeek: Number(json.totalWeek) || 0,
      totalMonth: Number(json.totalMonth) || 0,
      operators,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "network_error" };
  }
}

export async function fetchRecommendedRoutes(
  clientId?: string,
): Promise<RecommendedResult> {
  const base = baseUrl();
  if (!base) return { ok: false, error: "no_endpoint" };
  try {
    // ?clientId=… нужен серверу для per-user фильтра «уже отработанных»
    // маршрутов: один и тот же routeId «сделан» у одного сотрудника, но
    // ещё «свободен» у других. Без id сервер вернёт общую выдачу без
    // персонализации (тоже работает, просто будет показывать сделанные
    // другими маршруты).
    const qs = clientId
      ? `?clientId=${encodeURIComponent(clientId)}`
      : "";
    const res = await fetch(`${base}/recommended${qs}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* ignore */
    }
    if (!res.ok || !json?.ok) {
      return {
        ok: false,
        status: res.status,
        error: json?.error ?? `http_${res.status}`,
      };
    }
    return {
      ok: true,
      now: Number(json.now) || Date.now(),
      ttlMs: Number(json.ttlMs) || 120_000,
      routes: Array.isArray(json.routes)
        ? json.routes.map((r: any) => ({
            id: String(r.id),
            from: String(r.from ?? ""),
            to: String(r.to ?? ""),
            note: r.note ?? null,
            bucket:
              r.bucket === "short" || r.bucket === "medium" || r.bucket === "long" || r.bucket === "airport" || r.bucket === "suburb"
                ? r.bucket
                : undefined,
            distanceKm:
              typeof r.distanceKm === "number" && Number.isFinite(r.distanceKm)
                ? r.distanceKm
                : undefined,
            fromLat:
              typeof r.fromLat === "number" && Number.isFinite(r.fromLat)
                ? r.fromLat
                : null,
            fromLng:
              typeof r.fromLng === "number" && Number.isFinite(r.fromLng)
                ? r.fromLng
                : null,
            toLat:
              typeof r.toLat === "number" && Number.isFinite(r.toLat)
                ? r.toLat
                : null,
            toLng:
              typeof r.toLng === "number" && Number.isFinite(r.toLng)
                ? r.toLng
                : null,
            mapeE:
              typeof r.mapeE === "number" && Number.isFinite(r.mapeE)
                ? r.mapeE
                : null,
            n: typeof r.n === "number" && Number.isFinite(r.n) ? r.n : 0,
            weightReason:
              r.weightReason === "hot"      ? "hot"
            : r.weightReason === "coldslot" ? "coldslot"
            : r.weightReason === "new"      ? "new"
            : null,
            recentlyDoneAt:
              typeof r.recentlyDoneAt === "number" && Number.isFinite(r.recentlyDoneAt)
                ? r.recentlyDoneAt
                : null,
            reservedUntil: r.reservedUntil == null ? null : Number(r.reservedUntil),
            reservedBy: r.reservedBy ?? null,
          }))
        : [],
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "network_error" };
  }
}

export type ReserveResult =
  | { ok: true; routeId: string; until: number; ttlMs: number }
  | { ok: false; error: string; status?: number; reservedUntil?: number };

export async function reserveRoute(
  routeId: string,
  clientId: string,
): Promise<ReserveResult> {
  const base = baseUrl();
  if (!base) return { ok: false, error: "no_endpoint" };
  try {
    const res = await fetch(`${base}/reserve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId, clientId }),
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* ignore */
    }
    if (json?.ok) {
      return {
        ok: true,
        routeId: String(json.routeId),
        until: Number(json.until),
        ttlMs: Number(json.ttlMs) || 120_000,
      };
    }
    return {
      ok: false,
      status: res.status,
      error: json?.error ?? `http_${res.status}`,
      reservedUntil:
        json?.reservedUntil != null ? Number(json.reservedUntil) : undefined,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "network_error" };
  }
}

export async function releaseRoute(
  routeId: string,
  clientId: string,
): Promise<{ ok: boolean; error?: string }> {
  const base = baseUrl();
  if (!base) return { ok: false, error: "no_endpoint" };
  try {
    const res = await fetch(`${base}/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId, clientId }),
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* ignore */
    }
    if (json?.ok) return { ok: true };
    return { ok: false, error: json?.error ?? `http_${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "network_error" };
  }
}

// ───────────── /recent-calibs ─────────────
// Свежие распознанные скрины (от Gemini Vision на VPS) — для админ-таблицы
// «план vs факт». Возвращает массив, отсортированный сервером по
// receivedAt DESC (свежие первыми).
// Заключение Gemini о потенциальной аномалии замера. Заполняется
// process-screens.mjs на VPS сразу после распознавания. Если поля нет —
// проверка не выполнялась (старая запись или AI был временно недоступен).
export type CalibAnomaly = {
  suspicious: boolean;
  severity: "low" | "med" | "high" | null;
  category: string | null; // e.g. "price_outlier" | "geocode_mismatch" | "vision_doubt" | "context_mismatch"
  reason: string; // короткое объяснение для админа
  confidence: number | null; // 0..1
  checkedAt: string; // ISO
  model: string | null;
};

export type RecentCalib = {
  id: string;
  receivedAt: string;
  receivedFromIp: string;
  fromAddress: string;
  toAddress: string;
  // Точные адреса (улица + дом) от Google Reverse Geocoding по
  // координатам fromLat/fromLng и toLat/toLng. Заполняются процессором
  // process-screens при создании calib и догоняются скриптом
  // enrich-addresses-vps.mjs для исторических файлов. Если в файле
  // ничего не записано — приходит пустая строка, фронт падает на
  // оригинальный fromAddress/toAddress (то, что вытащил Vision из скрина —
  // часто POI вроде «Дворец спорта», без улицы и дома).
  fromAddressGeo: string;
  toAddressGeo: string;
  fromLat: number | null;
  fromLng: number | null;
  toLat: number | null;
  toLng: number | null;
  factE: number | null;
  factC: number | null;
  etaMin: number | null;
  // Минуты поездки со скрина Yandex (надпись «22 мин» рядом с ценой) —
  // это РЕАЛЬНОЕ время поездки с учётом текущих пробок, важнее чем км
  // по прямой. Когда есть, модель прогноза должна использовать его, а не
  // оценку estimateTripMin(km) = max(5, round(km * 2.5)).
  tripMin: number | null;
  demand: string | null;
  date: string;
  hour: number | null;
  source: string;
  notes: string;
  anomaly: CalibAnomaly | null;
};

export type RecentCalibsResult =
  | { ok: true; total: number; items: RecentCalib[] }
  | { ok: false; error: string; status?: number };

export async function fetchRecentCalibs(
  limit: number = 50,
): Promise<RecentCalibsResult> {
  const base = baseUrl();
  if (!base) return { ok: false, error: "no_endpoint" };
  const lim = Math.max(1, Math.min(200, Math.round(limit)));
  try {
    const res = await fetch(`${base}/recent-calibs?limit=${lim}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* ignore */
    }
    if (!res.ok || !json?.ok) {
      return {
        ok: false,
        status: res.status,
        error: json?.error ?? `http_${res.status}`,
      };
    }
    const items: RecentCalib[] = Array.isArray(json.items)
      ? json.items.map((r: any) => {
          let anomaly: CalibAnomaly | null = null;
          if (r.anomaly && typeof r.anomaly === "object") {
            const a = r.anomaly;
            const sev = a.severity;
            anomaly = {
              suspicious: a.suspicious === true,
              severity:
                sev === "low" || sev === "med" || sev === "high" ? sev : null,
              category: a.category == null ? null : String(a.category),
              reason: String(a.reason ?? ""),
              confidence:
                typeof a.confidence === "number" ? a.confidence : null,
              checkedAt: String(a.checkedAt ?? ""),
              model: a.model == null ? null : String(a.model),
            };
          }
          return {
            id: String(r.id ?? ""),
            receivedAt: String(r.receivedAt ?? ""),
            receivedFromIp: String(r.receivedFromIp ?? ""),
            fromAddress: String(r.fromAddress ?? ""),
            toAddress: String(r.toAddress ?? ""),
            fromLat: typeof r.fromLat === "number" ? r.fromLat : null,
            fromLng: typeof r.fromLng === "number" ? r.fromLng : null,
            toLat: typeof r.toLat === "number" ? r.toLat : null,
            toLng: typeof r.toLng === "number" ? r.toLng : null,
            factE: typeof r.factE === "number" ? r.factE : null,
            factC: typeof r.factC === "number" ? r.factC : null,
            etaMin: typeof r.etaMin === "number" ? r.etaMin : null,
            tripMin: typeof r.tripMin === "number" ? r.tripMin : null,
            demand: r.demand == null ? null : String(r.demand),
            date: String(r.date ?? ""),
            hour: typeof r.hour === "number" ? r.hour : null,
            source: String(r.source ?? ""),
            notes: String(r.notes ?? ""),
            anomaly,
          };
        })
      : [];
    return { ok: true, total: Number(json.total) || items.length, items };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "network_error" };
  }
}

// ───────────── /pipeline-stats и /pipeline-requeue (мониторинг) ─────────────
// Плашка в админ-окне «План vs факт» показывает что есть в очереди и сколько
// упало в failed (с разбивкой по причине). Кнопка «Перезапустить failed»
// перекладывает все vision_all_failed обратно в incoming — следующий тик cron
// (process-screens.mjs) их подхватит.
export type PipelineBucket = {
  uploaded: number;
  ok: number;
  failed: number;
  calibCreated: number;
};

export type PipelineStats = {
  ok: true;
  now: string;
  last1h: PipelineBucket;
  last24h: PipelineBucket;
  failedReasons: Record<string, number>;
  inFailedRetryable: number;
  incomingPending: number;
  oldestPendingAt: string | null;
  oldestPendingMin: number | null;
  lastSuccessAt: string | null;
  lastSuccessMinAgo: number | null;
  calibTotal: number;
};

export async function fetchPipelineStats(): Promise<
  PipelineStats | { ok: false; error: string; status?: number }
> {
  const base = baseUrl();
  if (!base) return { ok: false, error: "no_endpoint" };
  try {
    const res = await fetch(`${base}/pipeline-stats`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* ignore */
    }
    if (!res.ok || !json?.ok) {
      return {
        ok: false,
        status: res.status,
        error: json?.error ?? `http_${res.status}`,
      };
    }
    const bucket = (b: any): PipelineBucket => ({
      uploaded: Number(b?.uploaded) || 0,
      ok: Number(b?.ok) || 0,
      failed: Number(b?.failed) || 0,
      calibCreated: Number(b?.calibCreated) || 0,
    });
    const fr: Record<string, number> = {};
    if (json.failedReasons && typeof json.failedReasons === "object") {
      for (const [k, v] of Object.entries(json.failedReasons)) {
        fr[String(k)] = Number(v) || 0;
      }
    }
    return {
      ok: true,
      now: String(json.now ?? ""),
      last1h: bucket(json.last1h),
      last24h: bucket(json.last24h),
      failedReasons: fr,
      inFailedRetryable: Number(json.inFailedRetryable) || 0,
      incomingPending: Number(json.incomingPending) || 0,
      oldestPendingAt:
        typeof json.oldestPendingAt === "string" ? json.oldestPendingAt : null,
      oldestPendingMin:
        typeof json.oldestPendingMin === "number" ? json.oldestPendingMin : null,
      lastSuccessAt:
        typeof json.lastSuccessAt === "string" ? json.lastSuccessAt : null,
      lastSuccessMinAgo:
        typeof json.lastSuccessMinAgo === "number"
          ? json.lastSuccessMinAgo
          : null,
      calibTotal: Number(json.calibTotal) || 0,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "network_error" };
  }
}

export type RequeueResult =
  | { ok: true; moved: number; skipped: number }
  | { ok: false; error: string; status?: number };

export async function requeueFailedScreens(
  wbToken: string,
): Promise<RequeueResult> {
  const base = baseUrl();
  if (!base) return { ok: false, error: "no_endpoint" };
  try {
    const res = await fetch(`${base}/pipeline-requeue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${wbToken}`,
      },
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* ignore */
    }
    if (!res.ok || !json?.ok) {
      return {
        ok: false,
        status: res.status,
        error: json?.error ?? `http_${res.status}`,
      };
    }
    return {
      ok: true,
      moved: Number(json.moved) || 0,
      skipped: Number(json.skipped) || 0,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "network_error" };
  }
}
