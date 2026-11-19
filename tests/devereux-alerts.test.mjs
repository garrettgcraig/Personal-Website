// Tests for Devereux breach-alert decisions (devereux/alerts.js).
// Run with: node --test tests/devereux-alerts.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { decideAlert, alertMessage, validEmail, ALERT, RESET } from "../devereux/alerts.js";

const status = (p, { mouth = "closed", date = "2026-11-20" } = {}) => ({
  today: "2026-11-18",
  mouth: { state: mouth },
  peak: { date, p, rain_in: 1.6 },
  stage: { sensor_now: { ft: 7.12 } },
});
const T = "2026-11-18T18:00:00Z";

test("alerts once when the outlook first reaches high (30%)", () => {
  const a = decideAlert({}, status(0.62), T);
  assert.equal(a.send, true);
  assert.equal(a.state.active, true);
  assert.match(a.alert.title, /breach chance very high by Friday, Nov 20/);
  assert.match(a.alert.body, /62%/);
  assert.match(a.alert.body, /7\.12 ft/);
  // still high 3 hours later: no repeat
  const b = decideAlert(a.state, status(0.8), T);
  assert.equal(b.send, false);
  assert.equal(b.state.active, true);
  assert.equal(b.state.p, 0.8);
});

test("no alert below 30%, or while the mouth is open", () => {
  assert.equal(decideAlert({}, status(ALERT - 0.01), T).send, false);
  assert.equal(decideAlert({}, status(0.9, { mouth: "open" }), T).send, false);
  assert.equal(decideAlert({}, { mouth: { state: "closed" }, peak: null }, T).send, false);
});

test("episode ends when the outlook drops back to low or the berm breaches, then can alert again", () => {
  const on = decideAlert({}, status(0.7), T).state;
  // dipping to 10% keeps the episode (no flapping around the threshold)
  assert.equal(decideAlert(on, status(0.1), T).state.active, true);
  const off = decideAlert(on, status(RESET - 0.01), T).state;
  assert.equal(off.active, false);
  assert.equal(decideAlert(off, status(0.55), T).send, true);
  // the mouth opening also ends the episode
  assert.equal(decideAlert(on, status(0.9, { mouth: "open" }), T).state.active, false);
});

test("alerts at 30%, labeled by dial band", () => {
  const a = decideAlert({}, status(0.34), T);
  assert.equal(a.send, true);
  assert.match(a.alert.title, /breach chance high by/);
  assert.match(alertMessage(status(0.85)).title, /extreme/);
});

test("message says today when the peak is today", () => {
  assert.match(alertMessage({ ...status(0.7, { date: "2026-11-18" }) }).title, /breach chance very high today/);
});

test("email validation", () => {
  assert.ok(validEmail("someone@example.com"));
  assert.ok(!validEmail("not an email"));
  assert.ok(!validEmail("a@b"));
  assert.ok(!validEmail(`${"x".repeat(250)}@example.com`));
  assert.ok(!validEmail(undefined));
});
