// lib/auth.mjs — Bearer-токены через таблицу sessions.
// Полностью изолировано от /wb (своя таблица users + sessions в БД rwbtaxi_newstat).
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { query } from "./db.mjs";

const TOKEN_TTL_DAYS = 30;
const BCRYPT_ROUNDS = 11;

export function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

// Хэшируем токен перед записью/поиском в БД (SHA-256). Если БД утечёт —
// действующие сессии нельзя будет восстановить из дампа. Сравнение по hash
// неотличимо от plaintext по производительности (b-tree index по text).
function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

// Чтобы verifyPassword тратил постоянное время даже когда юзера нет —
// сверяем пароль с этим заранее посчитанным фиктивным хэшем. Так наружу не
// утекает информация о существовании логина.
const DUMMY_HASH = bcrypt.hashSync("__never_match_account__", BCRYPT_ROUNDS);
export async function verifyDummy(plain) {
  await bcrypt.compare(plain, DUMMY_HASH);
  return false;
}

export async function createSession(userId) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 3600 * 1000);
  await query(
    "INSERT INTO sessions(token, user_id, expires_at) VALUES ($1,$2,$3)",
    [tokenHash(token), userId, expiresAt],
  );
  return { token, expiresAt };
}

export async function loadSession(token) {
  if (!token) return null;
  const r = await query(
    `SELECT s.expires_at, u.id, u.login, u.name, u.role, u.active
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now() AND u.active`,
    [tokenHash(token)],
  );
  return r.rows[0] || null;
}

export async function dropSession(token) {
  if (!token) return;
  await query("DELETE FROM sessions WHERE token = $1", [tokenHash(token)]);
}

function extractToken(req) {
  const h = req.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Express middleware: грузит сессию в req.user. Если нет — 401.
export function requireAuth(rolesAllowed) {
  return async (req, res, next) => {
    try {
      const token = extractToken(req);
      const sess = await loadSession(token);
      if (!sess) return res.status(401).json({ ok: false, error: "unauthorized" });
      if (rolesAllowed && rolesAllowed.length && !rolesAllowed.includes(sess.role)) {
        return res.status(403).json({ ok: false, error: "forbidden", role: sess.role });
      }
      req.user = {
        id: sess.id,
        login: sess.login,
        name: sess.name,
        role: sess.role,
      };
      req.token = token;
      next();
    } catch (e) {
      req.log?.error(e, "auth middleware error");
      res.status(500).json({ ok: false, error: "auth_error" });
    }
  };
}

// Опциональный auth — не падает если нет токена, но грузит юзера если есть
export async function loadOptionalUser(req, _res, next) {
  try {
    const token = extractToken(req);
    if (token) {
      const sess = await loadSession(token);
      if (sess) {
        req.user = { id: sess.id, login: sess.login, name: sess.name, role: sess.role };
        req.token = token;
      }
    }
    next();
  } catch (e) {
    req.log?.error(e, "optional auth error");
    next();
  }
}
