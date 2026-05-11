// routes/screen_image.mjs — отдача исходного скриншота админу/антифроду.
// GET /parsing/screen/:id  → jpg/png, Cache-Control: private
//
// Файлы хранятся как:
//   /var/www/rwbtaxi/data/screens/processed/calib-<id>.jpg
//   /var/www/rwbtaxi/data/screens/failed/screen-<id>.png  (поломанные/нераспознанные)
// id извлекаем строго через whitelist regex, чтобы исключить path traversal.

import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { requireAuth } from "../lib/auth.mjs";

export const screenImageRouter = express.Router();

const SCREENS_DIR =
  process.env.SCREENS_DIR || "/var/www/rwbtaxi/data/screens";
// id примеров: calib-2026-04-27-h07-0e583c  /  screen-2026-04-27-h20-2fa953
const ID_RE = /^(calib|screen)-\d{4}-\d{2}-\d{2}-h\d{2}-[a-f0-9]{6,}$/;

// Кандидаты для поиска: где и под каким расширением может лежать файл.
function buildCandidates(id) {
  // Унифицируем: для любого id попробуем оба префикса (calib-, screen-) и
  // оба расширения (.jpg, .png) во всех трёх под-папках. Дешевле сделать
  // O(12) попыток stat, чем заставлять UI знать путь.
  const stem = id.replace(/^(calib|screen)-/, "");
  const folders = ["processed", "incoming", "failed"];
  const prefixes = ["calib-", "screen-"];
  const exts = [".jpg", ".jpeg", ".png", ".webp"];
  const out = [];
  for (const folder of folders) {
    for (const pre of prefixes) {
      for (const ext of exts) {
        out.push({
          rel: path.join(folder, `${pre}${stem}${ext}`),
          ext,
        });
      }
    }
  }
  return out;
}

screenImageRouter.get(
  "/screen/:id",
  requireAuth(["admin", "antifraud"]),
  async (req, res, next) => {
    try {
      const id = String(req.params.id || "");
      if (!ID_RE.test(id)) {
        return res.status(400).json({ ok: false, error: "bad_id" });
      }

      let chosen = null;
      for (const c of buildCandidates(id)) {
        const abs = path.resolve(SCREENS_DIR, c.rel);
        // Дополнительная защита: путь обязан остаться внутри SCREENS_DIR
        if (!abs.startsWith(path.resolve(SCREENS_DIR) + path.sep)) continue;
        try {
          const st = await fs.stat(abs);
          if (st.isFile()) {
            chosen = { abs, ext: c.ext };
            break;
          }
        } catch {
          /* not found, try next */
        }
      }
      if (!chosen) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }

      const mime =
        chosen.ext === ".png"
          ? "image/png"
          : chosen.ext === ".webp"
            ? "image/webp"
            : "image/jpeg";
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const buf = await fs.readFile(chosen.abs);
      res.end(buf);
    } catch (e) {
      next(e);
    }
  },
);
