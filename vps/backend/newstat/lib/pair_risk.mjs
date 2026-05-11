// T008: pair-collusion risk model.
//
// Вход: row из daily_pair_stats + контекст (cashbackPct из settings,
// агрегаты по клиенту/водителю — для расчёта зависимости).
//
// 3 score'а (0..100), total_risk = max из них.
// money_at_risk = noncash_gmv × cashback_pct/100 × total_risk/100.
//
// Все цифры — деньги, которые компания переплачивает в виде cashback'а
// клиенту, реально оседающие у пары (если это сговор).

import { ramp, r2, clamp } from "./risk.mjs";

/**
 * @param {object} row - daily_pair_stats row
 * @param {object} ctx - { cashbackPct, clientNoncashOrders, clientTotalOrders,
 *                         driverTotalOrders, templateOrders, templateNoncashGmv }
 */
export function computePairRisk(row, ctx) {
  const orders = Number(row.orders_count) || 0;
  const noncash = Number(row.noncash_orders) || 0;
  const noncashGmv = Number(row.noncash_gmv) || 0;
  const shortTrips = Number(row.short_trip_orders) || 0;
  const fastArrival = Number(row.fast_arrival_orders) || 0;

  const cashbackPct = Number(ctx?.cashbackPct) || 0;
  const clientNoncashOrders = Number(ctx?.clientNoncashOrders) || 0;
  const clientTotalOrders = Number(ctx?.clientTotalOrders) || 0;
  const driverTotalOrders = Number(ctx?.driverTotalOrders) || 0;
  const templateOrders = Number(ctx?.templateOrders) || 0;
  const templateNoncashGmv = Number(ctx?.templateNoncashGmv) || 0;

  const noncashRatio = orders > 0 ? noncash / orders : 0;
  const shortFastShare = orders > 0 ? (shortTrips + fastArrival) / (2 * orders) : 0;
  const templateShare = orders > 0 ? templateOrders / orders : 0;

  // Долю клиента, которая ушла этому водителю (по noncash — там cashback).
  const clientShareByPair = clientNoncashOrders > 0 ? noncash / clientNoncashOrders : 0;
  // Доля водителя, занятая этим клиентом (для context'а в signals — не идёт в score).
  const driverShareByPair = driverTotalOrders > 0 ? orders / driverTotalOrders : 0;

  // ─── repeat_ratio: сколько вообще заказов между парой за день ───
  // 3 заказа = подозрительно, 10+ = почти точно сговор.
  const repeatRatio = ramp(orders, 3, 10) * 100;

  // ─── suspicious_ratio: сочетание noncash-доминирования и short+fast ───
  // s2: noncash_ratio × 60 (линейно — даже 50% безнала уже даёт вклад)
  // s4: ramp(short_fast_share, 0.3, 0.7) × 40
  // T013: + s_template = ramp(template_share, 0.3, 0.7) × 40
  //   — заказы по «книжке» (шаблонные пары якорей, ≥2 км, в МКАД).
  //   Складываем с combo и зажимаем общий suspicious в [0..100], чтобы
  //   шаблонные короткие не давали суммарно >100.
  const sNoncash = noncashRatio * 60;
  const sCombo = ramp(shortFastShare, 0.3, 0.7) * 40;
  const sTemplate = ramp(templateShare, 0.3, 0.7) * 40;
  const suspiciousRatio = clamp(sNoncash + sCombo + sTemplate, 0, 100);

  // ─── cashback_dependency: какая доля noncash-заказов клиента у этой пары ───
  // 50% = подозрительно (клиент почти моногамен с водителем),
  // 100% = точно (все безналичные заказы клиент делает у одного и того же водителя).
  const cashbackDependency = ramp(clientShareByPair, 0.5, 1.0) * 100;

  const totalRisk = Math.max(repeatRatio, suspiciousRatio, cashbackDependency);

  // ─── money_at_risk: переплата cashback'ом ───
  // = noncash_gmv × cashback% × (totalRisk/100)
  // Если totalRisk низкий — деньги почти не под риском.
  const cashbackPaid = (noncashGmv * cashbackPct) / 100;
  const collusionLossRisk = (cashbackPaid * totalRisk) / 100;

  // T013: «прямая» потеря на шаблонных заказах — кэшбэк, выплаченный
  // конкретно по «книжке». Не идёт в total_risk, но видна в UI и summary.
  const templateLossRisk = (templateNoncashGmv * cashbackPct) / 100;

  return {
    driver_id: String(row.driver_id),
    client_id: String(row.client_id),
    orders_count: orders,
    noncash_gmv: r2(noncashGmv),
    repeat_ratio: r2(repeatRatio),
    suspicious_ratio: r2(suspiciousRatio),
    cashback_dependency: r2(cashbackDependency),
    total_risk: r2(totalRisk),
    collusion_loss_risk_byn: r2(collusionLossRisk),
    template_orders: templateOrders,
    template_share: r2(templateShare),
    template_noncash_gmv: r2(templateNoncashGmv),
    signals: {
      orders_count: orders,
      noncash_orders: noncash,
      noncash_gmv: r2(noncashGmv),
      short_trip_orders: shortTrips,
      fast_arrival_orders: fastArrival,
      template_orders: templateOrders,
      template_noncash_gmv: r2(templateNoncashGmv),
      template_loss_risk_byn: r2(templateLossRisk),
      ratios: {
        noncash: r2(noncashRatio),
        short_fast_combo: r2(shortFastShare),
        template_share: r2(templateShare),
        client_share_by_pair: r2(clientShareByPair),
        driver_share_by_pair: r2(driverShareByPair),
      },
      breakdown: {
        repeat: r2(repeatRatio),
        suspicious_noncash: r2(sNoncash),
        suspicious_combo: r2(sCombo),
        suspicious_template: r2(sTemplate),
        cashback_dependency: r2(cashbackDependency),
      },
      cashback_pct_used: r2(cashbackPct),
      cashback_paid_byn: r2(cashbackPaid),
    },
  };
}
