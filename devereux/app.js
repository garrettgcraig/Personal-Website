// Devereux Slough breach outlook page. Fetches /devereux/api/status (see
// netlify/functions/devereux-api.mjs) and draws everything with inline SVG.

import { breachWindow } from "./model.js";

const app = document.getElementById("app");
const FT = (v, d = 1) => (v == null ? "n/a" : `${v.toFixed(d)} ft`);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tz = "America/Los_Angeles";
const day = (iso, opts = { weekday: "short", month: "short", day: "numeric" }) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", opts);
const COLORS = { sky: "#2D5A7B", ochre: "#D3A43B", sage: "#5E6E3A", clay: "#A65A3C", mesa: "#6B4A73", mist: "#7FA3BD" };
const LEVEL_TEXT = { low: "Low", watch: "Watch", likely: "Likely" };
const css = (v) => getComputedStyle(document.body).getPropertyValue(v).trim();

// ------------------------------------------------------------- tiny SVG charts
// series: [{type: "bar"|"line"|"dots"|"step", points: [{x: Date|number, y}], color, width, opacity, dash}]
// y2 (optional): a second, right-hand axis, either bars that hang down from the top of the
// plot (a hyetograph): {bars: [{x0, x1, y, color, title}], max, fmt, label}, or dots on a
// normal axis: {dots: [{x, y, title}], min, max, fmt, label, color}.
function chart({ series, width = 680, height = 200, yMin = 0, yMax, yFmt = (v) => v, xTicks, xFmt, now, bands = [], hlines = [], vlines = [], xMin, xMax, y2 }) {
  const W = width, H = height, m = { l: 40, r: y2 ? 44 : 12, t: 10, b: 24 };
  const xs = series.flatMap((s) => s.points.map((p) => +p.x));
  const x0 = xMin ?? Math.min(...xs), x1 = xMax ?? Math.max(...xs);
  const ys = series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => v != null);
  const top = yMax ?? Math.max(...ys, yMin + 1e-9) * 1.1;
  const bot = yMin ?? Math.min(...ys);
  const nBars = new Set(series.filter((s) => s.type === "bar").flatMap((s) => s.points.map((p) => +p.x))).size;
  const barW = nBars ? Math.max(2, ((W - m.l - m.r) / nBars) * 0.7) : 0;
  const X = (v) => m.l + ((+v - x0) / Math.max(1, x1 - x0)) * (W - m.l - m.r - barW) + barW / 2;
  const Y = (v) => m.t + (1 - (v - bot) / Math.max(1e-9, top - bot)) * (H - m.t - m.b);
  let g = "";
  for (const b of bands) g += `<rect x="${X(b.x0)}" y="${m.t}" width="${Math.max(0, X(b.x1) - X(b.x0))}" height="${H - m.t - m.b}" fill="${b.color}" opacity="${b.opacity ?? 0.12}"/>`;
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = bot + ((top - bot) * i) / ticks;
    g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${yFmt(v)}</text>`;
  }
  for (const h of hlines) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(h.y)}" y2="${Y(h.y)}" stroke="${h.color}" stroke-dasharray="4 4" stroke-width="1.5"/><text x="${W - m.r}" y="${Y(h.y) - 4}" text-anchor="end" style="fill:${h.color}">${esc(h.label)}</text>`;
  for (const v of vlines) g += `<line x1="${X(v.x)}" x2="${X(v.x)}" y1="${m.t}" y2="${H - m.b}" stroke="${v.color}" stroke-width="1.5" opacity="0.8"/>${v.label ? `<text x="${X(v.x) + 3}" y="${H - m.b - 4}" style="fill:${v.color}">${esc(v.label)}</text>` : ""}`;
  // y2 bars are drawn first so the lines stay on top
  if (y2?.dots) {
    // right axis for a second measure drawn as dots (bottom-up)
    const plotH = H - m.t - m.b, lo2 = y2.min ?? 0;
    const Y2 = (v) => m.t + (1 - (v - lo2) / Math.max(1e-9, y2.max - lo2)) * plotH;
    for (const p of y2.dots) if (p.y != null && +p.x >= x0 && +p.x <= x1) g += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y2(p.y).toFixed(1)}" r="${y2.r || 2.4}" fill="${y2.color}" opacity="0.85"><title>${esc(p.title || "")}</title></circle>`;
    for (let i = 0; i <= 2; i++) {
      const v = lo2 + ((y2.max - lo2) * i) / 2;
      g += `<text x="${W - m.r + 6}" y="${(Y2(v) + 4).toFixed(1)}" text-anchor="start">${y2.fmt(v)}</text>`;
    }
    g += `<text x="${W - 4}" y="${m.t + plotH / 2}" text-anchor="middle" transform="rotate(90 ${W - 4} ${m.t + plotH / 2})">${esc(y2.label)}</text>`;
    g += `<line class="axis" x1="${W - m.r}" x2="${W - m.r}" y1="${m.t}" y2="${H - m.b}"/>`;
  } else if (y2) {
    const plotH = H - m.t - m.b;
    const Y2 = (v) => m.t + (v / y2.max) * plotH; // 0 at the top, growing downward
    for (const b of y2.bars) {
      if (b.x1 < x0 || b.x0 > x1 || !(b.y > 0)) continue;
      const xa = X(Math.max(b.x0, x0)), xb = X(Math.min(b.x1, x1));
      g += `<rect x="${xa.toFixed(1)}" y="${m.t}" width="${Math.max(1.5, xb - xa - 0.6).toFixed(1)}" height="${(Y2(b.y) - m.t).toFixed(1)}" fill="${b.color}" opacity="${b.opacity ?? 0.75}"><title>${esc(b.title || "")}</title></rect>`;
    }
    for (let i = 0; i <= 2; i++) {
      const v = (y2.max * i) / 2;
      g += `<text x="${W - m.r + 6}" y="${(Y2(v) + 4).toFixed(1)}" text-anchor="start">${y2.fmt(v)}</text>`;
    }
    g += `<text x="${W - 4}" y="${m.t + plotH / 2}" text-anchor="middle" transform="rotate(90 ${W - 4} ${m.t + plotH / 2})">${esc(y2.label)}</text>`;
    g += `<line class="axis" x1="${W - m.r}" x2="${W - m.r}" y1="${m.t}" y2="${H - m.b}"/>`;
  }
  for (const s of series) {
    const pts = s.points.filter((p) => p.y != null && +p.x >= x0 - 1 && +p.x <= x1 + 1);
    if (s.type === "band") {
      const b = s.points.filter((p) => p.lo != null && +p.x >= x0 - 1 && +p.x <= x1 + 1);
      if (b.length) g += `<path d="${b.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.hi).toFixed(1)}`).join("")}${b.slice().reverse().map((p) => `L${X(p.x).toFixed(1)},${Y(p.lo).toFixed(1)}`).join("")}Z" fill="${s.color}" opacity="${s.opacity ?? 0.2}" stroke="none"/>`;
      continue;
    }
    if (s.type === "bar") {
      for (const p of pts) g += `<rect x="${X(p.x) - barW / 2}" y="${Y(Math.max(p.y, bot))}" width="${barW}" height="${Math.max(0, Y(bot) - Y(Math.max(p.y, bot)))}" fill="${p.color || s.color}" opacity="${p.opacity ?? s.opacity ?? 1}" rx="1.5"><title>${esc(p.title || "")}</title></rect>`;
    } else if (s.type === "dots") {
      for (const p of pts) g += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${s.r || 3.5}" fill="${s.color}"><title>${esc(p.title || "")}</title></circle>`;
    } else {
      // break the line across gaps longer than s.gap (x units)
      const d = pts.map((p, i) => `${i && !(s.gap && +p.x - +pts[i - 1].x > s.gap) ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} opacity="${s.opacity ?? 1}" stroke-linejoin="round"/>`;
    }
  }
  if (now != null) g += `<line x1="${X(now)}" x2="${X(now)}" y1="${m.t}" y2="${H - m.b}" stroke="${css("--color-muted")}" stroke-width="1"/><text x="${X(now) + 4}" y="${m.t + 10}">now</text>`;
  for (const t of xTicks || []) g += `<text x="${X(t)}" y="${H - 6}" text-anchor="middle">${esc(xFmt(t))}</text>`;
  g += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${Y(bot)}" y2="${Y(bot)}"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
// items: [color, label, style] with style "line", "dash" or none (a swatch)
const legend = (items) => `<div class="legend">${items.map(([c, l, st]) => `<span><i class="${st || ""}" style="background:${c};border-color:${c}"></i>${esc(l)}</span>`).join("")}</div>`;
const dayNum = (iso) => Date.parse(`${iso}T12:00:00Z`) / 86400000;
const everyN = (arr, n) => arr.filter((_, i) => i % n === 0);
// evenly spaced day ticks (every `step` days) across [a, b]
const dayTicks = (a, b, step) => { const out = []; for (let x = Math.ceil(a); x <= b; x += step) out.push(x); return out; };
const shortDay = (x) => day(new Date(x * 86400000).toISOString().slice(0, 10), { month: "short", day: "numeric" });

// Chart widths follow the layout (viewBox = rendered width), so axis text stays at 11px.
const fullW = () => Math.max(300, Math.round(app.clientWidth || 1100));
const wide = () => fullW() > 900;
const splitW = () => (wide() ? Math.round((fullW() - 56) * 1.2 / 2.2) : fullW());
const panelW = () => (wide() ? Math.round((fullW() - 56) / 2) : fullW());
let lastW = 0;
addEventListener("resize", () => {
  clearTimeout(window.__rz);
  window.__rz = setTimeout(() => { if (window.__devereux && Math.abs(fullW() - lastW) > 40) render(window.__devereux); }, 200);
});

// ------------------------------------------------------------- slough level time series
let HISTORY = null; // stage-history.json: re-leveled daily record (static, from the Python project)
let levelRange = "3m";
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
      { type: "line", color: COLORS.mist, width: 1.1, dash: "3 3", opacity: 0.9, gap: 0.05, points: pred },
      { type: "line", color: COLORS.sky, width: 1, opacity: 0.6, gap: 0.05, points: obs },
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
  return { ys, series: [{ type: "band", color: COLORS.sky, opacity: 0.14, points: band }] };
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

// Daily rain (in) for the level chart: baked-in history (Coal Oil Point gauge, filled from
// KSBA + CoCoRaHS), then the live feed's last 30 days, then the 10-day forecast.
function rainBars(s, start, end) {
  const daily = new Map();
  for (const [d, v] of HISTORY?.rain || []) daily.set(dayNum(d), { y: v, fc: false });
  for (const r of s.recent?.rain || []) if (r.rain_in != null) daily.set(dayNum(r.date), { y: r.rain_in, fc: false });
  for (const r of s.outlook || []) if (!r.observed && r.rain_in != null) daily.set(dayNum(r.date), { y: r.rain_in, fc: true });
  const days = [...daily].filter(([x, v]) => x >= start - 7 && x <= end && v.y > 0).sort((a, b) => a[0] - b[0]);
  const obsColor = css("--color-accent"), fcColor = COLORS.mist;
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
  let start = range === "3m" ? nowX - 90 : range === "1y" ? nowX - 365 : dayNum("2018-10-01");
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
  const breaches = (HISTORY?.breaches || []).map(dayNum).filter(vis);
  const mid = series.map((r) => ({ x: dayNum(r.date), y: r.ft, phase: r.phase }));
  const span = end - start;
  return chart({
    width: fullW(), height: wide() ? 340 : 260, xMin: start, xMax: end, yMin, yMax, yFmt: (v) => v.toFixed(0),
    series: [
      ...tide.series,
      { type: "band", color: css("--color-accent"), opacity: 0.18, points: series.map((r) => ({ x: dayNum(r.date), lo: r.lo, hi: r.hi })) },
      { type: "line", color: css("--color-text"), width: span > 400 ? 1 : 1.6, gap: 2, opacity: 0.85, points: loggers.map((r) => ({ x: r.x, y: r.ft })) },
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
    xTicks: span <= 120 ? dayTicks(start, end, 14) : span <= 400 ? monthTicks(start, end, 2) : monthTicks(start, end, 12),
    xFmt: (x) => span <= 400 ? shortDay(x) : String(new Date(x * 86400000).getUTCFullYear()),
    now: nowX >= start && nowX <= end ? nowX : null,
  });
}

function levelSummary(s) {
  const f = s.stage.series.filter((r) => r.phase === "forecast");
  const last = f.at(-1);
  if (!last) return "";
  const r = s.stage.latest_reading;
  return `Latest reading ${r.ft.toFixed(2)} ft on ${day(r.date, { month: "short", day: "numeric" })}. `
    + `By ${day(last.date, { weekday: "short", month: "short", day: "numeric" })} the slough is forecast at about ${last.ft.toFixed(1)} ft `
    + `(range ${last.lo.toFixed(1)} to ${last.hi.toFixed(1)} ft)` + (last.breach_level_ft != null && s.mouth?.state !== "open" ? `, against an estimated breach level near ${last.breach_level_ft.toFixed(1)} ft.` : ".");
}

const rainLegend = () => legend([[css("--color-accent"), "rain, observed (right axis, hanging from the top)"], [COLORS.mist, "rain, forecast"]]);
const tideLegend = () => (levelSpan() <= 120
  ? legend([[COLORS.sky, "tide, observed (NOAA Santa Barbara, same axis)", "line"], [COLORS.mist, "tide, predicted where observed is missing", "dash"]])
  : legend([[COLORS.sky + "55", "daily tide range, high to low (NOAA Santa Barbara, same axis)"]]));
// span in days of the level chart's current view
function levelSpan() {
  if (levelRange === "3m") return 90;
  if (levelRange === "1y") return 365;
  if (levelRange === "custom" && customFrom && customTo) return dayNum(customTo) - dayNum(customFrom);
  return 3000;
}
function liveNote(s) {
  const n = s.stage?.sensor_now;
  if (!n) return "";
  const when = new Date(n.t).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `Live sensor: ${n.ft.toFixed(2)} ft at ${when}. The chart's right end follows the sensor and refreshes every 5 minutes while this page is open.`;
}
// Poll the live sensor every 5 minutes while the page is visible; rebuild the whole page
// from the status API every 30 minutes so the forecast and Breach Watch keep up too.
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
setInterval(() => { if (!document.hidden) load(); }, 30 * 60000);
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
document.addEventListener("change", (e) => {
  if (!e.target.matches?.("#custom-range input") || !window.__devereux) return;
  const [a, b] = [document.getElementById("range-from").value, document.getElementById("range-to").value];
  if (!a || !b) return;
  [customFrom, customTo] = a <= b ? [a, b] : [b, a];
  redrawLevel();
});
const isoDay = (x) => new Date(x * 86400000).toISOString().slice(0, 10);

// ------------------------------------------------------------- breach likelihood dial
// Breach Watch levels, like a fire-danger sign. The model's daily score ranks risk but isn't
// a calibrated chance (ten recorded breaches), so the page shows levels whose lower bounds
// come from the held-out record (model-params.json "levels"). Alerts go out at Watch.
const LEVEL_STYLE = { low: { color: "#4E8F4A", ink: "#fff" }, watch: { color: "#E2B33C", ink: "#1B2530" },
  warning: { color: "#D9772B", ink: "#fff" }, likely: { color: "#C23B30", ink: "#fff" } };
let BANDS = [{ key: "low", label: "Low", min: 0 }, { key: "watch", label: "Watch", min: 0.02 }, { key: "warning", label: "Warning", min: 0.2 }, { key: "likely", label: "Likely", min: 0.5 }]
  .map((l) => ({ ...l, ...LEVEL_STYLE[l.key] }));
const setBands = (levels) => { if (levels?.length) BANDS = levels.map((l) => ({ ...l, ...(LEVEL_STYLE[l.key] || LEVEL_STYLE.low) })); };
const bandOf = (p) => (p == null ? null : [...BANDS].reverse().find((b) => p >= b.min) ?? BANDS[0]);
// What each level has meant on the record
function levelMeaning(b, rec) {
  const n = rec?.breaches ?? 10;
  if (b.key === "low") return "Below the level every recorded breach reached first.";
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
  return `<svg class="dial" viewBox="0 0 380 186" role="img" aria-label="${off ? "Breach likelihood dial, off while the mouth is open" : `Breach likelihood: ${b.label}`}">
    ${BANDS.map((bd, k) => `<path d="${wedge(k)}" fill="${bd.color}" opacity="${off ? 0.3 : k === i ? 1 : 0.72}" stroke="#2A2119" stroke-width="2"/>`).join("")}
    ${BANDS.map((bd, k) => {
      const [x, y] = pt(R + 12, mid(k)), c = Math.cos(mid(k));
      return `<text x="${x}" y="${y + 4}" text-anchor="${Math.abs(c) < 0.2 ? "middle" : c < 0 ? "end" : "start"}" fill="${k === i ? "#F3EBDD" : "#BFAE93"}" font-size="14" font-weight="${k === i ? 700 : 500}">${bd.label}</text>`;
    }).join("")}
    ${off ? "" : `<path d="M${lx},${ly} L${tx},${ty} L${rx},${ry} Z" fill="#F3EBDD" stroke="#2A2119" stroke-width="1.5" stroke-linejoin="round"/>`}
    <circle cx="${cx}" cy="${cy}" r="12" fill="#2A2119" stroke="#E0B656" stroke-width="2.5"/>
  </svg>`;
}

// ------------------------------------------------------------- satellite frames
// The clearest image of each stage of the cycle. Sentinel-2 L2A true color (10 m) for the
// stages only a frequent satellite catches; USDA NAIP aerial photos (0.6 m, flown in late spring
// or summer every two years) where one fits. Levels are the re-leveled daily means.
const SAT = "media/satellite/";
const FRAMES = [
  { key: "dry", label: "Dry", date: "July 13, 2016", src: "NAIP aerial photo, 0.6 m", text: "Midsummer in a drought year. The lower slough has dried to a salt flat, with water left only in the channels. (The north arms look different because they were restored from 2017 to 2019.)" },
  { key: "filling", label: "Filling", date: "October 27, 2025", src: "Sentinel-2, 10 m", text: "First storms, 5.4 ft. Early rain pools in the lower slough while the berm holds." },
  { key: "full", label: "Full", date: "February 6, 2020", src: "Sentinel-2, 10 m", text: "Full, 9.2 ft, after 323 days closed. It breached five weeks later. (Every day before the November 2025 breach was cloudy, so this frame comes from 2020.)" },
  { key: "tidal", label: "Tidal", date: "November 26, 2025", src: "Sentinel-2, 10 m", text: "Open, 11 days after the November 15 breach. The slough drains to about 4 ft and rises and falls with the tide." },
  { key: "reclosed", label: "Closed again", date: "May 21, 2020", src: "NAIP aerial photo, 0.6 m", text: "Closed again, 6.1 ft. Waves rebuilt the berm about seven weeks earlier, after the March 16 breach, and the lower slough is holding water again." },
  { key: "now", label: "Latest", date: "November 11, 2026", src: "Sentinel-2, 10 m", text: "The most recent clear image, 6.1 ft. Water fills the lower slough; the north arms are still mostly dry." },
];
let frameIdx = FRAMES.length - 1;
function setFrame(i) {
  frameIdx = (i + FRAMES.length) % FRAMES.length;
  document.querySelectorAll(".frames .stage img").forEach((im, k) => im.classList.toggle("on", k === frameIdx));
  document.querySelectorAll(".frames .strip button").forEach((b, k) => b.setAttribute("aria-pressed", String(k === frameIdx)));
  const f = FRAMES[frameIdx], cap = document.getElementById("frame-cap");
  if (cap) cap.innerHTML = `<span class="when">${esc(f.date)} · ${esc(f.src)}</span>${esc(f.text)}`;
}
const framesHtml = () => `
  <figure class="frames" aria-label="The slough from orbit through one cycle">
    <div class="stage">${FRAMES.map((f, k) => `<img src="${SAT}${f.key}.jpg" alt="Overhead view of Devereux Slough, ${esc(f.date)}: ${esc(f.text)}" class="${k === frameIdx ? "on" : ""}" ${k === frameIdx ? "" : `loading="lazy"`} decoding="async" width="1056" height="960" />`).join("")}</div>
    <div class="strip" role="group" aria-label="Stages of the cycle">${FRAMES.map((f, k) => `<button type="button" data-frame="${k}" aria-pressed="${k === frameIdx}"><img src="${SAT}${f.key}-thumb.jpg" alt="" loading="lazy" />${esc(f.label)}</button>`).join("")}</div>
    <figcaption id="frame-cap"><span class="when">${esc(FRAMES[frameIdx].date)} · ${esc(FRAMES[frameIdx].src)}</span>${esc(FRAMES[frameIdx].text)}</figcaption>
  </figure>`;
document.addEventListener("click", (e) => { const b = e.target.closest("[data-frame]"); if (b) setFrame(Number(b.dataset.frame)); });
document.addEventListener("keydown", (e) => {
  if (!e.target.closest?.(".frames .strip")) return;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    setFrame(frameIdx + (e.key === "ArrowRight" ? 1 : -1));
    document.querySelector(`[data-frame="${frameIdx}"]`)?.focus();
  }
});

// ------------------------------------------------------------- render
function render(s) {
  lastW = fullW();
  setBands(s.model?.levels);
  const BLV = s.model?.breach_levels;
  const open = s.mouth?.state === "open";
  const todayRow = s.outlook.find((r) => r.date === s.today);
  const ahead = s.outlook.filter((r) => r.date >= s.today);
  const peak = s.peak;

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
  const headline = !s.mouth ? "Breach Watch is off." : open ? "Breach Watch is off: the mouth is open." : !peak ? "Breach Watch is off." : `Breach Watch: ${band48.label.toLowerCase()}.`;
  const headColor = band48 ? band48.color : css("--color-muted");
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
    const nearHi = f.reduce((m, r) => Math.min(m, r.breach_level_ft - r.hi), Infinity);
    outlook = `Over the next 10 days the outlook peaks at <strong>${bandOf(peak.p).label}</strong> on ${day(peak.date)}`
      + (peak.rain_in >= 0.1 ? `, with ${peak.rain_in.toFixed(2)} in of rain forecast that day.` : ".")
      + (near ? ` The slough should come within about ${(near.breach_level_ft - near.ft).toFixed(1)} ft of the breach level around ${day(near.date, { month: "short", day: "numeric" })}`
        + (Number.isFinite(nearHi) ? (nearHi > 0 ? `, or ${nearHi.toFixed(1)} ft if rain runs heavy.` : `, and could reach it if rain runs heavy.`) : ".") : "");
  }

  const wyear = s.today.slice(0, 4) * 1 + (s.today.slice(5, 7) >= "10" ? 1 : 0);
  const readings = [
    ["Mouth", s.mouth ? `${open ? "Open" : "Closed"}` : "unknown", s.mouth ? `since ${day(s.mouth.since, { month: "short", day: "numeric", year: "numeric" })}` : ""],
    ["Slough level", nowFt != null ? `${nowFt.toFixed(2)} ft` : "n/a", nowWhen],
    [mature ? "Typical breach level" : "Breach level, young berm", blToday != null ? `${blToday.toFixed(1)} ft` : "n/a", mature ? `past ${BLV.mature_min_ft.toFixed(1)} to ${BLV.mature_max_ft.toFixed(1)}` : open ? "mouth open" : "estimated"],
    ["Rain since October 1", `${s.recent.season_rain_in.toFixed(2)} in`, `water year ${wyear}`],
  ];

  // --- outlook chart: past 14 days observed + 10-day forecast
  const nowX = dayNum(s.today);
  const pts = s.outlook.map((r) => ({ x: dayNum(r.date), r }));
  const probChart = chart({
    width: splitW(), height: 200, yMin: 0, yMax: BANDS.length, yFmt: (v) => (v >= 1 ? BANDS[Math.round(v) - 1]?.label ?? "" : ""),
    series: [{
      type: "bar", points: pts.map(({ x, r }) => ({
        x, y: BANDS.indexOf(bandOf(r.p)) + 1, color: bandOf(r.p).color,
        opacity: r.observed ? 0.4 : 1, title: `${day(r.date)}: ${bandOf(r.p).label}` + (r.margin_ft == null ? " (rain only)" : `, slough ${Math.abs(r.below_breach_ft).toFixed(1)} ft ${r.below_breach_ft > 0 ? "below" : "above"} the breach level, ${(r.rain_in ?? 0).toFixed(2)} in rain`),
      })),
    }],
    xTicks: everyN(pts.map((p) => p.x), 3), xFmt: (x) => day(new Date(x * 86400000).toISOString().slice(0, 10), { month: "short", day: "numeric" }), now: nowX - 0.5,
  });
  const rainChart = chart({
    width: splitW(), height: 120, yMin: 0, yFmt: (v) => v.toFixed(1),
    series: [{ type: "bar", points: pts.map(({ x, r }) => ({ x, y: r.rain_in ?? 0, color: r.observed ? css("--color-accent") : COLORS.mist, title: `${day(r.date)}: ${(r.rain_in ?? 0).toFixed(2)} in (${r.rain_src})` })) }],
    xTicks: everyN(pts.map((p) => p.x), 3), xFmt: (x) => day(new Date(x * 86400000).toISOString().slice(0, 10), { month: "short", day: "numeric" }), now: nowX - 0.5,
  });

  const lastDay = s.stage?.series?.length ? s.stage.series.at(-1).date : s.today;
  if (!customFrom) { customFrom = isoDay(dayNum(s.today) - 182); customTo = lastDay; }
  const levelChart = levelChartSvg(s, levelRange);

  // --- recent rain (30 days)
  const rr = s.recent.rain.map((r) => ({ x: dayNum(r.date), r }));
  const recentRain = chart({
    width: panelW(), height: 180, yMin: 0, yFmt: (v) => v.toFixed(1),
    series: [{ type: "bar", points: rr.map(({ x, r }) => ({ x, y: r.rain_in ?? 0, color: r.src.startsWith("Coal") ? COLORS.sage : css("--color-accent"), title: `${day(r.date)}: ${(r.rain_in ?? 0).toFixed(2)} in (${r.src})` })) }],
    xTicks: everyN(rr.map((p) => p.x), 7), xFmt: shortDay,
  });

  // --- tides (72 h observed + predicted +/- 3 days)
  // Pacific clock time as hours since epoch (treating local time as UTC), so local
  // midnights fall on multiples of 24
  const tParse = (t) => Date.parse(t.replace(" ", "T") + "Z") / 3600000;
  const localH = (utcIso) => tParse(new Date(utcIso).toLocaleString("sv-SE", { timeZone: tz }).slice(0, 16));
  const midnights = (xs) => { const a = Math.min(...xs), b = Math.max(...xs), out = []; for (let h = Math.ceil(a / 24) * 24; h <= b; h += 24) out.push(h); return out; };
  const localDayLabel = (h) => new Date(h * 3600000).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", day: "numeric" });
  const nowH = tParse(new Date().toLocaleString("sv-SE", { timeZone: tz }).slice(0, 16));
  const td = s.recent.tides;
  const tideChart = td ? chart({
    width: panelW(), height: 190, yMin: -2, yMax: 8, yFmt: (v) => v.toFixed(0),
    series: [
      { type: "line", color: COLORS.mist, width: 2, points: td.predicted.map((p) => ({ x: tParse(p.t), y: p.ft })) },
      { type: "line", color: css("--color-accent"), width: 2.2, points: td.observed.map((p) => ({ x: tParse(p.t), y: p.ft })) },
    ],
    xTicks: midnights(td.predicted.map((p) => tParse(p.t))), xFmt: localDayLabel, now: nowH,
  }) : `<p class="muted">Tide data unavailable.</p>`;
  const nextTides = (td?.hilo || []).filter((p) => tParse(p.t) >= nowH).slice(0, 4);

  // --- waves
  const wv = s.recent.waves;
  const waveChart = wv?.series?.length ? chart({
    width: panelW(), height: 190, yMin: 0, yFmt: (v) => v.toFixed(0),
    series: [{ type: "line", color: COLORS.mesa, width: 2.2, points: wv.series.map((p) => ({ x: localH(p.t), y: p.hs_ft })) }],
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
    width: fullW(), height: 170, yMin: Math.floor(Math.min(...lh.map((h) => h.ft)) - 0.3), yMax: Math.ceil(Math.max(...lh.map((h) => h.ft)) + 0.3), yFmt: (v) => v.toFixed(1),
    series: [{ type: "line", color: css("--color-accent"), width: 2, points: lh.map((h) => ({ x: localH(new Date(h.t).toISOString()), y: h.ft })) }],
    xTicks: midnights(lh.map((h) => localH(new Date(h.t).toISOString()))), xFmt: localDayLabel, now: nowH,
  }) : "";

  const srcEntries = Object.entries(s.sources);
  const sources = srcEntries.map(([k, v]) =>
    `<span class="${v.ok ? "" : "down"}" title="${esc(v.ok ? "updated " + v.at : v.error + (v.stale_from ? ", showing data from " + v.stale_from : ""))}">${esc(k.replace(/_/g, " "))}${v.ok ? "" : v.stale_from ? " (stale)" : " (down)"}</span>`).join(", ");

  app.innerHTML = `
  <section class="head">
    <div aria-live="polite">
      <h1><span class="dot" style="background:${headColor}" aria-hidden="true"></span>${headline}</h1>
      ${p48 != null ? `<p class="lead">Next 48 hours: <strong>${band48.label}</strong>. ${levelMeaning(band48, s.model?.levels_record)}</p>` : ""}
      ${windowLine ? `<p class="window">${windowLine}</p>` : ""}
      <p class="outlook">${outlook}</p>
      ${lead ? `<p class="outlook">${lead}</p>` : ""}
      <dl class="readings">${readings.map(([l, v, n]) => `<dt>${esc(l)}</dt><dd>${esc(v)}${n ? `<small>${esc(n)}</small>` : ""}</dd>`).join("")}</dl>
    </div>
    <div class="head-sign">
    <div class="sign">
      <figure class="crow"><img src="media/crow/devereux-crow.webp" width="560" height="521" alt="The Devereux Crow, a cartoon crow with binoculars, a field bag, a map, and a surfboard, waving in front of the slough." /><figcaption>Devereux Crow wants you to know...</figcaption></figure>
      <div class="sign-dial">
        <p class="sign-title">${!open && peak && band48 ? `<strong class="sign-level">${band48.label}</strong> ` : ""}Breach likelihood</p>
        <p class="sign-sub">${open ? "Mouth open" : "Next 48 hours"}</p>
        ${dialSvg(p48, open || !peak)}
        <p class="sign-read">${open ? "The slough is tidal. The watch starts again when the berm closes."
          : !peak ? "No outlook right now."
          : `Next 10 days: ${bandOf(peak.p).label} at most, ${day(peak.date).replace(/ /g, "\u00a0")}.`}</p>
      </div>
    </div>
    </div>
  </section>

  ${s.warnings.length ? s.warnings.map((w) => `<p class="warn">${esc(w)}</p>`).join("") : ""}

  <section class="block" id="level">
    <div class="sec-head">
      <h2>Slough water level</h2>
      <div class="controls" role="group" aria-label="Chart options">${["3m", "1y", "all", "custom"].map((k) => `<button type="button" data-range="${k}" aria-pressed="${k === levelRange}">${{ "3m": "3 months", "1y": "1 year", all: "Since 2018", custom: "Custom" }[k]}</button>`).join("")}<span class="sep" aria-hidden="true"></span><button type="button" data-rain aria-pressed="${showRain}">Show daily rain</button><button type="button" data-tide aria-pressed="${showTide}">Show tide</button></div>
    </div>
    <div class="custom-range" id="custom-range" ${levelRange === "custom" ? "" : "hidden"}>
      <label>From <input type="date" id="range-from" min="2018-10-01" max="${lastDay}" value="${customFrom}" /></label>
      <label>to <input type="date" id="range-to" min="2018-10-01" max="${lastDay}" value="${customTo}" /></label>
    </div>
    ${legend([[css("--color-text"), "measured (loggers and live sensor)", "line"], [COLORS.ochre, "staff gauge readings"], [css("--color-accent"), "forecast", "dash"], [css("--color-accent") + "44", "forecast range"], [COLORS.clay + "33", "where past breaches happened"], [COLORS.clay, "breach level, this closure", "dash"], [css("--breach"), "breach", "line"]])}
    <div id="rain-legend">${showRain ? rainLegend() : ""}</div>
    <div id="tide-legend">${showTide && TIDES ? tideLegend() : ""}</div>
    <div id="level-chart">${levelChart}</div>
    <p class="note" id="live-note">${liveNote(s)}</p>
    ${s.stage?.series?.length ? `<p class="after">${levelSummary(s)}</p>` : ""}
    <p class="intro" style="margin-top:var(--space-3)">Daily means from CCBER's water-level loggers (2018 to 2025) and the UC Davis / State Parks live sensor (2025 on), re-leveled to the weekly staff gauge at Venoco Bridge. From the latest reading on, the level rolls forward with a rain-driven water balance, using observed rain up to today and forecast rain after. The forecast range covers half to 1.5 times the forecast rain plus the model's typical error. The pale band spans the levels where berms closed for months have breached (${BLV ? `${BLV.mature_min_ft.toFixed(1)} to ${BLV.mature_max_ft.toFixed(1)} ft, ${BLV.mature_n} breaches since 2019` : "past breaches"}); the dashed line is the estimate for the current closure, lower while the berm is young. Feet, NAVD88.</p>
  </section>

  <section class="block" id="watch">
    <h2>Breach Watch</h2>
    ${open ? "" : `
    <p class="intro" style="margin-top:var(--space-8)">Each day's level comes from how far the slough sits below the berm's crest, which rebuilds after every closure, and from rain on the watershed. Faded bars are the past two weeks, scored with observed rain; solid bars use forecast rain, which updates through the day.</p>
    <div class="split">
      <div>
        ${legend(BANDS.map((b) => [b.color, b.key === "low" ? b.label : `${b.label}: ${b.caught} of ${s.model?.levels_record?.breaches ?? 10} breaches reached it`]))}
        ${probChart}
        <h3 style="margin:var(--space-6) 0 0">Rain, inches per day</h3>
        ${legend([[css("--color-accent"), "observed"], [COLORS.mist, "forecast (Open-Meteo)"]])}
        ${rainChart}
      </div>
      <div class="table-scroll"><table class="days">
        <thead><tr><th>Day</th><th>Rain, in</th><th>Slough, ft</th><th>Breach level</th><th>Below it</th><th>Level</th></tr></thead>
        <tbody>${ahead.map((r) => `<tr class="${r.date === s.today ? "today" : ""}"><td>${r.date === s.today ? "Today" : day(r.date)}</td><td>${(r.rain_in ?? 0).toFixed(2)}</td><td>${r.stage_ft?.toFixed(2) ?? "n/a"}</td><td>${r.breach_level_ft.toFixed(1)}</td><td>${r.below_breach_ft == null ? "n/a" : r.below_breach_ft.toFixed(2)}</td><td class="${r.p >= 0.5 ? "likely" : ""}">${bandOf(r.p).label}</td></tr>`).join("")}</tbody>
      </table></div>
    </div>`}
  </section>

  <section class="block" id="alerts-section" hidden>
    <h2>Get an alert before it breaches</h2>
    <div id="alerts-slot"></div>
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
        ${legend([[COLORS.sage, "Coal Oil Point gauge"], [css("--color-accent"), "airport and local CoCoRaHS gauges"]])}
        ${recentRain}
        <p class="note">Water year to date: <span class="num">${s.recent.season_rain_in.toFixed(2)} in</span></p>
      </div>
      <div>
        <h3>Mouth history</h3>
        <ul class="plain">${(s.mouth?.recent_events || []).map((e) => `<li><span>${e.state === "open" ? "Breached" : "Closed"}</span><span class="num muted">${day(e.date, { month: "short", day: "numeric", year: "numeric" })}</span></li>`).join("")}</ul>
      </div>
      <div>
        <h3>Ocean level, Santa Barbara</h3>
        ${legend([[css("--color-accent"), "observed", "line"], [COLORS.mist, "predicted tide", "line"]])}
        ${tideChart}
        <ul class="plain">${nextTides.map((p) => `<li><span>${p.type === "H" ? "High" : "Low"}, ${new Date(p.t.replace(" ", "T")).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}</span><span class="num">${p.ft.toFixed(1)} ft</span></li>`).join("")}</ul>
        <p class="note">NOAA station 9411340.</p>
      </div>
      <div>
        <h3>Waves, ${esc(wv?.station || "Harvest buoy")}</h3>
        ${legend([[COLORS.mesa, "significant wave height, ft (left)", "line"], [COLORS.ochre, "dominant period, s (right)"]])}
        ${waveChart}
        ${wv?.latest ? `<p class="note">Latest <span class="num">${wv.latest.hs_ft.toFixed(1)} ft</span> at <span class="num">${wv.latest.period_s ?? "?"} s</span> from <span class="num">${wv.latest.dir_deg ?? "?"}°</span>, ${new Date(wv.latest.t).toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" })}.</p>` : ""}
      </div>
    </div>
  </section>

  <section class="block" id="satellite">
    <h2>The mouth from space</h2>
    ${framesHtml()}
  </section>

  <section class="block" id="gallery">
    <h2>The November 15, 2025 breach</h2>
    <p class="intro">A 5-inch storm raised the slough from 5.7 to about 9.4 ft over two and a half days. Late on the afternoon of November 15 water began running over the berm and cut a channel, and by dark the slough was pouring into the ocean; the live sensor shows it dropping almost 5 ft in six hours. Photos and muted video from that afternoon and evening, in order.</p>
    <div class="gallery">${GALLERY.map((g, i) => `<button type="button" data-gallery="${i}" aria-label="${esc(g.alt)}"><span class="ph"><img src="${MEDIA}${g.thumb}" alt="" loading="lazy" decoding="async" />${g.video ? `<span class="play" aria-hidden="true"><svg viewBox="0 0 10 12"><path d="M0 0L10 6L0 12Z"/></svg></span>` : ""}</span>${esc(g.time)}${g.video ? `, video ${g.video}` : ""}</button>`).join("")}</div>
  </section>

  <section class="block" id="how">
    <h2>How this works</h2>
    <div class="prose">
      <p>The slough fills with rain and the runoff it sends down from the roughly 2.5-square-mile watershed, and the berm breaches when the water tops it. The slough level comes from the live water-level sensor (yesterday's average), or from the latest weekly staff-gauge reading if the sensor is down. Future days roll that level forward with forecast rain and runoff, at about 0.7 ft of rise per inch of rain on past storms, a little less when the slough is already full.</p>
      <p>Each day gets a score from a logistic model of two things: <strong>how far below the top of the berm the slough sits</strong>, and <strong>how much rain is falling</strong> (that day, the last three days, and how wet the watershed already is). The berm's height isn't measured. The model estimates it as low right after a closure (about ${s.model.crest.c0.toFixed(1)} ft) and rebuilding over a couple of months as waves pile sand back up, levelling off near ${s.model.crest.c_inf.toFixed(1)} ft. A newly closed berm is never lower than the water it was holding back. That is why a young berm can break at a much lower level than a mature one. The model was chosen by testing every combination of up to five rain, level and berm-age inputs on the seasons with a measured water level${s.model.levels_record?.excluded?.length ? ` (breaches without one, ${s.model.levels_record.excluded.map((d) => day(d, { month: "short", day: "numeric", year: "numeric" })).join(", ")}, were left out)` : ""}. With no usable level reading, the page falls back to a rain-only model.</p>
      <p>The score ranks risk well but, with ${s.model.levels_record?.breaches ?? 10} recorded breaches, isn't a dependable percentage, so the page reports levels. Their cutoffs come from predicting each season with a model trained only on the others: ${BANDS.filter((b) => b.key !== "low").map((b) => `${b.label}, reached before ${b.caught} of ${s.model.levels_record?.breaches ?? 10} breaches, with ${b.false_alarm_episodes ? `${b.false_alarm_episodes} false-alarm episode${b.false_alarm_episodes > 1 ? "s" : ""}` : "no false alarms"}`).join("; ")}. Alerts go out at Watch. A breach counts as flagged if the level was reached that day or the day before, since runoff can take a day to arrive. Tides and waves are shown for context; they don't drive breaches here.</p>
      <p>Limits: the current slough level is measured (the UC Davis sensor reports every 5 minutes; this page uses hourly averages), but the next 10 days are a forecast, and a single storm's rise can miss by about 0.4 ft either way. Forecast rain comes from a weather model that can miss local totals by a factor of two. The mouth state comes from CCBER's log, updated by the live sensor within hours of a breach or closure; if the sensor is down, the page relies on the log, which can lag by days.</p>
    </div>
    <p class="sources">Sources: <a href="https://github.com/ccber-restoration/hydrology">CCBER hydrology data</a> (mouth log, staff gauge), <a href="https://coastalocean.ucdavis.edu/ocean-observing/flooding/devereux-slough">UC Davis / State Parks sensor</a>, <a href="https://www.ncei.noaa.gov/">NOAA NCEI</a> Coal Oil Point gauge, <a href="https://www.cocorahs.org/">CoCoRaHS</a>, <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a> (KSBA), <a href="https://open-meteo.com/">Open-Meteo</a>, <a href="https://tidesandcurrents.noaa.gov/stationhome.html?id=9411340">NOAA tides</a>, <a href="https://www.ndbc.noaa.gov/station_page.php?station=46218">NDBC 46218</a>, <a href="https://dataspace.copernicus.eu/">Copernicus Sentinel-2</a>, <a href="https://naip-usdaonline.hub.arcgis.com/">USDA NAIP</a>.<br/>
    Live feeds: ${sources}. Updated ${new Date(s.generated_at).toLocaleString("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" })} Pacific. Model fit ${esc(s.model.exported)}.</p>
  </section>`;
  // the alerts form lives outside #app (it keeps its state); slot it in
  const card = document.getElementById("alerts"), slot = document.getElementById("alerts-slot");
  if (card && slot) { slot.appendChild(card); document.getElementById("alerts-section").hidden = card.hidden; }
}

// ------------------------------------------------------------- breach gallery (Nov 15, 2025)
const MEDIA = "media/breach-2025-11-15/";
const GALLERY = [
  { file: "IMG_3006.jpg", thumb: "IMG_3006-thumb.jpg", time: "3:54 PM", alt: "Sands Beach and the dunes above the slough mouth under storm haze, with surf and the Ellwood bluffs beyond.", caption: "3:54 PM. Storm haze over Sands Beach and the dunes above the slough mouth." },
  { file: "IMG_3007.mp4", thumb: "IMG_3007-poster-thumb.jpg", poster: "IMG_3007-poster.jpg", video: "0:11", time: "3:59 PM", alt: "Video: the sand berm, with the ocean on the left and the brimming slough on the right.", caption: "3:59 PM. The berm, with the ocean on the left and the full slough on the right." },
  { file: "IMG_3008.jpg", thumb: "IMG_3008-thumb.jpg", time: "4:00 PM", alt: "The beach at the mouth strewn with kelp, slough water pooling on the sand, people gathering in the distance.", caption: "4:00 PM. Slough water pooling across the beach as people start to gather." },
  { file: "IMG_3009.jpg", thumb: "IMG_3009-thumb.jpg", time: "4:00 PM", alt: "Wider view of the kelp-strewn beach and the dunes, with small groups of people near the water.", caption: "4:00 PM. Waiting on the berm." },
  { file: "GGC_1901.jpg", thumb: "GGC_1901-thumb.jpg", time: "4:11 PM", alt: "Two snowy egrets standing in shallow water at the slough's edge.", caption: "4:11 PM. Snowy egrets working the edge of the swollen slough." },
  { file: "GGC_1910.jpg", thumb: "GGC_1910-thumb.jpg", time: "4:15 PM", alt: "A small pale sandpiper, likely a sanderling, probing wet sand and pebbles.", caption: "4:15 PM. A small sandpiper (likely a sanderling) feeding in the wet sand." },
  { file: "GGC_1911.jpg", thumb: "GGC_1911-thumb.jpg", time: "4:15 PM", alt: "Close view of the same sandpiper with its bill in the sand.", caption: "4:15 PM. The same bird, head down." },
  { file: "IMG_3012.jpg", thumb: "IMG_3012-thumb.jpg", time: "4:36 PM", alt: "Four people in rain jackets standing on the berm beside a thin channel of water running toward the ocean.", caption: "4:36 PM. The first trickle cuts across the berm." },
  { file: "IMG_1627.mp4", thumb: "IMG_1627-poster-thumb.jpg", poster: "IMG_1627-poster.jpg", video: "0:33", time: "4:43 PM", alt: "Video: water spreading in a sheet across the beach toward the surf while two people watch.", caption: "4:43 PM. Slough water sheeting across the beach to the surf." },
  { file: "IMG_3013.mp4", thumb: "IMG_3013-poster-thumb.jpg", poster: "IMG_3013-poster.jpg", video: "1:05", time: "4:43 PM", alt: "Video: a shallow stream crossing the wide beach, with people standing along it.", caption: "4:43 PM. The outflow finds its path across the sand." },
  { file: "IMG_1631.jpg", thumb: "IMG_1631-thumb.jpg", time: "5:11 PM", alt: "A group of people on the berm at dusk beside the widening channel.", caption: "5:11 PM. Dusk, and the channel is widening." },
  { file: "IMG_3015.jpg", thumb: "IMG_3015-thumb.jpg", time: "5:28 PM", alt: "Silhouettes of three people watching dark water rush past against a fading sky.", caption: "5:28 PM. Watching the slough drain in the last light." },
  { file: "IMG_3019.mp4", thumb: "IMG_3019-poster-thumb.jpg", poster: "IMG_3019-poster.jpg", video: "0:14", time: "5:41 PM", alt: "Video after dark: fast, churning water rushing through the breach channel.", caption: "5:41 PM. Full flow through the breach after dark." },
  { file: "IMG_3022.jpg", thumb: "IMG_3022-thumb.jpg", time: "5:45 PM", alt: "Two people silhouetted on the bank of a deep channel cut through the berm, water pouring out under a glowing overcast sky.", caption: "5:45 PM. The channel cut through the berm." },
  { file: "IMG_2389.mp4", thumb: "IMG_2389-poster-thumb.jpg", poster: "IMG_2389-poster.jpg", video: "0:15", time: "6:04 PM", alt: "Video at night: standing waves in the breach channel as the slough empties into the ocean.", caption: "6:04 PM. Standing waves as the slough empties into the sea." },
];

let lbIndex = 0;
function showLightbox(i) {
  const dlg = document.getElementById("lightbox");
  lbIndex = (i + GALLERY.length) % GALLERY.length;
  const g = GALLERY[lbIndex];
  const media = document.getElementById("lb-media");
  media.querySelector("video")?.pause();
  media.innerHTML = g.video
    ? `<video src="${MEDIA}${g.file}" poster="${MEDIA}${g.poster}" controls muted playsinline autoplay preload="metadata" aria-label="${esc(g.alt)}"></video>`
    : `<img src="${MEDIA}${g.file}" alt="${esc(g.alt)}" />`;
  document.getElementById("lb-caption").textContent = `${g.caption} (${lbIndex + 1} of ${GALLERY.length})`;
  if (!dlg.open) dlg.showModal();
}
function initGallery() {
  const dlg = document.getElementById("lightbox");
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-gallery]");
    if (t) showLightbox(Number(t.dataset.gallery));
  });
  document.getElementById("lb-prev").onclick = () => showLightbox(lbIndex - 1);
  document.getElementById("lb-next").onclick = () => showLightbox(lbIndex + 1);
  document.getElementById("lb-close").onclick = () => dlg.close();
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // click on backdrop
  dlg.addEventListener("close", () => { document.getElementById("lb-media").innerHTML = ""; });
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") showLightbox(lbIndex - 1);
    if (e.key === "ArrowRight") showLightbox(lbIndex + 1);
  });
}

// ------------------------------------------------------------- breach alerts (push + email)
const b64ToBytes = (b64) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const post = (path, body) => fetch(`/devereux/api/alerts/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  .then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }));

async function initAlerts() {
  const card = document.getElementById("alerts");
  let cfg;
  try { cfg = await fetch("/devereux/api/alerts/config").then((r) => r.json()); } catch { return; }
  if (!cfg.push?.enabled && !cfg.email?.enabled) return; // nothing set up yet
  card.hidden = false;
  const sec = document.getElementById("alerts-section"); if (sec) sec.hidden = false;

  // banner after confirming/unsubscribing by email link
  const q = new URLSearchParams(location.search).get("alerts");
  const emailNote = document.getElementById("email-note");
  if (q) {
    emailNote.textContent = { confirmed: "You're signed up. You'll get an email when the Breach Watch reaches Watch.", unsubscribed: "You're unsubscribed. No more emails.", invalid: "That link didn't work. Try signing up again." }[q] || "";
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

async function load() {
  try {
    const [r, h] = await Promise.all([fetch("/devereux/api/status"), fetch("stage-history.json").catch(() => null)]);
    if (!r.ok) throw new Error(r.status);
    if (h?.ok) HISTORY = await h.json();
    const s = await r.json();
    // keep the newer of the status's latest reading and the last live poll
    if (LIVE.length && s.stage && LIVE.at(-1).t > (s.stage.sensor_now?.t ?? 0)) s.stage.sensor_now = LIVE.at(-1);
    window.__devereux = s;
    render(s);
    if (!window.__alertsInit) { window.__alertsInit = true; initAlerts(); initGallery(); }
  } catch (e) {
    app.innerHTML = `<div class="loading">Couldn't load the slough data (${esc(e.message)}). Try again in a minute.</div>`;
  }
}
load().then(pollLive);
// re-render charts on theme change so axis colors follow
new MutationObserver(() => window.__devereux && render(window.__devereux)).observe(document.body, { attributes: true, attributeFilter: ["class"] });
