-- 010_graph.sql
-- T020: Graph Fraud Analysis.
--
-- Слой графа связей водитель↔клиент, поверх существующих risk-моделей.
-- НЕ меняем формулы risk и daily-таблицы — только добавляем агрегаты для
-- кластеризации и визуализации.
--
-- Содержит:
--   graph_edges    — per-day связь (driver, client) с агрегатами заказов,
--                    силой связи (edge_strength) и риском пары.
--   graph_nodes    — снапшот узла (driver или client) за окно агрегации,
--                    с привязкой к cluster_id.
--   graph_clusters — связные компоненты графа сильных связей.
--

CREATE TABLE IF NOT EXISTS graph_edges (
  driver_id                text          NOT NULL,
  client_id                text          NOT NULL,
  date                     date          NOT NULL,
  orders_count             integer       NOT NULL DEFAULT 0,
  completed_orders         integer       NOT NULL DEFAULT 0,
  noncash_orders           integer       NOT NULL DEFAULT 0,
  total_gmv                numeric(12,2) NOT NULL DEFAULT 0,
  noncash_gmv              numeric(12,2) NOT NULL DEFAULT 0,
  short_trip_count         integer       NOT NULL DEFAULT 0,
  fast_arrival_count       integer       NOT NULL DEFAULT 0,
  repeat_ratio             numeric(5,2)  NOT NULL DEFAULT 0,
  pair_risk_score          numeric(5,2)  NOT NULL DEFAULT 0,
  cashback_generated_byn   numeric(12,2) NOT NULL DEFAULT 0,
  cashback_loss_risk_byn   numeric(12,2) NOT NULL DEFAULT 0,
  days_seen                integer       NOT NULL DEFAULT 1,
  first_seen_date          date          NOT NULL,
  last_seen_date           date          NOT NULL,
  edge_strength            numeric(5,3)
    GENERATED ALWAYS AS (
      LEAST(
        1.0,
        0.4 * repeat_ratio
        + 0.3 * CASE WHEN orders_count > 0
                     THEN noncash_orders::numeric / orders_count
                     ELSE 0 END
        + 0.3 * CASE WHEN orders_count > 0
                     THEN short_trip_count::numeric / orders_count
                     ELSE 0 END
      )
    ) STORED,
  updated_at               timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, client_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ge_date           ON graph_edges(date);
CREATE INDEX IF NOT EXISTS idx_ge_driver_date    ON graph_edges(driver_id, date);
CREATE INDEX IF NOT EXISTS idx_ge_client_date    ON graph_edges(client_id, date);
CREATE INDEX IF NOT EXISTS idx_ge_strength       ON graph_edges(edge_strength DESC);


CREATE TABLE IF NOT EXISTS graph_nodes (
  entity_id                  text          NOT NULL,
  entity_type                text          NOT NULL CHECK (entity_type IN ('driver','client')),
  total_orders               integer       NOT NULL DEFAULT 0,
  total_gmv                  numeric(12,2) NOT NULL DEFAULT 0,
  total_noncash_gmv          numeric(12,2) NOT NULL DEFAULT 0,
  total_connections          integer       NOT NULL DEFAULT 0,
  unique_partners            integer       NOT NULL DEFAULT 0,
  risk_score_avg             numeric(5,2)  NOT NULL DEFAULT 0,
  risk_score_max             numeric(5,2)  NOT NULL DEFAULT 0,
  total_cashback_generated   numeric(12,2) NOT NULL DEFAULT 0,
  total_cashback_risk        numeric(12,2) NOT NULL DEFAULT 0,
  cluster_id                 text,
  updated_at                 timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_gn_cluster        ON graph_nodes(cluster_id);
CREATE INDEX IF NOT EXISTS idx_gn_type           ON graph_nodes(entity_type);
CREATE INDEX IF NOT EXISTS idx_gn_risk           ON graph_nodes(risk_score_max DESC);


CREATE TABLE IF NOT EXISTS graph_clusters (
  cluster_id                  text          PRIMARY KEY,
  nodes_count                 integer       NOT NULL DEFAULT 0,
  drivers_count               integer       NOT NULL DEFAULT 0,
  clients_count               integer       NOT NULL DEFAULT 0,
  total_orders                integer       NOT NULL DEFAULT 0,
  total_gmv                   numeric(12,2) NOT NULL DEFAULT 0,
  total_noncash_gmv           numeric(12,2) NOT NULL DEFAULT 0,
  total_cashback_generated    numeric(12,2) NOT NULL DEFAULT 0,
  total_cashback_risk         numeric(12,2) NOT NULL DEFAULT 0,
  total_collusion_loss_risk   numeric(12,2) NOT NULL DEFAULT 0,
  avg_risk_score              numeric(5,2)  NOT NULL DEFAULT 0,
  max_risk_score              numeric(5,2)  NOT NULL DEFAULT 0,
  is_suspicious               boolean       NOT NULL DEFAULT false,
  cluster_type                text,
  reason                      jsonb         NOT NULL DEFAULT '{}'::jsonb,
  window_from                 date,
  window_to                   date,
  created_at                  timestamptz   NOT NULL DEFAULT now(),
  updated_at                  timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gc_suspicious     ON graph_clusters(is_suspicious, total_collusion_loss_risk DESC);
CREATE INDEX IF NOT EXISTS idx_gc_loss           ON graph_clusters(total_collusion_loss_risk DESC);


GRANT SELECT, INSERT, UPDATE, DELETE ON graph_edges    TO newstat_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON graph_nodes    TO newstat_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON graph_clusters TO newstat_user;
