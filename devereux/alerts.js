// Breach-alert logic for the Devereux page. Pure functions: no network, no storage.
// netlify/functions/devereux-alert-check.mjs runs decideAlert() every 3 hours on the
// live status and sends whatever it returns to push and email subscribers.

export const LIKELY = 0.5; // alert threshold: the page's "likely" level
export const RESET = 0.2;  // an alert episode ends once the outlook drops below "watch"

/**
 * Decide whether to alert. One alert per episode: an episode starts the first time the
 * 10-day outlook reaches LIKELY while the mouth is closed, and ends when the mouth opens
 * or the peak chance falls back below RESET. Returns {send, state, alert}.
 *  prev:   {active, since, peak_date, p} from the last run (or {} on the first)
 *  status: the /devereux/api/status document
 */
export function decideAlert(prev, status, nowIso) {
  const closed = status?.mouth?.state === "closed";
  const peak = status?.peak;
  const p = peak?.p ?? 0;
  if (prev?.active) {
    if (!closed || !peak || p < RESET) return { send: false, state: { active: false, ended: nowIso } };
    return { send: false, state: { ...prev, p: Math.max(prev.p ?? 0, p) } };
  }
  if (closed && peak && p >= LIKELY) {
    return {
      send: true,
      state: { active: true, since: nowIso, peak_date: peak.date, p },
      alert: alertMessage(status),
    };
  }
  return { send: false, state: { active: false } };
}

const PAGE = "https://garrettgcraig.com/devereux/";

function niceDay(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });
}

/** Text for push and email. */
export function alertMessage(status) {
  const pk = status.peak;
  const pct = Math.round(pk.p * 100);
  const rain = pk.rain_in != null && pk.rain_in >= 0.1 ? ` with ${pk.rain_in.toFixed(2)} in of rain forecast` : "";
  const level = status.stage?.sensor_now?.ft ?? status.stage?.today_est_ft;
  const title = `Devereux Slough: breach likely ${pk.date === status.today ? "today" : `by ${niceDay(pk.date)}`}`;
  const body = `The chance the berm breaches reaches ${pct}% on ${niceDay(pk.date)}${rain}.`
    + (level != null ? ` The slough is at ${level.toFixed(2)} ft now.` : "");
  return { title, body, url: PAGE };
}

/** A test message, for checking delivery after setup. */
export function testMessage() {
  return { title: "Devereux Slough alerts are working", body: "This is a test. You'll get a message like this when a breach becomes likely.", url: PAGE };
}

// Plain, permissive email check: one @, a dot in the domain, no spaces, sane length.
export function validEmail(s) {
  return typeof s === "string" && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
