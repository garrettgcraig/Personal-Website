// Scheduled every 3 hours (production deploys only): save Apple Weather's and GEFS's hourly rain
// forecasts for Devereux Slough side by side, so both can later be scored against the Coal Oil
// Point gauge storm by storm. Logging only; the live forecast is unchanged.
//
//   compare-log/apple/<fetch time>  Apple's next 240 h (skipped until WeatherKit keys are set)
//   compare-log/gefs/<run init>     each new GEFS run, all 264 h, raw and as corrected on the site
import { correction, correctedHourly, latestRun, store } from "../lib/devereux-gefs.mjs";
import { credentials, fetchHourly } from "../lib/devereux-weatherkit.mjs";

export async function logOnce({ now = Date.now(), blobs = store() } = {}) {
  const out = { apple: null, gefs: null };
  const creds = credentials();
  if (!creds) out.apple = "no WeatherKit keys";
  else {
    try {
      const a = await fetchHourly({ now, creds });
      const key = `compare-log/apple/${a.fetched_at.slice(0, 13)}`;
      await blobs.setJSON(key, a);
      out.apple = key;
    } catch (e) { out.apple = `error: ${e.message}`; }
  }
  try {
    const run = await latestRun({ now, blobs, fetchNew: false });
    const key = run && `compare-log/gefs/${run.init}`;
    if (run && !(await blobs.getMetadata(key).catch(() => null))) {
      const corr = await correction(blobs);
      const hours = correctedHourly(run, corr).map((h) => [h.t, Math.round(h.raw * 10000) / 10000, Math.round(h.in * 10000) / 10000]);
      await blobs.setJSON(key, { source: "gefs", init: run.init, available_at: run.available_at, fetched_at: run.fetched_at,
        correction: { kind: corr.kind, params: corr[corr.kind], source: corr.source }, hours });
      out.gefs = key;
    } else out.gefs = run ? "already logged" : "no run";
  } catch (e) { out.gefs = `error: ${e.message}`; }
  return out;
}

export default async () => {
  console.log(JSON.stringify(await logOnce()));
};

export const config = { schedule: "35 */3 * * *" };
