import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WbShell } from "@/components/wb/WbShell";
import { fetchWbCases, type WbCase } from "@/lib/wb-api";
import { useWbCurrentUser } from "@/lib/wb-auth";

type Filter = "my_open" | "all_open" | "my_closed" | "all_closed";

const FILTERS: Array<{ id: Filter; label: string; admin?: boolean }> = [
  { id: "my_open", label: "Мои открытые" },
  { id: "all_open", label: "Все открытые" },
  { id: "my_closed", label: "Мои закрытые" },
  { id: "all_closed", label: "Все закрытые", admin: true },
];

function fmtDt(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm} ${hh}:${mi}`;
}

function maxSeverity(c: WbCase): "low" | "med" | "high" | "critical" | null {
  const order = ["low", "med", "high", "critical"] as const;
  let best: number = -1;
  for (const s of c.signals || []) {
    const i = order.indexOf((s.severity || "low") as any);
    if (i > best) best = i;
  }
  return best === -1 ? null : order[best];
}

function SeverityBadge({ sev }: { sev: ReturnType<typeof maxSeverity> }) {
  if (!sev) return <span className="text-xs text-muted-foreground">—</span>;
  const cls =
    sev === "critical"
      ? "bg-red-600 text-white"
      : sev === "high"
        ? "bg-red-100 text-red-800 border border-red-300"
        : sev === "med"
          ? "bg-orange-100 text-orange-800 border border-orange-300"
          : "bg-yellow-50 text-yellow-800 border border-yellow-200";
  const label =
    sev === "critical" ? "крит" : sev === "high" ? "выс" : sev === "med" ? "сред" : "низ";
  return <span className={`text-[10px] uppercase rounded px-1.5 py-0.5 ${cls}`}>{label}</span>;
}

function ResolutionBadge({ r }: { r: WbCase["resolution"] }) {
  if (!r) return null;
  const map = {
    confirmed: { label: "подтверждён", cls: "bg-red-600 text-white" },
    rejected: { label: "отклонён", cls: "bg-green-600 text-white" },
    unclear: { label: "неясно", cls: "bg-gray-500 text-white" },
  } as const;
  const m = map[r];
  return <span className={`text-[10px] uppercase rounded px-1.5 py-0.5 ${m.cls}`}>{m.label}</span>;
}

export default function WbCasesPage() {
  const me = useWbCurrentUser();
  // Дефолт — «все открытые». «Мои» оставляем кнопкой; антифродер обычно
  // хочет видеть весь open-пул, чтобы быстро брать новые без ожидания пинга.
  const [filter, setFilter] = useState<Filter>("all_open");

  const q = useQuery({
    queryKey: ["wb", "cases", filter, me?.id || ""],
    queryFn: () => {
      switch (filter) {
        case "my_open":
          return fetchWbCases({ status: "open", assignee: "me" });
        case "all_open":
          return fetchWbCases({ status: "open" });
        case "my_closed":
          return fetchWbCases({ status: "closed", assignee: "me" });
        case "all_closed":
          return fetchWbCases({ status: "closed" });
      }
    },
    refetchInterval: 30_000,
    enabled: !!me,
  });

  return (
    <WbShell>
      <div className="container mx-auto px-4 max-w-[1400px] py-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-semibold">Кейсы антифрода</h1>
          <div className="text-sm text-muted-foreground">
            {me ? `${me.displayName} · ${me.role === "admin" ? "админ" : "антифрод"}` : ""}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {FILTERS.filter((f) => !f.admin || me?.role === "admin").map((f) => (
            <Button
              key={f.id}
              variant={filter === f.id ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f.id)}
              data-testid={`filter-${f.id}`}
            >
              {f.label}
            </Button>
          ))}
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">Объект</th>
                  <th className="px-3 py-2">Сигналы</th>
                  <th className="px-3 py-2 text-right">Score</th>
                  <th className="px-3 py-2">Статус</th>
                  <th className="px-3 py-2">Исполнитель</th>
                  <th className="px-3 py-2">Взят / закрыт</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {q.isLoading && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                      Загрузка…
                    </td>
                  </tr>
                )}
                {q.error && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-red-600">
                      Ошибка: {(q.error as Error).message}
                    </td>
                  </tr>
                )}
                {q.data && q.data.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                      Кейсов не найдено
                    </td>
                  </tr>
                )}
                {q.data?.map((c) => {
                  const sev = maxSeverity(c);
                  const isClosed = c.status === "closed";
                  // Полные карточки /wb/driver/:id и /wb/client/:id доступны только
                  // админу (см. App.tsx). Антифроду показываем ID просто текстом —
                  // вся работа по subject делается внутри карточки кейса.
                  const canDrillSubject = me?.role === "admin";
                  const subjectHref =
                    c.subjectType === "driver"
                      ? `/wb/driver/${encodeURIComponent(c.subjectId)}`
                      : `/wb/client/${encodeURIComponent(c.subjectId)}`;
                  // Для закрытых кейсов «исполнитель» — это тот, кто закрыл
                  // (а не тот, кто когда-то взял). Для open — текущий assignee.
                  const performer = isClosed
                    ? (c.closedByName || "—")
                    : (c.assigneeName || "—");
                  return (
                    <tr
                      key={c.id}
                      className={
                        "border-t hover:bg-muted/30 " +
                        (isClosed ? "opacity-70" : "")
                      }
                      data-testid={`case-row-${c.id}`}
                    >
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            {c.subjectType === "driver" ? "водитель" : "клиент"}
                          </Badge>
                          {canDrillSubject ? (
                            <Link
                              href={subjectHref}
                              className="text-primary hover:underline font-medium"
                            >
                              {c.subjectId}
                            </Link>
                          ) : (
                            <span className="font-medium" data-testid={`case-subject-${c.id}`}>
                              {c.subjectId}
                            </span>
                          )}
                        </div>
                        {c.subjectName && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {c.subjectName}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center gap-1 mb-1">
                          <SeverityBadge sev={sev} />
                          <span className="text-xs text-muted-foreground">
                            ({c.signals?.length || 0})
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-2 max-w-md">
                          {(c.signals || []).map((s) => s.label).filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-right font-bold">
                        {c.score ?? "—"}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {isClosed ? (
                          <div className="space-y-1">
                            <span
                              className="inline-block text-[10px] uppercase rounded px-1.5 py-0.5 bg-emerald-600 text-white"
                              data-testid={`badge-resolved-${c.id}`}
                            >
                              разобран
                            </span>
                            <div>
                              <ResolutionBadge r={c.resolution} />
                            </div>
                            {c.bonusesApplied && (
                              <Badge variant="secondary" className="text-[10px]">
                                бонусы
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-orange-700 font-medium">в работе</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-xs">
                        {performer}
                      </td>
                      <td className="px-3 py-2 align-top text-xs whitespace-nowrap">
                        {isClosed ? fmtDt(c.closedAt) : fmtDt(c.takenAt)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Link href={`/wb/cases/${c.id}`}>
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`btn-open-${c.id}`}
                          >
                            {isClosed ? "Просмотр" : "Открыть →"}
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </WbShell>
  );
}
