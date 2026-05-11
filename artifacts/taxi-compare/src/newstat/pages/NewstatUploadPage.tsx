import { useEffect, useState } from "react";
import { NewstatLayout } from "../components/NewstatLayout";
import { newstatApi, type UploadBatch, type UploadOrder } from "../lib/api";
import { useNewstatUser } from "../lib/auth-store";

export function NewstatUploadPage() {
  const { user } = useNewstatUser();
  const canUpload = user?.role === "admin" || user?.role === "antifraud";

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    msg: string;
    batch?: { id: string; total: number; inserted: number; updated: number; dates: string[] };
  } | null>(null);
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const [recomputeDate, setRecomputeDate] = useState("");

  async function loadBatches() {
    const r = await newstatApi.batches();
    if (r.ok) setBatches(r.data.batches);
  }
  useEffect(() => { void loadBatches(); }, []);

  async function submit() {
    setResult(null);
    let parsed: { source?: string; orders: UploadOrder[] };
    try {
      const j = JSON.parse(text);
      if (Array.isArray(j)) parsed = { orders: j as UploadOrder[] };
      else if (j && Array.isArray(j.orders)) parsed = j;
      else throw new Error("Ожидается массив заказов или объект {orders:[...]}");
    } catch (e) {
      setResult({ ok: false, msg: "Невалидный JSON: " + (e instanceof Error ? e.message : "") });
      return;
    }
    if (parsed.orders.length === 0) {
      setResult({ ok: false, msg: "Пустой массив orders" });
      return;
    }
    setBusy(true);
    const r = await newstatApi.upload(parsed.orders, parsed.source || "ui");
    setBusy(false);
    if (!r.ok) {
      setResult({ ok: false, msg: `Ошибка: ${r.error}` });
      return;
    }
    setResult({
      ok: true,
      msg: `Загружено ${r.data.total} строк (новых ${r.data.inserted}, обновлено ${r.data.updated}). ETL пересчитан для ${r.data.etl.dates} дат.`,
      batch: { id: r.data.batch_id, total: r.data.total, inserted: r.data.inserted, updated: r.data.updated, dates: r.data.dates },
    });
    setText("");
    await loadBatches();
  }

  async function doRecompute() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(recomputeDate)) {
      setResult({ ok: false, msg: "Дата в формате YYYY-MM-DD" });
      return;
    }
    setBusy(true);
    const r = await newstatApi.recompute([recomputeDate]);
    setBusy(false);
    setResult(
      r.ok
        ? { ok: true, msg: `ETL пересчитан для даты ${recomputeDate}` }
        : { ok: false, msg: `Ошибка: ${r.error}` },
    );
  }

  function loadSample() {
    const today = new Date().toISOString().slice(0, 10);
    setText(JSON.stringify({
      source: "sample",
      orders: [
        { order_id: "demo-1", order_date: today, status: "completed", payment_type: "noncash",
          driver_id: "demo-d1", driver_name: "Демо Иванов", client_id: "demo-c1",
          gmv: 25, km: 6, arrival_minutes: 5, trip_minutes: 14, created_at: today + "T10:00:00Z" },
        { order_id: "demo-2", order_date: today, status: "completed", payment_type: "noncash",
          driver_id: "demo-d1", client_id: "demo-c1",
          gmv: 18, km: 1.5, arrival_minutes: 2, trip_minutes: 7, created_at: today + "T11:00:00Z" },
        { order_id: "demo-3", order_date: today, status: "completed", payment_type: "cash",
          driver_id: "demo-d2", driver_name: "Демо Петров", client_id: "demo-c2",
          gmv: 30, km: 8, arrival_minutes: 4, trip_minutes: 18, created_at: today + "T12:00:00Z" },
      ],
    }, null, 2));
  }

  return (
    <NewstatLayout title="Импорт заказов">
      <p className="text-sm text-slate-600 mb-4 max-w-2xl">
        Источник — выгрузка из админки rwbtaxi.by или из CRM партнёров. Один POST принимает
        до 50 000 заказов. Импорт идемпотентный по <code className="text-xs">order_id</code>:
        повторная загрузка просто обновит существующие записи. После импорта автоматически
        пересчитываются дневные метрики для затронутых дат.
      </p>

      {!canUpload && (
        <div className="mb-4 text-sm rounded border border-amber-200 bg-amber-50 text-amber-800 p-2">
          Загружать данные могут только пользователи с ролями <b>admin</b> или <b>antifraud</b>.
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center mb-2">
            <h2 className="font-semibold">JSON со списком заказов</h2>
            <button onClick={loadSample} className="ml-auto text-xs text-blue-600 hover:underline">
              Вставить демо-набор
            </button>
          </div>
          <textarea
            className="w-full h-72 border rounded p-2 font-mono text-xs"
            value={text}
            placeholder='{"source": "manual", "orders": [{"order_id":"…","order_date":"2026-04-29","status":"completed",…}]}'
            onChange={(e) => setText(e.target.value)}
            disabled={!canUpload}
          />
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => void submit()}
              disabled={!canUpload || busy || !text.trim()}
              className="bg-slate-900 text-white text-sm rounded px-4 py-2 hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? "Загружаем…" : "Загрузить и пересчитать"}
            </button>
          </div>
          {result && (
            <div
              className={
                "mt-3 text-sm rounded border p-2 " +
                (result.ok
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-rose-50 border-rose-200 text-rose-800")
              }
            >
              {result.msg}
              {result.batch && (
                <div className="text-xs mt-1 text-slate-600">
                  batch_id: <code>{result.batch.id}</code> · даты: {result.batch.dates.join(", ")}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="font-semibold mb-2">Принудительный пересчёт ETL</h2>
          <p className="text-xs text-slate-500 mb-3">
            Используется, когда вы поменяли процент кэшбэка или пороги аномалий и хотите,
            чтобы прошлые даты пересчитались по новым параметрам.
          </p>
          <div className="flex gap-2 items-end">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Дата (YYYY-MM-DD)</label>
              <input
                type="date"
                value={recomputeDate}
                onChange={(e) => setRecomputeDate(e.target.value)}
                className="border rounded px-3 py-2 text-sm"
                disabled={user?.role !== "admin"}
              />
            </div>
            <button
              onClick={() => void doRecompute()}
              disabled={busy || user?.role !== "admin"}
              className="bg-slate-900 text-white text-sm rounded px-3 py-2 hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? "…" : "Пересчитать"}
            </button>
          </div>
          {user?.role !== "admin" && (
            <p className="text-xs text-slate-400 mt-2">Только для admin.</p>
          )}
        </section>
      </div>

      <section className="mt-6 bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="font-semibold mb-3">Последние загрузки</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left p-2 font-medium">Когда</th>
                <th className="text-left p-2 font-medium">Кто</th>
                <th className="text-left p-2 font-medium">Источник</th>
                <th className="text-right p-2 font-medium">Всего</th>
                <th className="text-right p-2 font-medium">Новых</th>
                <th className="text-right p-2 font-medium">Обновлено</th>
                <th className="text-left p-2 font-medium">batch_id</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 && (
                <tr><td colSpan={7} className="p-4 text-slate-500 italic">Пока нет загрузок</td></tr>
              )}
              {batches.map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="p-2 text-xs">{new Date(b.uploaded_at).toLocaleString("ru-RU")}</td>
                  <td className="p-2">{b.uploaded_by}</td>
                  <td className="p-2">{b.source}</td>
                  <td className="p-2 text-right tabular-nums">{b.total_rows ?? "—"}</td>
                  <td className="p-2 text-right tabular-nums">{b.inserted_rows ?? "—"}</td>
                  <td className="p-2 text-right tabular-nums">{b.duplicate_rows ?? "—"}</td>
                  <td className="p-2 text-xs font-mono text-slate-500 truncate max-w-[180px]">{b.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </NewstatLayout>
  );
}
