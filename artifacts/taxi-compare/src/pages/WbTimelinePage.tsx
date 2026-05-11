import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchWbTimeline,
  type WbTimelineBucketKind,
  type WbTimelineResponse,
} from "@/lib/wb-api";
import { WbTimelineChart } from "@/components/wb/WbTimelineChart";
import { WbOrdersTable } from "@/components/wb/WbOrdersTable";
import { WbShell } from "@/components/wb/WbShell";

const BUCKET_OPTS: Array<{ value: WbTimelineBucketKind; label: string }> = [
  { value: "10m", label: "10 минут" },
  { value: "30m", label: "30 минут" },
  { value: "1h", label: "1 час" },
];

function fmtIso(s: string | null): string {
  if (!s) return "—";
  return s.replace("T", " ").slice(0, 16);
}

function Inner() {
  const [bucket, setBucket] = useState<WbTimelineBucketKind>("1h");
  const [data, setData] = useState<WbTimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedMs, setSelectedMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setError(null);
    setSelectedMs(null);
    fetchWbTimeline({ bucket })
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || "load_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bucket]);

  const totals = useMemo(() => {
    if (!data) return null;
    let c = 0,
      x = 0,
      o = 0;
    for (const b of data.buckets) {
      c += b.completed;
      x += b.cancelled;
      o += b.open;
    }
    return { completed: c, cancelled: x, open: o };
  }, [data]);

  const selectedBucket = useMemo(() => {
    if (!data || selectedMs == null) return null;
    return data.buckets.find((b) => b.ms === selectedMs) || null;
  }, [data, selectedMs]);

  const drillRange = useMemo(() => {
    if (selectedMs == null || !data) return null;
    return {
      fromTs: new Date(selectedMs).toISOString(),
      toTs: new Date(selectedMs + data.bucketMs).toISOString(),
    };
  }, [selectedMs, data]);

  return (
    <div className="container mx-auto p-4 space-y-4 max-w-[1400px]">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Таймлайн заказов</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Сформированные заказы во времени с разбивкой по статусам. Выберите
            сетку, наведите на столбец для деталей, кликните — увидите все
            заказы интервала.
          </p>
        </div>
        <div className="ml-auto flex flex-col items-end gap-2">
          <div className="flex gap-1">
            {BUCKET_OPTS.map((o) => (
              <Button
                key={o.value}
                size="sm"
                variant={bucket === o.value ? "default" : "outline"}
                onClick={() => setBucket(o.value)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        {error ? (
          <div className="text-sm text-red-600">Ошибка загрузки: {error}</div>
        ) : loading || !data ? (
          <div className="text-sm text-muted-foreground py-10 text-center">
            Загружаю таймлайн…
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-green-600 inline-block" />
                <span>Выполнено</span>
                {totals && (
                  <b className="ml-1 text-green-700">{totals.completed}</b>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-yellow-500 inline-block" />
                <span>Открыто</span>
                {totals && (
                  <b className="ml-1 text-yellow-700">{totals.open}</b>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-red-600 inline-block" />
                <span>Отменено</span>
                {totals && (
                  <b className="ml-1 text-red-700">{totals.cancelled}</b>
                )}
              </div>
              <div className="ml-auto text-muted-foreground text-right">
                {data.total.toLocaleString("ru-RU")} заказов в{" "}
                {data.buckets.length} интервалах
                <br />
                <span className="text-[11px]">
                  {fmtIso(data.from)} — {fmtIso(data.to)} (UTC)
                </span>
              </div>
            </div>
            <WbTimelineChart
              buckets={data.buckets}
              bucketKind={data.bucket}
              selectedMs={selectedMs}
              onSelect={setSelectedMs}
            />
            <div className="text-xs text-muted-foreground">
              Кликните по столбцу — откроется список заказов в этом интервале.
              Повторный клик снимет выделение.
            </div>
          </>
        )}
      </Card>

      {drillRange && selectedBucket && (
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">
              Интервал {fmtIso(selectedBucket.ts)} (
              {bucket === "10m" ? "10 мин" : bucket === "30m" ? "30 мин" : "1 час"}
              )
            </h2>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-green-700">
                выполнено: <b>{selectedBucket.completed}</b>
              </span>
              <span className="text-yellow-700">
                открыто: <b>{selectedBucket.open}</b>
              </span>
              <span className="text-red-700">
                отмен: <b>{selectedBucket.cancelled}</b>
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setSelectedMs(null)}
            >
              Закрыть ×
            </Button>
          </div>
          <WbOrdersTable
            fromTs={drillRange.fromTs}
            toTs={drillRange.toTs}
          />
        </Card>
      )}
    </div>
  );
}

export default function WbTimelinePage() {
  return (
    <WbShell>
      <Inner />
    </WbShell>
  );
}
