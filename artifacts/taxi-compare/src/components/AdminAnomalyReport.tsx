// Админ-окно «AI-куратор и аномалии».
// Показывает:
//   1) Сводный отчёт куратора, который раз в час пишет Gemini после калибровки
//      (источник: /data/ai-report.json и /data/ai-report.md, кладёт VPS).
//   2) Список последних замеров с пометкой аномалии (поле RecentCalib.anomaly,
//      проставляет process-screens.mjs сразу после распознавания).
//
// Пишет ТОЛЬКО админ, фронт только читает.

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  X,
  AlertCircle,
  Loader2,
  Bot,
  AlertTriangle,
  Clock,
  CheckCircle2,
} from "lucide-react";
import {
  fetchRecentCalibs,
  type RecentCalib,
  type CalibAnomaly,
} from "@/lib/screens-server";

// ────────── AI-report (отчёт куратора) ──────────
// Файлы кладёт VPS: /var/www/rwbtaxi/dist/public/data/ai-report.{md,json}
// Раздаёт nginx → /data/ai-report.{md,json}.
type CuratorReportJson = {
  generatedAt: string;
  model: string | null;
  summary: string; // 1-2 предложения «здоровья модели»
  highlights: string[]; // ключевые наблюдения
  warnings: string[]; // то что требует внимания
  suggestions: string[]; // конкретные действия (поездки/проверки)
  metrics: {
    datasetSize?: number | null;
    maeE?: number | null;
    maeC?: number | null;
    hitRateE?: number | null; // 0..1
    hitRateC?: number | null;
    suspiciousLast24h?: number | null;
  } | null;
};

function reportUrl(suffix: string): string {
  // base — корень сайта; data/ — публичная папка nginx.
  return `${import.meta.env.BASE_URL}data/ai-report.${suffix}`.replace(
    /\/+/g,
    "/",
  );
}

async function fetchCuratorReport(): Promise<{
  json: CuratorReportJson | null;
  md: string | null;
  error: string | null;
}> {
  const out: {
    json: CuratorReportJson | null;
    md: string | null;
    error: string | null;
  } = { json: null, md: null, error: null };
  try {
    const rj = await fetch(reportUrl("json"), { cache: "no-store" });
    if (rj.ok) {
      try {
        out.json = (await rj.json()) as CuratorReportJson;
      } catch {
        /* битый json — игнор */
      }
    }
  } catch {
    /* offline — ок */
  }
  try {
    const rm = await fetch(reportUrl("md"), { cache: "no-store" });
    if (rm.ok) out.md = await rm.text();
  } catch {
    /* offline — ок */
  }
  if (!out.json && !out.md) {
    out.error = "no_report_yet";
  }
  return out;
}

// ────────── helpers ──────────
function severityBadge(sev: CalibAnomaly["severity"]) {
  switch (sev) {
    case "high":
      return (
        <Badge className="bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-100">
          высокая
        </Badge>
      );
    case "med":
      return (
        <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">
          средняя
        </Badge>
      );
    case "low":
      return (
        <Badge className="bg-sky-100 text-sky-700 border-sky-200 hover:bg-sky-100">
          низкая
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          —
        </Badge>
      );
  }
}

function fmtTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mn = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm} ${hh}:${mn}`;
}

function fmtMoney(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

function categoryLabel(cat: string | null): string {
  switch ((cat || "").trim()) {
    case "price_outlier":
      return "выброс цены";
    case "geocode_mismatch":
      return "адрес/координаты";
    case "vision_doubt":
      return "сомнение Vision";
    case "context_mismatch":
      return "не вяжется с историей";
    case "demand_mismatch":
      return "цвет спроса не сходится";
    default:
      return cat || "—";
  }
}

// ────────── component ──────────
type Props = { open: boolean; onClose: () => void };

export function AdminAnomalyReport({ open, onClose }: Props) {
  const [items, setItems] = useState<RecentCalib[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlySuspicious, setOnlySuspicious] = useState<boolean>(true);
  const [report, setReport] = useState<CuratorReportJson | null>(null);
  const [reportMd, setReportMd] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const [rc, rep] = await Promise.all([
      fetchRecentCalibs(200),
      fetchCuratorReport(),
    ]);
    if (rc.ok) {
      setItems(rc.items);
      setTotal(rc.total);
    } else {
      setError(rc.error);
      setItems([]);
      setTotal(0);
    }
    setReport(rep.json);
    setReportMd(rep.md);
    setReportError(rep.error);
    setLoading(false);
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visible = useMemo(() => {
    if (!onlySuspicious) return items;
    return items.filter((i) => i.anomaly?.suspicious);
  }, [items, onlySuspicious]);

  const stats = useMemo(() => {
    let high = 0,
      med = 0,
      low = 0,
      checked = 0,
      unchecked = 0;
    for (const i of items) {
      if (!i.anomaly) {
        unchecked++;
        continue;
      }
      checked++;
      if (!i.anomaly.suspicious) continue;
      if (i.anomaly.severity === "high") high++;
      else if (i.anomaly.severity === "med") med++;
      else if (i.anomaly.severity === "low") low++;
    }
    return {
      total: items.length,
      checked,
      unchecked,
      suspicious: high + med + low,
      high,
      med,
      low,
    };
  }, [items]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-[min(100vw,1200px)] w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] h-[calc(100vh-2rem)] sm:h-[calc(100vh-4rem)] p-0 overflow-hidden flex flex-col"
        data-testid="dialog-anomaly-report"
      >
        <DialogHeader className="px-4 py-3 border-b shrink-0">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-base flex items-center gap-2">
              <Bot className="w-4 h-4 text-violet-600" />
              AI-куратор и аномалии
            </DialogTitle>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1"
                onClick={load}
                disabled={loading}
                data-testid="btn-anomaly-refresh"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Обновить
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={onClose}
                data-testid="btn-anomaly-close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Сводная панель */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground mt-1.5">
            <span>
              Всего: <b className="text-foreground">{stats.total}</b>
            </span>
            <span>·</span>
            <span>
              Проверено AI:{" "}
              <b className="text-foreground">{stats.checked}</b>
            </span>
            {stats.unchecked > 0 && (
              <span>
                {" "}
                · ждут проверки:{" "}
                <b className="text-amber-700">{stats.unchecked}</b>
              </span>
            )}
            <span>·</span>
            <span>
              Подозрительных:{" "}
              <b
                className={
                  stats.suspicious > 0
                    ? "text-rose-700"
                    : "text-emerald-700"
                }
              >
                {stats.suspicious}
              </b>
              {stats.suspicious > 0 && (
                <>
                  {" "}
                  (
                  <span className="text-rose-700">{stats.high} выс</span>·
                  <span className="text-amber-700">{stats.med} ср</span>·
                  <span className="text-sky-700">{stats.low} низ</span>)
                </>
              )}
            </span>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto px-3 sm:px-4 py-3 space-y-4">
          {/* ─────── Отчёт куратора ─────── */}
          <section
            className="border rounded-lg bg-violet-50/40"
            data-testid="section-curator-report"
          >
            <header className="px-3 py-2 border-b border-violet-200/50 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-violet-900 flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5" />
                Отчёт куратора
              </h3>
              {report?.generatedAt && (
                <span className="text-[10px] text-violet-700 inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {fmtTime(report.generatedAt)}
                  {report.model && (
                    <span className="text-violet-500">· {report.model}</span>
                  )}
                </span>
              )}
            </header>
            <div className="p-3 space-y-2 text-sm">
              {reportError && !report && !reportMd && (
                <div className="text-xs text-muted-foreground italic">
                  Куратор ещё не написал отчёт. Дождитесь следующего часа —
                  AI запускается после калибровки.
                </div>
              )}
              {report?.summary && (
                <p className="text-foreground leading-relaxed">
                  {report.summary}
                </p>
              )}
              {report?.metrics && (
                <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                  {report.metrics.datasetSize != null && (
                    <Badge variant="outline">
                      датасет: {report.metrics.datasetSize}
                    </Badge>
                  )}
                  {report.metrics.maeE != null && (
                    <Badge variant="outline">
                      MAE Эконом: {report.metrics.maeE.toFixed(2)} ₽
                    </Badge>
                  )}
                  {report.metrics.maeC != null && (
                    <Badge variant="outline">
                      MAE Комфорт: {report.metrics.maeC.toFixed(2)} ₽
                    </Badge>
                  )}
                  {report.metrics.hitRateE != null && (
                    <Badge variant="outline">
                      ±10% Эконом:{" "}
                      {Math.round(report.metrics.hitRateE * 100)}%
                    </Badge>
                  )}
                  {report.metrics.hitRateC != null && (
                    <Badge variant="outline">
                      ±10% Комфорт:{" "}
                      {Math.round(report.metrics.hitRateC * 100)}%
                    </Badge>
                  )}
                  {report.metrics.suspiciousLast24h != null && (
                    <Badge
                      variant="outline"
                      className={
                        report.metrics.suspiciousLast24h > 0
                          ? "text-rose-700 border-rose-200"
                          : ""
                      }
                    >
                      аномалий 24ч: {report.metrics.suspiciousLast24h}
                    </Badge>
                  )}
                </div>
              )}
              {report?.highlights && report.highlights.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider mt-2 mb-1">
                    Что хорошо
                  </div>
                  <ul className="list-disc list-inside text-xs space-y-0.5 text-foreground/90">
                    {report.highlights.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
              )}
              {report?.warnings && report.warnings.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-rose-700 uppercase tracking-wider mt-2 mb-1">
                    Что тревожит
                  </div>
                  <ul className="list-disc list-inside text-xs space-y-0.5 text-foreground/90">
                    {report.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {report?.suggestions && report.suggestions.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-violet-700 uppercase tracking-wider mt-2 mb-1">
                    Что сделать
                  </div>
                  <ul className="list-disc list-inside text-xs space-y-0.5 text-foreground/90">
                    {report.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!report && reportMd && (
                <pre className="text-xs whitespace-pre-wrap font-sans text-foreground/90">
                  {reportMd}
                </pre>
              )}
            </div>
          </section>

          {/* ─────── Заказы с аномалиями ─────── */}
          <section data-testid="section-anomalies-list">
            <header className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                Заказы под подозрением
              </h3>
              <label className="text-[11px] inline-flex items-center gap-1.5 cursor-pointer text-muted-foreground">
                <input
                  type="checkbox"
                  checked={onlySuspicious}
                  onChange={(e) => setOnlySuspicious(e.target.checked)}
                  className="h-3.5 w-3.5 accent-rose-600"
                  data-testid="chk-only-suspicious"
                />
                только аномалии
              </label>
            </header>

            {error && (
              <div className="flex items-center gap-2 text-rose-700 text-sm border border-rose-200 bg-rose-50 rounded p-2 mb-2">
                <AlertCircle className="w-4 h-4" />
                Ошибка загрузки: {error}
              </div>
            )}
            {!loading && !error && visible.length === 0 && (
              <div className="text-xs text-muted-foreground italic flex items-center gap-1.5 p-3 border border-dashed rounded">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                {onlySuspicious
                  ? "Аномалий не обнаружено."
                  : "Замеров пока нет."}
              </div>
            )}

            <div className="space-y-1.5">
              {visible.map((c) => {
                const a = c.anomaly;
                const isSus = a?.suspicious === true;
                return (
                  <article
                    key={c.id}
                    className={`border rounded-lg p-2.5 text-xs ${
                      isSus
                        ? a?.severity === "high"
                          ? "border-rose-300 bg-rose-50/40"
                          : a?.severity === "med"
                            ? "border-amber-300 bg-amber-50/40"
                            : "border-sky-300 bg-sky-50/40"
                        : "border-border bg-background"
                    }`}
                    data-testid={`row-anomaly-${c.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">
                          {c.fromAddress}{" "}
                          <span className="text-muted-foreground">→</span>{" "}
                          {c.toAddress}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                          <span>{fmtTime(c.receivedAt)}</span>
                          <span>·</span>
                          <span>
                            E={fmtMoney(c.factE)} ₽ · C={fmtMoney(c.factC)} ₽
                          </span>
                          {c.demand && (
                            <>
                              <span>·</span>
                              <span>спрос: {c.demand}</span>
                            </>
                          )}
                          {c.etaMin != null && (
                            <>
                              <span>·</span>
                              <span>ETA {c.etaMin} мин</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-1">
                        {a ? (
                          severityBadge(a.severity)
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            не проверен
                          </Badge>
                        )}
                      </div>
                    </div>
                    {a && a.suspicious && (
                      <div className="mt-1.5 pt-1.5 border-t border-dashed border-foreground/10 text-[12px] leading-snug">
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                          <Bot className="w-3 h-3" />
                          {a.model || "Gemini"}
                          {a.confidence != null && (
                            <span>
                              · уверенность {Math.round(a.confidence * 100)}%
                            </span>
                          )}
                          {a.category && (
                            <>
                              <span>·</span>
                              <span>{categoryLabel(a.category)}</span>
                            </>
                          )}
                        </div>
                        <div className="text-foreground/90">{a.reason}</div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
