// Tests for the ChronoSono Public edition room server and rules.
// Run with: node --test tests/chronosono-room.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../chronosono/game.js";
import * as R from "../chronosono/room.js";

// A catalog with fake Spotify IDs, since the real one is filled in by the catalog workflow.
const rows = [];
for (let y = 1960; y <= 2020; y++) for (let k = 0; k < 4; k++) rows.push([`Song ${y}-${k}`, `Artist ${k}`, y, `${String(y)}${k}`.padEnd(22, "x")]);
rows.push(["No ID yet", "Nobody", 1990, null]);
R.setCatalogForTests(rows);

function seeded(seed = 1) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}

const DJ = "dj-phone-0001";
const A = "team-a-00001";
const B = "team-b-00001";

async function setup({ mode = "original", target = 3, teams = 2 } = {}) {
  const store = R.memoryStore();
  const rng = seeded(5);
  let now = 1_000_000;
  const call = async (method, path, body = {}, query = {}) => {
    const r = await R.handle(store, { method, path, body, query }, now, rng);
    return r;
  };
  const created = await call("POST", "rooms", { deviceId: A, role: "team", name: "Sharks" });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const code = created.json.code;
  const act = (device, type, extra = {}) => call("POST", `rooms/${code}/actions`, { deviceId: device, type, ...extra });
  const view = (device, since) => call("GET", `rooms/${code}`, {}, { device, since });
  await act(DJ, "join", { role: "dj" });
  await act(B, "join", { role: "team", name: "Jets" });
  if (teams > 2) await act("team-c-00001", "join", { role: "team", name: "Owls" });
  await act(A, "config", { config: { mode, target, yearMin: 1960, yearMax: 2020 } });
  const started = await act(A, "start");
  assert.equal(started.status, 200, JSON.stringify(started.json));
  return { store, code, act, view, tick: (ms) => (now += ms), room: async () => (await store.get(code)).room };
}

test("catalog rows without a Spotify ID are left out", () => {
  assert.equal(R.catalogCards().length, rows.length - 1);
  assert.ok(R.catalogCards().every((c) => c.spotify.length === 22));
});

test("room codes avoid I and O and rooms reject bad device IDs", async () => {
  for (let i = 0; i < 200; i++) assert.match(R.newCode(), /^[A-HJ-NP-Z]{4}$/);
  const r = await R.handle(R.memoryStore(), { method: "POST", path: "rooms", body: { deviceId: "x", role: "team" } });
  assert.equal(r.status, 400);
});

test("lobby needs a DJ phone and two teams, and only the host can start", async () => {
  const store = R.memoryStore();
  const created = await R.handle(store, { method: "POST", path: "rooms", body: { deviceId: A, role: "team", name: "Sharks" } });
  const code = created.json.code;
  const act = (device, type, extra = {}) => R.handle(store, { method: "POST", path: `rooms/${code}/actions`, body: { deviceId: device, type, ...extra } });
  assert.match((await act(A, "start")).json.error, /DJ phone/);
  await act(DJ, "join", { role: "dj" });
  assert.match((await act(A, "start")).json.error, /two team/);
  assert.equal((await act(B, "join", { role: "team", name: "sharks" })).status, 409, "duplicate name refused in the lobby");
  await act(B, "join", { role: "team", name: "Jets" });
  assert.equal((await act(B, "start")).status, 403, "only the host starts");
  assert.equal((await act(A, "start")).status, 200);
  // Mid-game, a new phone typing an existing name takes over that seat.
  const rejoin = await act("team-a-replace", "join", { role: "team", name: "SHARKS" });
  assert.equal(rejoin.status, 200);
  assert.equal(rejoin.json.me.team, 0);
  assert.equal((await act("team-new-0001", "join", { role: "team", name: "Owls" })).status, 409, "no new teams mid-game");
});

test("strangers can't act on a room they haven't joined", async () => {
  const t = await setup();
  const r = await t.act("stranger-0001", "next");
  assert.equal(r.status, 403);
});

test("the current song stays hidden from team phones until the reveal", async () => {
  const t = await setup();
  await t.act(DJ, "next");
  const room = await t.room();
  const secret = room.game.current;
  for (const device of [A, B]) {
    const v = (await t.view(device)).json;
    const text = JSON.stringify(v);
    assert.equal(v.game.current, null);
    assert.equal(v.spotify, null);
    assert.ok(!text.includes(secret.title), "title leaked");
    assert.ok(!text.includes(secret.spotify), "Spotify ID leaked");
  }
  const dj = (await t.view(DJ)).json;
  assert.equal(dj.spotify, secret.spotify);
  assert.equal(dj.game.current, null, "the DJ phone gets the ID only, not the title");
  // Once the DJ reports playback, the ID is no longer sent at all.
  await t.act(DJ, "played", { nonce: dj.play.nonce });
  assert.equal((await t.view(DJ)).json.spotify, null);
});

test("a full turn: place, lock, pass, judge, result, next", async () => {
  const t = await setup();
  assert.equal((await t.act(A, "next")).status, 403, "only the DJ draws songs");
  await t.act(DJ, "next");
  assert.equal((await t.act(B, "place", { gap: 0 })).status, 409, "not B's turn");
  await t.act(A, "place", { gap: 0 });
  let v = (await t.act(A, "lock")).json;
  assert.equal(v.stage, "challenge");
  assert.deepEqual(v.game.eligible, [1]);
  v = (await t.act(B, "pass")).json;
  assert.equal(v.stage, "judge", "closes as soon as every eligible team decides");
  assert.ok(v.game.current.title, "card is shown at the judge step");
  assert.equal((await t.act(A, "judge", { named: true })).status, 403, "active team can't award itself");
  v = (await t.act(B, "judge", { named: true })).json;
  assert.equal(v.stage, "result");
  assert.equal(v.game.result.tokenEarned, true);
  v = (await t.act(DJ, "next")).json;
  assert.equal(v.stage, "place");
  assert.equal(v.game.turn, 1);
  assert.equal(v.play.status, "cued");
});

test("a challenge window closes on time when a team never answers", async () => {
  const t = await setup({ teams: 3 });
  await t.act(DJ, "next");
  await t.act(A, "place", { gap: 0 });
  const locked = (await t.act(A, "lock")).json;
  await t.act(B, "pass");
  assert.equal((await t.room()).stage, "challenge");
  t.tick(R.CHALLENGE_SECONDS * 1000 + 1);
  // A plain poll with an up-to-date version closes the expired window.
  const v = (await t.view(B, (await t.room()).version)).json;
  assert.equal(v.stage, "judge");
  assert.ok(locked.game.deadline > 0);
});

test("a correct challenger steals the card", async () => {
  const t = await setup();
  await t.act(DJ, "next");
  const room = await t.room();
  const card = room.game.current;
  const tl = room.game.players[0].timeline;
  const gaps = [...Array(tl.length + 1).keys()];
  const wrong = gaps.find((g) => !G.isCorrect(tl, g, card.year));
  const right = gaps.find((g) => G.isCorrect(tl, g, card.year));
  if (wrong === undefined) return; // the anchor card shares the song's year; nothing to test
  await t.act(A, "place", { gap: wrong });
  await t.act(A, "lock");
  assert.equal((await t.act(B, "challenge", { gap: wrong })).status, 409, "can't take the same spot");
  let v = (await t.act(B, "challenge", { gap: right })).json;
  assert.equal(v.stage, "judge");
  assert.equal(v.game.teams[1].tokens, 1);
  v = (await t.act(A, "judge", { named: false })).json;
  assert.equal(v.game.result.outcome, "stolen");
  assert.equal(v.game.result.stolenBy, 1);
  assert.equal(v.game.teams[1].cards.length, 2);
});

test("skip and unplayable both re-cue the DJ phone with a new song", async () => {
  const t = await setup();
  await t.act(DJ, "next");
  const first = (await t.room()).game.current.id;
  const n1 = (await t.room()).play.nonce;
  await t.act(DJ, "played", { nonce: n1 });
  let v = (await t.act(A, "skip")).json;
  assert.equal(v.play.status, "cued");
  assert.equal(v.play.nonce, n1 + 1);
  assert.equal(v.game.teams[0].tokens, 1);
  const second = (await t.room()).game.current.id;
  assert.notEqual(first, second);
  v = (await t.act(B, "unplayable")).json;
  assert.equal(v.play.nonce, n1 + 2);
  assert.equal(v.game.teams[0].tokens, 1, "an unplayable song costs nothing");
});

test("expert mode skips the judge step", async () => {
  const t = await setup({ mode: "expert" });
  await t.act(DJ, "next");
  await t.act(A, "place", { gap: 0 });
  assert.equal((await t.act(A, "lock")).status, 409, "needs a year first");
  await t.act(A, "guess", { year: 1999 });
  await t.act(A, "lock");
  const v = (await t.act(B, "pass")).json;
  assert.equal(v.stage, "result");
});

test("two phones acting at the same moment both land", async () => {
  const t = await setup({ teams: 3 });
  await t.act(DJ, "next");
  await t.act(A, "place", { gap: 0 });
  await t.act(A, "lock");
  // B and C act concurrently against the same version; compare-and-set retries the loser.
  const [b, c] = await Promise.all([t.act(B, "pass"), t.act("team-c-00001", "pass")]);
  assert.equal(b.status, 200);
  assert.equal(c.status, 200);
  assert.equal((await t.room()).stage, "judge");
});

test("unchanged polls are tiny and a full game reaches a winner", async () => {
  const t = await setup({ target: 4 });
  const ver = (await t.room()).version;
  assert.deepEqual(Object.keys((await t.view(A, ver)).json).sort(), ["serverNow", "unchanged", "version"]);
  let guard = 0;
  while ((await t.room()).stage !== "over" && guard++ < 300) {
    const room = await t.room();
    const active = room.game.turn === 0 ? A : B;
    const other = active === A ? B : A;
    await t.act(DJ, "next");
    if ((await t.room()).stage === "over") break;
    await t.act(active, "place", { gap: guard % 2 });
    await t.act(active, "lock");
    if ((await t.room()).stage === "challenge") await t.act(other, "pass");
    await t.act(guard % 3 ? other : active, "judge", { named: false });
  }
  const end = (await t.view(A)).json;
  assert.equal(end.stage, "over");
  assert.ok(end.game.played.length > 0);
  for (const team of end.game.teams) {
    const years = team.cards.map((c) => c.year);
    assert.deepEqual(years, [...years].sort((x, y) => x - y));
  }
});

test("expired rooms read as gone", async () => {
  const t = await setup();
  t.tick(R.ROOM_TTL_MS + 1);
  assert.equal((await t.view(A)).status, 404);
});

// A game where team 0 is up with one card from 1990, team 1 has one card, and the song is from 1985.
function stealSetup(target) {
  const card = (year, id) => ({ id, title: `Song ${year}`, artist: "Artist", year, spotify: id });
  let s = G.createGame({ mode: "original", target, startTokens: 2, balance: false, yearMin: 1960, yearMax: 2020 }, ["Sharks", "Table 2"], [card(1970, "a"), card(1975, "b"), card(1980, "c")], seeded(3));
  s = { ...s, players: [{ ...s.players[0], timeline: [card(1990, "p0")] }, { ...s.players[1], timeline: [card(2000, "p1")] }] };
  s = { ...s, phase: "place", current: card(1985, "now") };
  s = G.lockIn(G.place(s, 1)); // after 1990: wrong
  return G.addChallenge(s, 1, 0); // before 1990: right
}

test("a steal that reaches the target ends the game at once", () => {
  const s = G.reveal(stealSetup(2), { named: false });
  assert.equal(s.phase, "over");
  assert.equal(s.winner, 1);
  assert.equal(s.result.stolenBy, 1);
  assert.equal(s.result.card.year, 1985);
});

test("a steal short of the target keeps the game going", () => {
  const s = G.reveal(stealSetup(3), { named: false });
  assert.equal(s.phase, "reveal");
  assert.equal(s.winner, null);
});

test("the room shows the winner as soon as the winning card is revealed", async () => {
  const t = await setup({ target: 5 });
  let guard = 0;
  // Play until the game ends; it must end on a reveal, not on the DJ's next tap.
  while ((await t.room()).stage !== "over" && guard++ < 50) {
    const room = await t.room();
    const active = room.game.turn === 0 ? A : B;
    const other = active === A ? B : A;
    await t.act(DJ, "next");
    const placing = await t.room();
    const tl = placing.game.players[placing.game.turn].timeline;
    const gap = tl.filter((c) => c.year < placing.game.current.year).length; // always right
    await t.act(active, "place", { gap });
    await t.act(active, "lock");
    if ((await t.room()).stage === "challenge") await t.act(other, "pass");
    await t.act(other, "judge", { named: false });
  }
  const end = (await t.view(A)).json;
  assert.equal(end.stage, "over");
  assert.ok(end.game.result, "the winning card is still shown");
  assert.equal(end.game.teams[end.game.winner].cards.length, end.config.target);
});
