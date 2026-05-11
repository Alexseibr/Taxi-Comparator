import type { ReactNode } from "react";
import type { Basemap, BasemapId } from "@/lib/basemaps";

interface Props {
  basemap: Basemap;
}

// Атрибуции, отрендеренные через JSX (без dangerouslySetInnerHTML).
// Раньше basemap.attribution приходил как HTML-строка и втыкался через
// innerHTML — это работало (контент мы пишем сами), но любое будущее
// расширение каталога подложек могло бы пронести в DOM сторонний HTML
// или сорвать CSP с strict script-src. JSX исключает класс багов целиком.
const OSM_LINK: ReactNode = (
  <a
    href="https://www.openstreetmap.org/copyright"
    target="_blank"
    rel="noopener noreferrer"
  >
    OpenStreetMap contributors
  </a>
);
const CARTO_LINK: ReactNode = (
  <a
    href="https://carto.com/attributions"
    target="_blank"
    rel="noopener noreferrer"
  >
    CARTO
  </a>
);

const ATTRIBUTIONS: Record<BasemapId, ReactNode> = {
  osm: <>© {OSM_LINK}</>,
  "carto-voyager": (
    <>
      © {OSM_LINK} © {CARTO_LINK}
    </>
  ),
  "carto-positron": (
    <>
      © {OSM_LINK} © {CARTO_LINK}
    </>
  ),
  "carto-dark": (
    <>
      © {OSM_LINK} © {CARTO_LINK}
    </>
  ),
};

/**
 * Кастомная плашка атрибуции для карты.
 *
 * Зачем не дефолтный <AttributionControl>:
 *  - Leaflet добавляет префикс «🇺🇦 Leaflet» (с эмодзи флага), его нельзя
 *    просто стилизовать, и пользователю он мешает.
 *  - При смене подложки через key={basemap.id} Leaflet иногда оставляет
 *    атрибуцию старого слоя «висеть» рядом с новой.
 *  - На мобиле дефолтная плашка садится прямо на временной ползунок
 *    (MobileBottomBar), её нельзя сдвинуть кроме как через CSS-инжекты.
 *
 * Своя плашка решает всё это: всегда ровно одна строка от текущей
 * подложки, расположение управляемое (на мобиле — над bottom-bar,
 * на десктопе — стандартное).
 */
export function MapAttribution({ basemap }: Props) {
  return (
    <div
      data-testid="map-attribution"
      className="
        absolute right-1 z-[400] pointer-events-auto
        bottom-[88px] md:bottom-1
        bg-background/85 backdrop-blur-sm
        rounded px-1.5 py-0.5
        text-[9px] leading-tight text-muted-foreground
        border border-border/40 shadow-sm
        max-w-[60vw] md:max-w-none truncate
      "
    >
      {ATTRIBUTIONS[basemap.id] ?? ATTRIBUTIONS.osm}
    </div>
  );
}
