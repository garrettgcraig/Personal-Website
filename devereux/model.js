// Devereux Slough breach model, ported from the Python project (devereux-breach).
// Pure functions only: no network. netlify/functions/devereux-api.mjs fetches the
// data and calls forecast(). Parameters come from model-params.json, exported by
// devereux-breach/src/export_web.py.

const DAY = 86400000;

export const iso = (d) => new Date(d).toISOString().slice(0, 10);
export const addDays = (isoDate, n) => iso(Date.parse(isoDate) + n * DAY);
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

export function dateRange(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

// Water year starts Oct 1: WY2027 = 2026-10-01 .. 2027-09-30.
export const waterYear = (d) => Number(d.slice(0, 4)) + (Number(d.slice(5, 7)) >= 10 ? 1 : 0);
export const wyStart = (d) => `${waterYear(d) - 1}-10-01`;
const dayOfYear = (d) => daysBetween(`${d.slice(0, 4)}-01-01`, d) + 1;
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/**
 * Daily rain on the Coal Oil Point gauge scale (inches), mirroring obs.rain_composite:
 * the COP gauge where present; otherwise KSBA timing (/ ksba_ratio) with each storm's
 * total rescaled to the mean of the local CoCoRaHS gauges (each / its ratio).
 * cop, ksba: {date: inches}. cocorahs: {date: {station: inches}}, already shifted to
 * the day the rain fell.
 */
export function rainComposite(days, { cop = {}, ksba = {}, cocorahs = {} }, params) {
  const k = days.map((d) => (ksba[d] == null ? null : ksba[d] / params.rain.ksba_ratio));
  const local = days.map((d) => {
    const st = cocorahs[d];
    if (!st) return null;
    const vals = Object.entries(st)
      .filter(([s, v]) => v != null && params.rain.cocorahs[s])
      .map(([s, v]) => v / params.rain.cocorahs[s]);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  const est = k.slice();
  // storms = runs of days where either KSBA or the local gauges recorded rain
  let i = 0;
  while (i < days.length) {
    if (!((k[i] || 0) > 0 || (local[i] || 0) > 0)) { i++; continue; }
    let j = i;
    while (j < days.length && ((k[j] || 0) > 0 || (local[j] || 0) > 0)) j++;
    const idx = [...Array(j - i).keys()].map((x) => x + i);
    const kt = idx.reduce((a, x) => a + (k[x] || 0), 0);
    const lt = idx.reduce((a, x) => a + (local[x] || 0), 0);
    if (idx.some((x) => local[x] != null)) {
      for (const x of idx) {
        est[x] = kt > 0 ? (k[x] || 0) * Math.min(3, Math.max(1 / 3, lt / kt)) : local[x];
      }
    }
    i = j;
  }
  return days.map((d, n) => {
    if (cop[d] != null) return { date: d, rain_in: cop[d], src: "Coal Oil Point gauge" };
    if (est[n] != null) return { date: d, rain_in: est[n], src: "KSBA + CoCoRaHS" };
    return { date: d, rain_in: null, src: "missing" };
  });
}

export const crestFt = (dc, c) => c.c_inf - (c.c_inf - c.c0) * Math.exp(-dc / c.tau);

/**
 * Run the forecast.
 *  rain: [{date, rain_in, src}] covering at least (today - 120 d) .. (today + horizon - 1),
 *        observed before today, forecast from today on.
 *  closedSince: ISO date the mouth last closed.
 *  stage0: {date, ft} latest stage reading (ft NAVD88), on or before today.
 */
export function forecast({ rain, today, closedSince, stage0, params, showFrom }) {
  const P = rain.map((r) => r.rain_in ?? 0);
  const dates = rain.map((r) => r.date);
  const decay = params.api_decay;
  // rolling features
  const api = [];
  const rain3 = [];
  const rainWy = [];
  P.forEach((p, n) => {
    api.push((n ? api[n - 1] * decay : 0) + p);
    rain3.push(p + (P[n - 1] || 0) + (P[n - 2] || 0));
    const sameWy = n && waterYear(dates[n]) === waterYear(dates[n - 1]);
    rainWy.push((sameWy ? rainWy[n - 1] : 0) + p);
  });

  // water balance from the latest stage reading
  const wb = params.water_balance;
  const iStage = dates.indexOf(stage0.date);
  const stage = new Array(dates.length).fill(null);
  if (iStage >= 0) {
    stage[iStage] = stage0.ft;
    let s = stage0.ft;
    for (let n = iStage + 1; n < dates.length; n++) {
      const dc = daysBetween(closedSince, dates[n]) + 1;
      const inflow = wb.a0 * P[n] + wb.a1 * (P[n - 1] || 0) + wb.a2 * (P[n - 2] || 0) + wb.b * Math.max(P[n] - wb.ia, 0);
      const loss = wb.e0 + wb.e1 * Math.cos((2 * Math.PI * (dayOfYear(dates[n]) - 200)) / 365.25) + wb.q * Math.exp(-dc / 7);
      s = s + Math.exp(-wb.beta * (s - 6)) * inflow - loss;
      stage[n] = s;
    }
  }

  const L = params.rain_logit;
  const out = [];
  dates.forEach((d, n) => {
    if (d < (showFrom || today)) return;
    const dc = daysBetween(closedSince, d) + 1; // berm age at start of day, as in training
    const x = { rain_in: P[n], rain_3d: rain3[n], api: api[n], log_dc: Math.log(Math.max(dc, 1)), rain_wy: rainWy[n] };
    const z = L.intercept + L.features.reduce((a, f, k) => a + (L.coef[k] * (x[f] - L.mean[k])) / L.scale[k], 0);
    const pRain = sigmoid(z);
    const crest = crestFt(dc, params.crest);
    const pCrest = stage[n] == null ? null : sigmoid((stage[n] - crest) / params.crest.s);
    const p = Math.max(pRain, pCrest ?? 0);
    out.push({
      date: d,
      observed: d < today,
      rain_in: rain[n].rain_in,
      rain_src: rain[n].src,
      api: api[n],
      days_closed: dc,
      stage_ft: stage[n],
      crest_ft: crest,
      p_rain: pRain,
      p_crest: pCrest,
      p,
      alert: p >= params.thresholds.likely ? "likely" : p >= params.thresholds.watch ? "watch" : "low",
    });
  });
  return out;
}
