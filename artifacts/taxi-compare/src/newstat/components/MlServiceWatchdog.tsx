import { useEffect, useState } from "react";
import { Link } from "wouter";
import { newstatApi } from "../lib/api";

const POLL_MS = 60_000;

// Глобальный баннер: если Python ML-сервис недоступен — показать оператору.
// Антифрод по правилам продолжает работать, ML — нет (predict/rescore упадут).
export function MlServiceWatchdog() {
  const [down, setDown]       = useState<boolean>(false);
  const [checked, setChecked] = useState<boolean>(false);
  const [detail, setDetail]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      const r = await newstatApi.mlStatus();
      if (cancelled) return;
      setChecked(true);
      if (!r.ok) {
        setDown(true);
        setDetail(r.error);
      } else {
        setDown(!r.data.ml_service_ok);
        setDetail(
          r.data.ml_service_ok
            ? null
            : (r.data.ml_health_detail?.error || "ml /health failed"),
        );
      }
      timer = setTimeout(tick, POLL_MS);
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!checked || !down) return null;

  return (
    <div
      role="alert"
      className="border-b border-amber-300 bg-amber-100 text-amber-900"
      data-testid="ml-watchdog-banner"
    >
      <div className="mx-auto max-w-7xl px-4 py-2 flex items-center gap-3 text-sm">
        <span aria-hidden className="text-amber-700">⚠</span>
        <span className="font-medium">ML-сервис недоступен.</span>
        <span className="text-amber-800/80">
          Антифрод по правилам работает, но ML-предсказания и rescore временно не проходят.
        </span>
        {detail && (
          <span className="text-xs text-amber-700/70 hidden md:inline truncate max-w-xs" title={detail}>
            ({detail})
          </span>
        )}
        <Link
          href="/newstat/ml"
          className="ml-auto text-amber-900 underline hover:no-underline whitespace-nowrap"
        >
          ML управление →
        </Link>
      </div>
    </div>
  );
}
