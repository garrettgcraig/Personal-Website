// Tests for the Devereux Slough breach model port (devereux/model.js).
// Run with: node --test tests/devereux-model.test.mjs
// Expected values come from the Python project (devereux-breach/src/forecast.py)
// for the same synthetic inputs, so a drift between the two shows up here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dateRange, forecast, rainComposite, crestFt, stageOutlook, detectMouthEvents, chanceWithin, breachWindow, levelOf } from "../devereux/model.js";
import { parseCsv, restOfToday } from "../netlify/functions/devereux-api.mjs";

const params = JSON.parse(readFileSync(new URL("../devereux/model-params.json", import.meta.url)));

test("forecast matches the Python crest-curve model on a synthetic December storm", () => {
  const days = dateRange("2026-10-01", "2026-12-31");
  const storm = { "2026-12-01": 0.8, "2026-12-02": 2.4, "2026-12-03": 0.6 };
  const rain = days.map((d) => ({ date: d, rain_in: storm[d] ?? 0, src: "test" }));
  const args = { rain, today: "2026-12-01", closedSince: "2026-03-07", stage0: { date: "2026-11-20", ft: 8.5 }, params };
  const out = forecast(args);
  // [stage ft, score, crest ft] from WaterBalance.run_from and Unified.prob (src/model.py, src/unified.py)
  const expected = {
    "2026-12-01": [8.791073, 0.000582, 9.714543],
    "2026-12-02": [10.248057, 0.963756, 9.715296],
    "2026-12-03": [11.305315, 0.997933, 9.716036],
    "2026-12-04": [11.537135, 0.996354, 9.716764],
  };
  for (const [date, [stage, p, crest]] of Object.entries(expected)) {
    const r = out.find((x) => x.date === date);
    assert.ok(Math.abs(r.stage_ft - stage) < 1e-4, `${date} stage ${r.stage_ft} vs ${stage}`);
    assert.ok(Math.abs(r.p - p) < 1e-4, `${date} p ${r.p} vs ${p}`);
    assert.ok(Math.abs(r.crest_ft - crest) < 1e-4, `${date} crest ${r.crest_ft} vs ${crest}`);
    assert.equal(r.model, "level + rain");
  }
  assert.equal(out.find((x) => x.date === "2026-12-01").level, "low");
  assert.equal(out.find((x) => x.date === "2026-12-02").level, "likely");
  // a fresh berm can't be lower than the water it held back when it closed
  const fl = forecast({ ...args, closedSince: "2026-11-25", crestFloor: 8.4 });
  assert.equal(fl.find((x) => x.date === "2026-12-01").crest_ft, 8.4);
  // no usable reading: fall back to the rain-only model
  for (const r of forecast({ ...args, stage0: null })) {
    assert.equal(r.p, r.p_rain);
    assert.equal(r.model, "rain only");
  }
});

test("levels: each score maps to the highest level whose cutoff it meets", () => {
  const L = params.levels;
  assert.deepEqual(L.map((l) => l.key), ["low", "watch", "warning", "likely"]);
  assert.equal(levelOf(0, L).key, "low");
  assert.equal(levelOf(L[1].min, L).key, "watch");
  assert.equal(levelOf(0.99, L).key, "likely");
  assert.equal(L[1].caught, params.levels_record.breaches, "Watch caught every recorded breach");
});

test("rain composite rescales KSBA timing to the local CoCoRaHS storm total", () => {
  const days = ["2026-11-12", "2026-11-13", "2026-11-14"];
  const ksba = { "2026-11-12": 0.02, "2026-11-13": 0.19, "2026-11-14": 0 };
  const cocorahs = { "2026-11-13": { "CA-SB-30": 0.38, "CA-SB-23": 0.38 * 1.04 } };
  const out = rainComposite(days, { ksba, cocorahs }, params);
  const total = out.reduce((a, r) => a + r.rain_in, 0);
  assert.ok(Math.abs(total - 0.38) < 1e-9, `storm total ${total}`);
  assert.equal(out[1].src, "KSBA + CoCoRaHS");
  // the gauge wins whenever it reported
  assert.equal(rainComposite(days, { cop: { "2026-11-13": 0.5 }, ksba, cocorahs }, params)[1].rain_in, 0.5);
});

test("berm crest rebuilds from c0 toward c_inf", () => {
  const c = params.unified;
  assert.ok(Math.abs(crestFt(0, c) - c.c0) < 1e-9);
  assert.ok(crestFt(30, c) < crestFt(120, c));
  assert.ok(c.c_inf - crestFt(1000, c) < 1e-3);
});

test("CSV parser handles quoted commas and BOM headers", () => {
  const rows = parseCsv('\uFEFFa,b,c\n1,"x, y",3\n');
  assert.deepEqual(rows, [{ a: "1", b: "x, y", c: "3" }]);
});

test("stage outlook: middle line matches the forecast, range brackets it and widens with rain", () => {
  const days = dateRange("2026-10-01", "2026-12-10");
  const storm = { "2026-11-20": 0.4, "2026-12-02": 2.4, "2026-12-03": 0.6 };
  const rain = days.map((d) => ({ date: d, rain_in: storm[d] ?? 0, src: "test" }));
  const args = { rain, today: "2026-12-01", closedSince: "2026-03-07", stage0: { date: "2026-11-15", ft: 6.0 }, params };
  const so = stageOutlook(args);
  const fc = forecast({ ...args, showFrom: "2026-11-15" });
  assert.equal(so[0].phase, "reading");
  assert.equal(so[0].lo, so[0].hi);
  for (const r of so) {
    const f = fc.find((x) => x.date === r.date);
    assert.ok(Math.abs(r.ft - f.stage_ft) < 1e-9, r.date);
    assert.ok(r.lo <= r.ft && r.ft <= r.hi, `${r.date} ${r.lo} ${r.ft} ${r.hi}`);
  }
  const w = (d) => { const r = so.find((x) => x.date === d); return r.hi - r.lo; };
  assert.ok(w("2026-12-04") > w("2026-12-01") + 0.5, "storm widens the range");
  assert.equal(so.find((x) => x.date === "2026-11-20").phase, "estimated");
  assert.equal(so.find((x) => x.date === "2026-12-01").phase, "forecast");
});

test("live-sensor detector: breach on a fast drop, closure when the tide stops", () => {
  const H = 3600000, t0 = Date.UTC(2026, 0, 1);
  const pts = [];
  let h = 0;
  for (; h < 72; h++) pts.push({ t: t0 + h * H, ft: 8 + h * 0.01 });            // closed, rising
  const peak = pts.at(-1).ft;
  for (let k = 1; k <= 4; k++, h++) pts.push({ t: t0 + h * H, ft: peak - k * 0.9 }); // breach: drops 3.6 ft
  for (let k = 0; k < 24 * 5; k++, h++) pts.push({ t: t0 + h * H, ft: 4.5 + 1.2 * Math.sin((2 * Math.PI * k) / 12.42) }); // tidal
  for (let k = 0; k < 24 * 4; k++, h++) pts.push({ t: t0 + h * H, ft: 5.0 + 0.01 * Math.sin(k) });  // closed again, calm
  const ev = detectMouthEvents(pts, "closed");
  assert.deepEqual(ev.map((e) => e.state), ["open", "closed"]);
  assert.equal(ev[0].t, t0 + 71 * H, "breach dated to the last high point");
  // a closed, calm slough never triggers
  assert.deepEqual(detectMouthEvents(pts.slice(0, 72), "closed"), []);
});

test("displayed breach level: young-berm curve, capped at the median past mature breach", () => {
  const days = dateRange("2026-10-01", "2026-12-10");
  const rain = days.map((d) => ({ date: d, rain_in: 0, src: "test" }));
  const BL = params.breach_levels;
  const mature = forecast({ rain, today: "2026-12-01", closedSince: "2026-03-07", stage0: { date: "2026-11-30", ft: 6 }, params });
  for (const r of mature) {
    assert.ok(Math.abs(r.breach_level_ft - BL.mature_median_ft) < 1e-9, "mature berm uses the observed median");
    assert.ok(r.crest_ft > r.breach_level_ft, "model crest sits above the observed median");
    assert.ok(Math.abs(r.below_breach_ft - (r.breach_level_ft - r.stage_ft)) < 1e-9);
  }
  const young = forecast({ rain, today: "2026-12-01", closedSince: "2026-11-25", stage0: { date: "2026-11-30", ft: 6 }, params });
  const y = young.find((r) => r.date === "2026-12-01");
  assert.equal(y.breach_level_ft, y.crest_ft, "young berm follows the rebuilding curve");
  assert.ok(y.breach_level_ft < BL.mature_median_ft);
  assert.ok(BL.mature_min_ft <= BL.mature_median_ft && BL.mature_median_ft <= BL.mature_max_ft);
});

test("48-hour chance combines the two daily chances", () => {
  assert.ok(Math.abs(chanceWithin([0.2, 0.5]) - 0.6) < 1e-12);
  assert.equal(chanceWithin([0, 0]), 0);
});

test("breach window: extrapolates the current rise to the breach-level range", () => {
  const H = 3600000, t0 = Date.UTC(2026, 11, 2, 12);
  const rising = [...Array(7).keys()].map((k) => ({ t: t0 + k * H, ft: 8.0 + 0.1 * k })); // 8.0 -> 8.6 ft, 0.1 ft/h
  const w = breachWindow({ hourly: rising, lo: 9.3, hi: 10.4, nowMs: t0 + 6 * H });
  assert.equal(w.state, "rising");
  assert.ok(Math.abs(w.slope - 0.1) < 1e-9);
  assert.ok(Math.abs(w.start - (t0 + 13 * H)) < 1000, "reaches 9.3 ft 7 hours after 8.6 ft");
  assert.ok(Math.abs(w.end - (t0 + 24 * H)) < 1000);
  const flat = rising.map((h) => ({ ...h, ft: 8.0 }));
  assert.equal(breachWindow({ hourly: flat, lo: 9.3, hi: 10.4, nowMs: t0 + 6 * H }).state, "steady");
  const slow = rising.map((h, k) => ({ ...h, ft: 6.0 + 0.02 * k }));
  assert.equal(breachWindow({ hourly: slow, lo: 9.3, hi: 10.4, nowMs: t0 + 6 * H }).state, "beyond");
  const high = rising.map((h, k) => ({ ...h, ft: 9.4 + 0.05 * k }));
  assert.equal(breachWindow({ hourly: high, lo: 9.3, hi: 10.4, nowMs: t0 + 6 * H }).state, "within");
});

test("a mid-day live reading rolls on to the end of the day with the rain still to come", () => {
  const days = dateRange("2026-10-01", "2026-12-31");
  const storm = { "2026-12-01": 2.0 };
  const rain = days.map((d) => ({ date: d, rain_in: storm[d] ?? 0, src: "test" }));
  const base = { rain, today: "2026-12-01", closedSince: "2026-03-07", params };
  const at = (rest) => stageOutlook({ ...base, stage0: { date: "2026-12-01", ft: 7, rest } });
  const morning = at({ rain_in: 1.8, frac: 0.75 }); // most of the storm still to fall
  const evening = at({ rain_in: 0.1, frac: 0.1 }); // storm nearly over (and in the reading)
  const plain = at(undefined);
  assert.equal(plain[0].ft, 7);
  assert.equal(plain[0].phase, "reading");
  assert.equal(morning[0].phase, "forecast");
  assert.ok(morning[0].ft > evening[0].ft + 0.5, `${morning[0].ft} vs ${evening[0].ft}`);
  assert.ok(Math.abs(evening[0].ft - 7) < 0.2, `evening ${evening[0].ft}`);
  assert.ok(morning[0].hi > morning[0].ft && morning[0].lo < morning[0].ft);
  // the daily score uses the end-of-day level too
  const f = forecast({ ...base, stage0: { date: "2026-12-01", ft: 7, rest: { rain_in: 1.8, frac: 0.75 } } });
  assert.ok(Math.abs(f[0].stage_ft - morning[0].ft) < 1e-9);
});

test("restOfToday sums Open-Meteo hours after the reading, the current hour in part", () => {
  const hourly = {};
  for (let k = 0; k < 24; k++) hourly[`2026-12-01T${String(k).padStart(2, "0")}:00`] = 0.1;
  hourly["2026-12-02T00:00"] = 0.1;
  // 2026-12-01 18:30 PST = 2026-12-02 02:30 UTC: hour 19 counts half, then 20..24 in full
  const r = restOfToday(Date.parse("2026-12-02T02:30:00Z"), "2026-12-01", hourly);
  assert.ok(Math.abs(r.rain_in - 0.55) < 1e-9, String(r.rain_in));
  assert.ok(Math.abs(r.frac - 5.5 / 24) < 1e-9);
  assert.equal(restOfToday(Date.parse("2026-12-02T02:30:00Z"), "2026-12-01", null).rain_in, 0);
});
