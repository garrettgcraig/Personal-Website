// Read-only access to the Apple vs GEFS forecast log (see devereux-forecast-log.mjs), for scoring.
//   /devereux/api/compare-log             list of saved forecasts
//   /devereux/api/compare-log?key=<key>   one saved forecast
import { store } from "../lib/devereux-gefs.mjs";

const PREFIX = "compare-log/";
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "public, max-age=600" },
});

export default async (req) => {
  const blobs = store();
  if (!blobs) return json({ error: "store unavailable" }, 503);
  const key = new URL(req.url).searchParams.get("key");
  if (key) {
    if (!key.startsWith(PREFIX)) return json({ error: "bad key" }, 400);
    const v = await blobs.get(key, { type: "json" }).catch(() => null);
    return v ? json(v) : json({ error: "not found" }, 404);
  }
  const { blobs: list } = await blobs.list({ prefix: PREFIX });
  return json({ keys: list.map((b) => b.key).sort() });
};

export const config = { path: "/devereux/api/compare-log" };
