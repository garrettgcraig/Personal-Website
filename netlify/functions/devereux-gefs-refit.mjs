// Scheduled weekly (production deploys only): refit the GEFS rain correction for Devereux Slough.
// Every GEFS run the site has used is logged (gefs-log/*). Once both of its lead windows
// (0-24 h and 24-48 h after the run is out) have passed, the forecast totals are paired with the
// Coal Oil Point gauge's measured rain (NOAA USCRN hourly) and added to the 3,692 past pairs the
// correction was first fit on. The correction is refit on all pairs and saved only if it stays
// within fixed bounds; otherwise the last good one stays in use.
import pairsPast from "../lib/devereux-gefs-pairs.json" with { type: "json" };
import { AVAIL_H, BOUNDS, DEFAULT_CORRECTION, correction, fitCorrection, runPairs, store, withinBounds } from "../lib/devereux-gefs.mjs";

const HOUR = 3600000;
const UA = { "User-Agent": "garrettgcraig.com devereux-breach (https://garrettgcraig.com/devereux/)" };

// USCRN hourly02: field 1 UTC_DATE, 2 UTC_TIME (hour ending), 12 P_CALC mm. Keyed by UTC hour start.
export function gaugeHours(text, into = new Map()) {
  for (const line of text.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 13 || !/^\d{8}$/.test(f[1])) continue;
    const mm = Number(f[12]);
    if (!Number.isFinite(mm) || mm < 0) continue;
    const end = Date.UTC(+f[1].slice(0, 4), +f[1].slice(4, 6) - 1, +f[1].slice(6, 8), +f[2].slice(0, 2), +f[2].slice(2, 4));
    into.set(end - HOUR, mm / 25.4);
  }
  return into;
}

export default async () => {
  const blobs = store();
  const now = Date.now();
  const done = (await blobs.get("gefs-pairs", { type: "json" }).catch(() => null)) || { runs: {}, pairs: { 0: [], 1: [] } };
  const { blobs: logs } = await blobs.list({ prefix: "gefs-log/" });
  const ready = logs.map((b) => b.key.slice("gefs-log/".length))
    .filter((init) => !done.runs[init] && Date.parse(init) + (AVAIL_H + 48) * HOUR < now - 3 * HOUR);
  if (ready.length) {
    const years = [...new Set(ready.map((i) => i.slice(0, 4)).concat(new Date(now).toISOString().slice(0, 4)))];
    const gauge = new Map();
    for (const y of years) {
      const r = await fetch(`https://www.ncei.noaa.gov/pub/data/uscrn/products/hourly02/${y}/CRNH0203-${y}-CA_Santa_Barbara_11_W.txt`,
        { headers: UA, signal: AbortSignal.timeout(20000) });
      if (r.ok) gaugeHours(await r.text(), gauge);
    }
    for (const init of ready) {
      const logged = await blobs.get(`gefs-log/${init}`, { type: "json" });
      const p = logged && runPairs(logged, gauge);
      if (!p) continue; // gauge hours missing: try again next week (at most 30 days)
      done.runs[init] = 1;
      done.pairs[0].push(p[0]);
      done.pairs[1].push(p[1]);
    }
    for (const init of ready) if (!done.runs[init] && Date.parse(init) < now - 30 * 24 * HOUR) done.runs[init] = 0;
    await blobs.setJSON("gefs-pairs", done);
  }
  const cur = await correction(blobs);
  const kind = cur.kind || DEFAULT_CORRECTION.kind;
  const all = { 0: [...pairsPast.pairs[0], ...done.pairs[0]], 1: [...pairsPast.pairs[1], ...done.pairs[1]] };
  const fit = fitCorrection(all, kind);
  const ok = withinBounds(kind, fit);
  const n_new = done.pairs[0].length;
  if (ok) {
    await blobs.setJSON("gefs-correction", { ...DEFAULT_CORRECTION, ...cur, kind, [kind]: fit, n_pairs: all[0].length, n_new,
      fitted_at: new Date(now).toISOString(), source: `refit on ${all[0].length.toLocaleString("en-US")} runs (${n_new} logged by the site)` });
  }
  console.log(JSON.stringify({ kind, fit, ok, bounds: BOUNDS, n_new, added: ready.length }));
};

export const config = { schedule: "40 9 * * 1" };
