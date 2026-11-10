// Turns a feedback message from the Just a Phone app into a GitHub issue on the
// app's private repo. Kept free of Netlify APIs so tests can drive it directly;
// netlify/functions/justaphone-feedback.mjs wires in the token, rate limit and fetch.

export const KINDS = ["idea", "bug", "other"];
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

const clean = (v, max) => (typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "");

/** Checks the request body. Returns { error } or { value }. */
export function validate(body) {
  if (!body || typeof body !== "object") return { error: "Bad request." };
  // Bots fill every field; people never see this one.
  if (clean(body.website, 200)) return { error: "Bad request." };
  const email = clean(body.email, 254);
  if (!EMAIL.test(email)) return { error: "Please enter a valid email address." };
  const message = clean(body.message, 5000);
  if (message.length < 5) return { error: "Please write a little more." };
  const kind = KINDS.includes(body.kind) ? body.kind : "other";
  const app = clean(body.app, 40), os = clean(body.os, 40), device = clean(body.device, 60);
  return { value: { email, message, kind, app, os, device } };
}

/** The GitHub issue for a validated message. */
export function issueFor(f) {
  const firstLine = f.message.split("\n")[0].replace(/\s+/g, " ");
  const short = firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine;
  const label = { idea: "Idea", bug: "Bug", other: "Feedback" }[f.kind];
  const quoted = f.message.split("\n").map((l) => "> " + l).join("\n");
  const meta = [f.app && `App ${f.app}`, f.os && `iOS ${f.os}`, f.device].filter(Boolean).join(" · ");
  return {
    title: `${label}: ${short}`,
    body: `${quoted}\n\n**From:** ${f.email}\n` + (meta ? `**Device:** ${meta}\n` : "") +
      `\n_Sent from the feedback form in Just a Phone._`,
    labels: ["feedback", f.kind],
  };
}

/**
 * Handles one POST. deps: { token, repo, fetch, allow(ip) -> Promise<bool> }.
 * Returns { status, json }.
 */
export async function handle(body, ip, deps) {
  const checked = validate(body);
  if (checked.error) return { status: 400, json: { error: checked.error } };
  if (!(await deps.allow(ip))) {
    return { status: 429, json: { error: "That's a lot of feedback at once. Please try again in an hour." } };
  }
  if (!deps.token) return { status: 503, json: { error: "Feedback isn't set up yet. Please email just.a.phone.support@gmail.com." } };
  const issue = issueFor(checked.value);
  const post = (payload) => deps.fetch(`https://api.github.com/repos/${deps.repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deps.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "justaphone-feedback",
    },
    body: JSON.stringify(payload),
  });
  let res = await post(issue);
  // A label that can't be created shouldn't lose the message.
  if (res.status === 422) res = await post({ title: issue.title, body: issue.body });
  if (!res.ok) return { status: 502, json: { error: "Couldn't send right now. Please try again later." } };
  return { status: 200, json: { ok: true } };
}
