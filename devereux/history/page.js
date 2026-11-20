// The History tab: how the mouth cycle works, satellite views, and every breach, closure and
// overtopping event since the 2018–19 season (events.json, from scripts/build_devereux_events.py).

import { esc, COLORS, css, OBS, PRED, chart, legend, fullW, wide } from "../shared.js";

const app = document.getElementById("app");

// ------------------------------------------------------------- events: breaches, closures, overtopping
let EVENTS = null; // events.json, from the Python project (scripts/build_devereux_events.py)
let evFilter = "all";
let evAll = false; // show every row (else the newest 12)
const EV_FILTERS = { all: "All", first: "Season's first breaches", later: "Later breaches", closure: "Closures", overtopping: "Overtopping", summer: "Summer overtopping" };
const evDate = (iso) => new Date(iso + ":00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const evTime = (iso) => new Date(iso + ":00Z").toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
const ft2 = (v) => (v == null ? "" : `${v.toFixed(1)} ft`);

function eventRows() {
  const ev = (EVENTS?.events || []).filter((e) => evFilter === "all" || (evFilter === "summer" ? e.type === "overtopping" && e.summer : evFilter === "first" || evFilter === "later" ? e.cat === evFilter : e.type === evFilter));
  const rows = ev.slice().reverse();
  const more = document.getElementById("ev-more");
  if (more) { more.hidden = evAll || rows.length <= 12; more.textContent = `Show all ${rows.length}`; }
  return rows.slice(0, evAll ? undefined : 12).map((e) => {
    const sameDay = e.start.slice(0, 10) === e.end.slice(0, 10);
    const when = e.type === "overtopping" && !sameDay ? `${evDate(e.start)} to ${evDate(e.end).replace(/, \d{4}$/, "")}` : evDate(e.start);
    const what = { breach: e.cat === "first" ? "Season's first breach" : "Later breach", closure: "Closure", overtopping: e.summer ? "Overtopping (summer)" : "Overtopping", pulse: "Tide pulse" }[e.type] ?? e.type;
    const detail = e.type === "breach" ? (e.peak_level_ft != null ? `peaked at ${ft2(e.peak_level_ft)}` : "no hourly level record") + (e.closedDays != null ? `, after ${e.closedDays} days closed` : "")
      : e.type === "closure" ? `level ${ft2(e.peak_level_ft)}`
      : `+${(e.total_rise_ft ?? 0).toFixed(2)} ft; tide ${ft2(e.tide_high_ft)}${e.surge_ft != null ? `, ${e.surge_ft >= 0 ? "+" : ""}${e.surge_ft.toFixed(1)} ft vs predicted` : ""}`;
    return `<tr class="ev-${e.type}"><td>${esc(when)}</td><td><span class="ev-tag ev-${e.type}${e.cat ? " ev-" + e.cat : ""}">${esc(what)}</span>${e.provisional ? ` <span class="ev-prov" title="Found in or moved by the level record; awaiting review">provisional</span>` : ""}</td><td>${esc(detail)}</td><td class="ev-note">${esc(e.note)}</td></tr>`;
  }).join("");
}

function exampleChart(x) {
  const H = (iso) => Date.parse(iso + ":00Z") / 3600000; // local clock hours
  const pts = x.hourly.map(([t, lv, o, p]) => ({ h: H(t), lv, o, p }));
  const ys = pts.flatMap((q) => [q.lv, q.o]).filter((v) => v != null);
  const xs = pts.map((q) => q.h);
  const mids = []; for (let h = Math.ceil(xs[0] / 24) * 24; h <= xs.at(-1); h += 24) mids.push(h);
  return chart({
    width: wide() ? Math.round((fullW() - 40) / 2) : fullW(), height: 190,
    yMin: Math.floor(Math.min(...ys) - 0.3), yMax: Math.ceil(Math.max(...ys) + 0.3), yFmt: (v) => v.toFixed(0), yLabel: "water level, ft NAVD88",
    bands: [{ x0: H(x.start), x1: H(x.end) + 1, color: COLORS.ochre, opacity: 0.16 }],
    series: [
      { type: "line", color: PRED(), width: 1.2, dash: "3 3", points: pts.map((q) => ({ x: q.h, y: q.p })) },
      { type: "line", color: OBS(), width: 1.4, opacity: 0.85, points: pts.map((q) => ({ x: q.h, y: q.o })) },
      { type: "line", color: css("--color-text"), width: 2.2, points: pts.map((q) => ({ x: q.h, y: q.lv })) },
    ],
    xTicks: mids, xFmt: (h) => new Date(h * 3600000).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }),
  });
}

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-evmore]")) { evAll = true; document.getElementById("ev-rows").innerHTML = eventRows(); return; }
  const b = e.target.closest("[data-evf]");
  if (!b) return;
  evFilter = b.dataset.evf;
  document.querySelectorAll("[data-evf]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  document.getElementById("ev-rows").innerHTML = eventRows();
});

// ------------------------------------------------------------- satellite frames
// The clearest image of each stage of the cycle. Sentinel-2 L2A true color (10 m) for the
// stages only a frequent satellite catches; USDA NAIP aerial photos (0.6 m, flown in late spring
// or summer every two years) where one fits. Levels are the re-leveled daily means.
const SAT = "/devereux/media/satellite/";
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
  document.querySelectorAll(".frames .strip button, ol.stages button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.frame) === frameIdx)));
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

// ------------------------------------------------------------- breach gallery (Nov 15, 2025)
const MEDIA = "/devereux/media/breach-2025-11-15/";
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

// ------------------------------------------------------------- seasons
// Water year: October through September, named for the year it ends in.
const LOGGED_FROM = "2018-10-01";
const wyOf = (iso) => +iso.slice(0, 4) + (+iso.slice(5, 7) >= 10 ? 1 : 0);
const median = (a) => { const b = a.slice().sort((x, y) => x - y), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : null; };
const daysBetween = (a, b) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);

// Tag each breach as the season's first or a later one, and note how long the berm held.
function classify(events) {
  const seen = new Set();
  let lastClose = null;
  for (const e of events) {
    if (e.type === "closure") lastClose = e.start;
    if (e.type !== "breach") continue;
    const wy = wyOf(e.start);
    e.cat = seen.has(wy) ? "later" : "first";
    seen.add(wy);
    e.closedDays = lastClose ? daysBetween(lastClose, e.start) : null;
    lastClose = null;
  }
}

// One row per water year: when the berm was closed (shaded), breaches, closures and overtopping.
function seasonTimeline(events) {
  const mouth = events.filter((e) => e.type === "breach" || e.type === "closure");
  const first = wyOf(events[0].start), last = wyOf(new Date().toISOString().slice(0, 10));
  const years = []; for (let y = last; y >= first; y--) years.push(y);
  const W = fullW(), rowH = 30, m = { l: 64, r: 12, t: 26, b: 8 }, H = m.t + years.length * rowH + m.b;
  const X = (d) => m.l + (d / 365) * (W - m.l - m.r);
  const doy = (iso, wy) => (Date.parse(iso.slice(0, 10)) - Date.UTC(wy - 1, 9, 1)) / 86400000;
  const today = new Date().toISOString().slice(0, 10);
  // closed spans: closed from the start of the record until the first breach, then by the log
  const spans = []; let state = "closed", from = `${first - 1}-10-01`;
  for (const e of mouth) {
    const s = e.type === "breach" ? "open" : "closed";
    if (s !== state) { if (state === "closed") spans.push([from, e.start]); state = s; from = e.start; }
  }
  if (state === "closed") spans.push([from, today]);
  const breachC = css("--breach"), muted = css("--color-muted"), skyC = document.body.classList.contains("dark-mode") ? COLORS.mist : COLORS.sky;
  let g = "";
  const months = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
  months.forEach((mo, k) => {
    const x = X(doy(`${2001 + (k < 3 ? -1 : 0)}-${String(((k + 9) % 12) + 1).padStart(2, "0")}-01`, 2001));
    g += `<line class="grid" x1="${x}" x2="${x}" y1="${m.t - 4}" y2="${H - m.b}"/>${W > 560 || k % 2 === 0 ? `<text x="${x + 3}" y="${m.t - 10}">${mo}</text>` : ""}`;
  });
  years.forEach((wy, i) => {
    const y = m.t + i * rowH + rowH / 2;
    g += `<text x="${m.l - 8}" y="${y + 4}" text-anchor="end">${wy - 1}–${String(wy).slice(2)}</text>`;
    const a = `${wy - 1}-10-01`, b = `${wy}-10-01`;
    for (const [s0, s1] of spans) {
      const lo = s0 > a ? s0 : a, hi = (s1 < b ? s1 : b) > today ? today : (s1 < b ? s1 : b);
      if (lo >= hi) continue;
      g += `<rect x="${X(doy(lo, wy)).toFixed(1)}" y="${y - 5}" width="${Math.max(1, X(doy(hi, wy)) - X(doy(lo, wy))).toFixed(1)}" height="10" rx="2" fill="${muted}" opacity="0.22"/>`;
    }
    for (const e of events.filter((e) => wyOf(e.start) === wy)) {
      const x = X(doy(e.start, wy)).toFixed(1);
      const t = `<title>${esc(evDate(e.start))}: ${esc(e.type === "breach" ? (e.cat === "first" ? "season's first breach" : "later breach") : e.type)}${e.peak_level_ft != null && e.type === "breach" ? `, ${e.peak_level_ft.toFixed(1)} ft` : ""}${e.provisional ? " (provisional)" : ""}</title>`;
      if (e.type === "breach" && e.cat === "first") g += `<circle cx="${x}" cy="${y}" r="7" fill="${breachC}">${t}</circle>`;
      else if (e.type === "breach") g += `<circle cx="${x}" cy="${y}" r="5.5" fill="var(--color-bg)" stroke="${breachC}" stroke-width="2.2">${t}</circle>`;
      else if (e.type === "closure") g += `<line x1="${x}" x2="${x}" y1="${y - 7}" y2="${y + 7}" stroke="${muted}" stroke-width="2.4">${t}</line>`;
      else g += `<path d="M${x},${y - 7} l-4.5,-8 h9Z" fill="${skyC}">${t}</path>`;
    }
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mouth events by water year">${g}</svg>`;
}

// Legend for the season timeline, drawn with the same marks as the chart
function timelineLegend() {
  const breachC = css("--breach"), muted = css("--color-muted"), skyC = document.body.classList.contains("dark-mode") ? COLORS.mist : COLORS.sky;
  const sw = (inner, w = 18) => `<svg width="${w}" height="16" viewBox="0 0 ${w} 16" aria-hidden="true">${inner}</svg>`;
  const items = [
    [sw(`<circle cx="9" cy="8" r="6" fill="${breachC}"/>`), "season's first breach"],
    [sw(`<circle cx="9" cy="8" r="5" fill="none" stroke="${breachC}" stroke-width="2.2"/>`), "later breach"],
    [sw(`<line x1="9" x2="9" y1="1" y2="15" stroke="${muted}" stroke-width="2.4"/>`), "closure"],
    [sw(`<path d="M9,13 l-4.5,-8 h9Z" fill="${skyC}"/>`), "overtopping"],
    [sw(`<rect x="1" y="3" width="24" height="10" rx="2" fill="${muted}" opacity="0.22"/>`, 26), "mouth closed"],
  ];
  return `<div class="legend tl-legend">${items.map(([m, l]) => `<span>${m}${esc(l)}</span>`).join("")}</div>`;
}

// ------------------------------------------------------------- days open to the tide
// Reviewed mouth record by water year (devereux-breach, CCBER mouth log with Garrett's
// corrections; the breach day counts as open). Seasons after the last row are computed
// live from the event record. partial: level logging covered only part of the year.
const MOUTH_YEARS = [
  { wy: 2019, open: 73, closed: 292, openings: 1, longest: 73, span: "Jan 7 to Mar 20" },
  { wy: 2020, open: 17, closed: 349, openings: 2, longest: 10 },
  { wy: 2021, open: 18, closed: 347, openings: 1, longest: 18, partial: true },
  { wy: 2022, open: 24, closed: 341, openings: 1, longest: 24 },
  { wy: 2023, open: 46, closed: 319, openings: 4, longest: 35, span: "Dec 31 to Feb 3", partial: true },
  { wy: 2024, open: 40, closed: 322, leaky: 4, openings: 4, longest: 19, partial: true },
  { wy: 2025, open: 21, closed: 344, openings: 2, longest: 18 },
  { wy: 2026, open: 99, closed: 266, openings: 2, longest: 83, span: "Nov 15 to Feb 5" },
];
const isoAdd = (iso, k) => new Date(Date.parse(`${iso}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
// the season in progress, from breaches and closures since Oct 1, through yesterday
function currentMouthYear(ev) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" });
  const wy = +today.slice(0, 4) + (+today.slice(5, 7) >= 10 ? 1 : 0);
  if (wy <= MOUTH_YEARS.at(-1).wy) return null;
  const start = `${wy - 1}-10-01`, end = isoAdd(today, -1);
  if (end < start) return null;
  const all = [...ev].filter((e) => e.type === "breach" || e.type === "closure").sort((a, b) => a.start.localeCompare(b.start));
  const before = all.filter((e) => e.start.slice(0, 10) < start).at(-1);
  let open = before?.type === "breach" ? start : null, nOpen = 0, openings = 0, longest = 0;
  for (const e of all.filter((e) => e.start.slice(0, 10) >= start && e.start.slice(0, 10) <= end)) {
    const d = e.start.slice(0, 10);
    if (e.type === "breach" && !open) { open = d; openings++; }
    if (e.type === "closure" && open) { const k = daysBetween(open, d); nOpen += k; longest = Math.max(longest, k); open = null; }
  }
  if (open) { const k = daysBetween(open, end) + 1; nOpen += k; longest = Math.max(longest, k); }
  const total = daysBetween(start, end) + 1;
  return { wy, open: nOpen, closed: total - nOpen, openings, longest, current: true, through: end };
}
function mouthYearsHtml(ev) {
  const cur = currentMouthYear(ev), rows = cur ? [...MOUTH_YEARS, cur] : MOUTH_YEARS;
  const max = Math.max(...rows.map((r) => r.open)), med = median(MOUTH_YEARS.map((r) => r.open));
  const sd = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const wyLabel = (r) => `${r.wy - 1}–${String(r.wy).slice(2)}${r.partial ? "*" : ""}${r.current ? ` <span class="muted sub">so far, to ${sd(r.through)}</span>` : ""}`;
  return `
    <p class="intro">Most of the year the berm keeps the slough closed. After a breach it is open to the ocean and rises and falls with the tide until waves seal it again. A typical year has about ${Math.round(med / 5) * 5} of these tidal days; the longest stretches came in 2018–19 and 2025–26, when the mouth stayed open for more than two months.</p>
    <div class="table-scroll"><table class="days mouth-years">
      <thead><tr><th>Water year</th><th>Tidal days</th><th></th><th>Closed days</th><th>Openings</th><th>Longest open</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.current ? "today" : ""}"><td>${wyLabel(r)}</td><td>${r.open}</td><td class="mbar"><span style="width:${max ? (100 * r.open) / max : 0}%"></span></td><td>${r.closed}${r.leaky ? "†" : ""}</td><td>${r.openings}</td><td>${r.openings ? `${r.longest} days${r.span ? ` <span class="muted sub">${r.span}</span>` : ""}` : "none"}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="note">Water years run October 1 to September 30. A breach day counts as open. Every opening on record began with a rain breach, and nearly all tidal days fall between November and April. From CCBER's mouth log with corrections checked against the level record; the season in progress is counted from the events below. * Level logging covered only part of that year, so the mouth record leans more on CCBER's log. † Plus 4 days in February 2024 when king tides seeped through a closed berm.</p>`;
}

// ------------------------------------------------------------- render
function render() {
  const ev = EVENTS.events;
  const n = (f) => ev.filter(f).length;
  const firsts = ev.filter((e) => e.cat === "first"), laters = ev.filter((e) => e.cat === "later");
  const pk = (a) => a.map((e) => e.peak_level_ft).filter((v) => v != null);
  const mf = median(pk(firsts)), ml = median(pk(laters));
  const rng = (a) => (a.length ? `${Math.min(...a).toFixed(1)} to ${Math.max(...a).toFixed(1)} ft` : "");
  const cd = (a) => median(a.map((e) => e.closedDays).filter((v) => v != null));
  const no = n((e) => e.type === "overtopping"), ns = n((e) => e.type === "overtopping" && e.summer);
  const nu = n((e) => e.type !== "overtopping" && e.logged === false);
  const breachC = css("--breach"), skyC = document.body.classList.contains("dark-mode") ? COLORS.mist : COLORS.sky;
  const cards = [
    ["first", "Season's first breaches", firsts.length, mf != null ? `median peak ${mf.toFixed(1)} ft (${rng(pk(firsts))}), after a median ${cd(firsts)} days closed` : ""],
    ["later", "Later breaches", laters.length, ml != null ? `median peak ${ml.toFixed(1)} ft (${rng(pk(laters))}), after a median ${cd(laters)} days closed` : ""],
    ["closure", "Closures", n((e) => e.type === "closure"), "waves rebuild the berm and seal the mouth"],
    ["overtopping", "Overtopping", no, `big high tides washing over the closed berm, ${ns} of them in May through October`],
  ];
  app.innerHTML = `
  <section class="page-intro">
    <h1>How the slough opens and closes</h1>
    <div class="prose">
      <p>Devereux Slough is a small coastal lagoon at Coal Oil Point that drains a watershed of about 2.5 square miles. For most of the year a sand berm, built by waves, cuts it off from the ocean. While the mouth is closed, the slough gains water from rain, runoff and the occasional high tide washing over the berm, and loses it slowly to evaporation and seepage.</p>
      <p>Once the mouth closes in spring, waves keep piling sand onto the berm through summer and fall, so by the first big winter storm it stands well above the water. That is why <strong>the season's first breach</strong> usually needs a full slough: since 2019 it has broken at a median ${mf?.toFixed(1)} ft. When water tops the berm it cuts a channel, and the slough drains to about 4 ft within hours and then rises and falls with the tide.</p>
      <p>Waves usually close the mouth again within days to weeks, but the new berm starts out low. <strong>Later breaches</strong> in the same season have come at a median ${ml?.toFixed(1)} ft, often after only a few weeks closed. A young berm can fail with a lot less water behind it, so the Breach Watch model counts how long the berm has been building since the last closure, and the Outlook's breach-level line starts low after each closure and rises over about two months.</p>
      <p><strong>Overtopping</strong> happens when the biggest high tides, with waves running up on top of them, wash over a closed berm and raise the slough by a few hundredths of a foot to about half a foot. It is mostly a winter event, but it shows up in summer when sea level runs high, as it did through 2026. The Breach Watch model doesn't use tides.</p>
    </div>
  </section>

  <section class="block" id="satellite">
    <h2>The cycle from space</h2>
    <div class="sat-split">
      ${framesHtml()}
      <ol class="stages">${FRAMES.map((f, k) => `<li><button type="button" data-frame="${k}" aria-pressed="${k === frameIdx}"><strong>${esc(f.label)}</strong> <span class="when">${esc(f.date)}</span><span class="txt">${esc(f.text)}</span></button></li>`).join("")}</ol>
    </div>
  </section>

  <section class="block" id="seasons">
    <h2>Every season since 2018</h2>
    <div class="ev-cards">${cards.map(([k, l, c, d]) => `<button type="button" class="ev-card ev-${k}" data-evf="${k}"><span class="ev-card-n">${c}</span><span class="ev-card-l">${esc(l)}</span><span class="ev-card-d">${esc(d)}</span></button>`).join("")}</div>
    ${timelineLegend()}
    <div class="table-scroll">${seasonTimeline(ev)}</div>
    <p class="note">Water years run October to September. Seasons start with 2018–19, when level logging began on October 1, 2018.${nu ? ` ${nu} events were found in the level record rather than CCBER's log, and each was reviewed against it.` : ""}</p>
  </section>

  <section class="block" id="tidal-days">
    <h2>Days open to the tide, by year</h2>
    ${mouthYearsHtml(ev)}
  </section>

  <section class="block" id="overtopping">
    <h2>Overtopping, up close</h2>
    ${legend([[css("--color-text"), "slough level", "line"], [OBS(), "tide, observed (NOAA Santa Barbara)", "line"], [PRED(), "tide, predicted", "dash"], [COLORS.ochre, "overtopping event", "vband", 0.3]])}
    <div class="ev-examples">${EVENTS.examples.map((x) => `
      <figure class="ev-example">
        ${exampleChart(x)}
        <figcaption><strong>${esc(x.title)}.</strong> ${esc(x.text)}</figcaption>
      </figure>`).join("")}</div>
    <p class="note">Hourly slough level and NOAA 9411340 tide, both in ft NAVD88 on the same axis, Pacific time. Tides and surge are shown for context; the breach model doesn't use them.</p>
  </section>

  <section class="block" id="events">
    <h2>All events</h2>
    <div class="controls" role="group" aria-label="Event filter">${Object.entries(EV_FILTERS).map(([k, l]) => `<button type="button" data-evf="${k}" aria-pressed="${k === evFilter}">${l}</button>`).join("")}</div>
    <div class="ev-table-wrap"><table class="days ev-table"><thead><tr><th>When</th><th>Event</th><th>Details</th><th>Note</th></tr></thead><tbody id="ev-rows"></tbody></table></div>
    <p><button type="button" class="ev-more" id="ev-more" data-evmore>Show all</button></p>
  </section>

  <section class="block" id="gallery">
    <h2>The November 15, 2025 breach</h2>
    <p class="intro">A 5-inch storm raised the slough from 5.7 to about 9.4 ft over two and a half days. Late on the afternoon of November 15 water began running over the berm and cut a channel, and by dark the slough was pouring into the ocean; the live sensor shows it dropping almost 5 ft in six hours. Photos and muted video from that afternoon and evening, in order.</p>
    <div class="gallery">${GALLERY.map((g, i) => `<button type="button" data-gallery="${i}" aria-label="${esc(g.alt)}"><span class="ph"><img src="${MEDIA}${g.thumb}" alt="" loading="lazy" decoding="async" />${g.video ? `<span class="play" aria-hidden="true"><svg viewBox="0 0 10 12"><path d="M0 0L10 6L0 12Z"/></svg></span>` : ""}</span>${esc(g.time)}${g.video ? `, video ${g.video}` : ""}</button>`).join("")}</div>
  </section>`;
  document.getElementById("ev-rows").innerHTML = eventRows();
}
// the cards double as filters: jump to the table
document.addEventListener("click", (e) => {
  const c = e.target.closest(".ev-card");
  if (c) document.getElementById("events")?.scrollIntoView({ behavior: "smooth" });
});

let lastW = 0;
addEventListener("resize", () => {
  clearTimeout(window.__rz);
  window.__rz = setTimeout(() => { if (EVENTS && Math.abs(fullW() - lastW) > 40) { lastW = fullW(); render(); } }, 200);
});
fetch("/devereux/events.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((j) => {
  EVENTS = j; classify(EVENTS.events);
  // level logging starts Oct 1, 2018 (water year 2019): earlier seasons have no measured
  // levels, so they're left out (classify ran on the full log so berm ages stay right)
  EVENTS.events = EVENTS.events.filter((e) => e.start >= LOGGED_FROM); lastW = fullW(); render(); initGallery();
  new MutationObserver(() => render()).observe(document.body, { attributes: true, attributeFilter: ["class"] });
}).catch((e) => { app.innerHTML = `<div class="loading">Couldn't load the event record (${esc(e.message)}).</div>`; });
