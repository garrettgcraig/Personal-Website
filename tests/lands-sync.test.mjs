import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { handle, normalizeCode, storageId, applyOps } from "../netlify/lib/lands-sync.mjs";

const client = createRequire(import.meta.url)("../assets/js/lands-sync.js");
const CODE = "abcdefghijklmnopqrstuvwxyz";

function memoryStore() {
  const docs = new Map();
  let n = 0;
  return {
    docs,
    async get(id) { return docs.get(id) || null; },
    async put(id, doc, etag) {
      const cur = docs.get(id);
      if ((cur ? cur.etag : null) !== etag) return false;
      docs.set(id, { doc, etag: String(++n) });
      return true;
    },
  };
}
const post = (store, ops, extra = {}) => handle(store, { method: "POST", code: CODE, body: { ops }, ...extra });

test("codes are 26 base32 characters, dashes and case ignored", () => {
  assert.equal(normalizeCode("ABCDE-fghij-klmno-pqrst-uvwxyz"), CODE);
  assert.equal(normalizeCode("abc"), null);
  assert.equal(normalizeCode(CODE.replace("z", "1")), null);
  assert.equal(client.normalizeCode("abcde fghij klmno pqrst uvwxyz"), CODE);
  assert.equal(client.formatCode(CODE), "abcde-fghij-klmno-pqrst-uvwxyz");
});

test("rejects requests without a valid code", async () => {
  const out = await handle(memoryStore(), { method: "GET", code: "nope" });
  assert.equal(out.status, 401);
});

test("an unused code has nothing saved", async () => {
  assert.equal((await handle(memoryStore(), { method: "GET", code: CODE })).status, 404);
});

test("saves operations and reads them back; the store never holds the code", async () => {
  const store = memoryStore();
  let out = await post(store, [{ type: "nps", key: "YOSE", on: true }, { type: "wilderness", key: "Ansel Adams Wilderness", on: true }]);
  assert.equal(out.status, 200);
  out = await post(store, [{ type: "nps", key: "YOSE", on: false }, { type: "nps", key: "ZION", on: true }]);
  assert.deepEqual(out.json.visits.nps, ["ZION"]);
  out = await handle(store, { method: "GET", code: CODE });
  assert.deepEqual(out.json.visits, { wilderness: ["Ansel Adams Wilderness"], nps: ["ZION"], national_forest: [] });
  assert.deepEqual([...store.docs.keys()], [await storageId(CODE)]);
  assert.ok(!JSON.stringify([...store.docs]).includes(CODE));
});

test("a write that clashes with another device retries on the newer copy", async () => {
  const store = memoryStore();
  await post(store, [{ type: "nps", key: "YOSE", on: true }]);
  const realPut = store.put;
  let first = true;
  store.put = async (id, doc, etag) => {
    if (first) { first = false; await realPut(id, { ...store.docs.get(id).doc, visits: applyOps(store.docs.get(id).doc.visits, [{ type: "nps", key: "GRCA", on: true }]) }, etag); }
    return realPut(id, doc, etag);
  };
  const out = await post(store, [{ type: "nps", key: "ZION", on: true }]);
  assert.deepEqual(out.json.visits.nps, ["GRCA", "YOSE", "ZION"]);
});

test("validates operations", async () => {
  const store = memoryStore();
  assert.equal((await post(store, [{ type: "state_park", key: "x", on: true }])).status, 400);
  assert.equal((await post(store, [{ type: "nps", key: "", on: true }])).status, 400);
  assert.equal((await post(store, [{ type: "nps", key: "x".repeat(201), on: true }])).status, 400);
  assert.equal((await handle(store, { method: "POST", code: CODE, body: {} })).status, 400);
  assert.equal((await handle(store, { method: "DELETE", code: CODE })).status, 405);
});

test("caps a list at 10,000 keys per layer", async () => {
  const ops = Array.from({ length: 10001 }, (_, i) => ({ type: "nps", key: "k" + i, on: true }));
  assert.equal((await post(memoryStore(), ops)).status, 413);
});

test("new codes are rate limited, existing ones are not", async () => {
  const store = memoryStore();
  let calls = 0;
  const limit = async () => ++calls <= 1;
  assert.equal((await post(store, [{ type: "nps", key: "YOSE", on: true }], { limit })).status, 200);
  assert.equal((await post(store, [{ type: "nps", key: "ZION", on: true }], { limit })).status, 200);
  assert.equal(calls, 1);
  const other = await handle(store, { method: "POST", code: "b".repeat(26), body: { ops: [{ type: "nps", key: "A", on: true }] }, limit });
  assert.equal(other.status, 429);
});

test("client helpers: pending ops reapply, join only adds what the server lacks", () => {
  const types = ["wilderness", "nps", "national_forest"];
  const server = { wilderness: ["A"], nps: ["YOSE"], national_forest: [] };
  assert.deepEqual(client.applyOps(server, [{ type: "nps", key: "YOSE", on: false }, { type: "nps", key: "ZION", on: true }], types).nps, ["ZION"]);
  assert.deepEqual(client.missingOps({ wilderness: ["A", "B"], nps: ["YOSE"], national_forest: [] }, server, types), [{ type: "wilderness", key: "B", on: true }]);
});
