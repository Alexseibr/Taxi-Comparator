// Страница «Статистика водителя/загрузчика».
// Берёт агрегаты с /api/screens/operators-stats (тот же endpoint, что
// AdminOperatorStats), находит свою строку по имени оператора (login
// или displayName WbUser, или последний введённый в диалог в LS) и
// показывает большие карточки сегодня/неделя/месяц + ранг среди всех.

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Loader2, RefreshCw, Camera, Trophy, Calendar, AlertCircle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWbCurrentUser } from "@/lib/wb-auth";
import { wbLogout } from "@/lib/wb-api";
import { fetchOperatorStats, type OperatorStatsRow } from "@/lib/screens-server";

const LS_LAST_OPERATOR = "rwb_last_operator";

function fmtAge(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  return `${d} д назад`;
}

function pluralScreens(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "скрин";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "скрина";
  return "скринов";
}

export default function UploaderStatsPage() {
  const me = useWbCurrentUser();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<OperatorStatsRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetchOperatorStats();
      if (!r.ok) {
        setErr(r.error);
        setRows([]);
      } else {
        setRows(r.operators);
        setGeneratedAt(r.generatedAt);
      }
    } catch (e) {
      setErr((e as Error).message || "network_error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => void reload(), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Кандидаты на «моё имя оператора» по убыванию приоритета:
  // 1. displayName из WbUser, 2. login, 3. последний введённый в диалог.
  const candidates = useMemo(() => {
    const c: string[] = [];
    if (me?.displayName) c.push(me.displayName.trim());
    if (me?.login) c.push(me.login.trim());
    try {
      const last = localStorage.getItem(LS_LAST_OPERATOR);
      if (last) c.push(last.trim());
    } catch {
      /* ignore */
    }
    return c.filter(Boolean).map((s) => s.toLowerCase());
  }, [me?.displayName, me?.login]);

  const myRow = useMemo<OperatorStatsRow | null>(() => {
    if (!rows.length || !candidates.length) return null;
    for (const cand of candidates) {
      const hit = rows.find((r) => r.name.toLowerCase() === cand);
      if (hit) return hit;
    }
    return null;
  }, [rows, candidates]);

  // Ранг среди всех операторов по неделе (1 = больше всех загрузил).
  const rank = useMemo(() => {
    if (!myRow || !rows.length) return null;
    const sorted = [...rows].sort((a, b) => b.week - a.week);
    const idx = sorted.findIndex((r) => r.name.toLowerCase() === myRow.name.toLowerCase());
    return idx >= 0 ? { place: idx + 1, of: sorted.length } : null;
  }, [rows, myRow]);

  const handleLogout = async () => {
    try {
      await wbLogout();
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-blue-50 to-white"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="max-w-md mx-auto px-4 py-6 space-y-5">
        {/* Хедер с приветствием и кнопкой выйти */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Привет,</div>
            <div className="text-xl font-bold leading-tight" data-testid="text-greeting">
              {me?.displayName || me?.login || "загрузчик"}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {me?.role === "uploader" ? "Загрузчик" : me?.role || ""}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="text-muted-foreground"
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4 mr-1" />
            Выйти
          </Button>
        </div>

        {/* Большая кнопка «Сделать скрин» — ссылка на главную карту, где FAB */}
        <Link href="/pryan">
          <a
            className="block w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-2xl py-5 px-6 text-center shadow-lg transition-colors"
            data-testid="button-go-upload"
          >
            <Camera className="h-8 w-8 mx-auto mb-2" />
            <div className="text-lg font-bold">Загрузить скрины</div>
            <div className="text-xs text-blue-100 mt-1">
              Открыть карту и нажать на фото-кнопку
            </div>
          </a>
        </Link>

        {/* Статус загрузки/ошибки */}
        {loading && !rows.length && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" /> Загружаем статистику…
          </div>
        )}
        {err && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 text-sm">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-red-700">Не удалось загрузить</div>
              <div className="text-xs text-red-600 mt-0.5">{err}</div>
            </div>
          </div>
        )}

        {/* Карточки счётчиков */}
        {myRow && (
          <div className="grid grid-cols-3 gap-2" data-testid="grid-counters">
            <CounterCard label="Сегодня" value={myRow.today} accent="blue" />
            <CounterCard label="За неделю" value={myRow.week} accent="emerald" />
            <CounterCard label="За месяц" value={myRow.month} accent="amber" />
          </div>
        )}

        {/* Рейтинг */}
        {myRow && rank && (
          <div
            className="bg-white border rounded-2xl p-4 flex items-center gap-3 shadow-sm"
            data-testid="card-rank"
          >
            <div className="bg-amber-100 text-amber-700 rounded-full p-3">
              <Trophy className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold">
                Место {rank.place} из {rank.of}
              </div>
              <div className="text-xs text-muted-foreground">
                по числу скринов за неделю
              </div>
            </div>
          </div>
        )}

        {/* Последняя активность */}
        {myRow && (
          <div
            className="bg-white border rounded-2xl p-4 flex items-center gap-3 shadow-sm"
            data-testid="card-last-activity"
          >
            <div className="bg-blue-100 text-blue-700 rounded-full p-3">
              <Calendar className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold">
                Последний скрин {fmtAge(myRow.lastAtIso)}
              </div>
              <div className="text-xs text-muted-foreground">
                Всего за месяц: {myRow.month} {pluralScreens(myRow.month)}
              </div>
            </div>
          </div>
        )}

        {/* Если статистика пришла, но моей строки нет */}
        {!loading && !err && !myRow && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm">
            <div className="font-medium text-yellow-800 mb-1">
              Пока нет загрузок
            </div>
            <div className="text-xs text-yellow-700">
              Загрузите первый скрин — нажмите большую синюю кнопку выше.
              Имя оператора в диалоге должно совпадать с вашим логином (
              <span className="font-mono">{me?.login || "—"}</span>).
            </div>
          </div>
        )}

        {/* Подвал: обновить + время */}
        <div className="flex items-center justify-between pt-2">
          <div className="text-[11px] text-muted-foreground">
            {generatedAt
              ? `Обновлено ${new Date(generatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void reload()}
            disabled={loading}
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
        </div>
      </div>
    </div>
  );
}

function CounterCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "blue" | "emerald" | "amber";
}) {
  const colors = {
    blue: "bg-blue-600 text-white",
    emerald: "bg-emerald-600 text-white",
    amber: "bg-amber-500 text-white",
  }[accent];
  return (
    <div className={`${colors} rounded-2xl p-3 text-center shadow-md`}>
      <div className="text-2xl font-bold tabular-nums leading-none">{value}</div>
      <div className="text-[10px] mt-1 opacity-90">{label}</div>
    </div>
  );
}
