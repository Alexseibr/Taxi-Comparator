-- 004_driver_risk.sql
-- Дневная сводка риска по водителям. Пересчитывается ETL после daily_driver_stats
-- и driver_shift_attendance. total_risk = max из трёх моделей (по плану T006);
-- money_at_risk_byn — суммарная финансовая экспозиция по всем категориям
-- (они считают разные деньги: гарантия, накрутка по GMV, безнал с топ-клиентом).
-- signals jsonb хранит коэффициенты и вклады каждого сигнала, чтобы UI
-- мог объяснить кейс без новых SQL-запросов.

CREATE TABLE IF NOT EXISTS driver_risk_daily (
  driver_id            text          NOT NULL,
  date                 date          NOT NULL,
  guarantee_risk       numeric(5,2)  NOT NULL DEFAULT 0,
  earnings_risk        numeric(5,2)  NOT NULL DEFAULT 0,
  collusion_risk       numeric(5,2)  NOT NULL DEFAULT 0,
  total_risk           numeric(5,2)  NOT NULL DEFAULT 0,
  guarantee_money_byn  numeric(12,2) NOT NULL DEFAULT 0,
  earnings_money_byn   numeric(12,2) NOT NULL DEFAULT 0,
  collusion_money_byn  numeric(12,2) NOT NULL DEFAULT 0,
  money_at_risk_byn    numeric(12,2) NOT NULL DEFAULT 0,
  signals              jsonb         NOT NULL DEFAULT '{}'::jsonb,
  recomputed_at        timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, date)
);

CREATE INDEX IF NOT EXISTS ix_driver_risk_date_money
  ON driver_risk_daily (date, money_at_risk_byn DESC);
CREATE INDEX IF NOT EXISTS ix_driver_risk_date_total
  ON driver_risk_daily (date, total_risk DESC);

-- Без этого GRANT runtime-юзер newstat_user не сможет писать в таблицу,
-- созданную postgres-суперпользователем (как с 003_attendance.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE driver_risk_daily TO newstat_user;
