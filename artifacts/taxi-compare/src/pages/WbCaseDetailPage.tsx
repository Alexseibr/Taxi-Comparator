import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { WbShell } from "@/components/wb/WbShell";
import {
  addWbCaseComment,
  fetchWbCase,
  fetchWbOrders,
  releaseWbCase,
  setWbFraudMark,
  updateWbCase,
  type WbCase,
  type WbOrder,
} from "@/lib/wb-api";
import { useWbCurrentUser } from "@/lib/wb-auth";

function fmtDt(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtIsoShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return fmtDt(t);
}

function sevClass(s: string): string {
  switch (s) {
    case "critical": return "bg-red-600 text-white";
    case "high": return "bg-red-100 text-red-800 border border-red-300";
    case "med": return "bg-orange-100 text-orange-800 border border-orange-300";
    default: return "bg-yellow-50 text-yellow-800 border border-yellow-200";
  }
}

function resolutionLabel(r: WbCase["resolution"]): string {
  if (r === "confirmed") return "Подтверждён";
  if (r === "rejected") return "Отклонён";
  if (r === "unclear") return "Неясно";
  return "Не задано";
}

function resolutionCls(r: WbCase["resolution"]): string {
  if (r === "confirmed") return "bg-red-600 text-white";
  if (r === "rejected") return "bg-green-600 text-white";
  if (r === "unclear") return "bg-gray-500 text-white";
  return "bg-muted text-muted-foreground";
}

export default function WbCaseDetailPage({ id }: { id: string }) {
  const [, setLoc] = useLocation();
  const me = useWbCurrentUser();
  const qc = useQueryClient();
  const { toast } = useToast();

  const q = useQuery({
    queryKey: ["wb", "case", id],
    queryFn: () => fetchWbCase(id),
  });
  const c = q.data;

  // Локальная форма (используется только для open-кейсов)
  const [resolution, setResolution] = useState<WbCase["resolution"]>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [bonusesApplied, setBonusesApplied] = useState(false);
  const [bonusesPeriod, setBonusesPeriod] = useState("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!c) return;
    setResolution(c.resolution);
    setResolutionNote(c.resolutionNote || "");
    setActionTaken(c.actionTaken || "");
    setBonusesApplied(!!c.bonusesApplied);
    setBonusesPeriod(c.bonusesPeriod || "");
  }, [c?.id, c?.updatedAt]);

  const isClosed = c?.status === "closed";
  const isMine = !!c && c.assigneeId === me?.id;
  const canEdit = !isClosed && (isMine || me?.role === "admin");

  const saveMut = useMutation({
    mutationFn: (close: boolean) =>
      updateWbCase(id, {
        resolution: resolution as any || undefined,
        resolutionNote, actionTaken,
        bonusesApplied, bonusesPeriod,
        close,
      }),
    onSuccess: (next) => {
      qc.setQueryData(["wb", "case", id], next);
      qc.invalidateQueries({ queryKey: ["wb", "cases"] });
      toast({ title: "Сохранено" });
    },
    onError: (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });

  const closeMut = useMutation({
    mutationFn: () => {
      if (!resolution) throw new Error("Выберите резолюцию перед закрытием");
      return updateWbCase(id, {
        resolution: resolution as any,
        resolutionNote, actionTaken, bonusesApplied, bonusesPeriod,
        close: true,
      });
    },
    onSuccess: (next) => {
      qc.setQueryData(["wb", "case", id], next);
      qc.invalidateQueries({ queryKey: ["wb", "cases"] });
      toast({ title: "Кейс закрыт" });
      setLoc("/wb/cases");
    },
    onError: (e: Error) => toast({ title: "Не закрыто", description: e.message, variant: "destructive" }),
  });

  const releaseMut = useMutation({
    mutationFn: () => releaseWbCase(id),
    onSuccess: (next) => {
      qc.setQueryData(["wb", "case", id], next);
      qc.invalidateQueries({ queryKey: ["wb", "cases"] });
      toast({ title: "Снято с себя" });
      setLoc("/wb/cases");
    },
    onError: (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });

  const commentMut = useMutation({
    mutationFn: (text: string) => addWbCaseComment(id, text),
    onSuccess: (next) => {
      qc.setQueryData(["wb", "case", id], next);
      setComment("");
    },
    onError: (e: Error) => toast({ title: "Не добавлено", description: e.message, variant: "destructive" }),
  });

  if (q.isLoading) {
    return <WbShell><div className="container mx-auto p-6">Загрузка…</div></WbShell>;
  }
  if (q.error || !c) {
    return (
      <WbShell>
        <div className="container mx-auto p-6">
          <p className="text-red-600">Кейс не найден: {(q.error as Error)?.message || id}</p>
          <Link href="/wb/cases" className="text-primary underline mt-2 inline-block">← К списку</Link>
        </div>
      </WbShell>
    );
  }

  const subjectHref =
    c.subjectType === "driver"
      ? `/wb/driver/${encodeURIComponent(c.subjectId)}`
      : `/wb/client/${encodeURIComponent(c.subjectId)}`;
  // Полная карточка subject доступна только админу (см. App.tsx).
  // Антифроду subjectId показываем как plain text — кейс самодостаточен.
  const canDrillSubject = me?.role === "admin";

  return (
    <WbShell>
      <div className="container mx-auto px-4 max-w-4xl py-4 space-y-4">
        <div>
          <Link href="/wb/cases" className="text-sm text-muted-foreground hover:underline">
            ← К списку кейсов
          </Link>
        </div>

        {/* Заголовок */}
        <Card className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline">
                  {c.subjectType === "driver" ? "Водитель" : "Клиент"}
                </Badge>
                {canDrillSubject ? (
                  <Link href={subjectHref} className="text-xl font-semibold text-primary hover:underline">
                    {c.subjectId}
                  </Link>
                ) : (
                  <span className="text-xl font-semibold" data-testid="case-subject-id">
                    {c.subjectId}
                  </span>
                )}
                {c.subjectName && (
                  <span className="text-xl text-muted-foreground">· {c.subjectName}</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Создан: {fmtDt(c.createdAt)}{" "}
                {c.takenAt && <>· Взят: {fmtDt(c.takenAt)}</>}
              </div>
            </div>
            <div className="text-right">
              {isClosed ? (
                <div>
                  <Badge variant="secondary">Разобран</Badge>
                  <div className="text-xs text-muted-foreground mt-1">
                    {c.closedByName} · {fmtDt(c.closedAt)}
                  </div>
                </div>
              ) : (
                <div>
                  <Badge className="bg-orange-100 text-orange-800 border border-orange-300">
                    В работе
                  </Badge>
                  <div className="text-xs text-muted-foreground mt-1">
                    Исполнитель: {c.assigneeName || "—"}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Snapshot сигналов */}
          {c.signals && c.signals.length > 0 && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">
                Сигналы (snapshot){c.score != null && <> · score: <b>{c.score}</b></>}
              </div>
              <ul className="space-y-0.5">
                {c.signals.map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className={`text-[10px] uppercase rounded px-1 py-0.5 shrink-0 ${sevClass(s.severity || "low")}`}>
                      {s.severity || "—"}
                    </span>
                    <span className="text-sm">{s.label || s.code}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {/* Разобран → плашка вместо формы */}
        {isClosed ? (
          <Card
            className="p-5 border-emerald-300 bg-emerald-50"
            data-testid="card-resolved"
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-600 text-white">Кейс разобран</Badge>
                  <span
                    className={`text-[11px] uppercase rounded px-2 py-0.5 ${resolutionCls(c.resolution)}`}
                    data-testid="badge-resolution"
                  >
                    {resolutionLabel(c.resolution)}
                  </span>
                  {c.bonusesApplied && (
                    <Badge variant="outline" className="text-xs">бонусы применены</Badge>
                  )}
                </div>
                <div className="text-sm">
                  <b>{c.closedByName || "—"}</b> · {fmtDt(c.closedAt)}
                </div>
                {c.actionTaken && (
                  <div className="text-sm">
                    <div className="text-xs uppercase text-muted-foreground mb-0.5">
                      Что было сделано
                    </div>
                    <div className="whitespace-pre-wrap">{c.actionTaken}</div>
                  </div>
                )}
                {c.resolutionNote && (
                  <div className="text-sm">
                    <div className="text-xs uppercase text-muted-foreground mb-0.5">
                      Комментарий к резолюции
                    </div>
                    <div className="whitespace-pre-wrap">{c.resolutionNote}</div>
                  </div>
                )}
                {c.bonusesApplied && c.bonusesPeriod && (
                  <div className="text-xs text-muted-foreground">
                    Период бонусов: {c.bonusesPeriod}
                  </div>
                )}
                <div className="text-xs text-muted-foreground pt-1 border-t border-emerald-200">
                  Повторное открытие не поддерживается. По этому объекту новый
                  кейс не создаётся, пока решение не пересмотрено вручную в файле.
                </div>
              </div>
            </div>
          </Card>
        ) : (
          /* Форма разбора (только для open) */
          <Card className="p-4 space-y-4">
            <h2 className="font-semibold">Разбор</h2>

            <div className="space-y-1.5">
              <Label>Что было сделано</Label>
              <Textarea
                value={actionTaken}
                onChange={(e) => setActionTaken(e.target.value)}
                disabled={!canEdit}
                rows={3}
                placeholder="Например: позвонил клиенту, проверил профиль, заблокировал пару…"
                data-testid="textarea-action"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Резолюция</Label>
              <div className="flex gap-2 flex-wrap">
                {([
                  { v: "confirmed", label: "Подтверждён", cls: "bg-red-600 hover:bg-red-700 text-white" },
                  { v: "rejected", label: "Отклонён", cls: "bg-green-600 hover:bg-green-700 text-white" },
                  { v: "unclear", label: "Неясно", cls: "bg-gray-500 hover:bg-gray-600 text-white" },
                ] as const).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setResolution(opt.v)}
                    className={
                      "px-3 py-1.5 rounded text-sm font-medium transition-colors border " +
                      (resolution === opt.v
                        ? opt.cls + " border-transparent"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50")
                    }
                    data-testid={`btn-resolution-${opt.v}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Комментарий к резолюции</Label>
              <Textarea
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                disabled={!canEdit}
                rows={2}
                placeholder="Подробности решения…"
                data-testid="textarea-resolution-note"
              />
            </div>

            <div className="flex items-start gap-2 pt-1">
              <Checkbox
                id="bonuses"
                checked={bonusesApplied}
                onCheckedChange={(v) => setBonusesApplied(!!v)}
                disabled={!canEdit}
                data-testid="checkbox-bonuses"
              />
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="bonuses" className="font-normal cursor-pointer">
                  Бонусы применены за период
                </Label>
                <Input
                  value={bonusesPeriod}
                  onChange={(e) => setBonusesPeriod(e.target.value)}
                  disabled={!canEdit || !bonusesApplied}
                  placeholder="напр. 15–25 апреля 2026"
                  data-testid="input-bonuses-period"
                />
              </div>
            </div>

            {canEdit && (
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <Button
                  onClick={() => saveMut.mutate(false)}
                  disabled={saveMut.isPending}
                  variant="outline"
                  data-testid="btn-save"
                >
                  {saveMut.isPending ? "Сохраняю…" : "Сохранить"}
                </Button>
                <Button
                  onClick={() => closeMut.mutate()}
                  disabled={!resolution || closeMut.isPending}
                  data-testid="btn-close"
                >
                  {closeMut.isPending ? "Закрываю…" : "Закрыть с резолюцией"}
                </Button>
                {isMine && (
                  <Button
                    onClick={() => releaseMut.mutate()}
                    variant="ghost"
                    disabled={releaseMut.isPending}
                    data-testid="btn-release"
                  >
                    Снять с себя
                  </Button>
                )}
              </div>
            )}
          </Card>
        )}

        {/* Заказы за период (только для driver-кейсов; чекбоксы фрода).
            Когда кейс уже разобран — отдельно подсвечиваем заказы,
            появившиеся ПОСЛЕ закрытия кейса (рецидив / новые попытки),
            а старые «на момент разбора» убираем под коллапс. */}
        {c.subjectType === "driver" && (
          <DriverOrdersSection
            driverId={c.subjectId}
            caseId={c.id}
            disabled={isClosed}
            closedAt={c.closedAt}
            closedByName={c.closedByName}
          />
        )}

        {/* Комментарии */}
        <Card className="p-4 space-y-3">
          <h2 className="font-semibold">Обсуждение ({c.comments?.length || 0})</h2>
          <div className="space-y-2">
            {(c.comments || []).map((cm) => (
              <div key={cm.id} className="text-sm border-l-2 border-primary/30 pl-3 py-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-0.5">
                  <span className="font-medium text-foreground">{cm.authorName}</span>
                  <span>· {fmtDt(cm.at)}</span>
                </div>
                <div className="whitespace-pre-wrap">{cm.text}</div>
              </div>
            ))}
            {(!c.comments || c.comments.length === 0) && (
              <div className="text-xs text-muted-foreground">Комментариев пока нет.</div>
            )}
          </div>
          {!isClosed && (
            <>
              <Separator />
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = comment.trim();
                  if (t) commentMut.mutate(t);
                }}
              >
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  placeholder="Добавить комментарий…"
                  data-testid="textarea-comment"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!comment.trim() || commentMut.isPending}
                  data-testid="btn-add-comment"
                >
                  {commentMut.isPending ? "Отправляю…" : "Отправить"}
                </Button>
              </form>
            </>
          )}
          {isClosed && (
            <div className="text-xs text-muted-foreground italic">
              Кейс разобран — обсуждение закрыто.
            </div>
          )}
        </Card>
      </div>
    </WbShell>
  );
}

// ── Секция «Заказы водителя за период» с чекбоксами ручного фрода ──────────

function isoStartOfDay(daysAgo: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}T00:00:00`;
}
function isoEndOfToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}T23:59:59`;
}

type Period = "7d" | "30d";

function DriverOrdersSection({
  driverId,
  caseId,
  disabled,
  closedAt,
  closedByName,
}: {
  driverId: string;
  caseId: string;
  disabled: boolean;
  closedAt: number | null;
  closedByName: string | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [period, setPeriod] = useState<Period>("7d");
  const range = useMemo(() => {
    if (period === "7d") return { fromTs: isoStartOfDay(7), toTs: isoEndOfToday() };
    return { fromTs: isoStartOfDay(30), toTs: isoEndOfToday() };
  }, [period]);

  const ordersKey = ["wb", "driver-orders", driverId, range.fromTs, range.toTs];
  const q = useQuery({
    queryKey: ordersKey,
    queryFn: () => fetchWbOrders({
      driverId,
      fromTs: range.fromTs,
      toTs: range.toTs,
      withFraudMarks: true,
      limit: 500,
    }),
  });

  const markMut = useMutation({
    mutationFn: (input: { orderId: string; isFraud: boolean }) =>
      setWbFraudMark({
        orderId: input.orderId,
        subjectType: "driver",
        subjectId: driverId,
        isFraud: input.isFraud,
        caseId,
      }),
    // Оптимистичный апдейт: сразу подкрашиваем чекбокс, чтобы не ждать round-trip.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ordersKey });
      const prev = qc.getQueryData<{ ok: true; total: number; items: WbOrder[] }>(ordersKey);
      if (prev) {
        qc.setQueryData(ordersKey, {
          ...prev,
          items: prev.items.map((o) =>
            o.orderId === input.orderId
              ? { ...o, manualFraud: input.isFraud }
              : o,
          ),
        });
      }
      return { prev };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ordersKey, ctx.prev);
      toast({ title: "Не сохранено", description: e.message, variant: "destructive" });
    },
    onSuccess: () => {
      // Параллельно мог обновиться отчёт по водителям — инвалидируем.
      qc.invalidateQueries({ queryKey: ["wb", "driver-fraud-report"] });
    },
  });

  const items = q.data?.items || [];

  // Когда кейс уже разобран — делим заказы по моменту закрытия:
  //   newer = появились ПОСЛЕ разбора (рецидив, новые попытки фрода)
  //   older = были на момент разбора (по ним антифродер уже принял решение)
  // Если кейс ещё открыт (closedAt == null) — split не нужен, показываем
  // плоский список как раньше.
  const split = useMemo(() => {
    if (closedAt == null) return null;
    const newer: WbOrder[] = [];
    const older: WbOrder[] = [];
    for (const o of items) {
      const t = Date.parse(o.createdAt);
      if (Number.isFinite(t) && t > closedAt) newer.push(o);
      else older.push(o);
    }
    return { newer, older };
  }, [items, closedAt]);

  // Старые заказы (на момент разбора) по умолчанию свёрнуты — антифродер
  // уже работал с ними, основное внимание после возврата в кейс — на новые.
  // Если новых нет — раскрываем сразу, чтобы карточка не выглядела пустой.
  const [oldExpanded, setOldExpanded] = useState(false);
  useEffect(() => {
    if (split && split.newer.length === 0) setOldExpanded(true);
  }, [split?.newer.length]);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold">Заказы водителя за период</h2>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={period === "7d" ? "default" : "outline"}
            onClick={() => setPeriod("7d")}
            data-testid="period-7d"
          >
            7 дней
          </Button>
          <Button
            size="sm"
            variant={period === "30d" ? "default" : "outline"}
            onClick={() => setPeriod("30d")}
            data-testid="period-30d"
          >
            30 дней
          </Button>
        </div>
      </div>

      {q.isLoading && (
        <div className="text-sm text-muted-foreground">Загрузка заказов…</div>
      )}
      {q.error && (
        <div className="text-sm text-red-600">
          Ошибка: {(q.error as Error).message}
        </div>
      )}
      {q.data && items.length === 0 && (
        <div className="text-sm text-muted-foreground">
          За {period === "7d" ? "7" : "30"} дней заказов нет.
        </div>
      )}

      {/* Кейс ещё открыт — обычный плоский список заказов. */}
      {items.length > 0 && !split && (
        <OrdersTable
          orders={items}
          highlightNew={false}
          markMut={markMut}
          disabled={disabled}
        />
      )}

      {/* Кейс разобран — split на новые-после-разбора и старые. */}
      {split && (
        <div className="space-y-4">
          {split.newer.length > 0 ? (
            <div
              className="space-y-2"
              data-testid="orders-newer-section"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="inline-flex items-center rounded bg-emerald-600 text-white text-[11px] uppercase font-semibold px-2 py-0.5"
                >
                  🆕 Новые после разбора
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {split.newer.length}
                </span>
                <span className="text-xs text-muted-foreground">
                  · появились после {fmtDt(closedAt)}
                  {closedByName ? ` (разобрал ${closedByName})` : ""}
                </span>
              </div>
              <OrdersTable
                orders={split.newer}
                highlightNew={true}
                markMut={markMut}
                disabled={disabled}
              />
            </div>
          ) : (
            <div
              className="rounded border border-dashed border-emerald-300 bg-emerald-50/40 p-3 text-xs text-emerald-900"
              data-testid="orders-newer-empty"
            >
              ✅ Новых заказов после разбора ({fmtDt(closedAt)}) нет.
            </div>
          )}

          {/* Старые заказы — под раскрывашкой. */}
          <div data-testid="orders-older-section">
            <button
              type="button"
              onClick={() => setOldExpanded((v) => !v)}
              className="w-full flex items-center justify-between text-left rounded border bg-muted/30 hover:bg-muted/50 px-3 py-2 transition-colors"
              data-testid="btn-toggle-old-orders"
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold">
                  📁 На момент разбора
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {split.older.length} заказ
                  {split.older.length === 1 ? "" : split.older.length < 5 ? "а" : "ов"}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {oldExpanded ? "▲ скрыть" : "▼ развернуть"}
              </span>
            </button>
            {oldExpanded && split.older.length > 0 && (
              <div className="mt-2">
                <OrdersTable
                  orders={split.older}
                  highlightNew={false}
                  markMut={markMut}
                  disabled={disabled}
                />
              </div>
            )}
            {oldExpanded && split.older.length === 0 && (
              <div className="mt-2 text-xs text-muted-foreground px-3 py-2">
                На момент разбора заказов в этом периоде не было.
              </div>
            )}
          </div>
        </div>
      )}

      {disabled && (
        <div className="text-xs text-muted-foreground italic">
          Кейс разобран — изменение пометок по старым заказам недоступно.
          Новые заказы (после разбора) тоже только для просмотра — чтобы
          пометить рецидив, заведите новый кейс.
        </div>
      )}
    </Card>
  );
}

// Таблица заказов с чекбоксом ручного фрода. Используется и в режиме
// плоского списка (открытый кейс), и для каждой из секций split-режима
// (новые/старые после разбора). highlightNew подсвечивает фон строки
// зелёным, чтобы новые заказы было видно сразу.
function OrdersTable({
  orders,
  highlightNew,
  markMut,
  disabled,
}: {
  orders: WbOrder[];
  highlightNew: boolean;
  markMut: {
    isPending: boolean;
    mutate: (input: { orderId: string; isFraud: boolean }) => void;
  };
  disabled: boolean;
}) {
  return (
    <div className="overflow-x-auto -mx-4">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr className="text-left text-xs uppercase text-muted-foreground">
            <th className="px-3 py-2">Заказ</th>
            <th className="px-3 py-2">Создан</th>
            <th className="px-3 py-2 text-right">Км</th>
            <th className="px-3 py-2 text-right">GMV</th>
            <th className="px-3 py-2">Статус</th>
            <th className="px-3 py-2">Сигналы</th>
            <th className="px-3 py-2 text-center">Фрод</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const checked = !!o.manualFraud;
            const auto = !!o.autoFraud;
            // Подсветка строки: ручной фрод (красный) > авто-фрод (оранжевый)
            // > новый-после-разбора (зелёный) > обычная.
            const rowCls = checked
              ? "bg-red-50"
              : auto
                ? "bg-orange-50"
                : highlightNew
                  ? "bg-emerald-50"
                  : "";
            return (
              <tr
                key={o.orderId}
                className={`border-t hover:bg-muted/30 ${rowCls}`}
                data-testid={`order-row-${o.orderId}`}
              >
                <td className="px-3 py-2 font-mono text-xs">
                  {highlightNew && (
                    <span
                      className="inline-block text-[9px] uppercase rounded px-1 py-0.5 bg-emerald-600 text-white mr-1.5 align-middle"
                      title="Заказ появился после разбора кейса"
                    >
                      new
                    </span>
                  )}
                  {o.orderId}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {fmtIsoShort(o.createdAt)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {o.km != null ? o.km.toFixed(1) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {o.gmv != null ? o.gmv.toFixed(2) : "—"}
                </td>
                <td className="px-3 py-2">
                  <Badge
                    variant="outline"
                    className={
                      o.status === "completed"
                        ? "bg-green-50 text-green-800 border-green-200 text-[10px]"
                        : o.status === "cancelled"
                          ? "bg-red-50 text-red-800 border-red-200 text-[10px]"
                          : "text-[10px]"
                    }
                  >
                    {o.status === "completed"
                      ? "выполнен"
                      : o.status === "cancelled"
                        ? "отменён"
                        : "открыт"}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  {auto && (
                    <span
                      className="inline-block text-[10px] uppercase rounded px-1.5 py-0.5 bg-orange-200 text-orange-900"
                      data-testid={`badge-auto-${o.orderId}`}
                    >
                      авто-фрод
                    </span>
                  )}
                  {checked && (
                    <span
                      className="inline-block text-[10px] uppercase rounded px-1.5 py-0.5 bg-red-600 text-white ml-1"
                      data-testid={`badge-manual-${o.orderId}`}
                      title={
                        o.manualFraudBy
                          ? `${o.manualFraudBy} · ${fmtDt(o.manualFraudAt || null)}`
                          : ""
                      }
                    >
                      ручной
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  <Checkbox
                    checked={checked}
                    disabled={disabled || markMut.isPending}
                    onCheckedChange={(v) => {
                      markMut.mutate({ orderId: o.orderId, isFraud: !!v });
                    }}
                    data-testid={`checkbox-fraud-${o.orderId}`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
