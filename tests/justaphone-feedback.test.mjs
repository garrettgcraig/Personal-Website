import test from "node:test";
import assert from "node:assert/strict";
import { validate, issueFor, handle } from "../justaphone/api/feedback.js";

const good = { email: "a@b.co", message: "The woodgrain is lovely.\nMore please.", kind: "idea", app: "1.1 (4)", os: "27.1" };
const ok = (calls) => async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 201 }; };

test("requires a real-looking email", () => {
  assert.match(validate({ ...good, email: "" }).error, /email/);
  assert.match(validate({ ...good, email: "nope" }).error, /email/);
  assert.equal(validate(good).value.email, "a@b.co");
});

test("requires a message and drops the honeypot", () => {
  assert.ok(validate({ ...good, message: "hi" }).error);
  assert.ok(validate({ ...good, website: "spam.com" }).error);
});

test("unknown kinds become other", () => {
  assert.equal(validate({ ...good, kind: "rant" }).value.kind, "other");
});

test("issue title uses the first line and the body quotes the message", () => {
  const i = issueFor(validate(good).value);
  assert.equal(i.title, "Idea: The woodgrain is lovely.");
  assert.match(i.body, /^> The woodgrain is lovely\.\n> More please\./);
  assert.match(i.body, /\*\*From:\*\* a@b\.co/);
  assert.deepEqual(i.labels, ["feedback", "idea"]);
});

test("files an issue", async () => {
  const calls = [];
  const out = await handle(good, "1.2.3.4", { token: "t", repo: "o/r", fetch: ok(calls), allow: async () => true });
  assert.equal(out.status, 200);
  assert.equal(calls.length, 1);
});

test("rate limited", async () => {
  const out = await handle(good, "1.2.3.4", { token: "t", repo: "o/r", fetch: ok([]), allow: async () => false });
  assert.equal(out.status, 429);
});

test("retries without labels on 422", async () => {
  const calls = [];
  let n = 0;
  const fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return n++ ? { ok: true, status: 201 } : { ok: false, status: 422 }; };
  const out = await handle(good, "", { token: "t", repo: "o/r", fetch, allow: async () => true });
  assert.equal(out.status, 200);
  assert.equal(calls[1].labels, undefined);
});

test("no token means a clear 503, not a crash", async () => {
  const out = await handle(good, "", { token: "", repo: "o/r", fetch: ok([]), allow: async () => true });
  assert.equal(out.status, 503);
});
