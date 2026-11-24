// Netlify function behind the public lands tracker's "Sync across devices" (wilderness.html).
// Visit lists live in Netlify Blobs; see netlify/lib/lands-sync.mjs for the rules.
import { getStore } from "@netlify/blobs";
import { handle, NEW_PER_IP_PER_DAY, DAY } from "../lib/lands-sync.mjs";

const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const MAX_BODY = 1024 * 1024;

function blobStore() {
  const store = getStore({ name: "lands-visits", consistency: "strong" });
  return {
    async get(id) {
      const hit = await store.getWithMetadata(id, { type: "json" });
      return hit && hit.data ? { doc: hit.data, etag: hit.etag } : null;
    },
    async put(id, doc, etag) {
      const out = await store.setJSON(id, doc, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag });
      return out.modified;
    },
  };
}

async function limit(ip) {
  const store = getStore({ name: "lands-visits-limits", consistency: "strong" });
  const key = (ip || "unknown").replace(/[^0-9a-f.:]/gi, "_");
  const now = Date.now();
  const seen = ((await store.get(key, { type: "json" })) || []).filter((t) => now - t < DAY);
  if (seen.length >= NEW_PER_IP_PER_DAY) return false;
  seen.push(now);
  await store.setJSON(key, seen);
  return true;
}

export default async (req, context) => {
  const auth = req.headers.get("authorization") || "";
  const code = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  let body = null;
  if (req.method === "POST") {
    const text = await req.text();
    if (text.length > MAX_BODY) return new Response(JSON.stringify({ error: "Request too large." }), { status: 413, headers });
    try {
      body = JSON.parse(text);
    } catch {
      return new Response(JSON.stringify({ error: "Bad request." }), { status: 400, headers });
    }
  }
  const out = await handle(blobStore(), { method: req.method, code, body, ip: context.ip, limit });
  return new Response(JSON.stringify(out.json), { status: out.status, headers });
};

export const config = { path: "/api/lands-sync" };
