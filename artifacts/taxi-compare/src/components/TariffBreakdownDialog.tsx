import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Receipt } from "lucide-react";
import { useTariffBreakdown } from "../lib/useTariffBreakdown";

function fmtSurge(x: number): string {
  return `×${x.toFixed(2)}`;
}

function surgeColor(x: number): string {
  if (x >= 1.3) return "bg-red-500/15 text-red-700 dark:text-red-300";
  if (x >= 1.1) return "bg-orange-500/15 text-orange-700 dark:text-orange-300";
  if (x >= 0.95) return "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300";
  if (x >= 0.85) return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
  return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
}

type Props = {
  controlledOpen?: boolean;
  onControlledOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
};

export function TariffBreakdownDialog({
  controlledOpen,
  onControlledOpenChange,
  hideTrigger,
}: Props = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) onControlledOpenChange?.(v);
    else setInternalOpen(v);
  };
  const T = useTariffBreakdown();
  const dateStr = new Date(T.generatedAt).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-8"
            data-testid="btn-tariff-breakdown"
          >
            <Receipt className="w-3.5 h-3.5 mr-1" />
            Тариф
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Тариф Yandex Go в Минске — анализ скринов</DialogTitle>
          <DialogDescription>
            Регрессия из {T.basedOn.usable} реальных скринов (из {T.basedOn.totalCalibs} калибровок),
            обновлено {dateStr}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[75vh] pr-4">
          <div className="space-y-5 text-sm">
            {/* ── 1. Базовая формула ── */}
            <section>
              <h3 className="font-semibold mb-2 text-base">
                💰 Базовая формула (нормальный спрос)
              </h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-md border p-3 bg-blue-50/50 dark:bg-blue-950/20">
                  <div className="text-xs text-muted-foreground mb-1">Эконом</div>
                  <div className="font-mono text-base">
                    <span className="text-blue-700 dark:text-blue-300 font-bold">
                      {T.baseline.econom.base.toFixed(2)}
                    </span>{" "}
                    +{" "}
                    <span className="text-blue-700 dark:text-blue-300 font-bold">
                      {T.baseline.econom.perMin.toFixed(2)}
                    </span>
                    ×мин
                    {T.baseline.econom.perKm &&
                    T.baseline.econom.perKm > 0 ? (
                      <>
                        {" "}
                        +{" "}
                        <span className="text-blue-700 dark:text-blue-300 font-bold">
                          {T.baseline.econom.perKm.toFixed(2)}
                        </span>
                        ×км
                      </>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    R²={(T.baseline.econom.r2 ?? 0).toFixed(2)}, MAPE=
                    {((T.baseline.econom.mape ?? 0) * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="rounded-md border p-3 bg-violet-50/50 dark:bg-violet-950/20">
                  <div className="text-xs text-muted-foreground mb-1">Комфорт</div>
                  <div className="font-mono text-base">
                    <span className="text-violet-700 dark:text-violet-300 font-bold">
                      {T.baseline.comfort.base.toFixed(2)}
                    </span>{" "}
                    +{" "}
                    <span className="text-violet-700 dark:text-violet-300 font-bold">
                      {T.baseline.comfort.perMin.toFixed(2)}
                    </span>
                    ×мин
                    {T.baseline.comfort.perKm &&
                    T.baseline.comfort.perKm > 0 ? (
                      <>
                        {" "}
                        +{" "}
                        <span className="text-violet-700 dark:text-violet-300 font-bold">
                          {T.baseline.comfort.perKm.toFixed(2)}
                        </span>
                        ×км
                      </>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    R²={(T.baseline.comfort.r2 ?? 0).toFixed(2)}, MAPE=
                    {((T.baseline.comfort.mape ?? 0) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                {T.baseline.econom.perKm && T.baseline.econom.perKm > 0 ? (
                  <>
                    Гибридная 2-факторная регрессия по yellow+red (n=
                    {T.basedOn.yellow + (T.basedOn.red ?? 0)}). Yandex
                    тарифицирует <strong>и время, и километры</strong>: для
                    короткой поездки в центре доминирует perMin, для длинной по
                    трассе — perKm. До v19 perKm подразумевался ≈ 0 — это
                    недооценивало длинные на ±50-80%.
                  </>
                ) : (
                  <>
                    Однофакторная OLS по времени. Модель чистая по
                    yellow-демaнду (n={T.basedOn.yellow}).
                  </>
                )}
              </p>
            </section>

            {/* ── 2. Удельные ── */}
            <section>
              <h3 className="font-semibold mb-2 text-base">
                📐 Удельные ставки (среднее факт/время и факт/км)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-1.5 pr-3">Спрос / класс</th>
                      <th className="py-1.5 pr-3 text-right">BYN/мин</th>
                      <th className="py-1.5 pr-3 text-right">BYN/км</th>
                      <th className="py-1.5 text-right">скорость</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="py-1.5 pr-3">Yellow · Эконом</td>
                      <td className="text-right pr-3 font-mono">
                        {T.averageRates.yellow.econom.perMin.toFixed(2)}
                      </td>
                      <td className="text-right pr-3 font-mono">
                        {T.averageRates.yellow.econom.perKm.toFixed(2)}
                      </td>
                      <td className="text-right font-mono" rowSpan={2}>
                        {T.averageRates.yellow.speedKmh.toFixed(1)} км/ч
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-1.5 pr-3">Yellow · Комфорт</td>
                      <td className="text-right pr-3 font-mono">
                        {T.averageRates.yellow.comfort.perMin.toFixed(2)}
                      </td>
                      <td className="text-right pr-3 font-mono">
                        {T.averageRates.yellow.comfort.perKm.toFixed(2)}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-1.5 pr-3 text-red-700 dark:text-red-300">
                        Red · Эконом
                      </td>
                      <td className="text-right pr-3 font-mono text-red-700 dark:text-red-300">
                        {T.averageRates.red.econom.perMin.toFixed(2)}
                      </td>
                      <td className="text-right pr-3 font-mono text-red-700 dark:text-red-300">
                        {T.averageRates.red.econom.perKm.toFixed(2)}
                      </td>
                      <td className="text-right font-mono" rowSpan={2}>
                        {T.averageRates.red.speedKmh.toFixed(1)} км/ч
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-3 text-red-700 dark:text-red-300">
                        Red · Комфорт
                      </td>
                      <td className="text-right pr-3 font-mono text-red-700 dark:text-red-300">
                        {T.averageRates.red.comfort.perMin.toFixed(2)}
                      </td>
                      <td className="text-right pr-3 font-mono text-red-700 dark:text-red-300">
                        {T.averageRates.red.comfort.perKm.toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Когда Yandex показывает <strong>красный</strong> значок спроса —
                цена выше нашей базовой модели на{" "}
                <Badge
                  variant="outline"
                  className="bg-red-500/10 text-red-700 dark:text-red-300 ml-1"
                >
                  +{Math.round((T.demandMultiplier.red.econom - 1) * 100)}% Эконом
                  / +{Math.round((T.demandMultiplier.red.comfort - 1) * 100)}%
                  Комфорт
                </Badge>
              </p>
            </section>

            {/* ── 3. Сёрдж по часам ── */}
            <section>
              <h3 className="font-semibold mb-2 text-base">
                ⏰ Сёрдж по часам (медиана факт/прогноз_yellow)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-1.5 pr-3">Час</th>
                      <th className="py-1.5 pr-3 text-right">n</th>
                      <th className="py-1.5 pr-3 text-right">Эконом</th>
                      <th className="py-1.5 text-right">Комфорт</th>
                    </tr>
                  </thead>
                  <tbody>
                    {T.byHour.map((h) => (
                      <tr key={h.hour} className="border-b last:border-b-0">
                        <td className="py-1.5 pr-3 font-mono">
                          {String(h.hour).padStart(2, "0")}:00
                        </td>
                        <td className="py-1.5 pr-3 text-right text-muted-foreground">
                          {h.n}
                        </td>
                        <td className="py-1.5 pr-3 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded font-mono text-xs ${surgeColor(h.surgeE)}`}
                          >
                            {fmtSurge(h.surgeE)}
                          </span>
                        </td>
                        <td className="py-1.5 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded font-mono text-xs ${surgeColor(h.surgeC)}`}
                          >
                            {fmtSurge(h.surgeC)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                ⚠️ Утро/обед недопредставлены — 70% скринов сделаны 16–23ч.
              </p>
            </section>

            {/* ── 4. Сёрдж по районам ── */}
            <section>
              <h3 className="font-semibold mb-2 text-base">
                📍 Сёрдж по районам подачи
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-1.5 pr-3">Улица</th>
                      <th className="py-1.5 pr-3 text-right">n</th>
                      <th className="py-1.5 pr-3 text-right">Эконом</th>
                      <th className="py-1.5 pr-3 text-right">Комфорт</th>
                      <th className="py-1.5 text-right">ср.час</th>
                    </tr>
                  </thead>
                  <tbody>
                    {T.byDistrict.map((d) => (
                      <tr key={d.street} className="border-b last:border-b-0">
                        <td className="py-1.5 pr-3">{d.street}</td>
                        <td className="py-1.5 pr-3 text-right text-muted-foreground">
                          {d.n}
                        </td>
                        <td className="py-1.5 pr-3 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded font-mono text-xs ${surgeColor(d.surgeE)}`}
                          >
                            {fmtSurge(d.surgeE)}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded font-mono text-xs ${surgeColor(d.surgeC)}`}
                          >
                            {fmtSurge(d.surgeC)}
                          </span>
                        </td>
                        <td className="py-1.5 text-right text-muted-foreground font-mono">
                          {String(d.avgHour).padStart(2, "0")}:00
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                «Сёрдж» здесь = во сколько раз реальная цена в районе отличается
                от прогноза baseline-модели по времени поездки. <strong>×1.0</strong> = по
                модели, <strong>×1.3</strong> = на 30% дороже, <strong>×0.8</strong> = на
                20% дешевле.
              </p>
            </section>

            {/* ── 5. Слабая модель по км ── */}
            <section>
              <h3 className="font-semibold mb-2 text-base">
                🔻 Если время неизвестно — модель по км (слабая)
              </h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-md border p-2.5 text-xs">
                  <div className="text-muted-foreground mb-0.5">Эконом</div>
                  <div className="font-mono">
                    {T.perKmFallback.econom.base.toFixed(2)} +{" "}
                    {T.perKmFallback.econom.perKm.toFixed(2)} × км
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    R²={T.perKmFallback.econom.r2.toFixed(2)} (плохо)
                  </div>
                </div>
                <div className="rounded-md border p-2.5 text-xs">
                  <div className="text-muted-foreground mb-0.5">Комфорт</div>
                  <div className="font-mono">
                    {T.perKmFallback.comfort.base.toFixed(2)} +{" "}
                    {T.perKmFallback.comfort.perKm.toFixed(2)} × км
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    R²={T.perKmFallback.comfort.r2.toFixed(2)} (плохо)
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                R² в 4 раза хуже чем по времени — пользоваться только когда
                tripMin неизвестен.
              </p>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
