// Shared helpers for the Devereux pages (Outlook and History): formatting, colors, and the
// tiny inline-SVG chart.
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const tz = "America/Los_Angeles";
export const day = (iso, opts = { weekday: "short", month: "short", day: "numeric" }) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", opts);
export const COLORS = { sky: "#2D5A7B", ochre: "#D3A43B", sage: "#5E6E3A", clay: "#A65A3C", mesa: "#6B4A73", mist: "#7FA3BD" };
export const css = (v) => getComputedStyle(document.body).getPropertyValue(v).trim();

// ------------------------------------------------------------- tiny SVG charts
// series: [{type: "bar"|"line"|"dots"|"step", points: [{x: Date|number, y}], color, width, opacity, dash}]
// y2 (optional): a second, right-hand axis, either bars that hang down from the top of the
// plot (a hyetograph): {bars: [{x0, x1, y, color, title}], max, fmt, label}, or dots on a
// normal axis: {dots: [{x, y, title}], min, max, fmt, label, color}.
let clipSeq = 0;
export function chart({ series, width = 680, height = 200, yMin = 0, yMax, yFmt = (v) => v, xTicks, xFmt, now, bands = [], hlines = [], vlines = [], xMin, xMax, y2, left = 40, yLabel }) {
  const W = width, H = height, m = { l: left + (yLabel ? 16 : 0), r: y2 ? 44 : 12, t: 10, b: 24 };
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
  if (yLabel) g += `<text x="10" y="${m.t + (H - m.t - m.b) / 2}" text-anchor="middle" transform="rotate(-90 10 ${m.t + (H - m.t - m.b) / 2})">${esc(yLabel)}</text>`;
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
  // clip the data to the plot area so lines that run past the range don't spill over the axes
  const cid = `plot-${++clipSeq}`;
  g += `<clipPath id="${cid}"><rect x="${m.l}" y="${m.t - 6}" width="${W - m.l - m.r}" height="${H - m.t - m.b + 12}"/></clipPath><g clip-path="url(#${cid})">`;
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
  g += `</g>`;
  if (now != null) g += `<line x1="${X(now)}" x2="${X(now)}" y1="${m.t}" y2="${H - m.b}" stroke="${css("--color-muted")}" stroke-width="1"/><text x="${X(now) + 4}" y="${m.t + 10}">now</text>`;
  for (const t of xTicks || []) g += `<text x="${X(t)}" y="${H - 6}" text-anchor="middle">${esc(xFmt(t))}</text>`;
  g += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${Y(bot)}" y2="${Y(bot)}"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}
// items: [color, label, kind, opacity]. Each swatch is drawn the way the item appears in its
// chart: "line" / "dash" (a series over time), "vline" (a mark on one date), "dot", "bar"
// (bars standing on the axis), "hang" (bars hanging from the top, as rain on the level chart),
// "lollipop" (a stem with a dot), "band" (a shaded range) or "vband" (a shaded span of time);
// anything else is a plain square.
const SWATCH = {
  line: (c) => `<line x1="1" x2="17" y1="6" y2="6" stroke="${c}" stroke-width="2"/>`,
  dash: (c) => `<line x1="1" x2="17" y1="6" y2="6" stroke="${c}" stroke-width="2" stroke-dasharray="4 3"/>`,
  vline: (c) => `<line x1="9" x2="9" y1="0" y2="12" stroke="${c}" stroke-width="2"/>`,
  dot: (c) => `<circle cx="9" cy="6" r="4" fill="${c}"/>`,
  bar: (c) => `<rect x="2" y="5" width="6" height="7" rx="1" fill="${c}"/><rect x="10" y="1" width="6" height="11" rx="1" fill="${c}"/>`,
  hang: (c) => `<rect x="2" y="0" width="6" height="11" fill="${c}"/><rect x="10" y="0" width="6" height="6" fill="${c}"/>`,
  lollipop: (c) => `<line x1="9" x2="9" y1="12" y2="4" stroke="${c}" stroke-width="2"/><circle cx="9" cy="4" r="3.2" fill="${c}"/>`,
  band: (c) => `<rect x="0" y="2.5" width="18" height="7" fill="${c}"/>`,
  vband: (c) => `<rect x="4" y="0" width="10" height="12" fill="${c}"/>`,
};
export const legend = (items) => `<div class="legend">${items.map(([c, l, kind, op]) => `<span><svg class="sw" viewBox="0 0 18 12" aria-hidden="true"${op != null ? ` opacity="${op}"` : ""}>${(SWATCH[kind] || ((col) => `<rect x="3" y="1" width="12" height="10" rx="1" fill="${col}"/>`))(c)}</svg>${esc(l)}</span>`).join("")}</div>`;
export const dayNum = (iso) => Date.parse(`${iso}T12:00:00Z`) / 86400000;
export const everyN = (arr, n) => arr.filter((_, i) => i % n === 0);
// evenly spaced day ticks (every `step` days) across [a, b]
export const dayTicks = (a, b, step) => { const out = []; for (let x = Math.ceil(a); x <= b; x += step) out.push(x); return out; };
export const shortDay = (x) => day(new Date(x * 86400000).toISOString().slice(0, 10), { month: "short", day: "numeric" });

// Chart widths follow the layout (viewBox = rendered width), so axis text stays at 11px.
export const fullW = () => Math.max(300, Math.round(document.getElementById("app")?.clientWidth || 1100));
export const wide = () => fullW() > 900;
