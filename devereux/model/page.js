// The Model tab: how the Breach Watch model was chosen and how it did on held-out seasons.
// Data: /devereux/model-report.json (written by devereux-breach/analysis/regressions.qmd)
// and /devereux/model-params.json (the fitted model the live page runs).

const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const css = (v) => getComputedStyle(document.body).getPropertyValue(v).trim();
const PCT = (p) => (p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);
const fmtP = (p) => (p < 0.001 ? "<0.001" : p.toFixed(3));
const C = { first: "#2D5A7B", later: "#C9652F", line: "#D9772B", sage: "#5E6E3A" };
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
const legend = (items) => `<div class="legend">${items.map(([c, l, st]) => `<span><i class="${st || ""}" style="background:${c};border-color:${c}"></i>${esc(l)}</span>`).join("")}</div>`;

const TERMS = {
  const: ["Intercept", "baseline log-odds"],
  rain_in: ["Rain that day", "per inch"],
  rain_wy: ["Rain since October 1", "per inch"],
  stage: ["Slough level", "per foot, NAVD88"],
  later: ["Already breached this season", "yes vs. no"],
};

function render(R, P) {
  const Wt = P.watch;
  const sig = (z) => 1 / (1 + Math.exp(-z));
  const prob = (x) => sig(Wt.intercept + Wt.features.reduce((a, f, k) => a + Wt.coef[k] * x[f], 0));
  const pick = R.compare.find((c) => c.model.startsWith("3 inputs + later") && !c.model.includes(" x "));
  const at30 = pick["0.3"];

  // --- response curves: chance vs slough level for a few rain days, first and later berms
  const curves = [];
  for (const [rain, later, dash] of [[0.5, 0, ""], [1.5, 0, ""], [2.5, 0, ""], [1.0, 1, "6 4"]]) {
    const pts = [];
    for (let st = 4; st <= 11.001; st += 0.05) pts.push([st, prob({ rain_in: rain, rain_wy: later ? 15 : 8, stage: st, later })]);
    curves.push({ rain, later, dash, pts });
  }
  const shades = ["#9DB9CF", "#4F7FA3", "#1B3A52"];
  const respChart = plot({
    width: half(), height: 280, x: [4, 11], y: [0, 1], xTicks: [4, 5, 6, 7, 8, 9, 10, 11], yTicks: [0, 0.25, 0.5, 0.75, 1],
    yFmt: (v) => `${Math.round(v * 100)}%`, xLabel: "slough level, ft NAVD88", yLabel: "chance of a breach that day",
    draw: ({ X, Y }) => {
      let g = `<line x1="${X(4)}" x2="${X(11)}" y1="${Y(0.3)}" y2="${Y(0.3)}" stroke="${C.line}" stroke-dasharray="4 4"/><text x="${X(11)}" y="${Y(0.3) - 5}" text-anchor="end" style="fill:${C.line}">30%: alert</text>`;
      curves.forEach((c, i) => {
        const col = c.later ? C.later : shades[i];
        g += `<path d="${c.pts.map(([a, b], k) => `${k ? "L" : "M"}${X(a).toFixed(1)},${Y(b).toFixed(1)}`).join("")}" fill="none" stroke="${col}" stroke-width="2.4" ${c.dash ? `stroke-dasharray="${c.dash}"` : ""}/>`;
      });
      return g;
    },
  });

  // --- held-out chance through time, with breaches
  const H = R.heldout.map(([d, p]) => [dnum(d), p]);
  const bset = R.breaches.map((b) => ({ ...b, x: dnum(b.date) }));
  const xa = H[0][0], xb = H.at(-1)[0];
  const years = []; for (let y = 2019; y <= 2026; y++) years.push(Date.UTC(y, 0, 1) / 86400000);
  const timeChart = plot({
    width: W(), height: 260, x: [xa, xb], y: [0, 1], xTicks: years, xFmt: (x) => String(new Date(x * 86400000).getUTCFullYear()),
    yTicks: [0, 0.3, 0.5, 1], yFmt: (v) => `${Math.round(v * 100)}%`, yLabel: "held-out daily chance",
    draw: ({ X, Y }) => {
      let g = `<line x1="${X(xa)}" x2="${X(xb)}" y1="${Y(0.3)}" y2="${Y(0.3)}" stroke="${C.line}" stroke-dasharray="4 4"/>`;
      for (const b of bset) g += `<line x1="${X(b.x)}" x2="${X(b.x)}" y1="${Y(0)}" y2="${Y(1)}" stroke="${b.kind === "later" ? C.later : C.first}" stroke-width="1.2" opacity="0.45"><title>${esc(day(b.date))}</title></line>`;
      let d = "";
      H.forEach(([x, p], i) => { d += `${i && x - H[i - 1][0] <= 1.5 ? "L" : "M"}${X(x).toFixed(1)},${Y(p).toFixed(1)}`; });
      g += `<path d="${d}" fill="none" stroke="${css("--color-text")}" stroke-width="1.1"/>`;
      return g;
    },
  });

  // --- each breach: highest held-out chance that day or the day before
  const n = bset.length;
  const perBreach = plot({
    width: half(), height: 280, x: [-0.5, n - 0.5], y: [0, 1], yTicks: [0, 0.3, 0.5, 1], yFmt: (v) => `${Math.round(v * 100)}%`,
    xTicks: bset.map((_, i) => i).filter((i) => i % 2 === 0), xFmt: (i) => bset[i].date.slice(2, 7).replace("-", "/"),
    yLabel: "highest chance, day of or before",
    draw: ({ X, Y }) => {
      let g = `<line x1="${X(-0.5)}" x2="${X(n - 0.5)}" y1="${Y(0.3)}" y2="${Y(0.3)}" stroke="${C.line}" stroke-dasharray="4 4"/>`;
      bset.forEach((b, i) => {
        g += `<line x1="${X(i)}" x2="${X(i)}" y1="${Y(0)}" y2="${Y(b.p)}" stroke="${b.kind === "later" ? C.later : C.first}" stroke-width="2"/>`
          + `<circle cx="${X(i)}" cy="${Y(b.p)}" r="5.5" fill="${b.kind === "later" ? C.later : C.first}"><title>${esc(`${day(b.date)}: ${PCT(b.p)}, ${b.kind} breach, ${b.stage} ft, ${b.rain} in`)}</title></circle>`;
      });
      return g;
    },
  });

  // --- calibration by band: when the model said X, how often did it breach that day?
  const bdays = new Set(R.breaches.map((b) => b.date));
  const bands = [[0, 0.01, "under 1%"], [0.01, 0.05, "1 to 5%"], [0.05, 0.3, "5 to 30%"], [0.3, 0.8, "30 to 80%"], [0.8, 1.01, "80% or more"]];
  const cal = bands.map(([lo, hi, label]) => {
    const rows = R.heldout.filter(([, p]) => p >= lo && p < hi);
    const hits = rows.filter(([d]) => bdays.has(d)).length;
    const mean = rows.reduce((a, [, p]) => a + p, 0) / Math.max(1, rows.length);
    return { label, n: rows.length, hits, mean };
  });

  // --- slough rise per storm: observed vs fitted
  const S = R.rise.storms;
  const rmax = Math.ceil(Math.max(...S.map((s) => Math.max(s.rise, s.fit))) * 2) / 2;
  const riseChart = plot({
    width: half(), height: 280, x: [0, rmax], y: [0, rmax], xTicks: [0, 1, 2, 3, 4].filter((v) => v <= rmax), yTicks: [0, 1, 2, 3, 4].filter((v) => v <= rmax),
    xLabel: "predicted rise, ft", yLabel: "observed rise, ft",
    draw: ({ X, Y }) => `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(rmax)}" y2="${Y(rmax)}" stroke="${css("--color-muted")}" stroke-dasharray="3 4"/>`
      + S.map((s) => `<circle cx="${X(s.fit)}" cy="${Y(s.rise)}" r="5" fill="${C.sage}" opacity="0.85"><title>${esc(`${day(s.start)}: ${s.total} in on a ${s.stage0} ft slough, rose ${s.rise} ft (model ${s.fit})`)}</title></circle>`).join(""),
  });

  const coefRows = R.watch_coef.map((c) => {
    const [name, unit] = TERMS[c.term] || [c.term, ""];
    const e = Math.exp(c.coef), or = c.term === "const" ? "" : e >= 100 ? Math.round(e).toLocaleString() : e.toFixed(2);
    return `<tr><td>${esc(name)}<small class="unit">${esc(unit)}</small></td><td>${c.coef.toFixed(2)}</td><td>${c.lo.toFixed(2)} to ${c.hi.toFixed(2)}</td><td>${or}</td><td>${fmtP(c.p)}</td></tr>`;
  }).join("");
  const riseRows = R.rise.coef.map((c) => `<tr><td>${esc({ Intercept: "Intercept", total: "Storm rain total (in)", stage0: "Level before the storm (ft)" }[c.term] || c.term)}</td><td>${c.coef.toFixed(3)}</td><td>${c.lo.toFixed(3)} to ${c.hi.toFixed(3)}</td><td>${fmtP(c.p)}</td></tr>`).join("");
  const NAMES = { rain_in: "Rain that day", rain_3d: "Rain, last 3 days", api: "Wetness of the watershed (API)", rain_wy: "Rain since Oct 1", log_dc: "Berm age (log days closed)",
    stage: "Slough level", tide_max: "High tide", surge: "Storm surge", hs_max: "Wave height", wave30: "Wave power, 30 days" };

  app.innerHTML = `
  <section class="page-head">
    <h1>The model behind Breach Watch</h1>
    <p class="lead">Four things set each day's chance of a breach: that day's rain, the rain since October 1, the slough level, and whether the mouth has already breached once this season.</p>
    <p class="outlook">It was picked from hundreds of combinations of rain, level, berm age, tide and wave inputs, tested on ${R.n_breaches} breaches across ${R.n_days.toLocaleString()} closed-mouth days (${esc(R.seasons)}). Every result below predicts each season with a model trained only on the other seasons. At the 30% alert line it flagged <strong>${esc(at30.caught.replace("/", " of "))}</strong> breaches, with ${at30.false_alarm_days ? `${at30.false_alarm_days} false-alarm day${at30.false_alarm_days > 1 ? "s" : ""}` : "no false-alarm days"}.</p>
  </section>

  <section class="block">
    <h2>Coefficients</h2>
    <p class="intro">Logistic regression on all ${R.n_breaches} breaches. The odds ratio is how much one more unit multiplies the odds of a breach that day. Season-to-date rain adds little once the level is known; it stays in because it improved held-out predictions.</p>
    <div class="cols">
      <div class="table-scroll"><table class="stats">
        <thead><tr><th>Input</th><th>Coefficient</th><th>95% CI</th><th>Odds ratio</th><th>p</th></tr></thead>
        <tbody>${coefRows}</tbody>
      </table></div>
      <div>
        <h3>What the coefficients mean</h3>
        ${legend([[shades[0], "0.5 in that day", "line"], [shades[1], "1.5 in", "line"], [shades[2], "2.5 in", "line"], [C.later, "1.0 in, berm already breached once this season", "dash"]])}
        ${respChart}
      </div>
    </div>
  </section>

  <section class="block">
    <h2>Held-out chance, every closed-mouth day</h2>
    <p class="intro">Each season scored by a model that never saw it. Vertical lines are breaches (blue: first of the season; orange: later ones). Gaps are times the mouth was open.</p>
    ${legend([[css("--color-text"), "daily chance", "line"], [C.first, "first breach of a season", "line"], [C.later, "later breach", "line"], [C.line, "30% alert line", "dash"]])}
    ${timeChart}
  </section>

  <section class="block">
    <h2>Each breach</h2>
    <div class="cols">
      <div>
        <p class="intro">The highest chance on the breach day or the day before, since runoff can take a day to arrive. ${esc(at30.missed ? `Missed at 30%: ${at30.missed.split(", ").map((d) => day(d)).join(" and ")}.` : "")}</p>
        ${legend([[C.first, "first of the season"], [C.later, "later"]])}
        ${perBreach}
      </div>
      <div>
        <p class="intro">When the model gave a day this chance, how often did the berm breach that day?</p>
        <table class="stats">
          <thead><tr><th>Model said</th><th>Days</th><th>Breached</th><th>Average chance</th></tr></thead>
          <tbody>${cal.map((c) => `<tr><td>${c.label}</td><td>${c.n.toLocaleString()}</td><td>${c.hits}</td><td>${PCT(c.mean)}</td></tr>`).join("")}</tbody>
        </table>
        <p class="note">Breaches cluster at the top, where they should. With ${R.n_breaches} events the percentages are a ranking of risk more than exact odds.</p>
      </div>
    </div>
  </section>

  <section class="block">
    <h2>Model comparison</h2>
    <p class="intro">Log loss and AUC score every day's chance (lower log loss and higher AUC are better). The last columns count breaches flagged and false-alarm days at the 30% alert line. The crest-curve model tracks how the berm rebuilds after it closes; it scores better day to day but raises more false alarms at 30%.</p>
    <div class="table-scroll"><table class="stats">
      <thead><tr><th>Model</th><th>Log loss</th><th>AUC</th><th>Flagged at 30%</th><th>False-alarm days</th></tr></thead>
      <tbody>${R.compare.map((c) => `<tr class="${c === pick ? "pick" : ""}"><td>${esc(c.model.replace("website model, as shipped", "Crest curve + rain (previous site model)").replace("website model, refit", "Crest curve, refit").replace("website model", "Crest curve"))}${c === pick ? " (in use)" : ""}</td><td>${c.logloss.toFixed(4)}</td><td>${c.auc.toFixed(3)}</td><td>${esc(c["0.3"].caught)}</td><td>${c["0.3"].false_alarm_days}</td></tr>`).join("")}</tbody>
    </table></div>
  </section>

  <section class="block">
    <h2>Which inputs matter on their own</h2>
    <p class="intro">Each input alone, and how often it appears among the 25 best models with up to four inputs. Tides, surge and waves add little.</p>
    <div class="table-scroll"><table class="stats">
      <thead><tr><th>Input</th><th>Likelihood-ratio χ²</th><th>p</th><th>AUC alone</th><th>Share of top 25</th></tr></thead>
      <tbody>${R.univariate.map((u) => `<tr><td>${esc(NAMES[u.input] || u.input)}</td><td>${u.lr.toFixed(1)}</td><td>${fmtP(u.p)}</td><td>${u.auc.toFixed(3)}</td><td>${Math.round((R.top25_share[u.input] ?? 0) * 100)}%</td></tr>`).join("")}</tbody>
    </table></div>
  </section>

  <section class="block">
    <h2>How much the slough rises in a storm</h2>
    <div class="cols">
      <div>
        <p class="intro">Ordinary least squares on ${S.length} storms: <strong>${esc(R.rise.formula)}</strong>. A fuller slough rises less per inch because it spreads over a wider area. Adjusted R² ${R.rise.r2_adj.toFixed(2)}; leave-one-storm-out error ${R.rise.loo_rmse.toFixed(2)} ft. Robust (HC3) standard errors.</p>
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
    <p class="intro">Every test behind these numbers, with code: collinearity, separation, Box–Tidwell, Hosmer–Lemeshow, influence, season-block bootstrap, and the residual checks for the rise model. <a href="report.html">Open the full statistical report</a>. Generated ${esc(day(R.generated))}.</p>
  </section>`;
}

async function load() {
  try {
    const [R, P] = await Promise.all([fetch("/devereux/model-report.json").then((r) => r.json()), fetch("/devereux/model-params.json").then((r) => r.json())]);
    render(R, P);
    window.__m = [R, P];
  } catch (e) {
    app.innerHTML = `<div class="loading">Couldn't load the model results (${esc(e.message)}).</div>`;
  }
}
load();
new MutationObserver(() => window.__m && render(...window.__m)).observe(document.body, { attributes: true, attributeFilter: ["class"] });
let lastW = 0;
addEventListener("resize", () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => { if (window.__m && Math.abs(W() - lastW) > 40) { lastW = W(); render(...window.__m); } }, 200); });
