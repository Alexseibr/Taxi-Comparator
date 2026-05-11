// lib/risk.mjs — три модели риска по водителю (T006).
//
// Все коэффициенты в [0..100]. Финальный total_risk = max из трёх моделей,
// money_at_risk_byn = сумма по категориям (они считают разные деньги).
//
// Дизайн моделей сознательно простой и интерпретируемый: для каждого сигнала
// linear ramp от "нормально" до "явная аномалия" (значения порогов выбраны
// эмпирически, при появлении настроек в settings.risk_thresholds — заменим).
// Все вклады попадают в signals jsonb, чтобы карточка кейса T010
// могла объяснить итоговую цифру без новых SQL.

// Экспортируем — переиспользуются в client_risk.mjs / pair_risk.mjs.
export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// 0 при value <= start, 1 при value >= end, линейно между.
export function ramp(value, start, end) {
  if (end === start) return value >= start ? 1 : 0;
  return clamp((value - start) / (end - start), 0, 1);
}

export function r2(x) {
  return Math.round(Number(x) * 100) / 100;
}

// row — строка из SELECT в etl.mjs (см. recomputeDriverRisk).
export function computeDriverRisk(row) {
  const total       = Number(row.total_orders) || 0;
  const completed   = Number(row.completed_orders) || 0;
  const cancelled   = Number(row.cancelled_orders) || 0;
  const cashOrders  = Number(row.cash_orders) || 0;
  const totalGmv    = Number(row.total_gmv) || 0;
  const noncashGmv  = Number(row.noncash_gmv) || 0;
  const shortTrips  = Number(row.short_trip_orders) || 0;
  const fastArriv   = Number(row.fast_arrival_orders) || 0;
  const repeatRatio = Number(row.repeat_client_ratio) || 0;
  const maxWithOne  = Number(row.max_orders_with_one_client) || 0;
  const qualified   = Boolean(row.qualified);
  const payout      = Number(row.payout_byn) || 0;
  const shiftHours  = Number(row.shift_hours_total) || 0;
  // Числитель для orders/hour должен быть в одном скоупе со shiftHours
  // (qualified-смены) — иначе заказы вне смены искусственно повышают
  // интенсивность и занижают guarantee_risk. См. T006 review.
  const ordersInQualified = Number(row.orders_in_qualified_shifts) || 0;

  // Базовые отношения.
  const denomCompleted = completed > 0 ? completed : 1;
  const shortRatio  = shortTrips / denomCompleted;
  const fastRatio   = fastArriv  / denomCompleted;
  const cancelRatio = total > 0 ? cancelled / total : 0;
  const cashRatio   = total > 0 ? cashOrders / total : 0;
  const concentr    = total > 0 ? maxWithOne / total : 0;
  const ordersPerHr = shiftHours > 0 ? ordersInQualified / shiftHours : 0;

  // ── 1) guarantee_risk — для qualified: формальная отработка смены ──
  // 4 сигнала по 25 баллов. Для не-qualified модель не применяется
  // (эти деньги уже не платятся).
  let g1 = 0, g2 = 0, g3 = 0, g4 = 0;
  if (qualified) {
    g1 = ramp(shortRatio,  0.30, 0.80) * 25; // много "коротких"
    g2 = ramp(fastRatio,   0.30, 0.80) * 25; // много "быстрых подач"
    g3 = ramp(repeatRatio, 0.40, 0.90) * 25; // повтор одних и тех же клиентов
    g4 = (1 - ramp(ordersPerHr, 0.30, 1.00)) * 25; // мало заказов на час смены
  }
  const guaranteeRisk = qualified ? r2(g1 + g2 + g3 + g4) : 0;
  // money: до 100 % выплаты пропорционально score. Порог 30 чтобы не шуметь.
  const guaranteeMoney = qualified && guaranteeRisk >= 30
    ? r2(payout * guaranteeRisk / 100)
    : 0;

  // ── 2) earnings_risk — накрутка / аномальные паттерны (для всех) ──
  const e1 = ramp(cancelRatio, 0.20, 0.60) * 25;
  const e2 = ramp(shortRatio,  0.40, 0.90) * 25;
  // нал + короткие = классика теневых
  const e3 = ramp(cashRatio,   0.50, 1.00) * Math.min(1, shortRatio / 0.5) * 25;
  const e4 = ramp(concentr,    0.40, 0.80) * 25;
  const earningsRisk = r2(e1 + e2 + e3 + e4);
  // money: 10 % от GMV под подозрением, пропорционально score.
  const earningsMoney = earningsRisk >= 30
    ? r2(totalGmv * 0.10 * earningsRisk / 100)
    : 0;

  // ── 3) collusion_risk — зависимость от одного клиента ──
  // Pair-уровень будет в T008; пока берём концентрацию из daily_driver_stats.
  const c1 = ramp(concentr,    0.40, 0.90) * 60;
  const c2 = ramp(repeatRatio, 0.50, 0.95) * 40;
  const collusionRisk = r2(c1 + c2);
  // money: безналичный GMV, приходящийся на топ-клиента (оценка по доле).
  const noncashTopClient = total > 0
    ? noncashGmv * (maxWithOne / total)
    : 0;
  const collusionMoney = collusionRisk >= 30
    ? r2(noncashTopClient * collusionRisk / 100)
    : 0;

  const totalRisk    = r2(Math.max(guaranteeRisk, earningsRisk, collusionRisk));
  const moneyAtRisk  = r2(guaranteeMoney + earningsMoney + collusionMoney);

  return {
    driver_id: row.driver_id,
    guarantee_risk: guaranteeRisk,
    earnings_risk:  earningsRisk,
    collusion_risk: collusionRisk,
    total_risk:     totalRisk,
    guarantee_money_byn: guaranteeMoney,
    earnings_money_byn:  earningsMoney,
    collusion_money_byn: collusionMoney,
    money_at_risk_byn:   moneyAtRisk,
    signals: {
      qualified,
      payout_byn: payout,
      shift_hours: shiftHours,
      ratios: {
        short_trip:  r2(shortRatio),
        fast_arrival: r2(fastRatio),
        repeat_client: r2(repeatRatio),
        cancel: r2(cancelRatio),
        cash: r2(cashRatio),
        concentration_one_client: r2(concentr),
        orders_per_shift_hour: r2(ordersPerHr),
      },
      guarantee: {
        s1_short_trip:    r2(g1),
        s2_fast_arrival:  r2(g2),
        s3_repeat_client: r2(g3),
        s4_low_activity:  r2(g4),
      },
      earnings: {
        e1_cancel:        r2(e1),
        e2_short_trip:    r2(e2),
        e3_cash_short:    r2(e3),
        e4_concentration: r2(e4),
      },
      collusion: {
        c1_concentration: r2(c1),
        c2_repeat_client: r2(c2),
        noncash_top_client_estimate_byn: r2(noncashTopClient),
      },
    },
  };
}
