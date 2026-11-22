// Tests for the GEFS forecast feed (netlify/lib/grib2.mjs, netlify/lib/devereux-gefs.mjs).
// Run with: node --test tests/devereux-gefs.test.mjs
// Reference values come from pygrib and the Python fit (devereux-breach analysis/berm/dial_replay.py).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeGrib2, valueAt } from "../netlify/lib/grib2.mjs";
import { DEFAULT_CORRECTION, correctTotal, correctedHourly, fitCorrection, forecastMaps, runPairs, withinBounds } from "../netlify/lib/devereux-gefs.mjs";
import { gaugeHours } from "../netlify/functions/devereux-gefs-refit.mjs";

const past = JSON.parse(readFileSync(new URL("../netlify/lib/devereux-gefs-pairs.json", import.meta.url)));

test("GRIB2 complex packing with spatial differencing matches pygrib", () => {
  // GEFS ensemble mean, 2025-11-14 00Z, APCP 18-24 h (mm), 0.5 degree
  const m = decodeGrib2(readFileSync(new URL("./fixtures/gefs-apcp-sample.grb2", import.meta.url)));
  assert.equal(m.grid.ni, 720);
  assert.equal(m.grid.nj, 361);
  let sum = 0, max = -Infinity;
  for (const v of m.values) { sum += v; if (v > max) max = v; }
  assert.ok(Math.abs(sum - 160186.7) < 0.01, `sum ${sum}`);
  assert.ok(Math.abs(max - 35.2) < 1e-6);
  assert.ok(Math.abs(valueAt(m, 34.41, -119.88) - 2.78296) < 1e-5);
});

test("refit reproduces the Python correction on the past runs", () => {
  const pw = fitCorrection(past.pairs, "power");
  for (const w of [0, 1]) {
    assert.ok(Math.abs(pw[w][0] - DEFAULT_CORRECTION.power[w][0]) < 0.01, `a${w} ${pw[w][0]}`);
    assert.ok(Math.abs(pw[w][1] - DEFAULT_CORRECTION.power[w][1]) < 0.01, `b${w} ${pw[w][1]}`);
  }
  const sc = fitCorrection(past.pairs, "scale");
  assert.ok(Math.abs(sc[0] - 1.4149) < 1e-3 && Math.abs(sc[1] - 1.4778) < 1e-3);
  assert.ok(withinBounds("power", pw) && withinBounds("scale", sc));
  assert.ok(!withinBounds("scale", { 0: 3, 1: 1.4 }));
});

test("correction scales 24-hour blocks from when the run is out", () => {
  const run = { init: "2026-01-10T00:00:00.000Z", buckets: [[0, 6, 0], [6, 12, 0.25], [12, 18, 0.25], [18, 24, 0.25], [24, 30, 0.25], [30, 36, 0.5], [36, 42, 0.5]] };
  const h = correctedHourly(run, DEFAULT_CORRECTION);
  const lead = (x) => (x.t - Date.parse(run.init)) / 3600000;
  const sum = (xs, k) => xs.reduce((a, x) => a + x[k], 0);
  const b0 = h.filter((x) => lead(x) < 29), b1 = h.filter((x) => lead(x) >= 29);
  assert.ok(Math.abs(sum(b0, "raw") - (0.75 + 0.25 * 5 / 6)) < 1e-9);
  assert.ok(Math.abs(sum(b0, "in") - correctTotal(DEFAULT_CORRECTION, 0, sum(b0, "raw"))) < 1e-9);
  assert.ok(Math.abs(sum(b1, "in") - 1.3255 * sum(b1, "raw") ** 1.1745) < 1e-9);
  assert.equal(correctTotal({ ...DEFAULT_CORRECTION, kind: "scale" }, 1, 2), 2 * 1.4778);
});

test("forecast maps: local hour-ending keys and whole local days", () => {
  // 2026-01-10 08:00 UTC = midnight PST: 24 hours of 0.1 in fill Jan 10 local
  const hourly = Array.from({ length: 30 }, (_, k) => ({ t: Date.parse("2026-01-10T08:00:00Z") + k * 3600000, in: 0.1 }));
  const m = forecastMaps(hourly);
  assert.ok(Math.abs(m.daily["2026-01-10"] - 2.4) < 1e-9);
  assert.equal(m.daily["2026-01-11"], undefined); // 6 h only: dropped
  assert.equal(m.hourly["2026-01-10T01:00"], 0.1);
  assert.equal(m.hourly["2026-01-11T00:00"], 0.1);
});

test("refit pairs: forecast vs gauge totals for each lead window", () => {
  const init = "2026-01-10T00:00:00.000Z", t0 = Date.parse(init);
  const logged = { init, buckets: Array.from({ length: 10 }, (_, i) => [6 * i, 6 * i + 6, 0.6]) }; // 0.1 in/h
  const gauge = new Map();
  for (let h = 0; h < 60; h++) gauge.set(t0 + h * 3600000, h < 29 ? 0.2 : 0);
  assert.deepEqual(runPairs(logged, gauge), [[2.4, 4.8], [2.4, 0]]);
  gauge.delete(t0 + 40 * 3600000);
  assert.equal(runPairs(logged, gauge), null);
});

test("USCRN hourly lines keyed by UTC hour start", () => {
  const line = "53152 20260110 0900 20260110 0100 2.623 -119.88 34.41 10.1 10.2 10.3 10.0 2.5 0 0";
  const g = gaugeHours(line);
  assert.ok(Math.abs(g.get(Date.parse("2026-01-10T08:00:00Z")) - 2.5 / 25.4) < 1e-12);
});
