-- 009_fraud_tickets.sql — T015: Fraud Decision Workflow.
-- Добавляет тикетную систему ПОВЕРХ существующих risk-таблиц.
-- НЕ меняет формулы риска и не трогает daily_*-таблицы.
--
-- Применять под postgres-superuser:
--   sudo -u postgres psql rwbtaxi_newstat -f migrations/009_fraud_tickets.sql
-- Затем INSERT INTO schema_migrations(id) VALUES (9) ON CONFLICT DO NOTHING;

-- ── 1) Флаг блокировки кэшбэка на справочнике клиентов ───────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS cashback_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cashback_blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cashback_blocked_by TEXT;

-- ── 2) fraud_tickets ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fraud_tickets (
  ticket_id      BIGSERIAL PRIMARY KEY,
  entity_type    TEXT      NOT NULL CHECK (entity_type IN ('driver','client','pair')),
  driver_id      TEXT,
  client_id      TEXT,
  date           DATE      NOT NULL,

  risk_score     NUMERIC(5,2) NOT NULL,
  risk_type      TEXT      NOT NULL CHECK (risk_type IN ('guarantee','earnings','collusion','cashback')),
  money_at_risk_byn NUMERIC(12,2) NOT NULL DEFAULT 0,
  money_saved_byn   NUMERIC(12,2) NOT NULL DEFAULT 0,

  status         TEXT      NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new','in_review','confirmed_fraud','false_positive','closed')),
  decision       TEXT          CHECK (decision IS NULL OR decision IN ('deny_payout','allow','block_cashback','monitor')),
  priority       TEXT      NOT NULL DEFAULT 'low'
                  CHECK (priority IN ('low','medium','high')),

  signals            JSONB NOT NULL DEFAULT '{}'::jsonb,
  suspicious_orders  JSONB NOT NULL DEFAULT '[]'::jsonb,
  previous_flags_count INTEGER NOT NULL DEFAULT 0,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     TEXT NOT NULL DEFAULT 'system',
  assigned_to    TEXT,
  comment        TEXT,

  -- Ключ идемпотентности: одна сущность за один день — один тикет.
  -- generated column нужна, потому что UNIQUE с NULL не работает как ожидается
  -- для polymorphic ID (driver_id/client_id могут быть NULL для разного типа).
  entity_key TEXT GENERATED ALWAYS AS (
    entity_type || '|' || COALESCE(driver_id, '') || '|' || COALESCE(client_id, '')
  ) STORED,

  CONSTRAINT fraud_tickets_entity_shape CHECK (
    (entity_type = 'driver' AND driver_id IS NOT NULL AND client_id IS NULL)
 OR (entity_type = 'client' AND client_id IS NOT NULL AND driver_id IS NULL)
 OR (entity_type = 'pair'   AND driver_id IS NOT NULL AND client_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fraud_tickets_entity_date
  ON fraud_tickets(entity_key, date);

CREATE INDEX IF NOT EXISTS ix_fraud_tickets_date_money
  ON fraud_tickets(date, money_at_risk_byn DESC);
CREATE INDEX IF NOT EXISTS ix_fraud_tickets_status_date
  ON fraud_tickets(status, date);
CREATE INDEX IF NOT EXISTS ix_fraud_tickets_priority_date
  ON fraud_tickets(priority, date);
CREATE INDEX IF NOT EXISTS ix_fraud_tickets_driver
  ON fraud_tickets(driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_fraud_tickets_client
  ON fraud_tickets(client_id) WHERE client_id IS NOT NULL;

-- ── 3) fraud_ticket_events — журнал действий по тикету ──────────────
CREATE TABLE IF NOT EXISTS fraud_ticket_events (
  id          BIGSERIAL PRIMARY KEY,
  ticket_id   BIGINT NOT NULL REFERENCES fraud_tickets(ticket_id) ON DELETE CASCADE,
  action      TEXT   NOT NULL,                     -- 'created','status_change','decision','comment','reopen'
  old_status  TEXT,
  new_status  TEXT,
  decision    TEXT,
  comment     TEXT,
  meta        JSONB  NOT NULL DEFAULT '{}'::jsonb, -- например, money_saved_byn до/после
  user_id     TEXT,                                -- users.id или 'system'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_fraud_ticket_events_ticket
  ON fraud_ticket_events(ticket_id, created_at);

-- ── 4) GRANT для рантайм-роли newstat_user ─────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON fraud_tickets TO newstat_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON fraud_ticket_events TO newstat_user;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE fraud_tickets_ticket_id_seq TO newstat_user;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE fraud_ticket_events_id_seq  TO newstat_user;
-- clients уже принадлежит newstat_user, GRANT не нужен.
