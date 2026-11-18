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
function chart({ series, width = 680, height = 200, yMin = 0, yMax, yFmt = (v) => v, xTicks, xFmt, now, bands = [], hlines = [] }) {
  const W = width, H = height, m = { l: 40, r: 12, t: 10, b: 24 };
  const xs = series.flatMap((s) => s.points.map((p) => +p.x));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
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
  for (const s of series) {
    const pts = s.points.filter((p) => p.y != null);
    if (s.type === "bar") {
      for (const p of pts) g += `<rect x="${X(p.x) - barW / 2}" y="${Y(Math.max(p.y, bot))}" width="${barW}" height="${Math.max(0, Y(bot) - Y(Math.max(p.y, bot)))}" fill="${p.color || s.color}" opacity="${p.opacity ?? s.opacity ?? 1}" rx="1.5"><title>${esc(p.title || "")}</title></rect>`;
    } else if (s.type === "dots") {
      for (const p of pts) g += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${s.r || 3.5}" fill="${s.color}"><title>${esc(p.title || "")}</title></circle>`;
    } else {
      const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
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
    const h = s.stage?.crest_today_ft != null && s.stage?.today_est_ft != null ? s.stage.crest_today_ft - s.stage.today_est_ft : null;
    sentence = `Highest chance in the next 10 days is ${PCT(peak.p)} on ${day(peak.date)}`
      + (peak.rain_in >= 0.1 ? `, with ${peak.rain_in.toFixed(2)} in of rain forecast that day.` : ".")
      + (h != null ? ` The slough sits about ${h.toFixed(1)} ft below the estimated berm crest.` : "");
  }

  const tiles = [
    [s.stage?.today_est_ft != null ? FT(s.stage.today_est_ft, 2) : "n/a", "Slough level today (est., NAVD88)"],
    [s.stage?.crest_today_ft != null && !open ? FT(s.stage.crest_today_ft) : "n/a", "Estimated berm crest"],
    [s.stage?.latest_reading ? FT(s.stage.latest_reading.ft, 2) : "n/a", s.stage?.latest_reading ? `Staff gauge, ${day(s.stage.latest_reading.date, { month: "short", day: "numeric" })}` : "Latest staff gauge"],
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
        opacity: r.observed ? 0.45 : 1, title: `${day(r.date)}: ${PCT(r.p)} (rain model ${PCT(r.p_rain)}, berm-crest model ${PCT(r.p_crest)})`,
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

  // --- slough level chart: staff readings + simulated stage + crest
  const readings = (s.stage?.readings || []).filter((r) => dayNum(r.date) >= nowX - 75);
  const series = s.stage?.series || [];
  const sim = series.filter((r) => r.stage_ft != null);
  const lx0 = Math.min(...readings.map((r) => dayNum(r.date)), nowX), lx1 = nowX + 9;
  const levelChart = s.stage ? chart({
    height: 220, yMin: Math.floor(Math.min(...readings.map((r) => r.ft), ...sim.map((r) => r.stage_ft), 4) - 0.5), yMax: 11, yFmt: (v) => v.toFixed(0),
    series: [
      { type: "line", color: COLORS.clay, width: 2, dash: "5 4", points: series.map((r) => ({ x: dayNum(r.date), y: open ? null : r.crest_ft })) },
      { type: "line", color: COLORS.sky, width: 2.5, points: sim.map((r) => ({ x: dayNum(r.date), y: r.stage_ft })) },
      { type: "line", color: "transparent", points: [{ x: lx0, y: null }, { x: lx1, y: null }] },
      { type: "dots", color: COLORS.ochre, r: 4.5, points: readings.map((r) => ({ x: dayNum(r.date), y: r.ft, title: `${day(r.date)}: ${r.ft.toFixed(2)} ft (staff gauge)` })) },
    ],
    hlines: [],
    xTicks: dayTicks(lx0, lx1, 14), xFmt: shortDay, now: nowX,
  }) : `<p class="muted">No staff-gauge readings available.</p>`;

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
    <p class="muted small" style="margin-top:0">Faded bars are the past two weeks, scored with observed rain; solid bars use forecast rain. Each day shows the higher of two models: a rain model and a berm-crest model.</p>
    <div class="chart-card">
      ${legend([[COLORS.sky, "low"], [COLORS.ochre, "watch (20% or more)"], [COLORS.clay, "likely (50% or more)"]])}
      ${probChart}
      <h3 style="margin:var(--space-4) 0 0">Rain, inches per day</h3>
      ${legend([[COLORS.sky, "observed"], [COLORS.mist, "forecast (Open-Meteo)"]])}
      ${rainChart}
    </div>
    <div class="table-scroll"><table class="days">
      <thead><tr><th>Day</th><th>Rain (in)</th><th>Slough (ft)</th><th>Crest (ft)</th><th>Rain model</th><th>Crest model</th><th>Chance</th></tr></thead>
      <tbody>${ahead.map((r) => `<tr class="${r.date === s.today ? "today" : ""}"><td>${r.date === s.today ? "Today" : day(r.date)}</td><td>${(r.rain_in ?? 0).toFixed(2)}</td><td>${r.stage_ft?.toFixed(2) ?? "n/a"}</td><td>${r.crest_ft.toFixed(1)}</td><td>${PCT(r.p_rain)}</td><td>${PCT(r.p_crest)}</td><td><strong>${PCT(r.p)}</strong></td></tr>`).join("")}</tbody>
    </table></div>
  </section>`}

  <section class="block">
    <h2>Slough level vs. berm crest</h2>
    <p class="muted small" style="margin-top:0">Gold dots are weekly staff-gauge readings at Venoco Bridge (CCBER). The blue line rolls the latest reading forward with a rain-driven water balance. The dashed line is the estimated berm crest, which rebuilds after each closure toward about ${s.model.crest.c_inf.toFixed(1)} ft. All elevations in feet, NAVD88.</p>
    <div class="chart-card">
      ${legend([[COLORS.ochre, "staff gauge"], [COLORS.sky, "estimated level", true], [COLORS.clay, "estimated crest", true]])}
      ${levelChart}
    </div>
  </section>

  <section class="block">
    <h2>Recent conditions</h2>
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
    <p>Two models, trained on CCBER's record of 14 breaches from 2019 to 2026. The <strong>rain model</strong> looks at the day's rain, the last three days, how wet the watershed already is, rain since October 1, and how long the mouth has been closed. It catches breaches driven by big storms. The <strong>berm-crest model</strong> compares the slough level with a berm crest that is low right after a closure (about ${s.model.crest.c0.toFixed(1)} ft) and rebuilds over a couple of months toward about ${s.model.crest.c_inf.toFixed(1)} ft. It catches breaches when the slough is already nearly full. The page shows the higher of the two.</p>
    <p>Predicting each season with a model trained on the others, the combined alert flagged ${esc(s.model.skill.combined_hits_p50)} breaches at the 50% level, with ${s.model.skill.combined_false_alarm_days_p50} false-alarm days over eight seasons. It still misses small-rain re-breaches of a freshly closed berm, which may be driven by tides or waves. Tides and offshore waves are shown for context; they did not improve the daily model.</p>
    <p>Limits: the newest slough level is a weekly staff-gauge reading, so the level in between is an estimate (about ±0.4 ft over a storm). Forecast rain comes from a weather model that can miss local totals by a factor of two. The mouth state comes from CCBER's log, which can lag a breach by days.</p>
    <p class="small muted">Sources: <a href="https://github.com/ccber-restoration/hydrology">CCBER hydrology data</a> (mouth log, staff gauge) · <a href="https://www.ncei.noaa.gov/">NOAA NCEI</a> Coal Oil Point gauge · <a href="https://www.cocorahs.org/">CoCoRaHS</a> · <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a> (KSBA) · <a href="https://open-meteo.com/">Open-Meteo</a> · <a href="https://tidesandcurrents.noaa.gov/stationhome.html?id=9411340">NOAA tides</a> · <a href="https://www.ndbc.noaa.gov/station_page.php?station=46218">NDBC 46218</a></p>
    <div class="chips">${sources}</div>
    <p class="small muted" style="margin-top:var(--space-2)">Updated ${new Date(s.generated_at).toLocaleString("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" })} Pacific. Model fit ${esc(s.model.exported)}.</p>
  </section>`;
}

async function load() {
  try {
    const r = await fetch("/devereux/api/status");
    if (!r.ok) throw new Error(r.status);
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
