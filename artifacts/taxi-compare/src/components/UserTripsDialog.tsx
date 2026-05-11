import React, { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Trash2, FileText, Plus, Loader2, Download, Camera } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  clearUserTrips,
  parseCsv,
  parseObservationsFile,
  saveUserTrips,
  loadUserTrips,
  type Observation,
  type DemandLabel,
} from "@/lib/observations";
import { useUserTrips } from "@/hooks/use-observations";
import { geocodeAddress, type GeocodeResult } from "@/lib/geocoder";
import { fetchRoute } from "@/lib/routing";
import { basePrice, hourToSlot, type DayType } from "@/lib/zones";
import { submitCalibToServer, isCalibServerConfigured } from "@/lib/calib-server";
import {
  uploadScreens,
  isScreensUploadConfigured,
  getScreensQueueStatus,
} from "@/lib/screens-server";
import { RecommendedRoutesIconButton } from "@/components/RecommendedRoutesPopover";
import { AdminPriceMonitorButton } from "@/components/AdminPriceMonitor";

function fmtScreenEta(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} сек`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} мин`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

const SAMPLE_CSV = `id,lat,lng,day,slot,comfortSurge,economSurge,date,source,notes
trip-001,53.9105,27.5142,saturday,evening,1.7,1.0,2026-04-25,rwb-trip,Победителей вечером
trip-002,53.8900,27.5500,weekday,morning,1.4,1.0,2026-04-22,rwb-trip,Утренний выезд из спальника`;

function nowDateTimeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(Math.floor(d.getMinutes() / 10) * 10)}`;
}

function dayFromDate(iso: string): DayType {
  const wd = new Date(iso).getDay(); // 0 = sunday
  if (wd === 0) return "sunday";
  if (wd === 6) return "saturday";
  return "weekday";
}

interface UserTripsDialogProps {
  controlledOpen?: boolean;
  onControlledOpenChange?: (v: boolean) => void;
  hideTrigger?: boolean;
}

export default function UserTripsDialog({
  controlledOpen,
  onControlledOpenChange,
  hideTrigger,
}: UserTripsDialogProps = {}) {
  const trips = useUserTrips();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onControlledOpenChange ?? setInternalOpen;
  const [errors, setErrors] = useState<string[]>([]);
  const [lastImported, setLastImported] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Ручной ввод замера (форма для сотрудников)
  const [mFrom, setMFrom] = useState("");
  const [mTo, setMTo] = useState("");
  const [mPriceE, setMPriceE] = useState("");
  const [mPriceC, setMPriceC] = useState("");
  const [mTripMin, setMTripMin] = useState("");
  const [mEta, setMEta] = useState("");
  const [mDemand, setMDemand] = useState<DemandLabel>("yellow");
  const [mDateTime, setMDateTime] = useState<string>(() => nowDateTimeLocal());
  const [mBusy, setMBusy] = useState(false);
  const [mMsg, setMMsg] = useState<string | null>(null);
  const [mErr, setMErr] = useState<string | null>(null);

  // Загрузка скринов из мобильного Yandex Go (распознавание на сервере).
  // После приёма — toast + автозакрытие диалога (возврат на главную карту).
  const screenFileRef = useRef<HTMLInputElement>(null);
  const [screenBusy, setScreenBusy] = useState(false);
  const { toast } = useToast();

  async function handleFile(file: File) {
    setErrors([]);
    const text = await file.text();
    const isJson = file.name.toLowerCase().endsWith(".json");
    let parsed: { items: Observation[]; errors: string[] };
    try {
      if (isJson) {
        parsed = parseObservationsFile(JSON.parse(text), "user-trip");
      } else {
        parsed = parseCsv(text, "user-trip");
      }
    } catch (e) {
      setErrors([`Не удалось разобрать файл: ${(e as Error).message}`]);
      return;
    }
    if (parsed.items.length === 0 && parsed.errors.length > 0) {
      setErrors(parsed.errors);
      return;
    }
    // Слияние с уже сохранёнными — по id (новые перезатирают старые).
    const map = new Map<string, Observation>();
    for (const t of trips) map.set(t.id, t);
    for (const t of parsed.items) map.set(t.id, t);
    const merged = Array.from(map.values());
    saveUserTrips(merged);
    setLastImported(parsed.items.length);
    setErrors(parsed.errors);
  }

  async function handleScreensUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    if (!isScreensUploadConfigured()) {
      toast({
        title: "Загрузка скринов недоступна",
        description: "Серверный приёмник пока не настроен.",
        variant: "destructive",
      });
      return;
    }
    const files = Array.from(fileList);
    setScreenBusy(true);
    try {
      // Pre-check: если очередь распознавания перегружена — мягко предупреждаем
      // пользователя, но загрузку выполняем (файлы не теряются, встают в очередь).
      const pre = await getScreensQueueStatus();
      if (pre.ok && pre.level === "overloaded") {
        toast({
          title: "Очередь распознавания загружена",
          description: `Сейчас в обработке ${pre.queueLength} скринов (~${fmtScreenEta(pre.etaSeconds)} ожидания). Ваши встанут в очередь, но лучше прислать чуть позже.`,
        });
      }
      const res = await uploadScreens(files);
      if (!res.ok) {
        toast({
          title: "Скриншоты не приняты",
          description:
            res.error === "all_files_filtered_locally"
              ? "Файлы не подошли: нужны JPEG / PNG / WebP до 10 МБ."
              : `Ошибка: ${res.error}${res.status ? ` (HTTP ${res.status})` : ""}`,
          variant: "destructive",
        });
        return;
      }
      const okCount = res.accepted.length;
      const skipCount = res.rejected.length;
      const lines: string[] = [
        `${okCount} ${okCount === 1 ? "скрин" : okCount < 5 ? "скрина" : "скринов"} принято.`,
      ];
      if (skipCount > 0) {
        const reasons = res.rejected
          .map((r) => `${r.originalName} (${r.reason})`)
          .join(", ");
        lines.push(`Пропущено ${skipCount}: ${reasons}.`);
      }
      if (res.aborted) {
        lines.push("Лишние файлы отброшены (макс 5 за раз).");
      }
      if (typeof res.queueLength === "number" && res.queueLength > 10) {
        const eta =
          typeof res.etaSeconds === "number"
            ? res.etaSeconds
            : res.queueLength * 6;
        lines.push(
          `В очереди распознавания ${res.queueLength} штук, ~${fmtScreenEta(eta)} до полной обработки.`,
        );
      } else {
        lines.push(
          "Сервер распознаёт цены через ИИ — появятся в общем пуле в течение 5 минут.",
        );
      }
      toast({
        title: "Скриншоты приняты ✓",
        description: lines.join(" "),
      });
      // Возврат на главную (карта) — диалог закрывается автоматически.
      setOpen(false);
    } catch (e) {
      toast({
        title: "Ошибка сети",
        description: (e as Error).message || "network_error",
        variant: "destructive",
      });
    } finally {
      setScreenBusy(false);
      if (screenFileRef.current) screenFileRef.current.value = "";
    }
  }

  async function handleManualAdd() {
    setMErr(null);
    setMMsg(null);
    const fromQ = mFrom.trim();
    const toQ = mTo.trim();
    const priceE = parseFloat(mPriceE.replace(",", "."));
    const priceC = parseFloat(mPriceC.replace(",", "."));
    const userTripMin = parseFloat(mTripMin.replace(",", "."));
    const etaMin = parseFloat(mEta.replace(",", "."));
    if (fromQ.length < 3 || toQ.length < 3) {
      setMErr("Введите адреса А и Б (минимум 3 символа)");
      return;
    }
    const havePriceE = Number.isFinite(priceE) && priceE > 0;
    const havePriceC = Number.isFinite(priceC) && priceC > 0;
    if (!havePriceE && !havePriceC) {
      setMErr("Введите хотя бы одну цену (Эконом или Комфорт), BYN");
      return;
    }
    setMBusy(true);
    try {
      const [fromCands, toCands] = await Promise.all([
        geocodeAddress(fromQ),
        geocodeAddress(toQ),
      ]);
      if (fromCands.length === 0) throw new Error(`Адрес «${fromQ}» не найден в Минске`);
      if (toCands.length === 0) throw new Error(`Адрес «${toQ}» не найден в Минске`);
      const from: GeocodeResult = fromCands[0];
      const to: GeocodeResult = toCands[0];
      const route = await fetchRoute([from.lat, from.lng], [to.lat, to.lng]);
      if (route.fallback) {
        setMErr(
          "Внимание: маршрутизатор не отвечает, расстояние оценено по прямой. Время поездки лучше задать вручную.",
        );
      }
      const km = route.distanceKm;
      // Если сотрудник ввёл время поездки — используем его (это более точно,
      // т.к. это реальное время которое Яндекс показывает с пробками).
      // Иначе — берём из маршрутизатора (без пробок).
      const minUsed =
        Number.isFinite(userTripMin) && userTripMin > 0 ? userTripMin : route.durationMin;
      const baseE = basePrice("econom", km, minUsed);
      const baseC = basePrice("comfort", km, minUsed);
      const economSurge = havePriceE ? +(priceE / baseE).toFixed(3) : undefined;
      const comfortSurge = havePriceC ? +(priceC / baseC).toFixed(3) : undefined;
      const hiddenEconomSurge =
        economSurge !== undefined && comfortSurge !== undefined && comfortSurge > 0
          ? +(economSurge / comfortSurge).toFixed(3)
          : undefined;
      const dt = new Date(mDateTime);
      const day = dayFromDate(mDateTime);
      const slot = hourToSlot(dt.getHours());
      const dateIso = mDateTime.slice(0, 10);
      const mid = route.path[Math.floor(route.path.length / 2)];
      const id = `manual-${Date.now()}`;
      const demandRu = mDemand === "green" ? "🟢 обычный" : mDemand === "yellow" ? "🟡 повышенный" : "🔴 высокий";
      const noteParts: string[] = [
        `${fromQ} → ${toQ}`,
        `${km.toFixed(1)} км / ${Math.round(minUsed)} мин`,
      ];
      if (havePriceE) noteParts.push(`Эконом ${priceE.toFixed(2)} ⇒ ×${economSurge!.toFixed(2)}`);
      if (havePriceC) noteParts.push(`Комфорт ${priceC.toFixed(2)} ⇒ ×${comfortSurge!.toFixed(2)}`);
      if (Number.isFinite(etaMin) && etaMin >= 0) noteParts.push(`подача ${Math.round(etaMin)} мин`);
      noteParts.push(`спрос ${demandRu}`);
      const obs: Observation = {
        id,
        lat: mid[0],
        lng: mid[1],
        day,
        slot,
        date: dateIso,
        source: "rwb-form",
        notes: noteParts.join(" · "),
        address: `${fromQ} → ${toQ}`,
        origin: "user-trip",
        km,
        min: minUsed,
        hour: dt.getHours(),
        fromAddress: fromQ,
        toAddress: toQ,
        fromLat: from.lat,
        fromLng: from.lng,
        toLat: to.lat,
        toLng: to.lng,
        demand: mDemand,
        ...(comfortSurge !== undefined ? { comfortSurge } : {}),
        ...(economSurge !== undefined ? { economSurge } : {}),
        ...(hiddenEconomSurge !== undefined ? { hiddenEconomSurge } : {}),
        ...(havePriceE ? { factE: priceE } : {}),
        ...(havePriceC ? { factC: priceC } : {}),
        ...(Number.isFinite(etaMin) && etaMin >= 0 ? { etaMin } : {}),
      };
      const merged = [...loadUserTrips(), obs];
      saveUserTrips(merged);
      const msgParts: string[] = [`${km.toFixed(1)} км / ${Math.round(minUsed)} мин`];
      if (economSurge !== undefined) msgParts.push(`Эконом ×${economSurge.toFixed(2)}`);
      if (comfortSurge !== undefined) msgParts.push(`Комфорт ×${comfortSurge.toFixed(2)}`);

      // Отправляем замер в общий пул на VPS (и в браузер, и на сервер).
      let serverSuffix = "";
      if (isCalibServerConfigured()) {
        const serverRes = await submitCalibToServer({
          fromAddress: fromQ,
          toAddress: toQ,
          fromLat: from.lat,
          fromLng: from.lng,
          toLat: to.lat,
          toLng: to.lng,
          ...(havePriceE ? { factE: priceE } : {}),
          ...(havePriceC ? { factC: priceC } : {}),
          ...(Number.isFinite(etaMin) && etaMin >= 0 ? { etaMin } : {}),
          ...(Number.isFinite(userTripMin) && userTripMin > 0
            ? { tripMin: userTripMin }
            : {}),
          km,
          demand: mDemand,
          date: dateIso,
          hour: dt.getHours(),
          source: "rwb-form",
          notes: noteParts.join(" · "),
        });
        serverSuffix = serverRes.ok
          ? " · ✓ отправлено в общий пул"
          : ` · ⚠ сервер не принял (${serverRes.error})`;
      } else {
        serverSuffix = " · 💾 сохранено только локально (приёмник не настроен)";
      }
      setMMsg(`Добавлено: ${msgParts.join(" · ")}${serverSuffix}`);
      // Сбрасываем только цены/спрос/eta — адреса остаются для повторных замеров.
      setMPriceE("");
      setMPriceC("");
      setMEta("");
      setMTripMin("");
    } catch (e) {
      setMErr((e as Error).message);
    } finally {
      setMBusy(false);
    }
  }

  function handleDownloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rwb-trips-sample.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportTripsCsv() {
    if (trips.length === 0) return;
    const header =
      "id,lat,lng,day,slot,date,hour,km,min,kmh,comfortSurge,economSurge,hiddenEconomSurge,fromAddress,toAddress,fromLat,fromLng,toLat,toLng,factE,factC,etaMin,demand,source,address,notes";
    const esc = (v: unknown) => {
      if (v === undefined || v === null) return "";
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const rows = trips.map((t) => {
      const km = t.km;
      const min = t.min;
      const hour = t.hour;
      const kmh = km && min && min > 0 ? +(km / (min / 60)).toFixed(1) : "";
      return [
        esc(t.id),
        esc(t.lat.toFixed(6)),
        esc(t.lng.toFixed(6)),
        esc(t.day),
        esc(t.slot),
        esc(t.date ?? ""),
        esc(hour ?? ""),
        esc(km ?? ""),
        esc(min ?? ""),
        esc(kmh),
        esc(t.comfortSurge ?? ""),
        esc(t.economSurge ?? ""),
        esc(t.hiddenEconomSurge ?? ""),
        esc(t.fromAddress ?? ""),
        esc(t.toAddress ?? ""),
        esc(t.fromLat?.toFixed(6) ?? ""),
        esc(t.fromLng?.toFixed(6) ?? ""),
        esc(t.toLat?.toFixed(6) ?? ""),
        esc(t.toLng?.toFixed(6) ?? ""),
        esc(t.factE ?? ""),
        esc(t.factC ?? ""),
        esc(t.etaMin ?? ""),
        esc(t.demand ?? ""),
        esc(t.source ?? ""),
        esc(t.address ?? ""),
        esc(t.notes ?? ""),
      ].join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().slice(0, 10);
    a.download = `rwb-my-trips-${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1 h-8"
          data-testid="button-user-trips"
        >
          <FileText className="h-3.5 w-3.5" />
          Мои поездки
          {trips.length > 0 && (
            <span className="ml-1 inline-flex items-center justify-center min-w-5 px-1 h-4 rounded bg-primary text-primary-foreground text-[10px] font-semibold">
              {trips.length}
            </span>
          )}
        </Button>
      </DialogTrigger>
      )}
      <DialogContent className="w-[calc(100vw-1rem)] max-w-2xl max-h-[92vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="space-y-1">
          <DialogTitle>Добавить поездку</DialogTitle>
          <DialogDescription className="text-xs">
            Два способа: <strong>📷 Скриншот</strong> — самый быстрый, цены и
            адреса распознает ИИ; либо <strong>✍️ Вручную</strong> — заполнить
            адреса А/Б и цены самостоятельно.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="screen" className="w-full">
          <TabsList className="grid grid-cols-2 w-full h-10">
            <TabsTrigger
              value="screen"
              className="gap-1.5 text-sm"
              data-testid="tab-screen"
            >
              <Camera className="h-4 w-4" />
              Скриншот
            </TabsTrigger>
            <TabsTrigger
              value="manual"
              className="gap-1.5 text-sm"
              data-testid="tab-manual"
            >
              <Plus className="h-4 w-4" />
              Вручную
            </TabsTrigger>
          </TabsList>

          {/* ============ ВКЛАДКА 1: скриншоты (без полей А/Б) ============ */}
          <TabsContent value="screen" className="mt-3 space-y-3">
            <div className="text-[12px] text-muted-foreground leading-relaxed">
              Сделайте скрин экрана выбора тарифа в мобильном Yandex Go (где
              видны цены Эконом и/или Комфорт, адреса А и Б). Можно отправить до
              5 фото за раз. Сервер сам распознает цены, адреса и спрос — замер
              появится в общем пуле через ~5 минут.
            </div>
            <input
              ref={screenFileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => handleScreensUpload(e.target.files)}
              data-testid="input-screen-upload"
            />
            <div className="flex gap-2 items-stretch">
              <Button
                type="button"
                size="lg"
                onClick={() => screenFileRef.current?.click()}
                disabled={screenBusy || !isScreensUploadConfigured()}
                className="flex-1 gap-2 h-14 text-base bg-blue-600 hover:bg-blue-700 text-white"
                data-testid="button-screen-upload"
              >
                {screenBusy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Camera className="h-5 w-5" />
                )}
                {screenBusy
                  ? "Загружаю…"
                  : isScreensUploadConfigured()
                    ? "Выбрать скриншот(ы)"
                    : "Приёмник не настроен"}
              </Button>
              <RecommendedRoutesIconButton />
              <AdminPriceMonitorButton variant="icon" />
            </div>
            <div className="text-[11px] text-muted-foreground italic text-center">
              После загрузки появится уведомление и эта вкладка закроется.
            </div>
          </TabsContent>

          {/* ============ ВКЛАДКА 2: ручной ввод (адреса + цены) ============ */}
          <TabsContent value="manual" className="mt-3 space-y-3 text-sm">
            <div className="text-[12px] text-muted-foreground leading-relaxed">
              Заполните как видите в приложении Яндекс — система посчитает
              расстояние, сёрдж и положит точку на карту. Адреса остаются после
              сохранения, чтобы быстро внести следующий замер из той же точки А.
            </div>

            <div className="space-y-1">
              <Label className="text-[11px]">Время замера</Label>
              <div className="flex gap-2">
                <Input
                  type="datetime-local"
                  value={mDateTime}
                  onChange={(e) => setMDateTime(e.target.value)}
                  className="flex-1 h-10"
                  data-testid="input-manual-datetime"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setMDateTime(nowDateTimeLocal())}
                  className="text-xs whitespace-nowrap h-10"
                >
                  Сейчас
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px]">Точка А (откуда)</Label>
                <Input
                  value={mFrom}
                  onChange={(e) => setMFrom(e.target.value)}
                  placeholder="напр. Короля 12"
                  className="h-10"
                  data-testid="input-manual-from"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Точка Б (куда)</Label>
                <Input
                  value={mTo}
                  onChange={(e) => setMTo(e.target.value)}
                  placeholder="напр. Ленина 50"
                  className="h-10"
                  data-testid="input-manual-to"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px]">Время в пути (мин)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={mTripMin}
                  onChange={(e) => setMTripMin(e.target.value)}
                  placeholder="напр. 14"
                  className="h-10"
                  data-testid="input-manual-trip-min"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Подача (мин)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={mEta}
                  onChange={(e) => setMEta(e.target.value)}
                  placeholder="напр. 5"
                  className="h-10"
                  data-testid="input-manual-eta"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px]">Метка спроса (значок Яндекса)</Label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={mDemand === "green" ? "default" : "outline"}
                  onClick={() => setMDemand("green")}
                  className={`flex-1 h-10 text-xs gap-1 ${mDemand === "green" ? "bg-green-600 hover:bg-green-700 text-white border-green-600" : ""}`}
                  data-testid="button-demand-green"
                >
                  🟢 Обычный
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mDemand === "yellow" ? "default" : "outline"}
                  onClick={() => setMDemand("yellow")}
                  className={`flex-1 h-10 text-xs gap-1 ${mDemand === "yellow" ? "bg-yellow-500 hover:bg-yellow-600 text-white border-yellow-500" : ""}`}
                  data-testid="button-demand-yellow"
                >
                  🟡 Повышен
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mDemand === "red" ? "default" : "outline"}
                  onClick={() => setMDemand("red")}
                  className={`flex-1 h-10 text-xs gap-1 ${mDemand === "red" ? "bg-red-600 hover:bg-red-700 text-white border-red-600" : ""}`}
                  data-testid="button-demand-red"
                >
                  🔴 Высокий
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px]">Цена Эконом (BYN)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={mPriceE}
                  onChange={(e) => setMPriceE(e.target.value)}
                  placeholder="напр. 12.4"
                  className="h-10"
                  data-testid="input-manual-price-econom"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Цена Комфорт (BYN)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={mPriceC}
                  onChange={(e) => setMPriceC(e.target.value)}
                  placeholder="напр. 18.7"
                  className="h-10"
                  data-testid="input-manual-price-comfort"
                />
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground italic">
              Можно ввести только одну цену из двух — но если ввести обе сразу,
              данные становятся в 2 раза ценнее для обучения.
            </div>

            <Button
              type="button"
              size="lg"
              onClick={handleManualAdd}
              disabled={mBusy}
              className="w-full gap-1 h-12 text-base"
              data-testid="button-manual-add"
            >
              {mBusy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Plus className="h-5 w-5" />
              )}
              {mBusy ? "Считаю маршрут…" : "Записать"}
            </Button>

            {mMsg && (
              <div className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded p-2">
                {mMsg}
              </div>
            )}
            {mErr && (
              <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                {mErr}
              </div>
            )}

            {/* CSV / JSON батч и текущий пул — для тех, кто понимает формат. */}
            <details className="rounded-md border bg-muted/20 text-xs">
              <summary className="cursor-pointer px-3 py-2 font-medium select-none">
                Сохранённые поездки и батч CSV/JSON ({trips.length})
              </summary>
              <div className="p-3 space-y-3 border-t">
                {trips.length > 0 && (
                  <div className="text-[11px] text-muted-foreground max-h-24 overflow-y-auto font-mono">
                    {trips.slice(0, 5).map((t) => (
                      <div key={t.id}>
                        {t.id} · {t.day}/{t.slot} · cmf{t.comfortSurge ?? "—"}{" "}
                        ·{" "}
                        {t.address ?? `${t.lat.toFixed(4)},${t.lng.toFixed(4)}`}
                      </div>
                    ))}
                    {trips.length > 5 && <div>… и ещё {trips.length - 5}</div>}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.json,text/csv,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    data-testid="input-trips-file"
                  />
                  <Button
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                    className="gap-1"
                    data-testid="button-upload-trips"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Загрузить CSV/JSON
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDownloadSample}
                    data-testid="button-download-sample"
                  >
                    Пример CSV
                  </Button>
                  {trips.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={handleExportTripsCsv}
                      data-testid="button-export-trips-csv"
                      title="Скачать все мои поездки и замеры одним CSV"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Экспорт ({trips.length})
                    </Button>
                  )}
                  {trips.length > 0 && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-1"
                      onClick={() => {
                        if (
                          confirm("Удалить все загруженные поездки из браузера?")
                        ) {
                          clearUserTrips();
                          setLastImported(null);
                          setErrors([]);
                        }
                      }}
                      data-testid="button-clear-trips"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Очистить
                    </Button>
                  )}
                </div>

                {lastImported !== null && (
                  <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">
                    Импортировано записей: {lastImported}
                  </div>
                )}
                {errors.length > 0 && (
                  <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
                    <div className="font-semibold">
                      Предупреждения ({errors.length}):
                    </div>
                    {errors.slice(0, 8).map((e, i) => (
                      <div key={i}>· {e}</div>
                    ))}
                    {errors.length > 8 && (
                      <div>… и ещё {errors.length - 8}</div>
                    )}
                  </div>
                )}

                <div className="space-y-1">
                  <div className="font-semibold">Формат CSV</div>
                  <div>
                    Обязательные колонки: <code>id</code>, <code>lat</code>,{" "}
                    <code>lng</code>, <code>day</code>, <code>slot</code>,{" "}
                    <code>date</code>. Хотя бы одно из:{" "}
                    <code>comfortSurge</code>, <code>economSurge</code>,{" "}
                    <code>hiddenEconomSurge</code>.
                  </div>
                  <pre className="bg-background border rounded p-2 overflow-x-auto text-[10px]">
{SAMPLE_CSV}
                  </pre>
                </div>
              </div>
            </details>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
