import { useMemo, useRef, useState } from "react";
import type { WbTimelineBucket, WbTimelineBucketKind } from "@/lib/wb-api";

type Props = {
  buckets: WbTimelineBucket[];
  bucketKind: WbTimelineBucketKind;
  selectedMs: number | null;
  onSelect: (ms: number | null) => void;
};

const BAR_PX = 5;
const GAP_PX = 1;
const HEIGHT = 260;
const PAD_TOP = 16;
const PAD_BOTTOM = 36;
const PAD_LEFT = 36;

function fmtTickLabel(iso: string, kind: WbTimelineBucketKind): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  if (kind === "1h") return `${dd}.${mm} ${hh}:00`;
  return `${dd}.${mm} ${hh}:${mi}`;
}
function fmtTooltipTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

export function WbTimelineChart({
  buckets,
  bucketKind,
  selectedMs,
  onSelect,
}: Props) {
  const max = useMemo(
    () => buckets.reduce((m, b) => Math.max(m, b.total), 0),
    [buckets],
  );
  const drawH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const innerW = buckets.length * (BAR_PX + GAP_PX);
  const width = PAD_LEFT + innerW + 8;
  const tickEvery = Math.max(1, Math.round(110 / (BAR_PX + GAP_PX)));

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const yTicks = useMemo(() => {
    if (max <= 0) return [0];
    const steps = 4;
    const arr: number[] = [];
    for (let i = 0; i <= steps; i++) arr.push(Math.round((max * i) / steps));
    return arr;
  }, [max]);

  if (buckets.length === 0 || max === 0) {
    return (
      <div className="text-sm text-muted-foreground py-10 text-center">
        Нет заказов в выбранном диапазоне
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="overflow-x-auto -mx-4 px-4 relative">
      <div style={{ minWidth: width }} className="relative">
        <svg
          width={width}
          height={HEIGHT}
          className="block select-none"
          role="img"
          aria-label="Таймлайн заказов"
        >
          {yTicks.map((v, i) => {
            const f = max > 0 ? v / max : 0;
            const y = PAD_TOP + drawH * (1 - f);
            return (
              <g key={i}>
                <line
                  x1={PAD_LEFT}
                  x2={width}
                  y1={y}
                  y2={y}
                  stroke="rgba(0,0,0,0.06)"
                />
                <text
                  x={PAD_LEFT - 4}
                  y={y + 3}
                  fontSize={10}
                  fill="rgb(107 114 128)"
                  textAnchor="end"
                >
                  {v}
                </text>
              </g>
            );
          })}
          {buckets.map((b, i) => {
            const x = PAD_LEFT + i * (BAR_PX + GAP_PX);
            const cH = max > 0 ? (b.completed / max) * drawH : 0;
            const oH = max > 0 ? (b.open / max) * drawH : 0;
            const xH = max > 0 ? (b.cancelled / max) * drawH : 0;
            const baseY = PAD_TOP + drawH;
            const isHover = hoverIdx === i;
            const isSelected = selectedMs === b.ms;
            const op = isHover || isSelected ? 1 : 0.85;
            return (
              <g
                key={b.ms}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                onClick={() => onSelect(isSelected ? null : b.ms)}
                style={{ cursor: "pointer" }}
              >
                <rect
                  x={x - 1}
                  y={PAD_TOP}
                  width={BAR_PX + 2}
                  height={drawH}
                  fill="transparent"
                />
                {cH > 0 && (
                  <rect
                    x={x}
                    y={baseY - cH}
                    width={BAR_PX}
                    height={cH}
                    fill="#16a34a"
                    opacity={op}
                  />
                )}
                {oH > 0 && (
                  <rect
                    x={x}
                    y={baseY - cH - oH}
                    width={BAR_PX}
                    height={oH}
                    fill="#eab308"
                    opacity={op}
                  />
                )}
                {xH > 0 && (
                  <rect
                    x={x}
                    y={baseY - cH - oH - xH}
                    width={BAR_PX}
                    height={xH}
                    fill="#dc2626"
                    opacity={op}
                  />
                )}
                {isSelected && (
                  <rect
                    x={x - 1}
                    y={PAD_TOP}
                    width={BAR_PX + 2}
                    height={drawH}
                    fill="none"
                    stroke="#0ea5e9"
                    strokeWidth={1.5}
                  />
                )}
              </g>
            );
          })}
          {buckets.map((b, i) => {
            if (i % tickEvery !== 0) return null;
            const x = PAD_LEFT + i * (BAR_PX + GAP_PX);
            return (
              <g key={`tick-${b.ms}`}>
                <line
                  x1={x + BAR_PX / 2}
                  x2={x + BAR_PX / 2}
                  y1={PAD_TOP + drawH}
                  y2={PAD_TOP + drawH + 3}
                  stroke="rgba(0,0,0,0.3)"
                />
                <text
                  x={x + BAR_PX / 2}
                  y={PAD_TOP + drawH + 14}
                  fontSize={10}
                  fill="rgb(107 114 128)"
                  textAnchor="middle"
                >
                  {fmtTickLabel(b.ts, bucketKind)}
                </text>
              </g>
            );
          })}
        </svg>
        {hoverIdx != null && (
          <div
            className="absolute pointer-events-none bg-popover border rounded shadow-md text-xs px-2 py-1 z-10"
            style={{
              left: Math.max(
                4,
                Math.min(
                  width - 200,
                  PAD_LEFT + hoverIdx * (BAR_PX + GAP_PX) + 10,
                ),
              ),
              top: 4,
              minWidth: 180,
            }}
          >
            <div className="font-mono mb-0.5">
              {fmtTooltipTime(buckets[hoverIdx].ts)}
            </div>
            <div>
              Всего: <b>{buckets[hoverIdx].total}</b>
            </div>
            <div className="text-green-700">
              Выполнено: {buckets[hoverIdx].completed}
            </div>
            <div className="text-yellow-700">
              Открыто: {buckets[hoverIdx].open}
            </div>
            <div className="text-red-700">
              Отмен: {buckets[hoverIdx].cancelled}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
