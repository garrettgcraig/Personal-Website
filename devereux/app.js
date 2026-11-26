// Devereux Slough breach outlook page. Fetches /devereux/api/status (see
// netlify/functions/devereux-api.mjs) and draws everything with inline SVG.

import { breachWindow } from "./model.js";
import { esc, tz, day, COLORS, css, OBS, PRED, chart, legend, dayNum, everyN, dayTicks, shortDay, fullW, wide } from "./shared.js";

const app = document.getElementById("app");
const splitW = () => (wide() ? Math.round((fullW() - 56) * 1.2 / 2.2) : fullW());
const panelW = () => (wide() ? Math.round((fullW() - 56) / 2) : fullW());
let lastW = 0;
const ICON_RAIN = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 15a4.5 4.5 0 0 1-.4-9 6 6 0 0 1 11.3 1.6A3.7 3.7 0 0 1 17.5 15Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 18l-1 2.5M12.5 18l-1 2.5M17 18l-1 2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const ICON_WAVE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 14c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 19c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
addEventListener("resize", () => {
  clearTimeout(window.__rz);
  window.__rz = setTimeout(() => { if (window.__devereux && Math.abs(fullW() - lastW) > 40) render(window.__devereux); }, 200);
});

// ------------------------------------------------------------- slough level time series
let HISTORY = null; // stage-history.json: re-leveled daily record (static, from the Python project)
let levelRange = "1w";
// custom range for the level chart (ISO dates); defaults to the last six months
let customFrom = null, customTo = null;
let showRain = false; // rainfall overlay on the level chart (toggle)
let showTide = false; // tide overlay on the level chart, same axis as the slough (toggle)
let LIVE = []; // newest 5-minute sensor readings from /devereux/api/live: [{t (ms), ft}]
let TIDES = null; // tide-history.json, decoded: {x: Float64Array (chart days), obs, pred}; loaded on first toggle

// tide-history.json: hourly NOAA 9411340 Santa Barbara water level, ft NAVD88 (the slough's
// datum), from the Python project. Values are hundredths of a foot; null where missing.
// x is in the level chart's units (days since epoch, local day d spans d to d+1), on Pacific
// standard time, so it can sit an hour off in summer.
async function loadTides() {
  if (TIDES) return TIDES;
  const r = await fetch("tide-history.json");
  if (!r.ok) throw new Error(r.status);
  const j = await r.json();
  const x0 = Date.parse(j.start_utc) / 86400000 - 8 / 24;
  const n = j.observed.length;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = x0 + (i * j.step_h) / 24;
  const dec = (a) => a.map((v) => (v == null ? null : v / 100));
  TIDES = { x, obs: dec(j.observed), pred: dec(j.predicted || []), exported: j.exported };
  return TIDES;
}

// Tide series for the level chart over [start, end]. Up to four months: the hourly curve,
// observed where NOAA has it, predicted in the gaps, then the live feed's last 72 hours.
// Longer: each day's high and low tide as a band.
function tideSeries(s, start, end) {
  const T = TIDES;
  if (!T) return { series: [], ys: [] };
  const live = s.recent?.tides;
  const lx = (t) => Date.parse(t.replace(" ", "T") + "Z") / 86400000; // NOAA local clock time
  const lastFile = T.x.length ? T.x[T.x.length - 1] : -Infinity;
  const obs = [], pred = [];
  for (let i = 0; i < T.x.length; i++) {
    const x = T.x[i];
    if (x < start - 1 || x > end + 1) continue;
    const o = T.obs[i], p = T.pred[i];
    obs.push({ x, y: o });
    pred.push({ x, y: o == null ? p ?? null : null });
  }
  for (const p of live?.observed || []) { const x = lx(p.t); if (x > lastFile && x >= start - 1 && x <= end + 1) obs.push({ x, y: p.ft }); }
  for (const p of live?.predicted || []) { const x = lx(p.t); if (x > lastFile && x >= start - 1 && x <= end + 1 && !obs.some((o) => Math.abs(o.x - x) < 0.02)) pred.push({ x, y: p.ft }); }
  obs.sort((a, b) => a.x - b.x); pred.sort((a, b) => a.x - b.x);
  const ys = [...obs, ...pred].map((p) => p.y).filter((v) => v != null);
  if (end - start <= 120) {
    return { ys, series: [
      { type: "line", color: PRED(), width: 1.1, dash: "3 3", opacity: 0.9, gap: 0.05, points: pred },
      { type: "line", color: OBS(), width: 1.2, opacity: 0.75, gap: 0.05, points: obs },
    ] };
  }
  // daily high/low envelope, observed where at least 18 of 24 hours exist, else predicted
  const days = new Map();
  for (const [arr, k] of [[obs, "o"], [pred, "p"]]) for (const p of arr) {
    if (p.y == null) continue;
    const d = Math.floor(p.x);
    const r = days.get(d) || { o: [], p: [] };
    r[k].push(p.y); days.set(d, r);
  }
  const band = [...days].sort((a, b) => a[0] - b[0]).map(([d, r]) => {
    const v = r.o.length >= 18 ? r.o : r.o.concat(r.p);
    return { x: d + 0.5, lo: Math.min(...v), hi: Math.max(...v) };
  });
  return { ys, series: [{ type: "band", color: OBS(), opacity: 0.16, points: band }] };
}

function monthTicks(a, b, everyMonths) {
  const out = [];
  const d = new Date(a * 86400000);
  let y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1;
  for (;;) {
    if (mo > 11) { y += Math.floor(mo / 12); mo %= 12; }
    const x = Date.UTC(y, mo, 1) / 86400000 + 0.5;
    if (x > b) break;
    if (mo % everyMonths === 0) out.push(x);
    mo += 1;
  }
  return out;
}

// Daily rain (in) for the level chart: baked-in history (Coal Oil Point gauge), then the live
// feed's last 30 days, then the 10-day forecast.
function rainBars(s, start, end) {
  const daily = new Map();
  for (const [d, v] of HISTORY?.rain || []) daily.set(dayNum(d), { y: v, fc: false });
  for (const r of s.recent?.rain || []) if (r.rain_in != null) daily.set(dayNum(r.date), { y: r.rain_in, fc: false });
  for (const r of s.outlook || []) if (!r.observed && r.rain_in != null) daily.set(dayNum(r.date), { y: r.rain_in, fc: true });
  const days = [...daily].filter(([x, v]) => x >= start - 7 && x <= end && v.y > 0).sort((a, b) => a[0] - b[0]);
  const obsColor = OBS(), fcColor = PRED();
  // daily in every view, so each bar lines up with the day the slough responds
  return days.map(([x, v]) => ({ x0: x - 0.5, x1: x + 0.5, y: v.y, color: v.fc ? fcColor : obsColor, opacity: v.fc ? 0.5 : 0.6,
    title: `${shortDay(x)}: ${v.y.toFixed(2)} in${v.fc ? " (forecast)" : ""}` }));
}

function levelChartSvg(s, range) {
  const BLV = s.model?.breach_levels;
  const nowX = dayNum(s.today);
  const series = s.stage?.series || [];
  const endAll = series.length ? dayNum(series.at(-1).date) : nowX + 9;
  let end = endAll;
  let start = range === "1w" ? nowX - 7 : range === "3m" ? nowX - 90 : range === "1y" ? nowX - 365 : dayNum("2018-10-01");
  if (range === "custom" && customFrom && customTo) {
    start = Math.max(dayNum("2018-10-01"), dayNum(customFrom));
    end = Math.min(endAll, dayNum(customTo));
    if (end - start < 7) end = Math.min(endAll, start + 7);
  }
  const hist = (HISTORY?.stage || []).map(([d, ft, mx, src]) => ({ x: dayNum(d), ft, src }));
  // loggers + the live sensor: baked-in history, then the API's recent sensor days
  const sensorDays = (s.stage?.sensor_daily || []).map((r) => ({ x: dayNum(r.date), ft: r.ft, src: "L" }));
  const histEnd = hist.length ? hist.at(-1).x : -Infinity;
  const loggers = [...hist.filter((r) => "VEPL".includes(r.src)), ...sensorDays.filter((r) => r.x > histEnd)];
  // manual readings: history (staff gauge + pier stick) plus anything newer from the live feed
  const manual = new Map(hist.filter((r) => "SK".includes(r.src)).map((r) => [r.x, r.ft]));
  for (const r of s.stage?.readings || []) manual.set(dayNum(r.date), r.ft);
  const dots = [...manual].map(([x, ft]) => ({ x, y: ft, title: `${shortDay(x)}: ${ft.toFixed(2)} ft` }));
  const vis = (x) => x >= start && x <= end;
  const ys = [...loggers.filter((r) => vis(r.x)).map((r) => r.ft), ...dots.filter((p) => vis(p.x)).map((p) => p.y),
    ...series.flatMap((r) => [r.lo, r.hi, r.breach_level_ft]).filter((v) => v != null),
    ...(BLV ? [BLV.mature_min_ft, BLV.mature_max_ft] : [])];
  const tide = showTide ? tideSeries(s, start, end) : { series: [], ys: [] };
  // real time: the sensor's hourly averages (last 7 days) and newest 5-minute readings,
  // drawn over the daily means so the right end of the chart moves through the day
  const toX = (ms) => ms / 86400000 - 8 / 24; // Pacific standard time, as for the tides
  const sub = new Map();
  for (const h of s.stage?.sensor_hourly || []) sub.set(h.t, h.ft);
  for (const h of LIVE) sub.set(h.t, h.ft);
  const subPts = [...sub].sort((a, b) => a[0] - b[0]).map(([t, ft]) => ({ x: toX(t), y: ft }));
  const latest = subPts.at(-1);
  if (end - start <= 400) ys.push(...subPts.filter((p) => vis(p.x)).map((p) => p.y));
  ys.push(...tide.ys);
  const yMin = Math.floor(Math.min(...ys, 4) - 0.3), yMax = Math.ceil(Math.max(...ys, 8) + 0.3);
  const breaches = (EVENTS ? EVENTS.events.filter((e) => e.type === "breach").map((e) => e.start.slice(0, 10)) : HISTORY?.breaches || []).map(dayNum).filter(vis);
  const mid = series.map((r) => ({ x: dayNum(r.date), y: r.ft, phase: r.phase }));
  const span = end - start;
  return chart({
    width: fullW(), height: wide() ? 340 : 260, xMin: start, xMax: end, yMin, yMax, yFmt: (v) => v.toFixed(0), yLabel: "water level, ft NAVD88",
    series: [
      ...tide.series,
      { type: "band", color: css("--color-accent"), opacity: 0.18, points: series.map((r) => ({ x: dayNum(r.date), lo: r.lo, hi: r.hi })) },
      // daily means stop where the hourly sensor line starts, so the two never overlap
      { type: "line", color: css("--color-text"), width: span > 400 ? 1 : 1.6, gap: 2, opacity: 0.85, points: loggers.filter((r) => span > 400 || !subPts.length || r.x + 0.5 < subPts[0].x).map((r) => ({ x: r.x, y: r.ft })) },
      // observed range of past mature-berm breach peaks, across the whole chart
      ...(BLV ? [{ type: "band", color: COLORS.clay, opacity: 0.12, points: [{ x: start, lo: BLV.mature_min_ft, hi: BLV.mature_max_ft }, { x: end, lo: BLV.mature_min_ft, hi: BLV.mature_max_ft }] }] : []),
      { type: "line", color: COLORS.clay, width: 1.8, dash: "5 4", points: series.map((r) => ({ x: dayNum(r.date), y: s.mouth?.state === "open" ? null : r.breach_level_ft })) },
      { type: "line", color: css("--color-accent"), width: 2.5, points: mid.filter((p) => p.phase !== "forecast") },
      { type: "line", color: css("--color-accent"), width: 2.5, dash: "6 4", points: mid.filter((p, i) => p.phase === "forecast" || (mid[i + 1] && mid[i + 1].phase === "forecast")) },
      { type: "dots", color: COLORS.ochre, r: span > 400 ? 2.2 : 3.8, points: dots },
      ...(span <= 400 ? [{ type: "line", color: css("--color-text"), width: span > 120 ? 1 : 1.3, opacity: 0.85, gap: 0.25, points: subPts }] : []),
      ...(latest ? [{ type: "dots", color: css("--color-accent"), r: 4.5, points: [{ x: latest.x, y: latest.y, title: `latest reading ${latest.y.toFixed(2)} ft` }] }] : []),
    ],
    vlines: breaches.map((x) => ({ x, color: css("--breach") })),
    y2: showRain ? (() => {
      const bars = rainBars(s, start, end);
      const peak = Math.max(0.5, ...bars.filter((b) => b.x1 >= start).map((b) => b.y));
      // tallest day reaches ~80% of the plot height; round axis max
      const nice = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10];
      return { bars, max: nice.find((n) => n >= peak * 1.25) ?? Math.ceil(peak * 1.25), fmt: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(Number.isInteger(v * 10) ? 1 : 2)), label: "rain, in/day" };
    })() : undefined,
    xTicks: span <= 31 ? dayTicks(start, end, span <= 20 ? 2 : 4) : span <= 120 ? dayTicks(start, end, 14) : span <= 400 ? monthTicks(start, end, 2) : monthTicks(start, end, 12),
    xFmt: (x) => span <= 400 ? shortDay(x) : String(new Date(x * 86400000).getUTCFullYear()),
    now: nowX >= start && nowX <= end ? nowX : null,
  });
}

function levelSummary(s) {
  const f = s.stage.series.filter((r) => r.phase === "forecast");
  const last = f.at(-1);
  if (!last) return "";
  const r = s.stage.latest_reading;
  const hit = s.mouth?.state !== "open" ? f.find((x) => x.breach_level_ft != null && x.ft >= x.breach_level_ft - 0.05) : null;
  if (hit) return `Latest reading ${r.ft.toFixed(2)} ft on ${day(r.date, { month: "short", day: "numeric" })}. `
    + `The slough is forecast to reach the estimated breach level, near ${hit.breach_level_ft.toFixed(1)} ft, around ${day(hit.date, { weekday: "short", month: "short", day: "numeric" })}. The forecast line stops there.`;
  return `Latest reading ${r.ft.toFixed(2)} ft on ${day(r.date, { month: "short", day: "numeric" })}. `
    + `By ${day(last.date, { weekday: "short", month: "short", day: "numeric" })} the slough is forecast at about ${last.ft.toFixed(1)} ft `
    + `(range ${last.lo.toFixed(1)} to ${last.hi.toFixed(1)} ft)` + (last.breach_level_ft != null && s.mouth?.state !== "open" ? `, against an estimated breach level near ${last.breach_level_ft.toFixed(1)} ft.` : ".");
}

// olive for the Coal Oil Point gauge, lifted in dark mode so it reads on the dark background
const SAGE = () => (document.body.classList.contains("dark-mode") ? "#A3BE6E" : COLORS.sage);
const rainLegend = () => legend([[css("--color-accent"), "rain, observed (right axis, hanging from the top)", "hang", 0.6], [PRED(), "rain, forecast", "hang", 0.5]]);
const tideLegend = () => (levelSpan() <= 120
  ? legend([[OBS(), "tide, observed (NOAA Santa Barbara, same axis)", "line", 0.75], [PRED(), "tide, predicted where observed is missing", "dash"]])
  : legend([[OBS(), "daily tide range, high to low (NOAA Santa Barbara, same axis)", "band", 0.3]]));
// span in days of the level chart's current view
function levelSpan() {
  if (levelRange === "1w") return 17;
  if (levelRange === "3m") return 90;
  if (levelRange === "1y") return 365;
  if (levelRange === "custom" && customFrom && customTo) return dayNum(customTo) - dayNum(customFrom);
  return 3000;
}
let EVENTS = null; // events.json, from the Python project (scripts/build_devereux_events.py); breach marks on the level chart

function liveNote(s) {
  const n = s.stage?.sensor_now;
  if (!n) return "";
  const when = new Date(n.t).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `Live sensor: ${n.ft.toFixed(2)} ft at ${when}. The chart's right end follows the sensor and refreshes every 5 minutes while this page is open; the forecast starts from the newest reading and updates every 10.`;
}
// Poll the live sensor every 5 minutes while the page is visible, and rebuild the whole page
// from the status API every 10 minutes: the forecast and Breach Watch start from the newest
// live reading, so they move with the sensor too.
async function pollLive() {
  const s = window.__devereux;
  if (!s || document.hidden) return;
  try {
    const r = await fetch("/devereux/api/live", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    if (!j.readings?.length) return;
    LIVE = j.readings;
    if (s.stage) s.stage.sensor_now = j.now;
    const ln = document.getElementById("live-note");
    if (ln) ln.textContent = liveNote(s);
    if (document.getElementById("level-chart")) redrawLevel();
  } catch { /* keep the last readings */ }
}
setInterval(pollLive, 5 * 60000);
setInterval(() => { if (!document.hidden) load(); }, 10 * 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) pollLive(); });

function redrawLevel() {
  const s = window.__devereux;
  document.getElementById("tide-legend").innerHTML = showTide && TIDES ? tideLegend() : "";
  document.getElementById("level-chart").innerHTML = levelChartSvg(s, levelRange);
}
document.addEventListener("click", async (e) => {
  const tt = e.target.closest("[data-tide]");
  if (tt && window.__devereux) {
    showTide = !showTide;
    tt.setAttribute("aria-pressed", String(showTide));
    if (showTide && !TIDES) {
      tt.disabled = true;
      try { await loadTides(); } catch { showTide = false; tt.setAttribute("aria-pressed", "false"); document.getElementById("tide-legend").innerHTML = `<p class="muted">Tide history unavailable.</p>`; tt.disabled = false; return; }
      tt.disabled = false;
    }
    redrawLevel();
    return;
  }
  const t = e.target.closest("[data-rain]");
  if (t && window.__devereux) {
    showRain = !showRain;
    t.setAttribute("aria-pressed", String(showRain));
    document.getElementById("rain-legend").innerHTML = showRain ? rainLegend() : "";
    document.getElementById("level-chart").innerHTML = levelChartSvg(window.__devereux, levelRange);
    return;
  }
  const b = e.target.closest("[data-range]");
  if (!b || !window.__devereux) return;
  levelRange = b.dataset.range;
  document.querySelectorAll("[data-range]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  const cr = document.getElementById("custom-range");
  if (cr) cr.hidden = levelRange !== "custom";
  redrawLevel();
});
// ------------------------------------------------------------- custom date range
// Typed dates: 10/1/2022, 10-1-22, 2022-10-01, Oct 1 2022, 1 October 2022, Oct 2022 or 2022
// (a month or year alone means its first day for From and its last day for To). Applied on
// Enter or when the field loses focus; the calendar button opens the browser's date picker.
const RANGE_MIN = "2018-10-01";
let rangeMax = null;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad2 = (n) => String(n).padStart(2, "0");
const lastOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function parseDateText(str, end) {
  const t = String(str || "").trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!t) return null;
  const yr = (y) => (y.length === 2 ? 2000 + +y : +y);
  const mon = (w) => { const i = MONTHS.indexOf(w.slice(0, 3)); return i < 0 ? null : i + 1; };
  let y, m, d, k;
  if ((k = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) [y, m, d] = [+k[1], +k[2], +k[3]];
  else if ((k = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) [m, d, y] = [+k[1], +k[2], yr(k[3])];
  else if ((k = t.match(/^(\d{1,2})[-/.](\d{4})$/))) [m, y] = [+k[1], +k[2]];
  else if ((k = t.match(/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)? (\d{2}|\d{4})$/))) [m, d, y] = [mon(k[1]), +k[2], yr(k[3])];
  else if ((k = t.match(/^(\d{1,2}) ([a-z]+)\.? (\d{2}|\d{4})$/))) [d, m, y] = [+k[1], mon(k[2]), yr(k[3])];
  else if ((k = t.match(/^([a-z]+)\.? (\d{4})$/))) [m, y] = [mon(k[1]), +k[2]];
  else if ((k = t.match(/^(\d{4})$/))) [y] = [+k[1]];
  else return null;
  if (!y || (m != null && (m < 1 || m > 12))) return null;
  if (m == null) [m, d] = end ? [12, 31] : [1, 1];
  if (d == null) d = end ? lastOfMonth(y, m) : 1;
  if (d < 1 || d > lastOfMonth(y, m)) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const calIcon = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>`;
function dateField(id, label, value, max) {
  return `<label class="date-field">${label}<span class="date-box"><input type="text" id="${id}" class="date-text" value="${fmtDate(value)}" placeholder="e.g. 10/1/2022" autocomplete="off" spellcheck="false" enterkeyhint="done" /><button type="button" class="date-cal" data-cal="${id}" aria-label="${label} date: open calendar">${calIcon}</button><input type="date" class="date-native" data-for="${id}" min="${RANGE_MIN}" max="${max}" value="${value}" tabindex="-1" aria-hidden="true" /></span></label>`;
}
function waterYears(max) {
  const last = +max.slice(0, 4) + (+max.slice(5, 7) >= 10 ? 1 : 0), out = [];
  for (let w = last; w >= 2019; w--) out.push(w);
  return out;
}
function applyRange(from, to, msg = "") {
  const clamp = (v) => (v < RANGE_MIN ? RANGE_MIN : rangeMax && v > rangeMax ? rangeMax : v);
  let [a, b] = [clamp(from), clamp(to)];
  if (a > b) [a, b] = [b, a];
  if (!msg && (a !== from || b !== to) && from <= to) msg = `Data runs ${fmtDate(RANGE_MIN)} to ${fmtDate(rangeMax)}.`;
  [customFrom, customTo] = [a, b];
  for (const [id, v] of [["range-from", a], ["range-to", b]]) {
    const t = document.getElementById(id); if (t) { t.value = fmtDate(v); t.removeAttribute("aria-invalid"); }
    const n = document.querySelector(`.date-native[data-for="${id}"]`); if (n) n.value = v;
  }
  const m = document.getElementById("range-msg"); if (m) m.textContent = msg;
  redrawLevel();
}
function applyTyped(edited) {
  const f = document.getElementById("range-from"), t = document.getElementById("range-to");
  let a = parseDateText(f.value, false), b = parseDateText(t.value, true);
  for (const [el, v] of [[f, a], [t, b]]) el.toggleAttribute("aria-invalid", !v);
  if (!a || !b) { document.getElementById("range-msg").textContent = "Try a date like 10/1/2022 or Oct 1, 2022."; return; }
  // one end moved past the other: keep the old span instead of swapping the ends
  const otherUntouched = edited === "range-from" ? b === customTo : edited === "range-to" ? a === customFrom : false;
  if (a > b && customFrom && customTo && otherUntouched) {
    const span = dayNum(customTo) - dayNum(customFrom);
    if (edited === "range-from") b = isoDay(dayNum(a) + span); else if (edited === "range-to") a = isoDay(dayNum(b) - span);
  }
  document.getElementById("range-preset").value = "";
  applyRange(a, b);
}
document.addEventListener("change", (e) => {
  if (!window.__devereux) return;
  if (e.target.matches?.("#custom-range .date-text")) applyTyped(e.target.id);
  else if (e.target.matches?.("#custom-range .date-native") && e.target.value) {
    const id = e.target.dataset.for;
    document.getElementById("range-preset").value = "";
    applyRange(id === "range-from" ? e.target.value : customFrom, id === "range-to" ? e.target.value : customTo);
  } else if (e.target.matches?.("#range-preset") && e.target.value) {
    const w = +e.target.value;
    applyRange(`${w - 1}-10-01`, `${w}-09-30`, " ");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches?.("#custom-range .date-text")) { e.preventDefault(); applyTyped(e.target.id); }
});
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-cal]");
  if (!b) return;
  const n = document.querySelector(`.date-native[data-for="${b.dataset.cal}"]`);
  if (!n) return;
  try { n.showPicker(); } catch { n.focus(); n.click(); }
});
const isoDay = (x) => new Date(x * 86400000).toISOString().slice(0, 10);

// ------------------------------------------------------------- breach likelihood dial
// Breach Watch levels, like a fire-danger sign. The model's daily score ranks risk but isn't
// a calibrated chance (ten recorded breaches), so the page shows levels whose lower bounds
// come from the held-out record (model-params.json "levels"). Alerts go out at Possible.
// a breach is the good news here, so the scale runs red (no chance) to green (imminent)
const LEVEL_STYLE = { low: { color: "#C23B30", ink: "#fff" }, watch: { color: "#D9772B", ink: "#fff" },
  warning: { color: "#E2B33C", ink: "#1B2530" }, likely: { color: "#4E8F4A", ink: "#fff" } };
let BANDS = [{ key: "low", label: "No Chance", min: 0 }, { key: "watch", label: "Possible", min: 0.13 }, { key: "warning", label: "Likely", min: 0.2 }, { key: "likely", label: "Imminent", min: 0.5 }]
  .map((l) => ({ ...l, ...LEVEL_STYLE[l.key] }));
// names live here, by key, so a cached status from before a rename can't bring old names back
const LEVEL_NAME = { low: "No Chance", watch: "Possible", warning: "Likely", likely: "Imminent" };
// the sign's headline for each level: [big line, line under it]
const SIGN = { low: ["No Chance", "of Breach"], watch: ["Possible", "Breach"],
  warning: ["Likely", "to Breach"], likely: ["Imminent", "Breach"] };
const setBands = (levels) => { if (levels?.length) BANDS = levels.map((l) => ({ ...l, label: LEVEL_NAME[l.key] ?? l.label, ...(LEVEL_STYLE[l.key] || LEVEL_STYLE.low) })); };
const bandOf = (p) => (p == null ? null : [...BANDS].reverse().find((b) => p >= b.min) ?? BANDS[0]);
// What each level has meant on the record
function levelMeaning(b, rec) {
  const n = rec?.breaches ?? 10;
  if (b.key === "low") return "That's below the level every recorded breach reached first.";
  const fa = b.false_alarm_episodes ?? 0;
  const tail = fa ? `; it came up ${fa === 1 ? "once" : `${fa} times`} without a breach in ${rec?.seasons?.replace("-", " to ") ?? "eight seasons"}` : ", with no false alarms";
  return b.caught === n ? `Every recorded breach reached ${b.label} first${tail}.` : `${b.caught} of ${n} recorded breaches reached ${b.label}${tail}.`;
}
function dialSvg(p, off) {
  // band names sit outside the arc, so the needle can sweep across the colored face
  const cx = 190, cy = 168, R = 122, r = 50, n = BANDS.length;
  const pt = (rad, a) => [cx + rad * Math.cos(a), cy - rad * Math.sin(a)];
  const mid = (k) => Math.PI - ((k + 0.5) * Math.PI) / n;
  const wedge = (i) => {
    const a0 = Math.PI - (i * Math.PI) / n, a1 = Math.PI - ((i + 1) * Math.PI) / n;
    const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r, a1), [x3, y3] = pt(r, a0);
    return `M${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 0 0 ${x3},${y3} Z`;
  };
  const b = off ? null : bandOf(p), i = b ? BANDS.indexOf(b) : -1;
  const a = mid(i);
  const [tx, ty] = pt(R - 10, a), [lx, ly] = pt(8, a + Math.PI / 2), [rx, ry] = pt(8, a - Math.PI / 2);
  return `<svg class="dial" viewBox="40 22 300 176" role="img" aria-label="${off ? "Breach likelihood dial, off while the mouth is open" : `Breach likelihood: ${b.label}`}">
    ${BANDS.map((bd, k) => `<path d="${wedge(k)}" fill="${bd.color}" opacity="${off ? 0.3 : k === i ? 1 : 0.72}" stroke="#2A2119" stroke-width="2"/>`).join("")}
    ${BANDS.map((bd, k) => {
      // end slices: label centered under the slice's base; middle slices: centered just beyond the arc
      const end = k === 0 || k === n - 1;
      const [x, y] = end ? [cx + (k === 0 ? -1 : 1) * (R + r) / 2, cy + 21] : pt(R + 14, mid(k));
      return `<text x="${x}" y="${end ? y : y + 1}" text-anchor="middle" fill="${k === i ? "#F3EBDD" : "#BFAE93"}" font-size="14" font-weight="${k === i ? 700 : 500}">${bd.label}</text>`;
    }).join("")}
    ${off ? "" : `<path d="M${lx},${ly} L${tx},${ty} L${rx},${ry} Z" fill="#F3EBDD" stroke="#2A2119" stroke-width="1.5" stroke-linejoin="round"/>`}
    <circle cx="${cx}" cy="${cy}" r="12" fill="#2A2119" stroke="#E0B656" stroke-width="2.5"/>
  </svg>`;
}

// "Tue 2 to 6 AM" / "Tue 11 PM to Wed 3 AM" from a breach window's local hour keys
function windowText(w) {
  const parts = (k) => { const d = new Date(`${k}:00Z`), h = d.getUTCHours();
    return { wd: d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" }), h: h % 12 || 12, ap: h < 12 ? "AM" : "PM" }; };
  const a = parts(w.start), b = parts(w.finish);
  if (a.wd !== b.wd) return `${a.wd} ${a.h} ${a.ap} to ${b.wd} ${b.h} ${b.ap}`;
  return a.ap === b.ap ? `${a.wd} ${a.h} to ${b.h} ${b.ap}` : `${a.wd} ${a.h} ${a.ap} to ${b.h} ${b.ap}`;
}

// ------------------------------------------------------------- render
function render(s) {
  lastW = fullW();
  setBands(s.model?.levels);
  const BLV = s.model?.breach_levels;
  const open = s.mouth?.state === "open";
  const todayRow = s.outlook.find((r) => r.date === s.today);
  const ahead = s.outlook.filter((r) => r.date >= s.today);
  const peak = s.peak;
  const heavy = s.peak_heavy;
  const heavyUp = !open && peak && heavy && BANDS.indexOf(bandOf(heavy.p)) > BANDS.indexOf(bandOf(peak.p));
  // first Likely or Imminent day ahead with a storm to time: its most likely breach hours
  const bw = open ? null : (s.outlook || []).find((r) => r.date >= s.today && r.breach_window);
  // first forecast day whose upper level range reaches this closure's breach level
  const reachHi = open ? null : (s.stage?.series || []).find((r) => r.date >= s.today && r.phase === "forecast" && r.breach_level_ft != null && r.hi >= r.breach_level_ft);
  const lowAhead = !open && peak && bandOf(peak.p).key === "low";

  const nowFt = s.stage?.sensor_now?.ft ?? s.stage?.today_est_ft;
  const nowWhen = s.stage?.sensor_now
    ? `live sensor, ${new Date(s.stage.sensor_now.t).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
    : s.stage?.latest_reading ? `estimated from the staff gauge, ${day(s.stage.latest_reading.date, { month: "short", day: "numeric" })}` : "";
  const blToday = !open ? s.stage?.breach_level_today_ft : null;
  const mature = BLV && blToday != null && blToday >= BLV.mature_median_ft - 1e-6;

  // Breach Watch leads: the chance of a breach in the next 48 hours, and once the slough
  // is rising toward breach levels, when it would get there at the current rate.
  const next2 = ahead.slice(0, 2).map((r) => r.p);
  const p48 = open || !peak ? null : Math.max(...next2);
  const band48 = p48 == null ? null : bandOf(p48);
  const lvLo = mature ? BLV.mature_min_ft : blToday != null ? blToday - 0.5 : null;
  const lvHi = mature ? BLV.mature_max_ft : blToday != null ? blToday + 0.5 : null;
  const win = !open && lvLo != null && s.stage?.sensor_hourly?.length
    ? breachWindow({ hourly: s.stage.sensor_hourly.map((h) => ({ t: Date.parse(h.t), ft: h.ft })), lo: lvLo, hi: lvHi, nowMs: Date.now() }) : null;
  const when = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).replace(/ /g, "\u00a0");
  const headline = !s.mouth ? "Breach Watch is off." : open ? "Breach Watch is off: the mouth is open." : !peak ? "Breach Watch is off." : `Breach Watch: ${SIGN[band48.key].join(" ")} in the next 48 hours.`;
  let windowLine = "";
  if (win?.state === "within") windowLine = `The slough is already at <span class="num">${win.cur.toFixed(2)}&nbsp;ft</span>, within the range where past breaches happened. A breach could come at any time.`;
  else if (win?.state === "rising") windowLine = `Rising <span class="num">${win.slope.toFixed(2)}&nbsp;ft</span> an hour. At that rate it reaches breach levels (${lvLo.toFixed(1)} to ${lvHi.toFixed(1)} ft) between <strong>${when(win.start)}</strong> and <strong>${when(win.end)}</strong>. More rain would bring that sooner.`;
  let lead = "";
  if (s.mouth) {
    lead = `The mouth has been ${open ? "open" : "closed"} since ${day(s.mouth.since, { month: "long", day: "numeric", year: "numeric" })} (${s.mouth.days} days).`;
    if (nowFt != null) lead += ` The slough is at <span class="num">${nowFt.toFixed(2)}&nbsp;ft</span>`
      + (blToday != null ? `, about ${(blToday - nowFt).toFixed(1)} ft below ${mature ? "where past breaches happened" : "the estimated breach level for this young berm"}.` : ".");
  }

  let outlook;
  if (!s.mouth) outlook = "The mouth-state record couldn't be loaded, so there is no outlook right now.";
  else if (open) outlook = "While the mouth is open the slough is tidal. The breach outlook starts again once waves close the berm.";
  else if (!peak) outlook = "There is no recent slough-level reading this water year, so the outlook is off.";
  else {
    // Closest the slough is forecast to come to the breach level in the next 10 days, after
    // runoff from the whole watershed has drained in (not just on the rain day).
    const f = (s.stage?.series || []).filter((r) => r.date >= s.today && r.breach_level_ft != null);
    const near = f.reduce((m, r) => (m == null || r.breach_level_ft - r.ft < m.breach_level_ft - m.ft ? r : m), null);
    const short = (d) => day(d, { month: "short", day: "numeric" });
    const nearHi = f.reduce((m, r) => Math.min(m, r.breach_level_ft - r.hi), Infinity);
    outlook = `Over the next 10 days the outlook peaks at <strong>${bandOf(peak.p).label}</strong> on ${day(peak.date)}`
      + (peak.rain_in >= 0.1 ? `, with ${peak.rain_in.toFixed(2)} in of rain forecast that day.` : ".")
      + (!near ? ""
        : near.breach_level_ft - near.ft < 0.05
          // the middle forecast reaches the breach level: say when it first gets there
          ? (() => {
            const cross = f.find((r) => r.ft >= r.breach_level_ft - 0.05);
            return ` The slough is forecast to reach the estimated breach level around ${short(cross.date)}.`;
          })()
          : ` The slough should come within about ${(near.breach_level_ft - near.ft).toFixed(1)} ft of the breach level around ${short(near.date)}`
            + (Number.isFinite(nearHi) ? (nearHi > 0 ? `, or ${nearHi.toFixed(1)} ft if rain runs heavy.` : `, and could reach it if rain runs heavy.`) : "."));
    // the level chart's upper range can touch the breach level while every day still scores No Chance
    if (lowAhead && reachHi && !heavyUp) outlook += ` The top of the level chart's range is a what-if: ${heavy?.scale ?? 1.5} times the forecast rain plus a typical forecast miss.`
      + ` Breaches have come on days of heavy rain, and even with ${heavy?.scale ?? 1.5} times the forecast rain no day ahead scores above <strong>No Chance</strong>.`;
    if (heavyUp) outlook += ` With ${heavy.scale ?? 1.5} times the forecast rain, the outlook would reach <strong>${bandOf(heavy.p).label}</strong> on ${day(heavy.date)}.`;
  }

  const wyear = s.today.slice(0, 4) * 1 + (s.today.slice(5, 7) >= "10" ? 1 : 0);
  const readings = [
    ["Mouth", s.mouth ? `${open ? "Open" : "Closed"}` : "unknown", s.mouth ? `since ${day(s.mouth.since, { month: "short", day: "numeric", year: "numeric" })}` : ""],
    ["Slough level", nowFt != null ? `${nowFt.toFixed(2)} ft` : "n/a", nowWhen],
    [mature ? "Typical breach level" : "Breach level, young berm", blToday != null ? `${blToday.toFixed(1)} ft` : "n/a", mature ? `past ${BLV.mature_min_ft.toFixed(1)} to ${BLV.mature_max_ft.toFixed(1)}` : open ? "mouth open" : "estimated"],
    ["Rain since October 1", `${s.recent.season_rain_in.toFixed(2)} in`, `water year ${wyear}`],
  ];

  // --- outlook chart: today and the forecast days only (past days would be scored after the fact)
  const pts = s.outlook.filter((r) => r.date >= s.today).map((r) => ({ x: dayNum(r.date), r }));
  const probChart = chart({
    width: splitW(), height: 200, left: 70, yLabel: "level", yMin: 0, yMax: BANDS.length, yFmt: (v) => (v >= 1 ? BANDS[Math.round(v) - 1]?.label ?? "" : ""),
    series: [{
      type: "bar", points: pts.map(({ x, r }) => ({
        x, y: BANDS.indexOf(bandOf(r.p)) + 1, color: bandOf(r.p).color,
        title: `${day(r.date)}: ${bandOf(r.p).label}` + (r.margin_ft == null ? " (rain only)" : (r.below_breach_ft > 0.05 ? `, slough ${r.below_breach_ft.toFixed(1)} ft below the breach level,` : ", slough at the breach level,") + ` ${(r.rain_in ?? 0).toFixed(2)} in rain`),
      })),
    }],
    xTicks: everyN(pts.map((p) => p.x), 3), xFmt: (x) => day(new Date(x * 86400000).toISOString().slice(0, 10), { month: "short", day: "numeric" }),
  });
  const rainChart = chart({
    width: splitW(), height: 120, left: 70, yLabel: "rain, in", yMin: 0, yFmt: (v) => v.toFixed(1),
    series: [{ type: "bar", points: pts.map(({ x, r }) => ({ x, y: r.rain_in ?? 0, color: r.observed ? OBS() : PRED(), title: `${day(r.date)}: ${(r.rain_in ?? 0).toFixed(2)} in (${r.rain_src})` })) }],
    xTicks: everyN(pts.map((p) => p.x), 3), xFmt: (x) => day(new Date(x * 86400000).toISOString().slice(0, 10), { month: "short", day: "numeric" }),
  });

  const lastDay = s.stage?.series?.length ? s.stage.series.at(-1).date : s.today;
  if (!customFrom) { customFrom = isoDay(dayNum(s.today) - 182); customTo = lastDay; }
  rangeMax = lastDay;
  const levelChart = levelChartSvg(s, levelRange);

  // --- recent rain (30 days)
  // A day the gauge hasn't fully reported is a stacked bar: the gauge's hours (sage) under the
  // radar estimate for the rest (mist). Bars stay faded while some hours have neither.
  const rr = s.recent.rain.map((r) => ({ x: dayNum(r.date), r }));
  const covered = (r) => (r.hours ?? 24) + (r.filled_hours ?? 0);
  const rainTip = (r) => r.rain_in == null ? "" : `${day(r.date)}: ${r.rain_in.toFixed(2)} in`
    + (r.filled_hours ? ` (${r.hours ? `gauge ${r.gauge_in.toFixed(2)} in over ${r.hours} hours, ` : ""}radar estimate ${r.filled_in.toFixed(2)} in over ${r.filled_hours} hour${r.filled_hours > 1 ? "s" : ""} the gauge hasn't reported)` : "")
    + (!r.filled_hours && r.hours ? ` (${r.hours} of 24 hours reported so far)` : "");
  const recentRain = chart({
    width: panelW(), height: 180, yMin: 0, yFmt: (v) => v.toFixed(1), yLabel: "rain, in/day",
    series: [
      // every day gets a bar (a missing day's is empty) so bar widths stay daily
      { type: "bar", points: rr.map(({ x, r }) => ({ x, y: r.filled_hours ? r.rain_in : 0, color: COLORS.mist, opacity: covered(r) < 24 ? 0.45 : 1, title: rainTip(r) })) },
      { type: "bar", points: rr.map(({ x, r }) => ({ x, y: r.filled_hours ? r.gauge_in : r.rain_in ?? 0, color: SAGE(), opacity: covered(r) < 24 ? 0.45 : 1, title: rainTip(r) })) },
      { type: "dots", color: css("--color-muted"), r: 3, points: rr.filter(({ r }) => r.rain_in == null).map(({ x, r }) => ({ x, y: 0, title: `${day(r.date)}: no reading` })) },
    ],
    xTicks: everyN(rr.map((p) => p.x), 7), xFmt: shortDay,
  });

  const filledDays = s.recent.rain.filter((r) => r.filled_hours);
  const partial = s.recent.rain.filter((r) => r.hours != null && covered(r) < 24), gaps = s.recent.season_missing_days || 0;
  const recentRainNote = (filledDays.length ? `. Blue is NOAA's radar-and-gauge estimate (MRMS) for hours the Coal Oil Point gauge hasn't reported yet, scaled up to match the gauge, which it has run about 20% below. The gauge's own numbers replace it when they arrive.` : "")
    + (partial.length ? ` Faded bars are days with hours not yet reported (${partial.map((r) => `${day(r.date)}: ${covered(r)} of 24 hours`).join(", ")}).` : "")
    + (gaps ? ` ${gaps} day${gaps > 1 ? "s" : ""} this season ${gaps > 1 ? "have" : "has"} no reading yet (gray dot${gaps > 1 ? "s" : ""}) and count${gaps > 1 ? "" : "s"} as dry.` : "");

  const rainCell = (r) => r.date === s.today && r.so_far_in != null
    ? `${(r.rain_in ?? 0).toFixed(2)}<span class="muted sub"><span title="${esc(r.so_far_src || "")}">${r.so_far_in.toFixed(2)} so far${r.so_far_as_of ? ` (to ${new Date(r.so_far_as_of).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })})` : ""}</span> + ${(r.rest_in ?? 0).toFixed(2)} to come</span>`
    : (r.rain_in ?? 0).toFixed(2);

  // --- tides (72 h observed + predicted +/- 3 days)
  // Pacific clock time as hours since epoch (treating local time as UTC), so local
  // midnights fall on multiples of 24
  const tParse = (t) => Date.parse(t.replace(" ", "T") + "Z") / 3600000;
  const localH = (utcIso) => tParse(new Date(utcIso).toLocaleString("sv-SE", { timeZone: tz }).slice(0, 16));
  const midnights = (xs) => { const a = Math.min(...xs), b = Math.max(...xs), out = []; for (let h = Math.ceil(a / 24) * 24; h <= b; h += 24) out.push(h); return out; };
  const localDayLabel = (h) => new Date(h * 3600000).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", day: "numeric" });
  const nowH = tParse(new Date().toLocaleString("sv-SE", { timeZone: tz }).slice(0, 16));
  const td = s.recent.tides;
  // predictions now run the full forecast horizon; this panel shows +/- 3 days
  const tWin = (p) => Math.abs(tParse(p.t) - nowH) <= 72;
  const tPred = (td?.predicted || []).filter(tWin);
  const tideChart = td ? chart({
    width: panelW(), height: 190, yMin: -2, yMax: 8, yFmt: (v) => v.toFixed(0), yLabel: "tide, ft NAVD88",
    series: [
      { type: "line", color: PRED(), width: 1.8, dash: "5 4", points: tPred.map((p) => ({ x: tParse(p.t), y: p.ft })) },
      { type: "line", color: css("--color-accent"), width: 2.2, points: td.observed.filter(tWin).map((p) => ({ x: tParse(p.t), y: p.ft })) },
    ],
    xTicks: midnights(tPred.map((p) => tParse(p.t))), xFmt: localDayLabel, now: nowH,
  }) : `<p class="muted">Tide data unavailable.</p>`;
  const nextTides = (td?.hilo || []).filter((p) => tParse(p.t) >= nowH).slice(0, 4);

  // --- waves
  const wv = s.recent.waves;
  const waveChart = wv?.series?.length ? chart({
    width: panelW(), height: 190, yMin: 0, yFmt: (v) => v.toFixed(0), yLabel: "wave height, ft",
    series: [{ type: "line", color: OBS(), width: 2.2, points: wv.series.map((p) => ({ x: localH(p.t), y: p.hs_ft })) }],
    y2: (() => {
      const ps = wv.series.map((p) => p.period_s).filter((v) => v != null);
      return ps.length ? { dots: wv.series.map((p) => ({ x: localH(p.t), y: p.period_s, title: `${p.period_s} s` })), min: 0, max: Math.max(20, Math.ceil(Math.max(...ps) / 5) * 5),
        fmt: (v) => v.toFixed(0), label: "period, s", color: COLORS.ochre } : undefined;
    })(),
    xTicks: midnights(wv.series.map((p) => localH(p.t))), xFmt: localDayLabel, now: nowH,
  }) : `<p class="muted">Wave data unavailable.</p>`;

  // --- live sensor, hourly, last 7 days
  const lh = s.stage?.sensor_hourly || [];
  const liveChart = lh.length ? chart({
    width: fullW(), height: 170, yLabel: "water level, ft NAVD88", yMin: Math.floor(Math.min(...lh.map((h) => h.ft)) - 0.3), yMax: Math.ceil(Math.max(...lh.map((h) => h.ft)) + 0.3), yFmt: (v) => v.toFixed(1),
    series: [{ type: "line", color: css("--color-accent"), width: 2, points: lh.map((h) => ({ x: localH(new Date(h.t).toISOString()), y: h.ft })) }],
    xTicks: midnights(lh.map((h) => localH(new Date(h.t).toISOString()))), xFmt: localDayLabel, now: nowH,
  }) : "";

  const srcEntries = Object.entries(s.sources);
  const sources = srcEntries.map(([k, v]) =>
    `<span class="${v.ok ? "" : "down"}" title="${esc(v.ok ? "updated " + v.at : v.error + (v.stale_from ? ", showing data from " + v.stale_from : ""))}">${esc(k.replace(/_/g, " "))}${v.ok ? "" : v.stale_from ? " (stale)" : " (down)"}</span>`).join(", ");

  app.innerHTML = `
  <section class="head">
    <div class="head-sign">
    <div class="sign">
      <figure class="crow"><img src="media/crow/devereux-crow.webp" width="560" height="521" alt="The Devereux Crow, a cartoon crow with binoculars, a field bag, a map, and a surfboard, waving in front of the slough." /><figcaption>Devereux Crow wants you to know...</figcaption></figure>
      <div class="sign-dial">
        <p class="sign-title">${!open && peak && band48 ? `<strong class="sign-level">${SIGN[band48.key][0]}</strong> ${SIGN[band48.key][1]}` : "Breach likelihood"}</p>
        <p class="sign-sub">${open ? "Mouth open" : "in the next 48 hours"}</p>
        ${dialSvg(p48, open || !peak)}
        <p class="sign-read">${open ? "The slough is tidal. The watch starts again when the berm closes."
          : !peak ? "No outlook right now."
          : (bandOf(peak.p).key === "low" ? "Next 10 days: no chance of breach." + (reachHi && !heavyUp ? ` Only rain well above the forecast would bring the slough up to the breach level, around ${day(reachHi.date).replace(/ /g, "\u00a0")}.` : "") : `Next 10 days peak: <strong>${bandOf(peak.p).label}</strong>, ${day(peak.date).replace(/ /g, "\u00a0")}.`)
            + (heavyUp ? `<br/>If rain runs heavy: <strong>${bandOf(heavy.p).label}</strong>.` : "")
            + (bw ? `<br/>Most likely breach: <strong>${windowText(bw.breach_window).replace(/ /g, "\u00a0")}</strong>.` : "")}</p>
      </div>
    </div>
    </div>
    <div class="narrative" aria-live="polite">
      <h1 class="sr-only">${headline}</h1>
      <p class="lead">${lead}${p48 != null ? `${lead ? " " : ""}That puts the next 48 hours at <strong>${band48.label}</strong>. ${levelMeaning(band48, s.model?.levels_record)}` : ""}</p>
      ${windowLine ? `<p class="window">${windowLine}</p>` : ""}
      <p class="outlook">${outlook}</p>
      <dl class="readings">${readings.map(([l, v, n]) => `<dt>${esc(l)}</dt><dd>${esc(v)}${n ? `<small>${esc(n)}</small>` : ""}</dd>`).join("")}</dl>
    </div>
  </section>

  ${s.warnings.length ? s.warnings.map((w) => `<p class="warn">${esc(w)}</p>`).join("") : ""}

  <section class="block" id="level">
    <div class="sec-head">
      <h2>Slough water level</h2>
      <div class="controls" role="group" aria-label="Chart options">${["1w", "3m", "1y", "all", "custom"].map((k) => `<button type="button" data-range="${k}" aria-pressed="${k === levelRange}">${{ "1w": "Past week", "3m": "3 months", "1y": "1 year", all: "Since 2018", custom: "Custom" }[k]}</button>`).join("")}<span class="sep" aria-hidden="true"></span><button type="button" class="ic" data-rain aria-pressed="${showRain}">${ICON_RAIN}Show daily rain</button><button type="button" class="ic" data-tide aria-pressed="${showTide}">${ICON_WAVE}Show tide</button></div>
    </div>
    <div class="custom-range" id="custom-range" ${levelRange === "custom" ? "" : "hidden"}>
      ${dateField("range-from", "From", customFrom, lastDay)}
      ${dateField("range-to", "to", customTo, lastDay)}
      <select id="range-preset" aria-label="Show a whole water year"><option value="">Water year…</option>${waterYears(lastDay).map((w) => `<option value="${w}">${w - 1}–${String(w).slice(2)}</option>`).join("")}</select>
      <span class="range-msg" id="range-msg" role="status" aria-live="polite"></span>
    </div>
    ${legend([[css("--color-text"), "measured (loggers and live sensor)", "line"], [COLORS.ochre, "staff gauge readings", "dot"], [css("--color-accent"), "forecast", "dash"], [css("--color-accent"), "forecast range", "band", 0.3], [COLORS.clay, "where past breaches happened", "band", 0.22], [COLORS.clay, "breach level, this closure", "dash"], [css("--breach"), "breach", "vline"]])}
    <div id="rain-legend">${showRain ? rainLegend() : ""}</div>
    <div id="tide-legend">${showTide && TIDES ? tideLegend() : ""}</div>
    <div id="level-chart">${levelChart}</div>
    <p class="note" id="live-note">${liveNote(s)}</p>
    ${s.stage?.series?.length ? `<p class="after">${levelSummary(s)}</p>` : ""}
    <p class="note" style="margin-top:var(--space-3)">Daily means from CCBER's water-level loggers (2018 to 2025) and the UC Davis / State Parks live sensor (2025 on), re-leveled to the weekly staff gauge at Venoco Bridge. From the latest reading on, the level rolls forward with a rain-driven water balance, using observed rain up to today and forecast rain after. The forecast range covers half to 1.5 times the forecast rain plus the model's typical error. The pale band spans the levels where berms closed for months have breached (${BLV ? `${BLV.mature_min_ft.toFixed(1)} to ${BLV.mature_max_ft.toFixed(1)} ft, ${BLV.mature_n} breaches since 2019` : "past breaches"}); the dashed line is the estimate for the current closure, lower while the berm is young. Feet, NAVD88.</p>
  </section>

  <section class="block" id="watch">
    <h2>Breach Watch</h2>
    ${open ? "" : `
    <p class="intro" style="margin-top:var(--space-8)">Each day's level comes from rain that day, rain so far this season, how long the berm has been building since the mouth closed, and the highest the slough has stood since then. The slough rises within hours of heavy rain and levels off about 6 to 8 hours after the rain stops, so a storm's rain day scores highest. On Likely and Imminent days the table also gives the most likely breach hours, a rough guide: past breaches came about 3 hours after the storm's heaviest hour of rain, so the window runs from 1 to 6 hours after that hour.</p>
    <div class="split">
      <div>
        ${legend(BANDS.map((b) => [b.color, b.label, "bar"]))}
        ${probChart}
        <h3 style="margin:var(--space-6) 0 0">Rain, inches per day</h3>
        ${legend([[OBS(), "observed", "bar"], [PRED(), s.forecast?.source === "NOAA GEFS ensemble mean" ? "forecast (NOAA GEFS, corrected to the gauge)" : "forecast (Open-Meteo, backup)", "bar"]])}
        ${rainChart}
        <p class="note">Today counts the rain already measured at the Coal Oil Point gauge (or the radar estimate for hours the gauge hasn't reported yet) plus the forecast for the hours left. ${s.forecast?.source === "NOAA GEFS ensemble mean" ? "Forecast rain is NOAA's GEFS ensemble mean, which has run light here, corrected against the gauge (see the Model tab); it updates every 6 hours." : "The usual forecast (NOAA GEFS) couldn't be reached, so this uses Open-Meteo as a backup, and later days are also scored as if they could get more rain than forecast (up to 1.5 times on day 10), showing the higher level."}</p>
      </div>
      <div class="table-scroll"><table class="days">
        <thead><tr><th>Day</th><th>Rain, in</th><th>Slough, ft</th><th title="How far the slough sits below the typical breach level">Below breach, ft</th><th>Level</th></tr></thead>
        <tbody>${ahead.map((r) => `<tr class="${r.date === s.today ? "today" : ""}"><td>${r.date === s.today ? "Today" : day(r.date)}</td><td>${rainCell(r)}</td><td>${r.stage_ft?.toFixed(2) ?? "n/a"}</td><td title="breach level ${r.breach_level_ft.toFixed(1)} ft">${r.below_breach_ft == null ? "n/a" : r.below_breach_ft.toFixed(2)}</td><td class="lvl ${r.p >= 0.5 ? "likely" : ""}"><span class="dot" style="background:${bandOf(r.p).color}"></span>${bandOf(r.p).label}${r.breach_window ? `<span class="muted sub" title="A rough guide: about 3 hours after this storm's heaviest hour of rain (${r.breach_window.peak_in.toFixed(2)} in)">most likely ${windowText(r.breach_window)}</span>` : ""}</td></tr>`).join("")}</tbody>
      </table>
      <p class="note">Breach level: ${ahead[0]?.breach_level_ft?.toFixed(1) ?? "n/a"} ft, the typical level of past breaches (lower for a young berm).</p></div>
    </div>`}
  </section>

  <section class="block" id="conditions">
    <h2>Recent conditions</h2>
    <div class="panels">
      ${s.stage?.sensor_hourly?.length ? `<div class="wide">
        <h3>Slough level, last 7 days</h3>
        <p class="note" style="margin-top:2px">Hourly, from the UC Davis Coastal Oceanography Group / California State Parks <a href="https://coastalocean.ucdavis.edu/ocean-observing/flooding/devereux-slough">sensor</a>. A drop of more than 1.5 ft in a few hours means the berm has breached, and the page marks the mouth open without waiting for CCBER's log.</p>
        ${liveChart}
      </div>` : ""}
      <div>
        <h3>Rain, last 30 days</h3>
        ${legend([[SAGE(), "Coal Oil Point gauge", "bar"], ...(filledDays.length ? [[COLORS.mist, "radar estimate, until the gauge reports", "bar"]] : [])])}
        ${recentRain}
        <p class="note">Water year to date: <span class="num">${s.recent.season_rain_in.toFixed(2)} in</span>${recentRainNote}</p>
      </div>
      <div>
        <h3>Mouth history</h3>
        <ul class="plain">${(s.mouth?.recent_events || []).map((e) => `<li><span>${e.state === "open" ? "Breached" : "Closed"}</span><span class="num muted">${day(e.date, { month: "short", day: "numeric", year: "numeric" })}</span></li>`).join("")}</ul>
      </div>
      <div>
        <h3>Ocean level, Santa Barbara</h3>
        ${legend([[OBS(), "observed", "line"], [PRED(), "predicted tide", "dash"]])}
        ${tideChart}
        <ul class="plain">${nextTides.map((p) => `<li><span>${p.type === "H" ? "High" : "Low"}, ${new Date(p.t.replace(" ", "T")).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}</span><span class="num">${p.ft.toFixed(1)} ft</span></li>`).join("")}</ul>
        <p class="note">NOAA station 9411340.</p>
      </div>
      <div>
        <h3>Waves, ${esc(wv?.station || "nearest buoy")}</h3>
        ${legend([[OBS(), "significant wave height, ft (left)", "line"], [COLORS.ochre, "dominant period, s (right)", "dot"]])}
        ${waveChart}
        ${wv?.latest ? `<p class="note">Latest <span class="num">${wv.latest.hs_ft.toFixed(1)} ft</span> at <span class="num">${wv.latest.period_s ?? "?"} s</span> from <span class="num">${wv.latest.dir_deg ?? "?"}°</span>, ${new Date(wv.latest.t).toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" })}.</p>` : ""}
      </div>
    </div>
  </section>

  <section class="block" id="how">
    <h2>How this works</h2>
    <div class="prose">
      <p>The slough fills with rain and the runoff it sends down from the roughly 2.5-square-mile watershed, and the berm breaches when the water tops it. The slough level comes from the live water-level sensor (yesterday's average), or from the latest weekly staff-gauge reading if the sensor is down. Future days roll that level forward with forecast rain and runoff, at about 0.7 ft of rise per inch of rain on past storms, a little less when the slough is already full.</p>
      <p>Each day gets a score between 0 and 1 from a logistic model, which weighs each input by how strongly it tracked past breaches, adds them up and squeezes the total onto that 0 to 1 scale. It uses four things: <strong>rain that day</strong>, <strong>rain since October 1</strong>, <strong>how long the berm has been building</strong> since the mouth last closed, and <strong>the highest the slough has stood since then</strong>, through the day before. Waves rebuild the berm after every closure, so a young berm breaks at a much lower level than one that has stood all summer, and a slough that has already held high water has shown how close it is to the top. A wet season primes the watershed, so the same storm sends more water down late in the winter. The model was the leader of a search over thousands of combinations of rain, level and berm inputs, scored on the seasons with a measured water level. With no usable level reading, the page falls back to a rain-only model.</p>
      <p>The score ranks risk well but, with ${s.model.levels_record?.breaches ?? 17} recorded breaches, isn't a dependable percentage, so the page reports levels. Each level's cutoff was set from the scores on past breach days. Over the record, ${BANDS.filter((b) => b.key !== "low").map((b) => `${b.label} came before ${b.caught} of ${s.model.levels_record?.breaches ?? 16} breaches and came up ${b.false_alarm_episodes ? (b.false_alarm_episodes === 1 ? "once" : `${b.false_alarm_episodes} times`) + " with no breach after it" : "with no false alarms"}`).join("; ")}. Alerts go out at Possible. A breach counts as flagged if the level was reached that day or the day before, since a storm that runs past midnight spans two calendar days. Tides and waves are shown for context; they don't drive breaches here.</p>
      <p>Limits: the current slough level is measured (the UC Davis sensor reports every 5 minutes; this page uses hourly averages), but the next 10 days are a forecast, and a single storm's rise can miss by about 0.4 ft either way. Forecast rain is NOAA's GEFS ensemble forecast, corrected for how light it has run at Coal Oil Point and refit each week against the gauge; a single storm can still come in well above or below it. The mouth state comes from CCBER's log, updated by the live sensor within hours of a breach or closure; if the sensor is down, the page relies on the log, which can lag by days.</p>
    </div>
    <p class="sources">Sources: <a href="https://github.com/ccber-restoration/hydrology">CCBER hydrology data</a> (mouth log, staff gauge), <a href="https://coastalocean.ucdavis.edu/ocean-observing/flooding/devereux-slough">UC Davis / State Parks sensor</a>, <a href="https://www.ncei.noaa.gov/">NOAA NCEI</a> Coal Oil Point gauge, <a href="https://registry.opendata.aws/noaa-gefs/">NOAA GEFS</a> forecasts (<a href="https://open-meteo.com/">Open-Meteo</a> as backup), <a href="https://tidesandcurrents.noaa.gov/stationhome.html?id=9411340">NOAA tides</a>, <a href="https://cdip.ucsd.edu/m/products/?stn=107p1">CDIP 107 Goleta Point</a> and NDBC buoys <a href="https://www.ndbc.noaa.gov/station_page.php?station=46053">46053</a> and <a href="https://www.ndbc.noaa.gov/station_page.php?station=46218">46218</a>, <a href="https://dataspace.copernicus.eu/">Copernicus Sentinel-2</a>, <a href="https://naip-usdaonline.hub.arcgis.com/">USDA NAIP</a>.<br/>
    Live feeds: ${sources}. Updated ${new Date(s.generated_at).toLocaleString("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" })} Pacific. Model fit ${esc(s.model.exported)}.</p>
  </section>`;
}

// ------------------------------------------------------------- breach alerts (push + email)
const b64ToBytes = (b64) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const post = (path, body) => fetch(`/devereux/api/alerts/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  .then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }));

// "Get alerts" in the header opens the alerts dialog (other tabs link to /devereux/#alerts)
const alertsDlg = document.getElementById("alerts-dialog");
const openAlerts = () => { if (alertsDlg && !alertsDlg.open) alertsDlg.showModal(); };
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-alerts-open]")) { e.preventDefault(); openAlerts(); }
  if (e.target.closest("[data-alerts-close]") || e.target === alertsDlg) alertsDlg.close();
});
if (location.hash === "#alerts" || new URLSearchParams(location.search).get("alerts")) openAlerts();

async function initAlerts() {
  const card = document.getElementById("alerts");
  let cfg;
  try { cfg = await fetch("/devereux/api/alerts/config").then((r) => r.json()); } catch { return; }
  if (!cfg.push?.enabled && !cfg.email?.enabled) return; // nothing set up yet
  card.hidden = false;
  document.getElementById("alerts-off").hidden = true;

  // banner after confirming/unsubscribing by email link
  const q = new URLSearchParams(location.search).get("alerts");
  const emailNote = document.getElementById("email-note");
  if (q) {
    emailNote.textContent = { confirmed: "You're signed up. You'll get an email when the Breach Watch reaches Possible.", unsubscribed: "You're unsubscribed. No more emails.", invalid: "That link didn't work. Try signing up again." }[q] || "";
    emailNote.className = `note ${q === "invalid" ? "err" : "ok"}`;
  }

  // email
  const form = document.getElementById("email-form");
  if (!cfg.email?.enabled) document.getElementById("email-box").hidden = true;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector("button");
    btn.disabled = true;
    const r = await post("email", { email: fd.get("email"), website: fd.get("website") });
    btn.disabled = false;
    emailNote.textContent = r.ok ? "Check your inbox for a confirmation link." : r.error || "Something went wrong. Try again.";
    emailNote.className = `note ${r.ok ? "ok" : "err"}`;
    if (r.ok) form.reset();
  });

  // push
  const pbtn = document.getElementById("push-btn"), pnote = document.getElementById("push-note");
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (!cfg.push?.enabled) { document.getElementById("push-box").hidden = true; return; }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    pbtn.hidden = true;
    pnote.textContent = isIOS && !standalone
      ? "On iPhone: tap Share, then Add to Home Screen, open the page from there, and tap Notify me."
      : "This browser doesn't support notifications. Use email instead.";
    return;
  }
  const reg = await navigator.serviceWorker.register("/devereux/sw.js", { scope: "/devereux/" });
  if (Notification.permission === "denied") {
    pnote.textContent = "Notifications are blocked for this site. Allow them in your browser's site settings, or use email.";
    pnote.className = "note err";
  }
  const setState = (sub) => {
    pbtn.textContent = sub ? "Turn off notifications" : "Notify me on this device";
    pbtn.className = sub ? "btn secondary" : "btn";
    pnote.textContent = sub ? "Notifications are on for this device." : "";
    pnote.className = "note ok";
  };
  setState(await reg.pushManager.getSubscription());
  pbtn.addEventListener("click", async () => {
    pbtn.disabled = true;
    try {
      const cur = await reg.pushManager.getSubscription();
      if (cur) {
        await post("push/unsubscribe", { endpoint: cur.endpoint });
        await cur.unsubscribe();
        setState(null);
      } else {
        if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for this site in your browser settings.");
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.push.publicKey) });
        const r = await post("push", { subscription: sub.toJSON() });
        if (!r.ok) { await sub.unsubscribe(); throw new Error(r.error || "Couldn't save the subscription."); }
        setState(sub);
      }
    } catch (e) {
      pnote.textContent = e.message; pnote.className = "note err";
    }
    pbtn.disabled = false;
  });
}

// The slough can't rise past the breach level: once it gets there the mouth breaches. Forecast
// levels (middle line, range, table) stop at the breach level for display; the model's scores
// are computed upstream and are unchanged.
function capAtBreach(s) {
  if (s.mouth?.state === "open") return;
  for (const r of s.stage?.series || []) {
    const bl = r.breach_level_ft;
    if (bl == null || r.date < s.today || r.phase === "reading") continue;
    for (const k of ["ft", "lo", "hi"]) if (r[k] != null && r[k] > bl) r[k] = bl;
  }
  for (const r of s.outlook || []) {
    if (r.date < s.today || r.breach_level_ft == null || r.stage_ft == null) continue;
    if (r.stage_ft > r.breach_level_ft) { r.stage_ft = r.breach_level_ft; r.below_breach_ft = 0; }
  }
}

async function load() {
  try {
    const [r, h] = await Promise.all([fetch("/devereux/api/status"), fetch("stage-history.json").catch(() => null)]);
    if (!r.ok) throw new Error(r.status);
    if (h?.ok) HISTORY = await h.json();
    if (!EVENTS) EVENTS = await fetch("events.json").then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const s = await r.json();
    // keep the newer of the status's latest reading and the last live poll
    if (LIVE.length && s.stage && LIVE.at(-1).t > (s.stage.sensor_now?.t ?? 0)) s.stage.sensor_now = LIVE.at(-1);
    capAtBreach(s);
    window.__devereux = s;
    render(s);
    if (!window.__alertsInit) { window.__alertsInit = true; initAlerts(); }
  } catch (e) {
    app.innerHTML = `<div class="loading">Couldn't load the slough data (${esc(e.message)}). Try again in a minute.</div>`;
  }
}
load().then(pollLive);
// re-render charts on theme change so axis colors follow
new MutationObserver(() => window.__devereux && render(window.__devereux)).observe(document.body, { attributes: true, attributeFilter: ["class"] });
