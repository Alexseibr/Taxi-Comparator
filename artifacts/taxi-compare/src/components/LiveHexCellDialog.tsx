// Модалка «соты Яндекса» — открывается при клике на квадрат тепловой карты
// `<LiveHexLayer/>`. Показывает:
//   - заголовок с координатами центра соты, бейджи (кол-во скринов, возраст);
//   - крупные коэффициенты сёрджа для эконом и комфорта;
//   - таблицу 3 строки × 2 колонки: короткая/средняя/длинная поездка ×
//     эконом/комфорт, цена в BYN, посчитанная как
//     (baseline.base + baseline.perMin·tripMin) × surge;
//   - блок «Почему такой тариф» — короткие фразы на русском, основанные на
//     сравнении с почасовым профилем и проверке надёжности соты (см.
//     `lib/live-hex.ts:explainHex`).

import { Info, AlertTriangle, ExternalLink } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  TRIP_BUCKETS,
  explainHex,
  hexFillColor,
  priceFor,
  screenshotUrl,
  type LiveHex,
  type TariffBreakdown,
} from "@/lib/live-hex";

type Props = {
  hex: LiveHex | null;
  breakdown: TariffBreakdown | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function formatAge(minutes: number): string {
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const h = minutes / 60;
  if (h < 24) return `${h.toFixed(1)} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}

function formatGeneratedAt(generatedAt?: string): string | null {
  if (!generatedAt) return null;
  const d = new Date(generatedAt);
  if (isNaN(d.getTime())) return null;
  const diffMin = Math.round((Date.now() - d.getTime()) / 60_000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  return `${(diffMin / 60).toFixed(1)} ч назад`;
}

export function LiveHexCellDialog({ hex, breakdown, open, onOpenChange }: Props) {
  if (!hex || !breakdown) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-md p-4"
          data-testid="dialog-live-hex"
        >
          <DialogHeader>
            <DialogTitle>Сота Яндекса</DialogTitle>
            <DialogDescription>Загрузка…</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const hourNow = new Date().getHours();
  const byHourEntry =
    breakdown.byHour?.find((b) => b.hour === hourNow) ?? null;
  const explanations = explainHex(hex, byHourEntry, hourNow);
  const colorE = hexFillColor(hex.surgeE);
  const colorC = hexFillColor(hex.surgeC);
  const generatedHuman = formatGeneratedAt(breakdown.generatedAt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg p-0 overflow-hidden"
        data-testid="dialog-live-hex"
      >
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-base">
            Сота Яндекса · {hex.lat.toFixed(2)}°N, {hex.lon.toFixed(2)}°E
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-snug">
            Срез распознанных скриншотов Yandex Go в этом квадрате (≈1.1×1.1 км)
            за последние {breakdown.liveWindowHours ?? 6} ч. Цены посчитаны по
            нашей OLS-модели: «(base + perMin × длительность) × сёрдж».
          </DialogDescription>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Badge variant="outline" className="text-[10px]">
              {hex.n} скрин{hex.n === 1 ? "" : "ов"} (Э:{hex.nE} / К:{hex.nC})
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              свежий: {formatAge(hex.ageMinM)}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              старый: {formatAge(hex.ageMaxM)}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              сейчас {hourNow}:00
            </Badge>
          </div>
        </DialogHeader>

        {/* Крупные коэффициенты — основное число, на которое смотрит водитель */}
        <div className="px-4 grid grid-cols-2 gap-2">
          <div
            className="rounded-md border p-2.5"
            style={{
              borderColor: colorE.stroke,
              backgroundColor: colorE.fill + "22",
            }}
          >
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Эконом
            </div>
            <div className="text-2xl font-bold leading-none mt-0.5">
              ×{hex.surgeE.toFixed(2)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {colorE.label}
            </div>
          </div>
          <div
            className="rounded-md border p-2.5"
            style={{
              borderColor: colorC.stroke,
              backgroundColor: colorC.fill + "22",
            }}
          >
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Комфорт
            </div>
            <div className="text-2xl font-bold leading-none mt-0.5">
              ×{hex.surgeC.toFixed(2)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {colorC.label}
            </div>
          </div>
        </div>

        {/* Таблица цен по бакетам */}
        <div className="px-4 pt-3">
          <div className="text-[11px] font-semibold mb-1.5 text-muted-foreground">
            Цены сейчас в этой соте, BYN
          </div>
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-2.5 py-1.5">
                    Поездка
                  </th>
                  <th className="text-right font-medium px-2.5 py-1.5">
                    Эконом
                  </th>
                  <th className="text-right font-medium px-2.5 py-1.5">
                    Комфорт
                  </th>
                </tr>
              </thead>
              <tbody>
                {TRIP_BUCKETS.map((bucket) => (
                  <tr
                    key={bucket.id}
                    className="border-t"
                    data-testid={`row-bucket-${bucket.id}`}
                  >
                    <td className="px-2.5 py-1.5">
                      <div className="font-medium">{bucket.label}</div>
                      <div className="text-[10px] text-muted-foreground">
                        ~{bucket.approxKm} км · {bucket.tripMin} мин
                      </div>
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums font-medium">
                      {priceFor(breakdown.baseline.econom, bucket, hex.surgeE).toFixed(1)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums font-medium">
                      {priceFor(breakdown.baseline.comfort, bucket, hex.surgeC).toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Скрины-источники для перепроверки. Только если в JSON есть calibs[]
            (новые версии generator'а). Тап на превью — открывает оригинальный
            скриншот Yandex Go в новой вкладке: видишь те же цены, ту же точку А,
            тот же сёрдж — можно убедиться что коэффициент посчитан корректно. */}
        {hex.calibs && hex.calibs.length > 0 && (
          <div className="px-4 pt-3">
            <div className="text-[11px] font-semibold mb-1.5 text-muted-foreground flex items-center gap-1">
              Исходные скрины ({hex.calibs.length})
              <span className="font-normal text-[10px]">— тап для проверки</span>
            </div>
            <div
              className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory"
              data-testid="calibs-list"
            >
              {hex.calibs.map((calib) => {
                const ageMin = Math.max(
                  0,
                  Math.round((Date.now() - calib.tsMs) / 60_000),
                );
                return (
                  <a
                    key={calib.id}
                    href={screenshotUrl(calib)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="shrink-0 snap-start w-[88px] rounded-md border bg-card hover:border-amber-400 hover:shadow-md transition active:scale-95"
                    data-testid={`calib-link-${calib.id}`}
                    title={`Открыть скрин: ${calib.fromAddr || "точка А"} · ${formatAge(ageMin)}`}
                  >
                    <div className="relative w-[88px] h-[140px] bg-muted rounded-t-md overflow-hidden">
                      <img
                        src={screenshotUrl(calib)}
                        alt={`Скрин ${calib.id}`}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover object-top"
                      />
                      <div className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5">
                        <ExternalLink className="h-2.5 w-2.5" />
                      </div>
                    </div>
                    <div className="p-1 text-[10px] leading-tight">
                      <div className="flex justify-between gap-1 font-medium tabular-nums">
                        <span>
                          {calib.priceE != null ? `Э${calib.priceE.toFixed(1)}` : "—"}
                        </span>
                        <span className="text-muted-foreground">
                          {calib.priceC != null ? `К${calib.priceC.toFixed(1)}` : "—"}
                        </span>
                      </div>
                      <div className="text-muted-foreground truncate" title={calib.fromAddr}>
                        {calib.fromAddr || "—"}
                      </div>
                      <div className="text-muted-foreground/80">{formatAge(ageMin)}</div>
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* Объяснение «почему такой тариф» */}
        <div className="px-4 pt-3 pb-4">
          <div className="text-[11px] font-semibold mb-1.5 text-muted-foreground">
            Почему такой тариф
          </div>
          <ul className="space-y-1.5">
            {explanations.map((e, i) => (
              <li
                key={i}
                className="flex gap-1.5 text-[12px] leading-snug"
                data-testid={`reason-${i}`}
              >
                {e.level === "warn" ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                ) : (
                  <Info className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5" />
                )}
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="px-4 py-2 bg-muted/40 text-[10px] text-muted-foreground border-t">
          Модель v{breakdown.version ?? "?"}
          {generatedHuman ? ` · обновлено ${generatedHuman}` : ""} · окно{" "}
          {breakdown.liveWindowHours ?? 6} ч · baseline эконом b
          {breakdown.baseline.econom.base.toFixed(2)} +{" "}
          {breakdown.baseline.econom.perMin.toFixed(2)}/мин
          {breakdown.baseline.econom.perKm &&
          breakdown.baseline.econom.perKm > 0 ? (
            <>
              {" "}
              + {breakdown.baseline.econom.perKm.toFixed(2)}/км
            </>
          ) : null}{" "}
          (n=
          {breakdown.baseline.econom.n ?? "?"})
        </div>
      </DialogContent>
    </Dialog>
  );
}
