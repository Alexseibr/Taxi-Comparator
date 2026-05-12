import { useEffect, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Car, LogOut, ArrowRight } from "lucide-react";
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

  if (!me) {
    return (
      <FullScreen>
        <div className="w-full max-w-sm rounded-2xl bg-white/10 backdrop-blur border border-white/20 p-6 space-y-3 text-center text-white">
          <div className="text-sm text-white/60">Загрузка профиля…</div>
          <Button
            variant="outline"
            size="sm"
            className="border-white/30 text-white/80 hover:bg-white/10 bg-transparent"
            onClick={async () => {
              await wbLogout();
              setStoredWbUser(null);
            }}
            data-testid="btn-home-force-logout"
          >
            Выйти и войти заново
          </Button>
        </div>
      </FullScreen>
    );
  }

  return <Menu user={me} />;
}

function onAfterLogin(u: WbUser) {
  setStoredWbUser(u);
  const next = readSafeNext();
  if (next) {
    window.location.assign(next);
    return;
  }
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
          "linear-gradient(135deg, #3b0764 0%, #5b21b6 50%, #7c3aed 100%)",
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
      <div className="w-full max-w-sm rounded-2xl bg-white/10 backdrop-blur-xl border border-white/20 p-6 sm:p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl shadow-lg"
            style={{ background: "linear-gradient(135deg, #7c3aed, #5b21b6)" }}
            aria-hidden
          >
            <Car className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">RWB Taxi</h1>
            <p className="text-xs text-white/50">Аналитическая платформа</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} autoComplete="on" className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="home-login" className="text-white/70 text-xs">Логин</Label>
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
              className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-violet-400"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="home-password" className="text-white/70 text-xs">Пароль</Label>
            <Input
              id="home-password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              data-testid="input-home-password"
              className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-violet-400"
            />
          </div>
          {err && (
            <div className="text-sm text-rose-300 bg-rose-500/20 rounded-lg px-3 py-2" role="alert" data-testid="text-home-error">
              {err}
            </div>
          )}
          <Button
            type="submit"
            className="w-full bg-violet-600 hover:bg-violet-500 text-white border-0"
            disabled={busy || !login.trim() || !password}
            data-testid="btn-home-login"
          >
            {busy ? "Проверяю…" : "Войти"}
          </Button>
        </form>
      </div>
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
  }

  return (
    <div
      className="min-h-[100dvh] flex flex-col"
      style={{ background: "linear-gradient(160deg, #0f0520 0%, #150a2e 40%, #1a0f3a 100%)" }}
    >
      {/* Header */}
      <header className="border-b border-white/8 bg-black/20 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto max-w-[1100px] px-4 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-md shadow-violet-900/50">
              <Car className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold tracking-tight text-white">RWB Taxi</span>
            <span className="text-xs text-white/30 hidden sm:inline">· Минск</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-white/40 hidden sm:inline">
              {user.displayName} · {roleLabel(user.role)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-white/60 hover:text-white hover:bg-white/10"
              onClick={handleLogout}
              data-testid="btn-home-logout"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Выйти</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="border-b border-white/8">
        <div className="container mx-auto max-w-[1100px] px-4 py-10 sm:py-14">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-2">
            Куда заходим?
          </h1>
          <p className="text-white/40 text-sm sm:text-base">
            Выберите модуль. Переключиться можно в любой момент через шапку модуля.
          </p>
        </div>
      </div>

      <main className="container mx-auto max-w-[1100px] px-4 py-8 flex-1">
        {/* Last module */}
        {lastModule && (() => {
          const LastIcon = lastModule.icon;
          return (
            <a
              href={lastModule.href}
              onClick={() => { try { window.localStorage.setItem(LAST_MODULE_KEY, lastModule.key); } catch { /* noop */ } }}
              className="group mb-6 flex items-center gap-4 rounded-xl border border-violet-500/25 bg-violet-500/8 hover:border-violet-400/50 hover:bg-violet-500/15 transition-all p-4"
              data-testid="link-last-module"
            >
              <div className="h-10 w-10 rounded-xl bg-violet-600/30 border border-violet-500/30 flex items-center justify-center shrink-0 group-hover:bg-violet-600/50 transition-colors">
                <LastIcon className="h-5 w-5 text-violet-300" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-white/35 uppercase tracking-wider mb-0.5">Продолжить</div>
                <div className="text-sm font-semibold text-violet-200 group-hover:text-violet-100 transition-colors">
                  {lastModule.title}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-violet-400/60 group-hover:text-violet-300 group-hover:translate-x-0.5 transition-all shrink-0" />
            </a>
          );
        })()}

        {/* Search */}
        <div className="mb-5">
          <Input
            value={moduleQuery}
            onChange={(e) => setModuleQuery(e.target.value)}
            placeholder="Поиск по модулям…"
            data-testid="input-module-search"
            className="max-w-sm bg-white/5 border-white/12 text-white placeholder:text-white/25 focus-visible:ring-violet-500 focus-visible:border-violet-500/50"
          />
        </div>

        {/* Module grid */}
        <div className="grid sm:grid-cols-2 gap-4">
          {visible.map((m) => {
            const Icon = m.icon;
            return (
              <a
                key={m.key}
                href={m.href}
                className="block group"
                data-testid={`tile-${m.key}`}
                onClick={() => { try { window.localStorage.setItem(LAST_MODULE_KEY, m.key); } catch { /* noop */ } }}
              >
                <div className="rounded-xl border border-white/10 bg-white/4 p-6 h-full transition-all duration-200 group-hover:border-violet-500/40 group-hover:bg-violet-950/40 group-hover:-translate-y-0.5 group-hover:shadow-xl group-hover:shadow-violet-950/60">
                  <div className="flex items-start gap-4">
                    <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-700 text-white shadow-lg shadow-violet-900/40 group-hover:shadow-violet-800/60 transition-shadow" style={{ height: "52px", width: "52px" }}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <div className="font-semibold text-base text-white group-hover:text-violet-200 transition-colors leading-tight">
                        {m.title}
                      </div>
                      <div className="text-sm text-white/45 mt-1.5 leading-relaxed">
                        {m.desc}
                      </div>
                    </div>
                  </div>
                </div>
              </a>
            );
          })}
        </div>

        {allowed.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/4 p-6 mt-2">
            <h2 className="font-semibold mb-1 text-white">Нет доступных модулей</h2>
            <p className="text-sm text-white/45">
              Обратитесь к администратору — для вашей роли пока не настроены модули.
            </p>
          </div>
        )}

        {allowed.length > 0 && visible.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/4 p-6 mt-2" data-testid="empty-module-search">
            <h2 className="font-semibold mb-1 text-white">Ничего не найдено</h2>
            <p className="text-sm text-white/45">
              Измените поисковый запрос, чтобы увидеть доступные модули.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
