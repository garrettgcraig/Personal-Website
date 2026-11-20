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

export const crestFt = (dc, c) => c.c_inf - (c.c_inf - c.c0) * Math.exp(-dc / c.tau);

// Water balance: roll stage forward from a reading through daily rain P (inches).
// rest (optional): the starting reading is from partway through day i0. {rain_in: forecast
// rain still to fall that day, frac: fraction of the day left}. Day i0 then ends at the
// reading plus the inflow still to come: that share of the day's rain response, and the
// lagged runoff from the two days before for the rest of the day, less the day's losses.
function simulateStage(P, dates, i0, ft0, closedSince, wb, rest = null) {
  const out = new Array(dates.length).fill(null);
  let s = ft0;
  // wb.carry: the slough answers rain within hours (rise starts 3-4 h after rain begins, and
  // after the rain stops it gains only about a fifth more, within 6-8 h; devereux-breach
  // results/storm_response.csv, 49 storms). So the day's total response (a0 + a1 + a2) lands on
  // the rain day, with only wb.carry of it on the next day. The fitted lags describe daily
  // means, which trail the level itself. Without wb.carry the fitted daily-mean form is used.
  const sameDay = wb.carry != null, c = wb.carry ?? 0, A = wb.a0 + wb.a1 + wb.a2;
  if (rest) {
    const n = i0, dc = daysBetween(closedSince, dates[n]) + 1;
    const share = P[n] > 0 ? Math.min(1, rest.rain_in / P[n]) : 0;
    const inflow = sameDay
      ? ((1 - c) * A * P[n] + wb.b * Math.max(P[n] - wb.ia, 0)) * share + c * A * (P[n - 1] || 0) * rest.frac
      : (wb.a0 * P[n] + wb.b * Math.max(P[n] - wb.ia, 0)) * share
        + (wb.a1 * (P[n - 1] || 0) + wb.a2 * (P[n - 2] || 0)) * rest.frac;
    const loss = wb.e0 + wb.e1 * Math.cos((2 * Math.PI * (dayOfYear(dates[n]) - 200)) / 365.25) + wb.q * Math.exp(-dc / 7);
    s = s + Math.exp(-wb.beta * (s - 6)) * inflow - loss * rest.frac;
  }
  out[i0] = s;
  for (let n = i0 + 1; n < dates.length; n++) {
    const dc = daysBetween(closedSince, dates[n]) + 1;
    const inflow = sameDay
      ? (1 - c) * A * P[n] + c * A * (P[n - 1] || 0) + wb.b * Math.max(P[n] - wb.ia, 0)
      : wb.a0 * P[n] + wb.a1 * (P[n - 1] || 0) + wb.a2 * (P[n - 2] || 0) + wb.b * Math.max(P[n] - wb.ia, 0);
    const loss = wb.e0 + wb.e1 * Math.cos((2 * Math.PI * (dayOfYear(dates[n]) - 200)) / 365.25) + wb.q * Math.exp(-dc / 7);
    s = s + Math.exp(-wb.beta * (s - 6)) * inflow - loss;
    out[n] = s;
  }
  return out;
}

/**
 * Slough level from the latest reading through the forecast horizon, with a range.
 * The middle line uses observed rain before `today` and forecast rain after. The range
 * reruns the forecast days with params.rain_scenarios (e.g. half and 1.5x the forecast
 * rain), then widens each edge by the 80th-percentile model error, which grows with
 * days since the reading and rain since the reading (params.stage_error_80).
 * Returns [{date, ft, lo, hi, phase: "reading" | "estimated" | "forecast", rain_in}].
 */
export function stageOutlook({ rain, today, closedSince, stage0, params }) {
  const dates = rain.map((r) => r.date);
  const i0 = dates.indexOf(stage0.date);
  if (i0 < 0) return [];
  const P = rain.map((r) => r.rain_in ?? 0);
  const scaled = (k) => P.map((p, n) => (dates[n] >= today ? p * k : p));
  const [kLo, kHi] = params.rain_scenarios;
  const wb = params.water_balance;
  const PLo = scaled(kLo), PHi = scaled(kHi);
  const R = stage0.rest || null;
  const restK = (k) => (R ? { ...R, rain_in: R.rain_in * k } : null);
  const mid = simulateStage(P, dates, i0, stage0.ft, closedSince, wb, R);
  const lo = simulateStage(PLo, dates, i0, stage0.ft, closedSince, wb, restK(kLo));
  const hi = simulateStage(PHi, dates, i0, stage0.ft, closedSince, wb, restK(kHi));
  const e = params.stage_error_80;
  const out = [];
  let cumLo = 0, cumHi = 0;
  for (let n = i0; n < dates.length; n++) {
    if (n > i0) { cumLo += PLo[n]; cumHi += PHi[n]; }
    const days = n - i0 + (R ? R.frac : 0);
    const err = (cum) => (days ? e.a + e.per_day * days + e.per_in * (cum + (R ? R.rain_in : 0)) : 0);
    out.push({
      date: dates[n],
      ft: mid[n],
      lo: lo[n] - err(cumLo),
      hi: hi[n] + err(cumHi),
      // a mid-day live reading rolls on to the end of that day, so day i0 is a forecast too
      phase: n === i0 && !R ? "reading" : dates[n] < today ? "estimated" : "forecast",
      rain_in: rain[n].rain_in,
    });
  }
  return out;
}

/** The Breach Watch level for a daily model score: the highest level whose lower bound it meets. */
export const levelOf = (p, levels) => (p == null ? null : [...levels].reverse().find((l) => p >= l.min) ?? levels[0]);

/**
 * Run the forecast.
 *  rain: [{date, rain_in, src}] covering at least (today - 120 d) .. (today + horizon - 1),
 *        observed before today, forecast from today on.
 *  closedSince: ISO date the mouth last closed.
 *  stage0: {date, ft, rest?} latest stage reading (ft NAVD88) on or before today, or null.
 *          rest {rain_in, frac}: for a reading from partway through today, the forecast rain
 *          still to fall today and the fraction of the day left (see simulateStage).
 *  crestFloor: highest level (ft) in the first 3 days after the mouth closed, or null.
 * The daily breach score is the crest-curve hazard (devereux-breach/src/unified.py): how far
 * the slough sits below a berm crest that rebuilds after each closure, plus rain. It ranks
 * risk well but isn't a calibrated probability, so the page reports levels (params.levels).
 * With no level estimate it falls back to the rain-only logistic model.
 */
/** The site's breach score (devereux-breach models/best_daily.json): a logistic model,
 *  logit p = intercept + sum(coef[k] * x[k]). best_daily uses rain_in (that day), rain_wy (rain
 *  since Oct 1 through the day), log_dc (ln of berm age, days) and maxlvl (highest measured daily
 *  mean since the closure, through the day before). Older exports used rain_prev, margin and
 *  margin_max; any input named in coef is read from x. */
export function bestScore(x, B) {
  let z = B.intercept;
  for (const [k, c] of Object.entries(B.coef)) z += c * (x[k] ?? 0);
  return sigmoid(z);
}

export function forecast({ rain, today, closedSince, stage0, params, showFrom, crestFloor = null, levelHistory = [] }) {
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

  // water balance from the latest stage reading (none -> rain model only)
  const iStage = stage0 ? dates.indexOf(stage0.date) : -1;
  const stage = iStage >= 0 ? simulateStage(P, dates, iStage, stage0.ft, closedSince, params.water_balance, stage0.rest || null)
    : new Array(dates.length).fill(null);
  // The score's level inputs use the daily-mean form the model was fit on (stage = yesterday's
  // mean rolled forward); the shown level uses the same-day response (wb.carry).
  const wbFit = { ...params.water_balance, carry: undefined };
  const sStage = params.water_balance.carry == null || iStage < 0 ? stage
    : simulateStage(P, dates, iStage, stage0.ft, closedSince, wbFit, stage0.rest || null);

  const L = params.rain_logit;
  const B = params.best;
  // highest level since the closure through each day before: measured daily means, then the
  // simulated level for days past the latest reading
  const measured = new Map(levelHistory.filter((r) => r.date >= closedSince && r.ft != null).map((r) => [r.date, r.ft]));
  const maxBefore = [];
  let run = -Infinity;
  dates.forEach((d, n) => {
    maxBefore.push(run);
    if (d < closedSince) return;
    const v = measured.has(d) ? measured.get(d) : (iStage >= 0 && n >= iStage ? sStage[n] : null);
    if (v != null) run = Math.max(run, v);
  });
  const out = [];
  dates.forEach((d, n) => {
    if (d < (showFrom || today)) return;
    const dc = daysBetween(closedSince, d) + 1; // berm age at start of day, as in training
    const x = { rain_in: P[n], rain_3d: rain3[n], api: api[n], log_dc: Math.log(Math.max(dc, 1)), rain_wy: rainWy[n] };
    const z = L.intercept + L.features.reduce((a, f, k) => a + (L.coef[k] * (x[f] - L.mean[k])) / L.scale[k], 0);
    const pRain = sigmoid(z);
    // One hazard: how far the slough sits below the berm crest, plus the day's rain.
    const U = B?.crest || params.unified;
    // a just-closed berm is at least as high as the water it held back when it closed
    const crest = Math.max(crestFt(dc, U), crestFloor ?? -Infinity);
    const margin = sStage[n] == null ? null : sStage[n] - crest;
    // Displayed breach level: the young-berm rebuilding curve, capped at the median peak
    // of past mature-berm breaches (9.3-10.4 ft observed). The model's crest parameter
    // levels off near the top of that range and is not itself the level breaches happen at.
    const BL = params.breach_levels;
    const breachLevel = BL ? Math.min(crest, BL.mature_median_ft) : crest;
    // first closed day (or no earlier level): the max is the day's own level
    const maxlvl = margin == null ? null : Number.isFinite(maxBefore[n]) ? maxBefore[n] : sStage[n];
    const marginMax = margin == null ? null : sStage[n] - maxlvl;
    const p = margin == null ? pRain
      : B ? bestScore({ rain_in: P[n], rain_prev: P[n - 1] || 0, rain_wy: rainWy[n], log_dc: Math.log(Math.max(dc, 1)), maxlvl, margin, margin_max: marginMax }, B)
      : sigmoid(U.b0 + U.b_margin * margin + U.b_rain * P[n] + U.b_rain3 * rain3[n] + U.b_api * api[n]);
    const level = levelOf(p, params.levels);
    out.push({
      date: d,
      observed: d < today,
      rain_in: rain[n].rain_in,
      rain_src: rain[n].src,
      api: api[n],
      days_closed: dc,
      stage_ft: stage[n],
      model_stage_ft: sStage[n],
      crest_ft: crest,
      margin_ft: margin,
      max_level_ft: margin == null ? null : maxlvl,
      margin_max_ft: margin == null ? null : marginMax,
      breach_level_ft: breachLevel,
      below_breach_ft: stage[n] == null ? null : breachLevel - stage[n],
      p_rain: pRain,
      model: margin == null ? "rain only" : "level + rain",
      p,
      level: level.key,
      alert: level.key,
    });
  });
  return out;
}

/** Chance of at least one breach over the given days' independent daily chances. */
export const chanceWithin = (ps) => 1 - ps.reduce((q, p) => q * (1 - (p ?? 0)), 1);

/**
 * When would the slough reach the levels where breaches happen, at its current rate of rise?
 * hourly: [{t: epoch ms, ft}] (live sensor), lo/hi: breach-level range (ft), nowMs.
 * Uses a least-squares slope over the last `fitHours`. Returns
 *   {cur, slope (ft/h), state: "within" | "rising" | "beyond" | "steady", start, end} with
 *   start/end in epoch ms (only for "within" and "rising"). Extrapolation only: more rain
 *   speeds the rise, and the rise slows as storm runoff tapers.
 */
export function breachWindow({ hourly, lo, hi, nowMs, horizonH = 48, fitHours = 6 }) {
  const H = 3600000;
  const last = hourly.at(-1);
  if (!last) return null;
  const pts = hourly.filter((h) => h.t >= last.t - fitHours * H);
  if (pts.length < 3) return null;
  const mt = pts.reduce((a, h) => a + h.t, 0) / pts.length, mf = pts.reduce((a, h) => a + h.ft, 0) / pts.length;
  const slope = (pts.reduce((a, h) => a + (h.t - mt) * (h.ft - mf), 0) / pts.reduce((a, h) => a + (h.t - mt) ** 2, 0)) * H;
  const cur = last.ft, t0 = Math.max(nowMs, last.t);
  if (cur >= lo) return { cur, slope, state: "within", start: t0, end: slope > 0.005 && cur < hi ? Math.min(t0 + ((hi - cur) / slope) * H, t0 + horizonH * H) : t0 + horizonH * H };
  if (!(slope > 0.01)) return { cur, slope, state: "steady" };
  const start = last.t + ((lo - cur) / slope) * H, end = last.t + ((hi - cur) / slope) * H;
  if (start > t0 + horizonH * H) return { cur, slope, state: "beyond" };
  return { cur, slope, state: "rising", start: Math.max(start, t0), end: Math.min(end, t0 + horizonH * H) };
}

/**
 * Most likely breach hours for a storm (devereux-breach analysis/berm/breach_hour.py, rule
 * "rainsum_shift"): a storm is a run of wet hours (>= 0.01 in, dry gaps of up to 6 h); the
 * breach comes about when the storm's rain reaches the median rain-to-breach of past breaches,
 * plus 2 h. That median is 1.77 in on the Santa Barbara airport (KSBA) gauge. The site feeds
 * Coal Oil Point (USCRN), which reads about 1.09x KSBA on storm days (CA-SB-1 read 1.22x COP and
 * 1.33x KSBA over 113 storm days), so the need here is ~1.9 in. Approximate: the Open-Meteo
 * watershed mean used for forecast hours has no calibration against KSBA, and gets the same 1.9 in. A storm that stops short uses its last wet hour + 2 h. The window runs
 * from 1 h before to 3 h after, since misses run late. Backtested on 16 breaches with perfect
 * rain: 75% within 4 h, median error 1.5 h.
 *  hourly: [[key "YYYY-MM-DDTHH:00" local, rain in the hour ending then], ...] sorted.
 * Returns [{onset, end, total_in, predicted, start, finish}] with local keys.
 */
export const BREACH_HOUR = { need_in: 1.9, lead_h: 2, before_h: 1, after_h: 3, wet_in: 0.01, gap_h: 6 };
export function breachHours(hourly, R = BREACH_HOUR) {
  const H = 3600000;
  const ms = (k) => Date.parse(`${k}:00Z`);
  const key = (t) => new Date(Math.round(t / H) * H).toISOString().slice(0, 13) + ":00";
  const wet = hourly.filter(([, v]) => v >= R.wet_in).map(([k, v]) => [ms(k), v]);
  const storms = [];
  for (const [t, v] of wet) {
    const cur = storms.at(-1);
    if (cur && t - cur.end <= (R.gap_h + 1) * H) { cur.end = t; cur.total += v; if (cur.fire == null && cur.total >= R.need_in) cur.fire = t; }
    else storms.push({ onset: t, end: t, total: v, fire: v >= R.need_in ? t : null });
  }
  return storms.map((st) => {
    const pred = (st.fire ?? st.end) + R.lead_h * H;
    return { onset: key(st.onset), end: key(st.end), total_in: Math.round(st.total * 100) / 100, reaches_need: st.fire != null,
      predicted: key(pred), start: key(pred - R.before_h * H), finish: key(pred + R.after_h * H) };
  });
}

/**
 * Detect mouth openings and closings from the live water-level sensor (hourly, ft).
 * Validated on Apr 2025 - Nov 2026 against CCBER's log (2025-11-15 open, 2026-02-06
 * closed, 2026-02-19 open, 2026-03-07 closed; detected within 0-2 days):
 *  - breach: while closed, the level falls more than 1.5 ft within 6 hours
 *  - closure: while open (and at least 2 days after opening), the level's range has
 *    stayed under 0.35 ft for 48 hours (no tide gets in). Closed-mouth daily range is
 *    normally about 0.02 ft.
 * hourly: [{t: epoch ms, ft}] sorted by time. Returns [{t, state}].
 */
export function detectMouthEvents(hourly, startState) {
  const H = 3600000;
  const events = [];
  let state = startState;
  let openedAt = null;
  for (let i = 0; i < hourly.length; i++) {
    const { t, ft } = hourly[i];
    if (state === "closed") {
      let maxPrev = -Infinity;
      for (let j = i - 1; j >= 0 && t - hourly[j].t <= 6 * H; j--) maxPrev = Math.max(maxPrev, hourly[j].ft);
      if (maxPrev - ft > 1.5) {
        // breach time: when the fall began (the last high point)
        let k = i - 1;
        while (k > 0 && t - hourly[k - 1].t <= 6 * H && hourly[k - 1].ft >= hourly[k].ft) k--;
        state = "open"; openedAt = hourly[k].t;
        events.push({ t: openedAt, state });
      }
    } else if (state === "open" && t - openedAt >= 2 * 86400000) {
      const win = [];
      for (let j = i; j >= 0 && t - hourly[j].t <= 48 * H; j--) win.push(hourly[j].ft);
      const spanOk = win.length >= 40;
      if (spanOk && Math.max(...win) - Math.min(...win) < 0.35) {
        state = "closed";
        events.push({ t: t - 48 * H, state });
      }
    }
  }
  return events;
}
