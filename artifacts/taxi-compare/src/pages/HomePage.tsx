import { useEffect, useState, type FormEvent } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Car, LogOut } from "lucide-react";
import {
  fetchWbMe,
  getWbToken,
  onWbAuthChanged,
  wbLogin,
  wbLogout,
  type WbUser,
} from "@/lib/wb-api";
import { setStoredWbUser, useWbCurrentUser } from "@/lib/wb-auth";

import { APP_MODULES, filterModules, roleLabel } from "@/lib/module-access";

const LAST_MODULE_KEY = "wb_last_module_v1";

// Безопасная версия параметра ?next=... — принимаем только относительные пути,
// чтобы нельзя было увести юзера на чужой домен через open redirect.
function readSafeNext(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = new URL(window.location.href).searchParams.get("next");
    if (!raw) return null;
    const dec = decodeURIComponent(raw);
    if (!dec.startsWith("/")) return null;
    if (dec.startsWith("//")) return null;
    return dec;
  } catch {
    return null;
  }
}

export default function HomePage() {
  const me = useWbCurrentUser();
  // Один источник истины — наличие действительного токена. Подписываемся
  // на wb-auth-changed (логин, logout, 401-сброс) и storage-event (другая
  // вкладка), чтобы UI всегда отражал реальное состояние.
  const [hasToken, setHasToken] = useState<boolean>(() => getWbToken() !== null);

  useEffect(() => {
    const recheck = () => setHasToken(getWbToken() !== null);
    const offAuth = onWbAuthChanged(recheck);
    window.addEventListener("storage", recheck);
    window.addEventListener("focus", recheck);
    return () => {
      offAuth();
      window.removeEventListener("storage", recheck);
      window.removeEventListener("focus", recheck);
    };
  }, []);

  if (!hasToken) {
    return <LoginScreen onLoggedIn={onAfterLogin} />;
  }

  // Есть токен, но профиль ещё не подгружен — показываем загрузчик
  // с аварийной кнопкой выхода (на случай битой сессии).
  if (!me) {
    return (
      <FullScreen>
        <Card className="w-full max-w-sm p-6 space-y-3 text-center">
          <div className="text-sm text-muted-foreground">Загрузка профиля…</div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await wbLogout();
              setStoredWbUser(null);
            }}
            data-testid="btn-home-force-logout"
          >
            Выйти и войти заново
          </Button>
        </Card>
      </FullScreen>
    );
  }

  return <Menu user={me} />;
}

function onAfterLogin(u: WbUser) {
  setStoredWbUser(u);
  // Если юзер пришёл по защищённой ссылке — возвращаем его туда
  // (но только при наличии прав; иначе RouteGuard покажет «доступ запрещён»).
  const next = readSafeNext();
  if (next) {
    window.location.assign(next);
    return;
  }
  // Иначе: если у пользователя только один доступный модуль —
  // сразу проваливаем в него.
  const allowed = APP_MODULES.filter((m) => m.roles.includes(u.role));
  if (allowed.length === 1) {
    window.location.assign(allowed[0].href);
  }
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-[100dvh] flex items-center justify-center px-4"
      style={{
        background:
          "linear-gradient(135deg, #5b21b6 0%, #7c3aed 60%, #a855f7 100%)",
      }}
    >
      {children}
    </div>
  );
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: (u: WbUser) => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!login.trim() || !password) return;
    setBusy(true);
    setErr(null);
    const r = await wbLogin(login.trim(), password);
    if (!r.ok) {
      setBusy(false);
      setErr(
        r.error === "bad_credentials"
          ? "Неверный логин или пароль"
          : r.error === "wb_not_configured"
            ? "Сервер не настроен"
            : `Ошибка: ${r.error}`,
      );
      setPassword("");
      return;
    }
    try {
      const u = await fetchWbMe();
      setBusy(false);
      onLoggedIn(u);
    } catch {
      setBusy(false);
      setErr("Не удалось получить профиль");
    }
  }

  return (
    <FullScreen>
      <Card className="w-full max-w-sm p-6 sm:p-8 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg"
            style={{ backgroundColor: "#5b21b6", color: "#facc15" }}
            aria-hidden
          >
            <Car className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold">RWB Taxi</h1>
            <p className="text-xs text-muted-foreground">Вход в систему</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} autoComplete="on" className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="home-login">Логин</Label>
            <Input
              id="home-login"
              name="username"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
              data-testid="input-home-login"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="home-password">Пароль</Label>
            <Input
              id="home-password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              data-testid="input-home-password"
            />
          </div>
          {err && (
            <div className="text-sm text-rose-600" role="alert" data-testid="text-home-error">
              {err}
            </div>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !login.trim() || !password}
            data-testid="btn-home-login"
          >
            {busy ? "Проверяю…" : "Войти"}
          </Button>
        </form>
      </Card>
    </FullScreen>
  );
}

function Menu({ user }: { user: WbUser }) {
  const allowed = APP_MODULES.filter((m) => m.roles.includes(user.role));
  const [moduleQuery, setModuleQuery] = useState("");
  const visible = filterModules(allowed, moduleQuery);
  const lastModuleKey =
    typeof window !== "undefined" ? window.localStorage.getItem(LAST_MODULE_KEY) : null;
  const lastModule = allowed.find((m) => m.key === lastModuleKey) ?? null;

  async function handleLogout() {
    await wbLogout();
    setStoredWbUser(null);
    // wbLogout эмитит wb-auth-changed → подписка в HomePage сама
    // переключит экран на LoginScreen без явного setHasToken.
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-violet-50 via-white to-violet-100">
      <header className="border-b bg-white/80 backdrop-blur">
        <div className="container mx-auto max-w-[1100px] px-4 h-14 flex items-center gap-3">
          <Car className="h-5 w-5 text-violet-700" />
          <span className="font-bold tracking-tight">RWB Taxi</span>
          <span className="text-xs text-muted-foreground">· Минск</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user.displayName} · {roleLabel(user.role)}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleLogout}
              data-testid="btn-home-logout"
            >
              <LogOut className="h-4 w-4" />
              <span>Выйти</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-[1100px] px-4 py-8 sm:py-12">
        <h1 className="text-2xl sm:text-3xl font-bold mb-1">Куда заходим?</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Выберите модуль. Переключиться можно в любой момент через шапку модуля.
        </p>

        {lastModule && (
          <Card className="mb-4 p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 border-violet-200">
            <div className="text-sm text-muted-foreground">Последний открытый модуль:</div>
            <a
              href={lastModule.href}
              onClick={() => {
                try {
                  window.localStorage.setItem(LAST_MODULE_KEY, lastModule.key);
                } catch {
                  /* noop */
                }
              }}
              className="text-sm font-medium text-violet-700 hover:underline"
              data-testid="link-last-module"
            >
              {lastModule.title}
            </a>
          </Card>
        )}

        <div className="mb-4">
          <Input
            value={moduleQuery}
            onChange={(e) => setModuleQuery(e.target.value)}
            placeholder="Поиск по модулям"
            data-testid="input-module-search"
            className="max-w-md"
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {visible.map((m) => {
            const Icon = m.icon;
            return (
              <a
                key={m.key}
                href={m.href}
                className="block group"
                data-testid={`tile-${m.key}`}
                onClick={() => {
                  try {
                    window.localStorage.setItem(LAST_MODULE_KEY, m.key);
                  } catch {
                    /* noop */
                  }
                }}
              >
                <Card className="p-5 h-full transition-all border-violet-200 hover:border-violet-500 hover:shadow-lg hover:-translate-y-0.5">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-base group-hover:text-violet-700">
                        {m.title}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {m.desc}
                      </div>
                    </div>
                  </div>
                </Card>
              </a>
            );
          })}
        </div>

        {allowed.length === 0 && (
          <Card className="p-6 mt-2">
            <h2 className="font-semibold mb-1">Нет доступных модулей</h2>
            <p className="text-sm text-muted-foreground">
              Обратитесь к администратору — для вашей роли пока не настроены модули.
            </p>
          </Card>
        )}

        {allowed.length > 0 && visible.length === 0 && (
          <Card className="p-6 mt-2" data-testid="empty-module-search">
            <h2 className="font-semibold mb-1">Ничего не найдено</h2>
            <p className="text-sm text-muted-foreground">
              Измените поисковый запрос, чтобы увидеть доступные модули.
            </p>
          </Card>
        )}
      </main>
    </div>
  );
}

