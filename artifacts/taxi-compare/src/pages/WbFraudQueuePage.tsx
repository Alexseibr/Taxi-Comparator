import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WbShell } from "@/components/wb/WbShell";
import {
  WbDateRangePicker,
  rangeFromPreset,
  type WbDateRangeValue,
} from "@/components/wb/WbDateRangePicker";
import { useWbCurrentUser } from "@/lib/wb-auth";
import {
  fetchWbDriverFraudReport,
  type WbDriverFraudReportRow,
  fetchWbCases,
  type WbCase,
  fetchWbOrders,
  fetchWbFraud,
  type WbFraudDriver,
  type WbFraudReason,
  takeWbCase,
  updateWbCase,
  setWbFraudMark,
} from "@/lib/wb-api";

// Поток антифродера: водители-кандидаты с фрод-флагами за период,
// перебираешь по очереди → решение → автопереход к следующему.
//
// Очередь = водители из /wb/driver-fraud-report у которых anyFraudOrders > 0,
// сортировка двухуровневая:
//   1) сначала «Med+» (anyFraudOrders ≥ 3 ИЛИ доля фрод-GMV ≥ 30%)
//   2) потом остальные с любым флагом
// Внутри каждой группы — по убыванию anyFraudGmv.
//
// Скрываем тех, по кому за этот же период уже есть закрытый кейс
// (юзер сам решил — закрытое не показываем).

function fmt(n: number | null | undefined, frac = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac > 0 ? frac : 2,
  });
}
function fmtDt(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace("+00:00", "").replace("T", " ").slice(0, 16);
}
function fmtMs(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type DriverHistory = {
  total: number;
  confirmed: number;
  rejected: number;
  unclear: number;
  hasOpenCase: boolean;
  openByOther: boolean;
  myOpenCaseId: string | null;
  hasClosedInPeriod: boolean;
  lastClosedResolution: WbCase["resolution"];
};

function isStrong(r: WbDriverFraudReportRow): boolean {
  const share = r.totalGmv > 0 ? r.anyFraudGmv / r.totalGmv : 0;
  return r.anyFraudOrders >= 3 || share >= 0.3;
}

type Sev = WbFraudReason["severity"];

function sevRank(s: Sev | null | undefined): number {
  return s === "critical" ? 4 : s === "high" ? 3 : s === "med" ? 2 : s === "low" ? 1 : 0;
}

function sevLabel(s: Sev): string {
  return s === "critical"
    ? "Критично"
    : s === "high"
      ? "Высоко"
      : s === "med"
        ? "Средне"
        : "Низко";
}

function sevBadgeClass(s: Sev | null | undefined): string {
  return s === "critical"
    ? "bg-red-600 text-white border-red-700"
    : s === "high"
      ? "bg-red-100 text-red-800 border-red-300"
      : s === "med"
        ? "bg-orange-100 text-orange-800 border-orange-300"
        : s === "low"
          ? "bg-yellow-50 text-yellow-800 border-yellow-200"
          : "bg-gray-100 text-gray-700 border-gray-200";
}

export default function WbFraudQueuePage() {
  const me = useWbCurrentUser();
  const qc = useQueryClient();

  const [range, setRange] = useState<WbDateRangeValue>(() =>
    rangeFromPreset("today"),
  );
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [bonuses, setBonuses] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Модалка «История разборов» — детальный список закрытых кейсов по
  // выбранному водителю (что проверялось / кто / какой вердикт / комментарии).
  const [historyOpen, setHistoryOpen] = useState(false);

  // 1) Очередь — водители с фрод-флагами за период.
  const queueQ = useQuery({
    queryKey: ["wb", "fraud-queue", range.fromTs, range.toTs],
    queryFn: () =>
      fetchWbDriverFraudReport({
        fromTs: range.fromTs ?? undefined,
        toTs: range.toTs ?? undefined,
        limit: 300,
      }),
  });

  // 1b) Подозрения от rule-based скоринга /wb/fraud за тот же период:
  // именно эти reasons показываем как «Высоко: отмен 86% — порог 70%»,
  // «Средне: 4 ночных отмен», и т.п. (как в старом модуле).
  const fraudReportQ = useQuery({
    queryKey: ["wb", "fraud-report", range.fromTs, range.toTs],
    queryFn: () =>
      fetchWbFraud({
        fromTs: range.fromTs ?? undefined,
        toTs: range.toTs ?? undefined,
      }),
  });

  // Индекс «подозрений» по driverId — чтобы быстро брать в sidebar и в карточке.
  const fraudByDriver = useMemo(() => {
    const m = new Map<string, WbFraudDriver>();
    if (!fraudReportQ.data) return m;
    for (const d of fraudReportQ.data.drivers) {
      m.set(String(d.driverId), d);
    }
    return m;
  }, [fraudReportQ.data]);

  // ── ГЛОБАЛЬНЫЕ «подозрительные клиенты» ─────────────────────────────
  // Если у любого водителя за период есть topPartner с долей ≥ 40%, то этот
  // клиент попадает в общий список «red flag clients». Подсветка применяется
  // к ID клиента в таблице заказов ВО ВСЕХ карточках (не только у того
  // водителя, у которого он топ-клиент): это значит, что у того же клиента
  // может быть сговор и с другими водителями.
  const suspectClients = useMemo(() => {
    // clientId → сколько водителей считают его top-клиентом, и максимальная
    // доля по любому из них (для серьёзности подсветки).
    const m = new Map<string, { drivers: number; maxShare: number }>();
    if (!fraudReportQ.data) return m;
    for (const d of fraudReportQ.data.drivers) {
      const tp = d.topPartner;
      if (!tp || tp.share < 0.4) continue;
      const id = String(tp.clientId);
      const cur = m.get(id);
      if (cur) {
        cur.drivers++;
        if (tp.share > cur.maxShare) cur.maxShare = tp.share;
      } else {
        m.set(id, { drivers: 1, maxShare: tp.share });
      }
    }
    return m;
  }, [fraudReportQ.data]);

  // ── Мутация «отметить заказ как фрод / снять фрод» ─────────────────
  // Бьёт в существующий append-only endpoint /wb/fraud-marks.
  // После успеха — refetch заказов выбранного водителя, чтобы обновились
  // manualMark / manualFraud в строке таблицы.
  const markMut = useMutation({
    mutationFn: setWbFraudMark,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wb", "orders"] });
    },
  });

  // 2) Все кейсы по водителям — для индикатора истории и фильтра «уже разобран».
  // Грузим оба статуса один раз; refetch каждые 30 сек.
  const casesAllQ = useQuery({
    queryKey: ["wb", "cases-all-drivers"],
    queryFn: async () => {
      const [open, closed] = await Promise.all([
        fetchWbCases({ status: "open" }),
        fetchWbCases({ status: "closed" }),
      ]);
      return [...open, ...closed].filter((c) => c.subjectType === "driver");
    },
    refetchInterval: 30_000,
  });

  // Индекс истории по subjectId (driverId).
  const histBySubject = useMemo(() => {
    const m = new Map<string, DriverHistory>();
    if (!casesAllQ.data) return m;
    const fromMs = range.fromTs ? Date.parse(range.fromTs) : 0;
    const toMs = range.toTs ? Date.parse(range.toTs) : Number.POSITIVE_INFINITY;
    // Сначала собираем закрытые в порядке убывания closedAt — чтобы
    // взять «последнюю резолюцию» за всё время.
    const sorted = [...casesAllQ.data].sort(
      (a, b) => (b.closedAt || b.updatedAt || 0) - (a.closedAt || a.updatedAt || 0),
    );
    for (const c of sorted) {
      const id = String(c.subjectId);
      let h = m.get(id);
      if (!h) {
        h = {
          total: 0,
          confirmed: 0,
          rejected: 0,
          unclear: 0,
          hasOpenCase: false,
          openByOther: false,
          myOpenCaseId: null,
          hasClosedInPeriod: false,
          lastClosedResolution: null,
        };
        m.set(id, h);
      }
      if (c.status === "in_progress") {
        h.hasOpenCase = true;
        if (me && c.assigneeId === me.id) {
          h.myOpenCaseId = c.id;
        } else {
          h.openByOther = true;
        }
      } else if (c.status === "closed") {
        h.total++;
        if (c.resolution === "confirmed") h.confirmed++;
        else if (c.resolution === "rejected") h.rejected++;
        else if (c.resolution === "unclear") h.unclear++;
        if (h.lastClosedResolution == null) {
          h.lastClosedResolution = c.resolution;
        }
        const ts = c.closedAt || c.updatedAt || 0;
        if (ts >= fromMs && ts <= toMs) h.hasClosedInPeriod = true;
      }
    }
    return m;
  }, [casesAllQ.data, me, range.fromTs, range.toTs]);

  // Очередь после фильтра + сортировки.
  const queue = useMemo(() => {
    if (!queueQ.data) return [] as WbDriverFraudReportRow[];
    const rows = queueQ.data.rows.filter((r) => r.anyFraudOrders > 0);
    const visible = rows.filter((r) => {
      const h = histBySubject.get(r.driverId);
      // Скрываем тех, кого уже разобрали за период.
      return !(h && h.hasClosedInPeriod);
    });
    visible.sort((a, b) => {
      // Главный приоритет — настоящий severity rule-based скоринга /wb/fraud
      // (critical > high > med > low). Если у водителя нет записи в /wb/fraud,
      // эвристика «много фрод-заказов или большая доля фрод-GMV» считает его «med».
      const fa = fraudByDriver.get(a.driverId);
      const fb = fraudByDriver.get(b.driverId);
      const ra = fa ? sevRank(fa.severity) : isStrong(a) ? 2 : 1;
      const rb = fb ? sevRank(fb.severity) : isStrong(b) ? 2 : 1;
      if (ra !== rb) return rb - ra;
      // Внутри одной severity — по rule-score, потом по фрод-GMV.
      const sa = fa?.score ?? 0;
      const sb = fb?.score ?? 0;
      if (sa !== sb) return sb - sa;
      return b.anyFraudGmv - a.anyFraudGmv;
    });
    return visible;
  }, [queueQ.data, histBySubject, fraudByDriver]);

  // «Мои в работе» — только водители.
  const myInProgress = useMemo(() => {
    if (!casesAllQ.data || !me) return [] as WbCase[];
    return casesAllQ.data
      .filter((c) => c.status === "in_progress" && c.assigneeId === me.id)
      .sort((a, b) => (b.takenAt || 0) - (a.takenAt || 0));
  }, [casesAllQ.data, me]);

  // Авто-выбор первого кандидата при первом рендере / смене периода.
  useEffect(() => {
    if (selectedDriverId) return;
    if (queue.length > 0) {
      setSelectedDriverId(queue[0].driverId);
    } else if (myInProgress.length > 0) {
      setSelectedDriverId(String(myInProgress[0].subjectId));
    }
  }, [queue, myInProgress, selectedDriverId]);

  // 3) Заказы выбранного водителя за период (с пометками фрода).
  const ordersQ = useQuery({
    queryKey: ["wb", "orders", selectedDriverId, range.fromTs, range.toTs],
    queryFn: () =>
      fetchWbOrders({
        driverId: selectedDriverId!,
        fromTs: range.fromTs ?? undefined,
        toTs: range.toTs ?? undefined,
        withFraudMarks: true,
        limit: 500,
      }),
    enabled: !!selectedDriverId,
  });

  // KPI выбранного водителя за период (считаем на клиенте по items).
  const kpi = useMemo(() => {
    if (!ordersQ.data) return null;
    const items = ordersQ.data.items;
    const completed = items.filter((o) => o.status === "completed");
    let totalKm = 0;
    let totalGmv = 0;
    let sumPpk = 0;
    let ppkCnt = 0;
    let sumFta = 0;
    let ftaCnt = 0;
    let cashGmv = 0;
    let cardGmv = 0;
    let autoFraudCount = 0;
    let manualFraudCount = 0;
    for (const o of items) {
      if (o.autoFraud) autoFraudCount++;
      if (o.manualFraud) manualFraudCount++;
    }
    for (const o of completed) {
      if (o.km != null && Number.isFinite(o.km)) totalKm += o.km;
      if (o.gmv != null && Number.isFinite(o.gmv)) {
        totalGmv += o.gmv;
        if (o.paymentType === "0") cashGmv += o.gmv;
        else if (o.paymentType === "4") cardGmv += o.gmv;
      }
      if (o.km && o.km > 0 && o.gmv != null && o.gmv > 0) {
        sumPpk += o.gmv / o.km;
        ppkCnt++;
      }
      if (o.fta != null && Number.isFinite(o.fta)) {
        sumFta += o.fta;
        ftaCnt++;
      }
    }
    return {
      total: items.length,
      completed: completed.length,
      totalKm,
      totalGmv,
      avgCheck: completed.length ? totalGmv / completed.length : 0,
      avgPpk: ppkCnt ? sumPpk / ppkCnt : 0,
      avgFta: ftaCnt ? sumFta / ftaCnt : 0,
      cashGmv,
      cardGmv,
      autoFraudCount,
      manualFraudCount,
    };
  }, [ordersQ.data]);

  const currentRow = useMemo(() => {
    if (!selectedDriverId || !queueQ.data) return null;
    return queueQ.data.rows.find((r) => r.driverId === selectedDriverId) ?? null;
  }, [selectedDriverId, queueQ.data]);

  const currentHist = selectedDriverId
    ? histBySubject.get(selectedDriverId) ?? null
    : null;

  const currentFraud = selectedDriverId
    ? fraudByDriver.get(selectedDriverId) ?? null
    : null;

  // Полный список ЗАКРЫТЫХ кейсов по выбранному водителю — для модалки
  // «История разборов»: что проверялось (signals), кто проверял
  // (closedByName/assigneeName), какой вердикт (resolution),
  // комментарии и пометка «бонусы/штраф».
  const currentDriverCases = useMemo<WbCase[]>(() => {
    if (!selectedDriverId || !casesAllQ.data) return [];
    return casesAllQ.data
      .filter(
        (c) =>
          String(c.subjectId) === selectedDriverId && c.status === "closed",
      )
      .sort(
        (a, b) =>
          (b.closedAt ?? b.updatedAt ?? 0) - (a.closedAt ?? a.updatedAt ?? 0),
      );
  }, [casesAllQ.data, selectedDriverId]);

  function selectNext() {
    setComment("");
    setBonuses(false);
    setErrorMsg(null);
    if (!selectedDriverId) return;
    const idx = queue.findIndex((r) => r.driverId === selectedDriverId);
    // Берём следующего ПОСЛЕ текущего, либо первого если текущий был последним.
    let next: WbDriverFraudReportRow | undefined;
    if (idx >= 0) {
      next = queue[idx + 1] || queue.find((r) => r.driverId !== selectedDriverId);
    } else {
      next = queue[0];
    }
    if (next && next.driverId !== selectedDriverId) {
      setSelectedDriverId(next.driverId);
    } else {
      setSelectedDriverId(null);
    }
  }

  async function decideOnDriver(
    resolution: "confirmed" | "rejected" | "unclear",
  ) {
    if (!selectedDriverId || !currentRow) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      // Сигналы для кейса = настоящие rule-based reasons из /wb/fraud (если
      // водитель попал в скоринг) + одна сводная строка по фрод-заказам.
      // Это даёт в /wb/cases понятную картину «за что взяли».
      const signals: Array<{
        code: string;
        severity: "low" | "med" | "high" | "critical";
        label: string;
      }> = [];
      if (currentFraud) {
        for (const rs of currentFraud.reasons) {
          signals.push({
            code: rs.code,
            severity: rs.severity,
            label: rs.label,
          });
        }
      }
      signals.push({
        code: "fraud_queue_summary",
        severity: "med",
        label: `${currentRow.anyFraudOrders} фрод-заказов на ${fmt(currentRow.anyFraudGmv, 2)} BYN из ${currentRow.orders} (общая выручка ${fmt(currentRow.totalGmv, 0)} BYN)`,
      });
      const score = currentFraud?.score ?? currentRow.anyFraudOrders;
      const t = await takeWbCase({
        subjectType: "driver",
        subjectId: selectedDriverId,
        signals,
        score,
      });
      if (t.alreadyResolved) {
        // Уже разобран кем-то — обновляем кеш, идём дальше.
        await qc.invalidateQueries({ queryKey: ["wb", "cases-all-drivers"] });
        selectNext();
        return;
      }
      // Кейс наш (или мы только что взяли) — закрываем с резолюцией.
      await updateWbCase(t.case.id, {
        resolution,
        resolutionNote: comment.slice(0, 4000),
        bonusesApplied: bonuses,
        close: true,
      });
      await qc.invalidateQueries({ queryKey: ["wb", "cases-all-drivers"] });
      await qc.invalidateQueries({ queryKey: ["wb", "fraud-queue"] });
      selectNext();
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }

  // Когда юзер тычет в карточку «Мои в работе» — открываем существующий
  // кейс на отдельной странице (там полный CRUD, бонусы, действия).
  // Здесь же можно только закрыть его быстрыми кнопками если он видим в очереди.

  return (
    <WbShell>
      <div className="container mx-auto px-4 max-w-[1600px] py-3 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold">Фрод — поток</h1>
            <Link href="/wb/fraud/legacy">
              <Button variant="ghost" size="sm" data-testid="link-legacy">
                старая вкладка →
              </Button>
            </Link>
            <Link href="/wb/cases">
              <Button variant="ghost" size="sm" data-testid="link-cases">
                все кейсы
              </Button>
            </Link>
          </div>
          <WbDateRangePicker
            value={range}
            onChange={(v) => {
              setRange(v);
              setSelectedDriverId(null);
            }}
          />
        </div>

        <div className="grid grid-cols-12 gap-3">
          {/* SIDEBAR */}
          <div className="col-span-12 md:col-span-3 space-y-3">
            {myInProgress.length > 0 && (
              <Card className="p-2">
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-2 px-1">
                  Мои в работе ({myInProgress.length})
                </div>
                <div className="space-y-1">
                  {myInProgress.map((c) => {
                    const isSel = selectedDriverId === String(c.subjectId);
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelectedDriverId(String(c.subjectId))}
                        data-testid={`my-case-${c.id}`}
                        className={
                          "w-full text-left text-sm px-2 py-1.5 rounded border " +
                          (isSel
                            ? "bg-primary/10 border-primary"
                            : "border-transparent hover:bg-muted/50")
                        }
                      >
                        <div className="font-medium">{c.subjectId}</div>
                        <div className="text-xs text-muted-foreground">
                          взят {fmtMs(c.takenAt)}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="px-1 mt-2">
                  <Link href="/wb/cases">
                    <Button variant="outline" size="sm" className="w-full">
                      Открыть в /wb/cases
                    </Button>
                  </Link>
                </div>
              </Card>
            )}

            <Card className="p-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2 px-1">
                Очередь ({queue.length})
              </div>
              {queueQ.isLoading && (
                <div className="text-xs text-muted-foreground p-2">Загрузка…</div>
              )}
              {queueQ.error && (
                <div className="text-xs text-red-600 p-2">
                  Ошибка: {(queueQ.error as Error).message}
                </div>
              )}
              {!queueQ.isLoading && queue.length === 0 && (
                <div className="text-xs text-muted-foreground p-2">
                  За период никого с фрод-флагами не осталось — либо все разобраны.
                </div>
              )}
              <div className="space-y-1 max-h-[70vh] overflow-y-auto">
                {queue.map((r) => {
                  const h = histBySubject.get(r.driverId);
                  const fd = fraudByDriver.get(r.driverId);
                  // Показываем настоящий severity если есть, иначе fallback
                  // на эвристику isStrong → подменим на "med"-цвет.
                  const sev: Sev | null = fd
                    ? fd.severity
                    : isStrong(r)
                      ? "med"
                      : "low";
                  const isSel = selectedDriverId === r.driverId;
                  return (
                    <button
                      key={r.driverId}
                      onClick={() => {
                        setSelectedDriverId(r.driverId);
                        setComment("");
                        setBonuses(false);
                        setErrorMsg(null);
                      }}
                      data-testid={`queue-driver-${r.driverId}`}
                      className={
                        "w-full text-left text-sm px-2 py-1.5 rounded border " +
                        (isSel
                          ? "bg-primary/10 border-primary"
                          : "border-transparent hover:bg-muted/50")
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{r.driverId}</span>
                        <span
                          className={
                            "text-[10px] uppercase rounded px-1 py-0.5 shrink-0 border " +
                            sevBadgeClass(sev)
                          }
                        >
                          {sevLabel(sev)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.anyFraudOrders} фрод. · {fmt(r.anyFraudGmv, 0)} BYN
                        {fd?.autoNumber ? (
                          <> · авто {fd.autoNumber}</>
                        ) : null}
                      </div>
                      {fd && fd.reasons.length > 0 && (
                        <div className="text-[11px] text-red-700 truncate">
                          {fd.reasons.length} подозрени
                          {fd.reasons.length === 1 ? "е" : "й"}
                        </div>
                      )}
                      {h && (h.confirmed > 0 || h.hasOpenCase) && (
                        <div className="text-[11px] mt-0.5">
                          {h.confirmed > 0 && (
                            <span className="text-red-700 font-medium mr-2">
                              ⚠ был {h.confirmed}
                            </span>
                          )}
                          {h.openByOther && (
                            <span className="text-orange-700">в работе</span>
                          )}
                          {h.myOpenCaseId && (
                            <span className="text-primary">мой кейс</span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* MAIN */}
          <div className="col-span-12 md:col-span-9 space-y-3">
            {!selectedDriverId && (
              <Card className="p-8 text-center text-muted-foreground">
                Выберите водителя из очереди слева. Если очередь пуста —
                подозрительных за выбранный период не найдено или все уже
                разобраны.
              </Card>
            )}

            {selectedDriverId && (
              <>
                {/* Header */}
                <Card className="p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">
                        Водитель
                      </div>
                      <div
                        className="text-xl font-semibold"
                        data-testid="text-current-driver"
                      >
                        {selectedDriverId}
                        {currentFraud?.driverName ? (
                          <span className="ml-2 text-base font-normal text-muted-foreground">
                            {currentFraud.driverName}
                          </span>
                        ) : null}
                      </div>
                      {(currentFraud?.driverPhone || currentFraud?.autoNumber) && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {currentFraud?.driverPhone && (
                            <span>{currentFraud.driverPhone}</span>
                          )}
                          {currentFraud?.driverPhone && currentFraud?.autoNumber && (
                            <span> · </span>
                          )}
                          {currentFraud?.autoNumber && (
                            <span>авто {currentFraud.autoNumber}</span>
                          )}
                        </div>
                      )}
                      {currentFraud && (
                        <div className="mt-1.5">
                          <span
                            className={
                              "text-[10px] uppercase rounded px-1.5 py-0.5 border " +
                              sevBadgeClass(currentFraud.severity)
                            }
                            data-testid="badge-current-severity"
                          >
                            {sevLabel(currentFraud.severity)} · score{" "}
                            {currentFraud.score}
                          </span>
                        </div>
                      )}
                      {currentHist && currentHist.total > 0 && (
                        <div className="mt-2 flex items-center gap-2 text-sm flex-wrap">
                          <button
                            type="button"
                            onClick={() => setHistoryOpen(true)}
                            className="inline-flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer"
                            title="Открыть детали — что проверялось, кто проверял и какой был вердикт"
                            data-testid="btn-open-history"
                          >
                            <Badge
                              className={
                                currentHist.confirmed > 0
                                  ? "bg-red-600 text-white hover:bg-red-700"
                                  : "bg-gray-200 text-gray-800 hover:bg-gray-300"
                              }
                            >
                              История: {currentHist.total} разбор{currentHist.total === 1 ? "" : "ов"}
                            </Badge>
                            {currentHist.confirmed > 0 && (
                              <span className="text-red-700 font-medium underline decoration-dotted">
                                подтв. {currentHist.confirmed}
                              </span>
                            )}
                            {currentHist.rejected > 0 && (
                              <span className="text-green-700 underline decoration-dotted">
                                отклон. {currentHist.rejected}
                              </span>
                            )}
                            {currentHist.unclear > 0 && (
                              <span className="text-gray-700 underline decoration-dotted">
                                неясно {currentHist.unclear}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              · подробнее
                            </span>
                          </button>
                        </div>
                      )}
                      {currentHist?.openByOther && !currentHist.myOpenCaseId && (
                        <div className="mt-1 text-sm text-orange-700">
                          ⚠ Уже в работе у другого антифродера. Подтверждение
                          возьмёт его кейс.
                        </div>
                      )}
                      {currentHist?.myOpenCaseId && (
                        <div className="mt-1 text-sm text-primary">
                          У вас уже открыт кейс по этому водителю —{" "}
                          <Link
                            href={`/wb/cases/${currentHist.myOpenCaseId}`}
                            className="underline"
                          >
                            открыть карточку
                          </Link>
                        </div>
                      )}
                    </div>
                    {currentRow && (
                      <div className="text-right text-sm">
                        <div>
                          <span className="text-muted-foreground">Заказы:</span>{" "}
                          <b>{currentRow.orders}</b>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            Фрод-флаги:
                          </span>{" "}
                          <b className="text-red-700">
                            {currentRow.anyFraudOrders}
                          </b>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            Фрод-GMV:
                          </span>{" "}
                          <b className="text-red-700">
                            {fmt(currentRow.anyFraudGmv, 2)} BYN
                          </b>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>

                {/* Подозрения — rule-based reasons из /wb/fraud за период */}
                {currentFraud && currentFraud.reasons.length > 0 && (
                  <Card className="p-3">
                    <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                      Подозрения ({currentFraud.reasons.length})
                    </div>
                    <ul className="space-y-1.5">
                      {currentFraud.reasons.map((rs, i) => (
                        <li
                          key={`${rs.code}-${i}`}
                          className="flex items-start gap-2 text-sm"
                          data-testid={`reason-${rs.code}`}
                        >
                          <span
                            className={
                              "text-[10px] uppercase rounded px-1.5 py-0.5 border shrink-0 " +
                              sevBadgeClass(rs.severity)
                            }
                          >
                            {sevLabel(rs.severity)}
                          </span>
                          <span>{rs.label}</span>
                        </li>
                      ))}
                    </ul>
                    {currentFraud.topPartner && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Чаще всего возит клиента{" "}
                        <b className="text-foreground">
                          {currentFraud.topPartner.clientId}
                        </b>{" "}
                        — {currentFraud.topPartner.count} раз (
                        {Math.round(currentFraud.topPartner.share * 100)}%)
                      </div>
                    )}
                    {currentFraud.cancelRate > 0 && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Отмены: {currentFraud.cancelled} из {currentFraud.total}{" "}
                        ({Math.round(currentFraud.cancelRate * 100)}%)
                      </div>
                    )}
                  </Card>
                )}

                {/* KPI */}
                {kpi && (
                  <Card className="p-3">
                    <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                      KPI за период
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div>
                        <div className="text-muted-foreground text-xs">
                          Всего заказов
                        </div>
                        <div className="text-lg font-semibold">
                          {kpi.total}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({kpi.completed} вып.)
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">
                          Пробег
                        </div>
                        <div className="text-lg font-semibold">
                          {fmt(kpi.totalKm, 1)}{" "}
                          <span className="text-xs">км</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">
                          Выручка
                        </div>
                        <div className="text-lg font-semibold">
                          {fmt(kpi.totalGmv, 0)}{" "}
                          <span className="text-xs">BYN</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">
                          Ср. чек
                        </div>
                        <div className="text-lg font-semibold">
                          {fmt(kpi.avgCheck, 2)}{" "}
                          <span className="text-xs">BYN</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">
                          Ср. чек / км
                        </div>
                        <div className="text-lg font-semibold">
                          {fmt(kpi.avgPpk, 2)}{" "}
                          <span className="text-xs">BYN/км</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">
                          Ср. подача
                        </div>
                        <div className="text-lg font-semibold">
                          {fmt(kpi.avgFta, 1)}{" "}
                          <span className="text-xs">мин</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">
                          Наличные
                        </div>
                        <div className="text-lg font-semibold text-amber-800">
                          {fmt(kpi.cashGmv, 0)}{" "}
                          <span className="text-xs">BYN</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">
                          Безнал
                        </div>
                        <div className="text-lg font-semibold text-blue-800">
                          {fmt(kpi.cardGmv, 0)}{" "}
                          <span className="text-xs">BYN</span>
                        </div>
                      </div>
                    </div>
                  </Card>
                )}

                {/* Orders */}
                <Card className="p-0 overflow-hidden">
                  <div className="px-3 py-2 border-b flex items-center justify-between flex-wrap gap-2">
                    <div className="text-sm font-semibold">
                      Заказы за период
                    </div>
                    {ordersQ.data && (
                      <div className="text-xs text-muted-foreground">
                        всего {ordersQ.data.total}, авто-фрод{" "}
                        {kpi?.autoFraudCount ?? 0}, ручных{" "}
                        {kpi?.manualFraudCount ?? 0}
                      </div>
                    )}
                  </div>
                  <div className="overflow-x-auto max-h-[50vh]">
                    <table className="w-full text-xs border-separate border-spacing-0">
                      {/*
                        Sticky-шапка таблицы. В Chrome `background` на `<thead>`
                        при `position: sticky` часто игнорируется, поэтому фон
                        ставим на каждый `<th>` (непрозрачный bg-card) +
                        отдельная нижняя граница, чтобы строки данных не
                        просвечивали через шапку при прокрутке.
                      */}
                      <thead className="sticky top-0 z-10">
                        <tr className="text-left text-muted-foreground">
                          <th className="px-2 py-1.5 bg-card border-b border-border">Создан</th>
                          <th className="px-2 py-1.5 bg-card border-b border-border">Заказ</th>
                          <th className="px-2 py-1.5 bg-card border-b border-border">Клиент</th>
                          <th className="px-2 py-1.5 bg-card border-b border-border text-right">Сумма</th>
                          <th className="px-2 py-1.5 bg-card border-b border-border text-right">Км</th>
                          <th
                            className="px-2 py-1.5 bg-card border-b border-border text-right"
                            title="Время от принятия заказа до прибытия на адрес подачи (минуты). Аномально большое = возможна затяжка ради другого водителя."
                          >
                            Подача, мин
                          </th>
                          <th className="px-2 py-1.5 bg-card border-b border-border">Опл.</th>
                          <th className="px-2 py-1.5 bg-card border-b border-border">Статус</th>
                          <th className="px-2 py-1.5 bg-card border-b border-border">Флаги</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ordersQ.isLoading && (
                          <tr>
                            <td
                              colSpan={9}
                              className="p-4 text-center text-muted-foreground"
                            >
                              Загрузка…
                            </td>
                          </tr>
                        )}
                        {ordersQ.error && (
                          <tr>
                            <td
                              colSpan={9}
                              className="p-4 text-center text-red-600"
                            >
                              Ошибка: {(ordersQ.error as Error).message}
                            </td>
                          </tr>
                        )}
                        {ordersQ.data && ordersQ.data.items.length === 0 && (
                          <tr>
                            <td
                              colSpan={9}
                              className="p-4 text-center text-muted-foreground"
                            >
                              За период заказов нет.
                            </td>
                          </tr>
                        )}
                        {ordersQ.data?.items.map((o) => {
                          const isFr = o.autoFraud || o.manualFraud;
                          // Подсветка клиента: если клиент в глобальном списке
                          // подозрительных (≥40% заказов хотя бы у одного водителя
                          // приходится на него), выделяем его красным независимо
                          // от того, чьи заказы мы сейчас смотрим. Это сразу
                          // показывает: «у этого же клиента сговор может быть и
                          // с другими водителями».
                          const sc = suspectClients.get(String(o.clientId));
                          // Подсказка для бейджа «авто». Приоритет 1 —
                          // per-order причины с бэкенда (autoFraudReasons):
                          // показываем РОВНО какие эвристики сработали именно
                          // на этом заказе. Если бэкенд их не вернул (старая
                          // версия) — fallback на общий контекст подозрений
                          // по водителю, чтобы антифродер хотя бы видел канву.
                          const orderReasons =
                            Array.isArray(o.autoFraudReasons) &&
                            o.autoFraudReasons.length > 0
                              ? o.autoFraudReasons
                              : null;
                          const autoTooltip = orderReasons
                            ? "Сработавшие правила по этому заказу:\n• " +
                              orderReasons.join("\n• ")
                            : currentFraud
                              ? "По этому заказу персональных правил нет.\nОбщие подозрения по водителю:\n• " +
                                currentFraud.reasons
                                  .map((r) => `[${sevLabel(r.severity)}] ${r.label}`)
                                  .join("\n• ")
                              : "Сработал авто-фрод по этому заказу (детали недоступны)";
                          // Текущее состояние ручной отметки.
                          const mark: "fraud" | "notfraud" | null =
                            o.manualMark ?? (o.manualFraud ? "fraud" : null);
                          const busyMark =
                            markMut.isPending &&
                            markMut.variables?.orderId === o.orderId;
                          return (
                            <tr
                              key={o.orderId}
                              className={
                                "border-t hover:bg-muted/30 " +
                                (mark === "notfraud"
                                  ? "bg-emerald-50/40 "
                                  : isFr
                                    ? "bg-red-50/50 "
                                    : "")
                              }
                              data-testid={`order-row-${o.orderId}`}
                            >
                              <td className="px-2 py-1 whitespace-nowrap">
                                {fmtDt(o.createdAt)}
                              </td>
                              <td className="px-2 py-1 font-mono text-[10px]">
                                {o.orderId}
                              </td>
                              <td className="px-2 py-1">
                                {sc ? (
                                  <span
                                    className="inline-flex items-center gap-1 rounded px-1 py-0.5 bg-red-100 text-red-800 font-bold border border-red-300"
                                    title={
                                      "Подозрительный клиент — " +
                                      sc.drivers +
                                      " водител" +
                                      (sc.drivers === 1 ? "ь" : "я") +
                                      " имеют его как top-партнёра. " +
                                      "Макс. доля: " +
                                      Math.round(sc.maxShare * 100) +
                                      "%"
                                    }
                                  >
                                    {o.clientId}
                                    <span className="text-[9px] uppercase tracking-wide opacity-80">
                                      red
                                    </span>
                                  </span>
                                ) : (
                                  <>{o.clientId}</>
                                )}
                              </td>
                              <td className="px-2 py-1 text-right tabular-nums">
                                {fmt(o.gmv, 2)}
                              </td>
                              <td className="px-2 py-1 text-right tabular-nums">
                                {fmt(o.km, 1)}
                              </td>
                              <td className="px-2 py-1 text-right tabular-nums">
                                {fmt(o.fta, 0)}
                              </td>
                              <td className="px-2 py-1">
                                {o.paymentType === "4" ? (
                                  <span className="text-blue-800">безн</span>
                                ) : o.paymentType === "0" ? (
                                  <span className="text-amber-800">нал</span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-2 py-1">
                                {o.status === "completed"
                                  ? "✓"
                                  : o.status === "cancelled"
                                    ? "✗"
                                    : "—"}
                              </td>
                              <td className="px-2 py-1">
                                <div className="flex items-center gap-1 flex-wrap">
                                  {o.autoFraud && (
                                    <Badge
                                      variant="destructive"
                                      className="text-[10px] cursor-help"
                                      title={autoTooltip}
                                      data-testid={`badge-auto-${o.orderId}`}
                                    >
                                      авто
                                    </Badge>
                                  )}
                                  {mark === "fraud" && (
                                    <Badge
                                      variant="destructive"
                                      className="text-[10px]"
                                      title={
                                        "Подтверждено вручную: " +
                                        (o.manualFraudBy || "?") +
                                        (o.manualFraudAt
                                          ? " · " + fmtMs(o.manualFraudAt)
                                          : "")
                                      }
                                    >
                                      ✓ фрод
                                    </Badge>
                                  )}
                                  {mark === "notfraud" && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] border-emerald-400 text-emerald-700 bg-emerald-50"
                                      title={
                                        "Снято как ложное срабатывание: " +
                                        (o.manualFraudBy || "?") +
                                        (o.manualFraudAt
                                          ? " · " + fmtMs(o.manualFraudAt)
                                          : "")
                                      }
                                    >
                                      ✗ не фрод
                                    </Badge>
                                  )}
                                  {/* Кнопки обучения системы. Показываем только
                                      когда заказ помечен авто-системой ИЛИ уже
                                      имеет ручную отметку — нет смысла
                                      «подтверждать» нейтральный заказ. */}
                                  {(o.autoFraud || mark) && me && (
                                    <span className="inline-flex border rounded overflow-hidden">
                                      <button
                                        type="button"
                                        disabled={busyMark || mark === "fraud"}
                                        onClick={() =>
                                          markMut.mutate({
                                            orderId: o.orderId,
                                            subjectType: "driver",
                                            subjectId: String(o.driverId),
                                            isFraud: true,
                                          })
                                        }
                                        className={
                                          "px-1.5 py-0.5 text-[10px] " +
                                          (mark === "fraud"
                                            ? "bg-red-600 text-white"
                                            : "bg-white hover:bg-red-50 text-red-700") +
                                          " disabled:opacity-60"
                                        }
                                        title="Подтвердить: это реальный фрод (система запомнит)"
                                        data-testid={`btn-mark-fraud-${o.orderId}`}
                                      >
                                        ✓
                                      </button>
                                      <button
                                        type="button"
                                        disabled={busyMark || mark === "notfraud"}
                                        onClick={() =>
                                          markMut.mutate({
                                            orderId: o.orderId,
                                            subjectType: "driver",
                                            subjectId: String(o.driverId),
                                            isFraud: false,
                                          })
                                        }
                                        className={
                                          "px-1.5 py-0.5 text-[10px] border-l " +
                                          (mark === "notfraud"
                                            ? "bg-emerald-600 text-white"
                                            : "bg-white hover:bg-emerald-50 text-emerald-700") +
                                          " disabled:opacity-60"
                                        }
                                        title="Снять подозрение: это НЕ фрод (система запомнит, чтобы в следующий раз не помечать аналогичные)"
                                        data-testid={`btn-mark-notfraud-${o.orderId}`}
                                      >
                                        ✗
                                      </button>
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>

                {/* Decision footer */}
                <Card className="p-3 sticky bottom-2 z-10 bg-background border-2">
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Комментарий к решению (что выявлено / какое действие предпринято)…"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={2}
                      data-testid="textarea-comment"
                    />
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bonuses}
                        onChange={(e) => setBonuses(e.target.checked)}
                        data-testid="checkbox-bonuses"
                      />
                      Применены бонусы / штраф к водителю
                    </label>
                    {errorMsg && (
                      <div className="text-sm text-red-600">{errorMsg}</div>
                    )}
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        onClick={() => decideOnDriver("confirmed")}
                        disabled={busy}
                        className="bg-red-600 hover:bg-red-700 text-white"
                        data-testid="btn-confirm"
                      >
                        ✓ Подтвердить фрод
                      </Button>
                      <Button
                        onClick={() => decideOnDriver("rejected")}
                        disabled={busy}
                        className="bg-green-600 hover:bg-green-700 text-white"
                        data-testid="btn-reject"
                      >
                        ✗ Не подтвердился
                      </Button>
                      <Button
                        onClick={() => decideOnDriver("unclear")}
                        disabled={busy}
                        variant="outline"
                        data-testid="btn-unclear"
                      >
                        ? Неясно
                      </Button>
                      <Button
                        onClick={selectNext}
                        disabled={busy}
                        variant="ghost"
                        data-testid="btn-skip"
                        className="ml-auto"
                      >
                        Пропустить →
                      </Button>
                    </div>
                  </div>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Модалка «История разборов»: что проверялось, кто, какой вердикт */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              История разборов
              <span className="ml-2 font-normal text-base text-muted-foreground">
                · {currentDriverCases[0]?.subjectName ?? selectedDriverId} ·{" "}
                {currentDriverCases.length}{" "}
                {currentDriverCases.length === 1 ? "разбор" : "разборов"}
              </span>
            </DialogTitle>
          </DialogHeader>
          {currentDriverCases.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              По этому водителю ещё нет закрытых разборов.
            </div>
          ) : (
            <div className="space-y-4">
              {currentDriverCases.map((c) => {
                const resBadge =
                  c.resolution === "confirmed"
                    ? { cls: "bg-red-600 text-white", label: "✓ Подтверждён фрод" }
                    : c.resolution === "rejected"
                      ? { cls: "bg-green-600 text-white", label: "✗ Не подтвердился" }
                      : c.resolution === "unclear"
                        ? { cls: "bg-gray-400 text-white", label: "? Неясно" }
                        : { cls: "bg-gray-200 text-gray-800", label: "—" };
                const closedAt = c.closedAt ?? c.updatedAt;
                const checker =
                  c.closedByName ?? c.assigneeName ?? c.closedById ?? c.assigneeId ?? "—";
                return (
                  <div
                    key={c.id}
                    className="border rounded-md p-3 bg-card"
                    data-testid={`history-case-${c.id}`}
                  >
                    {/* Шапка: дата + проверяющий + вердикт */}
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="text-sm">
                        <div className="font-medium">
                          {closedAt
                            ? new Date(closedAt).toLocaleString("ru-RU")
                            : "—"}
                        </div>
                        <div className="text-muted-foreground">
                          Проверял: <span className="text-foreground">{checker}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {c.bonusesApplied && (
                          <Badge variant="outline" className="border-amber-400 text-amber-700">
                            бонусы/штраф применены
                          </Badge>
                        )}
                        <Badge className={resBadge.cls}>{resBadge.label}</Badge>
                      </div>
                    </div>

                    {/* Что проверялось — signals */}
                    <div className="mt-3">
                      <div className="text-xs uppercase text-muted-foreground mb-1">
                        Что проверялось
                      </div>
                      {c.signals && c.signals.length > 0 ? (
                        <ul className="space-y-1">
                          {c.signals.map((s, i) => (
                            <li
                              key={i}
                              className="flex items-start gap-2 text-sm"
                            >
                              <span
                                className={
                                  "shrink-0 inline-block text-[10px] uppercase rounded px-1.5 py-0.5 border " +
                                  sevBadgeClass(
                                    (s.severity as any) ?? "low",
                                  )
                                }
                              >
                                {sevLabel((s.severity as any) ?? "low")}
                              </span>
                              <span>{s.label ?? s.code ?? "—"}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          Сигналы не сохранены.
                        </div>
                      )}
                    </div>

                    {/* Вердикт-комментарий (что написал проверяющий) */}
                    {c.resolutionNote && c.resolutionNote.trim() && (
                      <div className="mt-3">
                        <div className="text-xs uppercase text-muted-foreground mb-1">
                          Комментарий к вердикту
                        </div>
                        <div className="text-sm whitespace-pre-wrap rounded bg-muted/50 px-2 py-1.5">
                          {c.resolutionNote}
                        </div>
                      </div>
                    )}

                    {/* Лента доп. комментариев */}
                    {c.comments && c.comments.length > 0 && (
                      <div className="mt-3">
                        <div className="text-xs uppercase text-muted-foreground mb-1">
                          Комментарии ({c.comments.length})
                        </div>
                        <div className="space-y-1">
                          {c.comments.map((cm) => (
                            <div
                              key={cm.id}
                              className="text-sm border-l-2 border-muted pl-2"
                            >
                              <div className="text-xs text-muted-foreground">
                                {cm.authorName} ·{" "}
                                {new Date(cm.at).toLocaleString("ru-RU")}
                              </div>
                              <div className="whitespace-pre-wrap">{cm.text}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Ссылка на полный кейс */}
                    <div className="mt-3 text-right">
                      <Link
                        href={`/wb/cases/${c.id}`}
                        className="text-xs text-primary underline"
                      >
                        Открыть кейс целиком →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </WbShell>
  );
}
