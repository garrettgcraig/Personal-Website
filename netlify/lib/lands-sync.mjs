// Server side of the public lands tracker's sync (wilderness.html).
//
// A browser makes a random sync code and keeps it. The code is the only credential: the
// server stores visits under a SHA-256 hash of it, so the stored data never holds the code
// itself. Any browser that has the code can read and change the same visit list.
//
// Clients send changes as small operations ({ type, key, on }) rather than whole lists, so two
// devices editing at once both keep their changes. Each write is a compare-and-set on the
// blob's ETag and retries on a clash.
//
// handle() takes a store with get(id) -> { doc, etag } | null and put(id, doc, etag) -> boolean,
// so tests can run it without Netlify.

export const TYPES = ["wilderness", "nps", "national_forest"];
const CODE_RE = /^[a-z2-7]{26}$/;      // 130 random bits, base32
const MAX_KEY_LEN = 200;
const MAX_PER_TYPE = 10000;
const MAX_OPS = 20000;
const NEW_PER_IP_PER_DAY = 10;
const DAY = 24 * 60 * 60 * 1000;

export function normalizeCode(raw) {
  const code = String(raw || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return CODE_RE.test(code) ? code : null;
}

export async function storageId(code) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("lands-sync:" + code));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function emptyVisits() {
  return Object.fromEntries(TYPES.map((t) => [t, []]));
}

export function validateOps(ops) {
  if (!Array.isArray(ops) || ops.length > MAX_OPS) return null;
  const out = [];
  for (const op of ops) {
    if (!op || !TYPES.includes(op.type) || typeof op.key !== "string") return null;
    if (!op.key || op.key.length > MAX_KEY_LEN) return null;
    out.push({ type: op.type, key: op.key, on: op.on !== false });
  }
  return out;
}

export function applyOps(visits, ops) {
  const next = emptyVisits();
  for (const t of TYPES) {
    const set = new Set(visits && Array.isArray(visits[t]) ? visits[t] : []);
    for (const op of ops) if (op.type === t) op.on ? set.add(op.key) : set.delete(op.key);
    if (set.size > MAX_PER_TYPE) return null;
    next[t] = Array.from(set).sort();
  }
  return next;
}

const res = (status, json) => ({ status, json });

// limit(ip) -> boolean is called only when a new sync code is first saved.
export async function handle(store, { method, code: rawCode, body, ip, limit }) {
  const code = normalizeCode(rawCode);
  if (!code) return res(401, { error: "Missing or malformed sync code." });
  const id = await storageId(code);

  if (method === "GET") {
    const hit = await store.get(id);
    if (!hit) return res(404, { error: "No visits are saved under this code yet." });
    return res(200, { visits: hit.doc.visits, updated: hit.doc.updated });
  }

  if (method !== "POST") return res(405, { error: "Use GET or POST." });
  const ops = validateOps(body && body.ops);
  if (!ops) return res(400, { error: "Send ops as a list of { type, key, on }." });

  for (let attempt = 0; attempt < 5; attempt++) {
    const hit = await store.get(id);
    if (!hit && limit && !(await limit(ip))) return res(429, { error: "Too many new sync codes from this network today." });
    const visits = applyOps(hit ? hit.doc.visits : null, ops);
    if (!visits) return res(413, { error: "That is more visits than one code can hold." });
    const doc = { visits, updated: new Date().toISOString() };
    if (await store.put(id, doc, hit ? hit.etag : null)) return res(200, doc);
  }
  return res(409, { error: "The visit list changed during the save. Try again." });
}

export { NEW_PER_IP_PER_DAY, DAY };
