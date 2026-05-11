-- 014: PII secure storage and access log
-- Телефоны и контакты хранятся отдельно, не в основных таблицах.

CREATE TABLE IF NOT EXISTS user_contacts_secure (
  id          BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('driver', 'client')),
  entity_id   TEXT NOT NULL,
  phone       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS pii_access_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pii_access_log_user ON pii_access_log(user_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_contacts_entity ON user_contacts_secure(entity_type, entity_id);

-- Мигрируем существующие телефоны из clients и drivers
INSERT INTO user_contacts_secure (entity_type, entity_id, phone)
SELECT 'client', id::text, phone
FROM clients
WHERE phone IS NOT NULL
ON CONFLICT (entity_type, entity_id) DO UPDATE SET phone = EXCLUDED.phone, updated_at = NOW();

INSERT INTO user_contacts_secure (entity_type, entity_id, phone)
SELECT 'driver', id::text, phone
FROM drivers
WHERE phone IS NOT NULL
ON CONFLICT (entity_type, entity_id) DO UPDATE SET phone = EXCLUDED.phone, updated_at = NOW();

-- Права для newstat_user (app user)
GRANT SELECT, INSERT, UPDATE, DELETE ON user_contacts_secure TO newstat_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON pii_access_log TO newstat_user;
GRANT USAGE, SELECT ON SEQUENCE user_contacts_secure_id_seq TO newstat_user;
GRANT USAGE, SELECT ON SEQUENCE pii_access_log_id_seq TO newstat_user;
