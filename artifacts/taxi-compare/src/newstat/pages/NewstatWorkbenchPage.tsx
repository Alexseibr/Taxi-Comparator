/**
 * /newstat/workbench — рабочее место антифродера.
 * 2-колоночный layout: очередь кейсов слева, карточка справа.
 * Hotkeys: F=false positive, N/→=следующий, ←=предыдущий, M=монитор, D=контекст пары.
 * Дефолтные фильтры: High priority, Money ≥ 5 BYN, Yesterday+Today.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { NewstatLayout } from "../components/NewstatLayout";
import SignalsView from "../components/SignalsView";
import {
  newstatApi,
  type MlWorkflowSettings,
  type SuspiciousOrder,
  type SuspiciousFlagCounts,
  type SuspiciousOrdersResponse,
  type SuspiciousPattern,
  type SuggestedAction,
  type WorkbenchCaseDetail,
  type WorkbenchCaseSummary,
  type WorkbenchDecisionBody,
  type WorkbenchKpi,
  type WorkbenchPairContext,
  type WorkbenchWhyReason,
} from "../lib/api";

// ─────────────────────────── утилиты ────────────────────────────────────────

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return Number(n).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}
function priorityColor(p: string): string {
  if (p === "high") return "text-rose-700 bg-rose-50 border-rose-200";
  if (p === "medium") return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-slate-600 bg-slate-50 border-slate-200";
}
function severityIcon(s: string): string {
  if (s === "high") return "🔴";
  if (s === "medium") return "🟡";
  return "ℹ️";
}
function mlModeBadge(mode?: string | null): string {
  if (mode === "TRAINING")   return "bg-purple-100 text-purple-800 border-purple-200";
  if (mode === "AGGRESSIVE") return "bg-rose-100 text-rose-800 border-rose-200";
  if (mode === "SAFE")       return "bg-emerald-100 text-emerald-800 border-emerald-200";
  return "bg-blue-100 text-blue-800 border-blue-200";
}

// ─────────────────────── Default Filters ────────────────────────────────────

interface Filters {
  date_from: string;
  date_to: string;
  status: string;
  priority: string;
  entity_type: string;
  min_money: number;
}

const DEFAULT_FILTERS: Filters = {
  date_from:   isoYesterday(),
  date_to:     isoToday(),
  status:      "new,in_review",
  priority:    "high",
  entity_type: "",
  min_money:   5,
};

// ─────────────────────── KPI карточки ────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`border rounded-lg px-4 py-3 min-w-[130px] ${accent ? "bg-rose-50 border-rose-200" : "bg-white border-slate-200"}`}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${accent ? "text-rose-700" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─────────────────────── WHY block ───────────────────────────────────────────

function WhyBlock({ reasons }: { reasons: WorkbenchWhyReason[] }) {
  if (!reasons.length) return <p className="text-sm text-slate-400">Причины не определены</p>;
  return (
    <ul className="space-y-1.5">
      {reasons.map((r) => (
        <li key={r.key} className="flex items-start gap-2 text-sm">
          <span className="text-base leading-none mt-0.5">{severityIcon(r.severity)}</span>
          <div>
            <span className="font-medium text-slate-800">{r.label}</span>
            {r.value && <span className="ml-1.5 text-slate-500">{r.value}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────── MONEY block ─────────────────────────────────────────

function MoneyBlock({ money }: { money: WorkbenchCaseDetail["money"] }) {
  const rows: [string, number | null][] = [
    ["GMV", money.gmv],
    ["Безнал GMV", money.noncash_gmv],
    ["Риск кэшбэка", money.cashback_risk],
    ["Риск гарантии", money.guarantee_risk],
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.filter(([, v]) => v != null && v > 0).map(([label, value]) => (
        <div key={label} className="text-sm">
          <p className="text-xs text-slate-500">{label}</p>
          <p className="font-semibold tabular-nums">{fmtMoney(value)} BYN</p>
        </div>
      ))}
      <div className="text-sm col-span-2 border-t border-slate-100 pt-2 mt-1">
        <p className="text-xs text-slate-500">Итого под риском</p>
        <p className="text-lg font-bold text-rose-700 tabular-nums">{fmtMoney(money.total_at_risk)} BYN</p>
      </div>
    </div>
  );
}

// ─────────────────────── Queue item ──────────────────────────────────────────

function QueueItem({
  c,
  active,
  onClick,
}: {
  c: WorkbenchCaseSummary;
  active: boolean;
  onClick: () => void;
}) {
  const statusDot = c.status === "confirmed_fraud" ? "🔴"
    : c.status === "false_positive" ? "🟢"
    : c.status === "in_review" ? "🟡" : "⚪";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-slate-100 transition-colors ${
        active ? "bg-indigo-50 border-l-2 border-l-indigo-500" : "hover:bg-slate-50"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`inline-block px-1.5 py-0.5 rounded text-xs border ${priorityColor(c.priority)}`}>
              {c.priority}
            </span>
            <span className="text-xs text-slate-400">{c.entity_type}</span>
            <span className="text-xs text-slate-300">#{c.ticket_id}</span>
            <span className="text-xs">{statusDot}</span>
          </div>
          <p className="text-sm font-medium text-slate-800 truncate">
            {c.driver_name || c.driver_id || "—"}
            {c.client_id && <span className="text-slate-400 ml-1">·c{c.client_id}</span>}
          </p>
          {c.why[0] && (
            <p className="text-xs text-slate-500 truncate mt-0.5">
              {severityIcon(c.why[0].severity)} {c.why[0].label}
            </p>
          )}
          <p className="text-xs text-slate-300 mt-0.5">{c.date}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold text-rose-700 tabular-nums">
            {fmtMoney(c.money_at_risk_byn)}
          </p>
          <p className="text-xs text-slate-400">BYN</p>
          {c.final_score != null && (
            <p className="text-xs text-slate-400">s{c.final_score}</p>
          )}
        </div>
      </div>
    </button>
  );
}

// ─────────────────────── ACTION block ────────────────────────────────────────

interface ActionBlockProps {
  caseItem: WorkbenchCaseDetail;
  onDecision: (body: WorkbenchDecisionBody) => Promise<void>;
  submitting: boolean;
  /** Refs для hotkey вызова */
  fpRef?: React.RefObject<(() => void) | null>;
  monitorRef?: React.RefObject<(() => void) | null>;
}

function ActionBlock({ caseItem, onDecision, submitting, fpRef, monitorRef }: ActionBlockProps) {
  const [comment, setComment]         = useState("");
  const [denyGuarantee, setDenyGuar]  = useState(false);
  const [blockCashback, setBlockCash] = useState(false);
  const [confirmMode, setConfirmMode] = useState(false);

  const decided = !["new", "in_review"].includes(caseItem.status);
  const isPair   = caseItem.entity_type === "pair";
  const hasDriver = !!caseItem.driver_id;
  const hasClient = !!caseItem.client_id;

  async function handleConfirm() {
    await onDecision({
      action:         "confirm_fraud",
      deny_guarantee: isPair && hasDriver ? denyGuarantee : false,
      block_cashback: (isPair || caseItem.entity_type === "client") && hasClient ? blockCashback : false,
      comment:        comment.trim() || undefined,
    });
  }

  // Hotkey вызовы
  if (fpRef) {
    fpRef.current = () => {
      if (!decided && !submitting) {
        void onDecision({ action: "false_positive", comment: comment.trim() || undefined });
      }
    };
  }
  if (monitorRef) {
    monitorRef.current = () => {
      if (!decided && !submitting) {
        void onDecision({ action: "monitor", comment: comment.trim() || undefined });
      }
    };
  }

  if (decided) {
    const color = caseItem.status === "confirmed_fraud"
      ? "bg-rose-50 border-rose-200 text-rose-800"
      : caseItem.status === "false_positive"
        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
        : "bg-amber-50 border-amber-200 text-amber-800";
    return (
      <div className={`rounded-lg border px-4 py-3 ${color}`}>
        <p className="font-semibold">
          {caseItem.status === "confirmed_fraud"  ? "🚨 Подтверждён фрод"
            : caseItem.status === "false_positive" ? "✅ Ложное срабатывание"
            : "👁 На контроле"}
        </p>
        {caseItem.decision && (
          <p className="text-sm opacity-75 mt-0.5">действие: {caseItem.decision}</p>
        )}
        {caseItem.label_status === "labeled" && (
          <p className="text-xs mt-1 opacity-70">
            ML метка: {caseItem.label_value === 1 ? "fraud (1)" : "false positive (0)"}
          </p>
        )}
      </div>
    );
  }

  if (confirmMode) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-rose-700">🚨 Подтвердить фрод</p>

        {isPair && hasDriver && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={denyGuarantee}
              onChange={(e) => setDenyGuar(e.target.checked)}
              className="rounded"
            />
            <span>Обнулить гарантийную выплату водителю</span>
          </label>
        )}
        {(isPair || caseItem.entity_type === "client") && hasClient && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={blockCashback}
              onChange={(e) => setBlockCash(e.target.checked)}
              className="rounded"
            />
            <span>Заблокировать кэшбэк клиента</span>
          </label>
        )}

        <div className="text-xs text-slate-400 flex items-center gap-1">
          <span>🤖</span>
          <span>ML метка label=1 проставится автоматически</span>
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Комментарий (необязательно)"
          className="w-full border rounded p-2 text-sm min-h-[52px]"
          maxLength={2000}
        />

        <div className="flex gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleConfirm()}
            className="flex-1 px-3 py-2.5 bg-rose-600 text-white rounded-lg text-sm font-medium hover:bg-rose-700 disabled:opacity-50"
          >
            {submitting ? "…" : "✅ Подтвердить фрод"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmMode(false)}
            className="px-3 py-2.5 border border-slate-300 rounded-lg text-sm hover:bg-slate-50"
          >
            Назад
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2">
        {/* F hotkey → false_positive */}
        <button
          type="button"
          disabled={submitting}
          onClick={() => void onDecision({ action: "false_positive", comment: comment.trim() || undefined })}
          className="w-full px-4 py-3 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <span className="opacity-60 text-xs font-mono border border-white/40 rounded px-1">F</span>
          {submitting ? "…" : "✅ False positive"}
        </button>
        {/* Confirm fraud — требует подтверждения */}
        <button
          type="button"
          disabled={submitting}
          onClick={() => setConfirmMode(true)}
          className="w-full px-4 py-3 bg-rose-600 text-white rounded-lg text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
        >
          🚨 Confirm fraud
        </button>
        {/* M hotkey → monitor */}
        <button
          type="button"
          disabled={submitting}
          onClick={() => void onDecision({ action: "monitor", comment: comment.trim() || undefined })}
          className="w-full px-4 py-3 border border-amber-400 text-amber-700 bg-amber-50 rounded-lg text-sm font-medium hover:bg-amber-100 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <span className="opacity-60 text-xs font-mono border border-amber-400 rounded px-1">M</span>
          {submitting ? "…" : "👁 Мониторить"}
        </button>
      </div>
      <div className="text-xs text-slate-400 flex items-center gap-1 mt-1">
        <span>🤖</span>
        <span>FP→label=0, Confirm→label=1 автоматически</span>
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Комментарий (необязательно)"
        className="w-full border rounded p-2 text-sm min-h-[44px] mt-1"
        maxLength={2000}
      />
    </div>
  );
}

// ─────────────────────── Suspicious Orders Block v2 ──────────────────────────

const FLAG_META: Record<string, { label: string; color: string }> = {
  is_short_trip:          { label: "Кор.поездка",   color: "bg-amber-100 text-amber-800 border-amber-300" },
  is_fast_arrival:        { label: "Быстрая подача", color: "bg-orange-100 text-orange-800 border-orange-300" },
  is_noncash:             { label: "Безнал",          color: "bg-blue-100 text-blue-800 border-blue-300" },
  is_repeat_pair:         { label: "Повтор пары",     color: "bg-rose-100 text-rose-800 border-rose-300" },
  is_cancel_after_accept: { label: "Отмена принятой", color: "bg-purple-100 text-purple-800 border-purple-300" },
};

const PRIMARY_FLAG_LABEL: Record<string, string> = {
  cancel_after_accept: "Отмена принятой",
  repeat_noncash:      "Повтор + безнал",
  repeat_pair:         "Повтор пары",
  noncash:             "Безнал",
  short_trip:          "Короткая поездка",
  fast_arrival:        "Быстрая подача",
};

const PATTERN_META: Record<string, { label: string; icon: string; color: string }> = {
  cancel_after_accept: { label: "Отмены принятых",    icon: "🚫", color: "bg-purple-50 border-purple-200 text-purple-800" },
  short_noncash:       { label: "Короткие безналичные", icon: "💳", color: "bg-blue-50 border-blue-200 text-blue-800" },
  repeat_pair:         { label: "Повторная пара",      icon: "🔁", color: "bg-rose-50 border-rose-200 text-rose-800" },
  device_cluster:      { label: "Общие устройства",   icon: "📱", color: "bg-amber-50 border-amber-200 text-amber-800" },
};

const ACTION_META: Record<SuggestedAction, { label: string; color: string; icon: string }> = {
  confirm_fraud:  { label: "Подтвердить мошенничество", color: "bg-rose-600 hover:bg-rose-700 text-white", icon: "🚨" },
  monitor:        { label: "Мониторинг",                 color: "bg-amber-500 hover:bg-amber-600 text-white", icon: "👁️" },
  false_positive: { label: "Ложная тревога",             color: "bg-slate-400 hover:bg-slate-500 text-white", icon: "✅" },
};

const DECISION_MAP: Record<SuggestedAction, WorkbenchDecisionBody["action"]> = {
  confirm_fraud:  "confirm_fraud",
  monitor:        "monitor",
  false_positive: "false_positive",
};

const PAYMENT_TYPE_RU: Record<string, string> = {
  noncash:    "безнал",
  cash:       "наличные",
  cashback:   "кешбэк",
  bonus:      "бонусы",
  card:       "карта",
};
function paymentTypeRu(v?: string | null): string {
  if (!v) return "—";
  return PAYMENT_TYPE_RU[v] ?? v;
}

const SUGGESTED_REASON_RU: Record<string, string> = {
  "weak signal":   "слабый сигнал",
  "mixed signals": "смешанные сигналы",
  "cancel abuse":  "злоупотребление отменами",
  "multi account": "множественные аккаунты",
};

// ─── WhyHereBlock: человеко-читаемое объяснение, почему тикет попал в очередь ────
type WhyBullet = { icon: string; text: string; tone: "danger" | "warn" | "info" };

function buildWhyBullets(c: WorkbenchCaseDetail): WhyBullet[] {
  const out: WhyBullet[] = [];
  const sig = (c.signals ?? {}) as Record<string, unknown>;
  const rs  = (sig.risk_signals ?? {}) as Record<string, unknown>;
  const ratios    = (rs.ratios    ?? {}) as Record<string, number>;
  const breakdown = (rs.breakdown ?? {}) as Record<string, number>;
  const ordersCount = Number(sig.orders_count ?? 0);
  const noncashGmv  = Number(sig.noncash_gmv  ?? 0);

  // 1. Сводка
  if (ordersCount > 0) {
    out.push({
      icon: "📦",
      tone: "info",
      text: `За день: ${ordersCount} ${ordersCount === 1 ? "заказ" : ordersCount < 5 ? "заказа" : "заказов"}${noncashGmv > 0 ? `, безналом на ${fmtMoney(noncashGmv)} BYN` : ""}.`,
    });
  }

  // 2. Расхождение правила↔ML
  if (c.delta != null && c.delta <= -20) {
    out.push({
      icon: "📊",
      tone: "warn",
      text: `Правила (${c.rule_score}/100) оценивают риск заметно выше ML (${c.ml_score ?? "—"}/100). Расхождение подсветило случай для ручной проверки.`,
    });
  }

  // 3. Доля безнала
  const noncashRatio = Number(ratios.noncash ?? 0);
  if (noncashRatio >= 0.8) {
    out.push({
      icon: "💳",
      tone: noncashRatio >= 0.95 ? "danger" : "warn",
      text: `${Math.round(noncashRatio * 100)}% оплат — безналичные (типичный шаблон сговора ради кешбэка/гарантии).`,
    });
  }

  // 4. Связанность пары
  const clientShare = Number(ratios.client_share_by_pair ?? 0);
  const driverShare = Number(ratios.driver_share_by_pair ?? 0);
  if (clientShare >= 0.7) {
    out.push({
      icon: "🔁",
      tone: clientShare >= 0.95 ? "danger" : "warn",
      text: `Клиент работает почти исключительно с этим водителем — ${Math.round(clientShare * 100)}% его поездок.`,
    });
  }
  if (driverShare >= 0.4) {
    out.push({
      icon: "🔁",
      tone: driverShare >= 0.7 ? "danger" : "warn",
      text: `У водителя ${Math.round(driverShare * 100)}% поездок именно с этим клиентом.`,
    });
  }

  // 5. Зависимость от кешбэка
  const cashDep = Number(breakdown.cashback_dependency ?? 0);
  if (cashDep >= 70) {
    out.push({
      icon: "💸",
      tone: cashDep >= 90 ? "danger" : "warn",
      text: `Сильная зависимость от кешбэка (${cashDep}/100) — клиент пользуется в основном поездками с возвратом.`,
    });
  }

  // 6. Подозрительные шаблоны
  const susNoncash = Number(breakdown.suspicious_noncash ?? 0);
  if (susNoncash >= 50) {
    out.push({
      icon: "⚠️",
      tone: "warn",
      text: `Подозрительный шаблон безналичных оплат (${susNoncash}/100): однотипные суммы или маршруты.`,
    });
  }
  const shortFast = Number(ratios.short_fast_combo ?? 0);
  if (shortFast >= 0.3) {
    out.push({
      icon: "⚡",
      tone: "warn",
      text: `${Math.round(shortFast * 100)}% поездок — короткие с быстрой подачей (классика «нагона километров»).`,
    });
  }

  // 7. Повтор пары
  const repeat = Number(sig.repeat_ratio ?? 0);
  if (repeat >= 0.5) {
    out.push({
      icon: "🔂",
      tone: "warn",
      text: `Повторные пары: ${Math.round(repeat * 100)}% — те же связки клиент-водитель встречаются часто.`,
    });
  }

  // 8. Деньги под риском (всегда показываем)
  if (c.money_at_risk_byn > 0) {
    out.push({
      icon: "💰",
      tone: c.money_at_risk_byn >= 10 ? "warn" : "info",
      text: `Под риском: ${fmtMoney(c.money_at_risk_byn)} BYN (комиссии/кешбэк/гарантии).`,
    });
  }

  return out;
}

function WhyHereBlock({ caseItem }: { caseItem: WorkbenchCaseDetail }) {
  const bullets = buildWhyBullets(caseItem);
  const isPair = caseItem.entity_type === "pair";
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
      <div className="flex items-start gap-2 mb-2">
        <span className="text-lg leading-none">🎯</span>
        <div className="flex-1">
          <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wide">
            Почему этот тикет в очереди
          </h3>
          <p className="text-xs text-amber-800 mt-0.5">
            {isPair
              ? "Это пара «водитель + клиент». Система оценила её как высокорисковую по нескольким признакам:"
              : "Это водитель. Система оценила его как высокорискового по нескольким признакам:"}
          </p>
        </div>
      </div>
      {bullets.length === 0 ? (
        <p className="text-xs text-amber-700">Нет дополнительных пояснений (только базовая оценка правил).</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {bullets.map((b, i) => (
            <li
              key={i}
              className={`flex gap-2 leading-snug ${
                b.tone === "danger" ? "text-rose-800"
                : b.tone === "warn" ? "text-amber-900"
                : "text-slate-700"
              }`}
            >
              <span className="shrink-0">{b.icon}</span>
              <span>{b.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-amber-700 border-t border-amber-200 pt-2 italic">
        Итоговая оценка: {caseItem.final_score}/100 ({caseItem.priority === "high" ? "высокий" : caseItem.priority === "medium" ? "средний" : "низкий"} приоритет).
        Ниже см. блок «Улики» — там Evidence Layer показывает, насколько эти признаки подтверждаются конкретными поездками.
      </p>
    </div>
  );
}

function FlagBadge({ flagKey }: { flagKey: string }) {
  const meta = FLAG_META[flagKey] ?? { label: flagKey, color: "bg-slate-100 text-slate-700 border-slate-300" };
  return (
    <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border ${meta.color}`}>
      {meta.label}
    </span>
  );
}

function FlagCountRow({ counts }: { counts: SuspiciousFlagCounts }) {
  const rows = [
    { key: "is_cancel_after_accept", val: counts.cancel_after_accept },
    { key: "is_repeat_pair",         val: counts.repeat_pair },
    { key: "is_noncash",             val: counts.noncash },
    { key: "is_short_trip",          val: counts.short_trip },
    { key: "is_fast_arrival",        val: counts.fast_arrival },
  ].filter((r) => r.val > 0);
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.map((r) => (
        <span key={r.key} className="inline-flex items-center gap-1">
          <FlagBadge flagKey={r.key} />
          <span className="text-[10px] text-slate-500">×{r.val}</span>
        </span>
      ))}
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const color =
    value >= 70 ? "bg-rose-500"
    : value >= 40 ? "bg-amber-400"
    : "bg-slate-300";
  const label =
    value >= 70 ? "Высокая"
    : value >= 40 ? "Средняя"
    : "Низкая";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-600 font-medium">Уверенность</span>
        <span className={`font-bold ${value >= 70 ? "text-rose-600" : value >= 40 ? "text-amber-600" : "text-slate-500"}`}>
          {value}% — {label}
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function PatternCard({ pattern }: { pattern: SuspiciousPattern }) {
  const meta = PATTERN_META[pattern.type] ?? { label: pattern.type, icon: "⚠️", color: "bg-slate-50 border-slate-200 text-slate-700" };
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${meta.color}`}>
      <span>{meta.icon}</span>
      <span className="font-medium">{meta.label}</span>
      <span className="ml-auto font-bold">×{pattern.count}</span>
      {pattern.sample_orders.length > 0 && (
        <span className="text-[10px] opacity-60 font-mono truncate max-w-[80px]" title={pattern.sample_orders.join(", ")}>
          #{pattern.sample_orders[0]}…
        </span>
      )}
    </div>
  );
}

function SuspiciousOrderRow({
  order,
  isPrimary = false,
}: {
  order: SuspiciousOrder;
  isPrimary?: boolean;
}) {
  const activeFlags = (Object.keys(FLAG_META) as string[]).filter(
    (k) => order[k as keyof SuspiciousOrder] === true,
  );
  return (
    <div className={`border rounded-lg px-3 py-2 space-y-1.5 ${isPrimary ? "bg-rose-50 border-rose-200 ring-1 ring-rose-200" : "bg-slate-50 border-slate-200"}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {isPrimary && (
          <span className="text-[10px] font-bold bg-rose-600 text-white px-1.5 py-0.5 rounded">
            🔑 КЛЮЧЕВАЯ
          </span>
        )}
        {isPrimary && order.primary_flag && (
          <span className="text-[10px] font-semibold text-rose-700 bg-rose-100 border border-rose-200 px-1.5 py-0.5 rounded">
            {PRIMARY_FLAG_LABEL[order.primary_flag] ?? order.primary_flag}
          </span>
        )}
        <span className="text-xs font-mono text-slate-700 ml-auto">{order.order_id}</span>
        <span className="text-[10px] text-slate-400">
          {order.date}{order.created_at ? " " + new Date(order.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : ""}
        </span>
        <span
          className={`text-xs font-bold px-2 py-0.5 rounded border ${
            order.risk_score >= 40
              ? "text-rose-700 bg-rose-50 border-rose-200"
              : order.risk_score >= 20
              ? "text-amber-700 bg-amber-50 border-amber-200"
              : "text-slate-600 bg-white border-slate-200"
          }`}
        >
          {order.risk_score} pts
        </span>
      </div>
      <div className="flex gap-3 text-xs text-slate-600 flex-wrap">
        <span>{order.km != null ? `${order.km.toFixed(1)} км` : "—"}</span>
        <span>{order.trip_minutes != null ? `${order.trip_minutes.toFixed(0)} мин` : "—"}</span>
        <span>{order.arrival_minutes != null ? `подача ${order.arrival_minutes.toFixed(0)} мин` : ""}</span>
        <span className="text-slate-400">{paymentTypeRu(order.payment_type)}</span>
        <span className="font-medium text-slate-700">{order.gmv != null ? `${fmtMoney(order.gmv)} BYN` : "—"}</span>
      </div>
      {activeFlags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {activeFlags.map((k) => <FlagBadge key={k} flagKey={k} />)}
        </div>
      )}
    </div>
  );
}

function SuggestedActionBlock({
  action,
  reason,
  confidence,
  onAccept,
  accepting,
}: {
  action: SuggestedAction;
  reason: string;
  confidence: number;
  onAccept: (action: SuggestedAction) => void;
  accepting: boolean;
}) {
  const meta = ACTION_META[action];
  return (
    <div className={`rounded-lg border p-3 space-y-2 ${
      action === "confirm_fraud" ? "bg-rose-50 border-rose-200"
      : action === "monitor"    ? "bg-amber-50 border-amber-200"
      : "bg-slate-50 border-slate-200"
    }`}>
      <div className="flex items-center gap-2">
        <span className="text-sm">{meta.icon}</span>
        <div>
          <p className="text-xs font-semibold text-slate-700">Рекомендованное действие</p>
          <p className="text-sm font-bold text-slate-900">{meta.label}</p>
        </div>
        <span className="ml-auto text-[10px] text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
          {SUGGESTED_REASON_RU[reason] ?? reason}
        </span>
      </div>
      <button
        type="button"
        disabled={accepting || confidence < 20}
        onClick={() => onAccept(action)}
        className={`w-full text-sm font-medium py-1.5 rounded transition-colors ${meta.color} disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {accepting ? "Применяю…" : "Принять рекомендацию"}
      </button>
      {confidence < 20 && (
        <p className="text-[10px] text-slate-500 text-center">Уверенность слишком низкая для авто-решения</p>
      )}
    </div>
  );
}

function SuspiciousOrdersBlock({
  caseItem,
  onDecisionApplied,
}: {
  caseItem: WorkbenchCaseDetail;
  onDecisionApplied?: () => void;
}) {
  const [data, setData]     = useState<SuspiciousOrdersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!caseItem.driver_id || !caseItem.client_id) return;
    setLoading(true);
    setShowAll(false);
    newstatApi
      .workbenchSuspiciousOrders(caseItem.driver_id, caseItem.client_id, caseItem.date)
      .then((r) => {
        setLoading(false);
        if (r.ok) setData(r.data);
      });
  }, [caseItem.driver_id, caseItem.client_id, caseItem.date]);

  const handleAcceptRecommendation = async (action: SuggestedAction) => {
    if (!caseItem.ticket_id) return;
    setAccepting(true);
    const body: WorkbenchDecisionBody = { action: DECISION_MAP[action] };
    await newstatApi.workbenchDecision(caseItem.ticket_id, body);
    setAccepting(false);
    onDecisionApplied?.();
  };

  if (!caseItem.driver_id || !caseItem.client_id) return null;

  const primaryOrderIds = new Set((data?.primary_orders ?? []).map((o) => o.order_id));
  const nonPrimary = (data?.items ?? []).filter((o) => !primaryOrderIds.has(o.order_id));
  const visible = showAll ? nonPrimary : nonPrimary.slice(0, 5);

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Заголовок */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <span className="font-medium text-sm text-slate-700">
          Улики{data ? ` (${data.count} поездок)` : ""}
        </span>
        {loading && <span className="text-xs text-slate-400 animate-pulse">загрузка…</span>}
      </div>

      {data && (
        <div className="px-4 py-3 space-y-4">
          {/* Confidence */}
          <ConfidenceBar value={data.evidence_confidence} />

          {/* Рекомендованное действие */}
          <SuggestedActionBlock
            action={data.suggested_action}
            reason={data.suggested_reason}
            confidence={data.evidence_confidence}
            onAccept={handleAcceptRecommendation}
            accepting={accepting}
          />

          {/* Patterns */}
          {data.patterns.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Паттерны</p>
              {data.patterns.map((p) => (
                <PatternCard key={p.type} pattern={p} />
              ))}
            </div>
          )}

          {/* Hidden links summary */}
          {data.hidden_links.shared_device_count > 0 && (
            <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <span>📱</span>
              <span className="font-medium text-amber-800">
                {data.hidden_links.shared_device_count} общих устройств
                {data.hidden_links.related_clients.length > 0
                  ? ` · клиенты: ${data.hidden_links.related_clients.slice(0, 3).join(", ")}${data.hidden_links.related_clients.length > 3 ? "…" : ""}`
                  : ""}
              </span>
            </div>
          )}

          {/* Flag counts */}
          <FlagCountRow counts={data.flag_counts} />

          {/* PRIMARY поездки */}
          {data.primary_orders.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Ключевые поездки</p>
              {data.primary_orders.map((o) => (
                <SuspiciousOrderRow key={o.order_id} order={o} isPrimary />
              ))}
            </div>
          )}

          {/* Остальные поездки */}
          {nonPrimary.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Все подозрительные{nonPrimary.length > 5 && !showAll ? ` (топ 5 из ${nonPrimary.length})` : ` (${nonPrimary.length})`}
              </p>
              {visible.map((o) => (
                <SuspiciousOrderRow key={o.order_id} order={o} />
              ))}
              {nonPrimary.length > 5 && !showAll && (
                <button type="button" onClick={() => setShowAll(true)} className="text-xs text-indigo-600 hover:underline">
                  Показать все {nonPrimary.length} →
                </button>
              )}
              {showAll && nonPrimary.length > 5 && (
                <button type="button" onClick={() => setShowAll(false)} className="text-xs text-slate-400 hover:underline">
                  Свернуть
                </button>
              )}
            </div>
          )}

          {!loading && data.count === 0 && (
            <p className="text-xs text-slate-400">Нет подозрительных поездок за {caseItem.date}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────── Pair Context Drawer ─────────────────────────────────

function PairContextDrawer({
  caseItem,
  onClose,
}: {
  caseItem: WorkbenchCaseDetail | null;
  onClose: () => void;
}) {
  const [ctx, setCtx] = useState<WorkbenchPairContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!caseItem?.driver_id || !caseItem?.client_id) { setCtx(null); return; }
    setLoading(true);
    setErr(null);
    newstatApi.workbenchPairContext(caseItem.driver_id, caseItem.client_id, caseItem.date).then((r) => {
      setLoading(false);
      if (r.ok) setCtx(r.data);
      else setErr(r.error);
    });
  }, [caseItem?.driver_id, caseItem?.client_id, caseItem?.date]);

  return (
    <div className="fixed inset-0 z-[2001] flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative bg-white w-full max-w-lg h-full shadow-2xl overflow-y-auto flex flex-col">
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <div>
            <h2 className="font-semibold text-slate-800">Контекст пары</h2>
            {caseItem && (
              <p className="text-xs text-slate-500">
                Вод. {caseItem.driver_name || caseItem.driver_id} · Кл. {caseItem.client_id} · {caseItem.date}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <kbd className="text-xs border border-slate-200 rounded px-1.5 py-0.5 text-slate-400">D</kbd>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl font-bold leading-none">×</button>
          </div>
        </header>

        <div className="px-5 py-4 space-y-5 flex-1">
          {loading && <p className="text-slate-400 text-sm">Загрузка…</p>}
          {err && <p className="text-rose-600 text-sm">Ошибка: {err}</p>}
          {ctx && (
            <>
              {/* Graph summary */}
              {ctx.graph_summary && (
                <section className="flex gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-slate-800">{ctx.graph_summary.driver_degree ?? "—"}</p>
                    <p className="text-xs text-slate-500">клиентов у водителя</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-slate-800">{ctx.graph_summary.client_degree ?? "—"}</p>
                    <p className="text-xs text-slate-500">водителей у клиента</p>
                  </div>
                  {ctx.hidden_links && (
                    <div className="text-center">
                      <p className="text-2xl font-bold text-amber-600">{ctx.hidden_links.shared_device_count}</p>
                      <p className="text-xs text-slate-500">общих устройств</p>
                    </div>
                  )}
                </section>
              )}

              {/* Trend 7d */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Тренд 7 дн.</h3>
                <table className="w-full text-xs">
                  <thead className="text-left text-slate-400">
                    <tr>
                      <th className="pb-1">Дата</th>
                      <th className="pb-1 text-right">Rule</th>
                      <th className="pb-1 text-right">Деньги</th>
                      <th className="pb-1 text-right">GMV</th>
                      <th className="pb-1 text-right">Повтор</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ctx.trend_7d || ctx.risk_history || []).map((r) => (
                      <tr key={r.date} className="border-t border-slate-100">
                        <td className="py-1">{fmtDate(r.date)}</td>
                        <td className="py-1 text-right tabular-nums">{r.rule_score?.toFixed(0) ?? "—"}</td>
                        <td className="py-1 text-right tabular-nums text-rose-600">{fmtMoney(r.money_at_risk_byn)}</td>
                        <td className="py-1 text-right tabular-nums">{fmtMoney(r.gmv)}</td>
                        <td className="py-1 text-right tabular-nums text-slate-400">
                          {"repeat_ratio" in r && r.repeat_ratio != null
                            ? `${Math.round((r.repeat_ratio as number) * 100)}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {/* Последние заказы */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Заказы ({ctx.recent_orders.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead className="text-left text-slate-400">
                      <tr>
                        <th className="pb-1">Время</th>
                        <th className="pb-1">Тип</th>
                        <th className="pb-1 text-right">GMV</th>
                        <th className="pb-1 text-right">км</th>
                        <th className="pb-1 text-right">Подача</th>
                        <th className="pb-1 text-right">Поездка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ctx.recent_orders.map((o) => (
                        <tr key={o.order_id} className="border-t border-slate-100">
                          <td className="py-1">
                            {new Date(o.order_date).toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}
                          </td>
                          <td className="py-1">{paymentTypeRu(o.payment_type)}</td>
                          <td className="py-1 text-right tabular-nums">{fmtMoney(o.gmv)}</td>
                          <td className="py-1 text-right tabular-nums">{o.km?.toFixed(1) ?? "—"}</td>
                          <td className="py-1 text-right tabular-nums">{o.arrival_minutes?.toFixed(0) ?? "—"} м</td>
                          <td className="py-1 text-right tabular-nums">{o.trip_minutes?.toFixed(0) ?? "—"} м</td>
                        </tr>
                      ))}
                      {ctx.recent_orders.length === 0 && (
                        <tr><td colSpan={6} className="text-slate-400 py-2">нет заказов</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Последние тикеты */}
              {ctx.recent_tickets.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    Тикеты (последние {ctx.recent_tickets.length})
                  </h3>
                  <div className="space-y-1">
                    {ctx.recent_tickets.map((t) => (
                      <div key={t.ticket_id} className="flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1">
                        <Link href={`/newstat/tickets/${t.ticket_id}`} className="text-indigo-600 hover:underline">
                          #{t.ticket_id} · {fmtDate(t.date)}
                        </Link>
                        <span className={t.status === "confirmed_fraud" ? "text-rose-600" : "text-slate-500"}>
                          {t.status}
                        </span>
                        <span className="text-slate-400">{fmtMoney(t.money_at_risk_byn)} BYN</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Hidden links */}
              {ctx.hidden_links && (ctx.hidden_links.shared_device_count > 0 || ctx.hidden_links.linked_via_ip.length > 0) && (
                <section>
                  <h3 className="text-xs font-semibold text-rose-600 uppercase tracking-wide mb-2">
                    ⚠️ Скрытые связи
                  </h3>
                  {ctx.hidden_links.device_clusters.length > 0 && (
                    <div className="mb-2">
                      <p className="text-xs font-medium text-slate-600 mb-1">Общие устройства</p>
                      {ctx.hidden_links.device_clusters.map((d) => (
                        <div key={d.fingerprint} className="text-xs bg-amber-50 border border-amber-100 rounded px-2 py-1 mb-1">
                          <span className="font-mono">{d.fingerprint.slice(0, 12)}…</span>
                          <span className="ml-2 text-slate-500">× {d.shared_count} клиентов</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {ctx.hidden_links.linked_via_ip.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-600 mb-1">Связи через IP</p>
                      {ctx.hidden_links.linked_via_ip.slice(0, 5).map((l, i) => (
                        <div key={i} className="text-xs flex items-center gap-2 mb-1">
                          <span className="text-slate-500">клиент #{l.other_client}</span>
                          <span className="text-slate-400">({l.shared_count} общих)</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

// ─────────────────────── Main component ─────────────────────────────────────

export function NewstatWorkbenchPage() {
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS });
  const [filtersChanged, setFiltersChanged] = useState(false);

  const [queue, setQueue]           = useState<WorkbenchCaseSummary[]>([]);
  const [hasMore, setHasMore]       = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueErr, setQueueErr]         = useState<string | null>(null);

  const [selectedId, setSelectedId]   = useState<number | null>(null);
  const [caseDetail, setCaseDetail]   = useState<WorkbenchCaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [kpi, setKpi]               = useState<WorkbenchKpi | null>(null);
  const [mlSettings, setMlSettings] = useState<MlWorkflowSettings | null>(null);

  const [submitting, setSubmitting]   = useState(false);
  const [decisionErr, setDecisionErr] = useState<string | null>(null);
  const [decisionOk, setDecisionOk]   = useState<string | null>(null);

  const [showPairCtx, setShowPairCtx] = useState(false);
  const [signalsOpen, setSignalsOpen] = useState(false);

  // Hotkey refs для ActionBlock
  const fpCallbackRef      = useRef<(() => void) | null>(null);
  const monitorCallbackRef = useRef<(() => void) | null>(null);

  // ── Загрузка очереди ──────────────────────────────────────────────────────

  const loadQueue = useCallback(async (append = false) => {
    setQueueLoading(true);
    setQueueErr(null);
    const r = await newstatApi.workbenchCases({
      date_from:   filters.date_from,
      date_to:     filters.date_to,
      status:      filters.status,
      priority:    filters.priority,
      entity_type: filters.entity_type || undefined,
      min_money:   filters.min_money,
      limit:       50,
      cursor:      append ? (nextCursor ?? undefined) : undefined,
    });
    setQueueLoading(false);
    if (r.ok) {
      const items = r.data.items;
      setHasMore(r.data.has_more ?? false);
      setNextCursor(r.data.next_cursor ?? null);
      if (append) {
        setQueue((prev) => [...prev, ...items]);
      } else {
        setQueue(items);
        // Авто-выбрать первый
        if (items.length > 0 && !selectedId) {
          setSelectedId(items[0].ticket_id);
        }
      }
    } else {
      setQueueErr(r.error);
    }
  }, [filters, nextCursor, selectedId]);

  // ── Загрузка KPI ──────────────────────────────────────────────────────────

  const loadKpi = useCallback(async () => {
    const r = await newstatApi.workbenchKpi(filters.date_to);
    if (r.ok) setKpi(r.data);
  }, [filters.date_to]);

  const loadMlSettings = useCallback(async () => {
    const r = await newstatApi.mlLabelsSummary();
    if (r.ok) setMlSettings(r.data.settings);
  }, []);

  useEffect(() => { void loadQueue(); }, [filters]);
  useEffect(() => { void loadKpi(); void loadMlSettings(); }, [filters.date_to]);

  // Детали кейса
  useEffect(() => {
    if (!selectedId) { setCaseDetail(null); return; }
    setDetailLoading(true);
    setSignalsOpen(false);
    setDecisionOk(null);
    setDecisionErr(null);
    newstatApi.workbenchCase(selectedId).then((r) => {
      setDetailLoading(false);
      if (r.ok) setCaseDetail(r.data.item);
    });
  }, [selectedId]);

  // ── Naviga helpers ────────────────────────────────────────────────────────

  const currentIdx = useMemo(
    () => queue.findIndex((c) => c.ticket_id === selectedId),
    [queue, selectedId],
  );

  function selectNext() {
    const next = queue[currentIdx + 1];
    if (next) {
      setSelectedId(next.ticket_id);
      setDecisionOk(null);
      setDecisionErr(null);
    }
  }
  function selectPrev() {
    const prev = queue[currentIdx - 1];
    if (prev) {
      setSelectedId(prev.ticket_id);
      setDecisionOk(null);
      setDecisionErr(null);
    }
  }

  // ── Hotkeys ───────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Не перехватывать если фокус в input/textarea
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.key === "ArrowRight" || (e.key === "n" && !e.ctrlKey && !e.metaKey)) selectNext();
      else if (e.key === "ArrowLeft") selectPrev();
      else if (e.key === "f" || e.key === "F") fpCallbackRef.current?.();
      else if (e.key === "m" || e.key === "M") monitorCallbackRef.current?.();
      else if (e.key === "d" || e.key === "D") {
        if (caseDetail?.entity_type === "pair" && caseDetail.driver_id && caseDetail.client_id) {
          setShowPairCtx((v) => !v);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queue, currentIdx, caseDetail]);

  // ── Decision ──────────────────────────────────────────────────────────────

  async function applyDecision(body: WorkbenchDecisionBody) {
    if (!selectedId) return;
    setSubmitting(true);
    setDecisionErr(null);
    setDecisionOk(null);
    const r = await newstatApi.workbenchDecision(selectedId, body);
    setSubmitting(false);
    if (!r.ok) { setDecisionErr(r.error); return; }
    const msg = body.action === "confirm_fraud"   ? "Фрод подтверждён, метка=1"
      : body.action === "false_positive" ? "Закрыто как FP, метка=0"
      : "Поставлен на контроль";
    setDecisionOk(msg);
    await Promise.all([loadQueue(), loadKpi()]);
    const r2 = await newstatApi.workbenchCase(selectedId);
    if (r2.ok) setCaseDetail(r2.data.item);
  }

  // ── Reset filters ─────────────────────────────────────────────────────────

  function resetFilters() {
    setFilters({ ...DEFAULT_FILTERS });
    setFiltersChanged(false);
    setSelectedId(null);
  }
  function updateFilter<K extends keyof Filters>(key: K, val: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: val }));
    setFiltersChanged(true);
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <NewstatLayout title="Рабочее место">
      {showPairCtx && (
        <PairContextDrawer
          caseItem={caseDetail}
          onClose={() => setShowPairCtx(false)}
        />
      )}

      {/* ── KPI row ─────────────────────────────────────── */}
      {kpi && (
        <div className="flex flex-wrap gap-2 mb-3">
          <KpiCard label="Открытых кейсов"  value={kpi.open_cases ?? kpi.new_tickets} accent />
          <KpiCard label="Высокий приоритет" value={kpi.high_priority} />
          <KpiCard label="Решено сегодня"    value={kpi.decisions_today ?? 0} />
          <KpiCard label="Деньги под риском" value={`${fmtMoney(kpi.money_at_risk_byn)} BYN`} />
          <KpiCard label="Сэкономлено"        value={`${fmtMoney(kpi.money_saved_byn)} BYN`} />
          <KpiCard label="Размечено сегодня"  value={kpi.labels_today} />
        </div>
      )}

      {/* ── Filters bar ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-3 p-2.5 bg-slate-50 rounded-lg border border-slate-200">
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span>От</span>
          <input
            type="date"
            value={filters.date_from}
            onChange={(e) => updateFilter("date_from", e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
          <span>До</span>
          <input
            type="date"
            value={filters.date_to}
            onChange={(e) => updateFilter("date_to", e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>

        <select
          value={filters.status}
          onChange={(e) => updateFilter("status", e.target.value)}
          className="border rounded px-2 py-1.5 text-sm"
        >
          <option value="new,in_review">Активные</option>
          <option value="new">Только новые</option>
          <option value="in_review">В review</option>
          <option value="confirmed_fraud,false_positive">Решённые</option>
        </select>

        <select
          value={filters.priority}
          onChange={(e) => updateFilter("priority", e.target.value)}
          className="border rounded px-2 py-1.5 text-sm"
        >
          <option value="high">Только High</option>
          <option value="high,medium">High + Medium</option>
          <option value="high,medium,low">Все</option>
        </select>

        <select
          value={filters.entity_type}
          onChange={(e) => updateFilter("entity_type", e.target.value)}
          className="border rounded px-2 py-1.5 text-sm"
        >
          <option value="">Все типы</option>
          <option value="pair">Связки</option>
          <option value="driver">Водители</option>
          <option value="client">Клиенты</option>
        </select>

        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-slate-500 text-xs">≥ BYN</span>
          <input
            type="number"
            value={filters.min_money}
            onChange={(e) => updateFilter("min_money", Number(e.target.value))}
            min={0}
            step={5}
            className="border rounded px-2 py-1 w-16 text-sm"
          />
        </div>

        {filtersChanged && (
          <button
            type="button"
            onClick={resetFilters}
            className="px-2.5 py-1.5 text-xs border border-slate-300 text-slate-600 rounded hover:bg-white"
          >
            ↺ Сбросить
          </button>
        )}

        <button
          type="button"
          onClick={() => void loadQueue()}
          disabled={queueLoading}
          className="px-3 py-1.5 bg-slate-900 text-white rounded text-sm hover:bg-slate-700 disabled:opacity-50 ml-auto"
        >
          {queueLoading ? "…" : "Обновить"}
        </button>

        {mlSettings?.ml_mode && (
          <span className={`px-2 py-1 rounded border text-xs font-medium ${mlModeBadge(mlSettings.ml_mode)}`}>
            ML: {mlSettings.ml_mode}
          </span>
        )}

        {/* Hotkey hint */}
        <div className="hidden lg:flex items-center gap-1 text-xs text-slate-400 ml-1">
          <kbd className="border border-slate-200 rounded px-1">F</kbd> FP
          <kbd className="border border-slate-200 rounded px-1">M</kbd> Monitor
          <kbd className="border border-slate-200 rounded px-1">→</kbd> Next
          <kbd className="border border-slate-200 rounded px-1">D</kbd> Контекст
        </div>
      </div>

      {queueErr && (
        <div className="p-3 border border-rose-200 bg-rose-50 text-rose-800 text-sm rounded mb-3">
          {queueErr}
        </div>
      )}

      {/* ── 2-column layout ─────────────────────────────── */}
      <div className="flex gap-4 h-[calc(100vh-320px)] min-h-[480px]">

        {/* LEFT: Queue */}
        <aside className="w-72 shrink-0 bg-white border border-slate-200 rounded-lg overflow-y-auto flex flex-col">
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Очередь ({queue.length}{hasMore ? "+" : ""})
            </span>
            {queueLoading && <span className="text-xs text-slate-400">загрузка…</span>}
          </div>
          {queue.length === 0 && !queueLoading && (
            <div className="px-4 py-8 text-center text-slate-400 text-sm">
              <p>Нет кейсов</p>
              <button type="button" onClick={resetFilters} className="mt-2 text-xs text-indigo-600 hover:underline">
                Сбросить фильтры
              </button>
            </div>
          )}
          {queue.map((c) => (
            <QueueItem
              key={c.ticket_id}
              c={c}
              active={c.ticket_id === selectedId}
              onClick={() => {
                setSelectedId(c.ticket_id);
                setDecisionOk(null);
                setDecisionErr(null);
              }}
            />
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={() => void loadQueue(true)}
              disabled={queueLoading}
              className="m-2 py-1.5 text-xs text-indigo-600 border border-indigo-100 rounded hover:bg-indigo-50 disabled:opacity-50"
            >
              Загрузить ещё…
            </button>
          )}
        </aside>

        {/* RIGHT: Case card */}
        <main className="flex-1 overflow-y-auto">
          {!selectedId && (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm gap-2">
              <p>Выберите кейс из очереди</p>
              <p className="text-xs">Или используйте → для навигации</p>
            </div>
          )}

          {detailLoading && (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              Загрузка…
            </div>
          )}

          {caseDetail && !detailLoading && (
            <div className="space-y-4">
              {/* Header */}
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="flex flex-wrap items-start gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs border ${priorityColor(caseDetail.priority)}`}>
                        {caseDetail.priority}
                      </span>
                      <span className="text-xs text-slate-500">{caseDetail.entity_type} · {caseDetail.risk_type}</span>
                      <span className="text-xs text-slate-400">#{caseDetail.ticket_id}</span>
                      <span className="text-xs text-slate-400">{caseDetail.date}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      {caseDetail.driver_id && (
                        <div>
                          <span className="text-slate-500">Водитель: </span>
                          <span className="font-semibold text-slate-800">
                            {caseDetail.driver_name || caseDetail.driver_id}
                          </span>
                        </div>
                      )}
                      {caseDetail.client_id && (
                        <div>
                          <span className="text-slate-500">Клиент: </span>
                          <span className="font-semibold text-slate-800">#{caseDetail.client_id}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-2xl font-bold text-rose-700 tabular-nums">
                      {fmtMoney(caseDetail.money_at_risk_byn)} <span className="text-sm font-normal text-slate-500">BYN</span>
                    </p>
                    <div className="flex gap-3 text-xs text-slate-500 mt-1 justify-end">
                      {caseDetail.rule_score != null && <span>Rule: {caseDetail.rule_score.toFixed(0)}</span>}
                      {caseDetail.ml_score != null && <span>ML: {caseDetail.ml_score}</span>}
                      {caseDetail.delta != null && (
                        <span className={Math.abs(caseDetail.delta) > 25 ? "text-rose-500 font-medium" : ""}>
                          Δ{caseDetail.delta > 0 ? "+" : ""}{caseDetail.delta}
                        </span>
                      )}
                    </div>
                    {caseDetail.entity_type === "pair" && caseDetail.driver_id && caseDetail.client_id && (
                      <button
                        type="button"
                        onClick={() => setShowPairCtx((v) => !v)}
                        className="mt-1.5 text-xs text-indigo-600 hover:underline"
                      >
                        🔍 Контекст пары (D) →
                      </button>
                    )}
                  </div>
                </div>

                {/* Navigation strip */}
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={selectPrev}
                    disabled={currentIdx <= 0}
                    className="px-2.5 py-1 border border-slate-200 rounded text-sm hover:bg-slate-50 disabled:opacity-30"
                    title="ArrowLeft"
                  >
                    ← Пред.
                  </button>
                  <span className="text-xs text-slate-400 flex-1 text-center">
                    {currentIdx + 1} / {queue.length}{hasMore ? "+" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={selectNext}
                    disabled={currentIdx >= queue.length - 1 && !hasMore}
                    className="px-2.5 py-1 border border-slate-200 rounded text-sm hover:bg-slate-50 disabled:opacity-30"
                    title="ArrowRight / N"
                  >
                    Следующий →
                  </button>
                  <Link
                    href={`/newstat/tickets/${caseDetail.ticket_id}`}
                    className="px-2.5 py-1 border border-indigo-200 text-indigo-700 rounded text-sm hover:bg-indigo-50"
                  >
                    Полный ↗
                  </Link>
                </div>
              </div>

              {/* Человеко-читаемое объяснение почему этот тикет в очереди */}
              <WhyHereBlock caseItem={caseDetail} />

              {/* WHY + MONEY + ACTION */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Почему риск (технически)</h3>
                  <WhyBlock reasons={caseDetail.why} />
                </div>

                <div className="bg-white border border-slate-200 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Деньги</h3>
                  <MoneyBlock money={caseDetail.money} />
                </div>

                <div className="bg-white border border-slate-200 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                    Решение
                    <span className="ml-2 font-normal text-slate-400 normal-case text-xs">F / M / Confirm</span>
                  </h3>
                  <ActionBlock
                    caseItem={caseDetail}
                    onDecision={applyDecision}
                    submitting={submitting}
                    fpRef={fpCallbackRef}
                    monitorRef={monitorCallbackRef}
                  />
                  {decisionErr && <p className="mt-2 text-xs text-rose-600">{decisionErr}</p>}
                  {decisionOk  && <p className="mt-2 text-xs text-emerald-600">✓ {decisionOk}</p>}
                </div>
              </div>

              {/* Collapse: сигналы + заказы */}
              <div className="bg-white border border-slate-200 rounded-lg">
                <button
                  type="button"
                  onClick={() => setSignalsOpen((v) => !v)}
                  className="w-full flex justify-between items-center px-4 py-3 text-sm hover:bg-slate-50 rounded-lg"
                >
                  <span className="font-medium text-slate-600">Сигналы риска</span>
                  <span className="text-xs text-slate-400">{signalsOpen ? "▲" : "▼"}</span>
                </button>
                {signalsOpen && (
                  <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                    <SignalsView signals={caseDetail.signals} />
                  </div>
                )}
              </div>

              {caseDetail.entity_type === "pair" && caseDetail.driver_id && caseDetail.client_id && (
                <SuspiciousOrdersBlock
                  caseItem={caseDetail}
                  onDecisionApplied={() => {
                    void Promise.all([loadQueue(), loadKpi()]);
                    newstatApi.workbenchCase(caseDetail.ticket_id).then((r) => {
                      if (r.ok) setCaseDetail(r.data.item);
                    });
                  }}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </NewstatLayout>
  );
}
