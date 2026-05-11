import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchWbClient,
  fetchWbDriver,
  fetchWbFraud,
  type WbEntityDetail,
  type WbFraudReason,
  type WbFraudReport,
} from "@/lib/wb-api";
import { WbShell } from "@/components/wb/WbShell";
import { WbBarChart } from "@/components/wb/WbBarChart";
import { WbOrdersTable } from "@/components/wb/WbOrdersTable";
import { WbTripMap } from "@/components/wb/WbTripMap";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function fmt(n: number, frac = 0) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
}
function pct(n: number) {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

type Kind = "client" | "driver";

const SEVERITY_BG: Record<WbFraudReason["severity"], string> = {
  low: "bg-slate-100 text-slate-700 border-slate-300",
  med: "bg-amber-100 text-amber-900 border-amber-300",
  high: "bg-orange-100 text-orange-900 border-orange-400",
  critical: "bg-red-100 text-red-900 border-red-400",
};

const SEVERITY_DOT: Record<WbFraudReason["severity"], string> = {
  low: "bg-slate-400",
  med: "bg-amber-500",
  high: "bg-orange-600",
  critical: "bg-red-600",
};

function scoreColor(score: number, severity: WbFraudReason["severity"]) {
  if (severity === "critical") return "text-red-700";
  if (severity === "high") return "text-orange-700";
  if (severity === "med") return "text-amber-700";
  if (score > 0) return "text-slate-700";
  return "text-green-700";
}

function RiskScoreCard({
  kind,
  id,
  fraud,
  fraudError,
}: {
  kind: Kind;
  id: string;
  fraud: WbFraudReport | null;
  fraudError: string | null;
}) {
  if (fraudError) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Не удалось загрузить фрод-отчёт: {fraudError}
      </Card>
    );
  }
  if (!fraud) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Загружаем фрод-сигналы…
      </Card>
    );
  }

  const item =
    kind === "client"
      ? fraud.clients.find((x) => x.clientId === id)
      : fraud.drivers.find((x) => x.driverId === id);

  if (!item) {
    return (
      <Card className="p-4 space-y-2 border-green-300 bg-green-50/40">
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-green-600" />
          <div className="font-semibold text-green-800">
            Risk score: 0 — никаких фрод-сигналов не найдено
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {kind === "client" ? "Клиент" : "Водитель"} не попал ни в один из 25
          активных правил (отмены, повторы, цены, скорость, самозаказы).
        </div>
      </Card>
    );
  }

  return (
    <Card className={`p-4 space-y-3 border ${SEVERITY_BG[item.severity]}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block w-4 h-4 rounded-full ${SEVERITY_DOT[item.severity]}`}
          />
          <div>
            <div className="text-xs uppercase opacity-70">
              Risk score · {item.severity}
            </div>
            <div
              className={`text-3xl font-bold leading-none ${scoreColor(item.score, item.severity)}`}
            >
              {item.score}
            </div>
          </div>
        </div>
        <div className="text-xs space-y-0.5 text-right">
          <div>заказов всего: <span className="font-semibold">{item.total}</span></div>
          <div>
            отмен: <span className="font-semibold">{item.cancelled}</span> ({pct(item.cancelRate)})
          </div>
          {item.topPartner && (
            <div>
              чаще всего с{" "}
              <Link
                href={
                  kind === "client"
                    ? `/wb/driver/${encodeURIComponent((item.topPartner as { driverId: string }).driverId)}`
                    : `/wb/client/${encodeURIComponent((item.topPartner as { clientId: string }).clientId)}`
                }
                className="font-mono underline"
              >
                {kind === "client"
                  ? (item.topPartner as { driverId: string }).driverId
                  : (item.topPartner as { clientId: string }).clientId}
              </Link>{" "}
              ({(item.topPartner as { count: number }).count}, {pct((item.topPartner as { share: number }).share)})
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs uppercase opacity-70">
          Сработавшие правила ({item.reasons.length}):
        </div>
        <ul className="space-y-1">
          {item.reasons.map((r) => (
            <li key={r.code} className="flex items-start gap-2 text-sm">
              <span
                className={`inline-block w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${SEVERITY_DOT[r.severity]}`}
              />
              <div>
                <div>{r.label}</div>
                <code className="text-[10px] opacity-60">{r.code}</code>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Link href="/wb/fraud" className="text-xs underline opacity-80">
        Открыть полный фрод-отчёт →
      </Link>
    </Card>
  );
}

function RoutesTable({
  routes,
}: {
  routes: WbEntityDetail["routes"];
}) {
  if (!routes.length) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Нет повторяющихся маршрутов (≥2 раз с одной точки на одну).
      </Card>
    );
  }
  const max = routes[0]?.count || 1;
  return (
    <Card className="p-4 space-y-2">
      <div className="font-medium">Повторяющиеся маршруты</div>
      <div className="text-xs text-muted-foreground">
        Сгруппировано по сетке 200 м. Подозрительно: один маршрут ездит ≥3 раз.
      </div>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="py-1.5 pr-2">#</th>
              <th className="py-1.5 pr-2 text-right">Раз</th>
              <th className="py-1.5 pr-2 text-right">Расст</th>
              <th className="py-1.5 pr-2 text-right">Ср. км</th>
              <th className="py-1.5 pr-2 text-right">Ср. BYN</th>
              <th className="py-1.5 pr-2 text-right">Σ BYN</th>
              <th className="py-1.5 pr-2">Координаты</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r, idx) => {
              const t = r.count / max;
              const dot =
                t >= 0.7
                  ? "bg-red-600"
                  : t >= 0.4
                    ? "bg-orange-500"
                    : "bg-amber-400";
              return (
                <tr
                  key={r.key}
                  className="border-b last:border-b-0 hover:bg-muted/30"
                >
                  <td className="py-1 pr-2 text-muted-foreground">{idx + 1}</td>
                  <td className="py-1 pr-2 text-right">
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${dot}`}
                      />
                      ×{r.count}
                    </span>
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {r.distM < 1000
                      ? `${r.distM} м`
                      : `${(r.distM / 1000).toFixed(1)} км`}
                  </td>
                  <td className="py-1 pr-2 text-right">{fmt(r.avgKm, 1)}</td>
                  <td className="py-1 pr-2 text-right">{fmt(r.avgGmv, 2)}</td>
                  <td className="py-1 pr-2 text-right">{fmt(r.gmvSum, 2)}</td>
                  <td className="py-1 pr-2 text-[10px] font-mono text-muted-foreground">
                    {r.pickupLat.toFixed(4)},{r.pickupLng.toFixed(4)} →{" "}
                    {r.dropoffLat.toFixed(4)},{r.dropoffLng.toFixed(4)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Inner({ kind, id }: { kind: Kind; id: string }) {
  const [data, setData] = useState<WbEntityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fraud, setFraud] = useState<WbFraudReport | null>(null);
  const [fraudError, setFraudError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    const fn = kind === "client" ? fetchWbClient : fetchWbDriver;
    fn(id)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e?.message || "load_failed"));
    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  useEffect(() => {
    let cancelled = false;
    setFraud(null);
    setFraudError(null);
    fetchWbFraud()
      .then((d) => !cancelled && setFraud(d))
      .catch((e) => !cancelled && setFraudError(e?.message || "fraud_failed"));
    return () => {
      cancelled = true;
    };
  }, []);

  // Подсветить строки партнёров, помеченных фродом.
  const flaggedPartnerIds = useMemo(() => {
    if (!fraud) return new Set<string>();
    const ids = new Set<string>();
    if (kind === "client") {
      for (const d of fraud.drivers) ids.add(d.driverId);
    } else {
      for (const c of fraud.clients) ids.add(c.clientId);
    }
    return ids;
  }, [fraud, kind]);

  if (error) {
    return (
      <div className="container mx-auto p-4 max-w-[1400px]">
        <Card className="p-6 space-y-3">
          <div className="text-red-600">
            {error === "not_found"
              ? `${kind === "client" ? "Клиент" : "Водитель"} ${id} не найден в загруженных данных.`
              : `Ошибка: ${error}`}
          </div>
          <Link
            href={kind === "client" ? "/wb/clients" : "/wb/drivers"}
            className="text-sm underline text-primary"
          >
            ← Вернуться к списку
          </Link>
        </Card>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="container mx-auto p-4 max-w-[1400px]">
        <Card className="p-4 text-sm text-muted-foreground">Загрузка…</Card>
      </div>
    );
  }

  const s = data.summary;
  const isClient = kind === "client";
  const partnerLabel = isClient ? "Driver" : "Client";

  return (
    <div className="container mx-auto p-4 space-y-4 max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-muted-foreground uppercase">
            {isClient ? "Клиент" : "Водитель"} ВБ Такси
          </div>
          <h1 className="text-2xl font-bold font-mono">{data.id}</h1>
          {data.identity && (data.identity.name || data.identity.phone) && (
            <div className="mt-1 text-base font-semibold">
              {data.identity.name || ""}
              {data.identity.phone && (
                <span className="ml-2 text-sm font-normal font-mono text-muted-foreground">
                  +{data.identity.phone}
                </span>
              )}
              {!isClient &&
                "autoNumber" in (data.identity as any) &&
                (data.identity as any).autoNumber && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-slate-200 text-slate-800 text-xs font-mono">
                    {(data.identity as any).autoNumber}
                  </span>
                )}
            </div>
          )}
          <p className="text-sm text-muted-foreground mt-1">
            {s.firstDate || "—"} → {s.lastDate || "—"} · период активности
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/wb/graph?focus=${kind}:${id}&depth=1`}>
            <Button variant="outline" size="sm" data-testid="link-graph-focus">
              Связи →
            </Button>
          </Link>
          <Link href={isClient ? "/wb/clients" : "/wb/drivers"}>
            <Button variant="outline" size="sm">
              ← К списку {isClient ? "клиентов" : "водителей"}
            </Button>
          </Link>
        </div>
      </div>

      <RiskScoreCard kind={kind} id={id} fraud={fraud} fraudError={fraudError} />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Заказов</div>
          <div className="text-2xl font-bold">{s.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Выполнено</div>
          <div className="text-2xl font-bold text-green-700">{s.completed}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Отменено</div>
          <div className="text-2xl font-bold text-orange-700">
            {s.cancelled}{" "}
            <span className="text-sm">({pct(s.cancelRate)})</span>
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">GMV (BYN)</div>
          <div className="text-2xl font-bold">{fmt(s.gmvSum, 2)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">
            Уникальных {isClient ? "водителей" : "клиентов"}
          </div>
          <div className="text-2xl font-bold">{s.uniquePartners}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Средняя поездка</div>
          <div className="text-base">
            {fmt(s.avgKm, 1)} км · {fmt(s.avgTripMin, 0)} мин
          </div>
          <div className="text-xs text-muted-foreground">
            ср. чек {fmt(s.avgGmv, 2)} BYN
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {!isClient && (
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Машин (auto)</div>
            <div
              className={`text-2xl font-bold ${(s.uniqueAutos || 0) >= 2 ? "text-orange-700" : ""}`}
            >
              {s.uniqueAutos ?? "—"}
            </div>
            {(s.uniqueAutos || 0) >= 2 && (
              <div className="text-[10px] text-orange-700">
                Ездит на нескольких авто
              </div>
            )}
          </Card>
        )}
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">
            Быстрых отмен (&lt;30с)
          </div>
          <div
            className={`text-2xl font-bold ${(s.fastCancelCount || 0) >= 3 ? "text-orange-700" : ""}`}
          >
            {s.fastCancelCount ?? 0}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">
            Субсидия (CI), % заказов
          </div>
          <div
            className={`text-2xl font-bold ${(s.subsidyShare || 0) >= 0.5 ? "text-orange-700" : ""}`}
          >
            {s.subsidyShare != null ? pct(s.subsidyShare) : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {s.subsidyCount ?? 0} из {s.total}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Средняя подача</div>
          <div className="text-2xl font-bold">
            {s.avgFta != null ? fmt(s.avgFta, 1) : "—"}{" "}
            <span className="text-xs">мин</span>
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">
            Среднее ожидание клиента
          </div>
          <div className="text-2xl font-bold">
            {s.avgClientWait != null ? fmt(s.avgClientWait, 0) : "—"}{" "}
            <span className="text-xs">сек</span>
          </div>
        </Card>
      </div>

      {!isClient && data.autos && data.autos.length > 0 && (
        <Card className="p-4 space-y-2">
          <div className="font-medium">
            Машины водителя ({data.autos.length})
          </div>
          <div className="text-xs text-muted-foreground">
            Если ≥2 — auto_sharing: формальный «таксопарк» под одним аккаунтом
            водителя.
          </div>
          <div className="flex flex-wrap gap-2">
            {data.autos.map((a) => (
              <span
                key={a.autoId}
                className="inline-flex items-center gap-2 px-2 py-1 rounded border bg-slate-50 text-sm"
                data-testid={`auto-${a.autoId}`}
              >
                <span className="font-mono font-semibold">
                  {a.autoNumber || a.autoId}
                </span>
                <span className="text-xs text-muted-foreground">
                  ×{a.count}
                </span>
              </span>
            ))}
          </div>
        </Card>
      )}

      <WbTripMap
        points={data.points}
        routes={data.routes}
        title={`Карта поездок ${isClient ? "клиента" : "водителя"} ${data.id}`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RoutesTable routes={data.routes} />

        <div className="space-y-4">
          <WbBarChart
            title="Активность по дням недели"
            hint="Оранжевое — доля отмен."
            rows={data.byWeekday.map((r) => ({
              label: WEEKDAYS[r.weekday],
              total: r.total,
              cancelled: r.cancelled,
            }))}
            highlightCancel
          />
          <WbBarChart
            title="Активность по часам суток (UTC)"
            rows={data.byHour
              .filter((r) => r.total > 0)
              .map((r) => ({
                label: String(r.hour).padStart(2, "0"),
                total: r.total,
                cancelled: r.cancelled,
              }))}
            highlightCancel
          />
        </div>
      </div>

      <Card className="p-4 space-y-2">
        <div className="font-medium">
          Партнёры ({isClient ? "водители" : "клиенты"}, с кем чаще всего ездит)
        </div>
        <div className="text-xs text-muted-foreground">
          Сортировка по числу совместных заказов. Кликните по ID — детали по
          нему. Жёлтый круг — партнёр уже помечен фродом.
        </div>
        <div className="overflow-x-auto -mx-4 px-4 max-h-[420px]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground sticky top-0 bg-background">
                <th className="py-1.5 pr-2">{partnerLabel} ID</th>
                <th className="py-1.5 pr-2">
                  {isClient ? "ФИО / тел / авто" : "ФИО / тел"}
                </th>
                <th className="py-1.5 pr-2 text-right">Раз</th>
                <th className="py-1.5 pr-2 text-right">Готово</th>
                <th className="py-1.5 pr-2 text-right">Отмен</th>
                <th className="py-1.5 pr-2 text-right">% отмен</th>
                <th className="py-1.5 pr-2 text-right">GMV</th>
              </tr>
            </thead>
            <tbody>
              {data.partners.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-3 text-center text-muted-foreground"
                  >
                    Нет партнёров
                  </td>
                </tr>
              ) : (
                data.partners.map((p) => {
                  const pid = isClient ? p.driverId : p.clientId;
                  if (!pid) return null;
                  const partnerHref = isClient
                    ? `/wb/driver/${encodeURIComponent(pid)}`
                    : `/wb/client/${encodeURIComponent(pid)}`;
                  const flagged = flaggedPartnerIds.has(pid);
                  const partnerName = isClient ? p.driverName : p.clientName;
                  const partnerPhone = isClient ? p.driverPhone : p.clientPhone;
                  return (
                    <tr
                      key={pid}
                      className={`border-b last:border-b-0 hover:bg-muted/30 ${flagged ? "bg-amber-50/60" : ""}`}
                    >
                      <td className="py-1 pr-2 font-mono text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          {flagged && (
                            <span
                              className="inline-block w-2 h-2 rounded-full bg-amber-500"
                              title="Помечен в фрод-отчёте"
                            />
                          )}
                          <Link
                            href={partnerHref}
                            className="underline hover:text-primary"
                            data-testid={`partner-${pid}`}
                          >
                            {pid}
                          </Link>
                        </span>
                      </td>
                      <td className="py-1 pr-2 text-xs">
                        <div className="font-medium leading-tight">
                          {partnerName || (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                          {partnerPhone && <span>+{partnerPhone}</span>}
                          {isClient && p.autoNumber && (
                            <span className="inline-block px-1 py-0.5 rounded bg-slate-200 text-slate-800">
                              {p.autoNumber}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-1 pr-2 text-right font-semibold">
                        {p.total}
                      </td>
                      <td className="py-1 pr-2 text-right">{p.completed}</td>
                      <td className="py-1 pr-2 text-right text-orange-700">
                        {p.cancelled}
                      </td>
                      <td className="py-1 pr-2 text-right text-orange-700">
                        {pct(p.cancelRate)}
                      </td>
                      <td className="py-1 pr-2 text-right">
                        {fmt(p.gmvSum, 2)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <WbBarChart
        title="История по дням"
        hint="Все заказы за каждую дату активности. Оранжевое — доля отмен."
        rows={data.byDay.map((r) => ({
          label: r.date.slice(5),
          total: r.total,
          cancelled: r.cancelled,
        }))}
        highlightCancel
      />

      <div>
        <h2 className="text-lg font-semibold mb-2">Все заказы</h2>
        <WbOrdersTable
          initialClientId={isClient ? data.id : ""}
          initialDriverId={!isClient ? data.id : ""}
        />
      </div>
    </div>
  );
}

export default function WbEntityPage({ kind, id }: { kind: Kind; id: string }) {
  return (
    <WbShell>
      <Inner kind={kind} id={id} />
    </WbShell>
  );
}
