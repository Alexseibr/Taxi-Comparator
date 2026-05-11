-- 008_anchors.sql — T013: якорная сетка Минска + категоризация дистанций.
-- Источник якорей: /opt/rwbtaxi-screens/anchors-minsk.json (read-only, парсер не трогаем).
-- Заполняется в ETL (recomputeForDates) после импорта; повторный recompute идемпотентен.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS anchor_a_id      text,
  ADD COLUMN IF NOT EXISTS anchor_b_id      text,
  ADD COLUMN IF NOT EXISTS dist_category    text,    -- short | medium | long | outside
  ADD COLUMN IF NOT EXISTS is_template_route boolean NOT NULL DEFAULT false;

-- Индексы под фильтры главного экрана и pair-risk.
CREATE INDEX IF NOT EXISTS idx_orders_dist_cat   ON orders(order_date, dist_category);
CREATE INDEX IF NOT EXISTS idx_orders_template   ON orders(order_date) WHERE is_template_route;
CREATE INDEX IF NOT EXISTS idx_orders_anchor_pair
  ON orders(order_date, anchor_a_id, anchor_b_id)
  WHERE anchor_a_id IS NOT NULL AND anchor_b_id IS NOT NULL;

-- Денормализованный кэш агрегатов по категориям дистанций (главный экран),
-- собирается одним проходом в ETL вместе с daily_driver_stats.
CREATE TABLE IF NOT EXISTS daily_distance_breakdown (
  date              date NOT NULL,
  dist_category     text NOT NULL,        -- short|medium|long|outside
  orders_count      int  NOT NULL DEFAULT 0,
  noncash_orders    int  NOT NULL DEFAULT 0,
  noncash_gmv       numeric(14,2) NOT NULL DEFAULT 0,
  total_gmv         numeric(14,2) NOT NULL DEFAULT 0,
  template_orders   int  NOT NULL DEFAULT 0,
  template_noncash_gmv numeric(14,2) NOT NULL DEFAULT 0,
  recomputed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, dist_category)
);

-- Колонки в daily_pair_stats — сырые цифры для расчёта риска и UI.
-- template_orders     — у пары заказов с is_template_route=true (шаблон из книжки)
-- template_noncash_gmv — безнал по ним
-- top_anchor_a_id / top_anchor_b_id — самая частая пара якорей внутри пары (driver,client)
ALTER TABLE daily_pair_stats
  ADD COLUMN IF NOT EXISTS template_orders        int           NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS template_noncash_gmv   numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS top_anchor_a_id        text,
  ADD COLUMN IF NOT EXISTS top_anchor_b_id        text,
  ADD COLUMN IF NOT EXISTS top_anchor_orders      int           NOT NULL DEFAULT 0;

-- Колонки в pair_risk_daily для нового сигнала «шаблон из книжки».
-- template_orders     — сколько у пары заказов с is_template_route=true
-- template_share      — доля от orders_count (0..1)
-- template_noncash_gmv — безнал по этим заказам (потенциальный кэшбэк-вред)
ALTER TABLE pair_risk_daily
  ADD COLUMN IF NOT EXISTS template_orders        int           NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS template_share         numeric(6,4)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS template_noncash_gmv   numeric(14,2) NOT NULL DEFAULT 0;
