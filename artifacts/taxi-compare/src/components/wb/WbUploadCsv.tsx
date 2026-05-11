import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { uploadWbCsv } from "@/lib/wb-api";

type Props = { onUploaded?: () => void };

export function WbUploadCsv({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setResult(null);
    try {
      const text = await file.text();
      const r = await uploadWbCsv(text);
      if (r.ok) {
        setResult(
          `Готово: добавлено ${r.added} (распарсено ${r.parsed}, дублей ${r.dups}, ошибок ${r.bad}). Батч ${r.batchId}.`,
        );
        onUploaded?.();
      } else {
        setResult(`Ошибка: ${r.error}`);
      }
    } catch (e: any) {
      setResult(`Не удалось прочитать файл: ${e?.message || "unknown"}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div>
        <div className="text-sm font-medium">Загрузить выгрузку CSV (ВБ Такси)</div>
        <div className="text-xs text-muted-foreground mt-1">
          Файл в формате <code>order_id,order_date,order_create_date_time,…</code>.
          Дубликаты по order_id отфильтровываются автоматически.
        </div>
      </div>
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
          data-testid="input-wb-csv"
        />
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          data-testid="button-wb-upload"
        >
          {busy ? "Загружаю…" : "Выбрать CSV-файл"}
        </Button>
        {result && (
          <div className="text-sm" data-testid="text-wb-upload-result">
            {result}
          </div>
        )}
      </div>
    </Card>
  );
}
