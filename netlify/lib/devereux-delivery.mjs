// Storage and delivery for Devereux breach alerts (push + email).
// Shared by netlify/functions/devereux-alerts.mjs (subscribe/unsubscribe API) and
// netlify/functions/devereux-alert-check.mjs (scheduled check).
//
// Environment variables (Netlify site settings). Each channel turns on only when its
// variables are set; the page hides a channel that is off.
//   Push:  DEVEREUX_VAPID_PUBLIC_KEY, DEVEREUX_VAPID_PRIVATE_KEY, DEVEREUX_VAPID_SUBJECT
//   Email: RESEND_API_KEY, DEVEREUX_EMAIL_FROM (e.g. "Devereux Slough alerts <alerts@alerts.garrettgcraig.com>")
//   Test:  DEVEREUX_ADMIN_TOKEN (lets you trigger a test send)
import { createHash, randomBytes } from "node:crypto";
import { getStore } from "@netlify/blobs";
import webpush from "web-push";

export const SITE = "https://garrettgcraig.com";
const env = (k) => (typeof Netlify !== "undefined" ? Netlify.env.get(k) : process.env[k]) || "";

export function config() {
  return {
    push: { enabled: Boolean(env("DEVEREUX_VAPID_PUBLIC_KEY") && env("DEVEREUX_VAPID_PRIVATE_KEY")), publicKey: env("DEVEREUX_VAPID_PUBLIC_KEY") || null },
    email: { enabled: Boolean(env("RESEND_API_KEY") && env("DEVEREUX_EMAIL_FROM")) },
  };
}

export const store = () => getStore({ name: "devereux-alerts", consistency: "strong" });
export const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 32);
export const newToken = () => randomBytes(24).toString("hex");

export async function listValues(prefix) {
  const s = store();
  const { blobs } = await s.list({ prefix });
  const out = [];
  for (const b of blobs) {
    const v = await s.get(b.key, { type: "json" });
    if (v) out.push({ key: b.key, ...v });
  }
  return out;
}

// ---------------------------------------------------------------- push
export async function sendPush(sub, msg) {
  webpush.setVapidDetails(env("DEVEREUX_VAPID_SUBJECT") || `${SITE}/devereux/`, env("DEVEREUX_VAPID_PUBLIC_KEY"), env("DEVEREUX_VAPID_PRIVATE_KEY"));
  try {
    await webpush.sendNotification(sub.subscription, JSON.stringify(msg), { TTL: 6 * 3600, urgency: "high" });
    return "sent";
  } catch (e) {
    // 404/410: the browser dropped the subscription; forget it
    if (e.statusCode === 404 || e.statusCode === 410) { await store().delete(sub.key); return "expired"; }
    return `error ${e.statusCode || e.message}`;
  }
}

// ---------------------------------------------------------------- email (Resend)
async function resend(payload) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("DEVEREUX_EMAIL_FROM"), ...payload }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shell = (inner) => `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;color:#1B2530;line-height:1.5">${inner}`
  + `<p style="color:#56606A;font-size:13px;margin-top:24px">Garrett G. Craig · garrettgcraig.com/devereux</p></div>`;

export function unsubscribeUrl(sub) {
  return `${SITE}/devereux/api/alerts/email/unsubscribe?id=${sub.key.split(":")[1]}&token=${sub.token}`;
}

export async function sendConfirmEmail(email, key, token) {
  const link = `${SITE}/devereux/api/alerts/email/confirm?id=${key.split(":")[1]}&token=${token}`;
  return resend({
    to: email,
    subject: "Confirm Devereux Slough breach alerts",
    text: `Confirm that you want an email when the Devereux Slough Breach Watch reaches high (a 30% chance of a breach or more):\n\n${link}\n\nIf you didn't ask for this, ignore this email and nothing will be sent.`,
    html: shell(`<p>Confirm that you want an email when the Devereux Slough Breach Watch reaches high (a 30% chance of a breach or more).</p>`
      + `<p><a href="${link}" style="background:#2D5A7B;color:#F6F6F2;padding:10px 18px;border-radius:999px;text-decoration:none;display:inline-block">Confirm alerts</a></p>`
      + `<p style="color:#56606A">If you didn't ask for this, ignore this email and nothing will be sent.</p>`),
  });
}

export async function sendAlertEmail(sub, msg) {
  const unsub = unsubscribeUrl(sub);
  try {
    await resend({
      to: sub.email,
      subject: msg.title,
      text: `${msg.body}\n\nOutlook: ${msg.url}\n\nUnsubscribe: ${unsub}`,
      html: shell(`<h2 style="font-size:20px;margin:0 0 8px">${esc(msg.title)}</h2><p>${esc(msg.body)}</p>`
        + `<p><a href="${msg.url}" style="color:#2D5A7B">See the outlook</a></p>`
        + `<p style="color:#56606A;font-size:13px"><a href="${unsub}" style="color:#56606A">Unsubscribe</a></p>`),
      headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    return "sent";
  } catch (e) {
    return `error ${e.message}`;
  }
}

/** Send one message to every push subscriber and confirmed email subscriber. */
export async function broadcast(msg) {
  const cfg = config();
  const result = { push: {}, email: {} };
  if (cfg.push.enabled) {
    for (const sub of await listValues("push:")) {
      const r = await sendPush(sub, msg);
      result.push[r] = (result.push[r] || 0) + 1;
    }
  }
  if (cfg.email.enabled) {
    for (const sub of (await listValues("email:")).filter((s) => s.confirmed)) {
      const r = await sendAlertEmail(sub, msg);
      result.email[r] = (result.email[r] || 0) + 1;
    }
  }
  return result;
}
