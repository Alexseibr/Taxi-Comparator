-- 006_client_risk_total_orders.sql
-- T007 fix (architect): total_orders должно быть отдельной колонкой,
-- а не только внутри signals — чтобы фильтровать/сортировать без распаковки jsonb.
-- Бэкаплнем из signals для уже посчитанных дней.

ALTER TABLE client_risk_daily
  ADD COLUMN IF NOT EXISTS total_orders integer NOT NULL DEFAULT 0;

-- бэкафилл: значение лежит в signals.total_orders (если есть)
UPDATE client_risk_daily
   SET total_orders = COALESCE((signals->>'total_orders')::int, 0)
 WHERE total_orders = 0
   AND signals ? 'total_orders';

-- индекс на пары (date, total_orders) — для отчётов «топ-N клиентов по объёму»
CREATE INDEX IF NOT EXISTS idx_crd_total_orders ON client_risk_daily(date, total_orders DESC);
