-- 007_pair_risk.sql
-- T008: pair-collusion модель.
--
-- Для пары (водитель + клиент + день) считаем риск сговора:
--   repeat_ratio       — много заказов между одной парой
--   suspicious_ratio   — комбинация safelist'ов: высокая доля безнала + короткие/быстрые поездки
--   cashback_dependency — какую долю всех noncash-заказов клиента эта пара забирает
--   total_risk         — max из трёх (как у driver_risk_daily)
--   collusion_loss_risk_byn — оценка переплаченного cashback из-за сговора
--                            = noncash_gmv × cashback_pct/100 × total_risk/100
--
-- Структуру держим симметричной driver_risk_daily / client_risk_daily —
-- /daily/summary и UI работают единообразно.

CREATE TABLE IF NOT EXISTS pair_risk_daily (
  driver_id                text          NOT NULL,
  client_id                text          NOT NULL,
  date                     date          NOT NULL,
  orders_count             integer       NOT NULL DEFAULT 0,
  noncash_gmv              numeric(12,2) NOT NULL DEFAULT 0,
  repeat_ratio             numeric(5,2)  NOT NULL DEFAULT 0,
  suspicious_ratio         numeric(5,2)  NOT NULL DEFAULT 0,
  cashback_dependency      numeric(5,2)  NOT NULL DEFAULT 0,
  total_risk               numeric(5,2)  NOT NULL DEFAULT 0,
  collusion_loss_risk_byn  numeric(12,2) NOT NULL DEFAULT 0,
  signals                  jsonb         NOT NULL DEFAULT '{}'::jsonb,
  recomputed_at            timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, client_id, date)
);

CREATE INDEX IF NOT EXISTS idx_prd_date              ON pair_risk_daily(date);
CREATE INDEX IF NOT EXISTS idx_prd_loss              ON pair_risk_daily(date, collusion_loss_risk_byn DESC);
CREATE INDEX IF NOT EXISTS idx_prd_driver_date       ON pair_risk_daily(driver_id, date);
CREATE INDEX IF NOT EXISTS idx_prd_client_date       ON pair_risk_daily(client_id, date);

GRANT SELECT, INSERT, UPDATE, DELETE ON pair_risk_daily TO newstat_user;
