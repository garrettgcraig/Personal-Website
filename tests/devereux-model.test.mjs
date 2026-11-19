// Tests for the Devereux Slough breach model port (devereux/model.js).
// Run with: node --test tests/devereux-model.test.mjs
// Expected values come from the Python project (devereux-breach/src/forecast.py)
// for the same synthetic inputs, so a drift between the two shows up here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dateRange, forecast, rainComposite, crestFt, stageOutlook, detectMouthEvents, watchProb } from "../devereux/model.js";
import { parseCsv } from "../netlify/functions/devereux-api.mjs";

const params = JSON.parse(readFileSync(new URL("../devereux/model-params.json", import.meta.url)));

test("Breach Watch probability matches the Python fit (src/watch_model.py)", () => {
  for (const c of params.watch.cases) {
    const p = watchProb(params.watch, c);
    assert.ok(Math.abs(p - c.p) < 1e-9, `${JSON.stringify(c)}: ${p} vs ${c.p}`);
  }
});

test("forecast: level from the water balance, chance from Breach Watch, rain-only fallback", () => {
  const days = dateRange("2026-10-01", "2026-12-31");
  const storm = { "2026-12-01": 0.8, "2026-12-02": 2.4, "2026-12-03": 0.6 };
  const rain = days.map((d) => ({ date: d, rain_in: storm[d] ?? 0, src: "test" }));
  const args = { rain, today: "2026-12-01", closedSince: "2026-03-07", stage0: { date: "2026-11-20", ft: 8.5 }, params };
  const out = forecast(args);
  // stage from src/unified.py's water balance on the same inputs
  const stage = { "2026-12-01": 8.754979, "2026-12-02": 10.037122, "2026-12-03": 10.97948, "2026-12-04": 11.195292 };
  const wy = { "2026-12-01": 0.8, "2026-12-02": 3.2, "2026-12-03": 3.8, "2026-12-04": 3.8 };
  for (const [date, ft] of Object.entries(stage)) {
    const r = out.find((x) => x.date === date);
    assert.ok(Math.abs(r.stage_ft - ft) < 1e-4, `${date} stage ${r.stage_ft} vs ${ft}`);
    const p = watchProb(params.watch, { rain_in: storm[date] ?? 0, rain_wy: wy[date], stage: r.stage_ft, later: 0 });
    assert.ok(Math.abs(r.p - p) < 1e-12, `${date} p`);
    assert.equal(r.model, "level + rain");
    assert.equal(r.later, 0);
  }
  assert.ok(out.find((x) => x.date === "2026-12-02").p > 0.9, "a 2.4 in storm on a 10 ft slough is near certain");
  assert.ok(out.find((x) => x.date === "2026-12-01").p < 0.05);
  // a breach earlier this water year makes the berm a "later" one; last season's doesn't count
  const lt = forecast({ ...args, breaches: ["2026-11-10"] }).find((x) => x.date === "2026-12-01");
  const fy = forecast({ ...args, breaches: ["2026-02-19"] }).find((x) => x.date === "2026-12-01");
  assert.equal(lt.later, 1);
  assert.equal(fy.later, 0);
  assert.ok(lt.p > out.find((x) => x.date === "2026-12-01").p);
  // no usable reading: fall back to the rain-only model
  const fb = forecast({ ...args, stage0: null });
  for (const r of fb) {
    assert.equal(r.p, r.p_rain);
    assert.equal(r.model, "rain only");
  }
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
