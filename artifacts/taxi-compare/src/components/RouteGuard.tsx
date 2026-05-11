import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWbCurrentUser } from "@/lib/wb-auth";
import { getWbToken } from "@/lib/wb-api";
import type { WbRole } from "@/lib/wb-api";

type Props = {
  roles: WbRole[];
  children: ReactNode;
};

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

// Универсальная защита роутов модулей. Если токена нет — отправляем на главную
// (там форма входа), сохраняя путь возврата в `?next=...`. Если роль не
// подходит — показываем «Доступ запрещён» с кнопкой возврата в меню.
export function RouteGuard({ roles, children }: Props) {
  const me = useWbCurrentUser();
  const token = typeof window !== "undefined" ? getWbToken() : null;

  if (!token) {
    if (typeof window !== "undefined") {
      const here = window.location.pathname + window.location.search + window.location.hash;
      const next = encodeURIComponent(here);
      window.location.replace(`${BASE}/?next=${next}`);
    }
    return null;
  }

  if (!me) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        Загрузка профиля…
      </div>
    );
  }

  if (!roles.includes(me.role)) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <Card className="w-full max-w-md p-6 space-y-3">
          <h1 className="text-lg font-semibold">Доступ запрещён</h1>
          <p className="text-sm text-muted-foreground">
            У вашей роли «{roleLabel(me.role)}» нет доступа к этому модулю.
            Вернитесь в главное меню и выберите доступный раздел.
          </p>
          <Button
            className="w-full"
            onClick={() => window.location.assign(`${BASE}/`)}
            data-testid="btn-back-to-menu"
          >
            ← В главное меню
          </Button>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}

function roleLabel(r: WbRole): string {
  if (r === "admin") return "админ";
  if (r === "antifraud") return "антифрод";
  return "просмотр карты";
}
