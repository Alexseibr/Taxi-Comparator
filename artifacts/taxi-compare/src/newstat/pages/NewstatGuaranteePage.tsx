import { useEffect, useState } from "react";
import { NewstatLayout } from "../components/NewstatLayout";
import {
  newstatApi,
  type DailyAttendanceRow,
  type DailySummary,
} from "../lib/api";
import { useNewstatDate } from "../lib/use-newstat-date";

function fmtMoney(s: string | number): string {
  return Number(s).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function NewstatGuaranteePage() {
  const [date, setDate] = useNewstatDate();
  const [rows, setRows] = useState<DailyAttendanceRow[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    (async () => {
      const [a, s] = await Promise.all([
        newstatApi.dailyAttendance(date),
        newstatApi.dailySummary(date),
      ]);
      if (!alive) return;
      if (a.ok) setRows(a.data.rows);
      else setErr(a.error);
      if (s.ok) setSummary(s.data.summary);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [date]);

  // Safari/Mobile может вернуть Invalid Date для "YYYY-MM-DDT00:00:00" без TZ —
  // парсим явными аргументами в локальной TZ.
  const [yyyy, mm, dd] = date.split("-").map(Number);
  const dateRu = new Date(yyyy, (mm || 1) - 1, dd || 1).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Сортировка: сначала qualified, потом по проценту посещаемости
  const sorted = rows.slice().sort((a, b) => {
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    return Number(b.attendance_pct) - Number(a.attendance_pct);
  });

  const qualifiedRows = sorted.filter((r) => r.qualified);
  const unqualifiedRows = sorted.filter((r) => !r.qualified);

  return (
    <NewstatLayout title="Гарантия по сменам">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-slate-500">Дата:</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        />
        <span className="text-sm text-slate-500">{dateRu}</span>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <SummaryCard
          label="Выплачено по гарантии"
          value={summary ? fmtMoney(summary.guarantee_payout) : "—"}
          unit="BYN"
          hint="Сумма выплат отработавшим водителям (≥80% часов смены покрыто заказами)."
          tone="ok"
        />
        <SummaryCard
          label="Отработавших водителей"
          value={summary ? String(summary.qualified_count) : "—"}
          unit="чел."
          hint={`Из ${rows.length} проверенных строк (driver × shift).`}
          tone="neutral"
        />
        <SummaryCard
          label="Активных водителей всего"
          value={summary ? String(summary.drivers_active) : "—"}
          unit="чел."
          hint="Всех, кто завершил хотя бы одну поездку за день."
          tone="neutral"
        />
      </section>

      {err && (
        <div className="mb-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          Ошибка загрузки: {err}
        </div>
      )}

      {!loading && rows.length === 0 && !err && (
        <div className="rounded bg-slate-100 border border-slate-200 p-3 text-sm text-slate-600">
          За {dateRu} нет данных по гарантии. Проверьте, заведены ли смены и
          загружены ли заказы.
        </div>
      )}

      <AttendanceTable
        title={`Отработавшие смену (qualified) — ${qualifiedRows.length}`}
        rows={qualifiedRows}
        emptyText="нет водителей, отработавших смену по правилам"
      />
      <div className="h-4" />
      <AttendanceTable
        title={`Не отработавшие — ${unqualifiedRows.length}`}
        rows={unqualifiedRows}
        emptyText="нет неотработавших водителей"
        muted
      />

      <section className="mt-8 rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 leading-relaxed">
        <div className="font-medium mb-1">Как считается «отработал смену»</div>
        Берём смены из настроек (например «Утро 08-16, payout 80 BYN»). Для каждого
        водителя за дату строим список часов смены (с поправкой на день недели в маске),
        и считаем сколько из них покрыты хотя бы одним заказом водителя. Если покрытие
        ≥ <code>min_attendance_pct</code> (по умолчанию 80%) — водитель «отработал»,
        ему причисляется payout. Порог можно изменить в «Настройках».
      </section>
    </NewstatLayout>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  unit: string;
  hint: string;
  tone: "ok" | "warn" | "neutral";
}
function SummaryCard({ label, value, unit, hint, tone }: SummaryCardProps) {
  const border =
    tone === "ok"
      ? "border-emerald-300"
      : tone === "warn"
      ? "border-amber-300"
      : "border-slate-200";
  return (
    <div className={`rounded-lg bg-white border-2 ${border} p-4 shadow-sm`}>
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-3xl font-semibold mt-1 tabular-nums">
        {value}{" "}
        <span className="text-base font-normal text-slate-500">{unit}</span>
      </div>
      <div className="text-xs text-slate-600 mt-2">{hint}</div>
    </div>
  );
}

function AttendanceTable({
  title,
  rows,
  emptyText,
  muted,
}: {
  title: string;
  rows: DailyAttendanceRow[];
  emptyText: string;
  muted?: boolean;
}) {
  return (
    <section
      className={
        "bg-white border border-slate-200 rounded-lg p-3 " +
        (muted ? "opacity-90" : "")
      }
    >
      <div className="font-medium mb-2 text-sm">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600 text-xs">
            <tr>
              <th className="p-2 font-medium text-left">Водитель</th>
              <th className="p-2 font-medium text-left">Смена</th>
              <th className="p-2 font-medium text-right">Часов смены</th>
              <th className="p-2 font-medium text-right">Покрыто</th>
              <th className="p-2 font-medium text-right">% посещ.</th>
              <th className="p-2 font-medium text-right">Заказов в смене</th>
              <th className="p-2 font-medium text-right">Payout, BYN</th>
              <th className="p-2 font-medium text-center">Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-3 text-slate-400 italic text-center">
                  {emptyText}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={`${r.driver_id}-${r.shift_id}`}
                className="border-t border-slate-100"
              >
                <td className="p-2">{r.driver_name || r.driver_id}</td>
                <td className="p-2">
                  <span className="text-slate-700">{r.shift_name}</span>{" "}
                  <span className="text-slate-400 text-xs">
                    {String(r.start_hour).padStart(2, "0")}–
                    {String(r.end_hour).padStart(2, "0")}
                  </span>
                </td>
                <td className="p-2 text-right tabular-nums">{r.shift_hours}</td>
                <td className="p-2 text-right tabular-nums">{r.covered_hours}</td>
                <td className="p-2 text-right tabular-nums">
                  {Number(r.attendance_pct).toFixed(1)}%
                </td>
                <td className="p-2 text-right tabular-nums">
                  {r.orders_in_shift}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {fmtMoney(r.payout_byn)}
                </td>
                <td className="p-2 text-center">
                  {r.qualified ? (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-800 border border-emerald-200">
                      отработал
                    </span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600 border border-slate-200">
                      нет
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
