import { useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsAdmin } from "@/lib/admin-auth";
import { getWbToken, wbLogin } from "@/lib/wb-api";

// Захардкоженные креды доступа в WB-модуль. Так задумано (вариант 2):
// после входа в админ-панель нажатие даёт прямой переход в /wb без второй
// формы пароля. Бандл публичный, но WB-эндпоинты всё равно проверяют JWT
// на бэке, так что сам пароль здесь — лишь удобный «ключ автологина».
const WB_LOGIN = "Admin";
const WB_PASSWORD = "39903990aSs$$";
const WB_PATH = "/wb";

type Variant = "desktop" | "mobile";

type Props = {
  variant?: Variant;
  className?: string;
  onBeforeNavigate?: () => void;
};

export function AdminWbLaunchButton({
  variant = "desktop",
  className,
  onBeforeNavigate,
}: Props) {
  const isAdmin = useIsAdmin();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!isAdmin) return null;

  const isMobile = variant === "mobile";

  async function open() {
    setErr(null);
    if (getWbToken()) {
      onBeforeNavigate?.();
      window.location.href = WB_PATH;
      return;
    }
    setBusy(true);
    const r = await wbLogin(WB_LOGIN, WB_PASSWORD);
    setBusy(false);
    if (!r.ok) {
      setErr(
        r.error === "bad_credentials"
          ? "Креды WB не подходят (поменялись?)"
          : r.error === "wb_not_configured"
            ? "WB на бэке не настроен"
            : `Ошибка входа в WB: ${r.error}`,
      );
      return;
    }
    onBeforeNavigate?.();
    window.location.href = WB_PATH;
  }

  if (isMobile) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          className={`w-full justify-start gap-2 h-9 border-violet-300 text-violet-700 hover:bg-violet-50 ${className ?? ""}`}
          onClick={open}
          disabled={busy}
          data-testid="btn-mobile-wb-launch"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <BarChart3 className="h-4 w-4" />
          )}
          {busy ? "Вход в WB…" : "📊 Данные WB"}
        </Button>
        {err && (
          <div className="text-[11px] text-rose-600 px-1 mt-1" data-testid="text-mobile-wb-launch-error">
            {err}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-0.5">
      <Button
        size="sm"
        variant="outline"
        className={`text-xs h-8 gap-1 border-violet-300 text-violet-700 hover:bg-violet-50 ${className ?? ""}`}
        onClick={open}
        disabled={busy}
        data-testid="btn-wb-launch"
        title="Открыть модуль данных WB Такси (автологин)"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <BarChart3 className="h-3.5 w-3.5" />
        )}
        {busy ? "Вход…" : "Данные WB"}
      </Button>
      {err && (
        <div className="text-[10px] text-rose-600 px-0.5" data-testid="text-wb-launch-error">
          {err}
        </div>
      )}
    </div>
  );
}
