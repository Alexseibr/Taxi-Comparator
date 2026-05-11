// lib/settings.mjs — типизированный доступ к таблице settings.
//
// ml_workflow управляет правилами автосоздания тикетов из ML-расхождений
// и поведением labeling queue. Все значения редактируются из /newstat/settings.
import { query } from "./db.mjs";

export const ML_WORKFLOW_DEFAULTS = Object.freeze({
  ml_mode:                         "BALANCED",
  disagreement_delta_threshold:    30,
  ml_discovery_min_score:          80,
  ml_discovery_max_rule_score:     50,
  ticket_min_money_at_risk_byn:     5,
  ticket_max_per_day:              50,
  ticket_max_per_rescore:         100,
  enable_strong_disagreement_tickets: false,
  enable_rule_overkill_tickets:       false,
});

/**
 * Конфиг режимов. ml_mode имеет приоритет над старыми флагами.
 * null = поле не переопределяется (берётся из cfg/defaults).
 */
export const MODE_CONFIG = Object.freeze({
  SAFE: {
    label:                     "SAFE",
    description:               "Только ML_DISCOVERY (высокая уверенность модели). Минимум шума.",
    create_tickets:            true,
    enable_ml_discovery:       true,
    enable_strong:             false,
    enable_rule_overkill:      false,
    ticket_max_per_day:        20,
    ticket_max_per_rescore:    100,
    min_money_override:        5,
  },
  BALANCED: {
    label:                     "BALANCED",
    description:               "ML_DISCOVERY + STRONG_DISAGREEMENT top-50/день. Рекомендованный режим.",
    create_tickets:            true,
    enable_ml_discovery:       true,
    enable_strong:             true,
    enable_rule_overkill:      false,
    ticket_max_per_day:        50,
    ticket_max_per_rescore:    100,
    min_money_override:        null,
  },
  AGGRESSIVE: {
    label:                     "AGGRESSIVE",
    description:               "ML_DISCOVERY + STRONG + RULE_OVERKILL. Высокий охват, больше ложных срабатываний.",
    create_tickets:            true,
    enable_ml_discovery:       true,
    enable_strong:             true,
    enable_rule_overkill:      true,
    ticket_max_per_day:        200,
    ticket_max_per_rescore:    500,
    min_money_override:        0,
  },
  TRAINING: {
    label:                     "TRAINING",
    description:               "Тикеты не создаются. Все кейсы идут только в labeling queue для разметки.",
    create_tickets:            false,
    enable_ml_discovery:       false,
    enable_strong:             false,
    enable_rule_overkill:      false,
    ticket_max_per_day:        0,
    ticket_max_per_rescore:    0,
    min_money_override:        null,
  },
});

/**
 * Применить MODE_CONFIG поверх cfg (mode имеет приоритет над флагами).
 * Возвращает новый объект с эффективными параметрами для _createTicketsFromDisagreements.
 */
export function applyModeConfig(cfg) {
  const mc = MODE_CONFIG[cfg.ml_mode];
  if (!mc) return cfg;
  return {
    ...cfg,
    _create_tickets:              mc.create_tickets,
    enable_strong_disagreement_tickets: mc.enable_strong,
    enable_rule_overkill_tickets:       mc.enable_rule_overkill,
    ticket_max_per_day:                 mc.ticket_max_per_day,
    ticket_max_per_rescore:             mc.ticket_max_per_rescore,
    ...(mc.min_money_override !== null
      ? { ticket_min_money_at_risk_byn: mc.min_money_override }
      : {}),
  };
}

let _cached = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 30_000;

/**
 * Прочитать ml_workflow из settings, дополнив дефолтами.
 * Кэшируется на 30с (значения редко меняются, но не хочется реад на каждый
 * вызов /ml/rescore).
 */
export async function getMlWorkflowSettings({ skipCache = false } = {}) {
  const now = Date.now();
  if (!skipCache && _cached && now - _cachedAt < CACHE_TTL_MS) return _cached;

  const r = await query("SELECT value FROM settings WHERE key = 'ml_workflow'");
  const raw = r.rows[0]?.value || {};
  const merged = { ...ML_WORKFLOW_DEFAULTS, ...raw };
  _cached = merged;
  _cachedAt = now;
  return merged;
}

/** Сбросить кэш (вызывается из PUT /settings/ml_workflow). */
export function invalidateMlWorkflowCache() {
  _cached = null;
  _cachedAt = 0;
}
