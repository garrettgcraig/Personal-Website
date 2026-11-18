// Tests for the Devereux Slough breach model port (devereux/model.js).
// Run with: node --test tests/devereux-model.test.mjs
// Expected values come from the Python project (devereux-breach/src/forecast.py)
// for the same synthetic inputs, so a drift between the two shows up here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dateRange, forecast, rainComposite, crestFt, stageOutlook } from "../devereux/model.js";
import { parseCsv } from "../netlify/functions/devereux-api.mjs";

const params = JSON.parse(readFileSync(new URL("../devereux/model-params.json", import.meta.url)));

test("forecast matches the Python model on a synthetic December storm", () => {
  const days = dateRange("2026-10-01", "2026-12-31");
  const storm = { "2026-12-01": 0.8, "2026-12-02": 2.4, "2026-12-03": 0.6 };
  const rain = days.map((d) => ({ date: d, rain_in: storm[d] ?? 0, src: "test" }));
  const out = forecast({
    rain, today: "2026-12-01", closedSince: "2026-03-07",
    stage0: { date: "2026-11-20", ft: 8.5 }, params,
  });
  const expected = {
    "2026-12-01": [8.754979, 0.004763, 0.000945],
    "2026-12-02": [10.037122, 0.706495, 0.573928],
    "2026-12-03": [10.97948, 0.378559, 0.996436],
    "2026-12-04": [11.195292, 0.093825, 0.998942],
  };
  for (const [date, [stage, pRain, pCrest]] of Object.entries(expected)) {
    const r = out.find((x) => x.date === date);
    assert.ok(Math.abs(r.stage_ft - stage) < 1e-4, `${date} stage ${r.stage_ft} vs ${stage}`);
    assert.ok(Math.abs(r.p_rain - pRain) < 1e-4, `${date} p_rain ${r.p_rain} vs ${pRain}`);
    assert.ok(Math.abs(r.p_crest - pCrest) < 1e-4, `${date} p_crest ${r.p_crest} vs ${pCrest}`);
    assert.equal(r.p, Math.max(r.p_rain, r.p_crest));
  }
  assert.equal(out.find((x) => x.date === "2026-12-02").alert, "likely");
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
  const c = params.crest;
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
