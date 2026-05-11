-- 015: Hidden Links — device fingerprints, IP links, shared signals
-- Для выявления мульти-аккаунтов без использования телефонов.

-- 1. Device fingerprints: отпечатки устройств (user_agent + platform → device_hash)
CREATE TABLE IF NOT EXISTS device_fingerprints (
  id           BIGSERIAL PRIMARY KEY,
  entity_type  TEXT        NOT NULL CHECK (entity_type IN ('driver','client')),
  entity_id    TEXT        NOT NULL,
  device_hash  TEXT        NOT NULL,  -- sha256(user_agent||platform)
  user_agent   TEXT,
  platform     TEXT,                  -- ios|android|web
  first_seen   DATE        NOT NULL,
  last_seen    DATE        NOT NULL,
  UNIQUE (entity_type, entity_id, device_hash)
);

-- 2. IP links: связи entity → IP-адрес
CREATE TABLE IF NOT EXISTS ip_links (
  id           BIGSERIAL PRIMARY KEY,
  entity_type  TEXT        NOT NULL CHECK (entity_type IN ('driver','client')),
  entity_id    TEXT        NOT NULL,
  ip_address   TEXT        NOT NULL,
  first_seen   DATE        NOT NULL,
  last_seen    DATE        NOT NULL,
  UNIQUE (entity_type, entity_id, ip_address)
);

-- 3. Shared signals: скрытые связи между entity по общему устройству или IP
CREATE TABLE IF NOT EXISTS shared_signals (
  id             BIGSERIAL PRIMARY KEY,
  entity_a_type  TEXT        NOT NULL,
  entity_a_id    TEXT        NOT NULL,
  entity_b_type  TEXT        NOT NULL,
  entity_b_id    TEXT        NOT NULL,
  signal_type    TEXT        NOT NULL CHECK (signal_type IN ('device','ip')),
  signal_value   TEXT        NOT NULL,  -- device_hash или ip_address
  strength       NUMERIC(5,2) NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_a_type, entity_a_id, entity_b_type, entity_b_id, signal_type, signal_value)
);

CREATE INDEX IF NOT EXISTS idx_device_fp_entity ON device_fingerprints(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_device_fp_hash   ON device_fingerprints(device_hash);
CREATE INDEX IF NOT EXISTS idx_ip_links_entity  ON ip_links(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ip_links_ip      ON ip_links(ip_address);
CREATE INDEX IF NOT EXISTS idx_shared_a         ON shared_signals(entity_a_type, entity_a_id);
CREATE INDEX IF NOT EXISTS idx_shared_b         ON shared_signals(entity_b_type, entity_b_id);
CREATE INDEX IF NOT EXISTS idx_shared_type      ON shared_signals(signal_type);

-- Права для app user
GRANT SELECT, INSERT, UPDATE, DELETE ON device_fingerprints TO newstat_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ip_links             TO newstat_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON shared_signals       TO newstat_user;
GRANT USAGE, SELECT ON SEQUENCE device_fingerprints_id_seq TO newstat_user;
GRANT USAGE, SELECT ON SEQUENCE ip_links_id_seq             TO newstat_user;
GRANT USAGE, SELECT ON SEQUENCE shared_signals_id_seq       TO newstat_user;
