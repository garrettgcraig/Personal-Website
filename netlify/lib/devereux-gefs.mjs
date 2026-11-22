// NOAA GEFS ensemble-mean rain forecast for Devereux Slough, bias-corrected against the Coal Oil
// Point gauge, and the record the correction keeps learning from.
//
// Each GEFS run (00, 06, 12, 18 UTC) is out about 5 hours after it starts. Rain comes as 6-hour
// totals; only the APCP field of each file is downloaded (HTTP range from the .idx file on
// NOAA's AWS open-data bucket) and read at the slough with a small GRIB2 decoder.
//
// Correction: the forecast is split into 24-hour blocks counted from when the run is out. The
// first block uses the 0-24 h correction, every later block the 24-48 h one. A block's total T
// becomes a*T^b ("power", larger storms scaled up more) or k*T ("scale"), and every hour in the
// block is scaled by the same ratio. Parameters were fit on 3,692 past runs (Jan 2019 to Apr 2026)
// against the gauge; devereux-gefs-refit.mjs refits them weekly with every run the site has used
// since, inside fixed bounds.
import { getStore } from "@netlify/blobs";
import { decodeGrib2, valueAt } from "./grib2.mjs";

export const BUCKET = "https://noaa-gefs-pds.s3.amazonaws.com";
export const POINT = [34.41, -119.88]; // the slough, as in the fit
export const AVAIL_H = 5;
export const FH = Array.from({ length: 44 }, (_, i) => 6 * (i + 1)); // 6 .. 264 h
const HOUR = 3600000;
const UA = { "User-Agent": "garrettgcraig.com devereux-breach (https://garrettgcraig.com/devereux/)" };

// Fit on the 3,692 past runs (devereux-breach analysis/berm/dial_replay.py)
export const DEFAULT_CORRECTION = {
  kind: "power",
  power: { 0: [1.3122, 1.1934], 1: [1.3255, 1.1745] },
  scale: { 0: 1.4149, 1: 1.4778 },
  source: "fit on 3,692 GEFS runs, Jan 2019 to Apr 2026",
};
// A refit outside these is ignored (kept at the last good values)
export const BOUNDS = { scale: [1.0, 2.2], a: [0.8, 2.5], b: [0.8, 1.6] };

export const store = () => {
  try { return getStore({ name: "devereux" }); } catch { return null; }
};

const pad = (n) => String(n).padStart(2, "0");
export function runUrl(initMs, fh) {
  const d = new Date(initMs);
  const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`, hh = pad(d.getUTCHours());
  return `${BUCKET}/gefs.${ymd}/${hh}/atmos/pgrb2ap5/geavg.t${hh}z.pgrb2a.0p50.f${String(fh).padStart(3, "0")}`;
}

async function get(url, opts = {}, ms = 15000) {
  const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(ms) });
  return r;
}

// One 6-hour bucket: [start_h, end_h, inches] or null if the file isn't there yet.
export async function bucket(initMs, fh) {
  const u = runUrl(initMs, fh);
  const idx = await get(u + ".idx");
  if (!idx.ok) return null;
  const lines = (await idx.text()).trim().split("\n");
  const i = lines.findIndex((l) => l.includes(":APCP:surface:"));
  if (i < 0) return null;
  const a = Number(lines[i].split(":")[1]);
  const b = i + 1 < lines.length ? Number(lines[i + 1].split(":")[1]) - 1 : "";
  const m = /(\d+)-(\d+) hour acc/.exec(lines[i]);
  const r = await get(u, { headers: { Range: `bytes=${a}-${b}` } }, 20000);
  if (!r.ok) throw new Error(`${r.status} GEFS f${fh}`);
  const msg = decodeGrib2(new Uint8Array(await r.arrayBuffer()));
  const mm = Math.max(0, valueAt(msg, POINT[0], POINT[1]));
  return [m ? +m[1] : fh - 6, m ? +m[2] : fh, mm / 25.4];
}

// Newest run whose last file is out, at most `back` runs back.
export async function newestRun(now = Date.now(), back = 4) {
  let t = Math.floor((now - AVAIL_H * HOUR) / (6 * HOUR)) * 6 * HOUR;
  for (let k = 0; k <= back; k++, t -= 6 * HOUR) {
    const r = await get(runUrl(t, FH.at(-1)) + ".idx", { method: "HEAD" }).catch(() => null);
    if (r?.ok) return t;
  }
  return null;
}

export async function fetchRun(initMs, concurrency = 11) {
  const out = new Array(FH.length);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < FH.length) {
      const k = next++;
      out[k] = await bucket(initMs, FH[k]);
    }
  }));
  if (out.some((x) => x == null)) throw new Error("GEFS run incomplete");
  return { init: new Date(initMs).toISOString(), available_at: new Date(initMs + AVAIL_H * HOUR).toISOString(), buckets: out };
}

// Latest run from the store; fetch and save a newer one when there is one (and log it for refits).
export async function latestRun({ now = Date.now(), blobs = store(), fetchNew = true } = {}) {
  const saved = blobs ? await blobs.get("gefs-latest", { type: "json" }).catch(() => null) : null;
  if (!fetchNew) return saved;
  const expected = Math.floor((now - AVAIL_H * HOUR) / (6 * HOUR)) * 6 * HOUR;
  if (saved && Date.parse(saved.init) >= expected) return saved;
  const init = await newestRun(now);
  if (init == null || (saved && Date.parse(saved.init) >= init)) return saved;
  const run = { ...(await fetchRun(init)), fetched_at: new Date(now).toISOString() };
  if (blobs) {
    await blobs.setJSON("gefs-latest", run).catch(() => {});
    // the first 60 hours, raw, for the refit
    await blobs.setJSON(`gefs-log/${run.init}`, { init: run.init, buckets: run.buckets.filter((b) => b[1] <= 60) }).catch(() => {});
  }
  return run;
}

// ---------------------------------------------------------------- correction
export function correctTotal(corr, w, T) {
  if (!(T > 0)) return 0;
  if (corr.kind === "scale") return T * corr.scale[w];
  const [a, b] = corr.power[w];
  return a * T ** b;
}

// Hourly series [{t (hour start, ms), raw, in}] for a run, corrected in 24-hour blocks from when
// the run is out (hours before that go with the first block).
export function correctedHourly(run, corr) {
  const init = Date.parse(run.init);
  const hrs = [];
  for (const [s, e, v] of run.buckets) for (let h = s; h < e; h++) hrs.push({ t: init + h * HOUR, lead: h, raw: v / (e - s) });
  hrs.sort((a, b) => a.t - b.t);
  const blockOf = (lead) => Math.max(0, Math.floor((lead - AVAIL_H) / 24));
  const tot = {};
  for (const h of hrs) tot[blockOf(h.lead)] = (tot[blockOf(h.lead)] || 0) + h.raw;
  return hrs.map((h) => {
    const k = blockOf(h.lead), T = tot[k];
    const f = T > 0 ? correctTotal(corr, Math.min(k, 1), T) / T : 0;
    return { t: h.t, raw: h.raw, in: h.raw * f };
  });
}

const localParts = (ms) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms));
  const g = (t) => f.find((x) => x.type === t).value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hour: g("hour") };
};

// Same shape as the page's earlier forecast feed: hourly keys are local hours "YYYY-MM-DDTHH:00"
// holding the rain over the hour ending then; daily totals are midnight to midnight, local, and only
// for days the run covers in full.
export function forecastMaps(hourly) {
  const out = { hourly: {}, daily: {}, hours: {} };
  for (const h of hourly) {
    const end = localParts(h.t + HOUR);
    out.hourly[`${end.date}T${end.hour}:00`] = Math.round(h.in * 10000) / 10000;
    const d = localParts(h.t).date;
    out.daily[d] = (out.daily[d] || 0) + h.in;
    out.hours[d] = (out.hours[d] || 0) + 1;
  }
  // the run's first day is partly in the past (and those hours are measured, not forecast); a
  // partial last day is dropped (23-25 h days are clock changes)
  const days = Object.keys(out.daily).sort();
  for (const d of days) {
    if (d === days.at(-1) && out.hours[d] < 23) delete out.daily[d];
    else out.daily[d] = Math.round(out.daily[d] * 1000) / 1000;
  }
  return out;
}

// ---------------------------------------------------------------- refit
// Fit per lead window on [forecast total, gauge total] pairs. Power: least squares on the
// square-root scale, sqrt(obs) ~ c * fc^(b/2) with a = c^2 (closed form in c for each b).
export function fitCorrection(pairs, kind) {
  const out = {};
  for (const w of [0, 1]) {
    const P = pairs[w].filter(([f, o]) => f >= 0 && o >= 0);
    if (kind === "scale") {
      const so = P.reduce((s, p) => s + p[1], 0), sf = P.reduce((s, p) => s + p[0], 0);
      out[w] = so / sf;
      continue;
    }
    let best = null;
    for (let b = 0.6; b <= 1.8 + 1e-9; b += 0.0025) {
      let num = 0, den = 0;
      for (const [f, o] of P) { const g = f ** (b / 2); num += Math.sqrt(o) * g; den += g * g; }
      const c = num / den;
      let sse = 0;
      for (const [f, o] of P) sse += (Math.sqrt(o) - c * f ** (b / 2)) ** 2;
      if (!best || sse < best.sse) best = { a: c * c, b, sse };
    }
    out[w] = [best.a, best.b];
  }
  return out;
}

export function withinBounds(kind, p) {
  return [0, 1].every((w) => (kind === "scale"
    ? p[w] >= BOUNDS.scale[0] && p[w] <= BOUNDS.scale[1]
    : p[w][0] >= BOUNDS.a[0] && p[w][0] <= BOUNDS.a[1] && p[w][1] >= BOUNDS.b[0] && p[w][1] <= BOUNDS.b[1]));
}

// Window totals [fc, obs] for a logged run, from gauge rain keyed by UTC hour start (ms -> in).
export function runPairs(logged, gaugeByHour) {
  const init = Date.parse(logged.init);
  const hrs = new Map();
  for (const [s, e, v] of logged.buckets) for (let h = s; h < e; h++) hrs.set(h, v / (e - s));
  const out = [];
  for (const w of [0, 1]) {
    let fc = 0, obs = 0;
    for (let h = AVAIL_H + 24 * w; h < AVAIL_H + 24 * (w + 1); h++) {
      const g = gaugeByHour.get(init + h * HOUR);
      if (g == null || !hrs.has(h)) return null;
      fc += hrs.get(h); obs += g;
    }
    out.push([Math.round(fc * 1000) / 1000, Math.round(obs * 1000) / 1000]);
  }
  return out;
}

export async function correction(blobs = store()) {
  const c = blobs ? await blobs.get("gefs-correction", { type: "json" }).catch(() => null) : null;
  return c && withinBounds(c.kind, c[c.kind]) ? c : DEFAULT_CORRECTION;
}
