import { Button } from "@/components/ui/button";
import { Home, LogOut } from "lucide-react";
import { clearWbToken } from "@/lib/wb-api";
import { setStoredWbUser, useWbCurrentUser } from "@/lib/wb-auth";

type Props = {
  title: string;
};

// Тонкая шапка над модулями (WB-статистика, антифрод). Содержит кнопку
// возврата в главное меню (смена модуля) и кнопку выхода.
export function ModuleHeader({ title }: Props) {
  const me = useWbCurrentUser();
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

  const handleHome = () => window.location.assign(`${base}/`);
  const handleLogout = () => {
    clearWbToken();
    setStoredWbUser(null);
    window.location.assign(`${base}/`);
  };

  return (
    <div className="border-b bg-background/95 backdrop-blur sticky top-0 z-40">
      <div className="container mx-auto max-w-[1400px] px-4 h-12 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 -ml-2"
          onClick={handleHome}
          data-testid="btn-module-home"
          title="Сменить модуль"
        >
          <Home className="h-4 w-4" />
          <span className="hidden sm:inline">В меню</span>
        </Button>
        <div className="font-semibold text-sm sm:text-base truncate">{title}</div>
        <div className="ml-auto flex items-center gap-2">
          {me && (
            <span className="text-xs text-muted-foreground hidden md:inline">
              {me.displayName} · {roleLabel(me.role)}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleLogout}
            data-testid="btn-module-logout"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Выйти</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function roleLabel(r: "admin" | "antifraud" | "viewer"): string {
  if (r === "admin") return "админ";
  if (r === "antifraud") return "антифрод";
  return "просмотр";
}
