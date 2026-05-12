import type { ReactNode } from "react";
import { ModuleHeader } from "@/components/ModuleHeader";

type Props = {
  children: ReactNode;
  title?: string;
};

export function WbShell({ children, title = "Управление" }: Props) {
  return (
    <div className="min-h-screen bg-background">
      <ModuleHeader title={title} />
      <div className="container mx-auto max-w-[1100px] px-4 py-4">
        {children}
      </div>
    </div>
  );
}
