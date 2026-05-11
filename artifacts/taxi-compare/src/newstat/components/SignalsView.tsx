// SignalsView — человекочитаемый рендер JSON-объекта `signals` из ML/risk-движка
// для рабочего места Newstat. Все ключи переведены на русский, числовые
// значения форматируются по контексту (доли 0..1, проценты 0..100, BYN-суммы,
// boolean → да/нет). Для отладки доступен переключатель «Список / JSON».
//
// Источник данных: fraud_tickets.signals (jsonb). Структура зависит от
// entity_type кейса (driver/pair/client) — словарь покрывает все три.

import { useState } from "react";

type Json = unknown;

// ── Словарь переводов ключей ───────────────────────────────────────────────
// Если ключ отсутствует — выводим как есть (английский), чтобы не ломать
// рендер при появлении новых сигналов на бэкенде.
const LABELS: Record<string, string> = {
  // top-level
  driver_name: "Имя водителя",
  client_name: "Клиент",
  client_phone: "Телефон клиента",
  noncash_gmv: "Безнал, BYN",
  noncash_gmv_byn: "Безнал, BYN",
  gmv_total: "Оборот всего, BYN",
  orders_count: "Заказов",
  total_orders: "Всего заказов",
  unique_drivers: "Уникальных водителей",
  repeat_ratio: "Доля повторов",
  pair_orders: "Заказов в связке",
  pair_share_by_client: "Доля у клиента",
  pair_share_by_driver: "Доля у водителя",
  suspicious_ratio: "Подозрительность, %",
  cashback_dependency: "Зависимость от кэшбэка, %",
  collusion_loss_risk_byn: "Риск потерь от сговора, BYN",
  cashback_exposure: "Влияние кэшбэка, %",
  cashback_money_byn: "Сумма кэшбэка, BYN",
  suspicious_activity: "Подозрительная активность, %",
  repeat_driver_dependency: "Зависимость от повторного водителя, %",
  earnings_risk: "Риск завышения заработка, %",
  collusion_risk: "Риск сговора, %",
  guarantee_risk: "Риск злоупотребления гарантиями, %",
  earnings_money_byn: "Сумма к доходу-риску, BYN",
  collusion_money_byn: "Сумма к сговору-риску, BYN",
  guarantee_money_byn: "Сумма к гарантиям-риску, BYN",

  // groups
  risk_signals: "Сигналы риска",
  ratios: "Доли (0–1)",
  breakdown: "Декомпозиция, %",
  earnings: "Риск завышения заработка",
  collusion: "Риск сговора",
  guarantee: "Риск гарантий",
  suspicious_breakdown: "Подозрительная активность",
  repeat_driver_breakdown: "Зависимость от водителя",
  cashback_exposure_breakdown: "Влияние кэшбэка",

  // ratios
  noncash: "Доля безнала",
  cash: "Доля наличных",
  cancel: "Доля отмен",
  short_trip: "Доля коротких поездок",
  fast_arrival: "Доля быстрых подач",
  repeat_client: "Доля повторных клиентов",
  repeat_driver: "Доля повторных водителей",
  orders_per_shift_hour: "Заказов в час смены",
  concentration_one_client: "Концентрация на одном клиенте",
  concentration_one_driver: "Концентрация на одном водителе",
  short_fast_combo: "Короткий+быстрый комбо",
  client_share_by_pair: "Доля клиента в связке",
  driver_share_by_pair: "Доля водителя в связке",

  // earnings
  e1_cancel: "Отмены",
  e2_short_trip: "Короткие поездки",
  e3_cash_short: "Наличные за короткие",
  e4_concentration: "Концентрация",

  // collusion
  c1_concentration: "Концентрация",
  c2_repeat_client: "Повторный клиент",
  noncash_top_client_estimate_byn: "Оценка безнала по топ-клиенту, BYN",

  // guarantee
  s1_short_trip: "Короткие поездки",
  s2_fast_arrival: "Быстрые подачи",
  s3_repeat_client: "Повторный клиент",
  s4_low_activity: "Низкая активность",

  // client suspicious_breakdown
  s1_high_count: "Много заказов",
  s2_all_noncash: "Весь безнал",
  s3_short_fast_combo: "Короткий+быстрый комбо",

  // client repeat_driver_breakdown
  s1_concentration: "Концентрация",
  s2_repeat_driver: "Повторный водитель",
  s4_one_driver: "Один водитель",

  // pair breakdown
  repeat: "Повторы",
  suspicious_combo: "Подозрительный комбо",
  suspicious_noncash: "Безнал-подозрение",

  // misc
  qualified: "Квалифицирован",
  payout_byn: "Выплата, BYN",
  shift_hours: "Часы смены",
  noncash_orders: "Безнал-заказов",
  cashback_paid_byn: "Кэшбэк выплачен, BYN",
  cashback_pct_used: "Использовано % кэшбэка",
  short_trip_orders: "Короткие поездки (шт)",
  fast_arrival_orders: "Быстрые подачи (шт)",
  cashback_earned_byn: "Кэшбэк начислен, BYN",
};

// Группы, в которых значения — это доли в [0..1] и нужно показывать «0.67 (67%)».
const RATIO_GROUPS = new Set(["ratios"]);

// Группы, в которых значения — это уже проценты [0..100].
const PERCENT_GROUPS = new Set([
  "breakdown",
  "earnings",
  "collusion",
  "guarantee",
  "suspicious_breakdown",
  "repeat_driver_breakdown",
  "cashback_exposure_breakdown",
]);

function labelOf(key: string): string {
  return LABELS[key] || key;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

function fmtNumber(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  // toFixed → убрать незначащие нули в хвосте
  const s = n.toFixed(digits);
  return s.replace(/\.?0+$/, "") || "0";
}

function formatValue(
  key: string,
  value: unknown,
  parentKey: string | null,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "да" : "нет";

  if (typeof value === "number") {
    // BYN-суммы: ключ оканчивается на _byn ИЛИ метка содержит «BYN»
    const labelStr = labelOf(key);
    if (key.endsWith("_byn") || /BYN/i.test(labelStr)) {
      return `${fmtNumber(value, 2)} BYN`;
    }
    if (parentKey && RATIO_GROUPS.has(parentKey)) {
      // доли в [0..1] → «0.67 (67%)»
      const pct = (value * 100).toFixed(value < 0.1 ? 1 : 0);
      return `${fmtNumber(value, 2)} (${pct}%)`;
    }
    if (parentKey && PERCENT_GROUPS.has(parentKey)) {
      return `${fmtNumber(value, 2)}%`;
    }
    if (key.endsWith("_risk") || /,\s*%$/.test(labelStr)) {
      return `${fmtNumber(value, 2)}%`;
    }
    if (key === "repeat_ratio") {
      return `${fmtNumber(value, 2)} (${(value * 100).toFixed(0)}%)`;
    }
    return fmtNumber(value, 2);
  }

  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  return String(value);
}

interface NodeProps {
  data: Record<string, unknown>;
  parentKey: string | null;
  depth: number;
}

function ObjectNode({ data, parentKey, depth }: NodeProps) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <div className="text-xs text-slate-400">— пусто</div>;
  }
  return (
    <dl className="grid grid-cols-[minmax(180px,auto)_1fr] gap-x-3 gap-y-1 text-xs">
      {entries.map(([k, v]) => {
        const isObj = isPlainObject(v);
        if (isObj) {
          return (
            <div
              key={k}
              className="col-span-2 mt-2 first:mt-0"
              data-testid={`signals-group-${k}`}
            >
              <div
                className="text-[11px] uppercase tracking-wide text-slate-500 mb-1"
                style={depth > 0 ? { paddingLeft: `${depth * 0.5}rem` } : undefined}
              >
                {labelOf(k)}
              </div>
              <div
                className="ml-2 pl-3 border-l border-slate-200"
                data-signals-key={k}
              >
                <ObjectNode
                  data={v as Record<string, unknown>}
                  parentKey={k}
                  depth={depth + 1}
                />
              </div>
            </div>
          );
        }
        return (
          <div key={k} className="contents" data-signals-key={k}>
            <dt className="text-slate-600">{labelOf(k)}</dt>
            <dd className="text-slate-900 font-medium tabular-nums">
              {formatValue(k, v, parentKey)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export interface SignalsViewProps {
  signals: Json;
}

export default function SignalsView({ signals }: SignalsViewProps) {
  const [mode, setMode] = useState<"pretty" | "json">("pretty");

  if (!signals || (isPlainObject(signals) && Object.keys(signals).length === 0)) {
    return <div className="text-xs text-slate-400">Нет сигналов</div>;
  }

  return (
    <div className="space-y-2" data-testid="signals-view">
      <div className="flex justify-end">
        <div
          role="group"
          aria-label="Формат отображения сигналов"
          className="inline-flex rounded-md border border-slate-200 overflow-hidden text-[11px]"
        >
          <button
            type="button"
            onClick={() => setMode("pretty")}
            aria-pressed={mode === "pretty"}
            className={`px-2 py-1 ${
              mode === "pretty"
                ? "bg-slate-700 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
            data-testid="btn-signals-pretty"
          >
            Список
          </button>
          <button
            type="button"
            onClick={() => setMode("json")}
            aria-pressed={mode === "json"}
            className={`px-2 py-1 border-l border-slate-200 ${
              mode === "json"
                ? "bg-slate-700 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
            data-testid="btn-signals-json"
          >
            JSON
          </button>
        </div>
      </div>
      {mode === "pretty" ? (
        isPlainObject(signals) ? (
          <ObjectNode data={signals} parentKey={null} depth={0} />
        ) : (
          <pre className="text-xs text-slate-600 bg-slate-50 rounded p-2 overflow-x-auto max-h-60 whitespace-pre-wrap">
            {JSON.stringify(signals, null, 2)}
          </pre>
        )
      ) : (
        <pre className="text-xs text-slate-600 bg-slate-50 rounded p-3 overflow-x-auto max-h-60 whitespace-pre-wrap">
          {JSON.stringify(signals, null, 2)}
        </pre>
      )}
    </div>
  );
}
