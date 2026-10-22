// Netlify function for the Timeline game. Rooms live in Netlify Blobs with strong
// consistency, and every write is a compare-and-set on the blob's ETag, so two phones
// tapping at the same moment can't overwrite each other.
import { getStore } from "@netlify/blobs";
import { handle } from "../../timeline/room.js";

function blobStore() {
  const store = getStore({ name: "timeline-rooms", consistency: "strong" });
  return {
    async get(code) {
      const hit = await store.getWithMetadata(code, { type: "json" });
      return hit && hit.data ? { room: hit.data, etag: hit.etag } : null;
    },
    async put(code, room, etag) {
      const res = await store.setJSON(code, room, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag });
      return res.modified;
    },
  };
}

const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/timeline\/api\/?/, "");
  let body = {};
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Bad request." }), { status: 400, headers });
    }
  } else if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Not found." }), { status: 404, headers });
  }
  const query = Object.fromEntries(url.searchParams);
  const out = await handle(blobStore(), { method: req.method, path, query, body });
  return new Response(JSON.stringify(out.json), { status: out.status, headers });
};

export const config = { path: "/timeline/api/*" };
