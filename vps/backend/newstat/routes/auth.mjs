// routes/auth.mjs — POST /login, GET /me, POST /logout, POST /sso
import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { query } from "../lib/db.mjs";
import { verifyPassword, verifyDummy, createSession, dropSession, requireAuth, hashPassword } from "../lib/auth.mjs";

export const authRouter = Router();

// WB-сервис, через который валидируем wb-токены для SSO. На проде — :3011.
// nginx делает rewrite ^/api/wb/(.*)$ /wb/$1, т.е. внутренний путь именно /wb/me.
const WB_BASE = process.env.WB_INTERNAL_BASE || "http://127.0.0.1:3011/wb";

const LoginBody = z.object({
  login: z.string().trim().min(2).max(64),
  password: z.string().min(1).max(256),
});

authRouter.post("/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "bad_request", details: parsed.error.flatten() });
  }
  const { login, password } = parsed.data;
  const r = await query(
    "SELECT id, login, name, role, password_hash, active FROM users WHERE login = $1",
    [login],
  );
  const u = r.rows[0];
  // Всегда вызываем bcrypt — на несуществующего/выключенного юзера сверяем
  // с фиктивным хэшем, чтобы наружу не утекала разница во времени ответа
  // (user enumeration).
  const ok = (u && u.active)
    ? await verifyPassword(password, u.password_hash)
    : await verifyDummy(password);
  if (!u || !u.active || !ok) {
    return res.status(401).json({ ok: false, error: "invalid_credentials" });
  }
  const sess = await createSession(u.id);
  req.log.info({ user: u.login }, "newstat login");
  res.json({
    ok: true,
    token: sess.token,
    expires_at: sess.expiresAt,
    user: { id: u.id, login: u.login, name: u.name, role: u.role },
  });
});

authRouter.get("/me", requireAuth(), async (req, res) => {
  res.json({ ok: true, user: req.user });
});

authRouter.post("/logout", requireAuth(), async (req, res) => {
  await dropSession(req.token);
  res.json({ ok: true });
});

// ─── POST /auth/sso ─────────────────────────────────────────────────────
// SSO-мост из WB. Поддерживает 2 канала валидации wb-сессии:
//   1) Authorization: Bearer <wb-token>  (legacy localStorage)
//   2) Cookie: rwb_sid=...               (HttpOnly cookie, основной)
// Оба заголовка просто проксируются в WB GET /me — WB сам разберёт.
// Юзер автоматически создаётся (или активируется) в newstat.users по login.
// Пароль ставится случайный — пользоваться им нельзя, такой юзер ходит только через SSO.
const SSO_ALLOWED_WB_ROLES = new Set(["admin", "antifraud"]);

authRouter.post("/sso", async (req, res) => {
  const incomingAuth = req.get("authorization") || "";
  const incomingCookie = req.get("cookie") || "";
  if (!incomingAuth && !incomingCookie) {
    return res.status(401).json({ ok: false, error: "no_wb_session" });
  }

  // 1. Валидируем wb-сессию через GET /me на WB-сервисе.
  let wbUser;
  try {
    const fwdHeaders = {};
    if (incomingAuth) fwdHeaders.authorization = incomingAuth;
    if (incomingCookie) fwdHeaders.cookie = incomingCookie;
    const r = await fetch(`${WB_BASE}/me`, { method: "GET", headers: fwdHeaders });
    if (r.status === 401) {
      return res.status(401).json({ ok: false, error: "wb_session_invalid" });
    }
    if (!r.ok) {
      req.log.warn({ status: r.status }, "wb /me unexpected status");
      return res.status(502).json({ ok: false, error: "wb_unreachable" });
    }
    const j = await r.json();
    wbUser = j?.user;
    if (!wbUser?.login || !wbUser?.role) {
      return res.status(502).json({ ok: false, error: "wb_bad_payload" });
    }
  } catch (e) {
    req.log.error(e, "sso wb fetch failed");
    return res.status(502).json({ ok: false, error: "wb_unreachable" });
  }

  // 2. Проверяем что роль допускает SSO.
  if (!SSO_ALLOWED_WB_ROLES.has(wbUser.role)) {
    return res.status(403).json({
      ok: false,
      error: "wb_role_not_allowed",
      wb_role: wbUser.role,
    });
  }

  // 3. Маппим wb-роль в newstat-роль. Сейчас 1:1 (admin↔admin, antifraud↔antifraud).
  // Так пользователь, помеченный в WB как antifraud, в newstat получает обычные права;
  // только admin в WB получает админ-возможности (создание юзеров и т.п.).
  const newstatRole = wbUser.role === "admin" ? "admin" : "antifraud";

  // 4. Upsert юзера в newstat.users по login. Важно: обновляем ТОЛЬКО name —
  // role и active управляются админом newstat вручную (через /admin/users) и
  // SSO не должен их перетирать. Иначе админ не сможет ни отключить юзера,
  // ни поменять ему роль — следующий SSO-логин всё откатит.
  // Только при первичной регистрации (INSERT) роль берётся из WB и active=true.
  const ssoLogin = String(wbUser.login).slice(0, 64);
  const ssoName  = String(wbUser.name || wbUser.login).slice(0, 128);
  const dummyPassword = crypto.randomBytes(32).toString("base64url");
  const dummyHash = await hashPassword(dummyPassword);
  const newId = "u_" + crypto.randomUUID();

  const upsert = await query(
    `INSERT INTO users(id, login, name, role, password_hash, active)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT (login) DO UPDATE
        SET name = EXCLUDED.name
     RETURNING id, login, name, role, active`,
    [newId, ssoLogin, ssoName, newstatRole, dummyHash],
  );
  const u = upsert.rows[0];

  // 4.1. Если admin newstat ранее отключил юзера — SSO не должен его воскрешать.
  if (u.active === false) {
    req.log.warn({ via: "sso", user: u.login }, "sso blocked: user disabled by admin");
    return res.status(403).json({
      ok: false,
      error: "user_disabled_by_admin",
    });
  }

  // 5. Выдаём newstat-сессию.
  const sess = await createSession(u.id);
  req.log.info({ via: "sso", user: u.login, role: u.role }, "newstat sso login");
  res.json({
    ok: true,
    token: sess.token,
    expires_at: sess.expiresAt,
    user: u,
    via: "sso",
  });
});
