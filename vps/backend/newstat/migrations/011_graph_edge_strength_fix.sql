-- 011_graph_edge_strength_fix.sql
-- Исправление формулы edge_strength: repeat_ratio хранится в диапазоне 0..100
-- (см. pair_risk.mjs: ramp(orders,3,10)*100). Старая формула 0.4*repeat_ratio
-- вместе с LEAST(1.0,...) насыщала силу до 1.0 для большинства пар, из-за чего
-- порог BFS (>0.6) фактически не работал.
--
-- Новая формула нормирует repeat_ratio к [0..1] делением на 100, тогда
-- максимально возможная сила = 0.4 + 0.3 + 0.3 = 1.0.

BEGIN;

ALTER TABLE graph_edges DROP COLUMN edge_strength;

ALTER TABLE graph_edges
  ADD COLUMN edge_strength numeric(5,3)
    GENERATED ALWAYS AS (
      LEAST(
        1.0,
        0.4 * (repeat_ratio / 100.0)
        + 0.3 * CASE WHEN orders_count > 0
                     THEN noncash_orders::numeric / orders_count
                     ELSE 0 END
        + 0.3 * CASE WHEN orders_count > 0
                     THEN short_trip_count::numeric / orders_count
                     ELSE 0 END
      )
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_ge_strength ON graph_edges(edge_strength DESC);

INSERT INTO schema_migrations(id) VALUES ('011_graph_edge_strength_fix')
  ON CONFLICT DO NOTHING;

COMMIT;
