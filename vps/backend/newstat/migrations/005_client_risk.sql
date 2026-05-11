-- 005_client_risk.sql
-- T007: клиентская риск-модель (cashback exposure / driver dependency / suspicious).
--
-- 1) Доращиваем daily_client_stats: для клиентского риска нужны cash_gmv
--    и fast_arrival_orders (быстрые подачи — индикатор сговора с водителем,
--    поездка по сути уже «договорная»).
-- 2) Создаём client_risk_daily — по структуре зеркалит driver_risk_daily, чтобы
--    UI и /daily/summary могли работать единообразно.
-- 3) Money-at-risk здесь = cashback_earned * cashback_exposure/100 — только
--    кэшбэк под риском. Pair/collusion-убытки считает T008.

ALTER TABLE daily_client_stats
  ADD COLUMN IF NOT EXISTS cash_gmv             numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fast_arrival_orders  integer        NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS client_risk_daily (
  client_id                 text          NOT NULL,
  date                      date          NOT NULL,
  cashback_exposure         numeric(5,2)  NOT NULL DEFAULT 0,
  repeat_driver_dependency  numeric(5,2)  NOT NULL DEFAULT 0,
  suspicious_activity       numeric(5,2)  NOT NULL DEFAULT 0,
  total_risk                numeric(5,2)  NOT NULL DEFAULT 0,
  cashback_money_byn        numeric(12,2) NOT NULL DEFAULT 0,
  money_at_risk_byn         numeric(12,2) NOT NULL DEFAULT 0,
  signals                   jsonb         NOT NULL DEFAULT '{}'::jsonb,
  recomputed_at             timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, date)
);

CREATE INDEX IF NOT EXISTS idx_crd_date         ON client_risk_daily(date);
CREATE INDEX IF NOT EXISTS idx_crd_money_at_risk ON client_risk_daily(date, money_at_risk_byn DESC);

-- runner работает под ролью миграций (postgres-superuser) — выдаём права
-- сервисной роли newstat_user явно, иначе роут 500-нет на INSERT.
GRANT SELECT, INSERT, UPDATE, DELETE ON client_risk_daily TO newstat_user;
