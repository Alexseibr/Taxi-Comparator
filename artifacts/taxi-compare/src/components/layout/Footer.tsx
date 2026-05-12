import React from "react";

const APP_VERSION = import.meta.env.VITE_APP_VERSION as string | undefined;

export default function Footer() {
  return (
    <footer className="hidden md:block border-t bg-muted/20 mt-auto">
      <div className="container mx-auto px-4 py-3 flex flex-col sm:flex-row justify-between items-center gap-2 text-center sm:text-left">
        <p className="text-xs text-muted-foreground max-w-2xl">
          Минск, RWB Taxi. Базовый тариф — формула, сёрджи — наблюдения / прогнозы.
          Реальные цены могут отличаться из-за пробок и местного спроса.
        </p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {APP_VERSION && (
            <span className="font-mono opacity-60">v{APP_VERSION}</span>
          )}
          <span>Map © OpenStreetMap contributors</span>
        </div>
      </div>
    </footer>
  );
}
