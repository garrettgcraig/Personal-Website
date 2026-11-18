// Netlify function for the Devereux Slough breach outlook (/devereux/).
// GET /devereux/api/status pulls live data, runs the model in devereux/model.js and
// returns one JSON document for the page. Responses are CDN-cached for 15 minutes;
// each source's last good copy is kept in Netlify Blobs so one outage (NCEI often
// 503s) degrades the page instead of breaking it.
import { inflateRawSync } from "node:zlib";
import { getStore } from "@netlify/blobs";
import params from "../../devereux/model-params.json" with { type: "json" };
import localEvents from "../../devereux/mouth-events.json" with { type: "json" };
import { addDays, dateRange, forecast, iso, rainComposite, stageOutlook, wyStart } from "../../devereux/model.js";

const UA = { "User-Agent": "garrettgcraig.com devereux-breach (https://garrettgcraig.com/devereux/)" };
const CCBER_RAW = "https://raw.githubusercontent.com/ccber-restoration/hydrology/HEAD/";
const HORIZON = 10; // forecast days including today

// ---------------------------------------------------------------- helpers
async function fetchText(url, ms = 15000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} ${url.split("?")[0]}`);
  return r.text();
}

// RFC 4180-ish CSV parser (quoted fields, embedded commas/newlines).
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = (rows.shift() || []).map((h) => h.replace(/^﻿/, "").trim());
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

// m/d/yyyy[ ...] -> yyyy-mm-dd
function usDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || "");
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

// Minimal .xlsx reader: first worksheet as rows of cell values (no dependency).
export function readXlsx(buf) {
  const files = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let p = buf.readUInt32LE(eocd + 16);
  const n = buf.readUInt16LE(eocd + 10);
  for (let k = 0; k < n; k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    const lstart = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(lstart, lstart + csize);
    files[name] = (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
    p += 46 + nlen + xlen + clen;
  }
  const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const shared = [...(files["xl/sharedStrings.xml"] || "").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const sheet = files["xl/worksheets/sheet1.xml"] || "";
  return [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) =>
    [...r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].reduce((row, c) => {
      const col = c[1].split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] || "")?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] || "")?.[1];
      row[col] = v == null ? null : /t="s"/.test(c[2]) ? shared[Number(v)] : decode(v);
      return row;
    }, []));
}

// ---------------------------------------------------------------- sources
async function mouthLog() {
  const r = await fetch(CCBER_RAW + "data/leveloggers/Devereux_Slough_mouth_state.xlsx", { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status} mouth log`);
  const rows = readXlsx(Buffer.from(await r.arrayBuffer()));
  const head = rows.shift().map((h) => String(h || "").trim());
  const iDate = head.indexOf("date"), iState = head.indexOf("mouth_status");
  return rows
    .filter((r) => r[iDate] != null && (r[iState] === "open" || r[iState] === "closed"))
    .map((r) => ({ date: iso(Date.UTC(1899, 11, 30) + Number(r[iDate]) * 86400000), state: r[iState], source: "CCBER mouth log" }));
}

// Weekly staff-gauge water surface elevation at Venoco Bridge (ft NAVD88), from the
// newest CCBER YSI Survey123 export.
async function staffGauge() {
  const list = JSON.parse(await fetchText("https://api.github.com/repos/ccber-restoration/hydrology/contents/data/YSI"));
  const dirs = list.filter((x) => x.type === "dir" && /NCOS_YSI_Water_Quality_Monitoring_\d{4}-\d{2}-\d{2}/.test(x.name)).map((x) => x.name).sort();
  const latest = dirs.at(-1);
  const rows = parseCsv(await fetchText(`${CCBER_RAW}data/YSI/${latest}/NCOS_YSI_Water_Quality_Monitoring_0.csv`));
  const byDate = {};
  for (const r of rows) {
    const ft = Number(r["Water Surface Elevation"]);
    const d = usDate(r["Monitoring Date"]);
    if (r["Site Name"] === "venoco_bridge" && d && ft >= 2 && ft <= 12) byDate[d] = ft;
  }
  return { export: latest, readings: Object.entries(byDate).map(([date, ft]) => ({ date, ft })).sort((a, b) => a.date.localeCompare(b.date)) };
}

async function cocorahs(start, end) {
  const fmt = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
  const url = "https://data.cocorahs.org/export/exportreports.aspx?ReportType=Daily&dtf=1&Format=CSV&State=CA&County=SB"
    + `&ReportDateType=reportdate&StartDate=${fmt(start)}&EndDate=${fmt(addDays(end, 1))}`;
  const out = {};
  for (const r of parseCsv(await fetchText(url, 25000))) {
    const st = r.StationNumber;
    if (!params.rain.cocorahs[st]) continue;
    const amt = r.TotalPrecipAmt === "T" ? 0 : Number(r.TotalPrecipAmt);
    if (!Number.isFinite(amt)) continue;
    const fell = addDays(r.ObservationDate.slice(0, 10), -1); // 7 am report covers the previous day
    (out[fell] ||= {})[st] = amt;
  }
  return out;
}

async function ksba(start, end) {
  const [y1, m1, d1] = start.split("-").map(Number), [y2, m2, d2] = end.split("-").map(Number);
  const url = "https://mesonet.agron.iastate.edu/cgi-bin/request/daily.py?network=CA_ASOS&stations=SBA"
    + `&year1=${y1}&month1=${m1}&day1=${d1}&year2=${y2}&month2=${m2}&day2=${d2}&var=precip_in&format=csv`;
  const out = {};
  for (const r of parseCsv(await fetchText(url, 25000))) {
    const v = Number(r.precip_in);
    if (r.day && Number.isFinite(v) && r.precip_in !== "None") out[r.day] = Math.max(v, 0);
  }
  return out;
}

async function copGauge(start, end) {
  const url = "https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=USW00053152"
    + `&startDate=${start}&endDate=${end}&dataTypes=PRCP&units=standard&format=csv`;
  const out = {};
  for (const r of parseCsv(await fetchText(url, 10000))) {
    const v = Number(r.PRCP);
    if (r.DATE && r.PRCP !== "" && Number.isFinite(v)) out[r.DATE] = v;
  }
  return out;
}

async function openMeteo() {
  const url = "https://api.open-meteo.com/v1/forecast?latitude=34.41&longitude=-119.88&daily=precipitation_sum"
    + `&precipitation_unit=inch&timezone=America%2FLos_Angeles&forecast_days=${HORIZON}`;
  const j = JSON.parse(await fetchText(url));
  return Object.fromEntries(j.daily.time.map((d, i) => [d, j.daily.precipitation_sum[i]]));
}

const NOAA = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=9411340&datum=NAVD&units=english"
  + "&time_zone=lst_ldt&format=json&application=garrettgcraig_devereux";

async function tides(today) {
  const ymd = (d) => d.replaceAll("-", "");
  const [obs, pred, hilo] = await Promise.all([
    fetchText(`${NOAA}&product=water_level&range=72`),
    fetchText(`${NOAA}&product=predictions&interval=h&begin_date=${ymd(addDays(today, -3))}&end_date=${ymd(addDays(today, 3))}`),
    fetchText(`${NOAA}&product=predictions&interval=hilo&begin_date=${ymd(today)}&end_date=${ymd(addDays(today, 3))}`),
  ]).then((t) => t.map((x) => JSON.parse(x)));
  const pick = (arr, every = 1) => (arr || []).filter((_, i) => i % every === 0).map((x) => ({ t: x.t, ft: Number(x.v), type: x.type }));
  return { observed: pick(obs.data, 5), predicted: pick(pred.predictions), hilo: pick(hilo.predictions) };
}

async function waves() {
  const lines = (await fetchText("https://www.ndbc.noaa.gov/data/realtime2/46218.txt")).split("\n").filter((l) => l && !l.startsWith("#"));
  const rows = lines.map((l) => l.trim().split(/\s+/)).map((f) => ({
    t: `${f[0]}-${f[1]}-${f[2]}T${f[3]}:${f[4]}:00Z`,
    hs_ft: f[8] === "MM" ? null : Number(f[8]) * 3.28084,
    period_s: f[9] === "MM" ? null : Number(f[9]),
    dir_deg: f[11] === "MM" ? null : Number(f[11]),
  })).filter((r) => r.hs_ft != null);
  const cutoff = Date.now() - 72 * 3600000;
  return { station: "NDBC 46218 Harvest", series: rows.filter((r) => Date.parse(r.t) >= cutoff).reverse(), latest: rows[0] || null };
}

// ---------------------------------------------------------------- assembly
function store() {
  try { return getStore({ name: "devereux" }); } catch { return null; }
}

// Run a source; on success save it, on failure fall back to the last good copy.
async function withFallback(name, fn, blobs, status) {
  try {
    const v = await fn();
    status[name] = { ok: true, at: new Date().toISOString() };
    if (blobs) await blobs.setJSON(`last-${name}`, { at: new Date().toISOString(), v }).catch(() => {});
    return v;
  } catch (e) {
    const last = blobs ? await blobs.get(`last-${name}`, { type: "json" }).catch(() => null) : null;
    status[name] = { ok: false, error: String(e.message || e), stale_from: last?.at ?? null };
    return last?.v ?? null;
  }
}

export async function buildStatus(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
  const start = wyStart(addDays(today, -120)); // full water year(s) for season-to-date rain
  const yesterday = addDays(today, -1);
  const blobs = store();
  const status = {};
  const [log, staff, coco, sba, cop, om, tide, wave] = await Promise.all([
    withFallback("mouth_log", mouthLog, blobs, status),
    withFallback("staff_gauge", staffGauge, blobs, status),
    withFallback("cocorahs", () => cocorahs(start, yesterday), blobs, status),
    withFallback("ksba", () => ksba(start, today), blobs, status),
    withFallback("cop_gauge", () => copGauge(start, yesterday), blobs, status),
    withFallback("open_meteo", openMeteo, blobs, status),
    withFallback("tides", () => tides(today), blobs, status),
    withFallback("waves", waves, blobs, status),
  ]);

  // Mouth state: latest event from the CCBER log or the site's own event list.
  const events = [...(log || []), ...localEvents.events.map((e) => ({ ...e, source: e.source || "site log" }))]
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = events.at(-1);
  const warnings = [];
  if (!last) warnings.push("No mouth-state record could be loaded.");

  // Rain: observed composite before today, Open-Meteo from today on.
  const past = dateRange(start, yesterday);
  const rain = rainComposite(past, { cop: cop || {}, ksba: sba || {}, cocorahs: coco || {} }, params);
  for (const d of dateRange(today, addDays(today, HORIZON - 1))) {
    rain.push({ date: d, rain_in: om?.[d] ?? null, src: om?.[d] == null ? "missing" : "forecast (Open-Meteo)" });
  }
  const missing = rain.filter((r) => r.rain_in == null && r.date >= addDays(today, -30)).length;
  if (missing) warnings.push(`${missing} recent or forecast days have no rain data and are treated as dry.`);

  const readings = staff?.readings || [];
  const latest = readings.filter((r) => r.date <= today && r.date >= start).at(-1) || null;
  const mouthOpen = last?.state === "open";
  // A reading only counts if no breach happened after it (the slough drains when the
  // mouth opens) and it is at most 45 days old; otherwise use the rain model alone.
  const lastOpen = events.filter((e) => e.state === "open").at(-1)?.date;
  const stale = latest && daysSince(latest.date, today) > 45;
  const preBreach = latest && lastOpen && latest.date < lastOpen;
  const stage0 = latest && !stale && !preBreach ? latest : null;
  let outlook = [];
  let stageSeries = [];
  if (last && !mouthOpen) {
    outlook = forecast({ rain, today, closedSince: last.date, stage0, params, showFrom: addDays(today, -14) });
    if (stage0) {
      // level (with range) and crest from the latest reading on, for the level chart
      const crest = Object.fromEntries(forecast({ rain, today, closedSince: last.date, stage0, params, showFrom: stage0.date })
        .map((r) => [r.date, r.crest_ft]));
      stageSeries = stageOutlook({ rain, today, closedSince: last.date, stage0, params })
        .map((r) => ({ ...r, crest_ft: crest[r.date] ?? null }));
      if (daysSince(stage0.date, today) > 21) warnings.push("The latest staff-gauge reading is more than three weeks old, so the slough level is less certain.");
    } else {
      warnings.push(preBreach
        ? "No staff-gauge reading since the last breach, so the outlook uses rain alone."
        : "No staff-gauge reading in the last 45 days, so the outlook uses rain alone.");
    }
  }
  const todayRow = outlook.find((r) => r.date === today) || null;
  const ahead = outlook.filter((r) => r.date >= today);
  const peak = ahead.reduce((m, r) => (r.p > (m?.p ?? -1) ? r : m), null);

  return {
    generated_at: now.toISOString(),
    today,
    mouth: last ? {
      state: last.state, since: last.date, days: daysSince(last.date, today), source: last.source,
      recent_events: events.slice(-6).reverse(),
    } : null,
    stage: latest ? {
      latest_reading: latest,
      used: Boolean(stage0),
      today_est_ft: todayRow?.stage_ft ?? null,
      crest_today_ft: todayRow?.crest_ft ?? null,
      readings: readings.slice(-16),
      series: stageSeries,
      export: staff?.export ?? null,
    } : null,
    outlook,
    peak,
    recent: {
      rain: rain.filter((r) => r.date >= addDays(today, -30) && r.date < today),
      season_rain_in: rain.filter((r) => r.date >= wyStart(today) && r.date < today).reduce((a, r) => a + (r.rain_in || 0), 0),
      tides: tide,
      waves: wave,
    },
    model: { exported: params.exported, thresholds: params.thresholds, skill: params.skill, crest: params.unified },
    sources: status,
    warnings,
  };
}

const daysSince = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export default async (req) => {
  if (req.method !== "GET") return new Response("Not found", { status: 404 });
  const body = JSON.stringify(await buildStatus());
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Netlify-CDN-Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
    },
  });
};

export const config = { path: "/devereux/api/status" };
