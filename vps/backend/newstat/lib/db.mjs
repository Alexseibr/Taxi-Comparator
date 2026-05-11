import pg from "pg";
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("FATAL: DATABASE_URL not set");
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("PG pool error:", err);
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function withTx(fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
