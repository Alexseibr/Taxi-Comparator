import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "newstat.date";
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function readFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get("date");
    return v && ISO_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

function readFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v && ISO_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

function writeToUrl(value: string): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("date", value);
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    /* noop */
  }
}

function writeToStorage(value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* noop */
  }
}

function initialValue(): string {
  return readFromUrl() ?? readFromStorage() ?? todayIso();
}

export function useNewstatDate(): [string, (next: string) => void] {
  const [date, setDateState] = useState<string>(initialValue);

  useEffect(() => {
    if (!ISO_RE.test(date)) return;
    writeToStorage(date);
    writeToUrl(date);
  }, [date]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue || !ISO_RE.test(e.newValue)) return;
      setDateState(e.newValue);
    };
    const onPopState = () => {
      const fromUrl = readFromUrl();
      if (fromUrl) setDateState(fromUrl);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  const setDate = useCallback((next: string) => {
    if (!ISO_RE.test(next)) return;
    setDateState(next);
  }, []);

  return [date, setDate];
}
