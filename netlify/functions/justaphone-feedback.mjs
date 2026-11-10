// Netlify function behind the Just a Phone app's feedback form. It files each
// message as a GitHub issue (see justaphone/api/feedback.js).
//
// Needs two environment variables in Netlify (Site configuration > Environment variables):
//   JUSTAPHONE_FEEDBACK_TOKEN  a fine-grained GitHub token with Issues: Read and write
//                              on garrettgcraig/dumber-phone-ios only
//   JUSTAPHONE_FEEDBACK_REPO   optional, defaults to garrettgcraig/dumber-phone-ios
import { getStore } from "@netlify/blobs";
import { handle } from "../../justaphone/api/feedback.js";

const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const LIMIT = 5;              // messages per address
const WINDOW = 60 * 60 * 1000; // per hour

async function allow(ip) {
  const store = getStore({ name: "justaphone-feedback-limits", consistency: "strong" });
  const key = (ip || "unknown").replace(/[^0-9a-f.:]/gi, "_");
  const now = Date.now();
  const seen = ((await store.get(key, { type: "json" })) || []).filter((t) => now - t < WINDOW);
  if (seen.length >= LIMIT) return false;
  seen.push(now);
  await store.setJSON(key, seen);
  return true;
}

export default async (req, context) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Not found." }), { status: 404, headers });
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Bad request." }), { status: 400, headers });
  }
  const out = await handle(body, context.ip, {
    token: Netlify.env.get("JUSTAPHONE_FEEDBACK_TOKEN"),
    repo: Netlify.env.get("JUSTAPHONE_FEEDBACK_REPO") || "garrettgcraig/dumber-phone-ios",
    fetch,
    allow,
  });
  return new Response(JSON.stringify(out.json), { status: out.status, headers });
};

export const config = { path: "/justaphone/api/feedback" };
