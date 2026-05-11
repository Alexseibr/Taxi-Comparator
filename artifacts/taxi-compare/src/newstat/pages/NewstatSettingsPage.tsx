import { useEffect, useState } from "react";
import { NewstatLayout } from "../components/NewstatLayout";
import {
  newstatApi,
  type CashbackValue,
  type MlMode,
  type MlWorkflowSettings,
  type RiskThresholdsValue,
  type Shift,
  type ShiftInput,
} from "../lib/api";
import { useNewstatUser } from "../lib/auth-store";

const WD_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

// T016.7 / T017: дефолты должны совпадать с .local/newstat-server/lib/settings.mjs ML_WORKFLOW_DEFAULTS.
const ML_WORKFLOW_DEFAULTS: MlWorkflowSettings = {
  ml_mode: "BALANCED",
  disagreement_delta_threshold: 30,
  ml_discovery_min_score: 80,
  ml_discovery_max_rule_score: 50,
  ticket_min_money_at_risk_byn: 5,
  ticket_max_per_day: 50,
  ticket_max_per_rescore: 100,
  enable_strong_disagreement_tickets: false,
  enable_rule_overkill_tickets: false,
};

const ML_MODES: Array<{ value: MlMode; label: string; description: string; color: string }> = [
  { value: "SAFE",       label: "SAFE",       description: "Только ML_DISCOVERY. Минимум шума, 20 тикетов/день.", color: "emerald" },
  { value: "BALANCED",   label: "BALANCED",   description: "ML_DISCOVERY + STRONG top-50/день. Рекомендован.",   color: "indigo"  },
  { value: "AGGRESSIVE", label: "AGGRESSIVE", description: "ML + STRONG + RULE_OVERKILL. Высокий охват.",       color: "amber"   },
  { value: "TRAINING",   label: "TRAINING",   description: "Тикеты не создаются. Только labeling queue.",       color: "rose"    },
];

export function NewstatSettingsPage() {
  const { user } = useNewstatUser();
  const isAdmin = user?.role === "admin";

  const [cashback, setCashback] = useState<number>(0);
  const [risk, setRisk] = useState<RiskThresholdsValue>({
    short_trip_km: 2,
    fast_arrival_min: 3,
    min_attendance_pct: 80,
    high_repeat_ratio: 0.6,
  });
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [mlw, setMlw] = useState<MlWorkflowSettings>(ML_WORKFLOW_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function loadAll() {
    setLoading(true);
    const [s, sh] = await Promise.all([newstatApi.settingsAll(), newstatApi.shiftsList()]);
    if (s.ok) {
      for (const it of s.data.settings) {
        if (it.key === "cashback") {
          setCashback(Number((it.value as CashbackValue).percent_of_noncash) || 0);
        }
        if (it.key === "risk_thresholds") {
          setRisk({ ...risk, ...(it.value as RiskThresholdsValue) });
        }
        if (it.key === "ml_workflow") {
          setMlw({ ...ML_WORKFLOW_DEFAULTS, ...(it.value as Partial<MlWorkflowSettings>) });
        }
      }
    }
    if (sh.ok) setShifts(sh.data.shifts);
    setLoading(false);
  }

  async function saveMlWorkflow() {
    setSavingKey("ml_workflow");
    const r = await newstatApi.saveMlWorkflow({
      ml_mode: mlw.ml_mode,
      disagreement_delta_threshold: Number(mlw.disagreement_delta_threshold),
      ml_discovery_min_score: Number(mlw.ml_discovery_min_score),
      ml_discovery_max_rule_score: Number(mlw.ml_discovery_max_rule_score),
      ticket_min_money_at_risk_byn: Number(mlw.ticket_min_money_at_risk_byn),
      ticket_max_per_day: Number(mlw.ticket_max_per_day),
      ticket_max_per_rescore: Number(mlw.ticket_max_per_rescore),
      enable_strong_disagreement_tickets: !!mlw.enable_strong_disagreement_tickets,
      enable_rule_overkill_tickets: !!mlw.enable_rule_overkill_tickets,
    });
    setSavingKey(null);
    setMsg(r.ok ? { kind: "ok", text: "ML workflow сохранён" } : { kind: "err", text: r.error });
  }
  useEffect(() => {
    void loadAll();
  }, []);

  async function saveCashback() {
    setSavingKey("cashback");
    const r = await newstatApi.saveCashback(Number(cashback));
    setSavingKey(null);
    setMsg(r.ok ? { kind: "ok", text: "Кэшбэк сохранён" } : { kind: "err", text: r.error });
  }
  async function saveRisk() {
    setSavingKey("risk");
    const r = await newstatApi.saveRiskThresholds({
      short_trip_km: Number(risk.short_trip_km),
      fast_arrival_min: Number(risk.fast_arrival_min),
      min_attendance_pct: Number(risk.min_attendance_pct),
      high_repeat_ratio: Number(risk.high_repeat_ratio),
    });
    setSavingKey(null);
    setMsg(r.ok ? { kind: "ok", text: "Пороги сохранены" } : { kind: "err", text: r.error });
  }

  return (
    <NewstatLayout title="Настройки">
      {msg && (
        <div
          className={
            "mb-4 text-sm rounded border p-2 " +
            (msg.kind === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800")
          }
        >
          {msg.text}
        </div>
      )}
      {!isAdmin && (
        <div className="mb-4 text-sm rounded border border-amber-200 bg-amber-50 text-amber-800 p-2">
          Изменения доступны только пользователям с ролью <b>admin</b>. Сейчас вы видите
          текущие значения только для просмотра.
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* ── Кэшбэк ── */}
        <section className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="font-semibold mb-2">Кэшбэк клиентам</h2>
          <p className="text-xs text-slate-500 mb-3">
            Процент от безналичных поездок, который клиент получает обратно. Этот же
            процент используется при расчёте «кэшбэк под риском».
          </p>
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
            Процент от безнала
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              disabled={!isAdmin || loading}
              value={cashback}
              onChange={(e) => setCashback(Number(e.target.value))}
              className="w-32 border rounded px-3 py-2 text-sm"
            />
            <span className="text-sm text-slate-500">%</span>
            {isAdmin && (
              <button
                onClick={() => void saveCashback()}
                disabled={savingKey === "cashback"}
                className="ml-auto bg-slate-900 text-white text-sm rounded px-3 py-1.5 hover:bg-slate-800 disabled:opacity-50"
              >
                {savingKey === "cashback" ? "Сохраняем…" : "Сохранить"}
              </button>
            )}
          </div>
        </section>

        {/* ── Пороги аномалий ── */}
        <section className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="font-semibold mb-2">Пороги аномалий</h2>
          <p className="text-xs text-slate-500 mb-3">
            Используются ETL и риск-моделями: что считать «короткой поездкой», «быстрой
            подачей», «слишком высокой долей повторов» и т.д.
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <NumField label="Короткая поездка, км ≤" value={risk.short_trip_km} disabled={!isAdmin || loading}
              onChange={(v) => setRisk({ ...risk, short_trip_km: v })} step={0.5} />
            <NumField label="Быстрая подача, мин ≤" value={risk.fast_arrival_min} disabled={!isAdmin || loading}
              onChange={(v) => setRisk({ ...risk, fast_arrival_min: v })} step={1} />
            <NumField label="Мин. отработка смены, %" value={risk.min_attendance_pct} disabled={!isAdmin || loading}
              onChange={(v) => setRisk({ ...risk, min_attendance_pct: v })} step={5} />
            <NumField label="Высокая доля повторов" value={risk.high_repeat_ratio} disabled={!isAdmin || loading}
              onChange={(v) => setRisk({ ...risk, high_repeat_ratio: v })} step={0.05} />
          </div>
          {isAdmin && (
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => void saveRisk()}
                disabled={savingKey === "risk"}
                className="bg-slate-900 text-white text-sm rounded px-3 py-1.5 hover:bg-slate-800 disabled:opacity-50"
              >
                {savingKey === "risk" ? "Сохраняем…" : "Сохранить пороги"}
              </button>
            </div>
          )}
        </section>
      </div>

      {/* ── ML workflow (T016/T017) ── */}
      <section className="mt-6 bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="font-semibold mb-2">ML workflow — создание тикетов из расхождений</h2>
        <p className="text-xs text-slate-500 mb-3 max-w-3xl">
          Режим управляет тем, какие пары автоматически превращаются в тикеты при rescore.
          Режим имеет приоритет над ручными флагами ниже.
        </p>

        {/* T017: Mode selector */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          {ML_MODES.map((m) => {
            const active = (mlw.ml_mode ?? "BALANCED") === m.value;
            const ringMap: Record<string, string> = {
              emerald: "ring-emerald-400 bg-emerald-50 border-emerald-300",
              indigo:  "ring-indigo-400  bg-indigo-50  border-indigo-300",
              amber:   "ring-amber-400   bg-amber-50   border-amber-300",
              rose:    "ring-rose-400    bg-rose-50    border-rose-300",
            };
            const labelMap: Record<string, string> = {
              emerald: "text-emerald-800",
              indigo:  "text-indigo-800",
              amber:   "text-amber-800",
              rose:    "text-rose-800",
            };
            return (
              <button
                key={m.value}
                disabled={!isAdmin || loading}
                onClick={() => setMlw({ ...mlw, ml_mode: m.value })}
                data-testid={`mlw-mode-${m.value.toLowerCase()}`}
                className={[
                  "text-left border rounded-lg p-3 transition-all text-sm",
                  active
                    ? `ring-2 ${ringMap[m.color]} font-semibold`
                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
                  !isAdmin || loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                ].join(" ")}
              >
                <div className={`font-mono text-xs font-bold mb-1 ${active ? labelMap[m.color] : "text-slate-600"}`}>
                  {m.label}
                </div>
                <div className="text-xs text-slate-500 leading-snug">{m.description}</div>
              </button>
            );
          })}
        </div>

        <details className="mb-3">
          <summary className="text-xs text-slate-500 cursor-pointer select-none hover:text-slate-700">
            Расширенные настройки (пороги и лимиты)
          </summary>
          <div className="mt-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <NumField label="ML_DISCOVERY: мин. ml_score" value={mlw.ml_discovery_min_score} disabled={!isAdmin || loading}
            onChange={(v) => setMlw({ ...mlw, ml_discovery_min_score: v })} step={5} />
          <NumField label="ML_DISCOVERY: макс. rule_score" value={mlw.ml_discovery_max_rule_score} disabled={!isAdmin || loading}
            onChange={(v) => setMlw({ ...mlw, ml_discovery_max_rule_score: v })} step={5} />
          <NumField label="STRONG: мин. |Δ| между ml и rule" value={mlw.disagreement_delta_threshold} disabled={!isAdmin || loading}
            onChange={(v) => setMlw({ ...mlw, disagreement_delta_threshold: v })} step={5} />
          <NumField label="Мин. money_at_risk (BYN)" value={mlw.ticket_min_money_at_risk_byn} disabled={!isAdmin || loading}
            onChange={(v) => setMlw({ ...mlw, ticket_min_money_at_risk_byn: v })} step={1} />
          <NumField label="Лимит тикетов на дату" value={mlw.ticket_max_per_day} disabled={!isAdmin || loading}
            onChange={(v) => setMlw({ ...mlw, ticket_max_per_day: v })} step={5} />
          <NumField label="Лимит тикетов на rescore" value={mlw.ticket_max_per_rescore} disabled={!isAdmin || loading}
            onChange={(v) => setMlw({ ...mlw, ticket_max_per_rescore: v })} step={10} />
        </div>
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" disabled={!isAdmin || loading}
              checked={mlw.enable_strong_disagreement_tickets}
              onChange={(e) => setMlw({ ...mlw, enable_strong_disagreement_tickets: e.target.checked })}
              data-testid="mlw-enable-strong"
            />
            <span>Создавать тикеты для STRONG_DISAGREEMENT (только TOP-N по money / Δ)</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" disabled={!isAdmin || loading}
              checked={mlw.enable_rule_overkill_tickets}
              onChange={(e) => setMlw({ ...mlw, enable_rule_overkill_tickets: e.target.checked })}
              data-testid="mlw-enable-overkill"
            />
            <span>Создавать тикеты для RULE_OVERKILL (правила перегнули)</span>
          </label>
        </div>
          </div>
        </details>
        {isAdmin && (
          <div className="mt-3 flex justify-end">
            <button
              onClick={() => void saveMlWorkflow()}
              disabled={savingKey === "ml_workflow"}
              className="bg-slate-900 text-white text-sm rounded px-3 py-1.5 hover:bg-slate-800 disabled:opacity-50"
              data-testid="mlw-save"
            >
              {savingKey === "ml_workflow" ? "Сохраняем…" : "Сохранить ML workflow"}
            </button>
          </div>
        )}
      </section>

      {/* ── Смены с гарантией ── */}
      <section className="mt-6 bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="font-semibold mb-2">Смены с гарантией выплаты</h2>
        <p className="text-xs text-slate-500 mb-3">
          Каждая смена — окно часов, дни недели и фиксированная выплата. ETL считает,
          отработал ли водитель смену, по покрытию активных часов и заказов.
        </p>
        <ShiftsEditor
          isAdmin={isAdmin}
          loading={loading}
          shifts={shifts}
          onChange={(next) => setShifts(next)}
          onMessage={(m) => setMsg(m)}
        />
      </section>
    </NewstatLayout>
  );
}

function NumField({
  label,
  value,
  onChange,
  disabled,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  step?: number;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">{label}</label>
      <input
        type="number"
        step={step ?? 1}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full border rounded px-3 py-2 text-sm"
      />
    </div>
  );
}

function ShiftsEditor({
  isAdmin,
  loading,
  shifts,
  onChange,
  onMessage,
}: {
  isAdmin: boolean;
  loading: boolean;
  shifts: Shift[];
  onChange: (next: Shift[]) => void;
  onMessage: (m: { kind: "ok" | "err"; text: string }) => void;
}) {
  const [draft, setDraft] = useState<ShiftInput>({
    name: "",
    start_hour: 8,
    end_hour: 16,
    payout_byn: 80,
    weekday_mask: 127,
    active: true,
  });
  const [busy, setBusy] = useState<number | "new" | null>(null);

  async function reload() {
    const r = await newstatApi.shiftsList();
    if (r.ok) onChange(r.data.shifts);
  }
  async function saveNew() {
    if (!draft.name.trim()) {
      onMessage({ kind: "err", text: "Укажите название смены" });
      return;
    }
    setBusy("new");
    const r = await newstatApi.shiftCreate(draft);
    setBusy(null);
    if (!r.ok) {
      onMessage({ kind: "err", text: r.error });
      return;
    }
    onMessage({ kind: "ok", text: `Создана смена «${r.data.shift.name}»` });
    setDraft({ ...draft, name: "" });
    await reload();
  }
  async function update(id: number, patch: ShiftInput) {
    setBusy(id);
    const r = await newstatApi.shiftUpdate(id, patch);
    setBusy(null);
    if (!r.ok) onMessage({ kind: "err", text: r.error });
    else {
      onMessage({ kind: "ok", text: "Смена обновлена" });
      await reload();
    }
  }
  async function remove(id: number) {
    if (!confirm("Удалить смену? Это не повлияет на уже посчитанные дни.")) return;
    setBusy(id);
    const r = await newstatApi.shiftDelete(id);
    setBusy(null);
    if (!r.ok) onMessage({ kind: "err", text: r.error });
    else {
      onMessage({ kind: "ok", text: "Смена удалена" });
      await reload();
    }
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="text-left p-2 font-medium">Название</th>
              <th className="text-left p-2 font-medium">Часы</th>
              <th className="text-left p-2 font-medium">Дни недели</th>
              <th className="text-right p-2 font-medium">Выплата (BYN)</th>
              <th className="text-center p-2 font-medium">Активна</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="p-4 text-slate-500 italic">
                  Загрузка…
                </td>
              </tr>
            )}
            {!loading && shifts.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-slate-500 italic">
                  Смен пока нет — добавьте первую ниже.
                </td>
              </tr>
            )}
            {shifts.map((s) => (
              <ShiftRow
                key={s.id}
                isAdmin={isAdmin}
                shift={s}
                busy={busy === s.id}
                onSave={(patch) => void update(s.id, patch)}
                onDelete={() => void remove(s.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="mt-4 border-t pt-4">
          <div className="text-sm font-medium mb-2">Добавить смену</div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 text-sm items-end">
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">Название</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full border rounded px-2 py-1.5"
                placeholder="напр. Утро 08-16"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">С</label>
              <input type="number" min={0} max={23}
                value={draft.start_hour}
                onChange={(e) => setDraft({ ...draft, start_hour: Number(e.target.value) })}
                className="w-full border rounded px-2 py-1.5" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">До</label>
              <input type="number" min={1} max={24}
                value={draft.end_hour}
                onChange={(e) => setDraft({ ...draft, end_hour: Number(e.target.value) })}
                className="w-full border rounded px-2 py-1.5" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Выплата</label>
              <input type="number" min={0} step={1}
                value={draft.payout_byn}
                onChange={(e) => setDraft({ ...draft, payout_byn: Number(e.target.value) })}
                className="w-full border rounded px-2 py-1.5" />
            </div>
            <button
              onClick={() => void saveNew()}
              disabled={busy === "new"}
              className="bg-slate-900 text-white rounded px-3 py-1.5 hover:bg-slate-800 disabled:opacity-50"
            >
              {busy === "new" ? "…" : "Добавить"}
            </button>
          </div>
          <div className="mt-2">
            <WeekdayPicker
              value={draft.weekday_mask}
              onChange={(m) => setDraft({ ...draft, weekday_mask: m })}
            />
          </div>
        </div>
      )}
    </>
  );
}

function ShiftRow({
  isAdmin,
  shift,
  busy,
  onSave,
  onDelete,
}: {
  isAdmin: boolean;
  shift: Shift;
  busy: boolean;
  onSave: (s: ShiftInput) => void;
  onDelete: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<ShiftInput>({
    name: shift.name,
    start_hour: shift.start_hour,
    end_hour: shift.end_hour,
    payout_byn: Number(shift.payout_byn),
    weekday_mask: shift.weekday_mask,
    active: shift.active,
  });

  if (!edit) {
    return (
      <tr className="border-t border-slate-100">
        <td className="p-2">{shift.name}</td>
        <td className="p-2 tabular-nums">{shift.start_hour}–{shift.end_hour}</td>
        <td className="p-2 text-xs">{describeMask(shift.weekday_mask)}</td>
        <td className="p-2 text-right tabular-nums">{Number(shift.payout_byn).toFixed(2)}</td>
        <td className="p-2 text-center">{shift.active ? "✓" : "—"}</td>
        <td className="p-2 text-right space-x-2">
          {isAdmin && (
            <>
              <button onClick={() => setEdit(true)} className="text-blue-600 hover:underline text-xs">Изменить</button>
              <button onClick={onDelete} disabled={busy} className="text-rose-600 hover:underline text-xs">Удалить</button>
            </>
          )}
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-t border-slate-100 bg-slate-50">
      <td className="p-2">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full border rounded px-2 py-1" />
      </td>
      <td className="p-2 flex items-center gap-1">
        <input type="number" min={0} max={23} value={form.start_hour}
          onChange={(e) => setForm({ ...form, start_hour: Number(e.target.value) })}
          className="w-14 border rounded px-2 py-1" />
        –
        <input type="number" min={1} max={24} value={form.end_hour}
          onChange={(e) => setForm({ ...form, end_hour: Number(e.target.value) })}
          className="w-14 border rounded px-2 py-1" />
      </td>
      <td className="p-2"><WeekdayPicker value={form.weekday_mask} onChange={(m) => setForm({ ...form, weekday_mask: m })} /></td>
      <td className="p-2 text-right">
        <input type="number" value={form.payout_byn}
          onChange={(e) => setForm({ ...form, payout_byn: Number(e.target.value) })}
          className="w-24 border rounded px-2 py-1 text-right" />
      </td>
      <td className="p-2 text-center">
        <input type="checkbox" checked={form.active}
          onChange={(e) => setForm({ ...form, active: e.target.checked })} />
      </td>
      <td className="p-2 text-right space-x-2">
        <button onClick={() => { onSave(form); setEdit(false); }}
          disabled={busy} className="text-emerald-700 hover:underline text-xs">Сохранить</button>
        <button onClick={() => setEdit(false)} className="text-slate-600 hover:underline text-xs">Отмена</button>
      </td>
    </tr>
  );
}

function WeekdayPicker({ value, onChange }: { value: number; onChange: (m: number) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {WD_LABELS.map((lbl, i) => {
        const bit = 1 << i;
        const on = (value & bit) !== 0;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(value ^ bit)}
            className={
              "px-2 py-0.5 rounded text-xs border " +
              (on
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-500 border-slate-300 hover:bg-slate-100")
            }
          >
            {lbl}
          </button>
        );
      })}
    </div>
  );
}

function describeMask(mask: number): string {
  if ((mask & 127) === 127) return "Все дни";
  if ((mask & 31) === 31 && (mask & 96) === 0) return "Пн–Пт";
  return WD_LABELS.filter((_, i) => (mask & (1 << i)) !== 0).join(", ") || "—";
}
