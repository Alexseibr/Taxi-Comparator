import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  fetchWbCases,
  fetchWbFraud,
  takeWbCase,
  type WbCase,
  type WbFraudReport,
  type WbFraudReason,
} from "@/lib/wb-api";
import { WbShell } from "@/components/wb/WbShell";

// Возможные UI-статусы кейса по subject — то, что показывается шильдиком
// рядом с Client/Driver в таблицах подозрений и по чему антифродер фильтрует.
type CaseUiStatus =
  | "none" // ещё не брали в работу
  | "in_progress" // взят в работу, не разобран
  | "confirmed" // разобран → подтверждён фрод
  | "rejected" // разобран → отклонён (не фрод)
  | "unclear"; // разобран → неясно (или закрыт без резолюции)

const ALL_CASE_STATUSES: CaseUiStatus[] = [
  "none",
  "in_progress",
  "confirmed",
  "rejected",
  "unclear",
];

function caseUiStatus(c: WbCase | null | undefined): CaseUiStatus {
  if (!c) return "none";
  if (c.status === "in_progress") return "in_progress";
  if (c.resolution === "confirmed") return "confirmed";
  if (c.resolution === "rejected") return "rejected";
  return "unclear";
}

function caseStatusLabel(s: CaseUiStatus): string {
  switch (s) {
    case "none": return "Без кейса";
    case "in_progress": return "В работе";
    case "confirmed": return "Подтверждён";
    case "rejected": return "Отклонён";
    case "unclear": return "Неясно";
  }
}

// Цвет шильдика статуса в таблице (рядом с subjectId).
function caseStatusBadgeCls(s: CaseUiStatus): string {
  switch (s) {
    case "none":
      return "bg-yellow-400 hover:bg-yellow-500 text-yellow-950 border border-yellow-500";
    case "in_progress":
      return "bg-orange-100 hover:bg-orange-200 text-orange-900 border border-orange-300";
    case "confirmed":
      return "bg-red-600 hover:bg-red-700 text-white border border-red-700";
    case "rejected":
      return "bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700";
    case "unclear":
      return "bg-gray-500 hover:bg-gray-600 text-white border border-gray-600";
  }
}

// Маленький цветной маркер для toggle-фильтра по статусам, чтобы юзер
// глазами связал тоггл с цветом шильдика в строке.
function caseStatusDotCls(s: CaseUiStatus): string {
  switch (s) {
    case "none": return "bg-yellow-400";
    case "in_progress": return "bg-orange-400";
    case "confirmed": return "bg-red-600";
    case "rejected": return "bg-emerald-600";
    case "unclear": return "bg-gray-500";
  }
}

function TakeCaseButton({
  subjectType,
  subjectId,
  subjectName,
  reasons,
  score,
  existingCase,
}: {
  subjectType: "client" | "driver";
  subjectId: string;
  subjectName?: string | null;
  reasons: WbFraudReason[];
  score: number;
  existingCase: WbCase | null;
}) {
  const [, setLoc] = useLocation();
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  // Если по этому subject уже есть кейс — вместо жёлтой «Взять в работу»
  // показываем кликабельный шильдик с реальным статусом. Клик открывает
  // карточку кейса (для in_progress — продолжить разбор, для closed —
  // посмотреть резолюцию).
  if (existingCase) {
    const st = caseUiStatus(existingCase);
    const sub =
      st === "in_progress"
        ? existingCase.assigneeName || "—"
        : existingCase.closedByName || existingCase.assigneeName || "—";
    return (
      <Link
        href={`/wb/cases/${existingCase.id}`}
        className="inline-block"
        data-testid={`btn-status-${subjectType}-${subjectId}`}
      >
        <span
          className={`inline-flex items-center rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${caseStatusBadgeCls(st)}`}
          title={`Кейс № ${existingCase.id} · ${sub}`}
        >
          {caseStatusLabel(st)}
        </span>
        <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
          {sub}
        </div>
      </Link>
    );
  }

  const onClick = async () => {
    setBusy(true);
    try {
      const r = await takeWbCase({
        subjectType,
        subjectId,
        subjectName: subjectName || null,
        signals: reasons.map((x) => ({
          code: (x as any).code,
          severity: x.severity,
          label: x.label,
        })),
        score,
      });
      if (r.alreadyResolved) {
        // Пока антифродер смотрел в список, коллега успел разобрать кейс.
        // Фрод-сводка обновляется не сразу, поэтому кнопка ещё была видна.
        // Сообщаем что статус поменялся и сразу открываем карточку с резолюцией.
        toast({
          title: "Кейс уже разобран",
          description: `Пока вы смотрели — ${r.case.closedByName || r.case.assigneeName || "коллега"} закрыл кейс № ${r.case.id}. Открываю карточку с резолюцией.`,
        });
      } else if (r.alreadyAssigned) {
        toast({
          title: "Уже в работе",
          description: `Кейс № ${r.case.id} ведёт ${r.case.assigneeName || "коллега"}.`,
        });
      }
      setLoc(`/wb/cases/${r.case.id}`);
    } catch (e: any) {
      toast({
        title: "Не удалось взять",
        description: e?.message || "ошибка",
        variant: "destructive",
      });
      setBusy(false);
    }
  };
  return (
    <Button
      size="sm"
      onClick={onClick}
      disabled={busy}
      data-testid={`btn-take-${subjectType}-${subjectId}`}
    >
      {busy ? "…" : "Взять в работу"}
    </Button>
  );
}

type Sev = "low" | "med" | "high" | "critical";
type Tab = "clients" | "drivers" | "pairs" | "orders";

function sevClass(s: Sev): string {
  switch (s) {
    case "critical":
      return "bg-red-600 text-white";
    case "high":
      return "bg-red-100 text-red-800 border border-red-300";
    case "med":
      return "bg-orange-100 text-orange-800 border border-orange-300";
    default:
      return "bg-yellow-50 text-yellow-800 border border-yellow-200";
  }
}
function sevLabel(s: Sev): string {
  return s === "critical"
    ? "критично"
    : s === "high"
      ? "высоко"
      : s === "med"
        ? "средне"
        : "низко";
}
function fmt(n: number, frac = 0) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
}
function fmtDateTime(s?: string | null): string {
  if (!s) return "—";
  return s.replace("+00:00", "").replace("T", " ").slice(0, 16);
}

function ReasonsList({ reasons }: { reasons: WbFraudReason[] }) {
  return (
    <ul className="space-y-0.5">
      {reasons.map((r, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span
            className={`text-[10px] uppercase rounded px-1 py-0.5 shrink-0 ${sevClass(
              r.severity,
            )}`}
          >
            {sevLabel(r.severity)}
          </span>
          <span className="text-xs">{r.label}</span>
        </li>
      ))}
    </ul>
  );
}

function SeverityFilter({
  value,
  onChange,
}: {
  value: Sev | "all";
  onChange: (v: Sev | "all") => void;
}) {
  const opts: Array<{ v: Sev | "all"; label: string }> = [
    { v: "all", label: "Все" },
    { v: "critical", label: "Критично" },
    { v: "high", label: "Высоко" },
    { v: "med", label: "Средне" },
    { v: "low", label: "Низко" },
  ];
  return (
    <div className="flex gap-1 flex-wrap">
      {opts.map((o) => (
        <Button
          key={o.v}
          size="sm"
          variant={value === o.v ? "default" : "outline"}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function Inner() {
  const [data, setData] = useState<WbFraudReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("clients");
  const [sev, setSev] = useState<Sev | "all">("all");
  // Мульти-фильтр по UI-статусам кейса. По умолчанию все включены —
  // антифродер видит обычную сводку. Чтобы скрыть закрытые/разобранные
  // — выключает соответствующий тоггл; тогда подсветка остаётся только
  // на тех subject, по которым ещё нужно работать.
  const [statusSet, setStatusSet] = useState<Set<CaseUiStatus>>(
    () => new Set(ALL_CASE_STATUSES),
  );
  const toggleStatus = (s: CaseUiStatus) =>
    setStatusSet((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      // Защита от пустого фильтра — иначе таблицы становятся
      // непонятно-пустыми и юзер думает что данных нет.
      if (next.size === 0) return prev;
      return next;
    });

  useEffect(() => {
    let cancelled = false;
    fetchWbFraud()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e?.message || "load_failed"));
    return () => {
      cancelled = true;
    };
  }, []);

  // Все кейсы (открытые и закрытые) — нужны чтобы вместо «Взять в работу»
  // показывать актуальный шильдик статуса по subject. Один HTTP-запрос
  // на всю страницу; staleTime 30с, чтобы не дёргать сервер на каждом
  // переключении вкладок. invalidate происходит из других мутаций
  // (takeWbCase / updateWbCase) через queryClient.
  const casesQ = useQuery({
    queryKey: ["wb", "cases", "fraud-overlay"],
    queryFn: () => fetchWbCases({ status: "all", limit: 5000 }),
    staleTime: 30_000,
  });

  // Индекс «последний кейс по subject». На один subject может быть
  // несколько записей в JSONL (старые открытые → закрытые → новые),
  // берём самый свежий по updatedAt — он определяет видимый статус.
  const casesByKey = useMemo(() => {
    const m = new Map<string, WbCase>();
    for (const c of casesQ.data || []) {
      const k = `${c.subjectType}:${c.subjectId}`;
      const prev = m.get(k);
      if (!prev || c.updatedAt > prev.updatedAt) m.set(k, c);
    }
    return m;
  }, [casesQ.data]);

  const getCaseFor = (
    subjectType: "client" | "driver",
    subjectId: string,
  ): WbCase | null => casesByKey.get(`${subjectType}:${subjectId}`) || null;

  const filterFn = (s: Sev) => sev === "all" || s === sev;
  const passStatus = (
    subjectType: "client" | "driver",
    subjectId: string,
  ): boolean => statusSet.has(caseUiStatus(getCaseFor(subjectType, subjectId)));

  const filtered = useMemo(() => {
    if (!data) return null;
    return {
      clients: data.clients.filter(
        (c) => filterFn(c.severity) && passStatus("client", c.clientId),
      ),
      drivers: data.drivers.filter(
        (d) => filterFn(d.severity) && passStatus("driver", d.driverId),
      ),
      // Для связок и заказов фильтр по статусу кейса не применяется —
      // кейс всегда заводится на конкретный subject (client или driver),
      // не на пару и не на заказ.
      pairs: data.pairs.filter((p) => filterFn(p.severity)),
      orders: data.orders.filter((o) => filterFn(o.severity)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sev, statusSet, casesByKey]);

  // Подсчёт сколько subject подпадает под каждый статус — показывается
  // в тогглах фильтра. Считаем по таблице active-вкладки, чтобы числа
  // совпадали с тем что юзер реально видит ниже.
  const statusCounts = useMemo(() => {
    const acc: Record<CaseUiStatus, number> = {
      none: 0, in_progress: 0, confirmed: 0, rejected: 0, unclear: 0,
    };
    if (!data) return acc;
    const subjects: Array<["client" | "driver", string, Sev]> = [];
    if (tab === "clients") {
      for (const c of data.clients) subjects.push(["client", c.clientId, c.severity]);
    } else if (tab === "drivers") {
      for (const d of data.drivers) subjects.push(["driver", d.driverId, d.severity]);
    } else {
      // Для pairs/orders статус-счётчики не очень осмысленны — оставим нули.
      return acc;
    }
    for (const [t, id, s] of subjects) {
      if (!filterFn(s)) continue;
      acc[caseUiStatus(getCaseFor(t, id))]++;
    }
    return acc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tab, sev, casesByKey]);

  if (error) {
    return (
      <div className="container mx-auto p-4 max-w-[1400px]">
        <Card className="p-4 text-sm text-red-600">
          Не удалось загрузить отчёт по фроду: {error}
        </Card>
      </div>
    );
  }
  if (!data || !filtered) {
    return (
      <div className="container mx-auto p-4 max-w-[1400px]">
        <Card className="p-4 text-sm text-muted-foreground">
          Анализирую заказы… (это может занять несколько секунд)
        </Card>
      </div>
    );
  }

  const counts = {
    clients: filtered.clients.length,
    drivers: filtered.drivers.length,
    pairs: filtered.pairs.length,
    orders: filtered.orders.length,
  };

  return (
    <div className="container mx-auto p-4 space-y-4 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold">Подозрения на фрод</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Автоматическая проверка по правилам: высокий процент отмен, лояльность
          к одному партнёру, доминирующие связки, аномальные заказы. Чем выше
          score — тем больше совпавших правил. Кликните по ID, чтобы открыть
          карточку и убедиться вручную.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Сгенерировано: {fmtDateTime(data.generatedAt)}. Проанализировано
          заказов: <b>{data.stats.totalOrders.toLocaleString("ru-RU")}</b>,
          клиентов: <b>{data.stats.totalClients}</b>, водителей:{" "}
          <b>{data.stats.totalDrivers}</b>. Пороги: p95 BYN/км ={" "}
          <b>{fmt(data.thresholds.ppkP95, 2)}</b>, p99 BYN/км ={" "}
          <b>{fmt(data.thresholds.ppkP99, 2)}</b>, p95 подача ={" "}
          <b>{fmt(data.thresholds.ftaP95, 0)}</b> мин.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card
          className={`p-3 cursor-pointer ${tab === "clients" ? "ring-2 ring-primary" : ""}`}
          onClick={() => setTab("clients")}
        >
          <div className="text-xs text-muted-foreground">Подозрительных клиентов</div>
          <div className="text-2xl font-bold text-red-700">
            {data.stats.flaggedClients}
          </div>
        </Card>
        <Card
          className={`p-3 cursor-pointer ${tab === "drivers" ? "ring-2 ring-primary" : ""}`}
          onClick={() => setTab("drivers")}
        >
          <div className="text-xs text-muted-foreground">Подозрительных водителей</div>
          <div className="text-2xl font-bold text-red-700">
            {data.stats.flaggedDrivers}
          </div>
        </Card>
        <Card
          className={`p-3 cursor-pointer ${tab === "pairs" ? "ring-2 ring-primary" : ""}`}
          onClick={() => setTab("pairs")}
        >
          <div className="text-xs text-muted-foreground">Подозрительных связок</div>
          <div className="text-2xl font-bold text-red-700">
            {data.stats.flaggedPairs}
          </div>
        </Card>
        <Card
          className={`p-3 cursor-pointer ${tab === "orders" ? "ring-2 ring-primary" : ""}`}
          onClick={() => setTab("orders")}
        >
          <div className="text-xs text-muted-foreground">Подозрительных заказов</div>
          <div className="text-2xl font-bold text-red-700">
            {data.stats.flaggedOrders}
          </div>
        </Card>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex gap-1 flex-wrap">
            {(["clients", "drivers", "pairs", "orders"] as Tab[]).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={tab === t ? "default" : "outline"}
                onClick={() => setTab(t)}
              >
                {t === "clients"
                  ? `Клиенты (${counts.clients})`
                  : t === "drivers"
                    ? `Водители (${counts.drivers})`
                    : t === "pairs"
                      ? `Связки (${counts.pairs})`
                      : `Заказы (${counts.orders})`}
              </Button>
            ))}
          </div>
          <div className="ml-auto">
            <SeverityFilter value={sev} onChange={setSev} />
          </div>
        </div>

        {/* Фильтр по статусу кейса (только для clients/drivers — у pairs/orders
            кейс не заводится). Мульти-toggle: можно выключить разобранные,
            чтобы не отвлекали, и оставить только «без кейса» + «в работе». */}
        {(tab === "clients" || tab === "drivers") && (
          <div className="flex flex-wrap items-center gap-2 -mt-1">
            <span className="text-xs uppercase text-muted-foreground">
              статус кейса:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {ALL_CASE_STATUSES.map((s) => {
                const on = statusSet.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleStatus(s)}
                    data-testid={`btn-case-status-${s}`}
                    title={on ? "Скрыть эту группу" : "Показать эту группу"}
                    className={
                      "inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium transition-colors " +
                      (on
                        ? "bg-background hover:bg-muted text-foreground border-border"
                        : "bg-muted/40 text-muted-foreground line-through border-dashed border-muted-foreground/30 hover:bg-muted/60")
                    }
                  >
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${caseStatusDotCls(s)} ${on ? "" : "opacity-40"}`}
                    />
                    {caseStatusLabel(s)}
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {statusCounts[s]}
                    </span>
                  </button>
                );
              })}
            </div>
            {casesQ.isLoading && (
              <span className="text-[11px] text-muted-foreground">
                загрузка статусов кейсов…
              </span>
            )}
          </div>
        )}

        {tab === "clients" && (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-3">Серьёзность</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3 text-right">Заказов</th>
                  <th className="py-2 pr-3 text-right">% отмен</th>
                  <th className="py-2 pr-3">Топ-партнёр</th>
                  <th className="py-2 pr-3">Причины</th>
                  <th className="py-2 pr-3">Действие</th>
                </tr>
              </thead>
              <tbody>
                {filtered.clients.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-muted-foreground">
                      По выбранному фильтру никого подозрительного нет
                    </td>
                  </tr>
                ) : (
                  filtered.clients.map((c) => (
                    <tr
                      key={c.clientId}
                      className="border-b align-top hover:bg-muted/20"
                    >
                      <td className="py-2 pr-3">
                        <span className={`text-[10px] uppercase rounded px-1.5 py-0.5 ${sevClass(c.severity)}`}>
                          {sevLabel(c.severity)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-bold">{c.score}</td>
                      <td className="py-2 pr-3 text-xs">
                        <Link
                          href={`/wb/client/${encodeURIComponent(c.clientId)}`}
                          className="font-mono underline hover:text-primary"
                        >
                          {c.clientId}
                        </Link>
                        {(c.clientName || c.clientPhone) && (
                          <div className="mt-0.5 leading-tight">
                            {c.clientName && (
                              <div className="font-medium text-[11px]">
                                {c.clientName}
                              </div>
                            )}
                            {c.clientPhone && (
                              <div className="font-mono text-[10px] text-muted-foreground">
                                +{c.clientPhone}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right">{c.total}</td>
                      <td className="py-2 pr-3 text-right text-orange-700">
                        {(c.cancelRate * 100).toFixed(0)}%{" "}
                        <span className="text-xs text-muted-foreground">
                          ({c.cancelled})
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {c.topPartner ? (
                          <>
                            <Link
                              href={`/wb/driver/${encodeURIComponent(c.topPartner.driverId)}`}
                              className="font-mono underline hover:text-primary"
                            >
                              {c.topPartner.driverId}
                            </Link>{" "}
                            <span className="text-muted-foreground">
                              {c.topPartner.count}/{c.total} (
                              {(c.topPartner.share * 100).toFixed(0)}%)
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 max-w-md">
                        <ReasonsList reasons={c.reasons} />
                      </td>
                      <td className="py-2 pr-3">
                        <TakeCaseButton
                          subjectType="client"
                          subjectId={c.clientId}
                          subjectName={c.clientName || c.clientPhone || null}
                          reasons={c.reasons}
                          score={c.score}
                          existingCase={getCaseFor("client", c.clientId)}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "drivers" && (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-3">Серьёзность</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Driver</th>
                  <th className="py-2 pr-3 text-right">Заказов</th>
                  <th className="py-2 pr-3 text-right">% отмен</th>
                  <th className="py-2 pr-3">Топ-клиент</th>
                  <th className="py-2 pr-3">Причины</th>
                  <th className="py-2 pr-3">Действие</th>
                </tr>
              </thead>
              <tbody>
                {filtered.drivers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-muted-foreground">
                      По выбранному фильтру никого подозрительного нет
                    </td>
                  </tr>
                ) : (
                  filtered.drivers.map((d) => (
                    <tr
                      key={d.driverId}
                      className="border-b align-top hover:bg-muted/20"
                    >
                      <td className="py-2 pr-3">
                        <span className={`text-[10px] uppercase rounded px-1.5 py-0.5 ${sevClass(d.severity)}`}>
                          {sevLabel(d.severity)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-bold">{d.score}</td>
                      <td className="py-2 pr-3 text-xs">
                        <Link
                          href={`/wb/driver/${encodeURIComponent(d.driverId)}`}
                          className="font-mono underline hover:text-primary"
                        >
                          {d.driverId}
                        </Link>
                        {(d.driverName || d.driverPhone || d.autoNumber) && (
                          <div className="mt-0.5 leading-tight">
                            {d.driverName && (
                              <div className="font-medium text-[11px]">
                                {d.driverName}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {d.driverPhone && (
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  +{d.driverPhone}
                                </span>
                              )}
                              {d.autoNumber && (
                                <span className="inline-block px-1 py-0.5 rounded bg-slate-200 text-slate-800 font-mono text-[10px]">
                                  {d.autoNumber}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right">{d.total}</td>
                      <td className="py-2 pr-3 text-right text-orange-700">
                        {(d.cancelRate * 100).toFixed(0)}%{" "}
                        <span className="text-xs text-muted-foreground">
                          ({d.cancelled})
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {d.topPartner ? (
                          <>
                            <Link
                              href={`/wb/client/${encodeURIComponent(d.topPartner.clientId)}`}
                              className="font-mono underline hover:text-primary"
                            >
                              {d.topPartner.clientId}
                            </Link>{" "}
                            <span className="text-muted-foreground">
                              {d.topPartner.count}/{d.total} (
                              {(d.topPartner.share * 100).toFixed(0)}%)
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 max-w-md">
                        <ReasonsList reasons={d.reasons} />
                      </td>
                      <td className="py-2 pr-3">
                        <TakeCaseButton
                          subjectType="driver"
                          subjectId={d.driverId}
                          subjectName={d.driverName || d.driverPhone || null}
                          reasons={d.reasons}
                          score={d.score}
                          existingCase={getCaseFor("driver", d.driverId)}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "pairs" && (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-3">Серьёзность</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Driver</th>
                  <th className="py-2 pr-3 text-right">Совместно</th>
                  <th className="py-2 pr-3 text-right">% отмен</th>
                  <th className="py-2 pr-3 text-right">% от клиента</th>
                  <th className="py-2 pr-3 text-right">% от водителя</th>
                  <th className="py-2 pr-3">Причины</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.pairs.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-6 text-center text-muted-foreground">
                      По выбранному фильтру связок не найдено
                    </td>
                  </tr>
                ) : (
                  filtered.pairs.map((p) => (
                    <tr
                      key={`${p.clientId}|${p.driverId}`}
                      className="border-b align-top hover:bg-muted/20"
                    >
                      <td className="py-2 pr-3">
                        <span className={`text-[10px] uppercase rounded px-1.5 py-0.5 ${sevClass(p.severity)}`}>
                          {sevLabel(p.severity)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-bold">{p.score}</td>
                      <td className="py-2 pr-3 text-xs">
                        <Link
                          href={`/wb/client/${encodeURIComponent(p.clientId)}`}
                          className="font-mono underline hover:text-primary"
                        >
                          {p.clientId}
                        </Link>
                        {(p.clientName || p.clientPhone) && (
                          <div className="mt-0.5 leading-tight">
                            {p.clientName && (
                              <div className="font-medium text-[11px]">
                                {p.clientName}
                              </div>
                            )}
                            {p.clientPhone && (
                              <div className="font-mono text-[10px] text-muted-foreground">
                                +{p.clientPhone}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        <Link
                          href={`/wb/driver/${encodeURIComponent(p.driverId)}`}
                          className="font-mono underline hover:text-primary"
                        >
                          {p.driverId}
                        </Link>
                        {(p.driverName || p.driverPhone || p.autoNumber) && (
                          <div className="mt-0.5 leading-tight">
                            {p.driverName && (
                              <div className="font-medium text-[11px]">
                                {p.driverName}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {p.driverPhone && (
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  +{p.driverPhone}
                                </span>
                              )}
                              {p.autoNumber && (
                                <span className="inline-block px-1 py-0.5 rounded bg-slate-200 text-slate-800 font-mono text-[10px]">
                                  {p.autoNumber}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right font-semibold">
                        {p.total}
                      </td>
                      <td className="py-2 pr-3 text-right text-orange-700">
                        {(p.cancelRate * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {(p.shareOfClient * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {(p.shareOfDriver * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 pr-3 max-w-md">
                        <ReasonsList reasons={p.reasons} />
                      </td>
                      <td className="py-2 pr-3">
                        <Link
                          href={`/wb/pair/${encodeURIComponent(p.clientId)}/${encodeURIComponent(p.driverId)}`}
                          className="text-xs underline whitespace-nowrap text-primary"
                          data-testid={`pair-${p.clientId}-${p.driverId}`}
                        >
                          связка →
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "orders" && (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-3">Серьёзность</th>
                  <th className="py-2 pr-3">Score</th>
                  <th className="py-2 pr-3">Order</th>
                  <th className="py-2 pr-3">Создан</th>
                  <th className="py-2 pr-3">Статус</th>
                  <th className="py-2 pr-3 text-right">км</th>
                  <th className="py-2 pr-3 text-right">BYN</th>
                  <th className="py-2 pr-3 text-right">подача</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Driver</th>
                  <th className="py-2 pr-3">Причины</th>
                </tr>
              </thead>
              <tbody>
                {filtered.orders.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-6 text-center text-muted-foreground">
                      По выбранному фильтру заказов не найдено
                    </td>
                  </tr>
                ) : (
                  filtered.orders.map((o) => (
                    <tr
                      key={o.orderId}
                      className="border-b align-top hover:bg-muted/20"
                    >
                      <td className="py-2 pr-3">
                        <span className={`text-[10px] uppercase rounded px-1.5 py-0.5 ${sevClass(o.severity)}`}>
                          {sevLabel(o.severity)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-bold">{o.score}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{o.orderId}</td>
                      <td className="py-2 pr-3 text-xs">{fmtDateTime(o.createdAt)}</td>
                      <td className="py-2 pr-3 text-xs">
                        {o.status === "completed"
                          ? "выполнен"
                          : o.status === "cancelled"
                            ? "отменён"
                            : "открыт"}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {o.km != null ? fmt(o.km, 2) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {o.gmv != null ? fmt(o.gmv, 2) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {o.fta != null ? fmt(o.fta, 0) : "—"}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        <Link
                          href={`/wb/client/${encodeURIComponent(o.clientId)}`}
                          className="underline hover:text-primary"
                        >
                          {o.clientId}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {o.driverId && o.driverId !== "0" ? (
                          <Link
                            href={`/wb/driver/${encodeURIComponent(o.driverId)}`}
                            className="underline hover:text-primary"
                          >
                            {o.driverId}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 max-w-md">
                        <ReasonsList reasons={o.reasons} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function WbFraudPage() {
  return (
    <WbShell>
      <Inner />
    </WbShell>
  );
}
