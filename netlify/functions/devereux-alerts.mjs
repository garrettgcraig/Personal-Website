// Subscribe/unsubscribe API for Devereux breach alerts.
//   GET  /devereux/api/alerts/config                 which channels are on (+ push public key)
//   POST /devereux/api/alerts/push                   {subscription}  save a browser push subscription
//   POST /devereux/api/alerts/push/unsubscribe       {endpoint}
//   POST /devereux/api/alerts/email                  {email, website}  start double opt-in
//   GET  /devereux/api/alerts/email/confirm?id&token
//   GET|POST /devereux/api/alerts/email/unsubscribe?id&token   (POST = one-click from mail apps)
//   POST /devereux/api/alerts/test                   header x-admin-token: send a test to everyone
import { validEmail, testMessage } from "../../devereux/alerts.js";
import { broadcast, config as channels, hash, newToken, sendConfirmEmail, store } from "../lib/devereux-delivery.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const back = (q) => new Response(null, { status: 303, headers: { Location: `/devereux/?alerts=${q}#alerts` } });

async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

export default async (req) => {
  const url = new URL(req.url);
  // strip pretty-URL fallbacks (netlify dev retries non-2xx answers as ".../index.htm")
  const path = url.pathname.replace(/^\/devereux\/api\/alerts\/?/, "").replace(/\/index\.html?$/, "");
  const cfg = channels();
  const s = store();

  if (path === "config" && req.method === "GET") return json(cfg);

  if (path === "push" && req.method === "POST") {
    if (!cfg.push.enabled) return json({ error: "Push alerts are not set up yet." }, 503);
    const { subscription } = await body(req);
    const ep = subscription?.endpoint;
    if (typeof ep !== "string" || !ep.startsWith("https://") || ep.length > 1000 || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return json({ error: "Bad subscription." }, 400);
    }
    await s.setJSON(`push:${hash(ep)}`, { subscription, created: new Date().toISOString() });
    return json({ ok: true });
  }

  if (path === "push/unsubscribe" && req.method === "POST") {
    const { endpoint } = await body(req);
    if (typeof endpoint === "string") await s.delete(`push:${hash(endpoint)}`);
    return json({ ok: true });
  }

  if (path === "email" && req.method === "POST") {
    if (!cfg.email.enabled) return json({ error: "Email alerts are not set up yet." }, 503);
    const { email, website } = await body(req);
    if (website) return json({ ok: true }); // honeypot: bots fill hidden fields
    const addr = String(email || "").trim().toLowerCase();
    if (!validEmail(addr)) return json({ error: "That doesn't look like an email address." }, 400);
    const key = `email:${hash(addr)}`;
    const cur = await s.get(key, { type: "json" });
    // same response either way, so the form can't be used to check who is subscribed
    if (cur?.confirmed) return json({ ok: true });
    if (cur && Date.now() - Date.parse(cur.created) < 15 * 60000) return json({ ok: true });
    const token = newToken();
    await s.setJSON(key, { email: addr, confirmed: false, token, created: new Date().toISOString() });
    try {
      await sendConfirmEmail(addr, key, token);
    } catch (e) {
      console.error("confirmation email failed:", e.message);
      return json({ error: "Couldn't send the confirmation email. Try again later." }, 502);
    }
    return json({ ok: true });
  }

  if (path === "email/confirm" && req.method === "GET") {
    const key = `email:${url.searchParams.get("id")}`;
    const cur = await s.get(key, { type: "json" });
    if (!cur || cur.token !== url.searchParams.get("token")) return back("invalid");
    await s.setJSON(key, { ...cur, confirmed: true, confirmed_at: new Date().toISOString() });
    return back("confirmed");
  }

  if (path === "email/unsubscribe") {
    const key = `email:${url.searchParams.get("id")}`;
    const cur = await s.get(key, { type: "json" });
    if (cur && cur.token === url.searchParams.get("token")) await s.delete(key);
    return req.method === "POST" ? json({ ok: true }) : back("unsubscribed");
  }

  if (path === "test" && req.method === "POST") {
    const admin = (typeof Netlify !== "undefined" ? Netlify.env.get("DEVEREUX_ADMIN_TOKEN") : "") || "";
    if (!admin || req.headers.get("x-admin-token") !== admin) return json({ error: "Not allowed." }, 403);
    return json({ ok: true, result: await broadcast(testMessage()) });
  }

  return json({ error: "Not found." }, 404);
};

export const config = { path: "/devereux/api/alerts/*" };
