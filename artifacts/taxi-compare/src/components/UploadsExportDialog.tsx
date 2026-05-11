// UploadsExportDialog — отчёт «всё по импорту скриншотов» в Excel (T008).
// Бэкенд: /api/newstat/parsing/uploads.xlsx?from=YYYY-MM-DD&to=YYYY-MM-DD
// Лист 1 «Загрузки»  (1 строка = 1 скриншот, мета: id, IP, канал, jpg, время)
// Лист 2 «По IP»     (агрегат: всего, дни, first/last seen, % suspicious)
// Лист 3 «По дням × IP»  (pivot для графика активности)
// Лист 4 «По каналам»    (split по source: screenshot-auto / import / form)
// Лист 5 «Дубликаты jpg» (если один и тот же jpg попал в pipeline более 1 раза)
//
// Auth: то же что и ParsingExportDialog — Bearer newstat, SSO-мост при отсутствии.

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, Users, Download } from "lucide-react";
import { getToken, setToken, newstatApi } from "@/newstat/lib/api";

const MAX_DAYS = 31;

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function localDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function daysBetweenInclusive(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / 86400000) + 1;
}

async function ensureNewstatToken(): Promise<string | null> {
  const existing = getToken();
  if (existing) return existing;
  try {
    const r = await newstatApi.sso();
    if (r.ok && r.data?.token) {
      setToken(r.data.token);
      return r.data.token;
    }
  } catch {
    /* ignore */
  }
  return null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

interface SuccessMeta {
  rows: number;
  ips: number;
  sources: number;
}

export default function UploadsExportDialog({ open, onOpenChange }: Props) {
  const [from, setFrom] = useState<string>(localDaysAgo(7));
  const [to, setTo] = useState<string>(todayLocal());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<SuccessMeta | null>(null);

  const span = from && to ? daysBetweenInclusive(from, to) : NaN;
  const spanInvalid = !Number.isFinite(span) || span < 1 || span > MAX_DAYS;

  async function handleDownload() {
    setError(null);
    setMeta(null);
    if (!from || !to) {
      setError("Укажите даты с/по");
      return;
    }
    if (from > to) {
      setError("Дата «с» не может быть позже «по»");
      return;
    }
    if (!Number.isFinite(span) || span > MAX_DAYS) {
      setError(`Слишком широкий диапазон: ${span} дн. Максимум — ${MAX_DAYS}.`);
      return;
    }
    setLoading(true);
    try {
      const token = await ensureNewstatToken();
      if (!token) {
        throw new Error("Нет доступа: войдите как админ/антифрод (страница /newstat).");
      }
      const url = `/api/newstat/parsing/uploads.xlsx?from=${encodeURIComponent(
        from,
      )}&to=${encodeURIComponent(to)}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.status === 401) {
        setToken(null);
        throw new Error("Сессия newstat истекла. Войдите заново.");
      }
      if (!resp.ok) {
        let msg = `HTTP ${resp.status}`;
        try {
          const j = await resp.json();
          if (j?.error) msg += ` — ${j.error}`;
          if (j?.max_days) msg += ` (max_days=${j.max_days})`;
        } catch {
          /* not json */
        }
        throw new Error(msg);
      }
      const rows = Number(resp.headers.get("X-Total-Rows") ?? "0");
      const ips = Number(resp.headers.get("X-Unique-Ips") ?? "0");
      const sources = Number(resp.headers.get("X-Unique-Sources") ?? "0");
      const blob = await resp.blob();
      const a = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = `uploads-${from}_${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
      setMeta({ rows, ips, sources });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="uploads-export-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Импорт скриншотов: отчёт в Excel
          </DialogTitle>
          <DialogDescription>
            Кто, когда и откуда присылал скриншоты Yandex Go. Файл содержит
            5 листов: построчный список, разбивка по IP, активность по дням,
            каналы поступления и дубликаты исходных jpg. Максимальный
            период — {MAX_DAYS} дней.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="uploads-from" className="text-xs">
              С (дата)
            </Label>
            <Input
              id="uploads-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="input-uploads-from"
              max={to || todayLocal()}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="uploads-to" className="text-xs">
              По (дата)
            </Label>
            <Input
              id="uploads-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="input-uploads-to"
              min={from || undefined}
              max={todayLocal()}
            />
          </div>
        </div>

        {Number.isFinite(span) && (
          <div
            className={`text-[11px] ${spanInvalid ? "text-amber-700" : "text-muted-foreground"}`}
            data-testid="uploads-span-info"
          >
            Период: <b>{span}</b> дн.
            {spanInvalid && span > MAX_DAYS
              ? ` — больше лимита (${MAX_DAYS}).`
              : ""}
          </div>
        )}

        {error && (
          <div
            className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1"
            data-testid="uploads-export-error"
          >
            Ошибка: {error}
          </div>
        )}
        {meta && !error && (
          <div
            className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 space-y-0.5"
            data-testid="uploads-export-success"
          >
            <div>
              Готово. Скриншотов: <b>{meta.rows}</b>
            </div>
            <div>
              Уникальных IP: <b>{meta.ips}</b> · каналов: <b>{meta.sources}</b>
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground leading-snug">
          Поля берутся из самих файлов <code>calib-*.json</code>:
          {" "}
          <code>receivedFromIp</code>, <code>uploadedAt</code>,{" "}
          <code>source</code>. Старые записи без IP помечаются как «—».
        </p>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="btn-uploads-export-cancel"
          >
            Закрыть
          </Button>
          <Button
            onClick={handleDownload}
            disabled={loading || spanInvalid}
            data-testid="btn-uploads-export-download"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-1" />
            )}
            Скачать XLSX
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
