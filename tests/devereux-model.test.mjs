// Tests for the Devereux Slough breach model port (devereux/model.js).
// Run with: node --test tests/devereux-model.test.mjs
// Expected values come from the Python project (devereux-breach/src/forecast.py)
// for the same synthetic inputs, so a drift between the two shows up here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bestScore, breachHours, dateRange, forecast, crestFt, stageOutlook, detectMouthEvents, chanceWithin, breachWindow, levelOf } from "../devereux/model.js";
import { copDailyRain, parseCsv, restOfToday, parseUscrnHourly } from "../netlify/functions/devereux-api.mjs";

const live = JSON.parse(readFileSync(new URL("../devereux/model-params.json", import.meta.url)));
// the earlier crest-curve hazard, still the fallback when params.best is absent
const params = { ...live, best: undefined, water_balance: { ...live.water_balance, carry: undefined } };
const spec = JSON.parse(readFileSync(new URL("./fixtures/devereux-best-model.json", import.meta.url)));

test("site model reproduces the Python check cases (best_daily.json)", () => {
  assert.equal(live.best.intercept, spec.fit.intercept);
  assert.deepEqual(live.best.coef, spec.fit.coef);
  for (const c of spec.check_cases) {
    const p = bestScore(c, live.best);
    assert.ok(Math.abs(p - c.p) < 5e-6 || Math.abs(p - c.p) / c.p < 1e-3, `${c.date}: ${p} vs ${c.p}`);
  }
  assert.deepEqual(live.levels.map((l) => l.min), spec.levels.map((l) => l.min));
});

test("site model: highest level since closure comes from measured days, then the simulated level", () => {
  const days = dateRange("2026-10-01", "2026-12-10");
  const rain = days.map((d) => ({ date: d, rain_in: d === "2026-12-02" ? 2 : 0, src: "test" }));
  const levelHistory = [{ date: "2026-11-20", ft: 7.9 }, { date: "2026-11-29", ft: 7.2 }];
  const out = forecast({ rain, today: "2026-12-01", closedSince: "2026-11-15", stage0: { date: "2026-11-30", ft: 7.3 }, params: live, levelHistory, showFrom: "2026-11-15" });
  const d1 = out.find((r) => r.date === "2026-12-01");
  assert.equal(d1.max_level_ft, 7.9);
  assert.ok(Math.abs(d1.margin_max_ft - (d1.model_stage_ft - 7.9)) < 1e-9);
  const first = out.find((r) => r.date === "2026-11-15");
  assert.ok(first.margin_max_ft === null || first.margin_max_ft === 0);
  // after the storm lifts the simulated level past 7.9, the next day's max follows it
  const d3 = out.find((r) => r.date === "2026-12-03"), d2 = out.find((r) => r.date === "2026-12-02");
  if (d2.model_stage_ft > 7.9) assert.ok(Math.abs(d3.max_level_ft - d2.model_stage_ft) < 1e-9);
  assert.ok(d2.p > d1.p, "storm day scores higher");
});

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

test("past rain comes from the Coal Oil Point gauge alone, gaps stay missing", () => {
  const days = ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
  const cop = { "2026-11-17": 0, "2026-11-18": 0.27 };
  const crn = { daily: { "2026-11-18": 0.3, "2026-11-19": 1.6535 }, hours: { "2026-11-18": 24, "2026-11-19": 17 } };
  const out = copDailyRain(days, cop, crn);
  assert.deepEqual(out.map((r) => r.rain_in), [0, 0.27, 1.65, null]);
  assert.equal(out[2].hours, 17);
  assert.equal(out[1].hours, undefined);
  assert.equal(out[3].src, "missing");
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

test("Coal Oil Point hourly feed sums rain by local standard day and skips missing hours", () => {
  const row = (ud, ut, ld, lt, mm) => `53152 ${ud} ${ut} ${ld} ${lt} 3 -119.88 34.41 12.0 12.0 12.5 11.5 ${mm} 0 C`;
  const t = [row("20261119", "0700", "20261118", "2300", "2.5"), row("20261119", "0800", "20261119", "0000", "5.8"),
    row("20261119", "0900", "20261119", "0100", "-9999.0"), row("20261119", "1000", "20261119", "0200", "10.6")].join("\n");
  const r = parseUscrnHourly(t);
  assert.ok(Math.abs(r.daily["2026-11-18"] - 2.5 / 25.4) < 1e-9);
  assert.ok(Math.abs(r.daily["2026-11-19"] - 16.4 / 25.4) < 1e-9);
  assert.equal(r.hours["2026-11-19"], 2);
  assert.equal(r.lastMs, Date.UTC(2026, 10, 19, 10, 0));
  assert.ok(Object.keys(r.hourly).every((k) => /^\d{4}-\d\d-\d\dT\d\d:00$/.test(k)));
});

test("breach hours: storm rain reaching the typical breach total, plus the median lead", () => {
  const hrs = [];
  for (let h = 0; h < 30; h++) hrs.push([`2026-12-02T${String(h % 24).padStart(2, "0")}:00`.replace("2026-12-02", h < 24 ? "2026-12-02" : "2026-12-03"), 0]);
  // 0.3 in/h from 10:00 to 17:00 (8 hours, 2.4 in); 1.9 in is reached at the hour ending 16:00
  for (let h = 10; h <= 17; h++) hrs[h][1] = 0.3;
  hrs[2][1] = 0.05; // an early shower more than 6 dry hours before is its own storm
  const st = breachHours(hrs);
  assert.equal(st.length, 2);
  const big = st[1];
  assert.equal(big.onset, "2026-12-02T10:00");
  assert.equal(big.total_in, 2.4);
  assert.ok(big.reaches_need);
  // 16:00 + 2 h; window 1 h before to 3 h after
  assert.equal(big.predicted, "2026-12-02T18:00");
  assert.equal(big.start, "2026-12-02T17:00");
  assert.equal(big.finish, "2026-12-02T21:00");
  // a storm that stops short of the total uses its last wet hour
  assert.equal(st[0].reaches_need, false);
  assert.equal(st[0].predicted, "2026-12-02T04:00");
});

test("same-day response: a storm's rise lands on the rain day, a small carryover the next", () => {
  const days = dateRange("2026-10-01", "2026-12-10");
  const rain = days.map((d) => ({ date: d, rain_in: d === "2026-12-02" ? 1.2 : 0, src: "test" }));
  const out = forecast({ rain, today: "2026-12-01", closedSince: "2026-03-07", stage0: { date: "2026-12-01", ft: 8 }, params: live });
  const at = (d) => out.find((r) => r.date === d).stage_ft;
  const rainDay = at("2026-12-02") - at("2026-12-01"), next = at("2026-12-03") - at("2026-12-02");
  assert.ok(rainDay > 0.4, `rain-day rise ${rainDay}`);
  assert.ok(next < rainDay * 0.25, `next-day gain ${next} vs ${rainDay}`);
});
