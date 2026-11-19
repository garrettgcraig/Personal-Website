// GET /devereux/api/live: the live water-level sensor's newest readings, for the page to
// poll between full status rebuilds. The last 48 hours at the sensor's native 5-minute
// interval, ft NAVD88 on the staff-gauge datum (same offset as /devereux/api/status).
import { sensor } from "./devereux-api.mjs";

export default async (req) => {
  if (req.method !== "GET") return new Response("Not found", { status: 404 });
  let readings = [], error = null;
  try {
    readings = await sensor(2, 5);
  } catch (e) {
    error = String(e.message || e);
  }
  return new Response(JSON.stringify({ at: new Date().toISOString(), readings, now: readings.at(-1) || null, error }), {
    status: error && !readings.length ? 502 : 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "Netlify-CDN-Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
    },
  });
};

export const config = { path: "/devereux/api/live" };
