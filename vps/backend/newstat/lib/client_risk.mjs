// lib/client_risk.mjs — три модели риска по клиенту (T007).
//
// Логика, общая с driver_risk:
//   - все коэффициенты в [0..100], total_risk = max(...)
//   - linear ramp от "норма" до "явная аномалия" (пороги эмпирические)
//   - все вклады выгружаются в signals jsonb для карточки кейса T010
//
// money_at_risk_byn здесь — это ТОЛЬКО кэшбэк под риском
// (cashback_earned * cashback_exposure/100). Pair-уровень collusion_loss
// считает T008 — здесь не дублируем, чтобы не двойного учёта в /summary.

import { ramp, r2 } from "./risk.mjs";

// row — строка из SELECT в etl.mjs (см. recomputeClientRisk).
export function computeClientRisk(row) {
  const total          = Number(row.total_orders) || 0;
  const completed      = Number(row.completed_orders) || 0;
  const noncashOrders  = Number(row.noncash_orders) || 0;
  const noncashGmv     = Number(row.noncash_gmv) || 0;
  const cashbackEarned = Number(row.cashback_earned) || 0;
  const shortTrips     = Number(row.short_trip_orders) || 0;
  const fastArriv      = Number(row.fast_arrival_orders) || 0;
  const repeatRatio    = Number(row.repeat_driver_ratio) || 0;
  const maxWithOne     = Number(row.max_orders_with_one_driver) || 0;
  const uniqueDrivers  = Number(row.unique_drivers) || 0;

  // Базовые отношения. Знаменатель — completed для трип-метрик
  // (короткие/быстрые считаются только по выполненным заказам в ETL).
  const denomCompleted = completed > 0 ? completed : 1;
  const shortRatio     = shortTrips / denomCompleted;
  const fastRatio      = fastArriv  / denomCompleted;
  const noncashRatio   = total > 0 ? noncashOrders / total : 0;
  const concentr       = total > 0 ? maxWithOne / total : 0;

  // ── 1) cashback_exposure — какая доля кэшбэка может быть фейковой ──
  // 4 сигнала по 25 баллов. Считается всегда (для не-cashback клиента
  // money всё равно будет 0, т.к. cashback_earned=0).
  const ce1 = ramp(shortRatio,   0.30, 0.80) * 25; // короткие = разогнанная сумма безнала
  const ce2 = ramp(fastRatio,    0.30, 0.80) * 25; // быстрые подачи = договорные
  const ce3 = ramp(noncashRatio, 0.70, 1.00) * 25; // 100 % безнала — характерно для cashback-фрода
  const ce4 = ramp(concentr,     0.50, 1.00) * 25; // ездит только с одним водителем
  const cashbackExposure = r2(ce1 + ce2 + ce3 + ce4);
  // Money: cashback по подозрительной части. Порог 30 — отсекаем шум.
  const cashbackMoney = cashbackExposure >= 30
    ? r2(cashbackEarned * cashbackExposure / 100)
    : 0;

  // ── 2) repeat_driver_dependency — клиент завязан на одного водителя ──
  // Сильный сигнал в пользу T008 collusion. Здесь даём общий score,
  // деньги по этой оси не считаем — это T008 территория (pair).
  const rd1 = ramp(concentr,    0.50, 1.00) * 60;
  const rd2 = ramp(repeatRatio, 0.40, 0.80) * 40;
  const repeatDriverDep = r2(rd1 + rd2);

  // ── 3) suspicious_activity — общая «странность» клиента за день ──
  // Много заказов, всё безналом, короткие+быстрые в комбинации.
  const sa1 = ramp(total,       8,  20)   * 50; // десятки заказов в день
  const sa2 = noncashRatio                * 30; // линейно: 0..30
  const sa3 = ramp(Math.min(shortRatio, fastRatio), 0.30, 0.70) * 20;
  const suspiciousActivity = r2(sa1 + sa2 + sa3);

  const totalRisk   = r2(Math.max(cashbackExposure, repeatDriverDep, suspiciousActivity));
  // Деньги под риском по клиенту: только кэшбэк. Pair-collusion = T008.
  const moneyAtRisk = r2(cashbackMoney);

  return {
    client_id: row.client_id,
    cashback_exposure:        cashbackExposure,
    repeat_driver_dependency: repeatDriverDep,
    suspicious_activity:      suspiciousActivity,
    total_risk:               totalRisk,
    cashback_money_byn:       cashbackMoney,
    money_at_risk_byn:        moneyAtRisk,
    signals: {
      cashback_earned_byn: r2(cashbackEarned),
      noncash_gmv_byn:     r2(noncashGmv),
      total_orders:        total,
      unique_drivers:      uniqueDrivers,
      ratios: {
        short_trip:           r2(shortRatio),
        fast_arrival:         r2(fastRatio),
        noncash:              r2(noncashRatio),
        concentration_one_driver: r2(concentr),
        repeat_driver:        r2(repeatRatio),
      },
      cashback_exposure_breakdown: {
        s1_short_trip:    r2(ce1),
        s2_fast_arrival:  r2(ce2),
        s3_all_noncash:   r2(ce3),
        s4_one_driver:    r2(ce4),
      },
      repeat_driver_breakdown: {
        s1_concentration: r2(rd1),
        s2_repeat_driver: r2(rd2),
      },
      suspicious_breakdown: {
        s1_high_count:        r2(sa1),
        s2_all_noncash:       r2(sa2),
        s3_short_fast_combo:  r2(sa3),
      },
    },
  };
}
