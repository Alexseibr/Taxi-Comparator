import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RefreshCw, MapPin } from "lucide-react";
import {
  ZONES,
  DAYS,
  scheduleDayToType,
  getCurrentScheduleDay,
  type DayType,
  type Zone,
  type ZoneType,
} from "@/lib/zones";
import { fetchRecentCalibs, type RecentCalib } from "@/lib/screens-server";

type Props = {
  open: boolean;
  onClose: () => void;
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestZone(lat: number, lng: number): Zone | null {
  let best: Zone | null = null;
  let bestD = Infinity;
  for (const z of ZONES) {
    const d = haversineKm(lat, lng, z.center[0], z.center[1]);
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best;
}

// Приоритет типа зоны: чем меньше число, тем важнее (выше в списке).
const TYPE_PRIORITY: Record<ZoneType, number> = {
  center: 0,
  "transport-hub": 1,
  mall: 2,
  premium: 3,
  sleeper: 4,
  industrial: 5,
  "airport-out": 6,
  "airport-in": 6,
};

// Какие часы вообще считаем «рабочими» (отфильтруем глухой ночной час).
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function dayOfWeekToType(jsDay: number): DayType {
  // 0 = вс, 6 = сб
  if (jsDay === 0) return "sunday";
  if (jsDay === 6) return "saturday";
  return "weekday";
}

function bucketColor(n: number): { bg: string; border: string; text: string } {
  if (n === 0) return { bg: "bg-red-100", border: "border-red-300", text: "text-red-800" };
  if (n <= 2) return { bg: "bg-orange-100", border: "border-orange-300", text: "text-orange-800" };
  if (n <= 5) return { bg: "bg-yellow-100", border: "border-yellow-300", text: "text-yellow-800" };
  return { bg: "bg-emerald-100", border: "border-emerald-300", text: "text-emerald-800" };
}

function bucketLabel(n: number): string {
  if (n === 0) return "🔴 нет данных";
  if (n <= 2) return "🟠 мало (1–2)";
  if (n <= 5) return "🟡 средне (3–5)";
  return "🟢 надёжно (6+)";
}

type Cell = { zoneId: string; hour: number; n: number };

export function AdminCoverageMap({ open, onClose }: Props) {
  const [calibs, setCalibs] = useState<RecentCalib[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [day, setDay] = useState<DayType>(scheduleDayToType(getCurrentScheduleDay()));

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetchRecentCalibs(200);
      if (!r.ok) {
        setErr(r.error);
        setCalibs([]);
      } else {
        setCalibs(r.items);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Сортируем зоны: важнее → выше.
  const orderedZones = useMemo(
    () =>
      [...ZONES].sort((a, b) => {
        const pa = TYPE_PRIORITY[a.type] ?? 9;
        const pb = TYPE_PRIORITY[b.type] ?? 9;
        if (pa !== pb) return pa - pb;
        return a.nameRu.localeCompare(b.nameRu);
      }),
    [],
  );

  // Аггрегация: zoneId → hour → count, для выбранного типа дня.
  const counts = useMemo(() => {
    const map = new Map<string, Map<number, number>>();
    for (const z of ZONES) map.set(z.id, new Map());
    for (const c of calibs) {
      if (c.fromLat == null || c.fromLng == null || c.hour == null) continue;
      const d = new Date(c.receivedAt);
      if (isNaN(d.getTime())) continue;
      const cDay = dayOfWeekToType(d.getDay());
      if (cDay !== day) continue;
      const z = nearestZone(c.fromLat, c.fromLng);
      if (!z) continue;
      const inner = map.get(z.id)!;
      inner.set(c.hour, (inner.get(c.hour) ?? 0) + 1);
    }
    return map;
  }, [calibs, day]);

  // Сводка по выбранному дню.
  const summary = useMemo(() => {
    const totalCells = ZONES.length * 24;
    let covered = 0;
    let holes = 0;
    let weak = 0;
    let strong = 0;
    const cellList: Cell[] = [];
    for (const z of ZONES) {
      const inner = counts.get(z.id)!;
      for (const h of HOURS) {
        const n = inner.get(h) ?? 0;
        cellList.push({ zoneId: z.id, hour: h, n });
        if (n === 0) holes++;
        else covered++;
        if (n > 0 && n <= 2) weak++;
        if (n >= 6) strong++;
      }
    }
    return { totalCells, covered, holes, weak, strong, cellList };
  }, [counts]);

  // ТОП приоритетов: красные ячейки в самых важных зонах в часы пик.
  const HOT_HOURS = new Set([7, 8, 9, 17, 18, 19, 22, 23]);
  const priorities = useMemo(() => {
    const items: { zone: Zone; hour: number; score: number }[] = [];
    for (const z of orderedZones) {
      const inner = counts.get(z.id)!;
      for (const h of HOURS) {
        if ((inner.get(h) ?? 0) > 0) continue;
        const typeScore = 10 - (TYPE_PRIORITY[z.type] ?? 9);
        const hourScore = HOT_HOURS.has(h) ? 5 : 0;
        items.push({ zone: z, hour: h, score: typeScore + hourScore });
      }
    }
    items.sort((a, b) => b.score - a.score);
    return items.slice(0, 15);
  }, [counts, orderedZones]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            Карта приоритетов: где модели не хватает данных
          </DialogTitle>
          <DialogDescription>
            Зоны × часы для выбранного типа дня. Красные ячейки — там, где
            замеров ещё не было, и модель прогнозирует «вслепую» (по соседям
            или по среднему). Делайте скрины именно из этих зон в эти часы.
          </DialogDescription>
        </DialogHeader>

        {/* Контролы */}
        <div className="flex flex-wrap items-center gap-3 py-2 border-b">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Тип дня:</span>
            {DAYS.map((d) => (
              <button
                key={d.id}
                onClick={() => setDay(d.id)}
                className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                  day === d.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted"
                }`}
                data-testid={`btn-coverage-day-${d.id}`}
              >
                {d.emoji} {d.label}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={load}
            disabled={loading}
            className="gap-1.5 text-xs h-8 ml-auto"
            data-testid="btn-coverage-refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </Button>
        </div>

        {err && (
          <div className="text-xs text-red-600 px-3 py-2">
            Не удалось загрузить замеры: {err}
          </div>
        )}

        {/* Сводка */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-2 text-xs border-b">
          <div className="bg-muted/40 rounded p-2">
            <div className="text-muted-foreground">Всего ячеек</div>
            <div className="text-lg font-semibold">{summary.totalCells}</div>
            <div className="text-[10px] text-muted-foreground">
              {ZONES.length} зон × 24 часа
            </div>
          </div>
          <div className="bg-emerald-50 rounded p-2 border border-emerald-200">
            <div className="text-emerald-700">Покрыто</div>
            <div className="text-lg font-semibold text-emerald-800">
              {summary.covered}{" "}
              <span className="text-xs font-normal">
                ({Math.round((summary.covered / summary.totalCells) * 100)}%)
              </span>
            </div>
            <div className="text-[10px] text-emerald-700">из них надёжных {summary.strong}</div>
          </div>
          <div className="bg-orange-50 rounded p-2 border border-orange-200">
            <div className="text-orange-700">Слабо (1–2)</div>
            <div className="text-lg font-semibold text-orange-800">{summary.weak}</div>
            <div className="text-[10px] text-orange-700">желательно ещё пару скринов</div>
          </div>
          <div className="bg-red-50 rounded p-2 border border-red-200">
            <div className="text-red-700">🔴 Дыр</div>
            <div className="text-lg font-semibold text-red-800">{summary.holes}</div>
            <div className="text-[10px] text-red-700">приоритет №1 для тестера</div>
          </div>
        </div>

        {/* Основная сетка */}
        <div className="flex-1 overflow-auto py-2">
          <table className="text-[10px] border-collapse">
            <thead className="sticky top-0 bg-background z-10">
              <tr>
                <th className="text-left pr-2 pb-1 font-semibold sticky left-0 bg-background z-20 min-w-[160px]">
                  Зона
                </th>
                {HOURS.map((h) => (
                  <th
                    key={h}
                    className={`px-0.5 pb-1 font-mono text-center font-normal w-[22px] ${
                      HOT_HOURS.has(h) ? "text-orange-600 font-semibold" : "text-muted-foreground"
                    }`}
                    title={HOT_HOURS.has(h) ? "Час пик / поздний вечер" : ""}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderedZones.map((z) => {
                const inner = counts.get(z.id)!;
                return (
                  <tr key={z.id} className="hover:bg-muted/20">
                    <td className="pr-2 py-0.5 sticky left-0 bg-background z-10">
                      <div className="text-[11px] font-medium leading-tight truncate max-w-[150px]">
                        {z.nameRu}
                      </div>
                      <div className="text-[9px] text-muted-foreground">{z.type}</div>
                    </td>
                    {HOURS.map((h) => {
                      const n = inner.get(h) ?? 0;
                      const c = bucketColor(n);
                      return (
                        <td
                          key={h}
                          className={`text-center border ${c.border} ${c.bg} ${c.text} font-medium`}
                          title={`${z.nameRu}, ${h}:00 — ${n} замер(ов)`}
                          style={{ width: 22, height: 18 }}
                        >
                          {n > 0 ? n : ""}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ТОП приоритетов */}
        {priorities.length > 0 && (
          <div className="border-t pt-2">
            <div className="text-xs font-semibold mb-1.5 flex items-center gap-1.5">
              🎯 ТОП-{priorities.length} приоритетных дыр (центральные зоны в час пик):
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 text-[11px]">
              {priorities.map((p, i) => (
                <div
                  key={`${p.zone.id}-${p.hour}`}
                  className="flex items-center gap-2 bg-red-50 border border-red-200 rounded px-2 py-1"
                >
                  <span className="text-red-700 font-mono w-6">#{i + 1}</span>
                  <span className="font-mono text-red-900">
                    {String(p.hour).padStart(2, "0")}:00
                  </span>
                  <span className="truncate text-red-900">{p.zone.nameRu}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Легенда */}
        <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground border-t pt-2">
          {[0, 1, 3, 6].map((n) => {
            const c = bucketColor(n);
            return (
              <div
                key={n}
                className={`px-1.5 py-0.5 rounded border ${c.border} ${c.bg} ${c.text}`}
              >
                {bucketLabel(n)}
              </div>
            );
          })}
          <div className="ml-auto">
            Часы пик подсвечены оранжевым в шапке таблицы. Источник: последние{" "}
            {calibs.length} замеров с VPS.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
