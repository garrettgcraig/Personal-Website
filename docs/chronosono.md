# ChronoSono

A music timeline party game at `/chronosono/`. One phone plays each song face down through an ordinary Spotify link, so nobody sees the answer, and each team uses its own phone. It uses no Spotify API.

## How a game works

1. Someone opens `/chronosono/`, chooses **Start a new game**, and picks a role for their phone.
2. Everyone else opens `/chronosono/` and enters the four-letter room code, or uses the invite link.
3. One device joins as the **DJ**. A phone turns on its motion sensor and plays each song face down; it needs the Spotify app. A computer (picked automatically when there's no touch screen) opens each song in the Spotify desktop app with one click (or in a browser tab, as an option), and the DJ presses play there, and its screen stays turned away from the teams. Two to four phones join as **teams**.
4. The phone that created the game sets the years, mode, and cards to win, then starts.
5. Each round, someone taps **Next song** on the DJ phone and lays it face down. After two beeps they tap the back of the screen, and the song opens in Spotify.
6. The active team places the song on its timeline and locks in. Other teams have 15 seconds to challenge for a token. Then the card flips, an opposing team says whether the song was named, and the result shows on every team phone.
7. The team phones say when it's safe to turn the DJ phone over again.

## Pieces

| Path | What it does |
| --- | --- |
| `chronosono/index.html`, `app.js`, `styles.css` | The page, which becomes the DJ phone or a team phone |
| `chronosono/game.js` | Game rules, shared by the page and the server |
| `chronosono/room.js` | Room server: joining, turns, challenges, and what each phone may see |
| `chronosono/songs.js` | Song catalog: title, artist, original year, Spotify track ID |
| `netlify/functions/chronosono-api.mjs` | The API at `/chronosono/api/*`, storing rooms in Netlify Blobs |
| `scripts/chronosono_resolve_spotify.py` | Finds missing Spotify IDs in Wikidata |
| `scripts/chronosono_seed_ids.py` | One-time seeding of IDs from public Billboard and Spotify datasets |
| `scripts/chronosono_smoke.py` | Plays one turn against a deployed API |
| `.github/workflows/chronosono-catalog.yml` | Runs the ID lookup when the catalog changes on a pull request |
| `.github/workflows/chronosono-smoke.yml` | Runs the smoke test against each deploy preview |
| `data/chronosono-catalog-report.md` | Songs without a Spotify ID, and years Apple disagrees with |
| `chronosono/probe/` | The original DJ phone test page |

## Adding songs

Add rows to `chronosono/songs.js` as `["Title", "Artist", year, null]` and open a pull request. The catalog workflow looks each new song up in Wikidata and commits any Spotify IDs it finds to the branch. Songs it can't match stay `null` and are left out of the game. To fill one by hand, open the song in Spotify, choose Share, then Copy song link, and paste the 22-character ID from the link (`open.spotify.com/track/<ID>`) into the row. Check `data/chronosono-catalog-report.md` for misses and possible year errors.

## Running it locally

```
node tests/chronosono-dev-server.mjs --fake-ids
```

Then open `http://127.0.0.1:8787/chronosono/` in several browser windows. `--fake-ids` gives every song a made-up Spotify ID, so games run but the links won't play.

Tests:

```
node --test tests/chronosono-room.test.mjs
python tests/chronosono-catalog.test.py
```

## Limits

- Phones check for updates every one to two seconds. Each check is one Netlify function call, so a game with four phones uses roughly 7,000 to 10,000 calls an hour. Check your Netlify plan's function limits before sharing it widely. A larger release would need a real-time service.
- The DJ phone must lie flat face down to arm the tap. Standing on its edge doesn't count, because the motion sensor can't tell that apart from someone holding it up.
- Spotify shows the song on the DJ phone's lock screen and in the Spotify app, so the DJ phone stays face down until the team phones say it's safe.
