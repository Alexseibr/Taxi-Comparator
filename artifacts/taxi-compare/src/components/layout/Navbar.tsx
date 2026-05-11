import React from "react";
import { Link } from "wouter";
import { Car } from "lucide-react";

export default function Navbar() {
  return (
    <header className="hidden md:block sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center mx-auto px-4">
        <Link href="/" className="flex items-center space-x-2">
          <Car className="h-6 w-6 text-primary" />
          <span className="font-bold text-xl tracking-tight">Прогноз для анализа RWB Taxi</span>
          <span className="text-xs text-muted-foreground hidden sm:inline-block ml-2">
            · Минск
          </span>
        </Link>
      </div>
    </header>
  );
}
