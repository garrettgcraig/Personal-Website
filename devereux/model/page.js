// The Model tab: how the Breach Watch model was chosen and how it did on held-out seasons.
// Data: /devereux/model-report.json, written by devereux-breach/analysis/regressions.qmd
// (Parts 4, 5 and 7: measured-level days, the catch-every-breach search, the model in use).

import { legend } from "../shared.js";

const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const css = (v) => getComputedStyle(document.body).getPropertyValue(v).trim();
const fmtP = (p) => (p < 0.001 ? "<0.001" : p.toFixed(3));
const C = { first: "#3F86C8", later: "#C9652F", line: "#D9772B", sage: "#5E6E3A" };
const day = (iso, o = { month: "short", day: "numeric", year: "numeric" }) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", o);
const dnum = (iso) => Date.parse(`${iso}T12:00:00Z`) / 86400000;
const W = () => Math.max(300, Math.round(app.clientWidth || 1000));
const half = () => (W() > 900 ? Math.round((W() - 56) / 2) : W());

// A small SVG plot: axes from domains, then the caller draws marks with the scales.
function plot({ width, height = 260, x: [x0, x1], y: [y0, y1], xTicks = [], yTicks = [], xFmt = String, yFmt = String, draw, xLabel = "", yLabel = "" }) {
  const m = { l: 48, r: 14, t: 12, b: xLabel ? 42 : 28 };
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (width - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (height - m.t - m.b);
  let g = "";
  for (const t of yTicks) g += `<line class="grid" x1="${m.l}" x2="${width - m.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${esc(yFmt(t))}</text>`;
  for (const t of xTicks) g += `<text x="${X(t)}" y="${height - m.b + 16}" text-anchor="middle">${esc(xFmt(t))}</text>`;
  g += `<line class="axis" x1="${m.l}" x2="${width - m.r}" y1="${Y(y0)}" y2="${Y(y0)}"/>`;
  if (xLabel) g += `<text x="${(m.l + width - m.r) / 2}" y="${height - 6}" text-anchor="middle">${esc(xLabel)}</text>`;
  if (yLabel) g += `<text x="12" y="${(m.t + height - m.b) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(m.t + height - m.b) / 2})">${esc(yLabel)}</text>`;
  g += draw({ X, Y, m, width, height });
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">${g}</svg>`;
}


const NAMES = { rain_in: "rain that day", rain_prev: "rain the day before", rain_3d: "rain, last 3 days", api: "wetness of the watershed (API)",
  rain_wy: "rain since Oct 1", log_dc: "berm age", stage: "slough level", later: "already breached this season",
  margin: "level minus berm crest", margin_max: "level minus its highest since closure", maxlvl: "highest level since closure", crest: "berm crest",
  rain_2d: "rain, last 2 days", trail24: "rain, last 24 hours", trail48: "rain, last 48 hours", peak24: "wettest 24 hours of the day" };
const nice = (m) => m.split(" + ").map((t) => NAMES[t] || t).join(" + ").replace(/^./, (c) => c.toUpperCase());
const LEVEL_COLOR = { low: "#C23B30", watch: "#D9772B", warning: "#E2B33C", likely: "#4E8F4A" };
// Scores span 0.0001 to 1, and the level cutoffs sit at a few percent, so plots use a log scale.
const LO = 1e-4, lg = (v) => Math.log10(Math.max(LO, v));
const logTicks = [1e-4, 1e-3, 1e-2, 1e-1, 1];
const logFmt = (v) => ({ "-4": "0.0001", "-3": "0.001", "-2": "0.01", "-1": "0.1", "0": "1" }[String(Math.round(v))] ?? "");

function render(R) {
  const L = R.levels, n = R.n_breaches;
  const K = Object.fromEntries(R.coef.map((c) => [c.term, c.coef]));
  // score for a day's rain, given the highest level since closure, berm age and a typical 10 in season so far
  const WY = 10;
  const score = (maxlvl, dc, rain) => 1 / (1 + Math.exp(-(K.intercept + K.rain_in * rain + K.rain_wy * WY + K.log_dc * Math.log(dc) + K.maxlvl * maxlvl)));
  const watch = L.find((l) => l.key === "watch");
  const levelLines = (X, Y, x0, x1) => L.filter((l) => l.min > 0).map((l) => `<line x1="${X(x0)}" x2="${X(x1)}" y1="${Y(lg(l.min))}" y2="${Y(lg(l.min))}" stroke="${LEVEL_COLOR[l.key]}" stroke-dasharray="4 4" stroke-width="1.4"/><text x="${X(x1)}" y="${Y(lg(l.min)) - 4}" text-anchor="end" style="fill:${LEVEL_COLOR[l.key]}">${esc(l.label)}</text>`).join("");

  // --- response curves: score vs slough level, young and mature berm, two rain days
  const curves = [[11, 0.5, "#3F86C8", "6 4"], [11, 1.5, "#8E62C9", "6 4"], [300, 0.5, "#D9A23A", ""], [300, 1.5, "#C2553A", ""]].map(([dc, rain, col, dash]) => {
    const pts = []; for (let st = 4; st <= 11.001; st += 0.05) pts.push([st, score(st, dc, rain)]);
    return { dc, rain, col, dash, pts };
  });
  const respChart = plot({
    width: half(), height: 300, x: [4, 11], y: [-4, 0], xTicks: [4, 5, 6, 7, 8, 9, 10, 11], yTicks: logTicks.map(Math.log10), yFmt: logFmt,
    xLabel: "highest level since the mouth closed, ft NAVD88", yLabel: "daily score (log scale)",
    draw: ({ X, Y }) => levelLines(X, Y, 4, 11) + curves.map((c) => `<path d="${c.pts.map(([a, b], k) => `${k ? "L" : "M"}${X(a).toFixed(1)},${Y(lg(b)).toFixed(1)}`).join("")}" fill="none" stroke="${c.col}" stroke-width="2.4" ${c.dash ? `stroke-dasharray="${c.dash}"` : ""}/>`).join(""),
  });

  // --- held-out score through time, with breaches
  const H = R.heldout.map(([d, p]) => [dnum(d), p]);
  const bset = R.breaches.map((b) => ({ ...b, x: dnum(b.date) }));
  const xa = H.length ? H[0][0] : 0, xb = H.length ? H.at(-1)[0] : 1;
  const years = []; for (let y = 2019; y <= 2026; y++) years.push(Date.UTC(y, 0, 1) / 86400000);
  const timeChart = !H.length ? "" : plot({
    width: W(), height: 280, x: [xa, xb], y: [-4, 0], xTicks: years, xFmt: (x) => String(new Date(x * 86400000).getUTCFullYear()),
    yTicks: logTicks.map(Math.log10), yFmt: logFmt, yLabel: "held-out daily score",
    draw: ({ X, Y }) => {
      let g = levelLines(X, Y, xa, xb);
      for (const b of bset) g += `<line x1="${X(b.x)}" x2="${X(b.x)}" y1="${Y(-4)}" y2="${Y(0)}" stroke="${b.kind === "later" ? C.later : C.first}" stroke-width="1.2" opacity="0.45"><title>${esc(day(b.date))}</title></line>`;
      let d = "";
      H.forEach(([x, p], i) => { d += `${i && x - H[i - 1][0] <= 1.5 ? "L" : "M"}${X(x).toFixed(1)},${Y(lg(p)).toFixed(1)}`; });
      return g + `<path d="${d}" fill="none" stroke="${css("--color-text")}" stroke-width="1"/>`;
    },
  });

  // --- each breach: highest held-out score that day or the day before
  const nb = bset.length;
  const perBreach = plot({
    width: half(), height: 300, x: [-0.5, nb - 0.5], y: [-4, 0], yTicks: logTicks.map(Math.log10), yFmt: logFmt,
    xTicks: bset.map((_, i) => i).filter((i) => i % 2 === 0), xFmt: (i) => bset[i].date.slice(2, 7).replace("-", "/"),
    yLabel: "highest score, day of or before",
    draw: ({ X, Y }) => levelLines(X, Y, -0.5, nb - 0.5) + bset.map((b, i) => `<line x1="${X(i)}" x2="${X(i)}" y1="${Y(-4)}" y2="${Y(lg(b.p))}" stroke="${b.kind === "later" ? C.later : C.first}" stroke-width="2"/>`
      + `<circle cx="${X(i)}" cy="${Y(lg(b.p))}" r="5.5" fill="${b.kind === "later" ? C.later : C.first}"><title>${esc(`${day(b.date)}: score ${b.p.toFixed(3)}, ${b.kind} breach, berm ${b.days_closed} days old, ${b.stage} ft, ${b.rain} in that day`)}</title></circle>`).join(""),
  });
  const weakest = bset.reduce((m, b) => (b.p < m.p ? b : m));

  // --- slough rise per storm: observed vs fitted
  const S = R.rise.storms;
  const rmax = Math.ceil(Math.max(...S.map((s) => Math.max(s.rise, s.fit))) * 2) / 2;
  const riseChart = plot({
    width: half(), height: 280, x: [0, rmax], y: [0, rmax], xTicks: [0, 1, 2, 3, 4].filter((v) => v <= rmax), yTicks: [0, 1, 2, 3, 4].filter((v) => v <= rmax),
    xLabel: "predicted rise, ft", yLabel: "observed rise, ft",
    draw: ({ X, Y }) => `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(rmax)}" y2="${Y(rmax)}" stroke="${css("--color-muted")}" stroke-dasharray="3 4"/>`
      + S.map((s) => `<circle cx="${X(s.fit)}" cy="${Y(s.rise)}" r="5" fill="${C.sage}" opacity="0.85"><title>${esc(`${day(s.start)}: ${s.total} in on a ${s.stage0} ft slough, rose ${s.rise} ft (model ${s.fit})`)}</title></circle>`).join(""),
  });

  const fmtv = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  const riseRows = R.rise.coef.map((c) => `<tr><td>${esc({ Intercept: "Intercept", total: "Storm rain total (in)", stage0: "Level before the storm (ft)" }[c.term] || c.term)}</td><td>${c.coef.toFixed(3)}</td><td>${c.lo.toFixed(3)} to ${c.hi.toFixed(3)}</td><td>${fmtP(c.p)}</td></tr>`).join("");
  const OCEAN = new Set(["tide_max", "surge", "hs_max", "wave30"]);

  app.innerHTML = `
  <section class="page-head">
    <h1>The model behind Breach Watch</h1>
    <p class="lead">Each day's score comes from rain that day, how wet the season has been, how long the berm has had to build since the mouth last closed, and the highest the slough has stood since then.</p>
    <p class="outlook">The goal is to warn of every breach with as few false alarms as possible. ${R.n_models.toLocaleString()} combinations of rain, level and berm inputs were tested on the ${R.n_days.toLocaleString()} closed-mouth days with a measured water level (${esc(R.seasons.replace("-", " to "))}), which hold ${n} breaches. Alerts go out at <strong>Possible</strong>, the lowest warning level. ${watch.caught === n ? `All ${n} breaches` : `${watch.caught} of the ${n} breaches`} reached Possible on the day of the breach or the day before. A false alarm is a time Possible came up and no breach followed; over eight seasons that happened ${watch.false_alarm_episodes === 1 ? "once" : `${watch.false_alarm_episodes} times`}, ${watch.false_alarm_days === watch.false_alarm_episodes ? "each lasting a single day" : `${watch.false_alarm_days} days in all`}. The Possible cutoff was set with all ${n} breaches in view, which flatters it, so it was also tested on each season as if that season were new, with the cutoff set from the other seasons only. Tested that way, it warned of ${R.honest.caught} of ${R.honest.breaches}.${R.excluded.length ? ` Breaches without a measured level (${R.excluded.map((d) => day(d)).join(", ")}) are left out.` : ""}</p>
  </section>

  <section class="block">
    <h2>Levels, not percentages</h2>
    <p class="intro">With ${n} breaches the daily score ranks risk well but isn't a dependable percentage, so the page reports levels. Each level starts at a score cutoff set from the scores on past breach days. A false-alarm episode is a run of days at or above that level with no breach after it; alerts go out once per episode.</p>
    <div class="table-scroll"><table class="stats">
      <thead><tr><th>Level</th><th>Score at least</th><th>Breaches that reached it</th><th>False-alarm days</th><th>False-alarm episodes</th></tr></thead>
      <tbody>${L.filter((l) => l.min > 0).map((l) => `<tr><td><span class="swatch" style="background:${LEVEL_COLOR[l.key]}"></span>${esc(l.label)}${l.key === "watch" ? " (alerts)" : ""}</td><td>${l.min}</td><td>${l.caught} of ${n}</td><td>${l.false_alarm_days}</td><td>${l.false_alarm_episodes}</td></tr>`).join("")}</tbody>
    </table></div>
    <h3 style="margin:var(--space-6) 0 0">How the live forecast feeds the model</h3>
    <p class="intro">Today's rain is the amount already measured at the Coal Oil Point gauge (hourly, usually about an hour behind; until the gauge reports an hour of today, the whole day is forecast) plus the forecast for the hours left in the day. Forecast rain is Open-Meteo's best-match forecast averaged over five grid points spread across the Devereux Creek watershed, from the slough to the foothills, rather than a single point at the mouth, so rain that has ended no longer counts as still to come. Rain forecasts lose skill with lead time, so each future day is also scored with its forecast rain scaled up a little more each day, reaching 1.5 times on day 10, and the page shows the higher of the two levels. The slough answers rain within hours: over 49 closed-mouth storms the rise began a median 3 to 4 hours after the rain did, and after the rain stopped it gained only about a fifth more, within 6 to 8 hours. The projected level shown on the Outlook puts each storm's rise on its rain day accordingly; the score itself uses the highest measured daily mean before each day, and the projected level only for days past the latest reading. The cutoffs above come from observed rain; this lead-time allowance is a judgment call that trades a few more early Possible calls for fewer late surprises, and alerts follow it. On Likely and Imminent days the Outlook also gives the most likely breach hours: the hour a storm's rain reaches about 1.9 in at Coal Oil Point (the median past breaches took, 1.77 in at the airport gauge, scaled to Coal Oil Point), plus 2 hours, shown as a window from 1 hour before to 3 hours after. Run on the 16 past breaches with the measured rain, the breach fell within 4 hours of that time 12 times.</p>
    <p class="note">The Possible cutoff is the lowest score any recorded breach reached, rounded down. Set for each season from the other seasons only, it would have missed one breach: ${esc(day(R.honest.missed))}.</p>
  </section>

  <section class="block">
    <h2>The model</h2>
    <p class="intro">A <strong>logistic model</strong> turns several inputs into one daily score between 0 and 1. Each input is multiplied by a weight learned from past days (its coefficient) and the results are added up; the logistic curve then squeezes that total so the score can't fall below 0 or rise above 1. A higher score means a breach is more likely. This one has four inputs: <strong>rain that day</strong>, <strong>rain since October 1</strong>, <strong>how many days the berm has had to build</strong> since the mouth last closed, and <strong>the highest the slough has stood since then</strong>, through the day before. Berm age enters on a <strong>log scale</strong>, meaning each doubling counts the same: going from 10 to 20 days matters as much as going from 100 to 200, so the first weeks count most. A slough that has already held high water against a berm has shown how close it is to the top; a young berm fails at lower levels than an old one, and a wet season primes the watershed. Rain is the Coal Oil Point gauge, midnight to midnight.</p>
    <div class="cols">
      <div class="table-scroll"><table class="stats">
        <thead><tr><th>Input</th><th>Coefficient</th><th>Odds ratio</th></tr></thead>
        <tbody>${R.coef.map((c) => `<tr><td>${esc(c.label)}${c.unit ? `<small class="unit">${esc(c.unit)}</small>` : ""}</td><td>${c.coef.toFixed(3)}</td><td>${c.term === "intercept" ? "" : (c.term === "log_dc" ? Math.exp(c.coef * Math.LN2) : Math.exp(c.coef)).toPrecision(3)}</td></tr>`).join("")}</tbody>
      </table>
      <p class="note">A <strong>coefficient</strong> is an input's weight: positive pushes the score up, negative pulls it down. The <strong>odds ratio</strong> is the same weight in a form that's easier to read: it's what the odds of a breach are multiplied by for one more unit of the input. An odds ratio of 2 doubles the odds, 1 leaves them alone, and 0.5 halves them. Units are per inch of rain, per foot of level and per doubling of berm age; the intercept is the starting point before any input is added. Fit on all ${R.n_days.toLocaleString()} measured days; the results above use fits that leave out the season being scored.</p></div>
      <div>
        <h3>What it means</h3>
        ${legend([["#3F86C8", "young berm (11 days), 0.5 in of rain", "dash"], ["#8E62C9", "young berm, 1.5 in", "dash"], ["#D9A23A", "mature berm (300 days), 0.5 in", "line"], ["#C2553A", "mature berm, 1.5 in", "line"]])}
        <p class="note">Each line is the score for one kind of day as the slough's highest level climbs, with 10 in of rain so far this season. The score axis is a log scale: each gridline is ten times the one below it.</p>
        ${respChart}
      </div>
    </div>
  </section>

  ${!H.length ? "" : `<section class="block">
    <h2>Held-out score, every measured day</h2>
    
    ${legend([[css("--color-text"), "daily score", "line"], [C.first, "first breach of a season", "vline"], [C.later, "later breach", "vline"]])}
    ${timeChart}
    <p class="note"><strong>Held-out</strong> means each season is scored by a model fit only on the other seasons, so it meets that season the way the live model meets a new winter. That's a fairer test than scoring the days a model learned from. Vertical lines are breaches (blue: first of the season; orange: later ones). Gaps are times the mouth was open or the level wasn't measured.</p>
  </section>`}

  <section class="block">
    <h2>Each breach</h2>
    <div class="cols">
      <div>
        <p class="note">The highest score on the breach day or the day before, since a storm that runs past midnight spans two calendar days. The lowest, ${esc(day(weakest.date))}, came ${weakest.days_closed} days after the berm closed, with the slough at ${weakest.stage.toFixed(2)} ft and ${weakest.rain} in of rain that day.</p>
        ${legend([[C.first, "first of the season", "lollipop"], [C.later, "later", "lollipop"]])}
        ${perBreach}
      </div>
      <div>
        <table class="stats">
          <thead><tr><th>Breach</th><th>Berm age, days</th><th>Level, ft</th><th>Rain, in</th><th>Score</th></tr></thead>
          <tbody>${bset.map((b) => `<tr><td>${esc(day(b.date))}</td><td>${b.days_closed}</td><td>${b.stage.toFixed(2)}</td><td>${b.rain.toFixed(2)}</td><td>${b.p.toFixed(3)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="block">
    <h2>How it compares</h2>
    <p class="intro">The leaders of the ${R.n_models.toLocaleString()}-model search. <strong>All seasons (in-sample)</strong> sets one cutoff using every season, just low enough to catch the weakest breach, then scores those same seasons. <strong>Season held out (cross-validated)</strong> scores each season with a cutoff set from the other seasons only, as if that season were new (statisticians call this leave-one-season-out cross-validation); it's the fairer test. A false-alarm episode is a run of days over the cutoff with no breach after it; alerts go out once per episode, so episodes are what subscribers would see.</p>
    <div class="table-scroll"><table class="stats">
      <thead><tr><th rowspan="2">Model</th><th colspan="2" class="grp">All seasons (in-sample)</th><th colspan="4" class="grp">Season held out (cross-validated)</th></tr><tr><th>False-alarm days</th><th>Episodes</th><th>Caught</th><th>Episodes</th><th>Missed</th><th>False-alarm days</th></tr></thead>
      <tbody>${R.search.map((c) => `<tr class="${c.model === R.model ? "pick" : ""}"><td>${esc(nice(c.model))}${c.model === R.model ? " (in use)" : ""}</td><td>${c.fa_days}</td><td>${c.fa_episodes}</td><td>${esc(c.honest_caught.replace("/", " of "))}</td><td>${c.honest_fa_episodes}</td><td>${esc(c.honest_missed ? c.honest_missed.split(";").map((d) => day(d)).join(", ") : "none")}</td><td>${c.honest_fa_days}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="note">The top eight lead the search; all catch 15 of 16 with each season held out, and the one in use has the fewest false alarms with the simplest inputs. Three more are shown for comparison: one built on how far the slough sits below an estimated berm crest and below its own high, with rain that day and the day before; a rain-only model (rain that day plus rain since October 1), which catches as many but with 11 false-alarm episodes; and a level-and-rain model that needs a cutoff so low it raises dozens of false-alarm episodes.</p>
  </section>

  <section class="block">
    <h2>Which inputs matter on their own</h2>
    <p class="intro">Each input alone, on all closed-mouth days. Tides and waves were screened out early. The <strong>likelihood-ratio χ²</strong> measures how much better a model with that input sorts breach days from other days than a model with no inputs; bigger is better. <strong>p</strong> is the chance of an improvement that large if the input had no real link to breaches, so a small p (under 0.05) means the link is unlikely to be luck. <strong>AUC</strong> is the chance that a random breach day scores higher than a random non-breach day: 0.5 is a coin flip and 1 is perfect.</p>
    <div class="table-scroll"><table class="stats">
      <thead><tr><th>Input</th><th>Likelihood-ratio χ²</th><th>p</th><th>AUC alone</th></tr></thead>
      <tbody>${R.univariate.filter((u) => !OCEAN.has(u.input)).map((u) => `<tr><td>${esc((NAMES[u.input] || u.input).replace(/^./, (c) => c.toUpperCase()))}</td><td>${u.lr.toFixed(1)}</td><td>${fmtP(u.p)}</td><td>${u.auc.toFixed(3)}</td></tr>`).join("")}</tbody>
    </table></div>
  </section>

  <section class="block">
    <h2>How much the slough rises in a storm</h2>
    <div class="cols">
      <div>
        <p class="intro">A straight-line fit (ordinary least squares) on ${S.length} storms: <strong>${esc(R.rise.formula)}</strong>. A fuller slough rises less per inch because it spreads over a wider area. <strong>Adjusted R²</strong> is ${R.rise.r2_adj.toFixed(2)}: the share of the storm-to-storm differences in rise the fit explains (1 would be all of it), with a small penalty for each input. <strong>Leave-one-storm-out error</strong> is ${R.rise.loo_rmse.toFixed(2)} ft: refit without each storm, predict it, and that's the typical miss. The <strong>95% CI</strong> (confidence interval) is the range the true coefficient most likely falls in. The standard errors behind it are robust (HC3), meaning they don't assume every storm is equally predictable.</p>
        <table class="stats">
          <thead><tr><th>Term</th><th>Coefficient</th><th>95% CI</th><th>p</th></tr></thead>
          <tbody>${riseRows}</tbody>
        </table>
      </div>
      <div>${riseChart}</div>
    </div>
  </section>

  <section class="block">
    <h2>Full report</h2>
    <p class="intro">Every test behind these numbers, with code. That includes checks that the inputs don't overlap too much (collinearity), that no input splits breach days from the rest too perfectly to fit (separation), that each input's effect has the right shape (Box–Tidwell) and the scores match how often breaches happened (Hosmer–Lemeshow), that no single day drives the fit (influence), and that the results hold when whole seasons are resampled (season-block bootstrap), plus the catch-every-breach search and the checks on the rise model's errors. <a href="report.html">Open the full statistical report</a>. Generated ${esc(day(R.generated))}.</p>
  </section>`;
}

async function load() {
  try {
    const R = await fetch("/devereux/model-report.json").then((r) => r.json());
    render(R);
    window.__m = [R];
  } catch (e) {
    app.innerHTML = `<div class="loading">Couldn't load the model results (${esc(e.message)}).</div>`;
  }
}
load();
new MutationObserver(() => window.__m && render(...window.__m)).observe(document.body, { attributes: true, attributeFilter: ["class"] });
let lastW = 0;
addEventListener("resize", () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => { if (window.__m && Math.abs(W() - lastW) > 40) { lastW = W(); render(...window.__m); } }, 200); });
