import { Link, useLocation } from "wouter";
import { type ReactNode, useEffect, useState } from "react";
import { useNewstatUser } from "../lib/auth-store";
import { MlServiceWatchdog } from "./MlServiceWatchdog";
import { newstatApi } from "../lib/api";

interface Props {
  title: string;
  children: ReactNode;
  /** если true — содержимое доступно без логина (login-страница) */
  publicAccess?: boolean;
}

const NAV_STATIC = [
  { to: "/newstat/workbench", label: "🛠 Рабочее место" },
  { to: "/newstat", label: "Деньги" },
  { to: "/newstat/guarantee", label: "Гарантия" },
  { to: "/newstat/risks", label: "Водители" },
  { to: "/newstat/clients-risk", label: "Клиенты" },
  { to: "/newstat/pairs-risk", label: "Связки" },
  { to: "/newstat/graph", label: "Граф" },
  { to: "/newstat/hidden-links", label: "Скрытые связи" },
  { to: "/newstat/tickets", label: "Тикеты" },
  { to: "/newstat/ml-disagreements", label: "ML расхождения" },
  { to: "/newstat/ml", label: "ML" },
  { to: "/newstat/upload", label: "Импорт" },
  { to: "/newstat/settings", label: "Настройки" },
];

export function NewstatLayout({ title, children, publicAccess = false }: Props) {
  const [loc, navigate] = useLocation();
  const { user, loading, signOut } = useNewstatUser();
  const [mlMode, setMlMode] = useState<string | null>(null);

  // Загружаем ml_mode для условного показа ML labeling
  useEffect(() => {
    if (!user) return;
    newstatApi.mlLabelsSummary().then((r) => {
      if (r.ok) setMlMode(r.data.settings?.ml_mode ?? null);
    }).catch(() => {});
  }, [user?.login]);

  const nav = [
    ...NAV_STATIC,
    // ML labeling — только в TRAINING режиме
    ...(mlMode === "TRAINING" ? [{ to: "/newstat/ml-labeling", label: "ML labeling" }] : []),
    // T006: управление пользователями — только админу
    ...(user?.role === "admin" ? [{ to: "/newstat/admin/users", label: "Сотрудники" }] : []),
  ];

  // Защита маршрута: если не публичная страница и не залогинен — кидаем на /newstat/login
  if (!publicAccess && !loading && !user && loc !== "/newstat/login") {
    navigate("/newstat/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-4">
          <div className="font-semibold text-lg">RWB Taxi · Newstat</div>
          <span className="text-xs text-slate-500 hidden sm:inline">
            новый модуль фрод-анализа (BETA)
          </span>
          <div className="ml-auto text-xs text-slate-500 flex items-center gap-3">
            {user && (
              <>
                <span className="hidden sm:inline">
                  {user.name} <span className="text-slate-400">· {user.role}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="text-rose-600 hover:underline"
                >
                  выйти
                </button>
              </>
            )}
            <Link href="/" className="hover:underline">
              ← на главную
            </Link>
          </div>
        </div>
        {user && !publicAccess && loc !== "/newstat/login" && <MlServiceWatchdog />}
        {user && (
          <nav className="mx-auto max-w-7xl px-4 pb-2 flex gap-1 overflow-x-auto">
            {nav.map((n) => {
              const active = loc === n.to || (n.to !== "/newstat" && loc.startsWith(n.to));
              return (
                <Link
                  key={n.to}
                  href={n.to}
                  className={
                    "px-3 py-1.5 rounded text-sm whitespace-nowrap transition-colors " +
                    (active
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100")
                  }
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <h1 className="text-2xl font-semibold mb-4">{title}</h1>
        {children}
      </main>
    </div>
  );
}
