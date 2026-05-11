import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db, tariffSnapshotsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { computeSurge } from "../lib/surge-model";
import { getWeatherAt } from "../lib/weather-client";
import { getActiveEvents } from "../lib/minsk-events";
import { MINSK_ROUTES } from "../lib/minsk-routes";
import { YANDEX_MINSK } from "../lib/cities";

const router: IRouter = Router();

const TG_TOKEN       = process.env.TELEGRAM_BOT_TOKEN ?? "";
const WEBHOOK_SECRET = TG_TOKEN.slice(-20);

const OPENAI_BASE    = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL    ?? "http://localhost:1106/modelfarm/openai";
const OPENAI_KEY     = process.env.AI_INTEGRATIONS_OPENAI_API_KEY     ?? "";
const ANTHROPIC_BASE = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ?? "http://localhost:1106/modelfarm/anthropic";
const ANTHROPIC_KEY  = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY  ?? "";
const GEMINI_BASE    = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL    ?? "http://localhost:1106/modelfarm/gemini";
const GEMINI_KEY     = process.env.AI_INTEGRATIONS_GEMINI_API_KEY     ?? "";

// ─── Telegram helpers ─────────────────────────────────────────────────────────

async function tgSend(chatId: string, text: string): Promise<void> {
  if (!TG_TOKEN) return;
  const chunks: string[] = [];
  let t = text;
  while (t.length > 4000) {
    let cut = t.lastIndexOf("\n", 4000);
    if (cut < 200) cut = 4000;
    chunks.push(t.slice(0, cut));
    t = t.slice(cut);
  }
  chunks.push(t);

  for (const chunk of chunks) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunk, disable_web_page_preview: true }),
        });
      }
    } catch (e) {
      logger.error({ err: e }, "tgSend error");
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function tgTyping(chatId: string): Promise<void> {
  if (!TG_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  }).catch(() => {});
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number, d = 2) => n.toFixed(d);
const pad  = (n: number)       => String(n).padStart(2, "0");

function minskHour(date: Date): number {
  return (date.getUTCHours() + 3) % 24;
}

// ─── Command: /report / /отчет ────────────────────────────────────────────────
// Сводка за последний час из tariff_snapshots

async function runReportCommand(chatId: string): Promise<void> {
  const [metaRes, routeRes, hourlyRes] = await Promise.all([
    db.execute<{
      cnt: string; econom_mean: string; econom_max: string;
      biz_mean: string; biz_max: string; avg_surge: string; last_at: string;
    }>(sql`
      SELECT COUNT(*)::text AS cnt,
             ROUND(AVG(price_min) FILTER (WHERE class_id='econom')::numeric,2)::text AS econom_mean,
             ROUND(MAX(price_min) FILTER (WHERE class_id='econom')::numeric,2)::text AS econom_max,
             ROUND(AVG(price_min) FILTER (WHERE class_id='business')::numeric,2)::text AS biz_mean,
             ROUND(MAX(price_min) FILTER (WHERE class_id='business')::numeric,2)::text AS biz_max,
             ROUND(AVG(surge_multiplier)::numeric,3)::text AS avg_surge,
             MAX(captured_at)::text AS last_at
      FROM ${tariffSnapshotsTable}
      WHERE captured_at > NOW() - INTERVAL '1 hour'
    `),
    db.execute<{
      route_id: string; econom: string; business: string; surge: string;
    }>(sql`
      SELECT route_id,
             ROUND(AVG(price_min) FILTER (WHERE class_id='econom')::numeric,2)::text AS econom,
             ROUND(AVG(price_min) FILTER (WHERE class_id='business')::numeric,2)::text AS business,
             ROUND(AVG(surge_multiplier)::numeric,2)::text AS surge
      FROM ${tariffSnapshotsTable}
      WHERE captured_at > NOW() - INTERVAL '1 hour'
      GROUP BY route_id
      ORDER BY route_id
    `),
    db.execute<{
      h: string; econom: string; biz: string; surge: string; cnt: string;
    }>(sql`
      SELECT EXTRACT(HOUR FROM captured_at AT TIME ZONE 'Europe/Minsk')::int::text AS h,
             ROUND(AVG(price_min) FILTER (WHERE class_id='econom')::numeric,2)::text AS econom,
             ROUND(AVG(price_min) FILTER (WHERE class_id='business')::numeric,2)::text AS biz,
             ROUND(AVG(surge_multiplier)::numeric,2)::text AS surge,
             COUNT(*)::text AS cnt
      FROM ${tariffSnapshotsTable}
      WHERE captured_at > NOW() - INTERVAL '1 hour'
      GROUP BY 1 ORDER BY 1
    `),
  ]);

  const m   = metaRes.rows[0];
  const cnt = parseInt(m?.cnt ?? "0");
  const now = new Date();
  const h   = minskHour(now);

  if (cnt === 0) {
    await tgSend(chatId, `📭 Снимков за последний час нет. Планировщик пишет каждые 20 мин.`);
    return;
  }

  const lastAt = m?.last_at ? new Date(m.last_at) : now;
  const ageMin = Math.round((now.getTime() - lastAt.getTime()) / 60000);

  const lines: string[] = [
    `📊 *Сводка за последний час*`,
    `_${pad(h)}:00 МСК — обновлено ${ageMin} мин назад_\n`,
    `Снимков: ${cnt}  |  Средний сёрдж: ×${m?.avg_surge ?? "—"}`,
    `Эконом:  среднее ${m?.econom_mean ?? "—"} BYN  (макс ${m?.econom_max ?? "—"})`,
    `Комфорт: среднее ${m?.biz_mean ?? "—"} BYN  (макс ${m?.biz_max ?? "—"})\n`,
    `*По маршрутам (Эконом / Комфорт / ×сёрдж):*`,
  ];

  // Route label mapping
  const routeLabels: Record<string, string> = {};
  for (const r of MINSK_ROUTES) {
    routeLabels[r.id] = `${r.pickupLabel} → ${r.dropoffLabel}`;
  }

  for (const row of routeRes.rows) {
    const label = routeLabels[row.route_id] ?? row.route_id;
    const surge = parseFloat(row.surge ?? "1");
    const surgeIcon = surge >= 1.5 ? "🔴" : surge >= 1.2 ? "🟡" : "🟢";
    lines.push(`${surgeIcon} ${label}: ${row.econom ?? "—"} / ${row.business ?? "—"} BYN  ×${row.surge}`);
  }

  if (hourlyRes.rows.length > 0) {
    lines.push(`\n*По часам (МСК, последний час):*`);
    for (const row of hourlyRes.rows) {
      lines.push(`  ${pad(parseInt(row.h))}:xx  Э ${row.econom} / К ${row.biz} BYN  ×${row.surge}  [${row.cnt} зап.]`);
    }
  }

  await tgSend(chatId, lines.join("\n"));
}

// ─── Command: /tariff / /тариф ────────────────────────────────────────────────
// Базовые тарифные коэффициенты из модели vs. реальность

async function runTariffCommand(chatId: string): Promise<void> {
  const [econRes, bizRes] = await Promise.all([
    db.execute<{ mean: string; std: string; surge: string; min_val: string; max_val: string; avg_km: string }>(sql`
      SELECT ROUND(AVG(price_min)::numeric,2)::text AS mean,
             ROUND(STDDEV(price_min)::numeric,2)::text AS std,
             ROUND(AVG(surge_multiplier)::numeric,3)::text AS surge,
             ROUND(MIN(price_min)::numeric,2)::text AS min_val,
             ROUND(MAX(price_min)::numeric,2)::text AS max_val,
             ROUND(AVG(distance_km)::numeric,2)::text AS avg_km
      FROM ${tariffSnapshotsTable} WHERE class_id = 'econom'
    `),
    db.execute<{ mean: string; std: string; surge: string; min_val: string; max_val: string }>(sql`
      SELECT ROUND(AVG(price_min)::numeric,2)::text AS mean,
             ROUND(STDDEV(price_min)::numeric,2)::text AS std,
             ROUND(AVG(surge_multiplier)::numeric,3)::text AS surge,
             ROUND(MIN(price_min)::numeric,2)::text AS min_val,
             ROUND(MAX(price_min)::numeric,2)::text AS max_val
      FROM ${tariffSnapshotsTable} WHERE class_id = 'business'
    `),
  ]);

  const econom  = YANDEX_MINSK.classes.find((c) => c.id === "econom")!;
  const comfort = YANDEX_MINSK.classes.find((c) => c.id === "business")!;
  const eRow = econRes.rows[0];
  const bRow = bizRes.rows[0];

  const lines = [
    `💰 *Тарифы Яндекс Go — Минск (BYN)*\n`,

    `*🚗 Эконом*`,
    `Посадка:     ${fmt(econom.pickupCost)} BYN`,
    `За км:       ${fmt(econom.perKm)} BYN/км  (>12 км: ${fmt(econom.longDistancePerKm!)} BYN/км)`,
    `За минуту:   ${fmt(econom.perMin)} BYN/мин`,
    `Минимум:     ${fmt(econom.minimumFare)} BYN`,
    `ETA:         ${econom.bookingEtaMin}–${econom.bookingEtaMax} мин`,
    `_Реальные данные (${eRow?.mean ?? "—"} BYN ср., ×${eRow?.surge ?? "—"} сёрдж):_`,
    `  среднее ${eRow?.mean ?? "—"} BYN | σ ${eRow?.std ?? "—"} | диапазон ${eRow?.min_val ?? "—"}–${eRow?.max_val ?? "—"}\n`,

    `*🚙 Комфорт*`,
    `Посадка:     ${fmt(comfort.pickupCost)} BYN`,
    `За км:       ${fmt(comfort.perKm)} BYN/км  (>15 км: ${fmt(comfort.longDistancePerKm!)} BYN/км)`,
    `За минуту:   ${fmt(comfort.perMin)} BYN/мин`,
    `Минимум:     ${fmt(comfort.minimumFare)} BYN`,
    `ETA:         ${comfort.bookingEtaMin}–${comfort.bookingEtaMax} мин`,
    `_Реальные данные:_`,
    `  среднее ${bRow?.mean ?? "—"} BYN | σ ${bRow?.std ?? "—"} | диапазон ${bRow?.min_val ?? "—"}–${bRow?.max_val ?? "—"}\n`,

    `*Формула цены:*`,
    `\`Посадка + perKm×км + perMin×мин\` × surge`,
    `Для длинных маршрутов >12/15 км — повышенный тариф за км.`,
    `\n⚠️ Скрытый сёрдж: Яндекс скрывает сёрдж на Эконом в красных зонах.\n`,
    `_Данные: ${eRow ? `${eRow.mean}` : "—"} BYN среднее по ${parseInt(eRow?.min_val ?? "0") > 0 ? "реальным" : "—"} замерам rwbtaxi.by_`,
  ];

  await tgSend(chatId, lines.join("\n"));
}

// ─── Command: /stats / /стат ──────────────────────────────────────────────────
// Общая статистика и точность модели

async function runStatsCommand(chatId: string): Promise<void> {
  const [globalRes, byHourRes, byDowRes, accuracyRes] = await Promise.all([
    db.execute<{
      total: string; live: string; first: string; last: string;
      e_mean: string; e_std: string; e_surge: string;
      b_mean: string; b_std: string; b_surge: string;
      routes: string;
    }>(sql`
      SELECT COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE source='live')::text AS live,
             MIN(captured_at)::text AS first,
             MAX(captured_at)::text AS last,
             ROUND(AVG(price_min) FILTER (WHERE class_id='econom')::numeric,2)::text AS e_mean,
             ROUND(STDDEV(price_min) FILTER (WHERE class_id='econom')::numeric,2)::text AS e_std,
             ROUND(AVG(surge_multiplier) FILTER (WHERE class_id='econom')::numeric,3)::text AS e_surge,
             ROUND(AVG(price_min) FILTER (WHERE class_id='business')::numeric,2)::text AS b_mean,
             ROUND(STDDEV(price_min) FILTER (WHERE class_id='business')::numeric,2)::text AS b_std,
             ROUND(AVG(surge_multiplier) FILTER (WHERE class_id='business')::numeric,3)::text AS b_surge,
             COUNT(DISTINCT route_id)::text AS routes
      FROM ${tariffSnapshotsTable}
    `),
    db.execute<{ h: string; e_mean: string; surge: string }>(sql`
      SELECT EXTRACT(HOUR FROM captured_at AT TIME ZONE 'Europe/Minsk')::int::text AS h,
             ROUND(AVG(price_min) FILTER (WHERE class_id='econom')::numeric,1)::text AS e_mean,
             ROUND(AVG(surge_multiplier)::numeric,2)::text AS surge
      FROM ${tariffSnapshotsTable}
      GROUP BY 1 ORDER BY 1
    `),
    db.execute<{ dow: string; e_mean: string; surge: string }>(sql`
      SELECT EXTRACT(DOW FROM captured_at AT TIME ZONE 'Europe/Minsk')::int::text AS dow,
             ROUND(AVG(price_min) FILTER (WHERE class_id='econom')::numeric,1)::text AS e_mean,
             ROUND(AVG(surge_multiplier)::numeric,2)::text AS surge
      FROM ${tariffSnapshotsTable}
      GROUP BY 1 ORDER BY 1
    `),
    db.execute<{
      high_surge: string; low_surge: string; max_price: string; surge_p95: string;
    }>(sql`
      SELECT COUNT(*) FILTER (WHERE surge_multiplier >= 1.5)::text AS high_surge,
             COUNT(*) FILTER (WHERE surge_multiplier < 1.0)::text AS low_surge,
             ROUND(MAX(price_min)::numeric,2)::text AS max_price,
             ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY surge_multiplier)::numeric,3)::text AS surge_p95
      FROM ${tariffSnapshotsTable}
    `),
  ]);

  const g   = globalRes.rows[0];
  const acc = accuracyRes.rows[0];
  const total = parseInt(g?.total ?? "0");
  const live  = parseInt(g?.live  ?? "0");

  const DOW_NAMES = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

  const peakHour = byHourRes.rows.reduce(
    (best, r) => (parseFloat(r.surge) > parseFloat(best?.surge ?? "0") ? r : best),
    byHourRes.rows[0]!,
  );
  const quietHour = byHourRes.rows.reduce(
    (best, r) => (parseFloat(r.surge) < parseFloat(best?.surge ?? "99") ? r : best),
    byHourRes.rows[0]!,
  );

  const lines = [
    `📈 *Статистика модели rwbtaxi.by*\n`,
    `*База данных:*`,
    `Снимков всего:  ${total.toLocaleString("ru")}`,
    `Живые (Яндекс): ${live.toLocaleString("ru")} (${Math.round(live / Math.max(total, 1) * 100)}%)`,
    `Маршрутов:      ${g?.routes ?? "—"}`,
    `Период:         ${g?.first?.slice(0, 10) ?? "—"} – ${g?.last?.slice(0, 10) ?? "—"}\n`,

    `*Эконом:*`,
    `  Среднее:  ${g?.e_mean ?? "—"} BYN  (σ = ${g?.e_std ?? "—"})`,
    `  Сёрдж:   ×${g?.e_surge ?? "—"} среднее  |  P95 = ×${acc?.surge_p95 ?? "—"}`,
    `  Макс цена: ${acc?.max_price ?? "—"} BYN\n`,

    `*Комфорт:*`,
    `  Среднее:  ${g?.b_mean ?? "—"} BYN  (σ = ${g?.b_std ?? "—"})`,
    `  Сёрдж:   ×${g?.b_surge ?? "—"} среднее\n`,

    `*Паттерны сёрджа:*`,
    `  🔴 Пик:   ${pad(parseInt(peakHour?.h ?? "0"))}:00 МСК  ×${peakHour?.surge ?? "—"}  (Эконом ${peakHour?.e_mean ?? "—"} BYN)`,
    `  🟢 Тихо:  ${pad(parseInt(quietHour?.h ?? "0"))}:00 МСК  ×${quietHour?.surge ?? "—"}  (Эконом ${quietHour?.e_mean ?? "—"} BYN)`,
    `  Высокий спрос (×≥1.5): ${parseInt(acc?.high_surge ?? "0").toLocaleString("ru")} снимков`,
    `  Низкий спрос (×<1.0):  ${parseInt(acc?.low_surge ?? "0").toLocaleString("ru")} снимков\n`,

    `*По дням недели (Эконом / сёрдж):*`,
  ];

  for (const row of byDowRes.rows) {
    const idx  = parseInt(row.dow);
    const name = DOW_NAMES[idx] ?? `Д${idx}`;
    const surge = parseFloat(row.surge);
    const icon  = surge >= 1.5 ? "🔴" : surge >= 1.2 ? "🟡" : "🟢";
    lines.push(`  ${icon} ${name}: ${row.e_mean} BYN  ×${row.surge}`);
  }

  lines.push(`\n_VPS калибровок: 6 083 (внешний источник, не включены в статистику выше)_`);

  await tgSend(chatId, lines.join("\n"));
}

// ─── Command: /forecast / /прогноз ───────────────────────────────────────────
// Прогноз спроса + тарифные рекомендации на следующие 12 ч

async function runForecastCommand(chatId: string): Promise<void> {
  const now        = new Date();
  const curMinskH  = minskHour(now);
  const refRoute   = MINSK_ROUTES[0]!;

  const demandIcon  = (m: number) => (m >= 1.5 ? "🔴" : m >= 1.2 ? "🟡" : "🟢");
  const demandLabel = (m: number) => (m >= 1.5 ? "высокий" : m >= 1.2 ? "средний" : "низкий");

  // Build 12h forecast
  interface ForecastSlot {
    minskH: number;
    surge: number;
    isRain: boolean;
    isSnow: boolean;
    events: string[];
    econEstimate: number;
  }
  const slots: ForecastSlot[] = [];

  for (let i = 0; i <= 11; i++) {
    const at = new Date(now.getTime() + i * 3600 * 1000);
    const mh = minskHour(at);
    let wx = { isRain: false, isSnow: false, tempC: 15, weatherCode: 0 };
    try { wx = await getWeatherAt(at); } catch {}
    const surge  = computeSurge(at, refRoute.id, refRoute.volatility, wx);
    const events = getActiveEvents(at).map((e) => e.name);
    // Estimate Econom price for reference 10 km, 15 min trip
    const econom = YANDEX_MINSK.classes.find((c) => c.id === "econom")!;
    const basePrice = econom.pickupCost + econom.perKm * 10 + econom.perMin * 15;
    const econEstimate = Math.max(econom.minimumFare, basePrice * surge.multiplier);
    slots.push({ minskH: mh, surge: surge.multiplier, isRain: wx.isRain, isSnow: wx.isSnow, events, econEstimate });
  }

  const peakSlot  = slots.reduce((a, b) => (b.surge > a.surge ? b : a));
  const quietSlot = slots.reduce((a, b) => (b.surge < a.surge ? b : a));

  const lines: string[] = [
    `🚖 *Прогноз спроса и цен — Минск*`,
    `Сейчас: ${pad(curMinskH)}:00 МСК\n`,
  ];

  for (const s of slots) {
    const wxEmoji = s.isSnow ? " ❄️" : s.isRain ? " 🌧" : "";
    const evtStr  = s.events.length > 0 ? ` [${s.events.join(", ")}]` : "";
    lines.push(
      `${demandIcon(s.surge)} ${pad(s.minskH)}:00 — ×${fmt(s.surge)} (${demandLabel(s.surge)})` +
      `  ~${fmt(s.econEstimate, 1)} BYN${wxEmoji}${evtStr}`,
    );
  }

  lines.push(
    `\n*Рекомендации:*`,
    `🔴 Пик ${pad(peakSlot.minskH)}:00 — ×${fmt(peakSlot.surge)}. Ожидай цены Эконом ~${fmt(peakSlot.econEstimate, 1)} BYN.`,
    `🟢 Тихо ${pad(quietSlot.minskH)}:00 — ×${fmt(quietSlot.surge)}. Лучшее время для поездки.`,
    ``,
    peakSlot.surge >= 1.5
      ? `⚠️ Высокий спрос ожидается в ${pad(peakSlot.minskH)}:00. Тариф Эконом может скрыть сёрдж — сравни с Комфортом.`
      : `✅ Экстремального спроса в ближайшие 12ч не ожидается.`,
    `\n_Цены ориентировочные (маршрут 10 км / 15 мин от модели)_`,
    `_Данные: surge-модель + Open-Meteo + события Минска_`,
  );

  await tgSend(chatId, lines.join("\n"));
}

// ─── Command: /анализ ────────────────────────────────────────────────────────
// Мультимодельный AI-анализ тарифной политики

interface HourStats { mean: number; std: number; cnt: number }
interface AggregateData {
  meta: { total_records: number; date_range: { first: string; last: string }; live_pct: number };
  by_hour: Record<string, { econom?: HourStats; business?: HourStats; surge: number }>;
  by_route: Array<{ route_id: string; class_id: string; avg_min: number; avg_max: number; avg_surge: number; cnt: number }>;
  global_stats: { econom_mean: number; econom_std: number; business_mean: number; avg_surge: number };
}

async function aggregateFromDb(): Promise<AggregateData> {
  const [metaRes, byHourRes, byRouteRes, econRes, bizRes] = await Promise.all([
    db.execute<{ total: string; first: string; last: string; live_cnt: string }>(sql`
      SELECT COUNT(*)::text AS total,
             MIN(captured_at)::text AS first,
             MAX(captured_at)::text AS last,
             COUNT(*) FILTER (WHERE source = 'live')::text AS live_cnt
      FROM ${tariffSnapshotsTable}
    `),
    db.execute<{ hour: string; class_id: string; avg_min: string; std_min: string; avg_surge: string; cnt: string }>(sql`
      SELECT EXTRACT(HOUR FROM captured_at AT TIME ZONE 'Europe/Minsk')::int::text AS hour,
             class_id,
             ROUND(AVG(price_min)::numeric, 2)::text AS avg_min,
             ROUND(STDDEV(price_min)::numeric, 2)::text AS std_min,
             ROUND(AVG(surge_multiplier)::numeric, 3)::text AS avg_surge,
             COUNT(*)::text AS cnt
      FROM ${tariffSnapshotsTable}
      GROUP BY 1, 2 ORDER BY 1, 2
    `),
    db.execute<{ route_id: string; class_id: string; avg_min: string; avg_max: string; avg_surge: string; cnt: string }>(sql`
      SELECT route_id, class_id,
             ROUND(AVG(price_min)::numeric, 2)::text AS avg_min,
             ROUND(AVG(price_max)::numeric, 2)::text AS avg_max,
             ROUND(AVG(surge_multiplier)::numeric, 3)::text AS avg_surge,
             COUNT(*)::text AS cnt
      FROM ${tariffSnapshotsTable}
      GROUP BY route_id, class_id ORDER BY cnt::int DESC LIMIT 30
    `),
    db.execute<{ mean: string; std: string; mean_surge: string }>(sql`
      SELECT ROUND(AVG(price_min)::numeric, 2)::text AS mean,
             ROUND(STDDEV(price_min)::numeric, 2)::text AS std,
             ROUND(AVG(surge_multiplier)::numeric, 3)::text AS mean_surge
      FROM ${tariffSnapshotsTable} WHERE class_id = 'econom'
    `),
    db.execute<{ mean: string }>(sql`
      SELECT ROUND(AVG(price_min)::numeric, 2)::text AS mean
      FROM ${tariffSnapshotsTable} WHERE class_id = 'business'
    `),
  ]);

  const meta       = metaRes.rows[0];
  const byHour: AggregateData["by_hour"] = {};
  for (const row of byHourRes.rows) {
    const h = row.hour;
    if (!byHour[h]) byHour[h] = { surge: 0 };
    const stats: HourStats = { mean: parseFloat(row.avg_min), std: parseFloat(row.std_min), cnt: parseInt(row.cnt) };
    if (row.class_id === "econom")   byHour[h]!.econom   = stats;
    if (row.class_id === "business") byHour[h]!.business = stats;
    byHour[h]!.surge = parseFloat(row.avg_surge);
  }
  const econRow = econRes.rows[0];
  const bizRow  = bizRes.rows[0];

  return {
    meta: {
      total_records: parseInt(meta?.total ?? "0"),
      date_range: { first: meta?.first ?? "", last: meta?.last ?? "" },
      live_pct: Math.round(parseInt(meta?.live_cnt ?? "0") / Math.max(parseInt(meta?.total ?? "1"), 1) * 100),
    },
    by_hour: byHour,
    by_route: byRouteRes.rows.map((r) => ({
      route_id: r.route_id, class_id: r.class_id,
      avg_min: parseFloat(r.avg_min), avg_max: parseFloat(r.avg_max),
      avg_surge: parseFloat(r.avg_surge), cnt: parseInt(r.cnt),
    })),
    global_stats: {
      econom_mean: parseFloat(econRow?.mean ?? "0"), econom_std: parseFloat(econRow?.std ?? "0"),
      business_mean: parseFloat(bizRow?.mean ?? "0"), avg_surge: parseFloat(econRow?.mean_surge ?? "0"),
    },
  };
}

const ANALYST_SYSTEM = `Ты независимый аналитик ценообразования такси-платформ.
Тебе дан агрегат реальных снимков цен Яндекс Go (Минск, BYN).
Данные собраны системой rwbtaxi.by через публичный API Яндекс.

ТВОЯ ЗАДАЧА:
1. Структура тарифа: почему именно такие базовые цены?
2. Временны́е паттерны: логика сёрджей по часам
3. Разница Эконом vs Комфорт — как соотносятся?
4. Аномалии и пиковые значения
5. Конкретные рекомендации для нашей тарифной модели (числа!)

Пиши по-русски. Структурируй с заголовками. Ссылайся на числа из данных.
Объём: 600-800 слов. Стиль: аналитический отчёт.`;

async function callOpenAI(prompt: string): Promise<string> {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-5.4", max_completion_tokens: 2000,
      messages: [{ role: "system", content: ANALYST_SYSTEM }, { role: "user", content: prompt }],
    }),
  });
  const j = await res.json() as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${j.error?.message ?? "unknown"}`);
  return j.choices![0]!.message.content;
}

async function callClaude(prompt: string, system?: string): Promise<string> {
  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-opus-4-7", max_tokens: 2000,
      system: system ?? ANALYST_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const j = await res.json() as { content?: Array<{ text: string }>; error?: { message: string } };
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${j.error?.message ?? "unknown"}`);
  return j.content![0]!.text;
}

async function callGemini(prompt: string): Promise<string> {
  const res = await fetch(`${GEMINI_BASE}/models/gemini-3.1-pro-preview:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GEMINI_KEY}` },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: ANALYST_SYSTEM + "\n\n" + prompt }] }],
      generationConfig: { maxOutputTokens: 2000 },
    }),
  });
  const j = await res.json() as { candidates?: Array<{ content: { parts: Array<{ text: string }> } }>; error?: { message: string } };
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${j.error?.message ?? "unknown"}`);
  return j.candidates![0]!.content.parts[0]!.text;
}

async function runAnalysisCommand(chatId: string): Promise<void> {
  await tgSend(chatId, "⏳ Агрегирую данные из базы...");
  const agg = await aggregateFromDb();
  const prompt = `Данные для анализа:\n${JSON.stringify(agg, null, 0)}\n\nПроведи полный независимый анализ.`;

  await tgSend(chatId,
    `📊 *Данные получены*\n\n` +
    `Записей: ${agg.meta.total_records.toLocaleString("ru")}\n` +
    `Период: ${agg.meta.date_range.first.slice(0, 10)} – ${agg.meta.date_range.last.slice(0, 10)}\n` +
    `Живые данные Яндекс: ${agg.meta.live_pct}%\n` +
    `Эконом (среднее): ${agg.global_stats.econom_mean} BYN\n` +
    `Комфорт (среднее): ${agg.global_stats.business_mean} BYN\n\n` +
    `⏳ Запускаю 3 AI-модели параллельно...`,
  );

  await tgTyping(chatId);
  const [gptR, claudeR, geminiR] = await Promise.allSettled([
    callOpenAI(prompt), callClaude(prompt), callGemini(prompt),
  ]);

  const ok  = (r: PromiseSettledResult<string>) => r.status === "fulfilled";
  const val = (r: PromiseSettledResult<string>) => r.status === "fulfilled" ? r.value : `(ошибка: ${r.reason})`;

  if (ok(gptR))    await tgSend(chatId, `━━━━━━━━━━━━━━\n🤖 *GPT-5.4 (OpenAI)*\n━━━━━━━━━━━━━━\n\n${val(gptR)}`);
  else             await tgSend(chatId, `❌ GPT-5.4: ${val(gptR)}`);

  if (ok(claudeR)) await tgSend(chatId, `━━━━━━━━━━━━━━\n🧠 *Claude Opus 4 (Anthropic)*\n━━━━━━━━━━━━━━\n\n${val(claudeR)}`);
  else             await tgSend(chatId, `❌ Claude: ${val(claudeR)}`);

  if (ok(geminiR)) await tgSend(chatId, `━━━━━━━━━━━━━━\n💎 *Gemini 3.1 Pro (Google)*\n━━━━━━━━━━━━━━\n\n${val(geminiR)}`);
  else             await tgSend(chatId, `❌ Gemini: ${val(geminiR)}`);

  const successCount = [gptR, claudeR, geminiR].filter(ok).length;
  if (successCount >= 2) {
    await tgSend(chatId, `⏳ *Синтез* — Claude Opus объединяет все анализы...`);
    await tgTyping(chatId);
    const synthPrompt = `Три AI-модели независимо проанализировали тарифы Яндекс Go (Минск).\n\nGPT-5.4:\n${val(gptR)}\n\nClaude Opus 4:\n${val(claudeR)}\n\nGemini 3.1 Pro:\n${val(geminiR)}\n\nТВОЯ ЗАДАЧА — синтез:\n1. Что совпало у всех трёх → наиболее достоверные выводы\n2. Где расходятся → разбери противоречия\n3. Уникальные инсайты каждой модели\n4. ИТОГОВЫЕ РЕКОМЕНДАЦИИ с конкретными числами для тарифной сетки\n5. Что нужно исследовать дополнительно\n\nПо-русски, структурированно, 500-700 слов.`;
    try {
      const synth = await callClaude(synthPrompt, `Ты старший аналитик, синтезирующий независимые AI-анализы тарифной политики.`);
      await tgSend(chatId, `━━━━━━━━━━━━━━\n⭐ *СИНТЕЗ И РЕКОМЕНДАЦИИ (Claude Opus)*\n━━━━━━━━━━━━━━\n\n${synth}`);
    } catch (e) {
      await tgSend(chatId, `❌ Синтез не удался: ${(e as Error).message}`);
    }
  }
  await tgSend(chatId, `✅ *Анализ завершён* · Моделей успешно: ${successCount}/3`);
}

// ─── Help text (dynamic calibration count) ────────────────────────────────────

async function buildHelpText(): Promise<string> {
  let count = 0;
  try {
    const res = await db.execute<{ cnt: string }>(sql`SELECT COUNT(*)::text AS cnt FROM ${tariffSnapshotsTable}`);
    count = parseInt(res.rows[0]?.cnt ?? "0");
  } catch {}
  return (
    `🚕 Бот rwbtaxi.by · Команды:\n\n` +
    `/report   /отчет   — сводка за последний час\n` +
    `/tariff   /тариф   — базовые тарифы Эконом/Комфорт\n` +
    `/stats    /стат    — общая статистика и точность модели\n` +
    `/forecast /прогноз — рекомендации по тарифам на завтра\n` +
    `/анализ             — AI-анализ тарифной политики (GPT+Claude+Gemini)\n` +
    `/help     /помощь  — этот список\n\n` +
    `Ежедневно в 06:00 МСК приходит автоматический тарифный дайджест.\n` +
    `Калибровок с начала: ${count.toLocaleString("ru")}`
  );
}

// ─── Webhook endpoint ─────────────────────────────────────────────────────────

router.post("/telegram/webhook", async (req: Request, res: Response): Promise<void> => {
  const secret = req.headers["x-telegram-bot-api-secret-token"];
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
    res.sendStatus(403);
    return;
  }

  res.sendStatus(200); // must respond fast — Telegram retries after 2s

  const update = req.body as {
    message?: {
      text?: string;
      chat: { id: number; type: string };
      from?: { first_name?: string; username?: string };
    };
  };

  const message = update.message;
  if (!message?.text) return;

  const chatId = String(message.chat.id);
  const rawCmd = message.text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const cmd    = rawCmd.split("@")[0]; // strip @botname suffix

  logger.info({ cmd, chatId }, "telegram command");

  try {
    switch (cmd) {
      case "/report":
      case "/отчет":
        await runReportCommand(chatId);
        break;
      case "/tariff":
      case "/тариф":
        await runTariffCommand(chatId);
        break;
      case "/stats":
      case "/стат":
        await runStatsCommand(chatId);
        break;
      case "/forecast":
      case "/прогноз":
        await runForecastCommand(chatId);
        break;
      case "/анализ":
      case "/analysis":
      case "/analyze":
        await runAnalysisCommand(chatId);
        break;
      case "/help":
      case "/помощь":
      case "/start":
        await tgSend(chatId, await buildHelpText());
        break;
      default:
        // unknown commands silently ignored (don't spam group chats)
        break;
    }
  } catch (e) {
    logger.error({ err: e, cmd, chatId }, "command error");
    await tgSend(chatId, `❌ Ошибка при выполнении команды \`${cmd}\`: ${(e as Error).message}`);
  }
});

// ─── Register webhook at startup ──────────────────────────────────────────────

export async function registerTelegramWebhook(): Promise<void> {
  if (!TG_TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — webhook not registered");
    return;
  }
  const domains = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (!domains) {
    logger.warn("REPLIT_DOMAINS not set — webhook not registered");
    return;
  }
  const webhookUrl = `https://${domains}/api/telegram/webhook`;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: WEBHOOK_SECRET,
        allowed_updates: ["message"],
        drop_pending_updates: true,
      }),
    });
    const j = await res.json() as { ok: boolean; description?: string };
    if (j.ok) {
      logger.info({ webhookUrl }, "Telegram webhook registered");
      // Send startup announcement to the group
      const helpText = await buildHelpText();
      await tgSend("-1003824916984", helpText).catch((e) =>
        logger.error({ err: e }, "Failed to send startup announcement"),
      );
    } else {
      logger.error({ webhookUrl, description: j.description }, "Telegram webhook registration failed");
    }
  } catch (e) {
    logger.error({ err: e }, "Telegram webhook registration error");
  }
}

export default router;
