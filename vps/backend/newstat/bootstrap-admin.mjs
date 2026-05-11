// bootstrap-admin.mjs — однократно создаёт первого администратора newstat.
// Использование:
//   sudo -u rwbtaxi-newstat \
//     env $(cat /etc/rwbtaxi-newstat.env | xargs) \
//     ADMIN_LOGIN=admin ADMIN_NAME='Главный' ADMIN_PASS='...' \
//     node /opt/rwbtaxi-newstat/bootstrap-admin.mjs
//
// Скрипт идемпотентен: если юзер уже есть — обновит хеш и роль на admin (если active).

import crypto from "node:crypto";
import "dotenv/config";
import { pool, query } from "./lib/db.mjs";
import { hashPassword } from "./lib/auth.mjs";

const login = process.env.ADMIN_LOGIN;
const name = process.env.ADMIN_NAME || login;
const pass = process.env.ADMIN_PASS;

if (!login || !pass) {
  console.error("ADMIN_LOGIN and ADMIN_PASS env vars are required");
  process.exit(2);
}
if (pass.length < 8) {
  console.error("ADMIN_PASS must be >= 8 chars");
  process.exit(2);
}

const hash = await hashPassword(pass);
const id = "u_" + crypto.randomUUID();

const r = await query(
  `INSERT INTO users(id, login, name, password_hash, role, active)
   VALUES ($1, $2, $3, $4, 'admin', true)
   ON CONFLICT (login) DO UPDATE SET
     name = EXCLUDED.name,
     password_hash = EXCLUDED.password_hash,
     role = 'admin',
     active = true
   RETURNING id, login, name, role`,
  [id, login, name, hash],
);
console.log("admin ready:", r.rows[0]);
await pool.end();
