#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const PROCESSED = process.env.SCREENS_DIR || "/var/www/rwbtaxi/data/screens/processed";
const CALIB = process.env.CALIB_DIR || "/var/www/rwbtaxi/data/calib";
const DRY = process.env.DRY === "1";

function pickTripMin(parsed) {
  if (typeof parsed?.tripMinToDest === "number" && parsed.tripMinToDest > 0 && parsed.tripMinToDest <= 240) {
    return Math.round(parsed.tripMinToDest);
  }
  const arr = (parsed?.tariffs || [])
    .map((t) => t?.tripMin)
    .filter((x) => typeof x === "number" && x > 0 && x <= 240);
  if (!arr.length) return null;
  arr.sort((a, b) => a - b);
  return arr[Math.floor(arr.length / 2)];
}

function pickEtaMin(parsed) {
  const t = (parsed?.tariffs || []).find((x) => /эконом/i.test(x?.name || "")) || (parsed?.tariffs || [])[0];
  const v = t?.etaMin;
  if (typeof v === "number" && v >= 0 && v <= 120) return Math.round(v);
  return null;
}

const calibs = readdirSync(CALIB).filter((n) => n.startsWith("calib-") && n.endsWith(".json"));
console.log(`Calib JSONs: ${calibs.length}`);

let touched = 0, addedTrip = 0, addedEta = 0, noRaw = 0, noTaxi = 0, unchanged = 0;

for (const cf of calibs) {
  const cp = join(CALIB, cf);
  let cj;
  try { cj = JSON.parse(readFileSync(cp, "utf8")); } catch { continue; }
  const id = cj.id || cf.replace(/\.json$/, "");

  let rawPath = null;
  for (const ext of [".jpg", ".png", ".jpeg", ".webp"]) {
    const p = join(PROCESSED, `${id}${ext}.raw.json`);
    if (existsSync(p)) { rawPath = p; break; }
  }
  if (!rawPath) { noRaw++; continue; }

  let raw;
  try { raw = JSON.parse(readFileSync(rawPath, "utf8")); } catch { continue; }
  if (raw.stage !== "ok" || !raw.parsed?.isTaxiApp) { noTaxi++; continue; }

  const newTrip = pickTripMin(raw.parsed);
  const newEta = pickEtaMin(raw.parsed);

  let changed = false;
  if (newTrip != null && cj.tripMin !== newTrip) {
    if (cj.tripMin == null) addedTrip++;
    cj.tripMin = newTrip;
    changed = true;
  }
  if (newEta != null && cj.etaMin !== newEta) {
    if (cj.etaMin == null) addedEta++;
    cj.etaMin = newEta;
    changed = true;
  }

  if (changed) {
    cj.tripMinSyncedAt = new Date().toISOString();
    if (!DRY) writeFileSync(cp, JSON.stringify(cj, null, 2));
    touched++;
  } else {
    unchanged++;
  }
}

console.log(JSON.stringify({ touched, addedTrip, addedEta, noRaw, noTaxi, unchanged, dry: DRY }, null, 2));
