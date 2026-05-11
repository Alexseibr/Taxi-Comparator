#!/usr/bin/env node
/**
 * Мультимодельный анализ тарифной политики Яндекс Go (Минск)
 * 5 766 реальных замеров за 27 апр – 9 мая 2026
 * Модели: GPT-5.4, Claude Opus 4-7, Gemini 3.1 Pro (параллельно)
 * Синтез: Claude Opus 4-7
 * Результат → Telegram
 */
import fs from 'fs';

const OPENAI_BASE    = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const OPENAI_KEY     = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const ANTHROPIC_BASE = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
const ANTHROPIC_KEY  = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
const GEMINI_BASE    = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const GEMINI_KEY     = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
const TG_TOKEN       = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT        = '-1003824916984';

// ─── Данные ────────────────────────────────────────────────────────
const raw = JSON.parse(fs.readFileSync('/tmp/calib-aggregate.json', 'utf8'));
const promptData = JSON.stringify({
  meta: raw.meta,
  price_stats: raw.price_stats,
  tariff_model: raw.tariff_model,
  surge_by_hour: raw.surge_by_hour,
  by_day_of_week: Object.fromEntries(
    Object.entries(raw.by_day_of_week).map(([k,v]) => [
      v.name, { econom_mean: v.econom?.mean, econom_std: v.econom?.std,
                comfort_mean: v.comfort?.mean, demand: v.demand_dist }
    ])
  ),
  by_hour_summary: Object.fromEntries(
    Object.entries(raw.by_hour).map(([h,v]) => [
      h, { e_mean: v.econom?.mean, e_std: v.econom?.std,
           c_mean: v.comfort?.mean, eta_mean: v.eta?.mean,
           surge: v.surge_vs_median, demand: v.demand_dist }
    ])
  ),
  top_routes: raw.top_routes.slice(0, 15),
  high_price_events: raw.high_price_events.slice(0, 15),
  anomalies_sample: raw.anomalies_flagged.slice(0, 15),
  existing_ai_report: raw.existing_ai_report,
}, null, 0);

// ─── Промпты ────────────────────────────────────────────────────────
const SYSTEM_ANALYST = `Ты — независимый аналитик ценообразования транспортных платформ.
Тебе дан агрегат из 5 766 реальных цен Яндекс Go (Минск, BYN) за 27 апр – 9 мая 2026.
Данные: собраны автоматически системой rwbtaxi.by через публичный API.

ТВОЯ ЗАДАЧА — провести самостоятельный глубокий анализ:
1. Структура тарифа: почему именно такие base/perMin/perKm?
2. Временны́е паттерны: логика сёрджей по часам и дням недели
3. Аномалии и пиковые цены: когда, почему, что это означает?
4. Соответствие нашей модели реальности: где модель ошибается?
5. Скрытые механизмы ценообразования Яндекса — что можно вычислить?
6. Конкретные рекомендации: что можно изменить в нашей тарифной сетке?

Пиши по-русски. Структурируй с заголовками. Будь конкретен — ссылайся на числа из данных.
Объём: 700-900 слов. Стиль: аналитический отчёт, не описание.`;

const USER_MSG = `Данные для анализа:\n${promptData}\n\nПроведи полный независимый анализ.`;

// ─── API-вызовы ─────────────────────────────────────────────────────
async function callOpenAI() {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-5.4',
      max_completion_tokens: 2500,
      messages: [
        { role: 'system', content: SYSTEM_ANALYST },
        { role: 'user',   content: USER_MSG }
      ]
    })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${JSON.stringify(j).slice(0,300)}`);
  return j.choices[0].message.content;
}

async function callClaude() {
  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-7',
      max_tokens: 2500,
      system: SYSTEM_ANALYST,
      messages: [{ role: 'user', content: USER_MSG }]
    })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${JSON.stringify(j).slice(0,300)}`);
  return j.content[0].text;
}

async function callGemini() {
  const model = 'gemini-3.1-pro-preview';
  const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GEMINI_KEY}` },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: SYSTEM_ANALYST + '\n\n' + USER_MSG }] }],
      generationConfig: { maxOutputTokens: 2500 }
    })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${JSON.stringify(j).slice(0,300)}`);
  return j.candidates[0].content.parts[0].text;
}

// ─── Синтез Claude ───────────────────────────────────────────────────
async function callClaudeSynth(gptText, claudeText, geminiText) {
  const synthPrompt = `Ты старший аналитик. Три независимые AI-модели проанализировали данные тарифов Яндекс Go (Минск, 5 766 замеров).

АНАЛИЗ GPT-5.4:
${gptText}

АНАЛИЗ CLAUDE OPUS 4-7:
${claudeText}

АНАЛИЗ GEMINI 3.1 PRO:
${geminiText}

ТВОЯ ЗАДАЧА — синтез и финальные выводы:
1. Какие выводы совпали у всех трёх моделей? → они наиболее достоверны
2. В чём модели расходятся? → разбери противоречия
3. Какие уникальные инсайты дала каждая модель?
4. ИТОГОВЫЕ РЕКОМЕНДАЦИИ: конкретные изменения в тарифной сетке (числа!)
   — базовая посадка Эконом/Комфорт (BYN)
   — ставка за км и мин
   — сёрдж по временны́м слотам
5. Что нужно исследовать дополнительно?

Пиши по-русски. Структурируй. Будь максимально конкретен. Объём: 500-700 слов.`;

  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-7',
      max_tokens: 2000,
      messages: [{ role: 'user', content: synthPrompt }]
    })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Synth Anthropic ${res.status}: ${JSON.stringify(j).slice(0,300)}`);
  return j.content[0].text;
}

// ─── Telegram ────────────────────────────────────────────────────────
async function tgSend(text) {
  const chunks = [];
  let t = text;
  while (t.length > 4000) {
    let cut = t.lastIndexOf('\n', 4000);
    if (cut < 200) cut = 4000;
    chunks.push(t.slice(0, cut));
    t = t.slice(cut);
  }
  chunks.push(t);
  for (const chunk of chunks) {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text: chunk,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
    const j = await res.json();
    if (!j.ok) {
      // Retry without markdown
      await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TG_CHAT, text: chunk, disable_web_page_preview: true })
      });
    }
    await new Promise(r => setTimeout(r, 500)); // rate limit
  }
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('📡 Запускаем анализ тремя моделями параллельно...');
  await tgSend(`🔬 *Запуск мультимодельного AI-анализа*\n\nАнализирую ${raw.meta.total_records} замеров цен Яндекс Go за ${raw.meta.date_range.first} – ${raw.meta.date_range.last}\n\nМодели: GPT-5.4 · Claude Opus 4 · Gemini 3.1 Pro\n\n⏳ Генерация займёт ~2 минуты...`);

  const [gptR, claudeR, geminiR] = await Promise.allSettled([
    callOpenAI(),
    callClaude(),
    callGemini()
  ]);

  const gptOk    = gptR.status    === 'fulfilled';
  const claudeOk = claudeR.status === 'fulfilled';
  const geminiOk = geminiR.status === 'fulfilled';

  console.log(`GPT: ${gptOk ? 'OK' : 'ERR: '+gptR.reason}`);
  console.log(`Claude: ${claudeOk ? 'OK' : 'ERR: '+claudeR.reason}`);
  console.log(`Gemini: ${geminiOk ? 'OK' : 'ERR: '+geminiR.reason}`);

  // Отправляем анализ каждой модели
  if (gptOk) {
    await tgSend(`━━━━━━━━━━━━━━━━━━\n🤖 *АНАЛИЗ GPT-5.4 (OpenAI)*\n━━━━━━━━━━━━━━━━━━\n\n${gptR.value}`);
    console.log('GPT sent');
  } else {
    await tgSend(`❌ GPT-5.4 вернул ошибку: ${gptR.reason}`);
  }

  if (claudeOk) {
    await tgSend(`━━━━━━━━━━━━━━━━━━\n🧠 *АНАЛИЗ CLAUDE OPUS 4 (Anthropic)*\n━━━━━━━━━━━━━━━━━━\n\n${claudeR.value}`);
    console.log('Claude sent');
  } else {
    await tgSend(`❌ Claude вернул ошибку: ${claudeR.reason}`);
  }

  if (geminiOk) {
    await tgSend(`━━━━━━━━━━━━━━━━━━\n💎 *АНАЛИЗ GEMINI 3.1 PRO (Google)*\n━━━━━━━━━━━━━━━━━━\n\n${geminiR.value}`);
    console.log('Gemini sent');
  } else {
    await tgSend(`❌ Gemini вернул ошибку: ${geminiR.reason}`);
  }

  // Синтез если хотя бы две модели успешны
  const successCount = [gptOk, claudeOk, geminiOk].filter(Boolean).length;
  if (successCount >= 2) {
    console.log('Running synthesis with Claude...');
    await tgSend(`⏳ *Синтез* — Claude Opus обрабатывает все три анализа...`);
    try {
      const synthText = await callClaudeSynth(
        gptOk    ? gptR.value    : '(ошибка, данные недоступны)',
        claudeOk ? claudeR.value : '(ошибка, данные недоступны)',
        geminiOk ? geminiR.value : '(ошибка, данные недоступны)'
      );
      await tgSend(`━━━━━━━━━━━━━━━━━━\n⭐ *СИНТЕЗ И ИТОГОВЫЕ РЕКОМЕНДАЦИИ (Claude Opus)*\n━━━━━━━━━━━━━━━━━━\n\n${synthText}`);
      console.log('Synthesis sent');
    } catch(e) {
      await tgSend(`❌ Ошибка синтеза: ${e.message}`);
    }
  }

  await tgSend(`✅ *Анализ завершён*\n\nДанные: ${raw.meta.total_records} замеров · ${raw.meta.date_range.first}–${raw.meta.date_range.last}\nМедиана Эконом: ${raw.meta.median_econom_byn} BYN\nМоделей успешно: ${successCount}/3`);
  console.log('Done!');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
