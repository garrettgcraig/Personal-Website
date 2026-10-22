# Timeline (Public edition)

A music timeline party game at `/timeline/`. One phone plays each song face down through an ordinary Spotify link, so nobody sees the answer, and each team uses its own phone. It uses no Spotify API.

## How a game works

1. Someone opens `/timeline/`, chooses **Start a new game**, and picks a role for their phone.
2. Everyone else opens `/timeline/` and enters the four-letter room code, or uses the invite link.
3. One phone joins as the **DJ phone** and turns on its motion sensor. It needs the Spotify app. Two to four phones join as **teams**.
4. The phone that created the game sets the years, mode, and cards to win, then starts.
5. Each round, someone taps **Next song** on the DJ phone and lays it face down. After two beeps they tap the back of the screen, and the song opens in Spotify.
6. The active team places the song on its timeline and locks in. Other teams have 15 seconds to challenge for a token. Then the card flips, an opposing team says whether the song was named, and the result shows on every team phone.
7. The team phones say when it's safe to turn the DJ phone over again.

## Pieces

| Path | What it does |
| --- | --- |
| `timeline/index.html`, `app.js`, `styles.css` | The page, which becomes the DJ phone or a team phone |
| `timeline/game.js` | Game rules, shared by the page and the server |
| `timeline/room.js` | Room server: joining, turns, challenges, and what each phone may see |
| `timeline/songs.js` | Song catalog: title, artist, original year, Spotify track ID |
| `netlify/functions/timeline-api.mjs` | The API at `/timeline/api/*`, storing rooms in Netlify Blobs |
| `scripts/timeline_resolve_spotify.py` | Finds Spotify IDs via Apple's iTunes search and song.link |
| `scripts/timeline_smoke.py` | Plays one turn against a deployed API |
| `.github/workflows/timeline-catalog.yml` | Runs the ID lookup when the catalog changes on a pull request |
| `.github/workflows/timeline-smoke.yml` | Runs the smoke test against each deploy preview |
| `data/timeline-catalog-report.md` | Songs without a Spotify ID, and years Apple disagrees with |
| `timeline/probe/` | The original DJ phone test page |

## Adding songs

Add rows to `timeline/songs.js` as `["Title", "Artist", year, null]` and open a pull request. The catalog workflow fills in the Spotify IDs (about 9 seconds per song, because song.link allows 10 lookups a minute) and commits them to the branch. Songs it can't match stay `null` and are left out of the game. Check `data/timeline-catalog-report.md` for misses and possible year errors.

## Running it locally

```
node tests/timeline-dev-server.mjs --fake-ids
```

Then open `http://127.0.0.1:8787/timeline/` in several browser windows. `--fake-ids` gives every song a made-up Spotify ID, so games run but the links won't play.

Tests:

```
node --test tests/timeline-room.test.mjs
python tests/timeline-catalog.test.py
```

## Limits

- Phones check for updates every one to two seconds. Each check is one Netlify function call, so a game with four phones uses roughly 7,000 to 10,000 calls an hour. Check your Netlify plan's function limits before sharing it widely. A larger release would need a real-time service.
- The DJ phone must lie flat face down to arm the tap. Standing on its edge doesn't count, because the motion sensor can't tell that apart from someone holding it up.
- Spotify shows the song on the DJ phone's lock screen and in the Spotify app, so the DJ phone stays face down until the team phones say it's safe.
