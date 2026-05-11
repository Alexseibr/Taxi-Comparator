// routes/secure.mjs — PII (phone) доступ только для admin
import { Router } from "express";
import { query }  from "../lib/db.mjs";
import { requireAuth } from "../lib/auth.mjs";

export const secureRouter = Router();

// GET /secure/contacts/:entityType/:id
// Возвращает контактные данные (phone). Только admin.
secureRouter.get("/contacts/:entityType/:id", requireAuth(["admin"]), async (req, res) => {
  const { entityType, id } = req.params;
  if (!["driver", "client"].includes(entityType)) {
    return res.status(400).json({ ok: false, error: "bad_entity_type" });
  }
  const trimId = String(id).trim();
  if (!trimId) return res.status(400).json({ ok: false, error: "bad_id" });

  const r = await query(
    `SELECT phone, updated_at FROM user_contacts_secure
      WHERE entity_type = $1 AND entity_id = $2`,
    [entityType, trimId],
  );

  if (!r.rows[0]) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  // Логируем доступ fire-and-forget (не ждём, не блокируем ответ)
  query(
    `INSERT INTO pii_access_log (user_id, entity_type, entity_id) VALUES ($1, $2, $3)`,
    [req.user.login, entityType, trimId],
  ).catch(() => {});

  return res.json({ ok: true, entity_type: entityType, entity_id: trimId, phone: r.rows[0].phone });
});
