import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useWbCurrentUser } from "@/lib/wb-auth";

type Tab = { href: string; label: string; roles?: Array<"admin" | "antifraud"> };

const adminTabs: Tab[] = [
  { href: "/wb", label: "Сводка" },
  { href: "/wb/clients", label: "Клиенты" },
  { href: "/wb/drivers", label: "Водители" },
  { href: "/wb/new-drivers", label: "Новые" },
  { href: "/wb/heatmaps", label: "Тепловые карты" },
  { href: "/wb/timeline", label: "Таймлайн" },
  { href: "/wb/fraud", label: "Фрод" },
  { href: "/wb/cases", label: "Кейсы" },
  { href: "/wb/driver-fraud-report", label: "Отчёт фрода" },
  { href: "/wb/graph", label: "Граф связей" },
  { href: "/wb/admin/users", label: "Сотрудники" },
];

// Антифродер работает с выданными кейсами и видит сводный отчёт по водителям.
// Сырые фрод-сигналы и «взять в работу» — это инструмент админа.
const antifraudTabs: Tab[] = [
  { href: "/wb/cases", label: "Мои кейсы" },
  { href: "/wb/driver-fraud-report", label: "Отчёт фрода" },
];

function isActive(loc: string, href: string): boolean {
  if (href === "/wb") return loc === "/wb";
  return loc === href || loc.startsWith(href + "/");
}

export function WbNav() {
  const [loc] = useLocation();
  const me = useWbCurrentUser();
  // Deny-by-default: пока роль не загружена, показываем минимальный набор
  // антифродера. Иначе антифродер на холодной загрузке успевает увидеть
  // admin-вкладки. У admin'а после первого логина me кэширован в
  // localStorage, поэтому мерцание для админа практически не возникает.
  const tabs = me?.role === "admin" ? adminTabs : antifraudTabs;
  return (
    <div className="border-b">
      <nav className="container mx-auto px-4 max-w-[1400px] flex flex-wrap gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const active = isActive(loc, t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap",
                active
                  ? "border-primary text-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              data-testid={`tab-${t.href.replace(/\//g, "-")}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
