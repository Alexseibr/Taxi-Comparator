#!/usr/bin/env node
// Batch-геокодер через TomTom Search API для пополнения coords в orders/*.json.
// Использование:
//   VITE_TOMTOM_KEY=xxx node scripts/geocode-batch.mjs <addr1>|<addr2>|...
// Печатает JSON { "addr": [lat, lng], ... } в stdout.

const KEY = process.env.VITE_TOMTOM_KEY;
if (!KEY) { console.error("ERROR: VITE_TOMTOM_KEY не задан"); process.exit(1); }

const arg = process.argv.slice(2).join(" ");
if (!arg) { console.error("Передай адреса через | (пайп)"); process.exit(1); }
const addrs = arg.split("|").map(s => s.trim()).filter(Boolean);

const MINSK = { lat: 53.9, lon: 27.55, radius: 150_000 };

async function geocode(q) {
  // POI + адресный поиск, привязка к Минску
  const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json`
    + `?key=${KEY}&limit=1&countrySet=BY`
    + `&lat=${MINSK.lat}&lon=${MINSK.lon}&radius=${MINSK.radius}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return { err: `HTTP ${r.status}` };
    const j = await r.json();
    const top = j?.results?.[0];
    if (!top) return { err: "no results" };
    const { lat, lon } = top.position;
    return { lat: +lat.toFixed(5), lng: +lon.toFixed(5), src: top.poi?.name || top.address?.freeformAddress || "" };
  } catch (e) { return { err: String(e.message || e) }; }
}

const out = {};
for (const a of addrs) {
  const r = await geocode(a);
  if (r.err) {
    console.error(`✗ ${a} — ${r.err}`);
    out[a] = null;
  } else {
    console.error(`✓ ${a} → [${r.lat}, ${r.lng}]  (${r.src})`);
    out[a] = [r.lat, r.lng];
  }
  await new Promise(r => setTimeout(r, 250)); // rate-limit
}
console.log(JSON.stringify(out, null, 2));
