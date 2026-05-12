import { useState, type FormEvent } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Menu,
  Navigation,
  Lock,
  LogOut,
  Calendar,
  Database,
  CheckCircle2,
  Sparkles,
  HelpCircle,
  FileJson,
  FileSpreadsheet,
  Calculator,
  Camera,
  TrendingUp,
  MapPin,
  AlertTriangle,
  Layers,
  BookOpen,
} from "lucide-react";
import { AdminPriceMonitorButton } from "@/components/AdminPriceMonitor";
import { useIsAdmin, tryAdminLogin, logoutAdmin } from "@/lib/admin-auth";
import { useWbCurrentUser } from "@/lib/wb-auth";
import { SCHEDULE_DAYS, type ScheduleDay } from "@/lib/zones";
import { BasemapPicker } from "@/components/BasemapPicker";

interface Props {
  scheduleDay: ScheduleDay;
  onScheduleDayChange: (d: ScheduleDay) => void;
  measuredCount: number;
  predictedCount: number;
  observationCount: number;
  trafficProvider: string | null;
  onOpenRoute: () => void;
  onOpenTrips: () => void;
  onOpenCalculator: () => void;
  onOpenMethodology: () => void;
  onOpenLeaveOneOut: () => void;
  onOpenCalibCompare: () => void;
  onOpenCoverageMap: () => void;
  onOpenAnomalyReport: () => void;
  onOpenHolesInfo: () => void;
  holesLayerOn: boolean;
  onToggleHolesLayer: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
}

/**
 * Гамбургер-меню для мобильной версии. Содержит всё, что не помещается
 * в верхней панели карты. Технические разделы (методология, экспорт,
 * сверка с Я.) открываются только после входа под админ-логином.
 */
export function MobileMenuSheet(p: Props) {
  const [open, setOpen] = useState(false);
  const isAdmin = useIsAdmin();
  // wb-залогиненный пользователь (rwb) — может отправлять скрины, поэтому
  // ему полезно видеть «куда сейчас нужны скрины» (карту приоритетных дыр).
  const wbUser = useWbCurrentUser();
  const [showLogin, setShowLogin] = useState(false);
  const [login, setLogin] = useState("Admin");
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const ok = await tryAdminLogin(login, pwd);
      if (ok) {
        setShowLogin(false);
        setPwd("");
        setErr("");
      } else {
        setErr("Неверный логин или пароль");
        setPwd("");
      }
    } catch {
      setErr("Ошибка проверки. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  function go(fn: () => void) {
    setOpen(false);
    // Даём Sheet время закрыться, потом открываем диалог.
    window.setTimeout(fn, 80);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          data-testid="button-mobile-menu"
          aria-label="Меню"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[300px] sm:w-[340px] flex flex-col p-0"
      >
        <SheetHeader className="px-4 pt-4 pb-2 border-b">
          <SheetTitle className="text-base">Меню</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* Главные действия — наверху, чтобы пользователь сразу видел
              «фотоаппарат» (журнал/добавить) и не листал вниз. */}
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Действия
            </h3>
            <div className="space-y-1.5">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 h-10"
                onClick={() => go(p.onOpenTrips)}
                data-testid="btn-mobile-trips"
              >
                <BookOpen className="h-4 w-4 text-blue-600" />
                Журнал поездок и скринов
              </Button>
              <Button
                variant={p.holesLayerOn ? "default" : "outline"}
                size="sm"
                className={`w-full justify-start gap-2 h-10 ${
                  p.holesLayerOn ? "" : "border-primary/30 bg-primary/5"
                }`}
                onClick={() => {
                  setOpen(false);
                  window.setTimeout(p.onToggleHolesLayer, 80);
                }}
                data-testid="btn-mobile-holes-toggle"
              >
                <MapPin className="h-4 w-4" />
                {p.holesLayerOn ? "Скрыть дыры с карты" : "Показать дыры на карте"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 h-9 text-xs text-muted-foreground"
                onClick={() => go(p.onOpenHolesInfo)}
                data-testid="btn-mobile-holes-info"
              >
                <HelpCircle className="h-4 w-4" />
                Что такое «дыры»? (как помочь)
              </Button>
              {/* Кнопка для калибраторов (rwb-логин): показывает топ-приоритетов
                  где сейчас не хватает скринов — какая зона + какой час пик.
                  У админа дублируется в админ-секции ниже, у обычного rwb —
                  единственный путь увидеть «куда сейчас идти снимать». */}
              {wbUser && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 h-10 border-amber-300 bg-amber-50/60 hover:bg-amber-50"
                  onClick={() => go(p.onOpenCoverageMap)}
                  data-testid="btn-mobile-coverage-map-public"
                >
                  <MapPin className="h-4 w-4 text-amber-700" />
                  Где сейчас нужны скрины (приоритеты)
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 h-10"
                onClick={() => go(p.onOpenRoute)}
                data-testid="btn-mobile-route"
              >
                <Navigation className="h-4 w-4" />
                Маршрут А → Б
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 h-10"
                onClick={() => go(p.onOpenCalculator)}
                data-testid="btn-mobile-calc"
              >
                <Calculator className="h-4 w-4" />
                Калькулятор тарифа
              </Button>
            </div>
          </section>

          {/* День недели */}
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Calendar className="h-3 w-3" /> День недели
            </h3>
            <div className="grid grid-cols-7 gap-px border rounded-md overflow-hidden text-[11px]">
              {SCHEDULE_DAYS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => p.onScheduleDayChange(d.id)}
                  data-testid={`btn-mobile-day-${d.id}`}
                  className={`px-1 py-2 font-medium transition-colors ${
                    p.scheduleDay === d.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {d.short}
                </button>
              ))}
            </div>
          </section>

          {/* Подложка карты */}
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Layers className="h-3 w-3" /> Подложка карты
            </h3>
            <BasemapPicker variant="grid" />
          </section>

          {/* Покрытие данными */}
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Покрытие данными
            </h3>
            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              <div className="border rounded px-2 py-2 text-center">
                <div className="flex items-center justify-center gap-1 font-semibold">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  {p.measuredCount}
                </div>
                <div className="text-muted-foreground text-[9px] uppercase tracking-wide mt-0.5">
                  замер
                </div>
              </div>
              <div className="border rounded px-2 py-2 text-center">
                <div className="flex items-center justify-center gap-1 font-semibold">
                  <Sparkles className="w-3 h-3 text-violet-600" />
                  {p.predictedCount}
                </div>
                <div className="text-muted-foreground text-[9px] uppercase tracking-wide mt-0.5">
                  прогноз
                </div>
              </div>
              <div className="border rounded px-2 py-2 text-center">
                <div className="flex items-center justify-center gap-1 font-semibold">
                  <Database className="w-3 h-3 text-sky-600" />+
                  {p.observationCount}
                </div>
                <div className="text-muted-foreground text-[9px] uppercase tracking-wide mt-0.5">
                  наблюд.
                </div>
              </div>
            </div>
            {p.trafficProvider && (
              <div className="mt-2 text-[10px] text-emerald-700 flex items-center gap-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600"></span>
                </span>
                {p.trafficProvider} — real-time пробки активны
              </div>
            )}
          </section>

          {/* Админ */}
          {isAdmin && (
            <section className="border-t pt-4 -mx-4 px-4">
              <h3 className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Lock className="h-3 w-3" /> Админ
              </h3>
              <div className="space-y-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 h-9"
                  onClick={() => go(p.onOpenMethodology)}
                  data-testid="btn-mobile-method"
                >
                  <HelpCircle className="h-4 w-4" />
                  Methodology (как считаем)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 h-9"
                  onClick={() => go(p.onOpenLeaveOneOut)}
                  data-testid="btn-mobile-loo"
                >
                  <TrendingUp className="h-4 w-4" />
                  Сверка с Yandex (LOO)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 h-9"
                  onClick={() => go(p.onOpenCalibCompare)}
                  data-testid="btn-mobile-calib-compare"
                >
                  <TrendingUp className="h-4 w-4" />
                  Скрины: план / факт
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 h-9"
                  onClick={() => go(p.onOpenCoverageMap)}
                  data-testid="btn-mobile-coverage-map"
                >
                  <MapPin className="h-4 w-4" />
                  Карта дыр (приоритеты)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 h-9"
                  onClick={() => go(p.onOpenAnomalyReport)}
                  data-testid="btn-mobile-anomaly-report"
                >
                  <AlertTriangle className="h-4 w-4 text-rose-600" />
                  AI-куратор и аномалии
                </Button>
                <AdminPriceMonitorButton
                  variant="full"
                  onBeforeOpen={() => setOpen(false)}
                />

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 h-9"
                  onClick={() => go(p.onExportJson)}
                  data-testid="btn-mobile-export-json"
                >
                  <FileJson className="h-4 w-4" />
                  Экспорт JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 h-9"
                  onClick={() => go(p.onExportCsv)}
                  data-testid="btn-mobile-export-csv"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Экспорт CSV
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 h-9 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    logoutAdmin();
                  }}
                  data-testid="btn-mobile-logout"
                >
                  <LogOut className="h-4 w-4" />
                  Выйти из админки
                </Button>
              </div>
            </section>
          )}

          {/* Логин */}
          {!isAdmin && (
            <section className="border-t pt-4 -mx-4 px-4">
              {!showLogin ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowLogin(true)}
                  data-testid="btn-mobile-admin-login"
                >
                  <Lock className="h-4 w-4" /> Войти как админ
                </Button>
              ) : (
                <form
                  onSubmit={handleLogin}
                  className="space-y-2 border rounded-md p-3 bg-muted/30"
                  autoComplete="on"
                >
                  <div className="text-xs font-semibold flex items-center gap-1.5">
                    <Lock className="h-3 w-3" /> Вход для администратора
                  </div>
                  <input
                    type="text"
                    name="username"
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    placeholder="Логин"
                    autoComplete="username"
                    spellCheck={false}
                    autoCapitalize="off"
                    className="w-full text-sm rounded border px-2 py-1.5 outline-none focus:border-primary"
                    data-testid="input-admin-login"
                  />
                  <input
                    type="password"
                    name="password"
                    value={pwd}
                    onChange={(e) => setPwd(e.target.value)}
                    placeholder="Пароль"
                    autoComplete="current-password"
                    autoFocus
                    className="w-full text-sm rounded border px-2 py-1.5 outline-none focus:border-primary"
                    data-testid="input-admin-pwd"
                  />
                  {err && (
                    <div
                      className="text-[11px] text-red-600"
                      data-testid="text-admin-err"
                    >
                      {err}
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <Button
                      type="submit"
                      size="sm"
                      disabled={busy}
                      className="flex-1"
                      data-testid="btn-admin-submit"
                    >
                      {busy ? "Проверяю…" : "Войти"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setShowLogin(false);
                        setPwd("");
                        setErr("");
                      }}
                    >
                      Отмена
                    </Button>
                  </div>
                </form>
              )}
            </section>
          )}

          {/* Описание для пользователя */}
          <section className="border-t pt-4 -mx-4 px-4 text-[11px] text-muted-foreground space-y-1.5 leading-relaxed">
            <p className="font-semibold text-foreground">Как работает</p>
            <p>
              Карта показывает прогноз сёрджа Yandex Go (множителя цены) по
              Минску для Эконом и Комфорт. Цвет каждого гексагона — типичная
              цена на выбранный день недели и время.
            </p>
            <p>
              Чтобы помочь нам уточнить прогноз — нажмите{" "}
              <span className="text-blue-600 font-semibold">
                синюю кнопку 📷
              </span>{" "}
              и приложите 1–5 скринов экрана выбора тарифа из мобильного
              приложения Яндекса. Цены распознаются автоматически.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
