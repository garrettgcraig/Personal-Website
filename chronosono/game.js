// Pure game logic. No DOM, no network. State is plain JSON so it can be saved and restored.

export const MAX_TOKENS = 5;
export const SKIP_COST = 1;
export const CHALLENGE_COST = 1;
export const BUY_COST = 3;
export const COOP_LIVES = 3;
export const YEAR_FLOOR = 1950;
export const GENRES = ["Pop", "Rock", "Hip-hop", "R&B & Soul", "Country", "Dance & Electronic", "Latin", "Folk & Singer-songwriter"];

// Catalog rows are [title, artist, year, spotifyTrackId | null, genres]. Rows without a Spotify ID
// can't be played from a link, so they are left out of the deck.
export function toCards(songs) {
  return songs
    .filter((row) => typeof row[3] === "string" && row[3].length === 22)
    .map(([title, artist, year, spotify, genres]) => ({ id: spotify, title, artist, year, spotify, genres: genres || [] }));
}

export function inRange(cards, yearMin, yearMax) {
  return cards.filter((c) => c.year >= yearMin && c.year <= yearMax);
}

// The songs a game can draw: in the year range, and in any chosen genre (none chosen means all).
export function filterCards(cards, { yearMin, yearMax, genres = [] }) {
  const inYears = inRange(cards, yearMin, yearMax);
  if (!genres.length) return inYears;
  const want = new Set(genres);
  return inYears.filter((c) => c.genres.some((g) => want.has(g)));
}

export function yearHistogram(cards, from, to) {
  const counts = {};
  for (let y = from; y <= to; y++) counts[y] = 0;
  for (const c of cards) if (c.year in counts) counts[c.year]++;
  return counts;
}

// Narrow ranges put songs closer together, which makes placement harder.
export function difficultyLabel(yearMin, yearMax) {
  const span = yearMax - yearMin + 1;
  if (span >= 35) return "Easy";
  if (span >= 15) return "Medium";
  return "Hard";
}

// Rough number of songs a game will use: anchors plus about 2.5 draws per card won.
export function songsNeeded(playerCount, target) {
  return Math.ceil(playerCount * (1 + target * 2.5));
}

export function isCorrect(timeline, gap, year) {
  const before = timeline[gap - 1];
  const after = timeline[gap];
  return (!before || before.year <= year) && (!after || after.year >= year);
}

export function insertSorted(timeline, card) {
  const next = [...timeline, card];
  next.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
  return next;
}

function pickIndex(n, rng) {
  return Math.min(n - 1, Math.floor(rng() * n));
}

// Removes and returns one card from the pool. With decade balance on, picks a decade
// first so a wide range does not tilt toward whichever decade has the most songs.
export function drawFromPool(pool, balance, rng) {
  if (pool.length === 0) return { card: null, pool };
  let idx;
  if (balance) {
    const decades = [...new Set(pool.map((c) => Math.floor(c.year / 10)))];
    const decade = decades[pickIndex(decades.length, rng)];
    const choices = pool.map((c, i) => [c, i]).filter(([c]) => Math.floor(c.year / 10) === decade);
    idx = choices[pickIndex(choices.length, rng)][1];
  } else {
    idx = pickIndex(pool.length, rng);
  }
  const card = pool[idx];
  return { card, pool: pool.filter((_, i) => i !== idx) };
}

export function createGame(config, names, allCards, rng = Math.random) {
  const coop = config.mode === "coop";
  let pool = filterCards(allCards, config);
  const playerNames = coop ? [names[0] || "Our group"] : names;
  const players = [];
  for (const name of playerNames) {
    const drawn = drawFromPool(pool, config.balance, rng);
    pool = drawn.pool;
    players.push({ name, timeline: drawn.card ? [drawn.card] : [], tokens: coop ? 0 : config.startTokens });
  }
  return {
    config: { ...config },
    players,
    lives: coop ? COOP_LIVES : null,
    pool,
    history: [],
    turn: 0,
    round: 1,
    phase: "ready",
    current: null,
    placement: null,
    yearGuess: null,
    challenges: [],
    result: null,
    winner: null,
    endReason: null,
  };
}

export const activePlayer = (s) => s.players[s.turn];

export function startTurn(s, rng = Math.random) {
  if (s.phase !== "ready") return s;
  const { card, pool } = drawFromPool(s.pool, s.config.balance, rng);
  if (!card) return endByLeader({ ...s }, "The song pool ran out.");
  return { ...s, pool, current: card, phase: "place", placement: null, yearGuess: null, challenges: [], result: null };
}

function updatePlayer(s, idx, fn) {
  return { ...s, players: s.players.map((p, i) => (i === idx ? fn(p) : p)) };
}

export function canSkip(s) {
  return s.phase === "place" && s.config.mode !== "coop" && activePlayer(s).tokens >= SKIP_COST;
}

export function skip(s, rng = Math.random) {
  if (!canSkip(s)) return s;
  let next = updatePlayer(s, s.turn, (p) => ({ ...p, tokens: p.tokens - SKIP_COST }));
  next = { ...next, history: [...next.history, { card: s.current, player: s.turn, outcome: "skipped" }] };
  const { card, pool } = drawFromPool(next.pool, next.config.balance, rng);
  if (!card) return endByLeader({ ...next, current: null }, "The song pool ran out.");
  return { ...next, pool, current: card, placement: null };
}

// Swap out a song Spotify could not find or play, at no cost to the player.
export function replaceUnavailable(s, rng = Math.random) {
  if (s.phase !== "place" || !s.current) return s;
  const next = { ...s, history: [...s.history, { card: s.current, player: s.turn, outcome: "unavailable" }] };
  const { card, pool } = drawFromPool(next.pool, next.config.balance, rng);
  if (!card) return endByLeader({ ...next, current: null }, "The song pool ran out.");
  return { ...next, pool, current: card, placement: null };
}

export function canBuy(s) {
  return s.phase === "ready" && s.config.mode !== "coop" && activePlayer(s).tokens >= BUY_COST;
}

// Trade tokens for a card placed correctly by the app. Uses the player's turn.
export function buyCard(s, rng = Math.random) {
  if (!canBuy(s)) return s;
  const { card, pool } = drawFromPool(s.pool, s.config.balance, rng);
  if (!card) return s;
  let next = updatePlayer(s, s.turn, (p) => ({ ...p, tokens: p.tokens - BUY_COST, timeline: insertSorted(p.timeline, card) }));
  next = { ...next, pool, history: [...next.history, { card, player: s.turn, outcome: "bought" }] };
  return advance(next);
}

export function place(s, gap) {
  if (s.phase !== "place") return s;
  const max = activePlayer(s).timeline.length;
  if (gap < 0 || gap > max) return s;
  return { ...s, placement: gap };
}

export function setYearGuess(s, year) {
  return { ...s, yearGuess: Number.isFinite(year) ? year : null };
}

export function eligibleChallengers(s) {
  if (s.config.mode === "coop") return [];
  return s.players
    .map((p, i) => i)
    .filter((i) => i !== s.turn && s.players[i].tokens >= CHALLENGE_COST && !s.challenges.some((c) => c.player === i));
}

export function canLockIn(s) {
  if (s.phase !== "place" || s.placement === null) return false;
  if (s.config.mode === "expert" && s.yearGuess === null) return false;
  return true;
}

export function lockIn(s) {
  if (!canLockIn(s)) return s;
  return { ...s, phase: eligibleChallengers(s).length ? "challenge" : "reveal-pending" };
}

export function takenGaps(s) {
  return [s.placement, ...s.challenges.map((c) => c.gap)];
}

export function addChallenge(s, player, gap) {
  if (s.phase !== "challenge") return s;
  if (!eligibleChallengers(s).includes(player)) return s;
  if (takenGaps(s).includes(gap)) return s;
  if (gap < 0 || gap > activePlayer(s).timeline.length) return s;
  const next = updatePlayer(s, player, (p) => ({ ...p, tokens: p.tokens - CHALLENGE_COST }));
  return { ...next, challenges: [...next.challenges, { player, gap }] };
}

export function undoChallenge(s, player) {
  if (s.phase !== "challenge") return s;
  if (!s.challenges.some((c) => c.player === player)) return s;
  const next = updatePlayer(s, player, (p) => ({ ...p, tokens: p.tokens + CHALLENGE_COST }));
  return { ...next, challenges: next.challenges.filter((c) => c.player !== player) };
}

// Turn order after the active player decides who steals when several challengers are right.
function challengeOrder(s) {
  const n = s.players.length;
  return [...s.challenges].sort((a, b) => ((a.player - s.turn + n) % n) - ((b.player - s.turn + n) % n));
}

// named: whether the active player named title and artist before the flip (judged by the table).
export function reveal(s, { named = false } = {}) {
  if (s.phase !== "challenge" && s.phase !== "reveal-pending") return s;
  const mode = s.config.mode;
  const card = s.current;
  const active = activePlayer(s);
  const placedRight = isCorrect(active.timeline, s.placement, card.year);
  let keeps = placedRight;
  if (mode === "pro") keeps = placedRight && named;
  if (mode === "expert") keeps = placedRight && s.yearGuess === card.year;

  let next = { ...s };
  let stolenBy = null;
  let tokenEarned = false;

  if (keeps) {
    next = updatePlayer(next, s.turn, (p) => ({ ...p, timeline: insertSorted(p.timeline, card) }));
  } else if (mode !== "coop") {
    for (const c of challengeOrder(s)) {
      if (isCorrect(active.timeline, c.gap, card.year)) {
        stolenBy = c.player;
        next = updatePlayer(next, c.player, (p) => ({ ...p, timeline: insertSorted(p.timeline, card) }));
        break;
      }
    }
  }

  if (named && mode !== "pro" && mode !== "coop" && active.tokens < MAX_TOKENS) {
    tokenEarned = true;
    next = updatePlayer(next, s.turn, (p) => ({ ...p, tokens: Math.min(MAX_TOKENS, p.tokens + 1) }));
  }

  let lives = s.lives;
  if (mode === "coop" && !keeps) lives -= 1;

  const outcome = keeps ? "kept" : stolenBy !== null ? "stolen" : "discarded";
  const result = { card, placedRight, keeps, stolenBy, tokenEarned, named, yearGuess: s.yearGuess, outcome };
  const revealed = {
    ...next,
    lives,
    phase: "reveal",
    result,
    history: [...next.history, { card, player: s.turn, outcome, stolenBy }],
  };
  // The game ends the moment a card takes a team to the target, on a keep or a steal.
  const gainer = keeps ? s.turn : stolenBy;
  if (gainer !== null && revealed.players[gainer].timeline.length >= s.config.target) {
    return { ...revealed, phase: "over", winner: gainer, endReason: reachedReason(s) };
  }
  return revealed;
}

const reachedReason = (s) => (s.config.mode === "coop" ? "You reached the target together." : `First to ${s.config.target} cards.`);

export function nextTurn(s) {
  if (s.phase !== "reveal") return s;
  return advance({ ...s, current: null, placement: null, yearGuess: null, challenges: [], result: null });
}

function advance(s) {
  const n = s.players.length;
  if (s.config.mode === "coop") {
    const p = s.players[0];
    if (p.timeline.length >= s.config.target) return { ...s, phase: "over", winner: 0, endReason: reachedReason(s) };
    if (s.lives <= 0) return { ...s, phase: "over", winner: null, endReason: "Out of lives." };
    return { ...s, phase: "ready", round: s.round + 1 };
  }
  // A traded-in card can also reach the target; the game ends right there.
  const done = s.players.findIndex((p) => p.timeline.length >= s.config.target);
  if (done >= 0) return { ...s, phase: "over", winner: done, endReason: reachedReason(s) };
  const turn = (s.turn + 1) % n;
  const round = turn === 0 ? s.round + 1 : s.round;
  return { ...s, turn, round, phase: "ready" };
}

function endByLeader(s, reason) {
  const counts = s.players.map((p) => p.timeline.length);
  const best = Math.max(...counts);
  const leaders = counts.flatMap((c, i) => (c === best ? [i] : []));
  return { ...s, phase: "over", winner: leaders.length === 1 ? leaders[0] : null, endReason: reason };
}

// Songs that reached the table, in the order they were played. Used for the recap and playlist.
export function playedCards(s) {
  const seen = new Set();
  const out = [];
  for (const h of s.history) {
    if (h.card && h.outcome !== "unavailable" && !seen.has(h.card.id)) {
      seen.add(h.card.id);
      out.push(h.card);
    }
  }
  return out;
}
