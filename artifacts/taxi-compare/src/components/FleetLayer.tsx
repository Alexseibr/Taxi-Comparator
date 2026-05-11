import { CircleMarker, Tooltip, Popup } from "react-leaflet";
import { ZONES } from "@/lib/zones";
import {
  fleetColor,
  fleetLabel,
  balanceMultiplier,
  type FleetSummary,
} from "@/lib/fleet";

type Props = {
  summary: FleetSummary;
};

export function FleetLayer({ summary }: Props) {
  return (
    <>
      {summary.allocations.map((a) => {
        const zone = ZONES.find((z) => z.id === a.zoneId);
        if (!zone) return null;
        // Радиус кружка ∝ √cars (площадь ∝ cars). Минимум 10, макс 55px,
        // чтобы маленькие зоны были видны, а большие не залили карту.
        const r = Math.max(10, Math.min(55, Math.sqrt(Math.max(1, a.cars)) * 4.5));
        const color = fleetColor(a.ratio);
        const labelText = a.cars.toString();
        const mult = balanceMultiplier(a.ratio);
        return (
          <CircleMarker
            key={a.zoneId}
            center={zone.center}
            radius={r}
            pathOptions={{
              color: "#ffffff",
              weight: 2,
              fillColor: color,
              fillOpacity: 0.78,
            }}
          >
            <Tooltip
              permanent
              direction="center"
              className="!bg-transparent !border-0 !shadow-none !p-0"
            >
              <span
                style={{
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: r > 18 ? "14px" : "11px",
                  textShadow: "0 1px 3px rgba(0,0,0,0.85)",
                  fontFamily: "system-ui, sans-serif",
                  whiteSpace: "nowrap",
                }}
              >
                {labelText}
              </span>
            </Tooltip>
            <Popup>
              <div className="text-sm space-y-1.5 min-w-[220px]">
                <div className="font-bold text-base">{zone.nameRu}</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div>Машин в зоне:</div>
                  <div className="font-semibold text-right">{a.cars}</div>
                  <div>Прогноз спроса:</div>
                  <div className="font-semibold text-right">
                    {a.demand.toFixed(0)} одноврем.
                  </div>
                  <div>Surge у Я.:</div>
                  <div className="font-semibold text-right">
                    ×{a.surge.toFixed(2)}
                  </div>
                  <div>Баланс:</div>
                  <div
                    className="font-semibold text-right"
                    style={{ color }}
                  >
                    {fleetLabel(a.ratio)}
                  </div>
                  <div>Покрытие:</div>
                  <div className="font-semibold text-right">
                    {Number.isFinite(a.ratio)
                      ? `${(a.ratio * 100).toFixed(0)}%`
                      : "—"}
                  </div>
                  <div>Реком. множитель цены:</div>
                  <div
                    className="font-semibold text-right"
                    style={{ color: mult > 1.05 ? "#dc2626" : "#16a34a" }}
                  >
                    ×{mult.toFixed(2)}
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground pt-1 border-t">
                  Тип зоны: {zone.type} · радиус {(zone.radiusM / 1000).toFixed(1)} км
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
