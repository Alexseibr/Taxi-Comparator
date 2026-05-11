-- 002_etl.sql — материализованные дневные метрики для ETL.
-- Все три таблицы — обычные (не materialized view), пересчёт идёт UPSERT-ом
-- из ETL после каждого импорта. Это даёт нам дешёвые SELECT для UI и
-- лёгкое инкрементное обновление по конкретной дате.

-- ── водитель × день ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_driver_stats (
  driver_id TEXT NOT NULL,
  date DATE NOT NULL,
  total_orders INTEGER NOT NULL DEFAULT 0,
  completed_orders INTEGER NOT NULL DEFAULT 0,
  cancelled_orders INTEGER NOT NULL DEFAULT 0,
  noncash_orders INTEGER NOT NULL DEFAULT 0,
  cash_orders INTEGER NOT NULL DEFAULT 0,
  noncash_gmv NUMERIC(12,2) NOT NULL DEFAULT 0,
  cash_gmv NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_gmv NUMERIC(12,2) NOT NULL DEFAULT 0,
  short_trip_orders INTEGER NOT NULL DEFAULT 0,
  fast_arrival_orders INTEGER NOT NULL DEFAULT 0,
  unique_clients INTEGER NOT NULL DEFAULT 0,
  max_orders_with_one_client INTEGER NOT NULL DEFAULT 0,
  repeat_client_ratio NUMERIC(5,4) NOT NULL DEFAULT 0,
  avg_arrival_minutes NUMERIC(6,2),
  avg_trip_minutes NUMERIC(6,2),
  first_order_at TIMESTAMPTZ,
  last_order_at TIMESTAMPTZ,
  active_hours_mask INTEGER NOT NULL DEFAULT 0, -- 24-битная маска часов
  recomputed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, date)
);
CREATE INDEX IF NOT EXISTS idx_dds_date ON daily_driver_stats(date);

-- ── клиент × день ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_client_stats (
  client_id TEXT NOT NULL,
  date DATE NOT NULL,
  total_orders INTEGER NOT NULL DEFAULT 0,
  completed_orders INTEGER NOT NULL DEFAULT 0,
  cancelled_orders INTEGER NOT NULL DEFAULT 0,
  noncash_orders INTEGER NOT NULL DEFAULT 0,
  noncash_gmv NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_gmv NUMERIC(12,2) NOT NULL DEFAULT 0,
  unique_drivers INTEGER NOT NULL DEFAULT 0,
  max_orders_with_one_driver INTEGER NOT NULL DEFAULT 0,
  repeat_driver_ratio NUMERIC(5,4) NOT NULL DEFAULT 0,
  short_trip_orders INTEGER NOT NULL DEFAULT 0,
  cashback_earned NUMERIC(12,2) NOT NULL DEFAULT 0,
  recomputed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, date)
);
CREATE INDEX IF NOT EXISTS idx_dcs_date ON daily_client_stats(date);

-- ── пара (водитель × клиент × день) ────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_pair_stats (
  driver_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  date DATE NOT NULL,
  orders_count INTEGER NOT NULL DEFAULT 0,
  noncash_orders INTEGER NOT NULL DEFAULT 0,
  noncash_gmv NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_gmv NUMERIC(12,2) NOT NULL DEFAULT 0,
  short_trip_orders INTEGER NOT NULL DEFAULT 0,
  fast_arrival_orders INTEGER NOT NULL DEFAULT 0,
  recomputed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, client_id, date)
);
CREATE INDEX IF NOT EXISTS idx_dps_date ON daily_pair_stats(date);
CREATE INDEX IF NOT EXISTS idx_dps_driver_date ON daily_pair_stats(driver_id, date);
CREATE INDEX IF NOT EXISTS idx_dps_client_date ON daily_pair_stats(client_id, date);
