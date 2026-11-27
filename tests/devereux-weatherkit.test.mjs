// Tests for the Apple vs GEFS forecast log (netlify/lib/devereux-weatherkit.mjs,
// netlify/functions/devereux-forecast-log.mjs). Run with: node --test tests/devereux-weatherkit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { credentials, hourlyUrl, parseHourly, token } from "../netlify/lib/devereux-weatherkit.mjs";
import { logOnce } from "../netlify/functions/devereux-forecast-log.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const creds = { WEATHERKIT_KEY: pem.replace(/\n/g, "\\n"), WEATHERKIT_KEY_ID: "ABC123DEFG", WEATHERKIT_TEAM_ID: "TEAM123456", WEATHERKIT_SERVICE_ID: "com.example.devereux" };
const dec = (s) => JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());

test("credentials need all four values", () => {
  assert.equal(credentials((k) => creds[k]) !== null, true);
  assert.equal(credentials((k) => (k === "WEATHERKIT_KEY" ? "" : creds[k])), null);
});

test("developer token is a valid ES256 JWT in Apple's format", () => {
  const now = Date.UTC(2026, 10, 26, 22);
  const [h, p, s] = token(creds, now).split(".");
  assert.deepEqual(dec(h), { alg: "ES256", kid: "ABC123DEFG", id: "TEAM123456.com.example.devereux" });
  assert.deepEqual(dec(p), { iss: "TEAM123456", iat: now / 1000, exp: now / 1000 + 3600, sub: "com.example.devereux" });
  const sig = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  assert.equal(sig.length, 64);
  assert.ok(verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig));
});

test("key is read however the .p8 was pasted", () => {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  for (const text of [pem, pem.replace(/\n/g, " "), pem.replace(/\n/g, "\r\n"), pem.replace(/\n/g, "\\n"), body, `  ${pem}  `]) {
    const [h, p, s] = token({ ...creds, WEATHERKIT_KEY: text }).split(".");
    const sig = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    assert.ok(verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig));
  }
});

test("request covers the next 240 hours at the slough", () => {
  const u = new URL(hourlyUrl(Date.UTC(2026, 10, 26, 22, 37)));
  assert.equal(u.pathname, "/api/v1/weather/en/34.41/-119.88");
  assert.equal(u.searchParams.get("hourlyStart"), "2026-11-26T22:00:00.000Z");
  assert.equal(u.searchParams.get("hourlyEnd"), "2026-12-06T22:00:00.000Z");
});

test("hourly rain is converted from mm to inches", () => {
  const h = parseHourly({ forecastHourly: { hours: [
    { forecastStart: "2026-12-01T10:00:00Z", precipitationAmount: 25.4, precipitationChance: 0.9, precipitationType: "rain" },
    { forecastStart: "2026-12-01T11:00:00Z", precipitationAmount: 0, precipitationChance: 0.1, precipitationType: "clear" },
  ] } });
  assert.deepEqual(h, [[Date.UTC(2026, 11, 1, 10), 1, 0.9, "rain"], [Date.UTC(2026, 11, 1, 11), 0, 0.1, "clear"]]);
  assert.equal(parseHourly({}), null);
});

test("log saves each GEFS run once and skips Apple without keys", async () => {
  const mem = new Map();
  const blobs = {
    get: async (k) => mem.get(k) ?? null,
    getMetadata: async (k) => (mem.has(k) ? {} : null),
    setJSON: async (k, v) => { mem.set(k, v); },
  };
  mem.set("gefs-latest", { init: "2026-11-26T12:00:00.000Z", available_at: "2026-11-26T17:00:00.000Z", buckets: [[0, 6, 0.6], [6, 12, 0]] });
  const a = await logOnce({ blobs });
  assert.equal(a.apple, "no WeatherKit keys");
  assert.equal(a.gefs, "compare-log/gefs/2026-11-26T12:00:00.000Z");
  const g = mem.get(a.gefs);
  assert.equal(g.hours.length, 12);
  assert.equal(g.hours[0][1], 0.1);
  assert.ok(g.hours[0][2] > 0 && g.correction.kind);
  assert.equal((await logOnce({ blobs })).gefs, "already logged");
});
