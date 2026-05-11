import { type ReactNode } from "react";
import { ModuleHeader } from "@/components/ModuleHeader";
import { WbNav } from "@/components/wb/WbNav";

// Обёртка для всех /wb-страниц. Общая авторизация теперь живёт на главной
// странице (HomePage), сюда приходит только уже залогиненный пользователь
// (RouteGuard в App.tsx гарантирует это).
export function WbShell({
  children,
  title = "ВБ Такси",
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <>
      <ModuleHeader title={title} />
      <WbNav />
      {children}
    </>
  );
}
