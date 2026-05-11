import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchWbPair,
  fetchWbFraud,
  type WbPairDetail,
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

function PairRiskCard({
  clientId,
  driverId,
  fraud,
  fraudError,
}: {
  clientId: string;
  driverId: string;
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

  const item = fraud.pairs.find(
    (p) => p.clientId === clientId && p.driverId === driverId,
  );

  if (!item) {
    return (
      <Card className="p-4 space-y-2 border-green-300 bg-green-50/40">
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-green-600" />
          <div className="font-semibold text-green-800">
            Risk score: 0 — связка не помечена
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Эта пара не попала ни в одно из правил pair-уровня (доминирование,
          самозаказы, отмены, повторы).
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
              Risk score связки · {item.severity}
            </div>
            <div className="text-3xl font-bold leading-none">{item.score}</div>
          </div>
        </div>
        <div className="text-xs space-y-0.5 text-right">
          <div>
            заказов: <span className="font-semibold">{item.total}</span>
          </div>
          <div>
            отмен: <span className="font-semibold">{item.cancelled}</span> ({pct(item.cancelRate)})
          </div>
          <div>
            доля у клиента: {pct(item.shareOfClient)} · у водителя:{" "}
            {pct(item.shareOfDriver)}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs uppercase opacity-70">
          Сработавшие правила связки ({item.reasons.length}):
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

function HourPattern({ data }: { data: WbPairDetail["byHour"] }) {
  const max = useMemo(
    () => data.reduce((m, r) => (r.total > m ? r.total : m), 1),
    [data],
  );
  return (
    <Card className="p-4 space-y-2">
      <div className="font-medium">Временной паттерн (часы UTC)</div>
      <div className="text-xs text-muted-foreground">
        Когда именно заказы делаются. Пик в одно и то же время ежедневно — повод
        присмотреться.
      </div>
      <div className="grid grid-cols-12 gap-1 mt-2">
        {data.map((r) => {
          const h = r.total / max;
          const color =
            r.total === 0
              ? "bg-slate-100"
              : h > 0.66
                ? "bg-red-500"
                : h > 0.33
                  ? "bg-orange-400"
                  : "bg-amber-300";
          return (
            <div key={r.hour} className="text-center">
              <div
                className={`${color} rounded`}
                style={{ height: `${4 + h * 28}px` }}
                title={`${r.hour}ч: ${r.total} заказ.`}
              />
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {String(r.hour).padStart(2, "0")}
              </div>
              <div className="text-[10px] font-semibold">{r.total || ""}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Inner({ clientId, driverId }: { clientId: string; driverId: string }) {
  const [data, setData] = useState<WbPairDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fraud, setFraud] = useState<WbFraudReport | null>(null);
  const [fraudError, setFraudError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetchWbPair(clientId, driverId)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e?.message || "load_failed"));
    return () => {
      cancelled = true;
    };
  }, [clientId, driverId]);

  useEffect(() => {
    let cancelled = false;
    fetchWbFraud()
      .then((d) => !cancelled && setFraud(d))
      .catch((e) => !cancelled && setFraudError(e?.message || "fraud_failed"));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="container mx-auto p-4 max-w-[1400px]">
        <Card className="p-6 space-y-3">
          <div className="text-red-600">
            {error === "not_found"
              ? `Совместных заказов клиента ${clientId} и водителя ${driverId} не найдено.`
              : `Ошибка: ${error}`}
          </div>
          <Link href="/wb/fraud" className="text-sm underline text-primary">
            ← К фрод-отчёту
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

  return (
    <div className="container mx-auto p-4 space-y-4 max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-muted-foreground uppercase">
            Связка клиент ↔ водитель
          </div>
          <h1 className="text-2xl font-bold font-mono">
            <Link
              href={`/wb/client/${encodeURIComponent(clientId)}`}
              className="underline hover:text-primary"
            >
              {clientId}
            </Link>{" "}
            ↔{" "}
            <Link
              href={`/wb/driver/${encodeURIComponent(driverId)}`}
              className="underline hover:text-primary"
            >
              {driverId}
            </Link>
          </h1>
          {(data.clientIdentity || data.driverIdentity) && (
            <div className="mt-1 text-sm space-y-0.5">
              {data.clientIdentity &&
                (data.clientIdentity.name || data.clientIdentity.phone) && (
                  <div>
                    <span className="text-xs text-muted-foreground uppercase mr-1">
                      клиент:
                    </span>
                    <span className="font-medium">
                      {data.clientIdentity.name || "—"}
                    </span>
                    {data.clientIdentity.phone && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        +{data.clientIdentity.phone}
                      </span>
                    )}
                  </div>
                )}
              {data.driverIdentity &&
                (data.driverIdentity.name ||
                  data.driverIdentity.phone ||
                  data.driverIdentity.autoNumber) && (
                  <div>
                    <span className="text-xs text-muted-foreground uppercase mr-1">
                      водитель:
                    </span>
                    <span className="font-medium">
                      {data.driverIdentity.name || "—"}
                    </span>
                    {data.driverIdentity.phone && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        +{data.driverIdentity.phone}
                      </span>
                    )}
                    {data.driverIdentity.autoNumber && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-slate-200 text-slate-800 text-xs font-mono">
                        {data.driverIdentity.autoNumber}
                      </span>
                    )}
                  </div>
                )}
            </div>
          )}
          <p className="text-sm text-muted-foreground mt-1">
            {s.firstDate || "—"} → {s.lastDate || "—"} · совместная активность
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/wb/graph?focus=driver:${driverId}&depth=2`}>
            <Button variant="outline" size="sm" data-testid="link-graph-focus">
              Связи →
            </Button>
          </Link>
          <Link href="/wb/fraud">
            <Button variant="outline" size="sm">
              ← К фрод-отчёту
            </Button>
          </Link>
        </div>
      </div>

      <PairRiskCard
        clientId={clientId}
        driverId={driverId}
        fraud={fraud}
        fraudError={fraudError}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">
            Совместных заказов
          </div>
          <div className="text-2xl font-bold">{s.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Выполнено</div>
          <div className="text-2xl font-bold text-green-700">{s.completed}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Отмен</div>
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
          <div className="text-xs text-muted-foreground">У клиента</div>
          <div className="text-base">
            {pct(data.shareOfClient)}{" "}
            <span className="text-xs text-muted-foreground">
              из {data.clientTotal}
            </span>
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">У водителя</div>
          <div className="text-base">
            {pct(data.shareOfDriver)}{" "}
            <span className="text-xs text-muted-foreground">
              из {data.driverTotal}
            </span>
          </div>
        </Card>
      </div>

      <WbTripMap
        points={data.points}
        routes={data.routes}
        title={`Карта совместных поездок ${clientId} ↔ ${driverId}`}
      />

      <HourPattern data={data.byHour} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WbBarChart
          title="Активность по дням недели"
          rows={data.byWeekday.map((r) => ({
            label: WEEKDAYS[r.weekday],
            total: r.total,
            cancelled: r.cancelled,
          }))}
          highlightCancel
        />
        <WbBarChart
          title="История по дням"
          rows={data.byDay.map((r) => ({
            label: r.date.slice(5),
            total: r.total,
            cancelled: r.cancelled,
          }))}
          highlightCancel
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Все совместные заказы</h2>
        <WbOrdersTable
          initialClientId={clientId}
          initialDriverId={driverId}
        />
      </div>
    </div>
  );
}

export default function WbPairPage({
  clientId,
  driverId,
}: {
  clientId: string;
  driverId: string;
}) {
  return (
    <WbShell>
      <Inner clientId={clientId} driverId={driverId} />
    </WbShell>
  );
}
