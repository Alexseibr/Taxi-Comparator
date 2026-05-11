// Клиент для WB-вкладки (rwbtaxi.by/wb).
// Все эндпоинты идут через nginx /api/wb/ → 127.0.0.1:3011/wb/*.
//
// Аутентификация: основной канал — HttpOnly+Secure+SameSite=Lax cookie
// `rwb_sid`, который ставится сервером в /wb/login и автоматически
// летит с любым fetch при `credentials: 'include'`. Старый Bearer-токен
// продолжаем класть в localStorage и слать в Authorization для обратной
// совместимости с сессиями, открытыми ДО релиза cookie-миграции (через
// 1–2 недели localStorage можно будет полностью убрать).

const TOKEN_KEY = "wb_session_v1";
const TOKEN_EXP_KEY = "wb_session_exp_v1";
const USER_KEY = "wb_user_v1";

function baseUrl(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/api/wb`;
}

export function getWbToken(): string | null {
  try {
    const t = window.localStorage.getItem(TOKEN_KEY);
    const exp = Number(window.localStorage.getItem(TOKEN_EXP_KEY) || "0");
    if (!t || !exp || exp < Date.now()) return null;
    return t;
  } catch {
    return null;
  }
}

// Кастомное событие, которое слушает WbAuthGate, чтобы реактивно
// показать/скрыть форму логина после программного входа/выхода или 401.
const WB_AUTH_EVENT = "wb-auth-changed";

export function onWbAuthChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(WB_AUTH_EVENT, handler);
  return () => window.removeEventListener(WB_AUTH_EVENT, handler);
}

function emitWbAuthChanged(): void {
  try {
    window.dispatchEvent(new Event(WB_AUTH_EVENT));
  } catch {
    /* noop */
  }
}

export function setWbToken(token: string, expiresAt: number): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(TOKEN_EXP_KEY, String(expiresAt));
  } catch {
    /* noop */
  }
  emitWbAuthChanged();
}

export function clearWbToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(TOKEN_EXP_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch {
    /* noop */
  }
  emitWbAuthChanged();
}

// Полный logout: просим сервер инвалидировать сессию (по cookie и/или
// Bearer) и сбросить cookie, потом очищаем локальное состояние. Шлём
// запрос всегда (а не только при наличии Bearer-токена), потому что
// сессия может жить ТОЛЬКО в HttpOnly-cookie — её JS не видит.
export async function wbLogout(): Promise<void> {
  try {
    const t = getWbToken();
    const headers: Record<string, string> = {};
    if (t) headers["Authorization"] = `Bearer ${t}`;
    await fetch(`${baseUrl()}/logout`, {
      method: "POST",
      credentials: "include",
      headers,
    });
  } catch {
    /* network noop */
  }
  clearWbToken();
}

async function authedFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  // Cookie прилетит автоматически при credentials:'include'. Bearer
  // добавляем как fallback, если в localStorage ещё лежит токен от
  // pre-cookie сессии. После полной миграции эту ветку можно удалить.
  const headers = new Headers(init?.headers);
  const t = getWbToken();
  if (t && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${t}`);
  }
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
}

export type WbLoginResult =
  | { ok: true; token: string; expiresAt: number; user?: WbUser }
  | { ok: false; error: string };

export async function wbLogin(
  login: string,
  password: string,
): Promise<WbLoginResult> {
  try {
    const res = await fetch(`${baseUrl()}/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      return { ok: false, error: json?.error || `http_${res.status}` };
    }
    setWbToken(json.token, json.expiresAt);
    // Кладём профиль в localStorage сразу — useWbCurrentUser подхватит
    // без лишнего roundtrip к /wb/me и без «мигания» админ-кнопок.
    if (json.user) {
      try {
        window.localStorage.setItem(USER_KEY, JSON.stringify(json.user));
      } catch {
        /* noop */
      }
    }
    return { ok: true, token: json.token, expiresAt: json.expiresAt, user: json.user };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network_error" };
  }
}

export type WbDashboardSnapshot = {
  range: { fromMs: number | null; toMs: number | null };
  orders: number;
  completed: number;
  cancelled: number;
  open: number;
  activeClients: number;
  activeDrivers: number;
  totalClients: number;
  totalDrivers: number;
  newClients: number;
  newDrivers: number;
  repeatTrips: number;
  crossTrips: number;
  shortPickupTrips: number;
  linkedTrips: number;
  fraudSuspectTrips: number;
  revenueTotal: number;
  avgCheck: number;
  avgKm: number;
  avgTripMin: number;
  avgFta: number;
  avgSpeedKmh: number;
  // Финансовые показатели по аномалиям.
  // fraudGmvBYN — сумма GMV по фрод-заказам (для контекста, пока нет
  // driver_payout). fraudDriverPayoutBYN: null до прихода выгрузки.
  // *CashbackBYN — 30% × GMV безналичных (paymentType='4') completed-заказов
  // в множестве linked / cross / shortPickup.
  fraudGmvBYN: number;
  fraudDriverPayoutBYN: number | null;
  linkedCashbackBYN: number;
  crossCashbackBYN: number;
  shortPickupCashbackBYN: number;
};

export type WbStats = {
  ok: true;
  totals: {
    orders: number;
    completed: number;
    cancelled: number;
    cancelRate: number;
    uniqueClients: number;
    uniqueDrivers: number;
  };
  averages: Record<string, { avg: number; median: number }>;
  regression: { intercept: number; perKm: number; perMin: number } | null;
  hourly: Array<{
    hour: number;
    count: number;
    avgKm: number;
    avgGmv: number;
    avgPpk: number;
  }>;
  daily: Array<{
    date: string;
    total: number;
    completed: number;
    cancelled: number;
  }>;
  dashboard?: WbDashboardSnapshot;
  compare?: WbDashboardSnapshot | null;
};

export type WbDateRange = {
  fromTs?: string | null;
  toTs?: string | null;
};

// ───────── Граф связей (/wb/graph) ─────────
export type WbGraphNodeKind = "client" | "driver" | "franch";
export type WbGraphEdgeKind =
  | "client-driver"
  | "driver-franch"
  | "driver-driver";
export type WbGraphNode = {
  id: string; // "c:18914377" / "d:457795" / "f:8729"
  kind: WbGraphNodeKind;
  label: string; // голый ID без префикса
  trips: number;
  gmv: number;
  role: "focus" | "neighbor";
};
export type WbGraphEdge = {
  source: string;
  target: string;
  kind: WbGraphEdgeKind;
  weight: number;
  gmv: number;
};
export type WbGraphResponse = {
  ok: true;
  focus: string | null;
  focusFound?: boolean;
  nodes: WbGraphNode[];
  edges: WbGraphEdge[];
  stats: { totalNodes: number; totalEdges: number; truncated: boolean };
};

export async function fetchWbGraph(params: {
  fromTs?: string;
  toTs?: string;
  focus?: string | null; // "client:ID" / "driver:ID" / "franch:ID"
  depth?: 1 | 2;
  minWeight?: number;
  includeFranchs?: boolean;
  limit?: number;
}): Promise<WbGraphResponse> {
  const q = new URLSearchParams();
  if (params.fromTs) q.set("fromTs", params.fromTs);
  if (params.toTs) q.set("toTs", params.toTs);
  if (params.focus) q.set("focus", params.focus);
  if (params.depth) q.set("depth", String(params.depth));
  if (params.minWeight) q.set("minWeight", String(params.minWeight));
  if (params.includeFranchs === false) q.set("includeFranchs", "0");
  if (params.limit) q.set("limit", String(params.limit));
  const r = await authedFetch(`/graph?${q.toString()}`);
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.json();
}

// ───────── Анализ графа через Gemini (/wb/graph/analyze) ─────────
export type WbGraphFindingType =
  | "hub_driver"
  | "collusion"
  | "self_order"
  | "isolated_cluster"
  | "gmv_outlier"
  | "unknown";

export type WbGraphFinding = {
  type: WbGraphFindingType | string;
  severity: number; // 1..5
  nodeIds: string[]; // совпадает с id в WbGraphNode
  explanation: string;
};

export type WbGraphAnalysis = {
  ok: true;
  model: string;
  elapsedMs: number;
  tokens: { in?: number; out?: number } | null;
  stats: {
    nodes: { total: number };
    byKind: { c: number; d: number; f: number };
    edges: { total: number; cd: number; df: number; dd: number };
  };
  summary: string;
  findings: WbGraphFinding[];
  generatedAt: string;
  cached?: boolean;
};

export async function analyzeWbGraph(payload: {
  nodes: WbGraphNode[];
  edges: WbGraphEdge[];
  period?: string;
  focus?: string | null;
}): Promise<WbGraphAnalysis> {
  const r = await authedFetch(`/graph/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nodes: payload.nodes,
      edges: payload.edges,
      period: payload.period || "",
      focus: payload.focus || "",
    }),
  });
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  if (r.status === 503) {
    throw new Error("gemini_not_configured");
  }
  if (!r.ok) {
    let detail = "";
    try {
      const j = await r.json();
      detail = j?.detail || j?.error || "";
    } catch {
      /* ignore */
    }
    throw new Error(detail ? `analyze_failed:${detail}` : `http_${r.status}`);
  }
  return r.json();
}

export type WbStatusFilter = "all" | "completed" | "cancelled" | "open";

function _rangeQs(range?: WbDateRange): string {
  if (!range) return "";
  const q = new URLSearchParams();
  if (range.fromTs) q.set("fromTs", range.fromTs);
  if (range.toTs) q.set("toTs", range.toTs);
  const s = q.toString();
  return s ? `?${s}` : "";
}

function _heatmapQs(
  range?: WbDateRange,
  status?: WbStatusFilter,
): string {
  const q = new URLSearchParams();
  if (range?.fromTs) q.set("fromTs", range.fromTs);
  if (range?.toTs) q.set("toTs", range.toTs);
  if (status && status !== "all") q.set("status", status);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function fetchWbStats(range?: WbDateRange): Promise<WbStats> {
  const r = await authedFetch(`/stats${_rangeQs(range)}`);
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.json();
}

export type WbOrder = {
  orderId: string;
  orderDate: string;
  createdAt: string;
  cancelledAt: string | null;
  fta: number | null;
  gmv: number | null;
  km: number | null;
  tripMin: number | null;
  clientId: string;
  driverId: string;
  status: "completed" | "cancelled" | "open";
  batchId?: string;
  uploadedAt?: string;
  // Тип оплаты, как пришёл из CSV (строка). По текущей выгрузке:
  // "4" → безнал/карта, "0" → наличные. Другие коды — выводим «код N».
  paymentType?: string | null;
  // ID парка/франчайзи (informSource в исходных данных).
  franchId?: string | null;
  // Опциональное обогащение из /wb/orders?withFraudMarks=1.
  autoFraud?: boolean;
  // Конкретные причины, по которым автодетектор пометил ИМЕННО этот заказ
  // (per-order). Используется для тултипа на бейдже «авто». Если бэкенд
  // старый — поле может отсутствовать или быть пустым массивом, тогда фронт
  // показывает общий контекст подозрений по водителю.
  autoFraudReasons?: string[];
  manualFraud?: boolean;
  // САМ ФАКТ ручной отметки (для UI-кнопок «фрод/не фрод»):
  //   null       — никто не трогал
  //   "fraud"    — антифродер подтвердил, что это реальный фрод
  //   "notfraud" — антифродер явно снял подозрение (ложное срабатывание)
  manualMark?: "fraud" | "notfraud" | null;
  manualFraudBy?: string | null;
  manualFraudAt?: number | null;
};

export type WbFranchDetail = {
  ok: true;
  kind: "franch";
  id: string;
  summary: WbEntitySummary & {
    uniqueDrivers: number;
    uniqueClients: number;
  };
  topDrivers: Array<{
    driverId: string;
    driverName: string | null;
    total: number;
    completed: number;
    cancelled: number;
    cancelRate: number;
    gmvSum: number;
    uniqueClients: number;
  }>;
  topClients: Array<{
    clientId: string;
    total: number;
    completed: number;
    cancelled: number;
    cancelRate: number;
    gmvSum: number;
    uniqueDrivers: number;
  }>;
  byDay: Array<{ date: string; total: number; completed: number; cancelled: number }>;
  byHour: Array<{ hour: number; total: number; completed: number; cancelled: number }>;
  byWeekday: Array<{ weekday: number; total: number; completed: number; cancelled: number }>;
  orders: WbOrder[];
};

export async function fetchWbFranch(id: string): Promise<WbFranchDetail> {
  const r = await authedFetch(`/franch/${encodeURIComponent(id)}`);
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  if (r.status === 404) throw new Error("not_found");
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.json();
}

export async function fetchWbOrders(params: {
  limit?: number;
  offset?: number;
  status?: string;
  date?: string;
  clientId?: string;
  driverId?: string;
  fromTs?: string;
  toTs?: string;
  // Аномалийные фильтры (бэк подключает контекст окна).
  repeat?: boolean;
  cross?: boolean;
  shortPickup?: boolean;
  fraudSuspect?: boolean;
  linked?: boolean;
  firstSeen?: boolean;
  hour?: number;
  // Если true, бэк дополнит каждую запись флагами autoFraud/manualFraud
  // и метаданными ручной пометки. Чуть тяжелее по CPU — включай ТОЛЬКО когда
  // флаги действительно показываются в UI.
  withFraudMarks?: boolean;
}): Promise<{ ok: true; total: number; items: WbOrder[] }> {
  const q = new URLSearchParams();
  if (params.limit) q.set("limit", String(params.limit));
  if (params.offset) q.set("offset", String(params.offset));
  if (params.status && params.status !== "all") q.set("status", params.status);
  if (params.date) q.set("date", params.date);
  if (params.clientId) q.set("clientId", params.clientId);
  if (params.driverId) q.set("driverId", params.driverId);
  if (params.fromTs) q.set("fromTs", params.fromTs);
  if (params.toTs) q.set("toTs", params.toTs);
  if (params.repeat) q.set("repeat", "1");
  if (params.cross) q.set("cross", "1");
  if (params.shortPickup) q.set("shortPickup", "1");
  if (params.fraudSuspect) q.set("fraudSuspect", "1");
  if (params.linked) q.set("linked", "1");
  if (params.firstSeen) q.set("firstSeen", "1");
  if (typeof params.hour === "number" && params.hour >= 0 && params.hour < 24) {
    q.set("hour", String(params.hour));
  }
  if (params.withFraudMarks) q.set("withFraudMarks", "1");
  const r = await authedFetch(`/orders?${q.toString()}`);
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.json();
}

export type WbTimelineBucket = {
  ts: string;
  ms: number;
  total: number;
  completed: number;
  cancelled: number;
  open: number;
};
export type WbTimelineBucketKind = "10m" | "30m" | "1h";
export type WbTimelineResponse = {
  ok: true;
  bucket: WbTimelineBucketKind;
  bucketMs: number;
  from: string | null;
  to: string | null;
  total: number;
  buckets: WbTimelineBucket[];
};
export type WbTimelineError = {
  ok: false;
  error: string;
  expectedBuckets?: number;
  maxBuckets?: number;
  hint?: string;
};

export async function fetchWbTimeline(params: {
  bucket?: WbTimelineBucketKind;
  fromTs?: string;
  toTs?: string;
}): Promise<WbTimelineResponse> {
  const q = new URLSearchParams();
  if (params.bucket) q.set("bucket", params.bucket);
  if (params.fromTs) q.set("fromTs", params.fromTs);
  if (params.toTs) q.set("toTs", params.toTs);
  const r = await authedFetch(`/timeline?${q.toString()}`);
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as WbTimelineError | null;
    throw new Error(body?.hint || body?.error || `http_${r.status}`);
  }
  return r.json();
}

export type WbPairs = {
  ok: true;
  topClients: Array<{
    clientId: string;
    total: number;
    completed: number;
    cancelled: number;
    gmvSum: number;
    uniqueDrivers: number;
    cancelRate: number;
  }>;
  topDrivers: Array<{
    driverId: string;
    total: number;
    completed: number;
    cancelled: number;
    gmvSum: number;
    uniqueClients: number;
    cancelRate: number;
  }>;
  topPairs: Array<{
    clientId: string;
    driverId: string;
    total: number;
    completed: number;
    cancelled: number;
    gmvSum: number;
  }>;
};

export async function fetchWbPairs(
  limit = 50,
  range?: WbDateRange,
): Promise<WbPairs> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (range?.fromTs) q.set("fromTs", range.fromTs);
  if (range?.toTs) q.set("toTs", range.toTs);
  const r = await authedFetch(`/pairs?${q.toString()}`);
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.json();
}

export type WbNewDriverReason = {
  severity: "low" | "med" | "high" | "critical";
  label: string;
};
export type WbNewDriverItem = {
  driverId: string;
  firstSeenAt: string;
  total: number;
  completed: number;
  cancelled: number;
  open: number;
  cancelRate: number;
  gmvSum: number;
  kmSum: number;
  avgPpk: number | null;
  avgFta: number | null;
  avgSpeed: number | null;
  uniqueClients: number;
  topPartner: { clientId: string; count: number; share: number } | null;
  score: number;
  severity: "clean" | "low" | "med" | "high" | "critical" | string;
  reasons: WbNewDriverReason[];
};
export type WbNewDriversResponse = {
  ok: true;
  from: string | null;
  to: string | null;
  totalNew: number;
  thresholds: { ppkP95: number; cancelP90: number };
  items: WbNewDriverItem[];
};

export async function fetchWbNewDrivers(
  range?: WbDateRange,
): Promise<WbNewDriversResponse> {
  const r = await authedFetch(`/new-drivers${_rangeQs(range)}`);
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.json();
}

export type WbUploadResult =
  | {
      ok: true;
      batchId: string;
      parsed: number;
      dups: number;
      bad: number;
      added: number;
    }
  | { ok: false; error: string };

export type WbHeatmapCell = {
  total: number;
  completed: number;
  cancelled: number;
  cancelRate: number;
  gmvSum: number;
};
export type WbPickupPoint = {
  lat: number;
  lng: number;
  count: number;
  completed: number;
  cancelled: number;
  cancelRate: number;
  gmvSum: number;
  avgPrice?: number | null;
  selfRideCount?: number;
};
export type WbHeatmap = {
  ok: true;
  cells: WbHeatmapCell[][]; // [7 weekdays][24 hours]
  byWeekday: Array<{
    weekday: number;
    total: number;
    completed: number;
    cancelled: number;
    cancelRate: number;
    gmvSum: number;
    kmSum: number;
  }>;
  byHour: Array<{
    hour: number;
    total: number;
    completed: number;
    cancelled: number;
    cancelRate: number;
    gmvSum: number;
    kmSum: number;
    avgGmv?: number;
    medianGmv?: number;
    avgPricePerKm?: number;
    medianPricePerKm?: number;
  }>;
  byDistance: Array<{
    label: string;
    from: number;
    to: number | null;
    total: number;
    completed: number;
    cancelled: number;
    cancelRate: number;
    gmvSum: number;
  }>;
  geo?: {
    pickup: WbPickupPoint[];
    buckets: number;
    withCoords: number;
    precision: number;
  };
  meta?: {
    total: number;
    withCoords: number;
    coverage: number;
    status?: WbStatusFilter;
  };
};

export async function fetchWbHeatmap(
  range?: WbDateRange,
  status?: WbStatusFilter,
): Promise<WbHeatmap> {
  const r = await authedFetch(`/heatmap${_heatmapQs(range, status)}`);
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.json();
}

export type WbClientRow = {
  clientId: string;
  total: number;
  completed: number;
  cancelled: number;
  cancelRate: number;
  gmvSum: number;
  kmSum: number;
  uniqueDrivers: number;
  firstDate: string | null;
  lastDate: string | null;
};
export type WbDriverRow = {
  driverId: string;
  total: number;
  completed: number;
  cancelled: number;
  cancelRate: number;
  gmvSum: number;
  kmSum: number;
  uniqueClients: number;
  firstDate: string | null;
  lastDate: string | null;
};

export type WbListFilters = {
  minOrders?: number;
  maxCancelRate?: number; // 0..1
  minCancelRate?: number;
  minGmv?: number;
  search?: string;
  sortBy?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

function _filtersToQuery(f: WbListFilters): string {
  const q = new URLSearchParams();
  if (f.minOrders) q.set("minOrders", String(f.minOrders));
  if (f.maxCancelRate != null) q.set("maxCancelRate", String(f.maxCancelRate));
  if (f.minCancelRate != null) q.set("minCancelRate", String(f.minCancelRate));
  if (f.minGmv) q.set("minGmv", String(f.minGmv));
  if (f.search) q.set("search", f.search);
  if (f.sortBy) q.set("sortBy", f.sortBy);
  if (f.order) q.set("order", f.order);
  if (f.limit) q.set("limit", String(f.limit));
  if (f.offset) q.set("offset", String(f.offset));
  return q.toString();
}

export async function fetchWbClients(
  f: WbListFilters = {},
): Promise<{ ok: true; total: number; items: WbClientRow[] }> {
  const r = await authedFetch(`/clients?${_filtersToQuery(f)}`);
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.json();
}

export async function fetchWbDrivers(
  f: WbListFilters = {},
): Promise<{ ok: true; total: number; items: WbDriverRow[] }> {
  const r = await authedFetch(`/drivers?${_filtersToQuery(f)}`);
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.json();
}

export type WbEntitySummary = {
  total: number;
  completed: number;
  cancelled: number;
  cancelRate: number;
  gmvSum: number;
  avgKm: number;
  avgTripMin: number;
  avgGmv: number;
  firstDate: string | null;
  lastDate: string | null;
  uniquePartners: number;
  uniqueAutos?: number;
  fastCancelCount?: number;
  subsidyCount?: number;
  subsidyShare?: number;
  avgFta?: number;
  avgClientWait?: number;
};

export type WbClientIdentity = {
  name: string | null;
  phone: string | null;
};

export type WbDriverIdentity = {
  name: string | null;
  phone: string | null;
  autoNumber: string | null;
  autoId: string | null;
};

export type WbAutoUsage = {
  autoId: string;
  autoNumber: string | null;
  count: number;
};

export type WbEntityDetail = {
  ok: true;
  kind: "client" | "driver";
  id: string;
  identity?: WbClientIdentity | WbDriverIdentity;
  summary: WbEntitySummary;
  partners: Array<{
    clientId?: string;
    driverId?: string;
    total: number;
    completed: number;
    cancelled: number;
    cancelRate: number;
    gmvSum: number;
    // Обогащение: имя/телефон контрагента, госномер машины (для водителя).
    clientName?: string | null;
    clientPhone?: string | null;
    driverName?: string | null;
    driverPhone?: string | null;
    autoNumber?: string | null;
    autoId?: string | null;
  }>;
  // Только для kind=driver: машины, на которых ездил водитель.
  autos?: WbAutoUsage[];
  byDay: Array<{
    date: string;
    total: number;
    completed: number;
    cancelled: number;
  }>;
  byHour: Array<{
    hour: number;
    total: number;
    completed: number;
    cancelled: number;
  }>;
  byWeekday: Array<{
    weekday: number;
    total: number;
    completed: number;
    cancelled: number;
  }>;
  routes: WbRouteCluster[];
  points: WbTripPoint[];
  orders: WbOrder[];
};

export type WbRouteCluster = {
  key: string;
  count: number;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  kmSum: number;
  gmvSum: number;
  avgKm: number;
  avgGmv: number;
  distM: number;
};

export type WbTripPoint = {
  orderId: string;
  clientId: string | null;
  driverId: string | null;
  status: string;
  latIn: number;
  lngIn: number;
  latOut: number | null;
  lngOut: number | null;
  km: number | null;
  gmv: number | null;
  tripMin: number | null;
  createdAt: string | null;
  isSelfRide: boolean;
  speedAnomaly: "fake_gps" | "too_fast" | "too_slow" | null;
  // Обогащение из CSV-импорта.
  driverName?: string | null;
  autoNumber?: string | null;
  autoId?: string | null;
  paymentType?: string | null;
  paymentType2?: string | null;
  isSubsidy?: boolean;
  fta?: number | null;
  clientWait?: number | null;
  passengerPhone?: string | null;
};

export async function fetchWbClient(id: string): Promise<WbEntityDetail> {
  const r = await authedFetch(`/client/${encodeURIComponent(id)}`);
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  if (r.status === 404) throw new Error("not_found");
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.json();
}

export async function fetchWbDriver(id: string): Promise<WbEntityDetail> {
  const r = await authedFetch(`/driver/${encodeURIComponent(id)}`);
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  if (r.status === 404) throw new Error("not_found");
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.json();
}

export type WbPairDetail = {
  ok: true;
  kind: "pair";
  clientId: string;
  driverId: string;
  clientIdentity?: WbClientIdentity;
  driverIdentity?: WbDriverIdentity;
  summary: WbEntitySummary;
  clientTotal: number;
  driverTotal: number;
  shareOfClient: number;
  shareOfDriver: number;
  byDay: Array<{
    date: string;
    total: number;
    completed: number;
    cancelled: number;
  }>;
  byHour: Array<{
    hour: number;
    total: number;
    completed: number;
    cancelled: number;
  }>;
  byWeekday: Array<{
    weekday: number;
    total: number;
    completed: number;
    cancelled: number;
  }>;
  routes: WbRouteCluster[];
  points: WbTripPoint[];
  orders: WbOrder[];
};

export async function fetchWbPair(
  clientId: string,
  driverId: string,
): Promise<WbPairDetail> {
  const r = await authedFetch(
    `/pair/${encodeURIComponent(clientId)}/${encodeURIComponent(driverId)}`,
  );
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  if (r.status === 404) throw new Error("not_found");
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.json();
}

export type WbFraudReason = {
  code: string;
  severity: "low" | "med" | "high" | "critical";
  label: string;
  autoId?: string | null;
  autoNumber?: string | null;
  driverCount?: number;
};
export type WbFraudClient = {
  clientId: string;
  clientName?: string | null;
  clientPhone?: string | null;
  total: number;
  cancelled: number;
  cancelRate: number;
  topPartner: { driverId: string; count: number; share: number } | null;
  score: number;
  severity: "low" | "med" | "high" | "critical";
  reasons: WbFraudReason[];
};
export type WbFraudDriver = {
  driverId: string;
  driverName?: string | null;
  driverPhone?: string | null;
  autoNumber?: string | null;
  autoId?: string | null;
  total: number;
  cancelled: number;
  cancelRate: number;
  topPartner: { clientId: string; count: number; share: number } | null;
  score: number;
  severity: "low" | "med" | "high" | "critical";
  reasons: WbFraudReason[];
};
export type WbFraudPair = {
  clientId: string;
  driverId: string;
  clientName?: string | null;
  clientPhone?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  autoNumber?: string | null;
  total: number;
  cancelled: number;
  cancelRate: number;
  shareOfClient: number;
  shareOfDriver: number;
  score: number;
  severity: "low" | "med" | "high" | "critical";
  reasons: WbFraudReason[];
};
export type WbFraudOrder = {
  orderId: string;
  score: number;
  severity: "low" | "med" | "high" | "critical";
  reasons: WbFraudReason[];
  createdAt: string;
  status: "completed" | "cancelled" | "open";
  clientId: string;
  driverId: string;
  km: number | null;
  gmv: number | null;
  fta: number | null;
  tripMin: number | null;
};
export type WbFraudReport = {
  ok: true;
  generatedAt: string;
  stats: {
    totalOrders: number;
    totalClients: number;
    totalDrivers: number;
    flaggedClients: number;
    flaggedDrivers: number;
    flaggedPairs: number;
    flaggedOrders: number;
  };
  thresholds: {
    ppkP95: number;
    ppkP99: number;
    ftaP95: number;
    clientMinTotal: number;
    driverMinTotal: number;
    pairMinTotal: number;
  };
  clients: WbFraudClient[];
  drivers: WbFraudDriver[];
  pairs: WbFraudPair[];
  orders: WbFraudOrder[];
};

export async function fetchWbFraud(params: {
  fromTs?: string | null;
  toTs?: string | null;
} = {}): Promise<WbFraudReport> {
  // Серверный /wb/fraud принимает fromTs/toTs (см. _parseTimeRange в
  // screen-receiver.mjs) — это позволяет подгружать сигналы фрода за
  // выбранный антифродером период, а не «за всё время».
  const sp = new URLSearchParams();
  if (params.fromTs) sp.set("fromTs", params.fromTs);
  if (params.toTs) sp.set("toTs", params.toTs);
  const qs = sp.toString();
  const r = await authedFetch(`/fraud${qs ? "?" + qs : ""}`);
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.json();
}

export async function uploadWbCsv(csvText: string): Promise<WbUploadResult> {
  try {
    const r = await authedFetch("/upload", {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: csvText,
    });
    if (r.status === 401) {
      clearWbToken();
      return { ok: false, error: "unauthorized" };
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) {
      return { ok: false, error: j?.error || `http_${r.status}` };
    }
    return j;
  } catch (e: any) {
    return { ok: false, error: e?.message || "network_error" };
  }
}

// ─────────────── RBAC + Cases ───────────────────────────────────────────────

export type WbRole = "admin" | "antifraud" | "viewer";

export type WbUser = {
  id: string;
  login: string;
  role: WbRole;
  displayName: string;
  disabled?: boolean;
  createdAt?: number;
  createdBy?: string | null;
};

export type WbCaseSignal = {
  code?: string;
  severity?: "low" | "med" | "high" | "critical";
  label?: string;
};

export type WbCaseComment = {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  at: number;
};

export type WbCaseResolution = "confirmed" | "rejected" | "unclear" | null;

export type WbCase = {
  id: string;
  subjectType: "driver" | "client";
  subjectId: string;
  subjectName: string | null;
  signals: WbCaseSignal[];
  score: number | null;
  status: "in_progress" | "closed";
  assigneeId: string | null;
  assigneeName: string | null;
  takenAt: number | null;
  resolution: WbCaseResolution;
  resolutionNote: string;
  actionTaken: string;
  bonusesApplied: boolean;
  bonusesPeriod: string;
  closedAt: number | null;
  closedById: string | null;
  closedByName: string | null;
  createdAt: number;
  updatedAt: number;
  comments: WbCaseComment[];
};

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.status === 401) {
    clearWbToken();
    throw new Error("unauthorized");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j as any)?.ok === false) {
    throw new Error((j as any)?.error || `http_${r.status}`);
  }
  return j as T;
}

// ── /wb/me ──────────────────────────────────────────────────────────────────

export async function fetchWbMe(): Promise<WbUser> {
  const r = await authedFetch("/me");
  const j = await jsonOrThrow<{ user: WbUser }>(r);
  return j.user;
}

// ── Users (admin) ──────────────────────────────────────────────────────────

export async function fetchWbUsers(): Promise<WbUser[]> {
  const r = await authedFetch("/users");
  const j = await jsonOrThrow<{ users: WbUser[] }>(r);
  return j.users || [];
}

export async function createWbUser(input: {
  login: string;
  role: WbRole;
  displayName: string;
  password?: string;
}): Promise<{ user: WbUser; password: string }> {
  const r = await authedFetch("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<{ user: WbUser; password: string }>(r);
}

export async function updateWbUser(
  id: string,
  patch: Partial<{
    displayName: string;
    disabled: boolean;
    role: WbRole;
    resetPassword: boolean;
    password: string;
  }>,
): Promise<{ user: WbUser; password?: string }> {
  const r = await authedFetch(`/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<{ user: WbUser; password?: string }>(r);
}

export async function deleteWbUser(id: string): Promise<void> {
  const r = await authedFetch(`/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await jsonOrThrow<{ ok: true }>(r);
}

// ── Cases ──────────────────────────────────────────────────────────────────

export type WbCasesQuery = {
  status?: "open" | "closed" | "all";
  subjectType?: "driver" | "client";
  subjectId?: string;
  assignee?: "me" | "any" | string;
  limit?: number;
};

export async function fetchWbCases(q: WbCasesQuery = {}): Promise<WbCase[]> {
  const sp = new URLSearchParams();
  if (q.status) sp.set("status", q.status);
  if (q.subjectType) sp.set("subjectType", q.subjectType);
  if (q.subjectId) sp.set("subjectId", q.subjectId);
  if (q.assignee) sp.set("assignee", q.assignee);
  if (q.limit) sp.set("limit", String(q.limit));
  const qs = sp.toString();
  const r = await authedFetch(`/cases${qs ? "?" + qs : ""}`);
  const j = await jsonOrThrow<{ cases: WbCase[] }>(r);
  return j.cases || [];
}

export async function fetchWbCase(id: string): Promise<WbCase> {
  const r = await authedFetch(`/cases/${encodeURIComponent(id)}`);
  const j = await jsonOrThrow<{ case: WbCase }>(r);
  return j.case;
}

export async function takeWbCase(input: {
  subjectType: "driver" | "client";
  subjectId: string;
  subjectName?: string | null;
  signals?: WbCaseSignal[];
  score?: number | null;
}): Promise<{ case: WbCase; alreadyAssigned?: boolean; alreadyResolved?: boolean }> {
  const r = await authedFetch("/cases/take", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<{ case: WbCase; alreadyAssigned?: boolean; alreadyResolved?: boolean }>(r);
}

export async function releaseWbCase(id: string): Promise<WbCase> {
  const r = await authedFetch(`/cases/${encodeURIComponent(id)}/release`, {
    method: "POST",
  });
  const j = await jsonOrThrow<{ case: WbCase }>(r);
  return j.case;
}

export async function updateWbCase(
  id: string,
  patch: Partial<{
    resolution: "confirmed" | "rejected" | "unclear";
    resolutionNote: string;
    actionTaken: string;
    bonusesApplied: boolean;
    bonusesPeriod: string;
    close: boolean;
  }>,
): Promise<WbCase> {
  const r = await authedFetch(`/cases/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const j = await jsonOrThrow<{ case: WbCase }>(r);
  return j.case;
}

export async function addWbCaseComment(
  id: string,
  text: string,
): Promise<WbCase> {
  const r = await authedFetch(`/cases/${encodeURIComponent(id)}/comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const j = await jsonOrThrow<{ case: WbCase }>(r);
  return j.case;
}

// ── Fraud marks (ручные пометки заказов) ───────────────────────────────────

export type WbFraudMark = {
  id: string;
  orderId: string;
  subjectType: "driver" | "client";
  subjectId: string;
  isFraud: boolean;
  caseId: string | null;
  markedById: string;
  markedByName: string;
  at: number;
};

export async function fetchWbFraudMarks(params: {
  driverId?: string;
  clientId?: string;
  fromTs?: string;
  toTs?: string;
} = {}): Promise<WbFraudMark[]> {
  const sp = new URLSearchParams();
  if (params.driverId) sp.set("driverId", params.driverId);
  if (params.clientId) sp.set("clientId", params.clientId);
  if (params.fromTs) sp.set("from", params.fromTs);
  if (params.toTs) sp.set("to", params.toTs);
  const qs = sp.toString();
  const r = await authedFetch(`/fraud-marks${qs ? "?" + qs : ""}`);
  const j = await jsonOrThrow<{ marks: WbFraudMark[] }>(r);
  return j.marks || [];
}

export async function setWbFraudMark(input: {
  orderId: string;
  subjectType: "driver" | "client";
  subjectId: string;
  isFraud: boolean;
  caseId?: string | null;
}): Promise<WbFraudMark> {
  const r = await authedFetch("/fraud-marks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const j = await jsonOrThrow<{ mark: WbFraudMark }>(r);
  return j.mark;
}

// ── Driver fraud report (агрегат по водителям за период) ───────────────────

export type WbDriverFraudReportRow = {
  driverId: string;
  orders: number;
  totalGmv: number;
  autoFraudOrders: number;
  autoFraudGmv: number;
  manualFraudOrders: number;
  manualFraudGmv: number;
  anyFraudOrders: number;
  anyFraudGmv: number;
};

export type WbDriverFraudReport = {
  ok: true;
  from: string | null;
  to: string | null;
  rows: WbDriverFraudReportRow[];
  total: number;
};

export async function fetchWbDriverFraudReport(params: {
  fromTs?: string;
  toTs?: string;
  limit?: number;
} = {}): Promise<WbDriverFraudReport> {
  const sp = new URLSearchParams();
  if (params.fromTs) sp.set("from", params.fromTs);
  if (params.toTs) sp.set("to", params.toTs);
  if (params.limit) sp.set("limit", String(params.limit));
  const qs = sp.toString();
  const r = await authedFetch(`/driver-fraud-report${qs ? "?" + qs : ""}`);
  return jsonOrThrow<WbDriverFraudReport>(r);
}
