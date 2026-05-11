import { Polygon, Tooltip } from "react-leaflet";
import { hexDensityColor, type HexFleetSummary } from "@/lib/fleet";

type HexBoundary = {
  id: string;
  boundary: [number, number][];
};

type Props = {
  hexes: HexBoundary[];
  summary: HexFleetSummary;
  /** Минимальное число машин в ячейке, при котором показывать число поверх */
  labelThreshold?: number;
};

export function FleetHexLayer({ hexes, summary, labelThreshold = 4 }: Props) {
  const byId = new Map(summary.allocations.map((a) => [a.hexId, a]));

  return (
    <>
      {hexes.map((h) => {
        const a = byId.get(h.id);
        if (!a) return null;
        if (!a.habitable) return null; // лес/вода/аэропорт — пусто
        if (a.cars === 0) return null; // ниже 1 машины не рисуем
        const fill = hexDensityColor(a.cars, summary.meanCarsPerHabitable);
        const intense = a.cars >= summary.meanCarsPerHabitable * 1.3;
        return (
          <Polygon
            key={h.id}
            positions={h.boundary}
            pathOptions={{
              color: "#ffffff",
              weight: 0.4,
              fillColor: fill,
              fillOpacity: intense ? 0.78 : 0.62,
              opacity: 0.6,
            }}
          >
            {a.cars >= labelThreshold && (
              <Tooltip
                permanent
                direction="center"
                className="!bg-transparent !border-0 !shadow-none !p-0"
              >
                <span
                  style={{
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: a.cars >= summary.meanCarsPerHabitable * 2 ? "13px" : "11px",
                    textShadow: "0 1px 3px rgba(0,0,0,0.85)",
                    fontFamily: "system-ui, sans-serif",
                  }}
                >
                  {a.cars}
                </span>
              </Tooltip>
            )}
          </Polygon>
        );
      })}
    </>
  );
}
