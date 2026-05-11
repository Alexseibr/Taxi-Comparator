/**
 * Тонкий API-клиент для модуля Newstat.
 * Всё ходит на /api/newstat/* — этот префикс проксируется nginx-ом
 * на отдельный node-сервис rwbtaxi-newstat (:3012) с собственной БД.
 *
 * Изоляция от остального фронта: ничего из @/* не импортируем,
 * чтобы при будущем выносе в standalone SPA было меньше плясок.
 */

const BASE = "/api/newstat";
const TOKEN_KEY = "newstat.token";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number; details?: unknown };

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // noop — приватный режим без storage всё равно работает в текущей сессии (in-memory)
  }
  // Даём подписчикам узнать об изменении (например, NewstatLayout перерисуется)
  try {
    window.dispatchEvent(new Event("newstat-auth-change"));
  } catch {
    // SSR/node — игнор
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const token = getToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (init?.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  try {
    const r = await fetch(`${BASE}${path}`, {
      credentials: "same-origin",
      ...init,
      headers,
    });
    const ct = r.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await r.json() : await r.text();
    if (!r.ok) {
      // Auto-logout если токен истёк
      if (r.status === 401 && token) setToken(null);
      return {
        ok: false,
        status: r.status,
        error:
          typeof body === "string"
            ? body
            : (body as { error?: string }).error || `http_${r.status}`,
        details: typeof body === "object" ? (body as { details?: unknown }).details : undefined,
      };
    }
    return { ok: true, data: body as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

// ─── типы ────────────────────────────────────────────────────────────
export interface HealthResponse { ok: boolean; db: boolean; ts: string }
export interface VersionResponse { name: string; version: string; node: string }
export interface User { id: string; login: string; name: string; role: "admin" | "antifraud" | "viewer" }

export interface SettingsItem {
  key: string;
  value: unknown;
  updated_at: string;
  updated_by?: string;
}
export interface CashbackValue { percent_of_noncash: number }
export interface RiskThresholdsValue {
  short_trip_km: number;
  fast_arrival_min: number;
  min_attendance_pct: number;
  high_repeat_ratio: number;
}

export interface Shift {
  id: number;
  name: string;
  start_hour: number;
  end_hour: number;
  payout_byn: string | number;
  weekday_mask: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}
export interface ShiftInput {
  name: string;
  start_hour: number;
  end_hour: number;
  payout_byn: number;
  weekday_mask: number;
  active: boolean;
}

export interface UploadOrder {
  order_id: string;
  order_date: string; // YYYY-MM-DD
  status: string;
  payment_type?: "cash" | "noncash" | null;
  driver_id?: string | null;
  driver_name?: string | null;
  client_id?: string | null;
  gmv?: number | null;
  km?: number | null;
  arrival_minutes?: number | null;
  trip_minutes?: number | null;
  created_at?: string | null;
  cancelled_at?: string | null;
}
export interface UploadResponse {
  ok: boolean;
  batch_id: string;
  total: number;
  inserted: number;
  updated: number;
  dates: string[];
  etl: { dates: number };
}

export interface UploadBatch {
  id: string;
  uploaded_at: string;
  uploaded_by: string;
  source: string;
  total_rows: number;
  inserted_rows: number;
  duplicate_rows: number;
}

export interface DailyDriverRow {
  driver_id: string;
  driver_name?: string | null;
  date: string;
  total_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  noncash_orders: number;
  cash_orders: number;
  noncash_gmv: string;
  cash_gmv: string;
  total_gmv: string;
  short_trip_orders: number;
  fast_arrival_orders: number;
  unique_clients: number;
  max_orders_with_one_client: number;
  repeat_client_ratio: string;
  avg_arrival_minutes: string | null;
  avg_trip_minutes: string | null;
}

export interface DailyClientRow {
  client_id: string;
  date: string;
  total_orders: number;
  noncash_orders: number;
  noncash_gmv: string;
  total_gmv: string;
  unique_drivers: number;
  max_orders_with_one_driver: number;
  repeat_driver_ratio: string;
  cashback_earned: string;
}

export interface DailyPairRow {
  driver_id: string;
  driver_name?: string | null;
  client_id: string;
  date: string;
  orders_count: number;
  noncash_orders: number;
  noncash_gmv: string;
  total_gmv: string;
  short_trip_orders: number;
  fast_arrival_orders: number;
}

export interface DailyAttendanceRow {
  driver_id: string;
  driver_name?: string | null;
  shift_id: number;
  shift_name: string;
  start_hour: number;
  end_hour: number;
  shift_hours: number;
  covered_hours: number;
  attendance_pct: string;
  orders_in_shift: number;
  qualified: boolean;
  payout_byn: string;
}

export interface DailySummary {
  orders_total: number;
  orders_completed: number;
  gmv_total: string;
  gmv_noncash: string;
  drivers_active: number;
  clients_active: number;
  guarantee_payout: string;
  qualified_count: number;
  cashback_total: string;
  // ── T006: суммарный риск по водителям за день ──
  risk_money_total: string;
  risk_money_guarantee: string;
  risk_money_earnings: string;
  risk_money_collusion: string;
  risky_drivers_count: number;
  // ── T007: клиентский риск (только cashback). ──
  cashback_loss_total: string;
  risky_clients_count: number;
  // ── T008: pair-collusion. ──
  collusion_loss_total: string;
  risky_pairs_count: number;
  // ── T015: KPI тикетной системы (Fraud Decision Workflow) ──
  tickets_created?: number;
  tickets_confirmed?: number;
  tickets_open?: number;
  tickets_money_at_risk_total?: string;
  money_saved_total?: string;
  money_prevented?: string;
}

// ─── T015: Fraud Decision Workflow ───────────────────────────────────
export type TicketStatus = "new" | "in_review" | "confirmed_fraud" | "false_positive" | "closed";
export type TicketDecision = "deny_payout" | "allow" | "block_cashback" | "monitor";
export type TicketPriority = "low" | "medium" | "high";
export type TicketEntityType = "driver" | "client" | "pair";

export type TicketLabelStatus = "unlabeled" | "labeled" | "skipped";
export type TicketLabelValue = 0 | 1;

export interface TicketListItem {
  ticket_id: number | string;
  entity_type: TicketEntityType;
  driver_id: string | null;
  client_id: string | null;
  date: string;
  risk_score: string;
  risk_type: string;
  money_at_risk_byn: string;
  money_saved_byn: string;
  status: TicketStatus;
  decision: TicketDecision | null;
  priority: TicketPriority;
  previous_flags_count: number;
  assigned_to: string | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
  driver_name?: string | null;
  // T015.7 — поля ручной разметки антифрод-оператора (миграция 013).
  label_status?: TicketLabelStatus | null;
  label_value?: TicketLabelValue | null;
  labeled_at?: string | null;
  labeled_by?: string | null;
}

export interface TicketEvent {
  id: number | string;
  action: string;
  old_status: TicketStatus | null;
  new_status: TicketStatus | null;
  decision: TicketDecision | null;
  comment: string | null;
  meta: Record<string, unknown> | null;
  user_id: string | null;
  created_at: string;
}

export interface TicketDetail extends TicketListItem {
  signals: Record<string, unknown> | null;
  suspicious_orders: Array<Record<string, unknown>> | null;
  client_cashback_blocked?: boolean | null;
}

export type TicketHistoryItem = Pick<
  TicketListItem,
  "date" | "risk_score" | "money_at_risk_byn" | "money_saved_byn" | "status" | "decision" | "priority"
>;

export interface TicketsListFilter {
  date?: string;
  date_from?: string;
  date_to?: string;
  status?: TicketStatus;
  entity_type?: TicketEntityType;
  priority?: TicketPriority;
  limit?: number;
}

// Сигналы из lib/risk.mjs пробрасываются как есть — UI знает структуру
// и рендерит её в карточке кейса (T010). Все поля опциональны, чтобы
// потом можно было добавлять новые сигналы без миграции фронта.
export interface DriverRiskSignals {
  qualified?: boolean;
  payout_byn?: number;
  shift_hours?: number;
  ratios?: {
    short_trip?: number;
    fast_arrival?: number;
    repeat_client?: number;
    cancel?: number;
    cash?: number;
    concentration_one_client?: number;
    orders_per_shift_hour?: number;
  };
  guarantee?: Record<string, number>;
  earnings?: Record<string, number>;
  collusion?: Record<string, number>;
}

export interface DailyDriverRiskRow {
  driver_id: string;
  driver_name?: string | null;
  guarantee_risk: string;
  earnings_risk: string;
  collusion_risk: string;
  total_risk: string;
  guarantee_money_byn: string;
  earnings_money_byn: string;
  collusion_money_byn: string;
  money_at_risk_byn: string;
  signals: DriverRiskSignals;
  recomputed_at: string;
}

// ─── T007: клиентский риск ──────────────────────────────────────────
export interface ClientRiskSignals {
  cashback_earned_byn?: number;
  noncash_gmv_byn?: number;
  total_orders?: number;
  unique_drivers?: number;
  ratios?: {
    short_trip?: number;
    fast_arrival?: number;
    noncash?: number;
    concentration_one_driver?: number;
    repeat_driver?: number;
  };
  cashback_exposure_breakdown?: Record<string, number>;
  repeat_driver_breakdown?: Record<string, number>;
  suspicious_breakdown?: Record<string, number>;
}

export interface DailyClientRiskRow {
  client_id: string;
  total_orders: number;
  cashback_exposure: string;
  repeat_driver_dependency: string;
  suspicious_activity: string;
  total_risk: string;
  cashback_money_byn: string;
  money_at_risk_byn: string;
  signals: ClientRiskSignals;
  recomputed_at: string;
}

// ─── T008: pair-collusion ────────────────────────────────────────────
export interface PairRiskSignals {
  orders_count?: number;
  noncash_orders?: number;
  noncash_gmv?: number;
  short_trip_orders?: number;
  fast_arrival_orders?: number;
  ratios?: {
    noncash?: number;
    short_fast_combo?: number;
    client_share_by_pair?: number;
    driver_share_by_pair?: number;
  };
  breakdown?: {
    repeat?: number;
    suspicious_noncash?: number;
    suspicious_combo?: number;
    cashback_dependency?: number;
  };
  cashback_pct_used?: number;
  cashback_paid_byn?: number;
}

export interface DailyPairRiskRow {
  driver_id: string;
  driver_name?: string | null;
  client_id: string;
  orders_count: number;
  noncash_gmv: string;
  repeat_ratio: string;
  suspicious_ratio: string;
  cashback_dependency: string;
  total_risk: string;
  collusion_loss_risk_byn: string;
  signals: PairRiskSignals;
  recomputed_at: string;
}

// ─── T020: Graph Fraud Analysis ──────────────────────────────────────
export type GraphClusterType = "cashback_ring" | "driver_farm" | "mixed_fraud" | "mixed";

export interface GraphClusterReason {
  reason: string;
  money: string;
  pattern: string;
}

export interface GraphCluster {
  cluster_id: string;
  nodes_count: number;
  drivers_count: number;
  clients_count: number;
  total_orders: number;
  total_gmv: string;
  total_noncash_gmv: string;
  total_cashback_generated: string;
  total_cashback_risk: string;
  total_collusion_loss_risk: string;
  avg_risk_score: string;
  max_risk_score: string;
  is_suspicious: boolean;
  cluster_type: GraphClusterType;
  reason: GraphClusterReason;
  window_from: string;
  window_to: string;
  updated_at: string;
}

export interface GraphNode {
  entity_id: string;
  entity_type: "driver" | "client";
  total_orders: number;
  total_gmv: string;
  total_noncash_gmv: string;
  total_connections: number;
  unique_partners: number;
  risk_score_avg: string;
  risk_score_max: string;
  total_cashback_generated: string;
  total_cashback_risk: string;
  cluster_id?: string | null;
}

export interface GraphClusterEdge {
  driver_id: string;
  client_id: string;
  orders_count: number;
  noncash_orders: number;
  short_trip_count: number;
  fast_arrival_count: number;
  total_gmv: string;
  noncash_gmv: string;
  cashback_generated_byn: string;
  cashback_loss_risk_byn: string;
  repeat_ratio: string;
  pair_risk_score: string;
  edge_strength: string;
  first_seen_date: string;
  last_seen_date: string;
  days_in_window: number;
  ml_score?: string | null;
  ml_disagreement?: string | null;
  ml_model_version?: string | null;
}

export interface GraphPartner {
  partner_id: string;
  orders_count: number;
  noncash_orders: number;
  total_gmv: string;
  noncash_gmv: string;
  cashback_generated_byn: string;
  cashback_loss_risk_byn: string;
  edge_strength: string;
  pair_risk_score: string;
  first_seen_date: string;
  last_seen_date: string;
  ml_score?: string | null;
  ml_disagreement?: string | null;
  ml_model_version?: string | null;
  ml_date?: string | null;
}

export interface GraphEdgeRow {
  driver_id: string;
  client_id: string;
  date: string;
  orders_count: number;
  completed_orders: number;
  noncash_orders: number;
  total_gmv: string;
  noncash_gmv: string;
  short_trip_count: number;
  fast_arrival_count: number;
  repeat_ratio: string;
  pair_risk_score: string;
  cashback_generated_byn: string;
  cashback_loss_risk_byn: string;
  days_seen: number;
  first_seen_date: string;
  last_seen_date: string;
  edge_strength: string;
}

export interface GraphClustersFilter {
  suspicious?: boolean;
  cluster_type?: GraphClusterType;
  limit?: number;
  offset?: number;
}

export interface GraphEdgesFilter {
  date?: string;
  date_from?: string;
  date_to?: string;
  driver_id?: string;
  client_id?: string;
  min_strength?: number;
  limit?: number;
  offset?: number;
}

// ─── публичный API ───────────────────────────────────────────────────
// ── T015.9: ML training runs / activate / retrain / rescore ──
export type MlModelType = "weak_supervised" | "supervised";
export type MlRunStatus = "running" | "success" | "failed";
export type MlEntityType = "pair" | "driver" | "client" | "cluster";

export interface MlRunTopFeature {
  name?: string;
  feature?: string;
  importance: number;
  value?: number | string | null;
}

export interface MlRun {
  run_id: string | number;
  model_type: MlModelType;
  entity_type: MlEntityType;
  model_version: string;
  status: MlRunStatus;
  is_active: boolean;
  rows_count: number | null;
  positive_count: number | null;
  negative_count: number | null;
  n_train: number | null;
  n_test: number | null;
  precision_score: number | null;
  recall: number | null;
  f1_score: number | null;
  roc_auc: number | null;
  pr_auc: number | null;
  accuracy: number | null;
  model_path: string | null;
  error: string | null;
  created_by: string | null;
  notes: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  top_features: MlRunTopFeature[] | null;
}

export interface MlStatus {
  ok: boolean;
  ml_service_ok: boolean;
  ml_health_detail?: { ok?: boolean; service?: string; error?: string } | null;
  last_prediction_at: string | null;
  minutes_since_last_prediction: number | null;
  active_model_version: string | null;
  last_training_run: {
    run_id: string | number;
    model_type: MlModelType;
    model_version: string;
    status: MlRunStatus;
    started_at: string | null;
    finished_at: string | null;
  } | null;
}

export interface MlActivateResponse {
  ok: boolean;
  active_model_version: string;
  warnings?: string[];
}

export interface MlRescoreResponse {
  ok: boolean;
  from?: string;
  to?: string;
  span_days?: number;
  total_pairs?: number;
  processed: number;
  batches?: number;
  errors: Array<{ batch?: number | null; chunk?: number; error: string }>;
  truncated?: boolean;
  model_version?: string | null;
  duration_ms: number;
  tickets_created?: number | null;
  tickets_by_type?: Record<string, number> | null;
}

// ── T015.8: ML disagreements ──
export type MlDisagreementType =
  | "ML_DISCOVERY"
  | "RULE_OVERKILL"
  | "STRONG_DISAGREEMENT";

export interface MlDisagreementTopFeature {
  feature: string;
  value: number | string | null;
  importance: number;
}

export interface MlDisagreementRow {
  driver_id: string;
  client_id: string;
  date: string;
  model_version: string | null;
  ml_score: number;
  rule_score: number;
  delta: number;
  abs_delta: number;
  money_at_risk_byn: number | null;
  top_features: MlDisagreementTopFeature[] | null;
  ticket_id: string | number | null;
  ticket_status: TicketStatus | null;
  ticket_label_status: TicketLabelStatus | null;
  ticket_label_value: TicketLabelValue | null;
  driver_name: string | null;
  disagreement_type: MlDisagreementType;
}

export interface MlDisagreementsFilter {
  date: string;
  type?: MlDisagreementType;
  only_unlabeled?: "1";
  min_delta?: number;
  min_money?: number;
  driver_id?: string;
  client_id?: string;
  limit?: number;
}

// ── T016: ML labeling queue & ml_workflow settings ──
export type MlCaseType =
  | "ML_DISCOVERY"
  | "RULE_OVERKILL"
  | "STRONG_DISAGREEMENT"
  | "LOW_RISK_SAMPLE";

export type MlMode = "SAFE" | "BALANCED" | "AGGRESSIVE" | "TRAINING";

export interface MlWorkflowSettings {
  ml_mode?: MlMode;
  disagreement_delta_threshold: number;
  ml_discovery_min_score: number;
  ml_discovery_max_rule_score: number;
  ticket_min_money_at_risk_byn: number;
  ticket_max_per_day: number;
  ticket_max_per_rescore: number;
  enable_strong_disagreement_tickets: boolean;
  enable_rule_overkill_tickets: boolean;
}

export interface MlLabelingRow {
  driver_id: string;
  client_id: string;
  date: string;
  model_version: string | null;
  ml_score: number;
  rule_score: number;
  delta: number;
  abs_delta: number;
  money_at_risk_byn: number | null;
  top_features: MlDisagreementTopFeature[] | null;
  ticket_id: string | number | null;
  ticket_status: TicketStatus | null;
  ticket_label_status: TicketLabelStatus | null;
  label_id: string | number | null;
  label_value: 0 | 1 | null;
  driver_name: string | null;
  case_type: MlCaseType;
}

export interface MlLabelingQueueFilter {
  date_from: string;
  date_to: string;
  case_type?: MlCaseType;
  only_unlabeled?: "1" | "0";
  min_money_at_risk?: number;
  min_delta?: number;
  limit?: number;
}

export interface MlLabelsSummary {
  ok: boolean;
  labels_total: number;
  labels_positive: number;
  labels_negative: number;
  labels_last_7d: number;
  unlabeled_disagreements: number;
  tickets_created_from_ml_today: number;
  settings: MlWorkflowSettings;
}

// ── PairContext (PairDrawer) ──────────────────────────────────────────────────
export interface PairContextOrder {
  order_id: string;
  order_date: string;
  status: string;
  payment_type: string | null;
  gmv: number | null;
  km: number | null;
  arrival_minutes: number | null;
  trip_minutes: number | null;
}

export interface PairContextTicket {
  ticket_id: number;
  date: string;
  risk_score: number;
  risk_type: string;
  status: string;
  decision: string | null;
  priority: string;
  money_at_risk_byn: number;
}

export interface PairContext {
  ok: boolean;
  driver_id: string;
  client_id: string;
  rule_score: number | null;
  ml_score: number | null;
  money_at_risk: number | null;
  repeat_ratio: number | null;
  suspicious_ratio: number | null;
  cashback_dependency: number | null;
  last_date: string | null;
  shared_device_count: number;
  shared_ip_count: number;
  orders: PairContextOrder[];
  tickets: PairContextTicket[];
  device_signals: Record<string, { count: number; max_strength: number }>;
}

// ── Workbench types ───────────────────────────────────────────────────────────
export interface WorkbenchWhyReason {
  key: string;
  label: string;
  value: string | null;
  severity: "high" | "medium" | "info";
}

export interface WorkbenchCaseSummary {
  ticket_id: number;
  entity_type: TicketEntityType;
  risk_type: string;
  priority: TicketPriority;
  status: TicketStatus;
  driver_id: string | null;
  driver_name: string | null;
  client_id: string | null;
  date: string;
  rule_score: number;
  ml_score: number | null;
  delta: number | null;
  final_score: number;
  money_at_risk_byn: number;
  label_status: TicketLabelStatus | null;
  label_value: 0 | 1 | null;
  why: WorkbenchWhyReason[];
  signals: Record<string, unknown>;
  top_features: MlDisagreementTopFeature[] | null;
}

export interface WorkbenchMoney {
  gmv: number | null;
  noncash_gmv: number | null;
  cashback_risk: number | null;
  guarantee_risk: number | null;
  total_at_risk: number;
}

// Evidence layer v2: флаги, primary orders, patterns, confidence, suggested action
export interface SuspiciousOrderFlags {
  is_short_trip: boolean;
  is_fast_arrival: boolean;
  is_noncash: boolean;
  is_repeat_pair: boolean;
  is_cancel_after_accept: boolean;
}

export type PrimaryFlagType =
  | "cancel_after_accept"
  | "repeat_noncash"
  | "repeat_pair"
  | "noncash"
  | "short_trip"
  | "fast_arrival"
  | null;

export interface SuspiciousOrder {
  order_id: string;
  date: string;
  driver_id: string;
  client_id: string;
  status: string;
  gmv: number | null;
  km: number | null;
  trip_minutes: number | null;
  arrival_minutes: number | null;
  payment_type: string | null;
  created_at: string | null;
  is_short_trip: boolean;
  is_fast_arrival: boolean;
  is_noncash: boolean;
  is_repeat_pair: boolean;
  is_cancel_after_accept: boolean;
  risk_score: number;
  flags: SuspiciousOrderFlags;
  primary_flag: PrimaryFlagType;
  primary_reason_weight: number;
}

export interface SuspiciousFlagCounts {
  short_trip: number;
  fast_arrival: number;
  noncash: number;
  repeat_pair: number;
  cancel_after_accept: number;
  total_orders: number;
}

export interface SuspiciousPattern {
  type: "cancel_after_accept" | "short_noncash" | "repeat_pair" | "device_cluster";
  count: number;
  sample_orders: string[];
}

export type SuggestedAction = "confirm_fraud" | "false_positive" | "monitor";

export interface SuspiciousHiddenLinks {
  shared_device_count: number;
  device_cluster_size: number;
  related_clients: string[];
}

export interface SuspiciousOrdersResponse {
  ok: boolean;
  driver_id: string;
  client_id: string;
  date: string;
  count: number;
  flag_counts: SuspiciousFlagCounts;
  primary_orders: SuspiciousOrder[];
  patterns: SuspiciousPattern[];
  evidence_confidence: number;
  suggested_action: SuggestedAction;
  suggested_reason: string;
  hidden_links: SuspiciousHiddenLinks;
  items: SuspiciousOrder[];
}

export interface WorkbenchCaseDetail extends WorkbenchCaseSummary {
  decision: TicketDecision | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
  money: WorkbenchMoney;
  suspicious_orders: unknown[];
  suspicious_flag_counts: SuspiciousFlagCounts | null;
}

export interface WorkbenchKpi {
  date: string;
  open_cases: number;
  new_tickets: number;     // alias = open_cases
  high_priority: number;
  money_at_risk_byn: number;
  money_saved_byn: number;
  labels_today: number;
  decisions_today: number;
}

export interface WorkbenchPairContext {
  ok: boolean;
  driver_id: string;
  client_id: string;
  trend_7d: {
    date: string;
    rule_score: number;
    money_at_risk_byn: number;
    cashback_risk_byn: number | null;
    guarantee_risk_byn: number | null;
    gmv: number | null;
    noncash_ratio: number | null;
    repeat_ratio: number | null;
    short_trip_ratio: number | null;
  }[];
  risk_history: WorkbenchPairContext["trend_7d"];  // backward-compat
  recent_orders: {
    order_id: string;
    order_date: string;
    status: string;
    payment_type: string | null;
    gmv: number | null;
    km: number | null;
    arrival_minutes: number | null;
    trip_minutes: number | null;
  }[];
  recent_tickets: PairContextTicket[];
  graph_summary: {
    driver_degree: number | null;
    client_degree: number | null;
  };
  hidden_links: {
    shared_device_count: number;
    device_clusters: { fingerprint: string; shared_count: number }[];
    linked_via_ip: { ip: string; other_client: string; shared_count: number }[];
  };
  shared_devices: { fingerprint: string; shared_clients: string[] }[];
  linked_via_ip: { ip: string; other_client: string; shared_count: number }[];
}

export interface WorkbenchDecisionBody {
  action: "confirm_fraud" | "false_positive" | "monitor";
  deny_guarantee?: boolean;
  block_cashback?: boolean;
  flag_pair?: boolean;
  comment?: string;
}

export interface WorkbenchCasesFilter {
  date?: string;         // legacy single-date
  date_from?: string;
  date_to?: string;
  status?: string;
  priority?: string;
  entity_type?: string;
  min_money?: number;
  limit?: number;
  cursor?: number;
}

// ── T019: Hidden Links types ──────────────────────────────────────────────────
export interface HiddenSignal {
  id: number;
  entity_a_type: string;
  entity_a_id: string;
  entity_b_type: string;
  entity_b_id: string;
  signal_type: "device" | "ip";
  signal_value: string;
  strength: number;
  updated_at: string;
}

export interface HiddenCluster {
  signal_value: string;
  signal_type: "device" | "ip";
  cluster_size: number;
  client_ids: string[];
  max_strength: number;
  last_seen: string;
}

export interface DeviceFingerprint {
  device_hash: string;
  user_agent: string | null;
  platform: string | null;
  first_seen: string;
  last_seen: string;
}

export interface IpLink {
  ip_address: string;
  first_seen: string;
  last_seen: string;
}

// ── T006: admin-управление пользователями newstat ──
export interface AdminUser {
  id: string;
  login: string;
  name: string;
  role: "admin" | "antifraud" | "viewer";
  active: boolean;
  created_at: string;
}
export interface AdminUserCreateBody {
  login: string;
  name: string;
  role: "admin" | "antifraud" | "viewer";
  password?: string; // если не указан, бэкенд сгенерит
}
export interface AdminUserUpdateBody {
  name?: string;
  role?: "admin" | "antifraud" | "viewer";
  active?: boolean;
}

export const newstatApi = {
  // базовое
  health: () => request<HealthResponse>("/health"),
  version: () => request<VersionResponse>("/version"),

  // auth
  login: (login: string, password: string) =>
    request<{ ok: boolean; token: string; expires_at: string; user: User }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ login, password }) },
    ),
  // T006: SSO-мост — backend читает wb-сессию из Cookie (HttpOnly rwb_sid)
  // или Authorization-заголовка (legacy localStorage Bearer) и проксирует
  // её в WB /me. Со стороны фронта достаточно просто POST с тем же origin.
  sso: () =>
    request<{ ok: boolean; token: string; expires_at: string; user: User }>(
      "/auth/sso",
      { method: "POST", body: "{}" },
    ),
  me: () => request<{ ok: boolean; user: User }>("/auth/me"),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  // ── T006: admin/users ──
  adminUsersList: () =>
    request<{ ok: boolean; users: AdminUser[] }>("/admin/users"),
  adminUserCreate: (body: AdminUserCreateBody) =>
    request<{ ok: boolean; user: AdminUser; generated_password?: string }>(
      "/admin/users",
      { method: "POST", body: JSON.stringify(body) },
    ),
  adminUserUpdate: (id: string, body: AdminUserUpdateBody) =>
    request<{ ok: boolean; user: AdminUser }>(`/admin/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  adminUserDelete: (id: string) =>
    request<{ ok: boolean }>(`/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
  adminUserResetPassword: (id: string, password?: string) =>
    request<{ ok: boolean; generated_password?: string }>(
      `/admin/users/${encodeURIComponent(id)}/reset-password`,
      { method: "POST", body: JSON.stringify(password ? { password } : {}) },
    ),

  // settings
  settingsAll: () => request<{ ok: boolean; settings: SettingsItem[] }>("/settings/all"),
  saveCashback: (percent_of_noncash: number) =>
    request<{ ok: boolean }>("/settings/cashback", {
      method: "PUT",
      body: JSON.stringify({ percent_of_noncash }),
    }),
  saveRiskThresholds: (v: RiskThresholdsValue) =>
    request<{ ok: boolean }>("/settings/risk_thresholds", {
      method: "PUT",
      body: JSON.stringify(v),
    }),

  // shifts
  shiftsList: () => request<{ ok: boolean; shifts: Shift[] }>("/shifts"),
  shiftCreate: (s: ShiftInput) =>
    request<{ ok: boolean; shift: Shift }>("/shifts", {
      method: "POST",
      body: JSON.stringify(s),
    }),
  shiftUpdate: (id: number, s: ShiftInput) =>
    request<{ ok: boolean; shift: Shift }>(`/shifts/${id}`, {
      method: "PUT",
      body: JSON.stringify(s),
    }),
  shiftDelete: (id: number) =>
    request<{ ok: boolean }>(`/shifts/${id}`, { method: "DELETE" }),

  // upload + ETL data
  upload: (orders: UploadOrder[], source = "manual") =>
    request<UploadResponse>("/upload", {
      method: "POST",
      body: JSON.stringify({ source, orders }),
    }),
  recompute: (dates: string[]) =>
    request<{ ok: boolean; dates: number }>("/recompute", {
      method: "POST",
      body: JSON.stringify({ dates }),
    }),
  batches: () => request<{ ok: boolean; batches: UploadBatch[] }>("/batches"),

  dailyDrivers: (date: string) =>
    request<{ ok: boolean; rows: DailyDriverRow[] }>(`/daily/drivers?date=${encodeURIComponent(date)}`),
  dailyClients: (date: string) =>
    request<{ ok: boolean; rows: DailyClientRow[] }>(`/daily/clients?date=${encodeURIComponent(date)}`),
  dailyPairs: (date: string) =>
    request<{ ok: boolean; rows: DailyPairRow[] }>(`/daily/pairs?date=${encodeURIComponent(date)}`),
  dailyAttendance: (date: string) =>
    request<{ ok: boolean; rows: DailyAttendanceRow[] }>(`/daily/attendance?date=${encodeURIComponent(date)}`),
  dailySummary: (date: string) =>
    request<{ ok: boolean; summary: DailySummary }>(`/daily/summary?date=${encodeURIComponent(date)}`),
  dailyDriverRisks: (date: string, limit = 200) =>
    request<{ ok: boolean; rows: DailyDriverRiskRow[] }>(
      `/daily/driver-risks?date=${encodeURIComponent(date)}&limit=${limit}`,
    ),
  dailyClientRisks: (date: string, limit = 200) =>
    request<{ ok: boolean; rows: DailyClientRiskRow[] }>(
      `/daily/client-risks?date=${encodeURIComponent(date)}&limit=${limit}`,
    ),
  dailyPairRisks: (date: string, limit = 200) =>
    request<{ ok: boolean; rows: DailyPairRiskRow[] }>(
      `/daily/pair-risks?date=${encodeURIComponent(date)}&limit=${limit}`,
    ),

  // ── T015: Fraud Decision Workflow ──
  ticketsList: (filter: TicketsListFilter = {}) => {
    const qs = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{ ok: boolean; tickets: TicketListItem[] }>(`/tickets${suffix}`);
  },
  ticketGet: (id: number | string) =>
    request<{
      ok: boolean;
      ticket: TicketDetail;
      events: TicketEvent[];
      history: TicketHistoryItem[];
    }>(`/tickets/${encodeURIComponent(String(id))}`),
  ticketDecision: (id: number | string, body: { decision: TicketDecision; comment?: string }) =>
    request<{ ok: boolean; ticket: TicketDetail }>(`/tickets/${encodeURIComponent(String(id))}/decision`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ticketComment: (id: number | string, comment: string) =>
    request<{ ok: boolean; ticket_id: number | string; comment: string; assigned_to: string | null; updated_at: string }>(
      `/tickets/${encodeURIComponent(String(id))}/comment`,
      { method: "POST", body: JSON.stringify({ comment }) },
    ),
  // T015.7 — ручная разметка тикета (label=1 confirmed_fraud, label=0 false_positive)
  ticketLabel: (
    id: number | string,
    body: { label: TicketLabelValue; comment?: string },
  ) =>
    request<{
      ok: boolean;
      label_id: number | string;
      ticket: {
        ticket_id: number | string;
        label_status: TicketLabelStatus;
        label_value: TicketLabelValue;
        labeled_at: string;
        labeled_by: string;
      };
    }>(`/tickets/${encodeURIComponent(String(id))}/label`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── T015.9: ML training runs / activate / retrain / rescore ──
  mlStatus: () => request<MlStatus>(`/ml/status`),
  mlRuns: (limit = 30) =>
    request<{ ok: boolean; items: MlRun[] }>(`/ml/runs?limit=${limit}`),
  mlRetrain: (notes?: string, opts?: { force?: boolean }) =>
    request<{
      ok: boolean;
      run_id: string | number;
      model_version: string;
      metrics?: Record<string, number | string | null>;
    }>(`/ml/retrain${opts?.force ? "?force=true" : ""}`, {
      method: "POST",
      body: JSON.stringify(notes ? { notes } : {}),
    }),
  mlActivate: (runId: number | string) =>
    request<MlActivateResponse>(`/ml/runs/${encodeURIComponent(String(runId))}/activate`, {
      method: "POST",
    }),
  mlRescore: (body: { from: string; to: string; create_tickets?: boolean }) =>
    request<MlRescoreResponse>(`/ml/rescore`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── T015.8: ML disagreements (rule vs supervised model) ──
  mlDisagreements: (filter: MlDisagreementsFilter) => {
    const qs = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    return request<{ ok: boolean; date: string; count: number; items: MlDisagreementRow[] }>(
      `/ml/disagreements?${qs.toString()}`,
    );
  },
  mlDisagreementCreateTicket: (body: {
    driver_id: string;
    client_id: string;
    date: string;
    disagreement_type: MlDisagreementType;
  }) =>
    request<{
      ok: boolean;
      ticket_id: string | number;
      existed: boolean;
      status?: TicketStatus;
      label_status?: TicketLabelStatus;
    }>(`/ml/disagreements/ticket`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── T016: ML labeling queue ──
  mlLabelingQueue: (filter: MlLabelingQueueFilter) => {
    const qs = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    return request<{
      ok: boolean;
      count: number;
      items: MlLabelingRow[];
      settings: MlWorkflowSettings;
    }>(`/ml/labeling-queue?${qs.toString()}`);
  },
  mlLabelingBatch: (body: {
    date_from: string;
    date_to: string;
    ml_discovery?: number;
    rule_overkill?: number;
    strong_disagreement?: number;
    low_risk_sample?: number;
    only_unlabeled?: boolean;
  }) =>
    request<{
      ok: boolean;
      count: number;
      items: MlLabelingRow[];
      by_type: Record<string, number>;
      limits: Record<MlCaseType, number>;
      settings: MlWorkflowSettings;
    }>(`/ml/labeling-batch`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  mlLabel: (body: {
    entity_type: "pair";
    entity_key: string;
    date: string;
    label: 0 | 1;
    comment?: string;
  }) =>
    request<{
      ok: boolean;
      label_id: number | string;
      source_ticket_id: number | string | null;
    }>(`/ml/label`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  mlLabelsSummary: () => request<MlLabelsSummary>(`/ml/labels-summary`),
  saveMlWorkflow: (v: MlWorkflowSettings) =>
    request<{ ok: boolean }>(`/settings/ml_workflow`, {
      method: "PUT",
      body: JSON.stringify(v),
    }),

  // ── Pair Context (PairDrawer) ──
  pairsContext: (driverId: string, clientId: string) =>
    request<PairContext>(`/pairs/context?driver_id=${encodeURIComponent(driverId)}&client_id=${encodeURIComponent(clientId)}`),

  // ── T019: Hidden Links ──
  hiddenLinksStats: () =>
    request<{
      ok: boolean;
      device_fingerprints: number;
      ip_links_total: number;
      device_signals: number;
      ip_signals: number;
      total_signals: number;
    }>("/hidden-links/stats"),

  hiddenLinksSignals: (params: { signal_type?: string; entity_id?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.signal_type) qs.set("signal_type", params.signal_type);
    if (params.entity_id)   qs.set("entity_id",   params.entity_id);
    if (params.limit)       qs.set("limit",        String(params.limit));
    const sfx = qs.toString() ? `?${qs.toString()}` : "";
    return request<{ ok: boolean; count: number; signals: HiddenSignal[] }>(`/hidden-links/signals${sfx}`);
  },

  hiddenLinksClusters: (params: { signal_type?: string; min_size?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.signal_type) qs.set("signal_type", params.signal_type);
    if (params.min_size)    qs.set("min_size",    String(params.min_size));
    if (params.limit)       qs.set("limit",        String(params.limit));
    const sfx = qs.toString() ? `?${qs.toString()}` : "";
    return request<{ ok: boolean; count: number; clusters: HiddenCluster[] }>(`/hidden-links/clusters${sfx}`);
  },

  hiddenLinksEntity: (type: "driver" | "client", id: string) =>
    request<{
      ok: boolean;
      entity_type: string;
      entity_id: string;
      signals: HiddenSignal[];
      device_fingerprints: DeviceFingerprint[];
      ip_links: IpLink[];
    }>(`/hidden-links/entity/${encodeURIComponent(type)}/${encodeURIComponent(id)}`),

  hiddenLinksRecompute: () =>
    request<{ ok: boolean; shared_signals: number }>("/hidden-links/recompute", { method: "POST" }),

  hiddenLinksCreateClusterTickets: () =>
    request<{ ok: boolean; tickets_created: number }>("/hidden-links/create-cluster-tickets", { method: "POST" }),

  hiddenLinksIngest: (body: {
    entity_type: "driver" | "client";
    entity_id: string;
    date: string;
    ip_address?: string;
    user_agent?: string;
    platform?: "ios" | "android" | "web" | "unknown";
    device_id?: string;
  }) =>
    request<{ ok: boolean; device_hash: string | null }>("/hidden-links/ingest", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── T020: Graph Fraud Analysis ──
  graphClusters: (filter: GraphClustersFilter = {}) => {
    const qs = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{ ok: boolean; total: number; items: GraphCluster[] }>(`/graph/clusters${suffix}`);
  },
  graphCluster: (id: string) =>
    request<{
      ok: boolean;
      cluster: GraphCluster;
      nodes: GraphNode[];
      edges: GraphClusterEdge[];
    }>(`/graph/cluster/${encodeURIComponent(id)}`),
  graphNode: (type: "driver" | "client", id: string) =>
    request<{ ok: boolean; node: GraphNode; partners: GraphPartner[] }>(
      `/graph/node/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
    ),
  graphEdges: (filter: GraphEdgesFilter = {}) => {
    const qs = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{ ok: boolean; items: GraphEdgeRow[] }>(`/graph/edges${suffix}`);
  },

  // ── Workbench ──
  workbenchKpi: (date?: string) => {
    const qs = new URLSearchParams();
    if (date) qs.set("date", date);
    const sfx = qs.toString() ? `?${qs.toString()}` : "";
    return request<WorkbenchKpi>(`/workbench/kpi${sfx}`);
  },
  workbenchCases: (filter: WorkbenchCasesFilter = {}) => {
    const qs = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    const sfx = qs.toString() ? `?${qs.toString()}` : "";
    return request<{
      ok: boolean;
      count: number;
      has_more: boolean;
      next_cursor: number | null;
      date_from: string;
      date_to: string;
      items: WorkbenchCaseSummary[];
    }>(`/workbench/cases${sfx}`);
  },
  workbenchCase: (id: number) =>
    request<{ ok: boolean; item: WorkbenchCaseDetail }>(`/workbench/cases/${id}`),
  workbenchDecision: (id: number, body: WorkbenchDecisionBody) =>
    request<{ ok: boolean; ticket_id: number; action: string; decision: string; new_status: string; auto_label: 0 | 1 | null }>(
      `/workbench/cases/${id}/decision`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  workbenchPairContext: (driver_id: string, client_id: string, date?: string) => {
    const qs = new URLSearchParams({ driver_id, client_id });
    if (date) qs.set("date", date);
    return request<WorkbenchPairContext>(`/workbench/pair-context?${qs.toString()}`);
  },
  workbenchSuspiciousOrders: (driver_id: string, client_id: string, date: string, limit = 20) =>
    request<SuspiciousOrdersResponse>(
      `/workbench/suspicious-orders?driver_id=${encodeURIComponent(driver_id)}&client_id=${encodeURIComponent(client_id)}&date=${date}&limit=${limit}`,
    ),
};
