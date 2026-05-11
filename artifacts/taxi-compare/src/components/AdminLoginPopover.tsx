import { useState, type FormEvent } from "react";
import { Lock, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsAdmin, tryAdminLogin, logoutAdmin } from "@/lib/admin-auth";

type Props = {
  className?: string;
};

export function AdminLoginPopover({ className }: Props) {
  const isAdmin = useIsAdmin();
  const [open, setOpen] = useState(false);
  const [login, setLogin] = useState("");
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isAdmin) {
    return (
      <Button
        size="sm"
        variant="outline"
        className={`gap-1.5 text-xs h-8 ${className ?? ""}`}
        onClick={() => logoutAdmin()}
        data-testid="btn-desktop-logout"
        title="Выйти из админ-режима"
      >
        <LogOut className="h-3.5 w-3.5" />
        Выйти
      </Button>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const ok = await tryAdminLogin(login, pwd);
      if (ok) {
        setOpen(false);
        setLogin("");
        setPwd("");
      } else {
        setErr("Неверный логин или пароль");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setErr(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={`gap-1.5 text-xs h-8 ${className ?? ""}`}
          data-testid="btn-desktop-admin-login"
        >
          <Lock className="h-3.5 w-3.5" />
          Войти как админ
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3 z-[1100]">
        <form onSubmit={handleSubmit} className="space-y-2" autoComplete="on">
          <div className="text-xs font-semibold flex items-center gap-1.5 mb-1">
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
            autoFocus
            className="w-full text-sm rounded border px-2 py-1.5 outline-none focus:border-primary"
            data-testid="input-desktop-admin-login"
          />
          <input
            type="password"
            name="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder="Пароль"
            autoComplete="current-password"
            className="w-full text-sm rounded border px-2 py-1.5 outline-none focus:border-primary"
            data-testid="input-desktop-admin-password"
          />
          {err && (
            <div className="text-xs text-red-600 px-0.5" data-testid="text-admin-login-error">
              {err}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              type="submit"
              size="sm"
              className="flex-1 h-8 text-xs"
              disabled={busy || !login || !pwd}
              data-testid="btn-desktop-admin-submit"
            >
              {busy ? "Проверка…" : "Войти"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
