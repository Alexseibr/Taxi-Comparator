// Слой «живых сот Яндекса» — рендерит на карте Минска прямоугольники
// 0.01°×0.01°, окрашенные по текущему сёрджу эконом-класса. Данные берёт
// из /data/tariff-breakdown.json (обновляется на VPS раз в 5 минут).
//
// Каждая сота кликабельна — клик пробрасывается через `onCellClick`,
// родитель открывает `<LiveHexCellDialog/>` с подробной разбивкой цен и
// объяснением.
//
// Поскольку это не h3-cells (как в HolesOverlayLayer), а равномерная сетка
// 0.01°, мы используем нативный `<Rectangle>` из react-leaflet — он легче
// и не требует пересчёта boundaries при каждом ререндере.

import { useEffect, useState } from "react";
import { Rectangle, Tooltip } from "react-leaflet";
import {
  hexBounds,
  hexFillColor,
  liveHexesFromBreakdown,
  loadTariffBreakdown,
  type LiveHex,
  type TariffBreakdown,
} from "@/lib/live-hex";

type Props = {
  /** Колбэк, когда юзер кликает по соте. */
  onCellClick: (hex: LiveHex, breakdown: TariffBreakdown) => void;
  /** Тик для принудительного refresh — увеличивайте число чтобы перезагрузить JSON. */
  refreshTick?: number;
};

export function LiveHexLayer({ onCellClick, refreshTick = 0 }: Props) {
  const [breakdown, setBreakdown] = useState<TariffBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadTariffBreakdown()
      .then((b) => {
        if (!cancelled) setBreakdown(b);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message || "load_failed");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  if (error) {
    // Молча — ошибку покажет родитель в overlay-подсказке (если нужно).
    return null;
  }
  if (!breakdown) return null;

  const hexes = liveHexesFromBreakdown(breakdown);
  return (
    <>
      {hexes.map((hex) => {
        const c = hexFillColor(hex.surgeE);
        const bounds = hexBounds(hex);
        return (
          <Rectangle
            key={hex.id}
            bounds={bounds}
            pathOptions={{
              color: c.stroke,
              weight: 1,
              fillColor: c.fill,
              fillOpacity: c.opacity,
            }}
            eventHandlers={{
              click: () => onCellClick(hex, breakdown),
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -4]}
              opacity={0.95}
              sticky
              className="!bg-white !text-foreground !border !shadow-md"
            >
              <div className="text-[11px] leading-tight">
                <div className="font-semibold">
                  Эконом ×{hex.surgeE.toFixed(2)} · Комфорт ×
                  {hex.surgeC.toFixed(2)}
                </div>
                <div className="text-muted-foreground">
                  {hex.n} скрин{hex.n === 1 ? "" : "ов"} ·{" "}
                  {hex.ageMinM < 60
                    ? `${hex.ageMinM} мин назад`
                    : `${(hex.ageMinM / 60).toFixed(1)} ч назад`}
                </div>
                <div className="text-muted-foreground italic">
                  Тап — подробнее
                </div>
              </div>
            </Tooltip>
          </Rectangle>
        );
      })}
    </>
  );
}
