import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, withTx } from "./db.mjs";
import { logger } from "./logger.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = join(__dirname, "..", "migrations");

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function applied() {
  const r = await pool.query("SELECT id FROM schema_migrations");
  return new Set(r.rows.map((x) => x.id));
}

async function main() {
  await ensureTable();
  const done = await applied();
  const files = (await readdir(MIG_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) {
      logger.info({ file: f }, "skip already applied");
      continue;
    }
    const sql = await readFile(join(MIG_DIR, f), "utf8");
    logger.info({ file: f }, "applying");
    await withTx(async (c) => {
      await c.query(sql);
      await c.query("INSERT INTO schema_migrations(id) VALUES ($1)", [f]);
    });
    logger.info({ file: f }, "applied");
  }
  await pool.end();
}

main().catch((e) => {
  logger.error(e, "migration failed");
  process.exit(1);
});
