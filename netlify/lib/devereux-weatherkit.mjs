// Apple Weather (WeatherKit) hourly rain forecast at Devereux Slough, logged next to GEFS so the
// two can be scored against the Coal Oil Point gauge storm by storm. Nothing on the site uses it.
//
// WeatherKit keeps no archive of forecasts as they were issued (past dates return Apple's
// after-the-fact estimate), so the comparison can only be built from forecasts saved as they come.
//
// Credentials (Netlify environment variables, never committed):
//   WEATHERKIT_KEY         contents of the .p8 key file (PEM; "\n" escapes are fine)
//   WEATHERKIT_KEY_ID      the key's 10-character ID
//   WEATHERKIT_TEAM_ID     Apple Developer Team ID
//   WEATHERKIT_SERVICE_ID  the Services ID registered for WeatherKit
// Netlify hands new or changed values to functions only after the next deploy.
import { createPrivateKey, sign } from "node:crypto";
import { POINT } from "./devereux-gefs.mjs";

const HOUR = 3600000;
export const HORIZON_H = 240;
const ENV = ["WEATHERKIT_KEY", "WEATHERKIT_KEY_ID", "WEATHERKIT_TEAM_ID", "WEATHERKIT_SERVICE_ID"];

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function credentials(get = (k) => (typeof Netlify !== "undefined" ? Netlify.env.get(k) : process.env[k])) {
  const c = Object.fromEntries(ENV.map((k) => [k, (get(k) || "").trim()]));
  return ENV.every((k) => c[k]) ? c : null;
}

// The .p8 key as pasted: with or without its BEGIN/END lines, and with line breaks kept, turned
// into spaces or written as "\n". Only the base64 body matters, read as PKCS#8 DER.
export function privateKey(text) {
  const body = text.replace(/\\[nr]/g, "\n").replace(/-----(BEGIN|END)[^-]*-----/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
  return createPrivateKey({ key: Buffer.from(body, "base64"), format: "der", type: "pkcs8" });
}

// ES256 developer token (https://developer.apple.com/documentation/weatherkitrestapi/request_authentication_for_weatherkit_rest_api)
export function token(c, now = Date.now()) {
  const header = { alg: "ES256", kid: c.WEATHERKIT_KEY_ID, id: `${c.WEATHERKIT_TEAM_ID}.${c.WEATHERKIT_SERVICE_ID}` };
  const iat = Math.floor(now / 1000);
  const payload = { iss: c.WEATHERKIT_TEAM_ID, iat, exp: iat + 3600, sub: c.WEATHERKIT_SERVICE_ID };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = privateKey(c.WEATHERKIT_KEY);
  return `${input}.${b64url(sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }))}`;
}

export function hourlyUrl(now = Date.now()) {
  const start = Math.floor(now / HOUR) * HOUR;
  const q = new URLSearchParams({
    dataSets: "forecastHourly",
    hourlyStart: new Date(start).toISOString(),
    hourlyEnd: new Date(start + HORIZON_H * HOUR).toISOString(),
    timezone: "America/Los_Angeles",
  });
  return `https://weatherkit.apple.com/api/v1/weather/en/${POINT[0]}/${POINT[1]}?${q}`;
}

// [[hour start ms, inches, chance 0-1, type]] from a WeatherKit response (precipitationAmount is mm).
export function parseHourly(json) {
  const hours = json?.forecastHourly?.hours;
  if (!Array.isArray(hours)) return null;
  return hours.map((h) => [Date.parse(h.forecastStart), Math.round(((h.precipitationAmount || 0) / 25.4) * 10000) / 10000,
    h.precipitationChance ?? null, h.precipitationType ?? null]).filter((h) => Number.isFinite(h[0]));
}

export async function fetchHourly({ now = Date.now(), creds = credentials() } = {}) {
  if (!creds) return null;
  const r = await fetch(hourlyUrl(now), { headers: { Authorization: `Bearer ${token(creds, now)}` }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`WeatherKit ${r.status}`);
  const json = await r.json();
  const hours = parseHourly(json);
  if (!hours?.length) throw new Error("WeatherKit: no hourly forecast");
  const m = json.forecastHourly.metadata || {};
  return { source: "apple", fetched_at: new Date(now).toISOString(), read_time: m.readTime ?? null, reported_time: m.reportedTime ?? null, hours };
}
