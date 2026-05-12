import type { ComponentType } from "react";
import { Camera, Map as MapIcon } from "lucide-react";
import type { WbRole } from "@/lib/wb-api";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export type AppModule = {
  key: string;
  title: string;
  desc: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  roles: WbRole[];
};

export const APP_MODULES: AppModule[] = [
  {
    key: "pryan",
    title: "Прогноз тарифов",
    desc: "Тепловая карта surge по Минску, расчёт стоимости и сверка с Я.Такси.",
    href: `${BASE}/pryan`,
    icon: MapIcon,
    roles: ["admin", "viewer"],
  },
  {
    key: "uploader-stats",
    title: "Моя статистика",
    desc: "Сколько скринов вы загрузили за сегодня/неделю/месяц, ваше место в рейтинге, кнопка быстрой загрузки.",
    href: `${BASE}/uploader`,
    icon: Camera,
    roles: ["uploader", "admin"],
  },
];

export function roleLabel(role: WbRole): string {
  if (role === "admin") return "админ";
  if (role === "uploader") return "загрузчик";
  return "просмотр карты";
}


export function filterModules(modules: AppModule[], query: string): AppModule[] {
  const q = query.trim().toLowerCase();
  if (!q) return modules;
  return modules.filter((m) => `${m.title} ${m.desc}`.toLowerCase().includes(q));
}
