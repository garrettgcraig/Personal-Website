// Scheduled hourly (production deploys only): fetch the newest NOAA GEFS ensemble-mean run once
// it is out (every 6 hours), save it for the Devereux status API, and log its first 60 hours
// for the weekly refit of the rain correction. See netlify/lib/devereux-gefs.mjs.
import { latestRun } from "../lib/devereux-gefs.mjs";

export default async () => {
  const run = await latestRun();
  console.log(JSON.stringify({ init: run?.init ?? null, fetched_at: run?.fetched_at ?? null }));
};

export const config = { schedule: "20 * * * *" };
