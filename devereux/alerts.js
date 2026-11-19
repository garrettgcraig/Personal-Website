// Breach-alert logic for the Devereux page. Pure functions: no network, no storage.
// netlify/functions/devereux-alert-check.mjs runs decideAlert() every 3 hours on the
// live status and sends whatever it returns to push and email subscribers.

// Alerts go out at the Breach Watch "watch" level: the lowest level that every recorded
// breach (measured-level seasons) reached first. The cut comes from the status document
// (status.model.alert_threshold, from model-params.json); this is the fallback.
export const ALERT = 0.02;
const cut = (status) => status?.model?.alert_threshold ?? ALERT;

/**
 * Decide whether to alert. One alert per episode: an episode starts the first time any day
 * in the 10-day outlook reaches the watch level while the mouth is closed, and ends when the
 * mouth opens or the outlook falls below half the watch level. Returns {send, state, alert}.
 *  prev:   {active, since, peak_date, p} from the last run (or {} on the first)
 *  status: the /devereux/api/status document
 */
export function decideAlert(prev, status, nowIso) {
  const closed = status?.mouth?.state === "closed";
  const peak = status?.peak;
  const p = peak?.p ?? 0;
  if (prev?.active) {
    if (!closed || !peak || p < cut(status) / 2) return { send: false, state: { active: false, ended: nowIso } };
    return { send: false, state: { ...prev, p: Math.max(prev.p ?? 0, p) } };
  }
  if (closed && peak && p >= cut(status)) {
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

const LEVELS = [{ key: "low", label: "No Chance", min: 0 }, { key: "watch", label: "Possible", min: 0.125 }, { key: "warning", label: "Likely", min: 0.2 }, { key: "likely", label: "Imminent", min: 0.5 }];

/** Text for push and email. Levels, not percentages: the score ranks risk but isn't a calibrated chance. */
export function alertMessage(status) {
  const pk = status.peak;
  const levels = status.model?.levels || LEVELS;
  const found = [...levels].reverse().find((l) => pk.p >= l.min) || levels[0];
  const lv = { ...found, label: LEVELS.find((l) => l.key === found.key)?.label ?? found.label };
  const rain = pk.rain_in != null && pk.rain_in >= 0.1 ? `, with ${pk.rain_in.toFixed(2)} in of rain forecast` : "";
  const ft = status.stage?.sensor_now?.ft ?? status.stage?.today_est_ft;
  const when = pk.date === status.today ? "today" : `by ${niceDay(pk.date)}`;
  const phrase = { low: "No Chance of Breach", watch: "Possible Breach", warning: "Likely to Breach", likely: "Imminent Breach" }[lv.key] ?? lv.label;
  const title = `Devereux Slough Breach Watch: ${phrase} ${when}`;
  const body = `The breach outlook reaches ${lv.label} on ${niceDay(pk.date)}${rain}. Every recorded breach reached at least Possible first.`
    + (ft != null ? ` The slough is at ${ft.toFixed(2)} ft now.` : "");
  return { title, body, url: PAGE };
}

/** A test message, for checking delivery after setup. */
export function testMessage() {
  return { title: "Devereux Slough alerts are working", body: "This is a test. You'll get a message like this when the Breach Watch reaches Possible.", url: PAGE };
}

// Plain, permissive email check: one @, a dot in the domain, no spaces, sane length.
export function validEmail(s) {
  return typeof s === "string" && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
