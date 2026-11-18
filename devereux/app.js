// Devereux Slough breach outlook page. Fetches /devereux/api/status (see
// netlify/functions/devereux-api.mjs) and draws everything with inline SVG.

const app = document.getElementById("app");
const PCT = (p) => (p == null ? "n/a" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);
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
function chart({ series, width = 680, height = 200, yMin = 0, yMax, yFmt = (v) => v, xTicks, xFmt, now, bands = [], hlines = [], vlines = [], xMin, xMax }) {
  const W = width, H = height, m = { l: 40, r: 12, t: 10, b: 24 };
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
const legend = (items) => `<div class="legend">${items.map(([c, l, line]) => `<span><i class="${line ? "line" : ""}" style="background:${c}"></i>${esc(l)}</span>`).join("")}</div>`;
const dayNum = (iso) => Date.parse(`${iso}T12:00:00Z`) / 86400000;
const everyN = (arr, n) => arr.filter((_, i) => i % n === 0);
// evenly spaced day ticks (every `step` days) across [a, b]
const dayTicks = (a, b, step) => { const out = []; for (let x = Math.ceil(a); x <= b; x += step) out.push(x); return out; };
const shortDay = (x) => day(new Date(x * 86400000).toISOString().slice(0, 10), { month: "short", day: "numeric" });

// ------------------------------------------------------------- slough level time series
let HISTORY = null; // stage-history.json: re-leveled daily record (static, from the Python project)
let levelRange = "3m";

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

function levelChartSvg(s, range) {
  const nowX = dayNum(s.today);
  const series = s.stage?.series || [];
  const end = series.length ? dayNum(series.at(-1).date) : nowX + 9;
  const start = range === "3m" ? nowX - 90 : range === "1y" ? nowX - 365 : dayNum("2018-10-01");
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
    ...series.flatMap((r) => [r.lo, r.hi, r.crest_ft]).filter((v) => v != null)];
  const yMin = Math.floor(Math.min(...ys, 4) - 0.3), yMax = Math.ceil(Math.max(...ys, 8) + 0.3);
  const breaches = (HISTORY?.breaches || []).map(dayNum).filter(vis);
  const mid = series.map((r) => ({ x: dayNum(r.date), y: r.ft, phase: r.phase }));
  const span = end - start;
  return chart({
    height: 260, xMin: start, xMax: end, yMin, yMax, yFmt: (v) => v.toFixed(0),
    series: [
      { type: "band", color: css("--color-accent"), opacity: 0.18, points: series.map((r) => ({ x: dayNum(r.date), lo: r.lo, hi: r.hi })) },
      { type: "line", color: css("--color-text"), width: span > 400 ? 1 : 1.6, gap: 2, opacity: 0.85, points: loggers.map((r) => ({ x: r.x, y: r.ft })) },
      { type: "line", color: COLORS.clay, width: 1.8, dash: "5 4", points: series.map((r) => ({ x: dayNum(r.date), y: s.mouth?.state === "open" ? null : r.crest_ft })) },
      { type: "line", color: css("--color-accent"), width: 2.5, points: mid.filter((p) => p.phase !== "forecast") },
      { type: "line", color: css("--color-accent"), width: 2.5, dash: "6 4", points: mid.filter((p, i) => p.phase === "forecast" || (mid[i + 1] && mid[i + 1].phase === "forecast")) },
      { type: "dots", color: COLORS.ochre, r: span > 400 ? 2.2 : 3.8, points: dots },
    ],
    vlines: breaches.map((x) => ({ x, color: "#E07B39" })),
    xTicks: span <= 120 ? dayTicks(start, end, 14) : span <= 400 ? monthTicks(start, end, 2) : monthTicks(start, end, 12),
    xFmt: (x) => span <= 400 ? shortDay(x) : String(new Date(x * 86400000).getUTCFullYear()),
    now: nowX,
  });
}

function levelSummary(s) {
  const f = s.stage.series.filter((r) => r.phase === "forecast");
  const last = f.at(-1);
  if (!last) return "";
  const r = s.stage.latest_reading;
  return `Latest reading ${r.ft.toFixed(2)} ft on ${day(r.date, { month: "short", day: "numeric" })}. `
    + `By ${day(last.date, { weekday: "short", month: "short", day: "numeric" })} the slough is forecast at about ${last.ft.toFixed(1)} ft `
    + `(range ${last.lo.toFixed(1)} to ${last.hi.toFixed(1)} ft)` + (last.crest_ft != null && s.mouth?.state !== "open" ? `, against a berm crest near ${last.crest_ft.toFixed(1)} ft.` : ".");
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-range]");
  if (!b || !window.__devereux) return;
  levelRange = b.dataset.range;
  document.querySelectorAll("[data-range]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  document.getElementById("level-chart").innerHTML = levelChartSvg(window.__devereux, levelRange);
});

// ------------------------------------------------------------- render
function render(s) {
  const open = s.mouth?.state === "open";
  const todayRow = s.outlook.find((r) => r.date === s.today);
  const ahead = s.outlook.filter((r) => r.date >= s.today);
  const peak = s.peak;
  const level = open || !peak ? "na" : peak.alert;
  const levelLabel = open ? "Mouth open" : peak ? LEVEL_TEXT[peak.alert] : "Unavailable";
  const stateColor = open ? COLORS.sky : COLORS.sage;

  let sentence;
  if (!s.mouth) sentence = "The mouth-state record couldn't be loaded, so there is no outlook right now.";
  else if (open) sentence = `The berm is open and the slough is tidal. This page forecasts breaches of a closed berm, so there is no outlook until the mouth closes again.`;
  else if (!peak) sentence = "There is no recent slough-level reading this water year, so the outlook is off.";
  else {
    // Closest the slough is forecast to come to the crest in the next 10 days, after
    // runoff from the whole watershed has drained in (not just on the rain day).
    const f = (s.stage?.series || []).filter((r) => r.date >= s.today && r.crest_ft != null);
    const near = f.reduce((m, r) => (m == null || r.crest_ft - r.ft < m.crest_ft - m.ft ? r : m), null);
    const nearHi = f.reduce((m, r) => Math.min(m, r.crest_ft - r.hi), Infinity);
    sentence = `Highest chance in the next 10 days is ${PCT(peak.p)} on ${day(peak.date)}`
      + (peak.rain_in >= 0.1 ? `, with ${peak.rain_in.toFixed(2)} in of rain forecast that day.` : ".")
      + (near ? ` At its highest, around ${day(near.date, { month: "short", day: "numeric" })}, the slough is forecast about ${(near.crest_ft - near.ft).toFixed(1)} ft below the estimated berm crest`
        + (Number.isFinite(nearHi) ? ` (${nearHi > 0 ? `${nearHi.toFixed(1)} ft below` : "at or above it"} if rain runs heavy).` : ".") : "");
  }

  const tiles = [
    [s.stage?.today_est_ft != null ? FT(s.stage.today_est_ft, 2) : "n/a", "Slough level today (est., NAVD88)"],
    [s.stage?.crest_today_ft != null && !open ? FT(s.stage.crest_today_ft) : "n/a", "Estimated berm crest"],
    s.stage?.sensor_now
      ? [FT(s.stage.sensor_now.ft, 2), `Live sensor, ${new Date(s.stage.sensor_now.t).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`]
      : [s.stage?.latest_reading ? FT(s.stage.latest_reading.ft, 2) : "n/a", s.stage?.latest_reading ? `Staff gauge, ${day(s.stage.latest_reading.date, { month: "short", day: "numeric" })}` : "Latest staff gauge"],
    [`${s.recent.season_rain_in.toFixed(2)} in`, `Rain since Oct 1 (water year ${s.today.slice(0, 4) * 1 + (s.today.slice(5, 7) >= "10" ? 1 : 0)})`],
  ];

  // --- outlook chart: past 14 days observed + 10-day forecast
  const nowX = dayNum(s.today);
  const pts = s.outlook.map((r) => ({ x: dayNum(r.date), r }));
  const probChart = chart({
    height: 190, yMin: 0, yMax: 1, yFmt: (v) => `${Math.round(v * 100)}%`,
    series: [{
      type: "bar", points: pts.map(({ x, r }) => ({
        x, y: Math.max(r.p, 0.004), color: r.alert === "likely" ? COLORS.clay : r.alert === "watch" ? COLORS.ochre : COLORS.sky,
        opacity: r.observed ? 0.45 : 1, title: `${day(r.date)}: ${PCT(r.p)}` + (r.margin_ft == null ? " (rain only)" : `, slough ${Math.abs(r.margin_ft).toFixed(1)} ft ${r.margin_ft < 0 ? "below" : "above"} the crest, ${(r.rain_in ?? 0).toFixed(2)} in rain`),
      })),
    }],
    hlines: [{ y: 0.5, color: COLORS.clay, label: "likely" }, { y: 0.2, color: COLORS.ochre, label: "watch" }],
    xTicks: everyN(pts.map((p) => p.x), 3), xFmt: (x) => day(new Date(x * 86400000).toISOString().slice(0, 10), { month: "short", day: "numeric" }), now: nowX - 0.5,
  });
  const rainChart = chart({
    height: 130, yMin: 0, yFmt: (v) => v.toFixed(1),
    series: [{ type: "bar", points: pts.map(({ x, r }) => ({ x, y: r.rain_in ?? 0, color: r.observed ? COLORS.sky : COLORS.mist, title: `${day(r.date)}: ${(r.rain_in ?? 0).toFixed(2)} in (${r.rain_src})` })) }],
    xTicks: everyN(pts.map((p) => p.x), 3), xFmt: (x) => day(new Date(x * 86400000).toISOString().slice(0, 10), { month: "short", day: "numeric" }), now: nowX - 0.5,
  });

  const levelChart = levelChartSvg(s, levelRange);

  // --- recent rain (30 days)
  const rr = s.recent.rain.map((r) => ({ x: dayNum(r.date), r }));
  const recentRain = chart({
    width: 420, height: 170, yMin: 0, yFmt: (v) => v.toFixed(1),
    series: [{ type: "bar", points: rr.map(({ x, r }) => ({ x, y: r.rain_in ?? 0, color: r.src.startsWith("Coal") ? COLORS.sage : COLORS.sky, title: `${day(r.date)}: ${(r.rain_in ?? 0).toFixed(2)} in (${r.src})` })) }],
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
    width: 420, height: 190, yMin: -2, yMax: 8, yFmt: (v) => v.toFixed(0),
    series: [
      { type: "line", color: COLORS.mist, width: 2, points: td.predicted.map((p) => ({ x: tParse(p.t), y: p.ft })) },
      { type: "line", color: COLORS.sky, width: 2.5, points: td.observed.map((p) => ({ x: tParse(p.t), y: p.ft })) },
    ],
    xTicks: midnights(td.predicted.map((p) => tParse(p.t))), xFmt: localDayLabel, now: nowH,
  }) : `<p class="muted">Tide data unavailable.</p>`;
  const nextTides = (td?.hilo || []).filter((p) => tParse(p.t) >= nowH).slice(0, 4);

  // --- waves
  const wv = s.recent.waves;
  const waveChart = wv?.series?.length ? chart({
    width: 420, height: 190, yMin: 0, yFmt: (v) => v.toFixed(0),
    series: [{ type: "line", color: COLORS.mesa, width: 2.5, points: wv.series.map((p) => ({ x: localH(p.t), y: p.hs_ft })) }],
    xTicks: midnights(wv.series.map((p) => localH(p.t))), xFmt: localDayLabel, now: nowH,
  }) : `<p class="muted">Wave data unavailable.</p>`;

  // --- live sensor, hourly, last 7 days
  const lh = s.stage?.sensor_hourly || [];
  const liveChart = lh.length ? chart({
    height: 170, yMin: Math.floor(Math.min(...lh.map((h) => h.ft)) - 0.3), yMax: Math.ceil(Math.max(...lh.map((h) => h.ft)) + 0.3), yFmt: (v) => v.toFixed(1),
    series: [{ type: "line", color: css("--color-accent"), width: 2.2, points: lh.map((h) => ({ x: localH(new Date(h.t).toISOString()), y: h.ft })) }],
    xTicks: midnights(lh.map((h) => localH(new Date(h.t).toISOString()))), xFmt: localDayLabel, now: nowH,
  }) : "";

  const sources = Object.entries(s.sources).map(([k, v]) =>
    `<span class="chip ${v.ok ? "" : "bad"}" title="${esc(v.ok ? "updated " + v.at : v.error + (v.stale_from ? ", showing data from " + v.stale_from : ""))}">${esc(k.replace(/_/g, " "))}${v.ok ? "" : v.stale_from ? " (stale)" : " (down)"}</span>`).join("");

  app.innerHTML = `
  <section class="hero">
    <div>
      <p class="eyebrow">Devereux Slough · Coal Oil Point Reserve · Goleta, CA</p>
      <h1 style="margin-top:var(--space-3)"><span class="state-dot" style="background:${stateColor}"></span>Mouth ${s.mouth ? esc(s.mouth.state) : "unknown"}</h1>
      ${s.mouth ? `<p class="lede">Since ${day(s.mouth.since, { month: "long", day: "numeric", year: "numeric" })} (${s.mouth.days} days), per the ${esc(s.mouth.source)}.</p>` : ""}
      <p class="lede muted small">The slough fills with winter rain behind a sand berm until it breaks through to the ocean. This page estimates the chance of that happening each day for the next 10 days.</p>
    </div>
    <div class="outlook" aria-live="polite">
      <p class="eyebrow">Breach outlook · next 10 days</p>
      <div style="margin-top:var(--space-3)"><span class="level ${level}">${esc(levelLabel)}</span></div>
      ${!open && peak ? `<div class="big">${PCT(peak.p)}</div><p class="muted small" style="margin:0">peak daily chance · today ${PCT(todayRow?.p)}</p>` : ""}
      <p>${sentence}</p>
    </div>
  </section>

  <section class="tiles">${tiles.map(([v, l]) => `<div class="tile"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join("")}</section>

  ${s.warnings.length ? s.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join("") + "<br/>" : ""}

  ${open ? "" : `
  <section class="block">
    <h2>Daily breach chance</h2>
    <p class="muted small" style="margin-top:0">Faded bars are the past two weeks, scored with observed rain; solid bars use forecast rain. Each day's chance depends on how far the slough sits below the berm crest and how much rain falls.</p>
    <div class="chart-card">
      ${legend([[COLORS.sky, "low"], [COLORS.ochre, "watch (20% or more)"], [COLORS.clay, "likely (50% or more)"]])}
      ${probChart}
      <h3 style="margin:var(--space-4) 0 0">Rain, inches per day</h3>
      ${legend([[COLORS.sky, "observed"], [COLORS.mist, "forecast (Open-Meteo)"]])}
      ${rainChart}
    </div>
    <div class="table-scroll"><table class="days">
      <thead><tr><th>Day</th><th>Rain (in)</th><th>Slough (ft)</th><th>Crest (ft)</th><th>Below crest (ft)</th><th>Chance</th></tr></thead>
      <tbody>${ahead.map((r) => `<tr class="${r.date === s.today ? "today" : ""}"><td>${r.date === s.today ? "Today" : day(r.date)}</td><td>${(r.rain_in ?? 0).toFixed(2)}</td><td>${r.stage_ft?.toFixed(2) ?? "n/a"}</td><td>${r.crest_ft.toFixed(1)}</td><td>${r.margin_ft == null ? "n/a" : (-r.margin_ft).toFixed(2)}</td><td><strong>${PCT(r.p)}</strong></td></tr>`).join("")}</tbody>
    </table></div>
  </section>`}

  <section class="block">
    <h2>Slough water level</h2>
    <p class="muted small" style="margin-top:0">The dark line is the daily record from CCBER's water-level loggers (2018 to 2025) and the UC Davis / State Parks live sensor (2025 on), all re-leveled to the weekly staff gauge at Venoco Bridge (gold dots). From the latest reading on, the blue line rolls the level forward with a rain-driven water balance: observed rain up to today, then the rain forecast. The shaded range covers half to 1.5 times the forecast rain plus the model's typical error (80% of past cases). The dashed line is the estimated berm crest for the current closure, and orange lines mark past breaches. Feet, NAVD88.</p>
    <div class="chart-card">
      <div class="range-btns" role="group" aria-label="Time range">${["3m", "1y", "all"].map((k) => `<button type="button" data-range="${k}" aria-pressed="${k === levelRange}">${{ "3m": "3 months", "1y": "1 year", all: "All (2018 on)" }[k]}</button>`).join("")}</div>
      ${legend([[css("--color-text"), "logger and live-sensor record", true], [COLORS.ochre, "staff gauge / pier stick"], [css("--color-accent"), "estimated and forecast level", true], [css("--color-accent") + "44", "forecast range"], [COLORS.clay, "estimated berm crest", true], ["#E07B39", "breach", true]])}
      <div id="level-chart">${levelChart}</div>
      ${s.stage?.series?.length ? `<p class="muted small" style="margin:var(--space-2) 0 0">${levelSummary(s)}</p>` : ""}
    </div>
  </section>

  <section class="block">
    <h2>Recent conditions</h2>
    ${s.stage?.sensor_hourly?.length ? `<div class="chart-card" style="margin-bottom:var(--space-4)">
      <h3>Slough level, last 7 days (live sensor, hourly)</h3>
      ${legend([[css("--color-accent"), "water level, ft NAVD88 (staff-gauge datum)", true]])}
      ${liveChart}
      <p class="muted small">From the UC Davis Coastal Oceanography Group / California State Parks sensor (<a href="https://coastalocean.ucdavis.edu/ocean-observing/flooding/devereux-slough">source</a>). A sudden drop of more than 1.5 ft in a few hours means the berm has breached; the page then marks the mouth open without waiting for CCBER's log.</p>
    </div>` : ""}
    <div class="grid2">
      <div class="chart-card">
        <h3>Rain, last 30 days</h3>
        ${legend([[COLORS.sage, "Coal Oil Point gauge"], [COLORS.sky, "airport + local CoCoRaHS gauges"]])}
        ${recentRain}
        <p class="muted small">Water year to date: <span class="mono">${s.recent.season_rain_in.toFixed(2)} in</span></p>
      </div>
      <div class="chart-card">
        <h3>Mouth history</h3>
        <ul class="plain" style="margin-top:var(--space-2)">${(s.mouth?.recent_events || []).map((e) => `<li><span>${e.state === "open" ? "Breached (opened)" : "Closed"}</span><span class="mono muted">${day(e.date, { month: "short", day: "numeric", year: "numeric" })}</span></li>`).join("")}</ul>
      </div>
      <div class="chart-card">
        <h3>Ocean level, Santa Barbara (NOAA 9411340)</h3>
        ${legend([[COLORS.sky, "observed", true], [COLORS.mist, "predicted tide", true]])}
        ${tideChart}
        <ul class="plain">${nextTides.map((p) => `<li><span>${p.type === "H" ? "High" : "Low"} ${new Date(p.t.replace(" ", "T")).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}</span><span class="mono">${p.ft.toFixed(1)} ft</span></li>`).join("")}</ul>
      </div>
      <div class="chart-card">
        <h3>Waves, ${esc(wv?.station || "Harvest buoy")}</h3>
        ${legend([[COLORS.mesa, "significant wave height (ft)", true]])}
        ${waveChart}
        ${wv?.latest ? `<p class="muted small">Latest: <span class="mono">${wv.latest.hs_ft.toFixed(1)} ft</span> at <span class="mono">${wv.latest.period_s ?? "?"} s</span> from <span class="mono">${wv.latest.dir_deg ?? "?"}°</span>, ${new Date(wv.latest.t).toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" })}</p>` : ""}
      </div>
    </div>
  </section>

  <section class="block prose">
    <h2>How this works</h2>
    <p>Rain is the only thing that fills the slough, and the berm breaches when the water tops it. So the model asks two things each day: <strong>how far below the berm crest is the slough</strong>, and <strong>how much rain is falling</strong>, which drives the same-day rise that a daily estimate can lag. The slough level comes from the live water-level sensor (yesterday's average), or from the latest weekly staff-gauge reading if the sensor is down, rolled forward with rain. The berm crest is not measured; it is low right after a closure (about ${s.model.crest.c0.toFixed(1)} ft) and rebuilds over a couple of months toward about ${s.model.crest.c_inf.toFixed(1)} ft as waves pile sand back up. The crest curve and the weights were fit together on CCBER's record of 14 breaches from 2019 to 2026. With no usable reading (none since the last breach, or none in 45 days), the page falls back to a rain-only version.</p>
    <p>Predicting each season with a model trained on the others, and using only the weekly readings this page has, it flagged ${esc(s.model.skill.hits_p50)} breaches at the 50% level with ${s.model.skill.false_alarm_days_p50} false-alarm days over eight seasons (${esc(s.model.skill.hits_p20)} at 20%, with ${s.model.skill.false_alarm_days_p20}). A rain-only version caught 6 of 14. It still misses small-rain re-breaches of a freshly closed berm, which may be driven by tides or waves. Tides and offshore waves are shown for context; they did not improve the daily model.</p>
    <p>Limits: the newest slough level is a weekly staff-gauge reading, so the level in between is an estimate (about ±0.4 ft over a storm). Forecast rain comes from a weather model that can miss local totals by a factor of two. The mouth state comes from CCBER's log, which can lag a breach by days.</p>
    <p class="small muted">Sources: <a href="https://github.com/ccber-restoration/hydrology">CCBER hydrology data</a> (mouth log, staff gauge) · <a href="https://www.ncei.noaa.gov/">NOAA NCEI</a> Coal Oil Point gauge · <a href="https://www.cocorahs.org/">CoCoRaHS</a> · <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a> (KSBA) · <a href="https://open-meteo.com/">Open-Meteo</a> · <a href="https://tidesandcurrents.noaa.gov/stationhome.html?id=9411340">NOAA tides</a> · <a href="https://www.ndbc.noaa.gov/station_page.php?station=46218">NDBC 46218</a></p>
    <div class="chips">${sources}</div>
    <p class="small muted" style="margin-top:var(--space-2)">Updated ${new Date(s.generated_at).toLocaleString("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" })} Pacific. Model fit ${esc(s.model.exported)}.</p>
  </section>`;
}

async function load() {
  try {
    const [r, h] = await Promise.all([fetch("/devereux/api/status"), fetch("stage-history.json").catch(() => null)]);
    if (!r.ok) throw new Error(r.status);
    if (h?.ok) HISTORY = await h.json();
    const s = await r.json();
    render(s);
    window.__devereux = s;
  } catch (e) {
    app.innerHTML = `<div class="loading">Couldn't load the slough data (${esc(e.message)}). Try again in a minute.</div>`;
  }
}
load();
// re-render charts on theme change so axis colors follow
new MutationObserver(() => window.__devereux && render(window.__devereux)).observe(document.body, { attributes: true, attributeFilter: ["class"] });
