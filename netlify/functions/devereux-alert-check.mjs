// Scheduled every 3 hours (production deploys only): rebuild the Devereux status and,
// the first time the 10-day outlook reaches "likely", alert push and email subscribers.
// One alert per episode; see devereux/alerts.js. State lives in Netlify Blobs.
import { decideAlert } from "../../devereux/alerts.js";
import { buildStatus } from "./devereux-api.mjs";
import { broadcast, store } from "../lib/devereux-delivery.mjs";

export default async () => {
  const s = store();
  const prev = (await s.get("state", { type: "json" })) || {};
  const status = await buildStatus();
  const now = new Date().toISOString();
  const d = decideAlert(prev, status, now);
  let result = null;
  if (d.send) result = await broadcast(d.alert);
  await s.setJSON("state", { ...d.state, checked: now, last_peak: status.peak ? { date: status.peak.date, p: status.peak.p } : null, ...(result ? { last_send: { at: now, result } } : {}) });
  console.log(JSON.stringify({ send: d.send, peak: status.peak?.p, mouth: status.mouth?.state, result }));
};

export const config = { schedule: "0 */3 * * *" };
