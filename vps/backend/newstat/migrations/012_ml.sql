-- 012_ml.sql
-- ML-модель риска (CatBoost) поверх эвристик. Этап T014.
-- ml_training_runs — журнал обучений; ml_predictions — текущие скоры по сущностям.

CREATE TABLE IF NOT EXISTS ml_training_runs (
    run_id          BIGSERIAL PRIMARY KEY,
    model_version   TEXT        NOT NULL,
    target_def      TEXT        NOT NULL,
    n_train         INTEGER     NOT NULL,
    n_test          INTEGER     NOT NULL,
    n_pos_train     INTEGER     NOT NULL DEFAULT 0,
    n_pos_test      INTEGER     NOT NULL DEFAULT 0,
    auc             NUMERIC(6,4),
    pr_auc          NUMERIC(6,4),
    accuracy        NUMERIC(6,4),
    top_features    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    params          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ml_training_runs_model_version_idx
    ON ml_training_runs (model_version);

-- Предсказания. entity_type = 'pair' | 'driver' | 'client'.
-- Для pair используется entity_id_a=driver_id, entity_id_b=client_id.
-- Для driver/client заполняется только entity_id_a, entity_id_b='' (пустая строка).
-- Чтобы PK был стабильным, держим NOT NULL.
CREATE TABLE IF NOT EXISTS ml_predictions (
    entity_type     TEXT        NOT NULL,
    entity_id_a     TEXT        NOT NULL,
    entity_id_b     TEXT        NOT NULL DEFAULT '',
    date            DATE        NOT NULL,
    model_version   TEXT        NOT NULL,
    score           NUMERIC(6,4) NOT NULL,
    heuristic_score NUMERIC(6,2),
    disagreement    NUMERIC(6,4),
    predicted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (entity_type, entity_id_a, entity_id_b, date)
);

CREATE INDEX IF NOT EXISTS ml_predictions_date_idx
    ON ml_predictions (date DESC);
CREATE INDEX IF NOT EXISTS ml_predictions_score_idx
    ON ml_predictions (entity_type, score DESC);
CREATE INDEX IF NOT EXISTS ml_predictions_disagreement_idx
    ON ml_predictions (entity_type, disagreement DESC NULLS LAST);

GRANT SELECT, INSERT, UPDATE, DELETE ON ml_training_runs TO newstat_user;
GRANT USAGE, SELECT ON SEQUENCE ml_training_runs_run_id_seq TO newstat_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ml_predictions TO newstat_user;

INSERT INTO schema_migrations (id) VALUES ('012_ml')
ON CONFLICT (id) DO NOTHING;
