import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { NewstatLayout } from "../components/NewstatLayout";
import {
  newstatApi,
  type DailyClientRiskRow,
  type DailyDriverRiskRow,
  type DailyPairRiskRow,
  type DailySummary,
  type HealthResponse,
} from "../lib/api";
import { useNewstatDate } from "../lib/use-newstat-date";

function fmt(byn: number | string): string {
  return Number(byn).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function riskTone(score: number): string {
  if (score >= 70) return "bg-rose-100 text-rose-800 border-rose-200";
  if (score >= 30) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function RiskBadge({ score }: { score: number }) {
  return (
    <span
      className={
        "inline-block px-1.5 py-0.5 rounded text-xs border tabular-nums " +
        riskTone(score)
      }
    >
      {score.toFixed(0)}
    </span>
  );
}

interface MoneyCardProps {
  label: string;
  byn: number;
  hint: string;
  tone: "neutral" | "warn" | "danger" | "total";
  href?: string;
  countLabel?: string;
}

const TONE: Record<MoneyCardProps["tone"], string> = {
  neutral: "border-slate-200 bg-white",
  warn: "border-amber-300 bg-white",
  danger: "border-rose-400 bg-white",
  total: "border-slate-700 bg-slate-50",
};

function MoneyCard({ label, byn, hint, tone, href, countLabel }: MoneyCardProps) {
  const inner = (
    <div
      className={`rounded-lg border-2 ${TONE[tone]} p-4 shadow-sm h-full ${
        href ? "hover:shadow-md transition-shadow cursor-pointer" : ""
      }`}
    >
      <div className="text-xs text-slate-500 uppercase tracking-wide flex items-center justify-between gap-2">
        <span>{label}</span>
        {href && <span className="text-[11px] text-slate-400">подробнее →</span>}
      </div>
      <div
        className={`mt-1 tabular-nums font-semibold ${
          tone === "total" ? "text-4xl" : "text-3xl"
        }`}
      >
        {fmt(byn)} <span className="text-base font-normal text-slate-500">BYN</span>
      </div>
      {countLabel && (
        <div className="text-xs text-slate-500 mt-1">{countLabel}</div>
      )}
      <div className="text-xs text-slate-600 mt-2 leading-snug">{hint}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function NewstatHomePage() {
  const [date, setDate] = useNewstatDate();
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [drivers, setDrivers] = useState<DailyDriverRiskRow[]>([]);
  const [clients, setClients] = useState<DailyClientRiskRow[]>([]);
  const [pairs, setPairs] = useState<DailyPairRiskRow[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    (async () => {
      const [s, d, c, p, h] = await Promise.all([
        newstatApi.dailySummary(date),
        newstatApi.dailyDriverRisks(date, 10),
        newstatApi.dailyClientRisks(date, 10),
        newstatApi.dailyPairRisks(date, 10),
        newstatApi.health(),
      ]);
      if (!alive) return;
      if (s.ok) setSummary(s.data.summary);
      else setErr(s.error);
      if (d.ok) setDrivers(d.data.rows);
      if (c.ok) setClients(c.data.rows);
      if (p.ok) setPairs(p.data.rows);
      if (h.ok) setHealth(h.data);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [date]);

  const [yyyy, mm, dd] = date.split("-").map(Number);
  const dateRu = new Date(yyyy, (mm || 1) - 1, dd || 1).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // ── Реальные суммы из риск-моделей T006-T008 ──
  const guarantee = summary ? Number(summary.risk_money_guarantee) : 0;
  const cashbackLoss = summary ? Number(summary.cashback_loss_total) : 0;
  const collusionLoss = summary ? Number(summary.collusion_loss_total) : 0;

  // Гарантия независима от cashback/collusion (это разная категория денег:
  // фикс водителю vs кэшбэк клиенту). Cashback по клиенту и collusion по
  // паре пересекаются — одни и те же noncash-заказы режутся в двух разрезах.
  // Берём max, чтобы не двоить.
  const totalLoss = guarantee + Math.max(cashbackLoss, collusionLoss);

  const driversVisible = drivers.filter((r) => Number(r.total_risk) > 0);
  const clientsVisible = clients.filter((r) => Number(r.total_risk) > 0);
  const pairsVisible = pairs.filter((r) => Number(r.total_risk) > 0);

  return (
    <NewstatLayout title="Деньги под риском">
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

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MoneyCard
          label="Гарантия под риском"
          byn={guarantee}
          tone="warn"
          href="/newstat/risks"
          countLabel={
            summary
              ? `${summary.risky_drivers_count} подозрительных из ${summary.drivers_active}`
              : undefined
          }
          hint="Фикс выплачен водителям, чья смена выглядит «отбытой» формально (короткие+быстрые подачи, повтор клиента)."
        />
        <MoneyCard
          label="Кэшбэк под риском"
          byn={cashbackLoss}
          tone="warn"
          href="/newstat/clients-risk"
          countLabel={
            summary ? `${summary.risky_clients_count} клиентов с риском ≥30` : undefined
          }
          hint="Кэшбэк, который оседает у клиентов с признаками фрод-схемы (один водитель + короткие поездки + 100% безнал)."
        />
        <MoneyCard
          label="Сговор пар"
          byn={collusionLoss}
          tone="danger"
          href="/newstat/pairs-risk"
          countLabel={
            summary ? `${summary.risky_pairs_count} пар с риском ≥30` : undefined
          }
          hint="Деньги, которые могут оседать у конкретных пар «водитель ↔ клиент» через накрутку безналичных заказов."
        />
        <MoneyCard
          label="Итого потери"
          byn={totalLoss}
          tone="total"
          hint="Гарантия + максимум(кэшбэк, сговор). Берём максимум, потому что кэшбэк по клиентам и сговор по парам — частично одни и те же безналичные заказы."
        />
      </section>

      {summary && (
        <section className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 mb-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <div className="text-xs text-emerald-800 uppercase tracking-wide">
              Выплачено по гарантии
            </div>
            <div className="text-2xl font-semibold tabular-nums text-emerald-900">
              {fmt(summary.guarantee_payout)}{" "}
              <span className="text-sm font-normal text-emerald-700">BYN</span>
            </div>
          </div>
          <div className="text-sm text-emerald-900">
            <span className="font-medium">{summary.qualified_count}</span> отработавших
            смену · кэшбэк начислен{" "}
            <span className="font-medium">{fmt(summary.cashback_total)} BYN</span>
          </div>
          <Link
            href="/newstat/guarantee"
            className="ml-auto text-sm text-emerald-800 hover:underline"
          >
            детализация по сменам →
          </Link>
        </section>
      )}

      {err && (
        <div className="mb-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          Ошибка загрузки: {err}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <RiskTable
          title="Топ водителей по гарантии под риском"
          emptyText="моделей не сработало"
          link="/newstat/risks"
          rows={driversVisible}
          cols={[
            { h: "Водитель", get: (r) => r.driver_name || r.driver_id },
            { h: "Гарантия", align: "right", get: (r) => <RiskBadge score={Number(r.guarantee_risk)} /> },
            { h: "Earnings", align: "right", get: (r) => <RiskBadge score={Number(r.earnings_risk)} /> },
            { h: "Сговор", align: "right", get: (r) => <RiskBadge score={Number(r.collusion_risk)} /> },
            { h: "Деньги, BYN", align: "right", get: (r) => <span className="font-semibold tabular-nums">{fmt(r.money_at_risk_byn)}</span> },
          ]}
        />
        <RiskTable
          title="Топ клиентов по кэшбэку под риском"
          emptyText="моделей не сработало"
          link="/newstat/clients-risk"
          rows={clientsVisible}
          cols={[
            { h: "Клиент", get: (r) => `Client #${r.client_id}` },
            { h: "Cashback", align: "right", get: (r) => <RiskBadge score={Number(r.cashback_exposure)} /> },
            { h: "Один водитель", align: "right", get: (r) => <RiskBadge score={Number(r.repeat_driver_dependency)} /> },
            { h: "Странность", align: "right", get: (r) => <RiskBadge score={Number(r.suspicious_activity)} /> },
            { h: "Кэшбэк, BYN", align: "right", get: (r) => <span className="font-semibold tabular-nums">{fmt(r.money_at_risk_byn)}</span> },
          ]}
        />
      </div>

      <RiskTable
        title="Топ связок (водитель ↔ клиент) по сговору"
        emptyText="моделей не сработало"
        link="/newstat/pairs-risk"
        rows={pairsVisible}
        cols={[
          {
            h: "Пара",
            get: (r) => (
              <span>
                {r.driver_name || r.driver_id}
                <span className="text-slate-400"> ↔ </span>
                {`Client #${r.client_id}`}
              </span>
            ),
          },
          { h: "Заказов", align: "right", get: (r) => r.orders_count },
          { h: "Повтор", align: "right", get: (r) => <RiskBadge score={Number(r.repeat_ratio)} /> },
          { h: "Подозр.", align: "right", get: (r) => <RiskBadge score={Number(r.suspicious_ratio)} /> },
          { h: "Зависимость", align: "right", get: (r) => <RiskBadge score={Number(r.cashback_dependency)} /> },
          { h: "Сговор, BYN", align: "right", get: (r) => <span className="font-semibold tabular-nums">{fmt(r.collusion_loss_risk_byn)}</span> },
        ]}
      />

      {!loading && !err &&
        driversVisible.length === 0 &&
        clientsVisible.length === 0 &&
        pairsVisible.length === 0 && (
          <div className="mt-6 rounded bg-slate-100 border border-slate-200 p-3 text-sm text-slate-600">
            За {dateRu} модели не нашли подозрительной активности. Если данные
            ещё не загружены — это вкладка «Импорт».
          </div>
        )}

      <section className="mt-8 rounded-lg bg-slate-100 border border-slate-200 p-3 text-xs text-slate-500 flex justify-between">
        <span>
          API: {health?.ok ? "ok" : "—"} · БД: {health?.db ? "подключена" : "—"}
        </span>
        <span>
          Серверное время: {health ? new Date(health.ts).toLocaleString("ru-RU") : "—"}
        </span>
      </section>
    </NewstatLayout>
  );
}

interface Col<R> {
  h: string;
  get: (r: R) => ReactNode;
  align?: "left" | "right";
}
function RiskTable<R>({
  title,
  rows,
  cols,
  emptyText,
  link,
}: {
  title: string;
  rows: R[];
  cols: Col<R>[];
  emptyText: string;
  link: string;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-lg p-3">
      <div className="font-medium mb-2 text-sm flex items-center justify-between">
        <span>{title}</span>
        <Link href={link} className="text-xs text-slate-500 hover:underline">
          вся таблица →
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600 text-xs">
            <tr>
              {cols.map((c) => (
                <th
                  key={c.h}
                  className={
                    "p-2 font-medium " +
                    (c.align === "right" ? "text-right" : "text-left")
                  }
                >
                  {c.h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={cols.length}
                  className="p-3 text-slate-400 italic text-center"
                >
                  {emptyText}
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                {cols.map((c) => (
                  <td
                    key={c.h}
                    className={
                      "p-2 " + (c.align === "right" ? "text-right tabular-nums" : "")
                    }
                  >
                    {c.get(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
