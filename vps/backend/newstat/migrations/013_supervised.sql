-- 013_supervised.sql
-- T015.1: supervised ML loop поверх weak-supervised из 012_ml.
-- Добавляет ручную разметку (fraud_training_labels), расширяет fraud_tickets/ml_training_runs/ml_predictions
-- под supervised-режим (candidate / active модели, метрики precision/recall/f1, top_features).

BEGIN;

-- 1) fraud_training_labels — источник правды для supervised retrain.
CREATE TABLE IF NOT EXISTS fraud_training_labels (
  id                bigserial   PRIMARY KEY,
  entity_type       text        NOT NULL CHECK (entity_type IN ('pair','driver','client','cluster')),
  entity_key        text        NOT NULL,
  date              date        NOT NULL,
  label             smallint    NOT NULL CHECK (label IN (0,1)),
  source_ticket_id  bigint      NULL REFERENCES fraud_tickets(ticket_id) ON DELETE SET NULL,
  ml_score          numeric(6,4) NULL,
  rule_score        numeric(6,2) NULL,
  graph_score       numeric(6,2) NULL,
  final_score       numeric(6,2) NULL,
  delta             numeric(6,4) NULL,
  reviewed_by       text        NULL,
  reviewed_at       timestamptz NOT NULL DEFAULT now(),
  comment           text        NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Уникальный ключ: одна разметка на (entity, дата, тикет). source_ticket_id может быть NULL —
-- в этом случае COALESCE даёт пустую строку, разные NULL-разметки тогда конфликтуют, что нам и надо
-- (одна ручная разметка пары без тикета).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fraud_training_labels
  ON fraud_training_labels (entity_type, entity_key, date, COALESCE(source_ticket_id, 0));

CREATE INDEX IF NOT EXISTS ix_fraud_training_labels_entity
  ON fraud_training_labels (entity_type, entity_key, date DESC);

CREATE INDEX IF NOT EXISTS ix_fraud_training_labels_label_date
  ON fraud_training_labels (label, date DESC);

-- 2) fraud_tickets — поля статуса разметки.
ALTER TABLE fraud_tickets
  ADD COLUMN IF NOT EXISTS label_status text NOT NULL DEFAULT 'unlabeled'
    CHECK (label_status IN ('unlabeled','labeled')),
  ADD COLUMN IF NOT EXISTS label_value  smallint NULL CHECK (label_value IS NULL OR label_value IN (0,1)),
  ADD COLUMN IF NOT EXISTS labeled_at   timestamptz NULL,
  ADD COLUMN IF NOT EXISTS labeled_by   text NULL;

CREATE INDEX IF NOT EXISTS ix_fraud_tickets_label_status
  ON fraud_tickets (label_status, date DESC);

-- 3) ml_training_runs — расширения под supervised.
ALTER TABLE ml_training_runs
  ADD COLUMN IF NOT EXISTS model_type     text NOT NULL DEFAULT 'weak_supervised'
    CHECK (model_type IN ('weak_supervised','supervised')),
  ADD COLUMN IF NOT EXISTS entity_type    text NOT NULL DEFAULT 'pair'
    CHECK (entity_type IN ('pair','driver','client','cluster')),
  ADD COLUMN IF NOT EXISTS status         text NOT NULL DEFAULT 'success'
    CHECK (status IN ('running','success','failed')),
  ADD COLUMN IF NOT EXISTS model_path     text NULL,
  ADD COLUMN IF NOT EXISTS rows_count     integer NULL,
  ADD COLUMN IF NOT EXISTS positive_count integer NULL,
  ADD COLUMN IF NOT EXISTS negative_count integer NULL,
  -- precision — non-reserved keyword в Postgres (часть "DOUBLE PRECISION"); чтобы избежать
  -- неоднозначностей при автогенерации SQL — храним как precision_score, в JSON отдаём "precision".
  ADD COLUMN IF NOT EXISTS precision_score numeric(6,4) NULL,
  ADD COLUMN IF NOT EXISTS recall          numeric(6,4) NULL,
  ADD COLUMN IF NOT EXISTS f1_score       numeric(6,4) NULL,
  ADD COLUMN IF NOT EXISTS roc_auc        numeric(6,4) NULL,
  ADD COLUMN IF NOT EXISTS error          text NULL,
  ADD COLUMN IF NOT EXISTS started_at     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS finished_at    timestamptz NULL,
  ADD COLUMN IF NOT EXISTS created_by     text NULL,
  ADD COLUMN IF NOT EXISTS is_active      boolean NOT NULL DEFAULT false;

-- Только одна active-модель на (model_type, entity_type).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ml_training_runs_active
  ON ml_training_runs (model_type, entity_type)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS ix_ml_training_runs_status_started
  ON ml_training_runs (status, started_at DESC);

-- Бэкфил для существующих weak-supervised запусков из 012_ml.
UPDATE ml_training_runs
   SET started_at  = COALESCE(started_at, created_at),
       finished_at = COALESCE(finished_at, created_at),
       roc_auc     = COALESCE(roc_auc, auc),
       rows_count  = COALESCE(rows_count, n_train + n_test),
       positive_count = COALESCE(positive_count, n_pos_train + n_pos_test),
       negative_count = COALESCE(negative_count, (n_train + n_test) - (n_pos_train + n_pos_test))
 WHERE model_type = 'weak_supervised';

-- Активная weak-supervised модель: самая свежая успешная по версии v* — пометим вручную через UPDATE
-- ниже только если is_active нигде ещё не выставлен (идемпотентность).
WITH cur AS (
  SELECT 1 FROM ml_training_runs WHERE model_type='weak_supervised' AND is_active=true LIMIT 1
), latest AS (
  SELECT run_id FROM ml_training_runs
   WHERE model_type='weak_supervised' AND status='success'
   ORDER BY created_at DESC LIMIT 1
)
UPDATE ml_training_runs
   SET is_active = true
 WHERE run_id IN (SELECT run_id FROM latest)
   AND NOT EXISTS (SELECT 1 FROM cur);

-- 4) ml_predictions — top_features для explainability.
ALTER TABLE ml_predictions
  ADD COLUMN IF NOT EXISTS top_features jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 5) GRANT для приложения.
GRANT SELECT, INSERT, UPDATE, DELETE ON fraud_training_labels TO newstat_user;
GRANT USAGE, SELECT ON SEQUENCE fraud_training_labels_id_seq TO newstat_user;

INSERT INTO schema_migrations (id) VALUES ('013_supervised')
ON CONFLICT (id) DO NOTHING;

COMMIT;
