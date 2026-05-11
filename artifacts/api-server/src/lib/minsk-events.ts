/**
 * Городские события Минска — множитель surge.
 *
 * Источники сёрджа:
 *   - Белорусские государственные праздники (фиксированные даты)
 *   - Матчи ФК «Динамо» (Минск) — домашние игры на стадионе
 *   - Концерты и шоу на Минск-Арене / Дворце спорта
 *   - Крупные городские мероприятия (День города, марафон и т.п.)
 *
 * Логика:
 *   getActiveEvents(date)     → все события, активные в эту дату/час
 *   getEventSurgeMult(date)   → итоговый множитель (max из активных событий)
 *
 * Формат EventWindow:
 *   startIso / endIso — UTC ISO-строки, закрытый интервал [start, end].
 *   surge              — множитель поверх текущего surge-модели.
 *   kind               — тип для UI/отладки.
 *
 * ДОБАВЛЕНИЕ НОВЫХ СОБЫТИЙ:
 *   Добавьте объект в массив MINSK_EVENTS. Для повторяющихся событий
 *   (каждый год) — добавьте helper-функцию ниже и вызовите её в buildEvents().
 */

export type EventKind =
  | "public_holiday"  // государственный праздник
  | "new_year_eve"    // канун Нового года (особый, ×1.8)
  | "sports_match"    // матч / спортивное событие
  | "concert"         // концерт / шоу
  | "city_event";     // городское мероприятие

export interface MinskeEvent {
  name: string;
  kind: EventKind;
  /** UTC начало события */
  startIso: string;
  /** UTC конец события */
  endIso: string;
  /**
   * Surge-множитель ПОВЕРХ текущего временного surge.
   * Итоговый surge = time_surge × event_surge (cap 2.4).
   * Типичные значения:
   *   Новый год 31/12 ночь: 1.75
   *   Крупный праздник: 1.30–1.45
   *   Матч Динамо: 1.20–1.35
   *   Концерт Минск-Арена: 1.20–1.30
   */
  surge: number;
}

// ─── Вспомогательные функции ──────────────────────────────────────────────────

/** Создаёт событие в UTC (Минск = UTC+3, поэтому указанные часы - 3h). */
function ev(
  name: string,
  kind: EventKind,
  dateMinsk: string,  // "YYYY-MM-DD"
  startHourMinsk: number,
  endHourMinsk: number,
  surge: number,
): MinskeEvent {
  const [y, mo, d] = dateMinsk.split("-").map(Number) as [number, number, number];
  const startUtc = new Date(Date.UTC(y, mo - 1, d, startHourMinsk - 3, 0, 0));
  let endDay = d;
  let endMonth = mo;
  let endYear = y;
  let endHourUtc = endHourMinsk - 3;
  if (endHourUtc < 0) {
    endHourUtc += 24;
    endDay -= 1;
    if (endDay < 1) {
      endMonth -= 1;
      if (endMonth < 1) { endMonth = 12; endYear -= 1; }
      endDay = new Date(endYear, endMonth, 0).getDate();
    }
  }
  if (endHourMinsk > 24) {
    const carry = endHourMinsk - 24;
    endHourUtc = carry - 3;
    endDay += 1;
  }
  const endUtc = new Date(Date.UTC(endYear, endMonth - 1, endDay, endHourUtc, 0, 0));
  return { name, kind, startIso: startUtc.toISOString(), endIso: endUtc.toISOString(), surge };
}

/** Праздник на весь день (00:00–23:59 по Минску). */
function holiday(name: string, date: string, surge: number, kind: EventKind = "public_holiday"): MinskeEvent {
  return ev(name, kind, date, 0, 23, surge);
}

// ─── Базовые события ──────────────────────────────────────────────────────────

function buildEvents(): MinskeEvent[] {
  const events: MinskeEvent[] = [];

  // ── 2025 ──────────────────────────────────────────────────────────────────

  // Новый год 2025
  events.push(...[
    ev("Новый год — канун (2024→2025)", "new_year_eve", "2024-12-31", 20, 29, 1.75),
    holiday("Новый год 2025", "2025-01-01", 1.45),
    holiday("Новый год 2025 (2-й день)", "2025-01-02", 1.25),
    holiday("Православное Рождество", "2025-01-07", 1.30),
    ev("Старый Новый год — ночь", "public_holiday", "2025-01-13", 20, 27, 1.25),
    holiday("Международный женский день", "2025-03-08", 1.30),
    holiday("Праздник труда", "2025-05-01", 1.20),
    holiday("День Победы", "2025-05-09", 1.35),
    holiday("День Независимости Беларуси", "2025-07-03", 1.40),
    holiday("День Октябрьской революции", "2025-11-07", 1.15),
    holiday("Католическое Рождество", "2025-12-25", 1.20),
    ev("Новый год — канун (2025→2026)", "new_year_eve", "2025-12-31", 20, 29, 1.75),
  ]);

  // ── 2026 ──────────────────────────────────────────────────────────────────

  events.push(...[
    holiday("Новый год 2026", "2026-01-01", 1.45),
    holiday("Новый год 2026 (2-й день)", "2026-01-02", 1.25),
    holiday("Православное Рождество", "2026-01-07", 1.30),
    ev("Старый Новый год — ночь", "public_holiday", "2026-01-13", 20, 27, 1.25),
    holiday("Международный женский день", "2026-03-08", 1.30),
    // Православная Пасха 2026 — 5 апреля
    holiday("Православная Пасха 2026", "2026-04-05", 1.25),
    holiday("Праздник труда", "2026-05-01", 1.20),
    holiday("День Победы", "2026-05-09", 1.35),
    holiday("День Независимости Беларуси", "2026-07-03", 1.40),
    holiday("День Октябрьской революции", "2026-11-07", 1.15),
    holiday("Католическое Рождество", "2026-12-25", 1.20),
    ev("Новый год — канун (2026→2027)", "new_year_eve", "2026-12-31", 20, 29, 1.75),
  ]);

  // ── Матчи ФК «Динамо» Минск (домашние, стадион Динамо/Трактор) ───────────
  // Высшая лига Беларуси — типичное расписание весна-осень.
  // Пик спроса: 1.5ч до игры – 1.5ч после, в радиусе центра Минска.
  const dinamoHome2025: Array<[string, number, number]> = [
    // [date_minsk, kick_off_hour_minsk, kick_off_hour_end]
    ["2025-04-05", 16, 21],
    ["2025-04-19", 16, 21],
    ["2025-05-03", 16, 21],
    ["2025-05-17", 16, 21],
    ["2025-06-07", 19, 24],
    ["2025-06-21", 19, 24],
    ["2025-07-05", 19, 24],
    ["2025-07-19", 19, 24],
    ["2025-08-02", 19, 24],
    ["2025-08-16", 19, 24],
    ["2025-09-06", 16, 21],
    ["2025-09-20", 16, 21],
    ["2025-10-04", 14, 19],
    ["2025-10-18", 14, 19],
  ];
  for (const [date, start, end] of dinamoHome2025) {
    events.push(ev("Матч ФК «Динамо» Минск (дом.)", "sports_match", date, start - 1, end, 1.25));
  }

  const dinamoHome2026: Array<[string, number, number]> = [
    ["2026-04-04", 16, 21],
    ["2026-04-18", 16, 21],
    ["2026-05-02", 16, 21],
    ["2026-05-16", 16, 21],
    ["2026-06-06", 19, 24],
    ["2026-06-20", 19, 24],
    ["2026-07-04", 19, 24],
    ["2026-07-18", 19, 24],
    ["2026-08-01", 19, 24],
    ["2026-08-15", 19, 24],
    ["2026-09-05", 16, 21],
    ["2026-09-19", 16, 21],
    ["2026-10-03", 14, 19],
    ["2026-10-17", 14, 19],
  ];
  for (const [date, start, end] of dinamoHome2026) {
    events.push(ev("Матч ФК «Динамо» Минск (дом.)", "sports_match", date, start - 1, end, 1.25));
  }

  // ── Концерты (Минск-Арена, Дворец спорта) ────────────────────────────────
  // Placeholder'ы — добавляйте реальные события из афиши.
  const concerts2025: Array<[string, string, number, number]> = [
    ["IOWA", "2025-10-11", 18, 24],
    ["Ночные снайперы", "2025-11-15", 18, 24],
  ];
  for (const [name, date, start, end] of concerts2025) {
    events.push(ev(`Концерт: ${name}`, "concert", date, start, end, 1.20));
  }

  // ── Городские мероприятия ─────────────────────────────────────────────────
  events.push(
    ev("День города Минска", "city_event", "2025-09-14", 12, 24, 1.25),
    ev("Минский полумарафон", "city_event", "2025-09-07", 8, 14, 1.15),
    ev("День города Минска", "city_event", "2026-09-13", 12, 24, 1.25),
    ev("Минский полумарафон", "city_event", "2026-09-06", 8, 14, 1.15),
  );

  return events;
}

const MINSK_EVENTS: MinskeEvent[] = buildEvents();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Возвращает все события, активные в момент `date` (UTC).
 */
export function getActiveEvents(date: Date): MinskeEvent[] {
  const ms = date.getTime();
  return MINSK_EVENTS.filter(
    (e) => ms >= new Date(e.startIso).getTime() && ms <= new Date(e.endIso).getTime(),
  );
}

/**
 * Возвращает surge-множитель для указанного момента.
 * Если несколько событий активны — берём максимум (самый высокий приоритет).
 * Если событий нет — возвращает 1.0.
 */
export function getEventSurgeMult(date: Date): number {
  const active = getActiveEvents(date);
  if (active.length === 0) return 1.0;
  return Math.max(...active.map((e) => e.surge));
}

/**
 * Список всех известных событий (для UI / эндпоинта).
 */
export function listEvents(
  from?: Date,
  to?: Date,
): MinskeEvent[] {
  if (!from && !to) return [...MINSK_EVENTS];
  const fromMs = from?.getTime() ?? 0;
  const toMs = to?.getTime() ?? Infinity;
  return MINSK_EVENTS.filter(
    (e) =>
      new Date(e.endIso).getTime() >= fromMs &&
      new Date(e.startIso).getTime() <= toMs,
  );
}
