// Tests for Devereux breach-alert decisions (devereux/alerts.js).
// Run with: node --test tests/devereux-alerts.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { decideAlert, alertMessage, validEmail, ALERT } from "../devereux/alerts.js";

const LEVELS = [{ key: "low", label: "Low", min: 0 }, { key: "watch", label: "Watch", min: 0.02 }, { key: "warning", label: "Warning", min: 0.2 }, { key: "likely", label: "Likely", min: 0.5 }];
const status = (p, { mouth = "closed", date = "2026-11-20" } = {}) => ({
  today: "2026-11-18",
  mouth: { state: mouth },
  peak: { date, p, rain_in: 1.6 },
  stage: { sensor_now: { ft: 7.12 } },
  model: { alert_threshold: 0.02, levels: LEVELS },
});
const T = "2026-11-18T18:00:00Z";

test("alerts once when the outlook first reaches Watch", () => {
  const a = decideAlert({}, status(0.05), T);
  assert.equal(a.send, true);
  assert.equal(a.state.active, true);
  assert.match(a.alert.title, /Breach Watch: Watch by Friday, Nov 20/);
  assert.doesNotMatch(a.alert.body, /%/);
  assert.match(a.alert.body, /7\.12 ft/);
  // still on watch 3 hours later: no repeat
  const b = decideAlert(a.state, status(0.3), T);
  assert.equal(b.send, false);
  assert.equal(b.state.active, true);
  assert.equal(b.state.p, 0.3);
});

test("no alert below Watch, or while the mouth is open", () => {
  assert.equal(decideAlert({}, status(ALERT - 0.001), T).send, false);
  assert.equal(decideAlert({}, status(0.9, { mouth: "open" }), T).send, false);
  assert.equal(decideAlert({}, { mouth: { state: "closed" }, peak: null }, T).send, false);
});

test("episode ends when the outlook falls well below Watch or the berm breaches, then can alert again", () => {
  const on = decideAlert({}, status(0.7), T).state;
  assert.equal(decideAlert(on, status(0.015), T).state.active, true, "a small dip keeps the episode");
  const off = decideAlert(on, status(0.005), T).state;
  assert.equal(off.active, false);
  assert.equal(decideAlert(off, status(0.03), T).send, true);
  assert.equal(decideAlert(on, status(0.9, { mouth: "open" }), T).state.active, false);
});

test("message names the level and says today when the peak is today", () => {
  assert.match(alertMessage(status(0.7, { date: "2026-11-18" })).title, /Breach Watch: Likely today/);
  assert.match(alertMessage(status(0.25)).title, /Warning/);
});

test("email validation", () => {
  assert.ok(validEmail("someone@example.com"));
  assert.ok(!validEmail("not an email"));
  assert.ok(!validEmail("a@b"));
  assert.ok(!validEmail(`${"x".repeat(250)}@example.com`));
  assert.ok(!validEmail(undefined));
});
