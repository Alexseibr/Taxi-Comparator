#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error("usage: node csv-to-jsonl.mjs <input.csv> <output.jsonl>");
  process.exit(2);
}

function parseRow(s) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') q = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function tsToIso(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "+00:00");
}
function dateOnly(sec) {
  const iso = tsToIso(sec);
  return iso ? iso.slice(0, 10) : null;
}
function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function validCoord(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

const csv = fs.readFileSync(SRC, "utf8").replace(/^\uFEFF/, "");
const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
const header = parseRow(lines.shift()).map((s) => s.replace(/^"|"$/g, ""));
const idx = (name) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error("missing column: " + name);
  return i;
};
const I = {
  id: idx("id"),
  status: idx("status_id"),
  inSrc: idx("inform_source_id"),
  inc: idx("incoming_source_id"),
  pay1: idx("payment_type_id"),
  pay2: idx("payment_type_2_id"),
  userCancel: idx("user_cancel_id"),
  userCreate: idx("user_create_id"),
  userAssign: idx("user_assign_driver_id"),
  clientId: idx("client_id"),
  clientPhone: idx("client_phone"),
  clientName: idx("client_name"),
  passengerPhone: idx("passenger_phone"),
  passengerName: idx("passenger_name"),
  carCreate: idx("car_class_create_id"),
  carAppoint: idx("car_class_appoint_id"),
  autoId: idx("auto_id"),
  autoBrend: idx("auto_brend"),
  autoNumber: idx("auto_number"),
  driverId: idx("driver_id"),
  driverPhone: idx("driver_phone"),
  driverName: idx("driver_name"),
  franchId: idx("franch_id"),
  distOrder: idx("distance_order"),
  distApprove: idx("distance_approve"),
  pricePay1: idx("price_payment"),
  pricePay2: idx("price_payment_2"),
  pricePromo: idx("price_promo"),
  pricePaidService: idx("price_paid_service"),
  ppSum: idx("pp_sum"),
  tea: idx("tea"),
  priceMin: idx("price_min"),
  driverPerc: idx("driver_perc"),
  franchPerc: idx("franch_perc"),
  latIn: idx("lat_in"),
  lngIn: idx("lng_in"),
  latOut: idx("lat_out"),
  lngOut: idx("lng_out"),
  isNow: idx("is_now"),
  date: idx("date"),
  createdAt: idx("created_at"),
  appointedAt: idx("appointed_at"),
  driverAt: idx("driver_at"),
  clientAt: idx("client_at"),
  canceledAt: idx("canceled_at"),
  completedAt: idx("completed_at"),
};

const batchId = `wb-csv-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const nowIso = new Date().toISOString();

let kept = 0, skipped = 0;
const out = fs.createWriteStream(OUT);

for (const line of lines) {
  const r = parseRow(line);
  if (r.length < header.length) { skipped++; continue; }
  const orderId = str(r[I.id]);
  if (!orderId) { skipped++; continue; }

  const stRaw = str(r[I.status]);
  const cancelTs = num(r[I.canceledAt]);
  const completeTs = num(r[I.completedAt]);
  const clientAtTs = num(r[I.clientAt]);
  const driverAtTs = num(r[I.driverAt]);
  const createdTs = num(r[I.createdAt]);
  const appointedTs = num(r[I.appointedAt]);

  // status mapping
  // status_id=2 → completed (даже если completed_at=0, у нас client_at используется как факт поездки)
  // status_id=3 → cancelled
  // прочее → open
  let status = "open";
  if (stRaw === "2") status = "completed";
  else if (stRaw === "3") status = "cancelled";

  const latIn = num(r[I.latIn]);
  const lngIn = num(r[I.lngIn]);
  const latOut = num(r[I.latOut]);
  const lngOut = num(r[I.lngOut]);

  // km: используем price_min (в км по биллингу). Если пусто — distance_order/1000.
  const pm = num(r[I.priceMin]);
  const doRaw = num(r[I.distOrder]);
  let km2 = null;
  if (pm != null && pm > 0 && pm < 200) km2 = Math.round(pm * 100) / 100;
  else if (doRaw != null && doRaw > 0) km2 = Math.round((doRaw / 1000) * 100) / 100;

  // gmv: price_payment + price_payment_2 + price_promo + tea + price_paid_service + pp_sum
  const gmv = (() => {
    const a = num(r[I.pricePay1]) || 0;
    const b = num(r[I.pricePay2]) || 0;
    const c = num(r[I.pricePromo]) || 0;
    const d = num(r[I.tea]) || 0;
    const e = num(r[I.pricePaidService]) || 0;
    const f = num(r[I.ppSum]) || 0;
    const total = a + b + c + d + e + f;
    return total > 0 ? Math.round(total * 100) / 100 : null;
  })();

  // tripMin: client_at → finish_time (нет completedAt). Попробуем (canceled_at || end) - client_at.
  // У них completed_at=0 во всём датасете. Время поездки оценим как (последний таймстамп) - client_at.
  let tripMin = null;
  if (status === "completed" && clientAtTs && clientAtTs > 0) {
    const endTs = completeTs && completeTs > 0
      ? completeTs
      : (cancelTs && cancelTs > 0 && cancelTs > clientAtTs ? cancelTs : null);
    if (endTs && endTs > clientAtTs) {
      const m = (endTs - clientAtTs) / 60;
      if (m > 0 && m < 24 * 60) tripMin = Math.round(m * 100) / 100;
    }
  }

  // FTA: фактическое время подачи водителя = driver_at - created_at, минуты
  let fta = null;
  if (driverAtTs && createdTs && driverAtTs > createdTs) {
    const m = (driverAtTs - createdTs) / 60;
    if (m > 0 && m < 24 * 60) fta = Math.round(m * 100) / 100;
  }

  // clientWait: время посадки = client_at - driver_at, секунды
  let clientWait = null;
  if (clientAtTs && driverAtTs && clientAtTs > driverAtTs) {
    const s = clientAtTs - driverAtTs;
    if (s > 0 && s < 4 * 3600) clientWait = s;
  }

  const o = {
    orderId,
    orderDate: dateOnly(createdTs) || str(r[I.date]),
    createdAt: tsToIso(createdTs),
    cancelledAt: tsToIso(cancelTs),
    appointedAt: tsToIso(appointedTs),
    driverArrivedAt: tsToIso(driverAtTs),
    clientPickedUpAt: tsToIso(clientAtTs),
    fta,
    clientWait,
    gmv,
    km: km2,
    tripMin,
    clientId: str(r[I.clientId]),
    driverId: str(r[I.driverId]),
    status,
    // обогащение из CSV:
    clientPhone: str(r[I.clientPhone]),
    clientName: str(r[I.clientName]),
    passengerPhone: str(r[I.passengerPhone]),
    passengerName: str(r[I.passengerName]),
    driverPhone: str(r[I.driverPhone]),
    driverName: str(r[I.driverName]),
    autoId: str(r[I.autoId]),
    autoNumber: str(r[I.autoNumber]),
    autoBrand: str(r[I.autoBrend]),
    franchId: str(r[I.franchId]),
    carClassCreate: str(r[I.carCreate]),
    carClassAppoint: str(r[I.carAppoint]),
    paymentType: str(r[I.pay1]),
    paymentType2: str(r[I.pay2]),
    incomingSource: str(r[I.inc]),
    informSource: str(r[I.inSrc]),
    pricePromo: num(r[I.pricePromo]),
    isNow: str(r[I.isNow]),
    cancelledByUserId: str(r[I.userCancel]),
    createdByUserId: str(r[I.userCreate]),
    assignedByUserId: str(r[I.userAssign]),
    batchId,
    uploadedAt: nowIso,
    source: "csv-import",
  };

  if (validCoord(latIn, lngIn)) { o.latIn = latIn; o.lngIn = lngIn; }
  if (validCoord(latOut, lngOut)) { o.latOut = latOut; o.lngOut = lngOut; }

  // Чистим null-поля чтобы не раздувать JSONL.
  for (const k of Object.keys(o)) if (o[k] == null) delete o[k];

  out.write(JSON.stringify(o) + "\n");
  kept++;
}

out.end(() => {
  console.error(`done: kept=${kept} skipped=${skipped} → ${OUT}`);
});
