// ChronoSono, Public edition. One page that becomes either the DJ phone or a team phone.
// The DJ phone opens each song as an ordinary Spotify link while face down; no Spotify API.
import { SONGS } from "/chronosono/songs.js";
import * as G from "/chronosono/game.js";

const API = "/chronosono/api";
const ALL = G.toCards(SONGS);
const YEAR_MIN = G.YEAR_FLOOR;
const YEAR_MAX = Math.max(new Date().getFullYear(), ...SONGS.map((r) => r[2]));
const HISTOGRAM = G.yearHistogram(ALL, YEAR_MIN, YEAR_MAX);
const HIST_PEAK = Math.max(1, ...Object.values(HISTOGRAM));
const FACE_DOWN = 145; // degrees from face up
const ARM_AFTER_MS = 600;

const MODES = {
  original: { name: "Original", blurb: "Place each song in the right spot. Name it for a bonus token." },
  pro: { name: "Pro", blurb: "The card only counts if you also name the title and artist." },
  expert: { name: "Expert", blurb: "Place it and call the exact year." },
};
const PRESETS = [
  { label: "50s to 70s", min: 1950, max: 1979 },
  { label: "80s and 90s", min: 1980, max: 1999 },
  { label: "2000s", min: 2000, max: 2009 },
  { label: "2010s", min: 2010, max: 2019 },
  { label: "Last 15 years", min: YEAR_MAX - 14, max: YEAR_MAX },
  { label: "All years", min: YEAR_MIN, max: YEAR_MAX },
];

// ---------- Small helpers ----------

const store = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

function deviceId() {
  let id = store.get("ts.device");
  if (!id) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    id = Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => chars[b % chars.length]).join("");
    store.set("ts.device", id);
  }
  return id;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const decade = (y) => Math.floor(y / 10) * 10;
const possessive = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const spotifyUrl = (id) => `https://open.spotify.com/track/${id}`;

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4500);
}

// ---------- State ----------

const me = deviceId();
const params = new URLSearchParams(location.search);
const app = {
  screen: "home", // home | join | room
  joinCode: (params.get("room") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4),
  pendingRole: params.get("room") ? null : null,
  name: store.get("ts.name", ""),
  view: null,
  clockOffset: 0,
  busy: false,
  error: "",
  ui: { challengeMode: false, configDraft: null },
};
const root = document.getElementById("app");
const blind = document.getElementById("blind");

// ---------- Network ----------

async function api(method, path, body) {
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error(data.error || `The server returned ${res.status}.`);
  return data;
}

function applyView(v) {
  if (!v || v.unchanged) {
    if (v?.serverNow) app.clockOffset = v.serverNow - Date.now();
    return false;
  }
  const prev = app.view;
  app.view = v;
  app.clockOffset = v.serverNow - Date.now();
  store.set("ts.room", v.code);
  if (prev?.stage !== v.stage || prev?.game?.turn !== v.game?.turn) app.ui.challengeMode = false;
  const wantMode = dj.computer ? "computer" : "phone";
  if (v.me.role === "dj" && v.djMode !== wantMode && dj.modeSent !== `${v.code}:${wantMode}`) {
    dj.modeSent = `${v.code}:${wantMode}`;
    api("POST", `rooms/${v.code}/actions`, { deviceId: me, type: "djMode", mode: wantMode }).then(applyView).then(render).catch(() => (dj.modeSent = null));
  }
  if (v.me.role === "dj" && v.play.status === "cued" && dj.playedNonce === v.play.nonce) {
    api("POST", `rooms/${v.code}/actions`, { deviceId: me, type: "played", nonce: v.play.nonce }).then(applyView).then(render).catch(() => {});
  }
  return true;
}

async function act(type, extra = {}, { quiet = false } = {}) {
  if (!app.view) return;
  try {
    const v = await api("POST", `rooms/${app.view.code}/actions`, { deviceId: me, type, ...extra });
    applyView(v);
    if (!quiet) render();
    return v;
  } catch (e) {
    toast(e.message);
    poll(true);
  }
}

let pollTimer = null;
let polling = false;
async function poll(now = false) {
  clearTimeout(pollTimer);
  if (!app.view || document.visibilityState === "hidden") return;
  if (polling && !now) return schedule();
  polling = true;
  try {
    const v = await api("GET", `rooms/${app.view.code}?device=${me}&since=${now ? "" : app.view.version}`);
    if (applyView(v)) render();
    else tickCountdown();
  } catch (e) {
    if (/No game with code/.test(e.message)) {
      store.set("ts.room", null);
      app.view = null;
      app.screen = "home";
      app.error = e.message;
      render();
      polling = false;
      return;
    }
  }
  polling = false;
  schedule();
}
function schedule() {
  clearTimeout(pollTimer);
  const s = app.view?.stage;
  const fast = s === "place" || s === "challenge" || s === "judge" || s === "lobby";
  pollTimer = setTimeout(poll, fast ? 1000 : 2000);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    poll(true);
    keepAwake();
  }
});

// ---------- Screen wake lock ----------

let wakeLock = null;
async function keepAwake() {
  try {
    if ("wakeLock" in navigator && !wakeLock && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    }
  } catch {}
}

// ---------- DJ phone: motion, beeps, and the face-down tap ----------

const dj = { enabled: false, audio: null, angle: null, downSince: null, armedNonce: null, playedNonce: store.get("ts.playedNonce", null), noSensorTimer: null, noSensor: false, computer: store.get("ts.djComputer", false), appLinks: store.get("ts.djApp", true) };
// A computer DJ opens songs in the Spotify desktop app (or, as an option, one reused browser tab) and keeps its screen turned away.
const SPOTIFY_TAB = "chronosono-spotify";
const looksLikeComputer = () => !matchMedia("(pointer: coarse)").matches;
// The desktop app only shows a song for a bare spotify:track: link; a start time makes it play.
const songUrl = (id) => (dj.appLinks ? `spotify:track:${id}#0:01` : spotifyUrl(id));

function screenAngle(beta, gamma) {
  const r = Math.PI / 180;
  const up = Math.cos(beta * r) * Math.cos(gamma * r);
  return Math.acos(Math.max(-1, Math.min(1, up))) / r;
}

function beep(times = 2) {
  const a = dj.audio;
  if (!a) return;
  const t = a.currentTime;
  for (let i = 0; i < times; i++) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t + i * 0.22);
    g.gain.exponentialRampToValueAtTime(0.4, t + i * 0.22 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.22 + 0.15);
    o.connect(g).connect(a.destination);
    o.start(t + i * 0.22);
    o.stop(t + i * 0.22 + 0.16);
  }
}

async function enableDj() {
  // Safari grants motion access only during the tap itself, so ask before any await.
  const ask = typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function";
  const permission = ask ? DeviceOrientationEvent.requestPermission() : Promise.resolve("granted");
  try {
    dj.audio = dj.audio || new (window.AudioContext || window.webkitAudioContext)();
    dj.audio.resume();
  } catch {}
  keepAwake();
  try {
    if ((await permission) !== "granted") {
      toast("Motion access was declined. Reload the page and allow it, or the DJ phone can't tell when it's face down.");
      return;
    }
  } catch (e) {
    toast(`This browser wouldn't share motion data (${e?.name || "error"}).`);
    return;
  }
  window.addEventListener("deviceorientation", onOrient);
  dj.enabled = true;
  dj.noSensor = false;
  clearTimeout(dj.noSensorTimer);
  dj.noSensorTimer = setTimeout(() => {
    if (dj.angle === null) {
      dj.noSensor = true;
      render();
    }
  }, 4000);
  render();
}

function djNeedsPlay() {
  const v = app.view;
  return v?.me.role === "dj" && v.play.status === "cued" && v.spotify && dj.playedNonce !== v.play.nonce;
}

function onOrient(e) {
  if (e.beta == null || e.gamma == null) return;
  dj.angle = screenAngle(e.beta, e.gamma);
  const el = document.getElementById("angle");
  if (el) {
    el.textContent = angleText(dj.angle);
    el.classList.toggle("ok", dj.angle >= FACE_DOWN);
  }
  const want = djNeedsPlay();
  if (want && dj.angle >= FACE_DOWN) {
    if (dj.downSince === null) dj.downSince = Date.now();
    if (dj.armedNonce !== app.view.play.nonce && Date.now() - dj.downSince >= ARM_AFTER_MS) arm();
  } else {
    dj.downSince = null;
    if (dj.armedNonce !== null) disarm();
  }
}

function angleText(a) {
  if (a === null) return "Waiting for the motion sensor.";
  if (a >= FACE_DOWN) return "Face down. Tap anywhere on the screen.";
  if (a >= 115) return "Almost face down. Lay it flat.";
  if (a >= 65) return "Standing on its edge. Lay it flat, screen down.";
  return "Screen up. Turn it over.";
}

function arm() {
  const v = app.view;
  dj.armedNonce = v.play.nonce;
  blind.href = spotifyUrl(v.spotify);
  blind.classList.add("armed");
  beep(2);
}

function disarm() {
  dj.armedNonce = null;
  blind.classList.remove("armed");
  blind.href = "#";
}

function reportPlayed(v) {
  const nonce = v.play.nonce;
  dj.playedNonce = nonce;
  store.set("ts.playedNonce", nonce);
  try {
    fetch(`${API}/rooms/${v.code}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: me, type: "played", nonce }),
      keepalive: true,
    });
  } catch {}
}

// Computer DJ: open the cued song. tab is a window opened earlier in the same click, if any.
function playOnComputer(tab = null) {
  const v = app.view;
  if (!v?.spotify || !djNeedsPlay()) {
    tab?.close();
    return;
  }
  const url = songUrl(v.spotify);
  if (dj.appLinks) location.href = url;
  else if (tab) tab.location.href = url;
  else window.open(url, SPOTIFY_TAB);
  reportPlayed(v);
  render();
}

// The tap is a real link so iOS opens the Spotify app directly. Report playback without
// waiting, since the page goes to the background as Spotify opens.
blind.addEventListener("click", (e) => {
  const v = app.view;
  if (!blind.classList.contains("armed") || !v?.spotify) {
    e.preventDefault();
    return;
  }
  reportPlayed(v);
  setTimeout(() => {
    disarm();
    render();
  }, 300);
});

// ---------- Logo ----------

// The way music has been carried, each drawn as a clock running backward: a record, a cassette
// with clock-faced reels, a CD, an iPod click wheel, and an app tile, then back to the record.
// SMIL so it runs without script; paused on the record under reduced motion.
const LOGO_DUR = "15s";
const LOGO_BODY = [
  ["x", "4;4;2;2;4;4;14;14;6;6;4"],
  ["y", "4;4;12;12;4;4;2;2;6;6;4"],
  ["width", "56;56;60;60;56;56;36;36;52;52;56"],
  ["height", "56;56;40;40;56;56;60;60;52;52;56"],
  ["rx", "28;28;4;4;28;28;7;7;13;13;28"],
];
const LOGO_TIMES = "0;.17;.2;.37;.4;.57;.6;.77;.8;.97;1";
const LOGO_EASE = Array.from({ length: 10 }, (_, i) => (i % 2 ? ".6 0 .2 1" : "0 0 1 1")).join(";");
const fade = (values, times) => `<animate attributeName="opacity" values="${values}" keyTimes="${times}" dur="${LOGO_DUR}" repeatCount="indefinite"/>`;
const stage = (from, to) => fade("0;0;1;1;0;0", `0;${from};${(from + 0.02).toFixed(2)};${to};${(to + 0.02).toFixed(2)};1`);
const spin = (cx, cy, dur) => `<animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="-360 ${cx} ${cy}" dur="${dur}" repeatCount="indefinite"/>`;

// A clock face: twelve ticks and two hands turning counterclockwise. r is the tick radius.
function clock(cx, cy, r, { animated = true, ticks = 12, weight = 1 } = {}) {
  const tick = Array.from({ length: ticks }, (_, i) => {
    const major = (i * 12) / ticks % 3 === 0;
    return `<line x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy - r + r * (major ? 0.2 : 0.12)}" transform="rotate(${(i * 360) / ticks} ${cx} ${cy})"/>`;
  }).join("");
  return `<g stroke="#121110" stroke-linecap="round">
    <g stroke-width="${weight * 0.9}">${tick}</g>
    <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r * 0.55}" stroke-width="${weight * 1.7}">${animated ? spin(cx, cy, "36s") : ""}</line>
    <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r * 0.8}" stroke-width="${weight * 1.1}" transform="rotate(120 ${cx} ${cy})">${animated ? spin(cx, cy, "3s") : ""}</line>
  </g>`;
}

function logoSvg({ animated = true, small = false } = {}) {
  const body = animated
    ? `<rect x="4" y="4" width="56" height="56" rx="28" fill="#c8202f">${LOGO_BODY.map(([a, v]) => `<animate attributeName="${a}" values="${v}" keyTimes="${LOGO_TIMES}" calcMode="spline" keySplines="${LOGO_EASE}" dur="${LOGO_DUR}" repeatCount="indefinite"/>`).join("")}</rect>`
    : `<rect x="4" y="4" width="56" height="56" rx="28" fill="#c8202f"/>`;
  const record = `<g>${animated ? fade("1;1;0;0;1", "0;.17;.19;.98;1") : ""}
    <g fill="none" stroke="#121110" stroke-opacity=".38" stroke-width=".8"><circle cx="32" cy="32" r="25"/><circle cx="32" cy="32" r="21.5"/><circle cx="32" cy="32" r="18"/><circle cx="32" cy="32" r="14.5"/></g>
    <circle cx="32" cy="32" r="11" fill="#f4efe3"/>${clock(32, 32, 9.4, { animated })}
    <circle cx="32" cy="32" r="1.4" fill="#c8202f"/></g>`;
  if (!animated) return `<svg class="logo${small ? " small" : ""}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body}${record}</svg>`;
  const reel = (cx) => `<circle cx="${cx}" cy="27" r="5.4" fill="#f4efe3"/>${clock(cx, 27, 4.6, { ticks: 4, weight: 0.75 })}`;
  const cassette = `<g opacity="0">${stage(0.19, 0.37)}
    <rect x="8" y="16" width="48" height="22" fill="#f4efe3"/><rect x="14" y="20.5" width="36" height="13" fill="#121110"/>
    ${reel(24)}${reel(40)}<path d="M19 52 22 45H42L45 52Z" fill="#121110" fill-opacity=".3"/></g>`;
  const cd = `<g opacity="0">${stage(0.39, 0.57)}
    <circle cx="32" cy="32" r="25.5" fill="#f4efe3"/>
    <g fill="none" stroke="#121110" stroke-opacity=".38" stroke-width=".8"><circle cx="32" cy="32" r="22"/><circle cx="32" cy="32" r="18.5"/><circle cx="32" cy="32" r="15"/></g>
    <circle cx="32" cy="32" r="11" fill="#c8202f"/><circle cx="32" cy="32" r="9.2" fill="#f4efe3"/>
    ${clock(32, 32, 8, { weight: 0.85 })}<circle cx="32" cy="32" r="1.3" fill="#121110"/></g>`;
  const ipod = `<g opacity="0">${stage(0.59, 0.77)}
    <rect x="18" y="7" width="28" height="21" rx="1.5" fill="#121110"/>
    <g fill="#f4efe3"><rect x="21" y="11" width="16" height="2"/><rect x="21" y="15.5" width="11" height="2" fill-opacity=".6"/><rect x="21" y="22" width="22" height="2"/></g>
    <circle cx="32" cy="44.5" r="11.5" fill="#f4efe3"/>${clock(32, 44.5, 10.2, {})}
    <circle cx="32" cy="44.5" r="3" fill="#c8202f"/></g>`;
  const tile = `<g opacity="0">${stage(0.79, 0.97)}
    <circle cx="32" cy="32" r="15" fill="#f4efe3"/>${clock(32, 32, 12.6, { weight: 1.2 })}<circle cx="32" cy="32" r="1.6" fill="#c8202f"/></g>`;
  return `<svg class="logo${small ? " small" : ""}" viewBox="0 0 64 64" role="img" aria-label="ChronoSono: a clock running backward, drawn as a record, a cassette, a CD, an iPod, and an app">${body}${record}${cassette}${cd}${ipod}${tile}</svg>`;
}

function settleLogos() {
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.querySelectorAll("svg.logo").forEach((svg) => {
    svg.pauseAnimations?.();
    svg.setCurrentTime?.(0);
  });
}

// ---------- Home and join ----------

function homeView() {
  const saved = store.get("ts.room");
  return `
  <div class="home split">
    <header class="masthead">
      ${logoSvg()}
      <h1 class="wordmark brandname">ChronoSono</h1>
      <p class="lede">Hear a song, then slot it into your team's timeline by year. One phone plays the music face down, so nobody sees the answer.</p>
      <p class="hint"><a href="/chronosono/about/">How to play</a></p>
    </header>
    ${app.error ? `<p class="error">${esc(app.error)}</p>` : ""}
    ${saved ? `<div class="resume"><p>You were in game ${esc(saved)}.</p><button class="btn primary" data-action="rejoin">Go back to it</button></div>` : ""}
    <section class="panel">
      <h2>Join a game</h2>
      <div class="join-row">
        <label class="field"><span>Room code</span><input class="code-input" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" maxlength="4" data-field="joinCode" value="${esc(app.joinCode)}"></label>
        <button class="btn primary" data-action="goJoin" ${app.joinCode.length === 4 ? "" : "disabled"}>Join</button>
      </div>
    </section>
    <section class="panel">
      <h2>Start a game</h2>
      <p class="needs">You'll need at least three phones: one to play the music and one for each of two or more teams. The music phone needs the Spotify app.</p>
      <button class="btn primary" data-action="goCreate">Start a new game</button>
    </section>
  </div>`;
}

function roleView() {
  const creating = !app.joinCode;
  return `
  <div class="home">
    <header class="masthead">
      <div class="brand">${logoSvg({ animated: false, small: true })}<span class="wordmark small brandname">ChronoSono</span></div>
      <h1 class="wordmark small-mark" style="margin-top:18px">${creating ? "New game" : `Game ${esc(app.joinCode)}`}</h1>
      <p class="lede">What is this phone for?</p>
    </header>
    ${app.error ? `<p class="error">${esc(app.error)}</p>` : ""}
    <div class="choices">
      <button class="choice" data-action="pickRole" data-role="team">
        <span class="choice-name">A team</span>
        <span class="choice-blurb">Place songs on your timeline and challenge the other teams.</span>
      </button>
      <button class="choice" data-action="pickRole" data-role="dj">
        <span class="choice-name">The DJ</span>
        <span class="choice-blurb">Plays each song through Spotify. A phone plays it face down; a computer just keeps its screen turned away. Needs Spotify.</span>
      </button>
    </div>
    ${
      app.pendingRole === "team"
        ? `<section class="panel">
        <div class="join-row">
          <label class="field"><span>Team name</span><input type="text" maxlength="20" data-field="name" value="${esc(app.name)}" placeholder="Like Sharks or Table 2"></label>
          <button class="btn primary" data-action="confirmTeam" ${app.busy ? "disabled" : ""}>${creating ? "Create game" : "Join"}</button>
        </div>
        ${creating ? "" : `<p class="hint">Rejoining after a phone died? Type your team's exact name to take its seat back.</p>`}
      </section>`
        : ""
    }
    <button class="btn link" data-action="home">Back</button>
  </div>`;
}

// ---------- Lobby ----------

function lobbyView() {
  const v = app.view;
  const host = v.me.isHost;
  const link = `${location.origin}/chronosono/?room=${v.code}`;
  const roster = [
    `<li><span>${v.djMode === "computer" ? "DJ computer" : "DJ phone"}</span>${v.djJoined ? `<span>${v.me.role === "dj" ? `<span class="you">${dj.computer ? "This computer" : "This phone"}</span>` : "Ready"}</span>` : '<span class="missing">Waiting</span>'}</li>`,
    ...v.lobbyTeams.map((n, i) => `<li><span>${esc(n)}</span>${v.me.team === i ? '<span class="you">This phone</span>' : "<span>Ready</span>"}</li>`),
  ];
  if (v.lobbyTeams.length < 2) roster.push(`<li><span class="missing">Team ${v.lobbyTeams.length + 1}</span><span class="missing">Waiting</span></li>`);
  const canStart = v.djJoined && v.lobbyTeams.length >= 2;
  return `
  <div class="lobby">
    <header class="gamebar"><span class="brand">${logoSvg({ animated: false, small: true })}<span class="wordmark small brandname">ChronoSono</span></span></header>
    <div class="lobby-head">
      <div><div class="code-label">Room code</div><div class="code-big">${esc(v.code)}</div></div>
      <div class="actions"><button class="btn quiet" data-action="share" data-link="${esc(link)}">Share invite link</button></div>
    </div>
    <p class="hint">Others open <strong>${esc(location.host)}/chronosono</strong> and enter the code.</p>
    ${v.me.role === "dj" ? djLobbyNote() : ""}
    <section class="panel">
      <h2>Phones</h2>
      <ul class="roster">${roster.join("")}</ul>
    </section>
    ${host ? settingsView() : `<section class="panel"><h2>Settings</h2><p class="summary">${summary(v.config, v.songsInRange)}</p><p class="hint">The phone that created the game picks the settings and starts it.</p></section>`}
    ${host ? `<div class="start-row"><button class="btn primary big" data-action="start" ${canStart ? "" : "disabled"}>Start game</button>${canStart ? "" : `<span class="hint">Needs a DJ and two teams.</span>`}</div>` : ""}
  </div>`;
}

function djLobbyNote() {
  if (dj.computer) return `<div class="banner safe">This computer is the DJ. Keep its screen turned away from the teams. <button class="btn link" data-action="usePhone">Use a phone's motion sensor instead</button></div>`;
  if (dj.enabled && !dj.noSensor) return `<div class="banner safe">This is the DJ phone. Motion sensor is on.</div>`;
  if (dj.noSensor) return `<div class="banner warn">No motion data from this device, so it can't tell when it's face down. <button class="btn primary small" data-action="useComputer">Use it as a computer DJ</button></div>`;
  return `<div class="banner warn">This is the DJ phone. <button class="btn primary small" data-action="enableDj">Turn on the motion sensor</button></div>`;
}

function summary(c, n) {
  return `${MODES[c.mode].name}, ${c.yearMin} to ${c.yearMax} (${plural(n, "song")}), first to ${c.target} cards, ${plural(c.startTokens, "starting token")}.`;
}

function settingsView() {
  const c = app.ui.configDraft || app.view.config;
  return `
  <section class="panel">
    <h2>Years in play</h2>
    ${dialView(c)}
  </section>
  <section class="panel">
    <h2>Mode</h2>
    <div class="modes" role="radiogroup" aria-label="Mode">
      ${Object.entries(MODES)
        .map(([k, m]) => `<button class="mode ${c.mode === k ? "on" : ""}" role="radio" aria-checked="${c.mode === k}" data-action="mode" data-mode="${k}"><span class="mode-name">${m.name}</span><span class="mode-blurb">${m.blurb}</span></button>`)
        .join("")}
    </div>
    <div class="steppers">
      ${stepper("target", "Cards to win", c.target, 5, 20)}
      ${stepper("startTokens", "Starting tokens", c.startTokens, 0, 5)}
    </div>
  </section>`;
}

function stepper(key, label, value, min, max) {
  return `<div class="stepper"><span class="stepper-label" id="lbl-${key}">${label}</span>
    <div class="stepper-ctl" role="group" aria-labelledby="lbl-${key}">
      <button class="btn round" data-action="step" data-key="${key}" data-delta="-1" ${value <= min ? "disabled" : ""} aria-label="Fewer">−</button>
      <output class="stepper-val">${value}</output>
      <button class="btn round" data-action="step" data-key="${key}" data-delta="1" ${value >= max ? "disabled" : ""} aria-label="More">+</button>
    </div></div>`;
}

function dialView(c) {
  const bars = [];
  for (let y = YEAR_MIN; y <= YEAR_MAX; y++) {
    const h = HISTOGRAM[y] ? Math.max(8, (HISTOGRAM[y] / HIST_PEAK) * 100) : 2;
    bars.push(`<span class="bar d${decade(y)}" data-year="${y}" style="height:${h}%"></span>`);
  }
  const ticks = [];
  for (let d = decade(YEAR_MIN); d <= YEAR_MAX; d += 10) ticks.push(`<span class="tick" style="left:${((d - YEAR_MIN) / (YEAR_MAX - YEAR_MIN + 1)) * 100}%">${d}</span>`);
  return `
  <div class="dial" style="--years:${YEAR_MAX - YEAR_MIN + 1}">
    <div class="dial-readout" aria-hidden="true"><span class="dial-year" id="outMin">${c.yearMin}</span><span class="dial-sep">to</span><span class="dial-year" id="outMax">${c.yearMax}</span></div>
    <div class="dial-face">
      <div class="bars">${bars.join("")}</div>
      <div class="dial-window" id="dialWindow"></div>
      <input type="range" class="handle" data-field="yearMin" min="${YEAR_MIN}" max="${YEAR_MAX}" step="1" value="${c.yearMin}" aria-label="Start year">
      <input type="range" class="handle" data-field="yearMax" min="${YEAR_MIN}" max="${YEAR_MAX}" step="1" value="${c.yearMax}" aria-label="End year">
    </div>
    <div class="ticks" aria-hidden="true">${ticks.join("")}</div>
    <div class="dial-under">
      <div class="presets" role="group" aria-label="Quick ranges">${PRESETS.map((p) => `<button class="chip" data-action="preset" data-min="${p.min}" data-max="${p.max}">${p.label}</button>`).join("")}</div>
    </div>
    <p class="dial-count" id="dialCount"></p>
    <label class="check"><input type="checkbox" data-field="balance" ${c.balance ? "checked" : ""}> Even out decades, so a wide range doesn't lean toward the busiest one</label>
  </div>`;
}

function updateDial() {
  const c = app.ui.configDraft || app.view?.config;
  const q = (s) => root.querySelector(s);
  if (!c || !q(".dial")) return;
  q("#outMin").textContent = c.yearMin;
  q("#outMax").textContent = c.yearMax;
  q('[data-field="yearMin"]').value = c.yearMin;
  q('[data-field="yearMax"]').value = c.yearMax;
  const years = YEAR_MAX - YEAR_MIN + 1;
  const win = q("#dialWindow");
  win.style.left = `${((c.yearMin - YEAR_MIN) / years) * 100}%`;
  win.style.width = `${((c.yearMax - c.yearMin + 1) / years) * 100}%`;
  root.querySelectorAll(".bar").forEach((b) => b.classList.toggle("out", +b.dataset.year < c.yearMin || +b.dataset.year > c.yearMax));
  const count = G.inRange(ALL, c.yearMin, c.yearMax).length;
  const need = G.songsNeeded(Math.max(2, app.view.lobbyTeams.length), c.target);
  const el = q("#dialCount");
  el.textContent = ALL.length === 0
    ? "Songs are still being matched to Spotify. Check back shortly."
    : `${plural(count, "song")} in range. ${G.difficultyLabel(c.yearMin, c.yearMax)} difficulty.${count < need ? ` A game this size uses about ${need}, so widen the years or lower the cards to win.` : ""}`;
  el.classList.toggle("warn", count < need);
}

let configTimer = null;
function changeConfig(patch, { now = false } = {}) {
  app.ui.configDraft = { ...(app.ui.configDraft || app.view.config), ...patch };
  clearTimeout(configTimer);
  const send = async () => {
    const draft = app.ui.configDraft;
    await act("config", { config: draft }, { quiet: true });
    if (app.ui.configDraft === draft) app.ui.configDraft = null;
    render();
  };
  if (now) send();
  else configTimer = setTimeout(send, 350);
}

function setYears(min, max, moved) {
  min = Math.max(YEAR_MIN, Math.min(YEAR_MAX, Math.round(min)));
  max = Math.max(YEAR_MIN, Math.min(YEAR_MAX, Math.round(max)));
  if (max - min < 4) {
    if (moved === "min") (max = Math.min(YEAR_MAX, min + 4)), (min = max - 4);
    else (min = Math.max(YEAR_MIN, max - 4)), (max = min + 4);
  }
  changeConfig({ yearMin: min, yearMax: max });
  updateDial();
}

// ---------- Shared game pieces ----------

function scoresView(v) {
  const g = v.game;
  return `<section class="scores compact" aria-label="Scores">${g.teams
    .map(
      (t, i) => `<div class="score ${i === g.turn && v.stage !== "over" ? "on" : ""}">
      <span class="score-name">${esc(t.name)}${v.me.team === i ? " (you)" : ""}</span>
      <span class="score-cards">${t.cards.length} of ${v.config.target}</span>
      <span class="score-tokens" aria-label="${plural(t.tokens, "token")}">${dots(t.tokens)}</span></div>`
    )
    .join("")}</section>`;
}

const dots = (n) => Array.from({ length: G.MAX_TOKENS }, (_, i) => `<i class="dot token ${i < n ? "full" : ""}"></i>`).join("");

function strip(c, extra = "") {
  return `<div class="strip d${decade(c.year)} ${extra}"><span class="strip-year">${c.year}</span><span class="strip-title">${esc(c.title)}</span><span class="strip-artist">${esc(c.artist)}</span></div>`;
}

// The flip plays once per card, not on every re-render while the card is showing.
function bigStrip(c) {
  const fresh = app.ui.flipped !== c.id;
  app.ui.flipped = c.id;
  return `<div class="strip big d${decade(c.year)} ${fresh ? "flip-in" : ""}"><span class="strip-year">${c.year}</span><span class="strip-title">${esc(c.title)}</span><span class="strip-artist">${esc(c.artist)}</span></div>`;
}

// mode: "place" (active team picks), "challenge" (this team picks a different gap), or "view"
function railView(v, mode) {
  const g = v.game;
  const tl = g.teams[g.turn].cards;
  const taken = [g.placement, ...g.challenges.map((c) => c.gap)];
  const marks = v.stage === "place" || v.stage === "challenge";
  const parts = [];
  for (let i = 0; i <= tl.length; i++) {
    const mine = marks && g.placement === i;
    const ch = marks ? g.challenges.find((c) => c.gap === i) : null;
    const live = mode === "place" || (mode === "challenge" && !taken.includes(i));
    let inner = '<span class="gap-label" aria-hidden="true">Slot it here</span>';
    if (mine) inner = '<span class="strip mystery" aria-hidden="true"><span class="strip-year">?</span><span class="strip-title">This song</span><span class="strip-artist">Year hidden until the reveal</span></span>';
    else if (ch) inner = `<span class="claim">${esc(g.teams[ch.player].name)} says here</span>`;
    const label = i === 0 ? "Before the first card" : i === tl.length ? "After the last card" : `Between ${tl[i - 1].year} and ${tl[i].year}`;
    parts.push(`<button class="gap ${mine ? "placed" : ""} ${ch ? "claimed" : ""} ${live ? "live" : ""}" data-action="gap" data-gap="${i}" ${live ? "" : "disabled"} aria-label="${label}">${inner}</button>`);
    if (i < tl.length) parts.push(strip(tl[i], v.stage === "result" && g.result?.keeps && g.result.card?.id === tl[i].id ? "new" : ""));
  }
  return `<div class="rail">${parts.join("")}</div>`;
}

function secondsLeft(v) {
  const end = v.game?.deadline;
  if (!end) return null;
  return Math.max(0, Math.ceil((end - (Date.now() + app.clockOffset)) / 1000));
}

function tickCountdown() {
  const el = document.getElementById("countdown");
  if (!el || !app.view) return;
  const s = secondsLeft(app.view);
  el.textContent = s === null ? "" : `${s}`;
}
setInterval(tickCountdown, 250);

// ---------- Team phone ----------

function teamView() {
  const v = app.view;
  const g = v.game;
  const mineIdx = v.me.team;
  const active = g.turn;
  const isActive = mineIdx === active;
  const activeName = esc(g.teams[active].name);
  const cued = v.play.status === "cued";
  const pc = v.djMode === "computer";
  let body = "";

  if (v.stage === "ready") {
    body = `
      <div class="stage team">
        <p class="stage-title">${isActive ? "You're up" : `${activeName} is up`}</p>
        <p>${pc ? "DJ: click <strong>Next song</strong> on the computer." : "Turn the DJ phone over and tap <strong>Next song</strong>."}</p>
        ${isActive && g.canBuy ? `<div class="mini-actions"><button class="btn quiet" data-action="buy">Trade ${G.BUY_COST} tokens for a free card instead</button></div>` : ""}
      </div>
      <h2 class="rail-title">${isActive ? "Your timeline" : `${possessive(activeName)} timeline`}</h2>
      ${railView(v, "view")}`;
  } else if (v.stage === "place") {
    const banner = cued
      ? `<div class="banner wait">${pc ? "Waiting for the DJ to play the song." : "Waiting for the DJ phone. Turn it face down, wait for two beeps, then tap the back of the screen."}</div>`
      : `<div class="banner">${pc ? "Song playing." : "Song playing. Keep the DJ phone face down."}</div>`;
    if (isActive) {
      // The active team's screen keeps the rack high: one status line instead of a banner and hint.
      const status = pc
        ? cued ? "Waiting for the DJ to play the song." : "Song playing."
        : cued ? "Waiting for the DJ phone: face down, two beeps, then tap its back." : "Song playing. Keep the DJ phone face down.";
      body = `
        <div class="stage team">
          <p class="stage-title">${g.placement === null ? "Where does it go?" : "Lock it in?"}</p>
          <p class="status">${status}</p>
          ${v.config.mode === "expert" ? `<label class="field compact year-guess"><span>Exact year</span><input type="number" inputmode="numeric" data-field="yearGuess" min="${YEAR_MIN}" max="${YEAR_MAX}" value="${g.yearGuess ?? ""}"></label>` : ""}
        </div>
        <div class="dock"><div class="dock-inner">
          <button class="btn primary big" data-action="lock" ${g.placement === null || (v.config.mode === "expert" && g.yearGuess === null) ? "disabled" : ""}>Lock in</button>
          ${g.canSkip ? `<button class="btn quiet small" data-action="skip">Skip (1 token)</button>` : ""}
          <button class="btn link" data-action="unplayable">Song didn't play?</button>
        </div></div>
        <h2 class="sr-only">Your timeline</h2>
        ${railView(v, "place")}`;
    } else {
      body = `${banner}
        <div class="stage team">
          <p class="stage-title">${activeName} is placing</p>
          <p class="hint">Get ready to challenge. If they lock in the wrong spot and you pick the right one, you take the card.</p>
          <div class="mini-actions"><button class="btn link" data-action="unplayable">Song didn't play?</button></div>
        </div>
        <h2 class="rail-title">${possessive(activeName)} timeline</h2>
        ${railView(v, "view")}`;
    }
  } else if (v.stage === "challenge") {
    const canChallenge = !isActive && g.eligible.includes(mineIdx) && !g.passed.includes(mineIdx);
    const myClaim = g.challenges.find((c) => c.player === mineIdx);
    const passed = g.passed.includes(mineIdx);
    let panel;
    if (isActive) panel = `<p class="stage-title">Locked in</p><p class="hint">The other teams can challenge.</p>`;
    else if (myClaim) panel = `<p class="stage-title">You challenged</p><p class="hint">Waiting for the other teams.</p><div class="mini-actions"><button class="btn quiet small" data-action="undoChallenge">Take it back</button></div>`;
    else if (passed) panel = `<p class="stage-title">No challenge</p><p class="hint">Waiting for the other teams.</p>`;
    else if (canChallenge)
      panel = `<p class="stage-title">Challenge?</p><p class="hint">Think ${activeName} is wrong? Tap a different gap to claim it for 1 token.</p>
        <div class="actions"><button class="btn quiet big" data-action="pass">No challenge</button></div>`;
    else panel = `<p class="stage-title">${activeName} locked in</p><p class="hint">You need a token to challenge.</p>`;
    body = `
      <div class="stage team">
        <div class="challenge-row"><div class="countdown" id="countdown">${secondsLeft(v) ?? ""}</div><div>${panel}</div></div>
      </div>
      <h2 class="rail-title">${possessive(activeName)} timeline</h2>
      ${railView(v, canChallenge ? "challenge" : "view")}`;
  } else if (v.stage === "judge") {
    const c = g.current;
    let ask;
    if (isActive) ask = `<p>Waiting for another team to say whether you named it before the reveal.</p><div class="mini-actions"><button class="btn quiet" data-action="judge" data-named="0">We didn't name it</button></div>`;
    else
      ask = `<p class="stage-title">Did ${activeName} name it?</p><p class="hint">Title and artist, said out loud before the reveal.${v.config.mode === "pro" ? " In Pro mode the card only counts with a yes." : " A yes earns them a token."}</p>
        <div class="actions"><button class="btn primary" data-action="judge" data-named="1">Yes</button><button class="btn quiet" data-action="judge" data-named="0">No</button></div>`;
    body = `<div class="stage team"><div class="reveal-row">${bigStrip(c)}<div>${ask}</div></div></div>
      <h2 class="rail-title">${possessive(activeName)} timeline</h2>${railView(v, "view")}`;
  } else if (v.stage === "result") {
    const r = g.result;
    let line;
    if (r.outcome === "kept") line = `${activeName} keeps it.`;
    else if (r.outcome === "stolen") line = `${esc(g.teams[r.stolenBy].name)} steals it.`;
    else line = "Nobody gets this one.";
    const notes = [];
    if (!r.placedRight) notes.push("The placement was off.");
    else if (!r.keeps && v.config.mode === "pro") notes.push("Right spot, but the song wasn't named.");
    else if (!r.keeps && v.config.mode === "expert") notes.push(`Right spot, but the year guess was ${r.yearGuess}.`);
    if (r.tokenEarned) notes.push(`${activeName} earns a token for naming it.`);
    body = `<div class="banner safe">${pc ? "DJ: click Next song when you're ready." : "Safe to turn over the DJ phone. Tap Next song on it when you're ready."}</div>
      <div class="stage team"><div class="reveal-row">${bigStrip(r.card)}<div>
        <p class="verdict ${r.keeps || r.outcome === "stolen" ? "good" : "bad"}">${line}</p>
        ${notes.map((n) => `<p class="hint">${n}</p>`).join("")}
        <p class="hint"><a href="${spotifyUrl(r.card.id)}" target="_blank" rel="noopener">Open in Spotify</a></p>
      </div></div></div>
      <h2 class="rail-title">${possessive(activeName)} timeline</h2>${railView(v, "view")}`;
  }

  return `
  <div class="game ${body.includes('class="dock"') ? "docked" : ""}">
    <header class="gamebar">
      <span class="brand">${logoSvg({ animated: false, small: true })}<span class="wordmark small brandname">ChronoSono</span></span>
      <span class="meta">${esc(v.code)}. Round ${g.round}. ${v.config.yearMin} to ${v.config.yearMax}.</span>
      <span class="spacer"></span>
      ${v.me.isHost ? `<button class="btn quiet small" data-action="end">End game</button>` : ""}
    </header>
    ${scoresView(v)}
    ${body}
    ${othersView(v)}
  </div>`;
}

function othersView(v) {
  const g = v.game;
  const rest = g.teams.map((t, i) => [t, i]).filter(([, i]) => i !== g.turn);
  return `<details class="others"><summary>Other timelines</summary>${rest
    .map(([t]) => `<div class="other"><h3>${esc(t.name)}</h3><ol class="mini">${t.cards.map((c) => `<li class="d${decade(c.year)}"><b>${c.year}</b> ${esc(c.title)}</li>`).join("")}</ol></div>`)
    .join("")}</details>`;
}

// ---------- DJ phone ----------

function djView() {
  const v = app.view;
  const g = v.game;
  const header = `<header class="gamebar"><span class="brand">${logoSvg({ animated: false, small: true })}<span class="wordmark small brandname">ChronoSono</span></span><span class="meta">DJ ${dj.computer ? "computer" : "phone"}, game ${esc(v.code)}</span></header>`;
  if (dj.computer) return computerDjView(v, g, header);
  if (!dj.enabled || dj.noSensor) {
    return `${header}<div class="dj">
      <p class="stage-title">Get the DJ phone ready</p>
      <ol class="dj-steps">
        <li>Turn the volume up, or connect a speaker.</li>
        <li>Make sure the Spotify app is installed and signed in.</li>
        <li>Tap below and allow motion access.</li>
      </ol>
      ${dj.noSensor ? `<p class="error">No motion data arrived, so this device can't tell when it's face down.</p>` : ""}
      <button class="btn primary big" data-action="enableDj">Turn on the motion sensor</button>
      <button class="btn link" data-action="useComputer">Use this as a computer DJ instead</button>
    </div>`;
  }
  if (djNeedsPlay()) {
    return `${header}<div class="dj">
      <p class="stage-title">Turn this phone face down</p>
      <p class="angle ${dj.angle >= FACE_DOWN ? "ok" : ""}" id="angle">${angleText(dj.angle)}</p>
      <p class="hint">Lay it flat, screen down. After two beeps, tap the back of the screen anywhere and the song starts in Spotify.</p>
    </div>`;
  }
  if (v.stage === "place" || v.stage === "challenge" || v.stage === "judge") {
    return `${header}<div class="dj">
      <p class="stage-title">Keep me face down</p>
      <p class="hint">The song is playing. The team phones will say when it's safe to turn me over.</p>
      <div class="mini-actions"><button class="btn link" data-action="replay">Song didn't start? Play it again</button></div>
    </div>`;
  }
  if (v.stage === "ready" || v.stage === "result") {
    const up = esc(g.teams[v.stage === "result" ? (g.turn + 1) % g.teams.length : g.turn].name);
    return `${header}<div class="dj">
      <p class="up-next">Up next: <strong>${up}</strong></p>
      <button class="dj-big" data-action="next"><span>Next song</span></button>
      <p class="hint">Tap, then turn the phone face down.</p>
    </div>`;
  }
  return `${header}<div class="dj"><p class="stage-title">Waiting</p></div>`;
}

function computerDjView(v, g, header) {
  const where = dj.appLinks ? "the Spotify app" : "a Spotify tab";
  const options = `<div class="mini-actions dj-options">
      <button class="btn link" data-action="toggleAppLinks">${dj.appLinks ? "Open songs in a browser tab instead" : "Open songs in the Spotify app instead"}</button>
      <button class="btn link" data-action="usePhone">Use a phone's motion sensor instead</button>
    </div>`;
  if (djNeedsPlay()) {
    return `${header}<div class="dj">
      <p class="stage-title">Ready to play</p>
      <p class="hint">Turn the screen away from the teams, then click Play. The song opens in ${where}.</p>
      <button class="dj-big" data-action="playSong"><span>Play song</span></button>
      ${options}
    </div>`;
  }
  if (v.stage === "place" || v.stage === "challenge" || v.stage === "judge") {
    return `${header}<div class="dj">
      <p class="stage-title">Song playing</p>
      <p class="hint">Keep Spotify out of sight until the team phones show the answer. If it opened without playing, press play in Spotify.</p>
      <div class="mini-actions"><button class="btn link" data-action="replay">Song didn't start? Play it again</button></div>
    </div>`;
  }
  if (v.stage === "ready" || v.stage === "result") {
    const up = esc(g.teams[v.stage === "result" ? (g.turn + 1) % g.teams.length : g.turn].name);
    return `${header}<div class="dj">
      <p class="up-next">Up next: <strong>${up}</strong></p>
      <button class="dj-big" data-action="next"><span>Next song</span></button>
      <p class="hint">Turn the screen away from the teams first. The song opens in ${where}.</p>
      ${dj.appLinks ? `<p class="hint">The first time, your browser asks to open Spotify. Choose Open, and tick Always allow if it offers. No Spotify app on this computer? Use a browser tab instead.</p>` : ""}
      ${options}
    </div>`;
  }
  return `${header}<div class="dj"><p class="stage-title">Waiting</p></div>`;
}

// ---------- Game over ----------

// The DJ phone's victory song. The button doesn't say what it is.
const VICTORY_SONG = "4cOdK2wGLETKBW3PvgPWqT";

function overView() {
  const v = app.view;
  const g = v.game;
  const winner = g.winner !== null && g.winner !== undefined ? g.teams[g.winner] : null;
  const standings = [...g.teams].sort((a, b) => b.cards.length - a.cards.length);
  const isDj = v.me.role === "dj";
  const mine = winner && v.me.team === g.winner;
  const r = g.result;
  // How the last card got there, when that card is what won it.
  let how = esc(g.endReason || "");
  if (winner && r?.card && (r.outcome === "kept" || r.outcome === "stolen")) {
    const song = `${esc(r.card.title)} (${r.card.year})`;
    how = r.outcome === "stolen" ? `${esc(winner.name)} stole ${song} for card ${winner.cards.length}.` : `${esc(winner.name)} placed ${song} for card ${winner.cards.length}.`;
  }
  // The winner's rack flips through once per game, not on every re-render.
  const key = `${v.code}:${g.round}:${g.winner}`;
  const fresh = app.ui.celebrated !== key;
  app.ui.celebrated = key;
  const rack = winner
    ? `<div class="rail victory-rack ${fresh ? "celebrate" : ""}">${winner.cards.map((c, i) => strip(c, r?.card?.id === c.id ? "new" : "").replace('class="strip', `style="--i:${i}" class="strip`)).join("")}</div>`
    : "";
  return `
  <div class="over">
    ${isDj ? `<header class="gamebar"><span class="brand">${logoSvg({ animated: false, small: true })}<span class="wordmark small brandname">ChronoSono</span></span><span class="meta">DJ phone, game ${esc(v.code)}</span></header>` : ""}
    <h1 class="wordmark victory-name">${winner ? (mine ? "You win" : `${esc(winner.name)} wins`) : "It's a draw"}</h1>
    <p class="lede">${how}</p>
    ${
      isDj && winner
        ? `<a class="dj-big victory-song" href="${dj.computer ? songUrl(VICTORY_SONG) : spotifyUrl(VICTORY_SONG)}" ${dj.computer && !dj.appLinks ? `target="${SPOTIFY_TAB}"` : ""}><span>Play the victory song</span></a>
           <p class="hint">Turn it up.</p>`
        : winner ? `<p class="hint">DJ: play the victory song.</p>` : ""
    }
    ${rack}
    <section class="panel"><h2>Final timelines</h2>
      <ol class="standings">${standings.map((t) => `<li><span class="st-name">${esc(t.name)}</span><span class="st-count">${plural(t.cards.length, "card")}</span></li>`).join("")}</ol>
    </section>
    <section class="panel"><h2>Songs this game</h2>
      <ul class="played">${g.played.map((c) => `<li class="d${decade(c.year)}"><b>${c.year}</b> ${esc(c.title)}, ${esc(c.artist)}<a href="${spotifyUrl(c.id)}" target="_blank" rel="noopener">Spotify</a></li>`).join("")}</ul>
    </section>
    <div class="start-row">
      ${v.me.isHost ? `<button class="btn primary big" data-action="rematch">Play again with the same phones</button>` : `<p class="hint">The phone that created the game can start a rematch.</p>`}
      <button class="btn quiet" data-action="leave">Leave game</button>
    </div>
  </div>`;
}

// ---------- Render ----------

function render() {
  if (app.ui.dragging) {
    app.ui.renderPending = true;
    return;
  }
  app.ui.renderPending = false;
  const focus = document.activeElement?.dataset?.field;
  const v = app.view;
  if (v?.me.role !== "dj" || !djNeedsPlay()) disarm();
  let html;
  if (app.screen === "home") html = homeView();
  else if (app.screen === "join") html = roleView();
  else if (!v) html = homeView();
  else if (v.stage === "lobby") html = lobbyView();
  else if (v.stage === "over") html = overView();
  else if (v.me.role === "dj") html = djView();
  else if (v.me.role === "team") html = teamView();
  else html = `<div class="home"><p class="lede">This phone isn't part of game ${esc(v.code)}.</p><button class="btn primary" data-action="leave">Back</button></div>`;
  root.innerHTML = html;
  root.classList.toggle("wide", root.firstElementChild?.classList.contains("split") ?? false);
  settleLogos();
  if (v?.stage === "lobby" && v.me.isHost) updateDial();
  if (focus) root.querySelector(`[data-field="${focus}"]`)?.focus();
}

// ---------- Actions ----------

async function enterRoom(code, role, name) {
  app.busy = true;
  app.error = "";
  render();
  try {
    let v;
    if (!code) v = await api("POST", "rooms", { deviceId: me, role, name });
    else v = await api("POST", `rooms/${code}/actions`, { deviceId: me, type: "join", role, name });
    applyView(v);
    app.screen = "room";
    history.replaceState(null, "", `/chronosono/?room=${v.code}`);
    poll();
  } catch (e) {
    app.error = e.message;
  }
  app.busy = false;
  render();
}

const actions = {
  home() {
    app.screen = "home";
    app.pendingRole = null;
    app.error = "";
    render();
  },
  goCreate() {
    app.joinCode = "";
    app.screen = "join";
    app.error = "";
    render();
  },
  goJoin() {
    if (app.joinCode.length !== 4) return;
    app.screen = "join";
    app.error = "";
    render();
  },
  async rejoin() {
    const code = store.get("ts.room");
    try {
      const v = await api("GET", `rooms/${code}?device=${me}`);
      applyView(v);
      if (v.me.role === "guest") {
        app.joinCode = code;
        app.screen = "join";
      } else app.screen = "room";
      history.replaceState(null, "", `/chronosono/?room=${code}`);
      poll();
    } catch (e) {
      store.set("ts.room", null);
      app.error = e.message;
    }
    render();
  },
  pickRole(el) {
    const role = el.dataset.role;
    if (role === "dj") {
      dj.computer = looksLikeComputer();
      store.set("ts.djComputer", dj.computer);
      if (!dj.computer) enableDj(); // starts the motion permission request inside this tap
      return enterRoom(app.joinCode, "dj");
    }
    app.pendingRole = "team";
    render();
    root.querySelector('[data-field="name"]')?.focus();
  },
  confirmTeam() {
    store.set("ts.name", app.name);
    enterRoom(app.joinCode, "team", app.name);
  },
  async share(el) {
    const link = el.dataset.link;
    try {
      if (navigator.share) await navigator.share({ title: "Join my ChronoSono game", text: `Room code ${app.view.code}`, url: link });
      else {
        await navigator.clipboard.writeText(link);
        toast("Invite link copied.");
      }
    } catch {}
  },
  enableDj,
  mode(el) {
    changeConfig({ mode: el.dataset.mode }, { now: true });
    render();
  },
  step(el) {
    const c = app.ui.configDraft || app.view.config;
    const lim = { target: [5, 20], startTokens: [0, 5] }[el.dataset.key];
    changeConfig({ [el.dataset.key]: Math.max(lim[0], Math.min(lim[1], c[el.dataset.key] + Number(el.dataset.delta))) }, { now: true });
    render();
  },
  preset(el) {
    setYears(+el.dataset.min, +el.dataset.max, "min");
  },
  start: () => act("start"),
  async next() {
    keepAwake();
    if (dj.audio) dj.audio.resume();
    dj.downSince = null;
    // On a computer, open the Spotify tab inside this click so the browser allows it, then
    // point it at the song once the server has drawn one.
    const tab = dj.computer && !dj.appLinks ? window.open("about:blank", SPOTIFY_TAB) : null;
    await act("next");
    if (dj.computer) playOnComputer(tab);
  },
  replay: () => act("replay"),
  playSong: () => playOnComputer(),
  useComputer() {
    dj.computer = true;
    store.set("ts.djComputer", true);
    render();
    act("djMode", { mode: "computer" }, { quiet: true });
  },
  usePhone() {
    dj.computer = false;
    store.set("ts.djComputer", false);
    enableDj();
    act("djMode", { mode: "phone" }, { quiet: true });
  },
  toggleAppLinks() {
    dj.appLinks = !dj.appLinks;
    store.set("ts.djApp", dj.appLinks);
    render();
  },
  buy: () => act("buy"),
  skip: () => act("skip"),
  unplayable() {
    if (confirm("Swap in a different song? Use this if the DJ couldn't play this one.")) act("unplayable");
  },
  gap(el) {
    const gap = Number(el.dataset.gap);
    if (app.view.stage === "place") act("place", { gap });
    else if (app.view.stage === "challenge") act("challenge", { gap });
  },
  lock: () => act("lock"),
  pass: () => act("pass"),
  undoChallenge: () => act("undoChallenge"),
  judge: (el) => act("judge", { named: el.dataset.named === "1" }),
  end() {
    if (confirm("End this game for everyone?")) act("end");
  },
  rematch: () => act("rematch"),
  leave() {
    store.set("ts.room", null);
    app.view = null;
    app.screen = "home";
    history.replaceState(null, "", "/chronosono/");
    render();
  },
};

root.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  keepAwake();
  actions[el.dataset.action]?.(el, e);
});

root.addEventListener("pointerdown", (e) => {
  if (e.target.classList?.contains("handle")) app.ui.dragging = true;
});
const endDrag = () => {
  if (!app.ui.dragging) return;
  app.ui.dragging = false;
  if (app.ui.renderPending) render();
};
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

root.addEventListener("input", (e) => {
  const el = e.target;
  const f = el.dataset.field;
  if (f === "joinCode") {
    el.value = el.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    app.joinCode = el.value;
    const b = root.querySelector('[data-action="goJoin"]');
    if (b) b.disabled = app.joinCode.length !== 4;
  } else if (f === "name") app.name = el.value;
  else if (f === "yearMin") setYears(+el.value, (app.ui.configDraft || app.view.config).yearMax, "min");
  else if (f === "yearMax") setYears((app.ui.configDraft || app.view.config).yearMin, +el.value, "max");
});

root.addEventListener("change", (e) => {
  const el = e.target;
  const f = el.dataset.field;
  if (f === "balance") changeConfig({ balance: el.checked }, { now: true });
  else if (f === "yearGuess") act("guess", { year: el.value === "" ? null : Number(el.value) });
});

root.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const f = e.target.dataset?.field;
  if (f === "joinCode") actions.goJoin();
  if (f === "name") actions.confirmTeam();
});

// ---------- Boot ----------

(async function boot() {
  const code = app.joinCode;
  if (code && code.length === 4) {
    try {
      const v = await api("GET", `rooms/${code}?device=${me}`);
      applyView(v);
      app.screen = v.me.role === "guest" ? "join" : "room";
      if (app.screen === "room") poll();
      else app.view = null;
    } catch (e) {
      app.error = e.message;
      app.screen = "home";
    }
  }
  render();
})();
