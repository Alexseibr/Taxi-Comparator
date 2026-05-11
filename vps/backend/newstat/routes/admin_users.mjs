// routes/admin_users.mjs — CRUD пользователей newstat. Только role=admin.
// GET    /admin/users              — список (без password_hash)
// POST   /admin/users              — создать (login, name, role[, password])
// PATCH  /admin/users/:id          — обновить (name, role, active, password)
// DELETE /admin/users/:id          — удалить
import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { query } from "../lib/db.mjs";
import { hashPassword, requireAuth } from "../lib/auth.mjs";

export const adminUsersRouter = Router();

const ALLOWED_ROLES = ["admin", "antifraud", "viewer"];
const RoleZ = z.enum(["admin", "antifraud", "viewer"]);

const CreateBody = z.object({
  login:    z.string().trim().min(2).max(64).regex(/^[a-zA-Z0-9_.-]+$/, "только латиница, цифры и . _ -"),
  name:     z.string().trim().min(1).max(128),
  role:     RoleZ,
  password: z.string().min(6).max(256).optional(),  // если не задан — генерим
});

const UpdateBody = z.object({
  name:     z.string().trim().min(1).max(128).optional(),
  role:     RoleZ.optional(),
  active:   z.boolean().optional(),
  password: z.string().min(6).max(256).optional(),
}).refine((o) => Object.keys(o).length > 0, "no_fields_to_update");

function genId() {
  return "u_" + crypto.randomUUID();
}

function genPassword() {
  // 12 символов, base32-ish без неоднозначных
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let out = "";
  const bytes = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// ─── GET /admin/users ───────────────────────────────────────────────────
adminUsersRouter.get("/users", requireAuth(["admin"]), async (req, res) => {
  const r = await query(
    `SELECT id, login, name, role, active, created_at
       FROM users
      ORDER BY created_at ASC, login ASC`,
  );
  res.json({ ok: true, users: r.rows });
});

// ─── POST /admin/users ──────────────────────────────────────────────────
adminUsersRouter.post("/users", requireAuth(["admin"]), async (req, res) => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_request", details: parsed.error.flatten() });
  }
  const { login, name, role } = parsed.data;
  const password = parsed.data.password ?? genPassword();
  const password_hash = await hashPassword(password);
  const id = genId();
  try {
    const r = await query(
      `INSERT INTO users(id, login, name, role, password_hash, active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, login, name, role, active, created_at`,
      [id, login, name, role, password_hash],
    );
    req.log.info({ admin: req.user?.login, created: login }, "newstat user created");
    res.json({
      ok: true,
      user: r.rows[0],
      // generated_password возвращаем ТОЛЬКО если админ не указал свой,
      // чтобы он мог его передать сотруднику. После закрытия страницы
      // восстановить пароль нельзя — только сбросить через PATCH.
      generated_password: parsed.data.password ? null : password,
    });
  } catch (e) {
    if (String(e?.code) === "23505") {
      return res.status(409).json({ ok: false, error: "login_already_exists" });
    }
    if (String(e?.code) === "23514") {
      return res.status(400).json({ ok: false, error: "invalid_role", allowed: ALLOWED_ROLES });
    }
    throw e;
  }
});

// ─── PATCH /admin/users/:id ─────────────────────────────────────────────
adminUsersRouter.patch("/users/:id", requireAuth(["admin"]), async (req, res) => {
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_request", details: parsed.error.flatten() });
  }
  const { id } = req.params;
  const set = [];
  const args = [];
  let i = 1;

  if (parsed.data.name !== undefined)   { set.push(`name = $${i++}`);   args.push(parsed.data.name); }
  if (parsed.data.role !== undefined)   { set.push(`role = $${i++}`);   args.push(parsed.data.role); }
  if (parsed.data.active !== undefined) { set.push(`active = $${i++}`); args.push(parsed.data.active); }
  let generatedPassword = null;
  if (parsed.data.password !== undefined) {
    set.push(`password_hash = $${i++}`);
    args.push(await hashPassword(parsed.data.password));
    // Тут не возвращаем generated_password, потому что админ задал его сам.
  }
  args.push(id);
  try {
    const r = await query(
      `UPDATE users SET ${set.join(", ")}
        WHERE id = $${i}
        RETURNING id, login, name, role, active, created_at`,
      args,
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "not_found" });

    // Если изменили role / active — на всякий случай инвалидируем все сессии,
    // чтобы пользователь не остался с устаревшими правами.
    if (parsed.data.role !== undefined || parsed.data.active !== undefined || parsed.data.password !== undefined) {
      await query("DELETE FROM sessions WHERE user_id = $1", [id]);
    }
    req.log.info({ admin: req.user?.login, target: id, changes: Object.keys(parsed.data) }, "newstat user updated");
    res.json({ ok: true, user: r.rows[0], generated_password: generatedPassword });
  } catch (e) {
    if (String(e?.code) === "23514") {
      return res.status(400).json({ ok: false, error: "invalid_role", allowed: ALLOWED_ROLES });
    }
    throw e;
  }
});

// ─── DELETE /admin/users/:id ────────────────────────────────────────────
adminUsersRouter.delete("/users/:id", requireAuth(["admin"]), async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) {
    return res.status(400).json({ ok: false, error: "cannot_delete_self" });
  }
  const r = await query("DELETE FROM users WHERE id = $1", [id]);
  if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "not_found" });
  req.log.info({ admin: req.user?.login, target: id }, "newstat user deleted");
  res.json({ ok: true });
});

// ─── POST /admin/users/:id/reset-password ───────────────────────────────
// Сбрасывает пароль в случайный и возвращает его одноразово.
adminUsersRouter.post("/users/:id/reset-password", requireAuth(["admin"]), async (req, res) => {
  const { id } = req.params;
  const password = genPassword();
  const password_hash = await hashPassword(password);
  const r = await query(
    `UPDATE users SET password_hash = $1
      WHERE id = $2
      RETURNING id, login, name, role, active`,
    [password_hash, id],
  );
  if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "not_found" });
  await query("DELETE FROM sessions WHERE user_id = $1", [id]);
  req.log.info({ admin: req.user?.login, target: id }, "newstat user password reset");
  res.json({ ok: true, user: r.rows[0], generated_password: password });
});
