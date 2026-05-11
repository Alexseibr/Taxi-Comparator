// ParsingExportDialog — диалог экспорта в Excel распарсенных скриншотов
// Yandex Go за выбранный период (T007). Источник на бэкенде:
// /api/newstat/parsing/export.xlsx?from=YYYY-MM-DD&to=YYYY-MM-DD
// (читает /var/www/rwbtaxi/data/calib/calib-*.json).
//
// Auth: endpoint защищён newstat-ролью admin/antifraud. Если у пользователя
// нет newstat-токена (он зашёл на /pryan напрямую через WB-сессию), пробуем
// SSO-мост /auth/sso, чтобы получить токен из его же wb-cookie/Bearer.

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
import { Loader2, FileSpreadsheet, Download } from "lucide-react";
import { getToken, setToken, newstatApi } from "@/newstat/lib/api";

const MAX_DAYS = 31;

// Локальные даты (Минск, UTC+3) — НЕ через toISOString(),
// иначе вечером после 21:00 локально получим следующую UTC-дату.
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
    /* ignore — отдадим null, наверху покажем понятную ошибку */
  }
  return null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export default function ParsingExportDialog({ open, onOpenChange }: Props) {
  const [from, setFrom] = useState<string>(localDaysAgo(7));
  const [to, setTo] = useState<string>(todayLocal());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRows, setLastRows] = useState<number | null>(null);

  const span = from && to ? daysBetweenInclusive(from, to) : NaN;
  const spanInvalid = !Number.isFinite(span) || span < 1 || span > MAX_DAYS;

  async function handleDownload() {
    setError(null);
    setLastRows(null);
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
        throw new Error(
          "Нет доступа: войдите как админ/антифрод (страница /newstat).",
        );
      }
      const url = `/api/newstat/parsing/export.xlsx?from=${encodeURIComponent(
        from,
      )}&to=${encodeURIComponent(to)}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.status === 401) {
        // Токен мог протухнуть — сбросим, юзер увидит понятный текст.
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
      const totalRows = Number(resp.headers.get("X-Total-Rows") ?? "0");
      const blob = await resp.blob();
      const a = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = `parsing-${from}_${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Освобождаем blob, но даём браузеру отдать его пользователю.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
      setLastRows(totalRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="parsing-export-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" />
            Экспорт парсинга в Excel
          </DialogTitle>
          <DialogDescription>
            Распарсенные данные со скриншотов Yandex Go за период: дата, время,
            адреса, цены Эконом/Комфорт, ETA подачи, время в пути и расстояние.
            Максимальный период — {MAX_DAYS} дней.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="parsing-from" className="text-xs">
              С (дата)
            </Label>
            <Input
              id="parsing-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="input-parsing-from"
              max={to || todayLocal()}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="parsing-to" className="text-xs">
              По (дата)
            </Label>
            <Input
              id="parsing-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="input-parsing-to"
              min={from || undefined}
              max={todayLocal()}
            />
          </div>
        </div>

        {Number.isFinite(span) && (
          <div
            className={`text-[11px] ${spanInvalid ? "text-amber-700" : "text-muted-foreground"}`}
            data-testid="parsing-span-info"
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
            data-testid="parsing-export-error"
          >
            Ошибка: {error}
          </div>
        )}
        {lastRows !== null && !error && (
          <div
            className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1"
            data-testid="parsing-export-success"
          >
            Готово. Скриншотов в файле: <b>{lastRows}</b>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground leading-snug">
          Подсказка: ETA подачи в скриншоте Yandex Go — одно значение для
          активного тарифа, поэтому в колонках «Эконом ETA» и «Комфорт ETA»
          выводится одинаковое число.
        </p>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="btn-parsing-export-cancel"
          >
            Закрыть
          </Button>
          <Button
            onClick={handleDownload}
            disabled={loading || spanInvalid}
            data-testid="btn-parsing-export-download"
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
