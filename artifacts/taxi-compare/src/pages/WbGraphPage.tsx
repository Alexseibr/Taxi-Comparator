import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import ForceGraph2D from "react-force-graph-2d";
import {
  fetchWbGraph,
  analyzeWbGraph,
  type WbGraphResponse,
  type WbGraphNode,
  type WbGraphEdge,
  type WbGraphAnalysis,
  type WbGraphFinding,
} from "@/lib/wb-api";
import { WbShell } from "@/components/wb/WbShell";
import { WbNav } from "@/components/wb/WbNav";
import {
  WbDateRangePicker,
  rangeFromPreset,
  type WbDateRangeValue,
} from "@/components/wb/WbDateRangePicker";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

// Цвета по типам узлов.
const COLOR = {
  client: "#38bdf8", // голубой
  driver: "#fb923c", // оранжевый
  franch: "#22c55e", // зелёный
  focus: "#ef4444", // красный — обводка focus-узла
  flagged: "#dc2626", // густо-красный — узел, помеченный AI
};

// Базовые цвета рёбер (по типу). Для подсветки/затемнения мы пересобираем
// rgba прямо в линковом колбэке — не в этом словаре.
const EDGE_RGB = {
  "client-driver": "100, 116, 139", // slate
  "driver-franch": "22, 163, 74", // зелёный
  "driver-driver": "234, 88, 12", // оранжево-красный
};

// Кривизна рёбер для разделения параллельных линий.
const LINK_CURVATURE = 0.18;

// Топ-N узлов по trips, для которых подпись рисуем ВСЕГДА (а не только при зуме).
const ALWAYS_LABEL_TOP_N = 10;

// Состояние, восстанавливаемое из URL.
function parseQuery(): {
  focus: string;
  depth: 1 | 2;
  minWeight: number;
  includeFranchs: boolean;
} {
  if (typeof window === "undefined")
    return { focus: "", depth: 1, minWeight: 1, includeFranchs: false };
  const q = new URLSearchParams(window.location.search);
  const d = Number(q.get("depth"));
  const mw = Number(q.get("minWeight"));
  // ВАЖНО: парки по умолчанию ВЫКЛЮЧЕНЫ — иначе зелёные хабы
  // перекрывают всю остальную сеть. Включаются только осознанно.
  // Если в URL ?includeFranchs=1 — включаем.
  return {
    focus: (q.get("focus") || "").trim(),
    depth: d === 2 ? 2 : 1,
    minWeight: Number.isFinite(mw) && mw > 0 ? Math.min(10, mw) : 1,
    includeFranchs: q.get("includeFranchs") === "1",
  };
}

function pushQuery(params: Record<string, string | number | boolean | null>) {
  const q = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === "" || v === false) q.delete(k);
    else q.set(k, String(v));
  }
  const next = `${window.location.pathname}${q.toString() ? `?${q.toString()}` : ""}`;
  window.history.replaceState(null, "", next);
}

function fmtBYN(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type Sim = WbGraphNode & { x?: number; y?: number; vx?: number; vy?: number };
type SimEdge = Omit<WbGraphEdge, "source" | "target"> & {
  source: string | Sim;
  target: string | Sim;
  __curvature?: number;
};

// Подпись по русски.
function kindRu(k: WbGraphNode["kind"]): string {
  if (k === "client") return "Клиент";
  if (k === "driver") return "Водитель";
  return "Парк";
}
function edgeRu(k: WbGraphEdge["kind"]): string {
  if (k === "client-driver") return "Клиент↔водитель";
  if (k === "driver-franch") return "Водитель↔парк";
  return "Водитель↔водитель (общий клиент)";
}

// Логарифмический радиус узлов: разница между trips=5 и trips=500
// уже не катастрофическая (sqrt давал 30 vs 4 → перекрытие).
function nodeRadius(n: Pick<Sim, "trips">): number {
  const t = Math.max(1, n.trips || 1);
  return 4 + Math.log2(t + 1) * 2.4; // ~4..30
}

// Толщина ребра — log от веса (а не sqrt, чтобы «жирные» не превращались в кляксы).
function linkWidth(e: Pick<SimEdge, "weight">): number {
  const w = Math.max(1, e.weight || 1);
  return Math.min(7, 1.2 + Math.log2(w + 1) * 1.4);
}

// ──────────────────────────────────────────────────────────────────────────

export default function WbGraphPage() {
  const [, navigate] = useLocation();
  const [range, setRange] = useState<WbDateRangeValue>(() =>
    rangeFromPreset("last7d"),
  );
  const [query, setQuery] = useState(() => parseQuery());
  const { focus, depth, minWeight, includeFranchs } = query;

  // Поля поиска для нового focus.
  const [pickKind, setPickKind] = useState<"client" | "driver" | "franch">(
    () => {
      const m = focus.match(/^(client|driver|franch):/);
      return (m?.[1] as "client" | "driver" | "franch") || "driver";
    },
  );
  const [pickId, setPickId] = useState<string>(() => {
    const m = focus.match(/^(?:client|driver|franch):(.+)$/);
    return m?.[1] || "";
  });

  const [data, setData] = useState<WbGraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hovered, setHovered] = useState<WbGraphNode | null>(null);

  // AI-анализ.
  const [analysis, setAnalysis] = useState<WbGraphAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisErr, setAnalysisErr] = useState<string | null>(null);
  const [activeFindingIdx, setActiveFindingIdx] = useState<number | null>(null);

  // Контейнер для адаптивного размера канваса.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({
        width: Math.max(320, Math.floor(r.width)),
        height: Math.max(360, Math.floor(r.height)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Версия активного запроса анализа — нужна, чтобы устаревший ответ (из
  // запроса по «старому» графу) не перезаписал результат для текущего.
  // Инкрементируется при каждом новом fetchWbGraph и при каждом runAnalysis.
  const analysisReqId = useRef(0);

  // Загрузка графа.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    // Сбрасываем AI-анализ при смене параметров — он привязан к конкретному графу.
    // Инкрементируем версию, чтобы любой in-flight runAnalysis выбросил свой ответ.
    analysisReqId.current += 1;
    setAnalysis(null);
    setAnalysisErr(null);
    setAnalyzing(false);
    setActiveFindingIdx(null);
    // Сброс hover-подсветки — иначе на новом графе остаётся «залипший» dim.
    setHovered(null);
    hoverLinkSet.current = new Set();
    hoverNodeSet.current = new Set();
    fetchWbGraph({
      fromTs: range.fromTs ?? undefined,
      toTs: range.toTs ?? undefined,
      focus: focus || null,
      depth,
      minWeight,
      includeFranchs,
      limit: 250,
    })
      .then((r) => {
        if (cancelled) return;
        setData(r);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range.fromTs, range.toTs, focus, depth, minWeight, includeFranchs]);

  // Готовим данные для force-graph: создаём свежие объекты на каждый
  // ответ (библиотека их мутирует и подменяет source/target ссылками).
  // Дополнительно: для пар узлов с >1 ребром раскладываем кривизну
  // в разные стороны (+/-curvature), чтобы линии не сливались.
  const graphData = useMemo(() => {
    if (!data) return { nodes: [] as Sim[], links: [] as SimEdge[] };
    const nodes: Sim[] = data.nodes.map((n) => ({ ...n }));
    // Подсчёт параллельных рёбер по неупорядоченной паре концов.
    const pairCount = new Map<string, number>();
    const pairIdx = new Map<string, number>();
    for (const e of data.edges) {
      const k = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
      pairCount.set(k, (pairCount.get(k) || 0) + 1);
    }
    const links: SimEdge[] = data.edges.map((e) => {
      const k = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
      const total = pairCount.get(k) || 1;
      const idx = pairIdx.get(k) || 0;
      pairIdx.set(k, idx + 1);
      let curv = 0;
      if (total > 1) {
        // Раскладываем idx по диапазону [-LINK_CURVATURE, +LINK_CURVATURE].
        curv =
          LINK_CURVATURE *
          (idx - (total - 1) / 2) *
          (2 / Math.max(1, total - 1));
      }
      return { ...e, __curvature: curv };
    });
    return { nodes, links };
  }, [data]);

  const focusKey = useMemo(() => {
    const m = focus.match(/^(client|driver|franch):(.+)$/);
    return m ? `${m[1][0]}:${m[2]}` : null;
  }, [focus]);

  // Топ-N узлов по trips: для них подпись рисуем всегда.
  const alwaysLabelIds = useMemo(() => {
    if (!data) return new Set<string>();
    return new Set(
      [...data.nodes]
        .sort((a, b) => b.trips - a.trips)
        .slice(0, ALWAYS_LABEL_TOP_N)
        .map((n) => n.id),
    );
  }, [data]);

  // ── Подсветка: либо ховер на узле, либо активный AI-finding ──
  // hoverLinks/hoverNodes — Set строковых id.
  const hoverLinkSet = useRef<Set<string>>(new Set());
  const hoverNodeSet = useRef<Set<string>>(new Set());

  // Узлы, помеченные AI-анализом (для красной обводки).
  const flaggedNodes = useMemo(() => {
    const set = new Set<string>();
    if (!analysis) return set;
    for (const f of analysis.findings) for (const id of f.nodeIds) set.add(id);
    return set;
  }, [analysis]);

  // Узлы для активного finding (для подсветки сети).
  const activeFindingNodes = useMemo(() => {
    if (analysis && activeFindingIdx !== null) {
      const f = analysis.findings[activeFindingIdx];
      if (f) return new Set(f.nodeIds);
    }
    return new Set<string>();
  }, [analysis, activeFindingIdx]);

  // Реф на ForceGraph2D — используем для настройки d3-сил и zoomToFit.
  const fgRef = useRef<unknown>(null);

  // Настраиваем силы один раз при готовности графа.
  useEffect(() => {
    if (!graphData.nodes.length) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fg = fgRef.current as any;
    if (!fg) return;
    try {
      // Толкаем узлы сильнее → разносим кучу.
      fg.d3Force("charge")?.strength(-220);
      // Длиннее линки → меньше «склеивания».
      fg.d3Force("link")?.distance(85);
    } catch {
      /* SSR / pre-mount — игнор */
    }
    // Перезапустим симуляцию с прогревом, чтобы пересобралось красиво.
    try {
      fg.d3ReheatSimulation?.();
    } catch {
      /* ignore */
    }
  }, [graphData]);

  // Когда выбираем finding из AI-анализа — приближаем камеру к его узлам.
  useEffect(() => {
    if (activeFindingNodes.size === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fg = fgRef.current as any;
    if (!fg) return;
    setTimeout(() => {
      try {
        fg.zoomToFit?.(
          400,
          80,
          (n: Sim) => activeFindingNodes.has(n.id),
        );
      } catch {
        /* ignore */
      }
    }, 80);
  }, [activeFindingNodes]);

  // ── Колбэки UI ──
  const applyFocus = useCallback((next: string | null) => {
    const v = next || "";
    setQuery((q) => ({ ...q, focus: v }));
    pushQuery({ focus: v });
  }, []);

  const handleNodeClick = useCallback(
    (n: object) => {
      const node = n as Sim;
      applyFocus(`${node.kind}:${node.label}`);
      if (node.kind !== "franch") {
        setPickKind(node.kind);
        setPickId(node.label);
      }
    },
    [applyFocus],
  );

  const handleNodeRightClick = useCallback(
    (n: object, ev: MouseEvent) => {
      ev.preventDefault();
      const node = n as Sim;
      if (node.kind === "client") navigate(`/wb/client/${node.label}`);
      else if (node.kind === "driver") navigate(`/wb/driver/${node.label}`);
      else if (node.kind === "franch") navigate(`/wb/franch/${node.label}`);
    },
    [navigate],
  );

  const handleNodeHover = useCallback(
    (n: object | null) => {
      const node = n as Sim | null;
      setHovered(node);
      // Пересоберём множества подсветки.
      const hl = new Set<string>();
      const hn = new Set<string>();
      if (node && data) {
        hn.add(node.id);
        for (const e of data.edges) {
          const sId = typeof e.source === "string" ? e.source : (e.source as Sim).id;
          const tId = typeof e.target === "string" ? e.target : (e.target as Sim).id;
          if (sId === node.id || tId === node.id) {
            hl.add(`${sId}|${tId}`);
            hn.add(sId);
            hn.add(tId);
          }
        }
      }
      hoverLinkSet.current = hl;
      hoverNodeSet.current = hn;
    },
    [data],
  );

  // ── Вызов AI-анализа ──
  const runAnalysis = useCallback(async () => {
    if (!data || data.nodes.length === 0) return;
    // Защита от race: фиксируем «версию» этого запроса. Если за время ожидания
    // граф перезагрузился (другой период/фокус), useEffect инкрементирует
    // analysisReqId.current и наш ответ будет выброшен.
    const myId = ++analysisReqId.current;
    setAnalyzing(true);
    setAnalysisErr(null);
    setActiveFindingIdx(null);
    try {
      const period =
        range.fromTs && range.toTs
          ? `${range.fromTs}..${range.toTs}`
          : range.fromTs
            ? `с ${range.fromTs}`
            : range.toTs
              ? `до ${range.toTs}`
              : "";
      const r = await analyzeWbGraph({
        nodes: data.nodes,
        edges: data.edges,
        period,
        focus: focus || null,
      });
      if (myId !== analysisReqId.current) return; // stale ответ
      setAnalysis(r);
    } catch (e) {
      if (myId !== analysisReqId.current) return; // stale ошибка
      const msg = String((e as Error)?.message || e);
      let pretty = msg;
      if (msg === "gemini_not_configured") {
        pretty = "На сервере не задан GOOGLE_API_KEY — AI-анализ недоступен.";
      } else if (msg.startsWith("analyze_failed:rate_limited")) {
        pretty = "Слишком часто. Подождите минуту и попробуйте снова.";
      } else if (msg.startsWith("analyze_failed:rate_limited_global")) {
        pretty = "Достигнут общий лимит анализов на сегодня. Попробуйте завтра.";
      }
      setAnalysisErr(pretty);
    } finally {
      if (myId === analysisReqId.current) setAnalyzing(false);
    }
  }, [data, range.fromTs, range.toTs, focus]);

  return (
    <WbShell>
      <WbNav />
      <div className="container mx-auto px-4 max-w-[1500px] py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h1 className="text-2xl font-bold">Граф связей</h1>
            <p className="text-sm text-muted-foreground">
              Клиенты, водители (и опционально парки) — как сеть. Толщина
              ребра — число совместных заказов, размер узла — общая активность.{" "}
              <span className="text-amber-700">
                Клик по узлу — перефокусировать. ПКМ — открыть карточку.
              </span>
            </p>
          </div>
          <WbDateRangePicker value={range} onChange={setRange} />
        </div>

        {/* Контролы фильтрации */}
        <Card className="p-3 mb-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Тип</Label>
              <select
                className="block h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={pickKind}
                onChange={(e) =>
                  setPickKind(e.target.value as "client" | "driver" | "franch")
                }
                data-testid="select-graph-kind"
              >
                <option value="client">Клиент</option>
                <option value="driver">Водитель</option>
                <option value="franch">Парк</option>
              </select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">ID</Label>
              <Input
                className="h-9 w-40"
                placeholder="например 457795"
                value={pickId}
                onChange={(e) => setPickId(e.target.value.trim())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && pickId)
                    applyFocus(`${pickKind}:${pickId}`);
                }}
                data-testid="input-graph-id"
              />
            </div>
            <Button
              size="sm"
              onClick={() => pickId && applyFocus(`${pickKind}:${pickId}`)}
              data-testid="button-graph-apply"
            >
              Сфокусировать
            </Button>
            {focus && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyFocus(null)}
                data-testid="button-graph-reset"
              >
                Сбросить фокус
              </Button>
            )}

            <div className="w-px h-9 bg-border mx-1" />

            <div>
              <Label className="text-xs text-muted-foreground">Глубина</Label>
              <div className="flex gap-1">
                {[1, 2].map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    variant={depth === d ? "default" : "outline"}
                    onClick={() => {
                      setQuery((q) => ({ ...q, depth: d as 1 | 2 }));
                      pushQuery({ depth: d });
                    }}
                    data-testid={`button-depth-${d}`}
                  >
                    {d}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">
                Мин. совместных заказов
              </Label>
              <Input
                type="number"
                min={1}
                max={10}
                className="h-9 w-20"
                value={minWeight}
                onChange={(e) => {
                  const v = Math.max(
                    1,
                    Math.min(10, Number(e.target.value) || 1),
                  );
                  setQuery((q) => ({ ...q, minWeight: v }));
                  pushQuery({ minWeight: v });
                }}
                data-testid="input-min-weight"
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={includeFranchs}
                onCheckedChange={(v) => {
                  setQuery((q) => ({ ...q, includeFranchs: v }));
                  pushQuery({ includeFranchs: v ? "1" : null });
                }}
                data-testid="switch-include-franchs"
              />
              <Label className="text-sm">Показывать парки</Label>
            </div>

            <div className="w-px h-9 bg-border mx-1" />

            <Button
              size="sm"
              variant="default"
              onClick={runAnalysis}
              disabled={
                analyzing || loading || !data || data.nodes.length === 0
              }
              data-testid="button-graph-analyze"
              title="Отправить текущий граф в Gemini и получить разбор подозрительных паттернов"
            >
              {analyzing ? "Анализ…" : "🤖 Анализ AI"}
            </Button>

            <div className="ml-auto text-xs text-muted-foreground">
              {data && (
                <>
                  {data.stats.totalNodes} узлов · {data.stats.totalEdges} рёбер
                  {data.stats.truncated && (
                    <span className="text-amber-700">
                      {" "}
                      · обрезано до лимита
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Легенда */}
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
            <LegendDot color={COLOR.client} label="Клиент" />
            <LegendDot color={COLOR.driver} label="Водитель" />
            <LegendDot color={COLOR.franch} label="Парк" />
            <LegendDot color={COLOR.flagged} label="Помечен AI" outlined />
            <span className="text-muted-foreground">
              · линии: серые = клиент↔водитель, зелёные = водитель↔парк,
              оранжевые = водитель↔водитель (общие клиенты, при глубине 2)
            </span>
          </div>
        </Card>

        {err && (
          <Card className="p-3 mb-3 text-sm text-red-700 bg-red-50 border-red-200">
            Ошибка загрузки: {err}
          </Card>
        )}
        {data && focus && data.focusFound === false && (
          <Card className="p-3 mb-3 text-sm text-amber-800 bg-amber-50 border-amber-200">
            За выбранный период по фокусу <b>{focus}</b> заказов не найдено —
            проверьте ID и диапазон дат.
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
          <Card className="p-0 overflow-hidden">
            <div
              ref={wrapRef}
              className="w-full bg-slate-50"
              style={{ height: "calc(100vh - 360px)", minHeight: 480 }}
              data-testid="graph-canvas-wrap"
            >
              {graphData.nodes.length === 0 && !loading ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-6 text-center">
                  Нет данных для отображения. Попробуйте другой фокус, период
                  или меньший минимум совместных заказов.
                </div>
              ) : (
                <ForceGraph2D
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ref={fgRef as any}
                  width={size.width}
                  height={size.height}
                  graphData={graphData}
                  backgroundColor="#f8fafc"
                  nodeLabel={(n: object) => {
                    const node = n as Sim;
                    return `${kindRu(node.kind)} ${node.label} · заказов ${node.trips} · GMV ${fmtBYN(node.gmv)} BYN`;
                  }}
                  nodeRelSize={4}
                  nodeColor={(n: object) => {
                    const node = n as Sim;
                    // Если есть активный hover/finding и узел НЕ в подсветке — приглушаем.
                    const hasHover = hoverNodeSet.current.size > 0;
                    const hasFinding = activeFindingNodes.size > 0;
                    const inHover = hoverNodeSet.current.has(node.id);
                    const inFinding = activeFindingNodes.has(node.id);
                    const dim =
                      (hasHover && !inHover) || (hasFinding && !inFinding);
                    const base = COLOR[node.kind];
                    return dim ? base + "55" : base; // "55" — alpha 33%
                  }}
                  nodeVal={(n: object) => {
                    const node = n as Sim;
                    const r = nodeRadius(node);
                    return r * r;
                  }}
                  nodeCanvasObjectMode={() => "after"}
                  nodeCanvasObject={(n: object, ctx, scale) => {
                    const node = n as Sim;
                    if (
                      typeof node.x !== "number" ||
                      typeof node.y !== "number"
                    )
                      return;
                    const r = nodeRadius(node);
                    // Приглушение: если есть подсветка и мы НЕ в ней — не рисуем дополнительно.
                    const hasHover = hoverNodeSet.current.size > 0;
                    const hasFinding = activeFindingNodes.size > 0;
                    const inHover = hoverNodeSet.current.has(node.id);
                    const inFinding = activeFindingNodes.has(node.id);
                    const dimmed =
                      (hasHover && !inHover) || (hasFinding && !inFinding);

                    // Обводка focus-узла.
                    if (focusKey && node.id === focusKey) {
                      ctx.beginPath();
                      ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
                      ctx.strokeStyle = COLOR.focus;
                      ctx.lineWidth = 2.5;
                      ctx.stroke();
                    }
                    // Обводка узла, помеченного AI.
                    if (flaggedNodes.has(node.id)) {
                      ctx.beginPath();
                      ctx.arc(node.x, node.y, r + 5, 0, 2 * Math.PI);
                      ctx.strokeStyle = COLOR.flagged;
                      ctx.lineWidth = inFinding ? 3 : 1.5;
                      ctx.setLineDash([3, 2]);
                      ctx.stroke();
                      ctx.setLineDash([]);
                    }
                    // Подпись: либо узел в топ-10, либо в подсветке, либо при зуме.
                    const showLabel =
                      alwaysLabelIds.has(node.id) ||
                      inHover ||
                      inFinding ||
                      scale > 1.6 ||
                      node.trips >= 12;
                    if (showLabel && !dimmed) {
                      const fs = Math.max(10, 11 / Math.sqrt(scale));
                      ctx.font = `${
                        alwaysLabelIds.has(node.id) ? "600 " : ""
                      }${fs}px sans-serif`;
                      // Тонкая белая обводка для читаемости поверх линий.
                      ctx.lineWidth = 3;
                      ctx.strokeStyle = "rgba(255,255,255,0.85)";
                      ctx.textAlign = "center";
                      ctx.textBaseline = "top";
                      ctx.strokeText(node.label, node.x, node.y + r + 2);
                      ctx.fillStyle = "#0f172a";
                      ctx.fillText(node.label, node.x, node.y + r + 2);
                    }
                  }}
                  linkCurvature={(l: object) => {
                    const e = l as SimEdge;
                    return e.__curvature || 0;
                  }}
                  linkColor={(l: object) => {
                    const e = l as SimEdge;
                    const sId =
                      typeof e.source === "string"
                        ? e.source
                        : (e.source as Sim).id;
                    const tId =
                      typeof e.target === "string"
                        ? e.target
                        : (e.target as Sim).id;
                    const rgb = EDGE_RGB[e.kind];
                    const hasHover = hoverLinkSet.current.size > 0;
                    const hasFinding = activeFindingNodes.size > 0;
                    const inHover = hoverLinkSet.current.has(`${sId}|${tId}`);
                    const inFinding =
                      activeFindingNodes.has(sId) &&
                      activeFindingNodes.has(tId);
                    let alpha = 0.85;
                    if (hasHover) alpha = inHover ? 0.95 : 0.1;
                    else if (hasFinding) alpha = inFinding ? 0.95 : 0.08;
                    return `rgba(${rgb}, ${alpha})`;
                  }}
                  linkWidth={(l: object) => {
                    const e = l as SimEdge;
                    const sId =
                      typeof e.source === "string"
                        ? e.source
                        : (e.source as Sim).id;
                    const tId =
                      typeof e.target === "string"
                        ? e.target
                        : (e.target as Sim).id;
                    const inHover = hoverLinkSet.current.has(`${sId}|${tId}`);
                    const inFinding =
                      activeFindingNodes.size > 0 &&
                      activeFindingNodes.has(sId) &&
                      activeFindingNodes.has(tId);
                    const w = linkWidth(e);
                    return inHover || inFinding ? w + 1.5 : w;
                  }}
                  linkLabel={(l: object) => {
                    const e = l as SimEdge;
                    return `${edgeRu(e.kind)} · ${e.weight} заказов · GMV ${fmtBYN(e.gmv)} BYN`;
                  }}
                  onNodeHover={handleNodeHover}
                  onNodeClick={handleNodeClick}
                  onNodeRightClick={handleNodeRightClick}
                  cooldownTime={5000}
                  d3AlphaDecay={0.025}
                  d3VelocityDecay={0.4}
                  warmupTicks={60}
                />
              )}
            </div>
          </Card>

          {/* Сайдбар: hover-инфо, AI-анализ, подсказки */}
          <div className="space-y-3 self-start">
            <Card className="p-3 text-sm space-y-3">
              {loading && (
                <div className="text-muted-foreground">Загрузка…</div>
              )}
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  Под курсором
                </div>
                {hovered ? (
                  <div className="space-y-1">
                    <div className="font-medium">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle"
                        style={{ background: COLOR[hovered.kind] }}
                      />
                      {kindRu(hovered.kind)} {hovered.label}
                    </div>
                    <div>
                      Заказов: <b>{hovered.trips}</b>
                    </div>
                    <div>
                      GMV: <b>{fmtBYN(hovered.gmv)} BYN</b>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          applyFocus(`${hovered.kind}:${hovered.label}`)
                        }
                        data-testid="button-hover-focus"
                      >
                        Сфокусировать
                      </Button>
                      {hovered.kind === "client" && (
                        <Link href={`/wb/client/${hovered.label}`}>
                          <Button size="sm" variant="secondary">
                            Карточка клиента
                          </Button>
                        </Link>
                      )}
                      {hovered.kind === "driver" && (
                        <Link href={`/wb/driver/${hovered.label}`}>
                          <Button size="sm" variant="secondary">
                            Карточка водителя
                          </Button>
                        </Link>
                      )}
                      {hovered.kind === "franch" && (
                        <Link href={`/wb/franch/${hovered.label}`}>
                          <Button size="sm" variant="secondary">
                            Карточка парка
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground text-xs">
                    Наведите курсор на узел — подсветятся все его связи.
                  </div>
                )}
              </div>

              {focus && data && (
                <div className="border-t pt-3">
                  <div className="text-xs uppercase text-muted-foreground mb-1">
                    Текущий фокус
                  </div>
                  <div className="font-medium break-all">{focus}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Соседей в графе: {data.nodes.length - 1}
                  </div>
                </div>
              )}
            </Card>

            {/* AI-анализ */}
            <Card
              className="p-3 text-sm space-y-2"
              data-testid="card-graph-analysis"
            >
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase text-muted-foreground">
                  AI-разбор графа
                </div>
                {analysis && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={runAnalysis}
                    disabled={analyzing}
                    title="Перезапустить анализ"
                  >
                    ↻
                  </Button>
                )}
              </div>

              {!analysis && !analyzing && !analysisErr && (
                <div className="text-muted-foreground text-xs">
                  Нажмите «🤖 Анализ AI» — Gemini получит текущий граф (≈{" "}
                  {data?.nodes.length ?? 0} узлов) и попробует найти подозрительные
                  паттерны: hub-водителей, тесные подграфы (сговор), клиентов
                  с одним водителем (самозаказ), изолированные кластеры.
                </div>
              )}

              {analyzing && (
                <div className="text-muted-foreground text-xs animate-pulse">
                  Gemini анализирует граф…
                </div>
              )}

              {analysisErr && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                  Не удалось получить анализ: {analysisErr}
                </div>
              )}

              {analysis && (
                <>
                  <div className="text-xs text-muted-foreground">
                    {analysis.cached ? "Кэш · " : ""}
                    {analysis.model} · {analysis.elapsedMs} ms
                    {analysis.tokens?.in
                      ? ` · ${analysis.tokens.in}+${analysis.tokens.out ?? 0} ток.`
                      : ""}
                  </div>
                  {analysis.summary && (
                    <div className="text-sm leading-snug bg-blue-50 border border-blue-100 rounded p-2">
                      {analysis.summary}
                    </div>
                  )}
                  {analysis.findings.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      Подозрительных паттернов не найдено.
                    </div>
                  ) : (
                    <ul className="space-y-1.5">
                      {analysis.findings.map((f, i) => (
                        <FindingItem
                          key={i}
                          finding={f}
                          index={i}
                          active={activeFindingIdx === i}
                          onToggle={() =>
                            setActiveFindingIdx(
                              activeFindingIdx === i ? null : i,
                            )
                          }
                        />
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Card>

            <Card className="p-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground mb-1">Подсказки</div>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  Парки скрыты по умолчанию — они становятся «хабами» и съедают
                  визуализацию. Включите при необходимости.
                </li>
                <li>
                  Глубина 2 показывает связки «водитель — общий клиент —
                  водитель» (оранжевые рёбра).
                </li>
                <li>
                  Минимум совместных заказов фильтрует случайные пары.
                </li>
                <li>
                  Наведение на узел подсвечивает все его связи. Клик по
                  finding-у в AI-разборе подсвечивает группу узлов.
                </li>
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </WbShell>
  );
}

// ── Вспомогательные компоненты ──

function LegendDot({
  color,
  label,
  outlined = false,
}: {
  color: string;
  label: string;
  outlined?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-3 h-3 rounded-full"
        style={
          outlined
            ? { background: "transparent", border: `2px dashed ${color}` }
            : { background: color }
        }
      />
      {label}
    </span>
  );
}

function severityColor(s: number): string {
  if (s >= 5) return "bg-red-100 text-red-800 border-red-300";
  if (s >= 4) return "bg-orange-100 text-orange-800 border-orange-300";
  if (s >= 3) return "bg-amber-100 text-amber-800 border-amber-300";
  if (s >= 2) return "bg-yellow-50 text-yellow-800 border-yellow-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function findingTypeRu(t: string): string {
  switch (t) {
    case "hub_driver":
      return "Hub-водитель";
    case "collusion":
      return "Возможный сговор";
    case "self_order":
      return "Возможный самозаказ";
    case "isolated_cluster":
      return "Изолированный кластер";
    case "gmv_outlier":
      return "Аномалия GMV";
    default:
      return t;
  }
}

function FindingItem({
  finding,
  index,
  active,
  onToggle,
}: {
  finding: WbGraphFinding;
  index: number;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full text-left rounded-md border px-2 py-1.5 transition-colors ${
          active
            ? "bg-amber-50 border-amber-300 ring-2 ring-amber-200"
            : "bg-background border-border hover:bg-muted/40"
        }`}
        data-testid={`button-finding-${index}`}
      >
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="font-medium text-sm">
            {findingTypeRu(finding.type)}
          </span>
          <span
            className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${severityColor(
              finding.severity,
            )}`}
            title="Уровень подозрительности 1–5"
          >
            sev {finding.severity}
          </span>
        </div>
        <div className="text-xs leading-snug text-foreground/90">
          {finding.explanation}
        </div>
        {finding.nodeIds.length > 0 && (
          <div className="text-[10px] text-muted-foreground mt-1">
            {finding.nodeIds.length} узл.{active ? " · подсвечены" : " (клик — подсветить)"}
          </div>
        )}
      </button>
    </li>
  );
}
