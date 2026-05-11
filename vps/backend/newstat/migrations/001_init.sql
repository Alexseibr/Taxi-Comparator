-- 001_init.sql — справочники, settings, источники данных

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

INSERT INTO settings(key, value, updated_by) VALUES
  ('cashback', '{"percent_of_noncash": 30}'::jsonb, 'system-init'),
  ('shifts_default', '{"shifts": []}'::jsonb, 'system-init'),
  ('risk_thresholds', '{"short_trip_km": 2, "fast_arrival_min": 3, "min_attendance_pct": 80, "high_repeat_ratio": 0.6}'::jsonb, 'system-init')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  start_hour SMALLINT NOT NULL CHECK (start_hour BETWEEN 0 AND 23),
  end_hour SMALLINT NOT NULL CHECK (end_hour BETWEEN 1 AND 24),
  payout_byn NUMERIC(10,2) NOT NULL CHECK (payout_byn >= 0),
  weekday_mask SMALLINT NOT NULL DEFAULT 127,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  login TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','antifraud','viewer')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  phone TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  order_date DATE NOT NULL,
  created_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  gmv NUMERIC(12,2),
  km NUMERIC(8,2),
  client_id TEXT,
  driver_id TEXT,
  status TEXT NOT NULL,
  payment_type TEXT,
  payment_type2 TEXT,
  car_class_create TEXT,
  car_class_appoint TEXT,
  is_now BOOLEAN,
  arrival_minutes NUMERIC(6,2),
  trip_minutes NUMERIC(6,2),
  lat_in DOUBLE PRECISION,
  lng_in DOUBLE PRECISION,
  lat_out DOUBLE PRECISION,
  lng_out DOUBLE PRECISION,
  batch_id TEXT,
  raw JSONB,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_driver_date ON orders(driver_id, order_date);
CREATE INDEX IF NOT EXISTS idx_orders_client_date ON orders(client_id, order_date);
CREATE INDEX IF NOT EXISTS idx_orders_status_date ON orders(status, order_date);
CREATE INDEX IF NOT EXISTS idx_orders_pair_date  ON orders(driver_id, client_id, order_date);
CREATE INDEX IF NOT EXISTS idx_orders_batch      ON orders(batch_id);

CREATE TABLE IF NOT EXISTS upload_batches (
  id TEXT PRIMARY KEY,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by TEXT,
  source TEXT,
  total_rows INTEGER,
  inserted_rows INTEGER,
  duplicate_rows INTEGER,
  meta JSONB
);
