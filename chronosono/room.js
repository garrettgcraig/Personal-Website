// Room server for the ChronoSono Public edition. Pure logic plus a small storage interface,
// so the same code runs in the Netlify function and in local tests.
//
// A room has one DJ phone (plays songs from Spotify links, face down) and 2 to 4 team phones.
// The server is the only place that knows the current song. Team phones never receive it
// until the reveal, and the DJ phone gets only the Spotify ID it needs to start playback.

import * as G from "./game.js";
import { SONGS } from "./songs.js";

export const MAX_TEAMS = 4;
export const CHALLENGE_SECONDS = 15;
// Each team's phone is tinted with its color so phones are easy to tell apart across a table.
export const TEAM_COLORS = ["red", "blue", "green", "orange", "purple", "teal"];
export const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O, which read like 1 and 0
const MODES = ["original", "pro", "expert"];

let CARDS = G.toCards(SONGS);
export function setCatalogForTests(rows) {
  CARDS = G.toCards(rows);
}
export function catalogCards() {
  return CARDS;
}

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------- Helpers ----------

function cleanName(raw, fallback) {
  const s = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
  return s || fallback;
}

function cleanDevice(raw) {
  const s = String(raw ?? "");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(s)) throw new GameError("This device has no valid ID. Reload the page.");
  return s;
}

const clampInt = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

export function cleanConfig(raw = {}, prev = {}) {
  const yearCap = Math.max(new Date().getFullYear(), ...CARDS.map((c) => c.year), G.YEAR_FLOOR + 10);
  let yearMin = clampInt(raw.yearMin ?? prev.yearMin, G.YEAR_FLOOR, yearCap, 1960);
  let yearMax = clampInt(raw.yearMax ?? prev.yearMax, G.YEAR_FLOOR, yearCap, yearCap);
  if (yearMax - yearMin < 4) yearMax = Math.min(yearCap, yearMin + 4), (yearMin = yearMax - 4);
  return {
    mode: MODES.includes(raw.mode) ? raw.mode : MODES.includes(prev.mode) ? prev.mode : "original",
    target: clampInt(raw.target ?? prev.target, 5, 20, 10),
    startTokens: clampInt(raw.startTokens ?? prev.startTokens, 0, 5, 2),
    yearMin,
    yearMax,
    balance: raw.balance === undefined ? prev.balance ?? true : !!raw.balance,
    genres: cleanGenres(raw.genres ?? prev.genres),
  };
}

// Known genres only, no repeats, in the standard order. All of them is stored as none, meaning all.
function cleanGenres(raw) {
  if (!Array.isArray(raw)) return [];
  const picked = G.GENRES.filter((g) => raw.includes(g));
  return picked.length === G.GENRES.length ? [] : picked;
}

export function newCode(rng = Math.random) {
  let s = "";
  for (let i = 0; i < 4; i++) s += CODE_LETTERS[Math.floor(rng() * CODE_LETTERS.length)];
  return s;
}

const teamIndexOf = (room, deviceId) => room.teams.findIndex((t) => t.deviceId === deviceId);

function requireTeam(room, deviceId) {
  const i = teamIndexOf(room, deviceId);
  if (i < 0) throw new GameError("Only team phones can do that.", 403);
  return i;
}

function requireActive(room, deviceId) {
  const i = requireTeam(room, deviceId);
  if (i !== room.game.turn) throw new GameError("It's not your turn.", 409);
  return i;
}

function requireStage(room, ...stages) {
  if (!stages.includes(room.stage)) throw new GameError("That can't be done right now.", 409);
}

// reason tells the phones why a new song is waiting: "next", "skip", "unplayable", or "replay".
function cue(room, reason) {
  room.play = { nonce: room.play.nonce + 1, status: "cued", reason };
}

// ---------- Room lifecycle ----------

export function createRoom(code, hostId, now) {
  return {
    code,
    version: 1,
    createdAt: now,
    updatedAt: now,
    hostId,
    config: cleanConfig({}),
    teams: [],
    djId: null,
    djMode: "phone", // "phone": face down with a motion sensor; "computer": the DJ keeps the screen hidden
    stage: "lobby",
    game: null,
    play: { nonce: 0, status: "idle" },
    challenge: null,
    seen: {},
  };
}

// The wanted color when it's known and no other team has it, else the first free one.
function freeColor(room, wanted, self = -1) {
  const taken = new Set(room.teams.filter((_, i) => i !== self).map((t) => t.color));
  if (TEAM_COLORS.includes(wanted) && !taken.has(wanted)) return wanted;
  return TEAM_COLORS.find((c) => !taken.has(c)) || TEAM_COLORS[0];
}

function join(room, deviceId, { role, name, color }) {
  const fallback = `Team ${room.teams.length + 1}`;
  if (role === "dj") {
    // A new DJ phone replaces the old one, so a dead phone can be swapped out mid-game.
    const t = teamIndexOf(room, deviceId);
    if (t >= 0 && room.stage === "lobby") room.teams.splice(t, 1);
    else if (t >= 0) throw new GameError("This phone is already playing as a team.", 409);
    room.djId = deviceId;
    room.djMode = "phone";
    return;
  }
  if (role !== "team") throw new GameError("Choose DJ phone or team phone.");
  const wanted = cleanName(name, fallback);
  if (room.djId === deviceId) {
    if (room.stage !== "lobby") throw new GameError("This phone is the DJ phone for this game.", 409);
    room.djId = null;
  }
  const mine = teamIndexOf(room, deviceId);
  const sameName = room.teams.findIndex((t) => t.name.toLowerCase() === wanted.toLowerCase());
  if (mine >= 0) {
    if (sameName >= 0 && sameName !== mine) throw new GameError("Another team already has that name.", 409);
    if (room.stage === "lobby") room.teams[mine].name = wanted;
    if (color && room.stage === "lobby") room.teams[mine].color = freeColor(room, color, mine);
    return;
  }
  if (sameName >= 0) {
    if (room.stage === "lobby") throw new GameError("Another team already has that name.", 409);
    // Mid-game, typing an existing team's name takes over its seat, for a phone that died
    // or a page reloaded in private browsing.
    room.teams[sameName].deviceId = deviceId;
    return;
  }
  if (room.stage !== "lobby") throw new GameError("This game has started. Join as an existing team by typing its name.", 409);
  if (room.teams.length >= MAX_TEAMS) throw new GameError(`A game holds up to ${MAX_TEAMS} teams.`, 409);
  room.teams.push({ name: wanted, deviceId, color: freeColor(room, color) });
}

function start(room, rng) {
  if (room.stage !== "lobby" && room.stage !== "over") throw new GameError("This game already started.", 409);
  if (!room.djId) throw new GameError("A DJ phone needs to join first.", 409);
  if (room.teams.length < 2) throw new GameError("At least two team phones need to join.", 409);
  const pool = G.filterCards(CARDS, room.config);
  const need = G.songsNeeded(room.teams.length, room.config.target);
  if (pool.length < Math.min(need, room.teams.length * 3 + 10)) {
    throw new GameError(`Only ${pool.length} songs fit these years and genres. Widen the years or add genres.`, 409);
  }
  room.game = G.createGame(room.config, room.teams.map((t) => t.name), CARDS, rng);
  room.stage = "ready";
  room.play = { nonce: room.play.nonce, status: "idle" };
  room.challenge = null;
}

function syncStage(room) {
  if (room.game?.phase === "over") {
    room.stage = "over";
    room.play.status = "idle";
  }
}

function closeChallenge(room) {
  room.challenge = null;
  if (room.game.config.mode === "expert") {
    room.game = G.reveal(room.game, { named: false });
    room.stage = "result";
    syncStage(room);
  } else {
    room.stage = "judge";
  }
}

function maybeCloseChallenge(room, now) {
  if (room.stage !== "challenge") return;
  const waiting = G.eligibleChallengers(room.game).filter((i) => !room.challenge.passed.includes(i));
  if (waiting.length === 0 || now >= room.challenge.deadline) closeChallenge(room);
}

// ---------- Actions ----------

export function applyAction(room, deviceId, action, now, rng = Math.random) {
  const type = action?.type;
  const isHost = deviceId === room.hostId;
  const g = room.game;

  switch (type) {
    case "join":
      join(room, deviceId, action);
      break;

    case "config":
      if (!isHost) throw new GameError("Only the phone that created the game can change settings.", 403);
      requireStage(room, "lobby", "over");
      room.config = cleanConfig(action.config || {}, room.config);
      break;

    case "start":
      if (!isHost) throw new GameError("Only the phone that created the game can start it.", 403);
      start(room, rng);
      break;

    case "next": {
      // The DJ phone draws the next song. From the result screen it also advances the turn.
      if (deviceId !== room.djId) throw new GameError("Only the DJ phone can play the next song.", 403);
      requireStage(room, "ready", "result");
      if (room.stage === "result") {
        room.game = G.nextTurn(g);
        syncStage(room);
        if (room.stage === "over") break;
      }
      room.game = G.startTurn(room.game, rng);
      syncStage(room);
      if (room.stage === "over") break;
      room.stage = "place";
      cue(room, "next");
      break;
    }

    case "played":
      if (deviceId !== room.djId) throw new GameError("Only the DJ phone reports playback.", 403);
      if (action.nonce === room.play.nonce && room.play.status === "cued") room.play.status = "playing";
      break;

    case "teamColor": {
      const i = requireTeam(room, deviceId);
      if (!TEAM_COLORS.includes(action.color)) throw new GameError("Pick one of the team colors.");
      if (room.teams.some((t, j) => j !== i && t.color === action.color)) throw new GameError("Another team has that color.", 409);
      room.teams[i].color = action.color;
      break;
    }

    case "djMode":
      if (deviceId !== room.djId) throw new GameError("Only the DJ can change how songs play.", 403);
      if (action.mode !== "phone" && action.mode !== "computer") throw new GameError("The DJ is a phone or a computer.");
      room.djMode = action.mode;
      break;

    case "replay":
      // The song didn't start (or stopped). Arm the DJ phone again with the same song.
      if (deviceId !== room.djId) throw new GameError("Only the DJ phone can replay the song.", 403);
      requireStage(room, "place", "challenge");
      cue(room, "replay");
      break;

    case "buy":
      requireStage(room, "ready");
      requireActive(room, deviceId);
      if (!G.canBuy(g)) throw new GameError(`Trading needs ${G.BUY_COST} tokens.`, 409);
      room.game = G.buyCard(g, rng);
      syncStage(room);
      break;

    case "skip":
      requireStage(room, "place");
      requireActive(room, deviceId);
      if (!G.canSkip(g)) throw new GameError("Skipping costs a token.", 409);
      room.game = G.skip(g, rng);
      syncStage(room);
      if (room.stage !== "over") cue(room, "skip");
      break;

    case "unplayable":
      requireStage(room, "place");
      requireTeam(room, deviceId);
      room.game = G.replaceUnavailable(g, rng);
      syncStage(room);
      if (room.stage !== "over") cue(room, "unplayable");
      break;

    case "place":
      requireStage(room, "place");
      requireActive(room, deviceId);
      room.game = G.place(g, Number(action.gap));
      break;

    case "guess":
      requireStage(room, "place");
      requireActive(room, deviceId);
      room.game = G.setYearGuess(g, action.year === null || action.year === "" ? NaN : Number(action.year));
      break;

    case "lock":
      requireStage(room, "place");
      requireActive(room, deviceId);
      if (!G.canLockIn(g)) throw new GameError(g.config.mode === "expert" ? "Pick a spot and enter a year first." : "Pick a spot first.", 409);
      room.game = G.lockIn(g);
      if (room.game.phase === "challenge") {
        room.stage = "challenge";
        room.challenge = { deadline: now + CHALLENGE_SECONDS * 1000, passed: [] };
      } else {
        closeChallenge(room);
      }
      break;

    case "challenge": {
      requireStage(room, "challenge");
      const i = requireTeam(room, deviceId);
      if (!G.eligibleChallengers(g).includes(i)) throw new GameError("You can't challenge this one.", 409);
      const gap = Number(action.gap);
      if (G.takenGaps(g).includes(gap)) throw new GameError("That spot is taken. Pick another.", 409);
      room.game = G.addChallenge(g, i, gap);
      maybeCloseChallenge(room, now);
      break;
    }

    case "undoChallenge": {
      requireStage(room, "challenge");
      const i = requireTeam(room, deviceId);
      room.game = G.undoChallenge(g, i);
      room.challenge.passed = room.challenge.passed.filter((p) => p !== i);
      break;
    }

    case "pass": {
      requireStage(room, "challenge");
      const i = requireTeam(room, deviceId);
      if (!room.challenge.passed.includes(i)) room.challenge.passed.push(i);
      maybeCloseChallenge(room, now);
      break;
    }

    case "tick":
      maybeCloseChallenge(room, now);
      break;

    case "judge": {
      // After the flip, an opposing team says whether the active team named the song.
      // The active team may only concede that they didn't.
      requireStage(room, "judge");
      const i = requireTeam(room, deviceId);
      const named = !!action.named;
      if (i === g.turn && named) throw new GameError("The other team decides whether you named it.", 403);
      room.game = G.reveal(g, { named });
      room.stage = "result";
      syncStage(room); // the winning card ends the game right away
      break;
    }

    case "end":
      if (!isHost) throw new GameError("Only the phone that created the game can end it.", 403);
      if (!g) throw new GameError("The game hasn't started.", 409);
      room.game = { ...g, phase: "over", winner: leader(g), endReason: "The game was ended early." };
      syncStage(room);
      break;

    case "rematch":
      if (!isHost) throw new GameError("Only the phone that created the game can start a rematch.", 403);
      requireStage(room, "over");
      room.stage = "lobby";
      room.game = null;
      room.challenge = null;
      room.play = { nonce: room.play.nonce, status: "idle" };
      break;

    default:
      throw new GameError("Unknown action.");
  }
  room.seen[deviceId] = now;
  room.updatedAt = now;
  room.version += 1;
  return room;
}

function leader(g) {
  const counts = g.players.map((p) => p.timeline.length);
  const best = Math.max(...counts);
  const top = counts.flatMap((c, i) => (c === best ? [i] : []));
  return top.length === 1 ? top[0] : null;
}

// ---------- What each phone may see ----------

const publicCard = (c) => (c ? { id: c.id, title: c.title, artist: c.artist, year: c.year } : null);

export function viewFor(room, deviceId, now) {
  const g = room.game;
  const teamIndex = teamIndexOf(room, deviceId);
  const role = deviceId === room.djId ? "dj" : teamIndex >= 0 ? "team" : "guest";
  const shown = room.stage === "judge" || room.stage === "result" || room.stage === "over";
  const view = {
    code: room.code,
    version: room.version,
    serverNow: now,
    stage: room.stage,
    me: { role, team: teamIndex >= 0 ? teamIndex : null, isHost: deviceId === room.hostId },
    config: room.config,
    djJoined: !!room.djId,
    djMode: room.djMode || "phone",
    lobbyTeams: room.teams.map((t) => t.name),
    lobbyColors: room.teams.map((t, i) => t.color || TEAM_COLORS[i % TEAM_COLORS.length]),
    songsInRange: G.filterCards(CARDS, room.config).length,
    play: { nonce: room.play.nonce, status: room.play.status, reason: room.play.reason ?? null },
    spotify: null,
    game: null,
  };
  if (role === "dj" && room.play.status === "cued" && g?.current) view.spotify = g.current.spotify;
  if (g) {
    view.game = {
      turn: g.turn,
      round: g.round,
      teams: g.players.map((p, i) => ({ name: p.name, color: room.teams[i]?.color || TEAM_COLORS[i % TEAM_COLORS.length], tokens: p.tokens, cards: p.timeline.map(publicCard) })),
      placement: g.placement,
      yearGuess: g.yearGuess,
      challenges: g.challenges,
      eligible: room.stage === "challenge" ? G.eligibleChallengers(g) : [],
      passed: room.challenge?.passed ?? [],
      deadline: room.challenge?.deadline ?? null,
      current: shown ? publicCard(g.current) : null,
      result: room.stage === "result" || room.stage === "over" ? (g.result ? { ...g.result, card: publicCard(g.result.card) } : null) : null,
      canSkip: G.canSkip(g),
      canBuy: G.canBuy(g),
      poolLeft: g.pool.length,
      winner: g.winner,
      endReason: g.endReason,
      played: room.stage === "over" ? G.playedCards(g).map(publicCard) : [],
    };
  }
  return view;
}

// ---------- HTTP-style handler shared by the Netlify function and the dev server ----------

// store: { get(code) -> {room, etag} | null, put(code, room, etag | null) -> boolean }
export async function handle(store, { method, path, query = {}, body = {} }, now = Date.now(), rng = Math.random) {
  try {
    const parts = path.replace(/^\/+|\/+$/g, "").split("/");
    if (parts[0] !== "rooms") throw new GameError("Not found.", 404);

    if (method === "POST" && parts.length === 1) {
      const deviceId = cleanDevice(body.deviceId);
      for (let tries = 0; tries < 8; tries++) {
        const code = newCode(rng);
        const room = createRoom(code, deviceId, now);
        if (body.config) room.config = cleanConfig(body.config);
        applyAction(room, deviceId, { type: "join", role: body.role, name: body.name, color: body.color }, now, rng);
        if (await store.put(code, room, null)) return { status: 201, json: viewFor(room, deviceId, now) };
      }
      throw new GameError("Couldn't create a room. Try again.", 503);
    }

    const code = String(parts[1] || "").toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) throw new GameError("Room codes are four letters.", 404);

    if (method === "GET" && parts.length === 2) {
      const deviceId = cleanDevice(query.device);
      const found = await store.get(code);
      if (!found || now - found.room.updatedAt > ROOM_TTL_MS) throw new GameError(`No game with code ${code}. Check the code or start a new game.`, 404);
      const since = Number(query.since);
      if (Number.isFinite(since) && since === found.room.version) {
        // Challenge windows close on time even if nobody taps, so let a poll close them.
        if (found.room.stage === "challenge" && now >= found.room.challenge.deadline) {
          return handle(store, { method: "POST", path: `rooms/${code}/actions`, body: { deviceId, type: "tick" } }, now, rng);
        }
        return { status: 200, json: { unchanged: true, version: since, serverNow: now } };
      }
      return { status: 200, json: viewFor(found.room, deviceId, now) };
    }

    if (method === "POST" && parts.length === 3 && parts[2] === "actions") {
      const deviceId = cleanDevice(body.deviceId);
      for (let tries = 0; tries < 6; tries++) {
        const found = await store.get(code);
        if (!found || now - found.room.updatedAt > ROOM_TTL_MS) throw new GameError(`No game with code ${code}.`, 404);
        const room = structuredClone(found.room);
        const known = deviceId === room.djId || teamIndexOf(room, deviceId) >= 0 || deviceId === room.hostId;
        if (!known && body.type !== "join") throw new GameError("Join this game first.", 403);
        applyAction(room, deviceId, body, now, rng);
        if (await store.put(code, room, found.etag)) return { status: 200, json: viewFor(room, deviceId, now) };
      }
      throw new GameError("Too many phones tapped at once. Try again.", 503);
    }

    throw new GameError("Not found.", 404);
  } catch (e) {
    if (e instanceof GameError) return { status: e.status, json: { error: e.message } };
    console.error(e);
    return { status: 500, json: { error: "Something went wrong on the server. Try again." } };
  }
}

// In-memory store with the same compare-and-set behavior as Netlify Blobs.
export function memoryStore() {
  const data = new Map();
  let n = 0;
  return {
    async get(code) {
      const hit = data.get(code);
      return hit ? { room: structuredClone(hit.room), etag: hit.etag } : null;
    },
    async put(code, room, etag) {
      const hit = data.get(code);
      if (etag === null && hit) return false;
      if (etag !== null && (!hit || hit.etag !== etag)) return false;
      data.set(code, { room: structuredClone(room), etag: `e${++n}` });
      return true;
    },
    _data: data,
  };
}
