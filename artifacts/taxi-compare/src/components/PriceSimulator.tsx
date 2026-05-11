import { useMemo, useState } from "react";
import { Calculator, ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BASE_TARIFF,
  SURGE_BOUNDS,
  finalPrice,
  type TaxiClass,
} from "@/lib/zones";

const CLASS_LABELS: Record<TaxiClass, string> = {
  econom: "Эконом",
  comfort: "Комфорт",
};

function fmt(n: number, d = 2) {
  return n.toFixed(d);
}

interface PriceSimulatorProps {
  controlledOpen?: boolean;
  onControlledOpenChange?: (v: boolean) => void;
  hideTrigger?: boolean;
}

export default function PriceSimulator({
  controlledOpen,
  onControlledOpenChange,
  hideTrigger,
}: PriceSimulatorProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onControlledOpenChange ?? setInternalOpen;
  const [km, setKm] = useState(5);
  const [min, setMin] = useState(10);
  const [cls, setCls] = useState<TaxiClass>("comfort");
  const [surge, setSurge] = useState(1.0);

  const result = useMemo(
    () => finalPrice(cls, km, min, surge),
    [cls, km, min, surge],
  );
  const tariff = BASE_TARIFF[cls];

  const surgeArrow =
    surge > 1.05 ? (
      <ArrowUp className="w-3 h-3 text-rose-600" />
    ) : surge < 0.95 ? (
      <ArrowDown className="w-3 h-3 text-emerald-600" />
    ) : (
      <Minus className="w-3 h-3 text-slate-500" />
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-xs h-8"
          data-testid="button-open-simulator"
        >
          <Calculator className="w-3.5 h-3.5" />
          Калькулятор
        </Button>
      </DialogTrigger>
      )}
      <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Калькулятор тарифа RWB Taxi</DialogTitle>
          <DialogDescription>
            Калибровка v3: плоская база 10 br × сёрдж (×{SURGE_BOUNDS.min.toFixed(1)}…×
            {SURGE_BOUNDS.max.toFixed(1)}). У Yandex весь рост цены идёт через сёрдж — длина и время маршрута уже зашиты в ⚡N.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Inputs */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="sim-km" className="text-xs">
                Расстояние, км
              </Label>
              <Input
                id="sim-km"
                type="number"
                step="0.1"
                min="0"
                value={km}
                onChange={(e) => setKm(Math.max(0, Number(e.target.value) || 0))}
                data-testid="input-sim-km"
              />
            </div>
            <div>
              <Label htmlFor="sim-min" className="text-xs">
                Время, мин
              </Label>
              <Input
                id="sim-min"
                type="number"
                step="1"
                min="0"
                value={min}
                onChange={(e) =>
                  setMin(Math.max(0, Number(e.target.value) || 0))
                }
                data-testid="input-sim-min"
              />
            </div>
            <div>
              <Label htmlFor="sim-cls" className="text-xs">
                Класс
              </Label>
              <Select
                value={cls}
                onValueChange={(v) => setCls(v as TaxiClass)}
              >
                <SelectTrigger id="sim-cls" data-testid="select-sim-cls">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(BASE_TARIFF) as TaxiClass[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {CLASS_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Surge slider */}
          <div className="space-y-2 p-3 rounded-md bg-slate-50 border">
            <div className="flex items-center justify-between">
              <Label htmlFor="sim-surge" className="text-xs flex items-center gap-1.5">
                Сёрдж-коэффициент {surgeArrow}
              </Label>
              <span
                className="text-sm font-mono font-bold tabular-nums"
                data-testid="text-sim-surge"
              >
                ×{fmt(surge, 2)}
              </span>
            </div>
            <Slider
              id="sim-surge"
              min={SURGE_BOUNDS.min}
              max={SURGE_BOUNDS.max}
              step={0.05}
              value={[surge]}
              onValueChange={(v) => setSurge(v[0])}
              data-testid="slider-sim-surge"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>×0.5 — глубокая скидка</span>
              <span>×1.0 — норма (≈ 10 br)</span>
              <span>×6.0 — аэропорт, длинный заказ</span>
            </div>
          </div>

          {/* Breakdown */}
          <div className="rounded-md border overflow-hidden">
            <div className="bg-slate-100 px-3 py-2 text-xs font-medium uppercase tracking-wide">
              Разбивка расчёта · {CLASS_LABELS[cls]}
            </div>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-t">
                  <td className="px-3 py-2 text-muted-foreground">
                    База тарифа
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {fmt(result.pickup)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground w-32">
                    фикс. часть формулы
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="px-3 py-2 text-muted-foreground">
                    За км ({fmt(tariff.perKm)} × {fmt(km, 1)})
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {fmt(result.perKmCharge)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    линейно
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="px-3 py-2 text-muted-foreground">
                    За мин ({fmt(tariff.perMin)} × {fmt(min, 1)})
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {fmt(result.perMinCharge)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    время в пути
                  </td>
                </tr>
                <tr className="border-t bg-slate-50">
                  <td className="px-3 py-2 font-medium">Сырая база (raw)</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-medium">
                    {fmt(result.raw)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    база + км + мин
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="px-3 py-2 text-muted-foreground">
                    Минимум тарифа
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {fmt(result.baseMinimum)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    нижняя планка до сёрджа
                  </td>
                </tr>
                <tr className="border-t bg-slate-50">
                  <td className="px-3 py-2 font-medium">
                    preSurge = max(минимум, raw)
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-medium">
                    {fmt(result.preSurge)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span
                      className={
                        result.dominatedBy === "minimum"
                          ? "text-amber-700 font-medium"
                          : "text-emerald-700 font-medium"
                      }
                    >
                      {result.dominatedBy === "minimum"
                        ? "минимум выше"
                        : "raw выше"}
                    </span>
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="px-3 py-2 text-muted-foreground">
                    × сёрдж ×{fmt(result.surge, 2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {fmt(result.preSurge * result.surge)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    preSurge × surge
                  </td>
                </tr>
                <tr className="border-t bg-amber-50">
                  <td className="px-3 py-3 font-bold text-base">
                    Итог · preSurge × сёрдж
                  </td>
                  <td
                    className="px-3 py-3 text-right font-mono tabular-nums font-bold text-lg"
                    data-testid="text-sim-final"
                  >
                    {fmt(result.final)} BYN
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    финал
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Quick scenarios */}
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Сценарии при текущих км/мин/классе
            </div>
            <div className="grid grid-cols-5 gap-2">
              {[0.5, 1.0, 2.0, 4.0, 6.0].map((s) => {
                const r = finalPrice(cls, km, min, s);
                return (
                  <button
                    key={s}
                    onClick={() => setSurge(s)}
                    className="border rounded p-2 text-center hover:bg-slate-50 transition"
                    data-testid={`button-scenario-${s}`}
                  >
                    <div className="text-[10px] text-muted-foreground">
                      ×{s.toFixed(1)}
                    </div>
                    <div className="font-mono font-bold text-sm tabular-nums">
                      {r.final.toFixed(1)}
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      {r.dominatedBy === "minimum" ? "min" : "surge"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tariff card reference */}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">
              Параметры тарифа v3 · {CLASS_LABELS[cls]}
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-1 font-mono">
              <div>base = {tariff.pickup} BYN</div>
              <div>perKm = {tariff.perKm} BYN/км</div>
              <div>perMin = {tariff.perMin} BYN/мин</div>
              <div>minimum = {tariff.minimum} BYN</div>
            </div>
            <div className="mt-2">
              Формула v3: <code>price = minimum × surge</code> (= {tariff.minimum} × ⚡N)
            </div>
            <div className="mt-1 text-[10px]">
              perKm/perMin/base обнулены — у Yandex baza плоская = 9.83 br ± 0.21 на дистанциях 2.2–44.6 км. Длина и время зашиты в сёрдж.
            </div>
          </details>
        </div>
      </DialogContent>
    </Dialog>
  );
}
