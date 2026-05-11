-- 016_ticket_enrichment: trigger_reason + evidence_confidence для fraud_tickets
-- Позволяет сохранять, почему тикет был создан и с какой уверенностью.

ALTER TABLE fraud_tickets
  ADD COLUMN IF NOT EXISTS trigger_reason      TEXT,
  ADD COLUMN IF NOT EXISTS evidence_confidence INT;

COMMENT ON COLUMN fraud_tickets.trigger_reason IS
  'Основной триггер: cancel abuse, multi account, weak signal и т.п.';
COMMENT ON COLUMN fraud_tickets.evidence_confidence IS
  'Evidence confidence 0-100 на момент создания тикета';
