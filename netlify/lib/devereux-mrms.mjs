// Radar-and-gauge rain estimates for Devereux Slough, to fill hours the Coal Oil Point gauge
// hasn't reported yet. The Coal Oil Point station's hourly feed (NOAA USCRN) sometimes lags by
// days; NOAA's MRMS multi-sensor estimate (radar adjusted to rain gauges, 1 km grid) is out
// within about an hour, on NOAA's AWS open-data bucket.
//
// Each hour is the MRMS "MultiSensor QPE 01H Pass 2" file, out about an hour after the hour.
// (Pass 1, out 15 minutes after the hour, uses fewer gauges and ran 15 to 55% lighter than Pass 2
// on three test storms, so it isn't used.) Only the gauge's own 1 km cell is read. The hourly scheduled function
// devereux-mrms.mjs keeps the last RETAIN_D days in Netlify Blobs; the status API fills gauge gaps
// from them, scaled by MRMS_SCALE to match the gauge.
import { gunzipSync, inflateSync } from "node:zlib";
import { getStore } from "@netlify/blobs";

export const BUCKET = "https://noaa-mrms-pds.s3.amazonaws.com";
// The Coal Oil Point USCRN gauge (CA Santa Barbara 11 W)
export const GAUGE = [34.4139, -119.8795];
const HOUR = 3600000;
export const RETAIN_D = 35;
const UA = { "User-Agent": "garrettgcraig.com devereux-breach (https://garrettgcraig.com/devereux/)" };

// MRMS reads light at the gauge. On 1,257 wet-season days (Oct to Apr, Oct 2020 to Apr 2026) the
// gauge caught 1.236 times MRMS Pass 2's total in its cell, with daily r = 0.986 and the factor
// between 1.22 and 1.28 when any one season is left out. Scaled this way and fit without the
// season scored, wet days were off by 0.12 in on average (the Santa Barbara airport gauge, KSBA:
// 0.19 in) and 94% of days with 1 in or more came within 25% (KSBA: 82%). The factor is fixed;
// filled hours don't feed the weekly GEFS refit, which reads the gauge's own hours.
export const MRMS_SCALE = 1.24;

export const store = () => {
  try { return getStore({ name: "devereux" }); } catch { return null; }
};

const pad = (n) => String(n).padStart(2, "0");
// File for the hour ending at `endMs` (UTC, on the hour)
export function mrmsUrl(endMs) {
  const d = new Date(endMs);
  const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const name = "MultiSensor_QPE_01H_Pass2_00.00";
  return `${BUCKET}/CONUS/${name}/${ymd}/MRMS_${name}_${ymd}-${pad(d.getUTCHours())}0000.grib2.gz`;
}

const u = (b, p, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; };
const s = (b, p, n) => { const v = u(b, p, n); const top = 2 ** (8 * n - 1); return v >= top ? -(v - top) : v; };

// One value from a GRIB2 message with PNG packing (data template 5.41) on a regular lat/lon
// grid scanned north to south, as MRMS writes them. Only the PNG rows down to the point's row are
// unfiltered. Returns the value in the field's units (mm), or null when the grid flags it missing
// (MRMS uses negative values for no coverage).
export function pngGribValue(buf, lat, lon) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== "GRIB" || b[7] !== 2) throw new Error("not a GRIB2 message");
  let p = 16, grid, rep, png;
  while (p < b.length - 4) {
    if (String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]) === "7777") break;
    const len = u(b, p, 4), sec = b[p + 4];
    if (sec === 3) {
      if (u(b, p + 12, 2) !== 0) throw new Error("grid template not supported");
      grid = { ni: u(b, p + 30, 4), nj: u(b, p + 34, 4), la1: s(b, p + 46, 4) / 1e6, lo1: s(b, p + 50, 4) / 1e6,
        di: u(b, p + 63, 4) / 1e6, dj: u(b, p + 67, 4) / 1e6, scan: b[p + 71] };
    } else if (sec === 5) {
      if (u(b, p + 9, 2) !== 41) throw new Error(`data template ${u(b, p + 9, 2)} not supported`);
      rep = { R: new DataView(b.buffer, b.byteOffset + p + 11, 4).getFloat32(0), E: s(b, p + 15, 2), D: s(b, p + 17, 2), nbits: b[p + 19] };
    } else if (sec === 6 && b[p + 5] !== 255) throw new Error("bitmaps not supported");
    else if (sec === 7) png = b.subarray(p + 5, p + len);
    p += len;
  }
  if (!grid || !rep || !png) throw new Error("incomplete GRIB2 message");
  if (grid.scan & 64) throw new Error("south-to-north scan not supported");
  const row = Math.round((grid.la1 - lat) / grid.dj);
  const col = Math.round(((((lon % 360) + 360) % 360) - grid.lo1) / grid.di);
  if (row < 0 || row >= grid.nj || col < 0 || col >= grid.ni) throw new Error("point outside the grid");
  const raw = pngPixel(png, row, col);
  const v = (rep.R + raw * 2 ** rep.E) / 10 ** rep.D;
  return v < 0 ? null : v;
}

// Pixel (row, col) of a grayscale or truecolor PNG as one big-endian integer.
export function pngPixel(png, row, col) {
  let p = 8, w, h, depth, ctype;
  const idat = [];
  while (p < png.length) {
    const len = u(png, p, 4), type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    if (type === "IHDR") { w = u(png, p + 8, 4); h = u(png, p + 12, 4); depth = png[p + 16]; ctype = png[p + 17]; }
    else if (type === "IDAT") idat.push(png.subarray(p + 8, p + 8 + len));
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const chans = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (!chans || depth < 8) throw new Error("PNG format not supported");
  if (row >= h || col >= w) throw new Error("pixel outside the PNG");
  const bpp = chans * depth / 8, stride = w * bpp;
  const data = inflateSync(Buffer.concat(idat));
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let r = 0; r <= row; r++) {
    const off = r * (stride + 1), f = data[off];
    for (let i = 0; i < stride; i++) {
      const x = data[off + 1 + i], a = i >= bpp ? cur[i - bpp] : 0, up = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + up;
      else if (f === 3) v = x + ((a + up) >> 1);
      else {
        const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
      }
      cur[i] = v & 255;
    }
    [prev, cur] = [cur, prev];
  }
  let v = 0;
  for (let k = 0; k < bpp; k++) v = v * 256 + prev[col * bpp + k];
  return v;
}

// Rain (inches) at the gauge for the hour ending `endMs`; null if the file isn't out yet. MRMS
// rain in its cell, not yet scaled.
export async function mrmsHour(endMs) {
  const r = await fetch(mrmsUrl(endMs), { headers: UA, signal: AbortSignal.timeout(20000) });
  if (r.status === 404 || r.status === 403) return null;
  if (!r.ok) throw new Error(`${r.status} MRMS`);
  const mm = pngGribValue(gunzipSync(Buffer.from(await r.arrayBuffer())), GAUGE[0], GAUGE[1]);
  return mm == null ? null : Math.round(mm / 25.4 * 10000) / 10000;
}

// Bring the saved record up to date: every hour of the last `backH` hours not saved yet, newest
// first, at most `maxFetch` hours per run and `concurrency` at a time, stopping new fetches after
// `budgetMs` (a run after a long outage catches up over the next few hours). Hours whose file
// isn't out yet are tried again next run. Record: { hours: { "<hour-end ISO>": inches }, updated_at }.
export async function updateRecord({ now = Date.now(), blobs = store(), backH = 168, maxFetch = 48, concurrency = 6, budgetMs = 18000 } = {}) {
  const t0 = Date.now();
  const rec = (blobs && await blobs.get("mrms-hourly", { type: "json" }).catch(() => null)) || { hours: {} };
  // files are out about 57 minutes after the hour
  const last = Math.floor((now - 50 * 60000) / HOUR) * HOUR;
  const todo = [];
  for (let t = last; t > last - backH * HOUR && todo.length < maxFetch; t -= HOUR) {
    if (rec.hours[new Date(t).toISOString()] == null) todo.push(t);
  }
  let next = 0, fetched = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < todo.length && Date.now() - t0 < budgetMs) {
      const t = todo[next++];
      try {
        const v = await mrmsHour(t);
        fetched++;
        if (v != null) rec.hours[new Date(t).toISOString()] = v;
      } catch { /* try this hour again next run */ }
    }
  }));
  const cutoff = new Date(now - RETAIN_D * 24 * HOUR).toISOString();
  for (const k of Object.keys(rec.hours)) if (k < cutoff) delete rec.hours[k];
  rec.updated_at = new Date(now).toISOString();
  if (blobs) await blobs.setJSON("mrms-hourly", rec);
  return { rec, fetched, pending: todo.length - next };
}

// Saved hours as the gauge's hourly keys: local standard time (UTC-8, as USCRN reports),
// "YYYY-MM-DDTHH:00" for the hour ending then, inches scaled to the gauge.
export function mrmsLocal(rec, scale = MRMS_SCALE) {
  const hourly = {};
  for (const [iso, v] of Object.entries(rec?.hours || {})) {
    if (!Number.isFinite(v)) continue;
    hourly[`${new Date(Date.parse(iso) - 8 * HOUR).toISOString().slice(0, 13)}:00`] = Math.round(v * scale * 10000) / 10000;
  }
  return { hourly };
}
