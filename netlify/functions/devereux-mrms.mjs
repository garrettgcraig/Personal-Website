// Scheduled hourly (production deploys only): save NOAA MRMS radar-and-gauge rain at the Coal
// Oil Point gauge for the last 7 days, so the Devereux status API can fill hours the gauge
// hasn't reported yet. See netlify/lib/devereux-mrms.mjs.
import { updateRecord } from "../lib/devereux-mrms.mjs";

export default async () => {
  const { rec, fetched, pending } = await updateRecord();
  console.log(JSON.stringify({ hours: Object.keys(rec.hours).length, fetched, pending }));
};

export const config = { schedule: "5 * * * *" };
