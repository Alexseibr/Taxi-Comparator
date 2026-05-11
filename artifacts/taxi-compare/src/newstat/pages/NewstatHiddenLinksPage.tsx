import { useState, useEffect, useCallback } from "react";
import { NewstatLayout } from "../components/NewstatLayout";
import { newstatApi, type HiddenSignal, type HiddenCluster } from "../lib/api";

// ── helpers ──────────────────────────────────────────────────────────────────

function badge(cls: string, text: string) {
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded ${cls}`}>
      {text}
    </span>
  );
}

function SignalTypeBadge({ type }: { type: string }) {
  return type === "device"
    ? badge("bg-purple-100 text-purple-800", "device")
    : badge("bg-gray-100 text-gray-700", "ip");
}

function fmt(v: number) {
  return v.toLocaleString("ru-RU");
}

// ── Stats panel ───────────────────────────────────────────────────────────────

interface Stats {
  device_fingerprints: number;
  ip_links_total: number;
  device_signals: number;
  ip_signals: number;
  total_signals: number;
}

function StatsPanel({ stats, loading }: { stats: Stats | null; loading: boolean }) {
  if (loading) return <p className="text-slate-400 text-sm">Загрузка статистики…</p>;
  if (!stats) return null;
  const cards = [
    { label: "Отпечатков устройств", value: fmt(stats.device_fingerprints), color: "text-purple-700" },
    { label: "IP-записей", value: fmt(stats.ip_links_total), color: "text-blue-700" },
    { label: "Device-сигналов", value: fmt(stats.device_signals), color: "text-purple-700" },
    { label: "IP-сигналов", value: fmt(stats.ip_signals), color: "text-blue-700" },
    { label: "Всего сигналов", value: fmt(stats.total_signals), color: "text-slate-800 font-bold" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
      {cards.map((c) => (
        <div key={c.label} className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <p className="text-xs text-slate-500 mb-1">{c.label}</p>
          <p className={`text-2xl font-mono ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Signals table ─────────────────────────────────────────────────────────────

function SignalsTable({ signals, loading }: { signals: HiddenSignal[]; loading: boolean }) {
  if (loading) return <p className="text-slate-400 text-sm py-4">Загрузка…</p>;
  if (!signals.length)
    return (
      <div className="py-8 text-center text-slate-400 text-sm">
        Нет сигналов. Загрузите заказы с device/IP полями, затем нажмите «Пересчитать».
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase tracking-wide">
            <th className="px-3 py-2 border-b">Тип</th>
            <th className="px-3 py-2 border-b">Клиент A</th>
            <th className="px-3 py-2 border-b">Клиент B</th>
            <th className="px-3 py-2 border-b">Значение сигнала</th>
            <th className="px-3 py-2 border-b text-right">Сила</th>
            <th className="px-3 py-2 border-b">Обновлено</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((s) => (
            <tr key={s.id} className="border-b hover:bg-slate-50">
              <td className="px-3 py-2">
                <SignalTypeBadge type={s.signal_type} />
              </td>
              <td className="px-3 py-2 font-mono text-xs text-slate-700">{s.entity_a_id}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-700">{s.entity_b_id}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-400 max-w-[180px] truncate" title={s.signal_value}>
                {s.signal_value.slice(0, 20)}…
              </td>
              <td className="px-3 py-2 text-right font-semibold text-slate-800">{s.strength}</td>
              <td className="px-3 py-2 text-xs text-slate-400">
                {new Date(s.updated_at).toLocaleDateString("ru-RU")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Clusters table ────────────────────────────────────────────────────────────

function ClustersTable({ clusters, loading }: { clusters: HiddenCluster[]; loading: boolean }) {
  if (loading) return <p className="text-slate-400 text-sm py-4">Загрузка…</p>;
  if (!clusters.length)
    return (
      <div className="py-8 text-center text-slate-400 text-sm">
        Кластеров не найдено. Нужно &ge;2 клиентов с совпадающим устройством или IP.
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase tracking-wide">
            <th className="px-3 py-2 border-b">Тип</th>
            <th className="px-3 py-2 border-b">Размер</th>
            <th className="px-3 py-2 border-b">Клиенты в кластере</th>
            <th className="px-3 py-2 border-b">Ключ сигнала</th>
            <th className="px-3 py-2 border-b text-right">Макс. сила</th>
            <th className="px-3 py-2 border-b">Последний</th>
          </tr>
        </thead>
        <tbody>
          {clusters.map((c, i) => (
            <tr key={i} className="border-b hover:bg-slate-50">
              <td className="px-3 py-2">
                <SignalTypeBadge type={c.signal_type} />
              </td>
              <td className="px-3 py-2 text-center font-bold text-lg text-purple-700">{c.cluster_size}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-700 max-w-[260px]">
                {[...new Set(c.client_ids)].slice(0, 6).join(", ")}
                {[...new Set(c.client_ids)].length > 6 && ` +${[...new Set(c.client_ids)].length - 6}`}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-slate-400 max-w-[160px] truncate" title={c.signal_value}>
                {c.signal_value.slice(0, 20)}…
              </td>
              <td className="px-3 py-2 text-right font-semibold">{c.max_strength}</td>
              <td className="px-3 py-2 text-xs text-slate-400">
                {new Date(c.last_seen).toLocaleDateString("ru-RU")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "signals_device" | "signals_ip" | "clusters_device" | "clusters_ip";

export function NewstatHiddenLinksPage() {
  const [tab, setTab] = useState<Tab>("clusters_device");
  const [stats, setStats]         = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [signals, setSignals]     = useState<HiddenSignal[]>([]);
  const [clusters, setClusters]   = useState<HiddenCluster[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // load stats
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    const r = await newstatApi.hiddenLinksStats();
    if (r.ok && r.data) setStats(r.data as Stats);
    setStatsLoading(false);
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  // load tab data
  const loadTab = useCallback(async (t: Tab) => {
    setDataLoading(true);
    setSignals([]);
    setClusters([]);
    if (t === "signals_device" || t === "signals_ip") {
      const type = t === "signals_device" ? "device" : "ip";
      const r = await newstatApi.hiddenLinksSignals({ signal_type: type, limit: 300 });
      if (r.ok && r.data) setSignals((r.data as { signals: HiddenSignal[] }).signals ?? []);
    } else {
      const type = t === "clusters_device" ? "device" : "ip";
      const r = await newstatApi.hiddenLinksClusters({ signal_type: type, limit: 200 });
      if (r.ok && r.data) setClusters((r.data as { clusters: HiddenCluster[] }).clusters ?? []);
    }
    setDataLoading(false);
  }, []);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  // actions
  const doRecompute = async () => {
    setActionBusy(true);
    setMsg(null);
    const r = await newstatApi.hiddenLinksRecompute();
    if (r.ok && r.data) {
      const n = (r.data as { shared_signals: number }).shared_signals;
      setMsg({ text: `✅ Пересчёт завершён — ${n} shared_signals`, ok: true });
      loadStats();
      loadTab(tab);
    } else {
      const errMsg = !r.ok ? r.error : "unknown";
      setMsg({ text: `❌ Ошибка пересчёта: ${errMsg}`, ok: false });
    }
    setActionBusy(false);
  };

  const doCreateTickets = async () => {
    setActionBusy(true);
    setMsg(null);
    const r = await newstatApi.hiddenLinksCreateClusterTickets();
    if (r.ok && r.data) {
      const n = (r.data as { tickets_created: number }).tickets_created;
      setMsg({ text: `✅ Создано тикетов MULTI_ACCOUNT_DEVICE: ${n}`, ok: true });
    } else {
      const errMsg = !r.ok ? r.error : "unknown";
      setMsg({ text: `❌ Ошибка: ${errMsg}`, ok: false });
    }
    setActionBusy(false);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "clusters_device", label: "Кластеры (device)" },
    { id: "clusters_ip",     label: "Кластеры (IP)" },
    { id: "signals_device",  label: "Сигналы (device)" },
    { id: "signals_ip",      label: "Сигналы (IP)" },
  ];

  return (
    <NewstatLayout title="Скрытые связи (Hidden Links)">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Скрытые связи</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Выявление мульти-аккаунтов по общим устройствам и IP-адресам
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={doRecompute}
              disabled={actionBusy}
              className="px-3 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {actionBusy ? "…" : "⚡ Пересчитать сигналы"}
            </button>
            <button
              onClick={doCreateTickets}
              disabled={actionBusy}
              className="px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {actionBusy ? "…" : "🎫 Создать тикеты кластеров"}
            </button>
          </div>
        </div>

        {/* message */}
        {msg && (
          <div
            className={`text-sm px-4 py-2 rounded-lg ${
              msg.ok ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* stats */}
        <StatsPanel stats={stats} loading={statsLoading} />

        {/* how it works */}
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800 space-y-1">
          <p className="font-semibold">Как работает</p>
          <ul className="list-disc list-inside space-y-0.5 text-blue-700">
            <li>При загрузке заказов поля <code>ip_address</code>, <code>user_agent</code>, <code>platform</code>, <code>device_id</code> сохраняются в <code>device_fingerprints</code> и <code>ip_links</code></li>
            <li>«Пересчитать» строит <code>shared_signals</code> — пары клиентов с совпадающим устройством или IP</li>
            <li>Кластеры — группы &ge;2 клиентов с одним device_hash или IP</li>
            <li>«Создать тикеты» — для кластеров с 3+ клиентами + общим водителем создаёт тикет MULTI_ACCOUNT_DEVICE</li>
          </ul>
        </div>

        {/* tabs */}
        <div>
          <div className="flex gap-1 border-b mb-4">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm rounded-t-lg font-medium transition-colors ${
                  tab === t.id
                    ? "bg-white border border-b-white text-purple-700 border-slate-200 -mb-px"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
            {(tab === "signals_device" || tab === "signals_ip") ? (
              <SignalsTable signals={signals} loading={dataLoading} />
            ) : (
              <ClustersTable clusters={clusters} loading={dataLoading} />
            )}
          </div>
        </div>

        {/* upload hint */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-500 font-mono">
          <p className="font-semibold mb-1 text-slate-600 font-sans text-sm">Формат загрузки (пример заказа с device данными):</p>
          <pre className="overflow-x-auto">{JSON.stringify({
            order_id: "ORD-001",
            order_date: "2026-05-01",
            status: "completed",
            client_id: "c1",
            driver_id: "d1",
            ip_address: "192.168.1.100",
            user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17)",
            platform: "ios",
            device_id: "DEVICE-UUID-OPTIONAL",
          }, null, 2)}</pre>
        </div>
      </div>
    </NewstatLayout>
  );
}
