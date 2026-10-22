#!/usr/bin/env python3
"""Fill in Spotify track IDs for the Timeline game catalog without the Spotify API.

For each song in timeline/songs.js that has no Spotify ID, this script:
  1. searches Apple's public iTunes Search API for the original recording, then
  2. asks song.link (Odesli) for the matching Spotify track.

Results are cached in data/timeline-catalog-cache.json so later runs only look up new
songs. A report of misses and year disagreements goes to data/timeline-catalog-report.md.

Both services are free and rate limited (song.link allows about 10 calls a minute without
a key), so a full run over ~600 songs takes roughly 90 minutes. GitHub Actions runs it.

Usage:
  python scripts/timeline_resolve_spotify.py [--limit N] [--max-minutes M] [--retry-misses]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SONGS_JS = ROOT / "timeline" / "songs.js"
CACHE = ROOT / "data" / "timeline-catalog-cache.json"
REPORT = ROOT / "data" / "timeline-catalog-report.md"

ITUNES_URL = "https://itunes.apple.com/search"
ODESLI_URL = "https://api.song.link/v1-alpha.1/links"
ITUNES_GAP = 3.2  # seconds between iTunes calls (about 20 a minute)
ODESLI_GAP = 6.5  # seconds between song.link calls (10 a minute without a key)
USER_AGENT = "TimelineCatalog/1.0 (+https://garrettgcraig.com/timeline/)"

UNWANTED = re.compile(
    r"\b(live|karaoke|instrumental|remix|cover|acoustic|demo|tribute|sped up|slowed|"
    r"re-?recorded|in the style of|8-bit|lullaby|made famous|originally performed)\b",
    re.I,
)
SPOTIFY_TRACK = re.compile(r"open\.spotify\.com/track/([A-Za-z0-9]{22})")


# ---------- Catalog file ----------

def read_catalog(path: Path = SONGS_JS) -> tuple[str, list[list]]:
    text = path.read_text(encoding="utf-8")
    start = text.index("export const SONGS = ") + len("export const SONGS = ")
    end = text.rindex("];") + 1
    return text[:start], json.loads(text[start:end])


def write_catalog(header: str, rows: list[list], path: Path = SONGS_JS) -> None:
    body = ",\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
    path.write_text(f"{header}[\n{body}\n];\n", encoding="utf-8")


def key_for(title: str, artist: str) -> str:
    return f"{title}|{artist}"


# ---------- Matching ----------

def normalize(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn").lower()
    s = re.sub(r"\s+-\s+.*$", "", s)  # " - 2011 Remaster", " - Single Version"
    s = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", s)
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def primary_artist(artist: str) -> str:
    return re.split(r"\s+(?:ft\.?|feat\.?|featuring|with|x)\s+|,\s*", artist, flags=re.I)[0]


def score(candidate: dict, title: str, artist: str) -> int:
    want_t = normalize(title)
    want_a = normalize(primary_artist(artist))
    name = normalize(candidate.get("trackName", ""))
    got_a = normalize(candidate.get("artistName", ""))
    s = 0
    if name == want_t:
        s += 6
    elif name.startswith(want_t) or want_t.startswith(name):
        s += 3
    elif want_t in name:
        s += 1
    else:
        s -= 4
    if got_a == want_a:
        s += 5
    elif want_a and (want_a in got_a or got_a in want_a):
        s += 3
    else:
        s -= 5
    blob = f"{candidate.get('trackName', '')} {candidate.get('collectionName', '')}"
    if not UNWANTED.search(title) and UNWANTED.search(blob):
        s -= 6
    if "greatest hits" in blob.lower() or "best of" in blob.lower() or "essential" in blob.lower():
        s -= 1
    return s


def release_year(candidate: dict) -> int | None:
    m = re.match(r"(\d{4})", candidate.get("releaseDate") or "")
    return int(m.group(1)) if m else None


def pick_itunes(results: list[dict], title: str, artist: str) -> dict | None:
    """Best-scoring match; among equal scores, the earliest release (closest to the original)."""
    scored = []
    for c in results:
        if c.get("kind") not in (None, "song") or not c.get("trackId"):
            continue
        s = score(c, title, artist)
        if s >= 7:
            scored.append((s, release_year(c) or 9999, c))
    if not scored:
        return None
    best = max(s for s, _, _ in scored)
    ties = [x for x in scored if x[0] == best]
    ties.sort(key=lambda x: x[1])
    return ties[0][2]


def spotify_from_odesli(data: dict, title: str, artist: str) -> str | None:
    url = ((data.get("linksByPlatform") or {}).get("spotify") or {}).get("url", "")
    m = SPOTIFY_TRACK.search(url)
    if not m:
        return None
    track_id = m.group(1)
    # Odesli matches by recording code, which is usually exact. Still check the title so a
    # wrong mapping never reaches the game.
    entity = (data.get("entitiesByUniqueId") or {}).get(f"SPOTIFY_SONG::{track_id}") or {}
    got = normalize(entity.get("title", ""))
    want = normalize(title)
    if got and not (got == want or got.startswith(want) or want.startswith(got) or want in got):
        return None
    return track_id


# ---------- Network ----------

class RateLimited(Exception):
    pass


def http_json(url: str, params: dict, timeout: int = 20) -> dict:
    full = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(full, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise RateLimited(url) from e
        if e.code == 404:
            return {}
        raise


class Throttle:
    def __init__(self, gap: float, sleep=time.sleep, clock=time.monotonic):
        self.gap, self.sleep, self.clock, self.last = gap, sleep, clock, -1e9

    def wait(self) -> None:
        delta = self.clock() - self.last
        if delta < self.gap:
            self.sleep(self.gap - delta)
        self.last = self.clock()


def call(fetch, throttle: Throttle, url: str, params: dict, sleep=time.sleep) -> dict:
    for attempt in range(4):
        throttle.wait()
        try:
            return fetch(url, params)
        except RateLimited:
            sleep(30 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            sleep(5 * (attempt + 1))
    return {}


def resolve_one(title: str, artist: str, fetch, itunes_t: Throttle, odesli_t: Throttle, sleep=time.sleep) -> dict:
    term = f"{title} {primary_artist(artist)}"
    data = call(fetch, itunes_t, ITUNES_URL, {"term": term, "entity": "song", "limit": 25, "country": "US"}, sleep)
    match = pick_itunes(data.get("results") or [], title, artist)
    if not match:
        return {"status": "no-apple-match"}
    out = {
        "appleId": match["trackId"],
        "appleTitle": match.get("trackName"),
        "appleArtist": match.get("artistName"),
        "appleYear": release_year(match),
    }
    links = call(fetch, odesli_t, ODESLI_URL, {"platform": "itunes", "type": "song", "id": match["trackId"], "userCountry": "US"}, sleep)
    spotify = spotify_from_odesli(links, title, artist)
    out["spotify"] = spotify
    out["status"] = "ok" if spotify else "no-spotify-link"
    return out


# ---------- Report ----------

def write_report(rows: list[list], cache: dict, path: Path = REPORT) -> None:
    total = len(rows)
    have = sum(1 for r in rows if r[3])
    misses = [r for r in rows if not r[3]]
    earlier = []
    for t, a, y, sp in rows:
        entry = cache.get(key_for(t, a)) or {}
        ay = entry.get("appleYear")
        if sp and ay and ay < y:
            earlier.append((t, a, y, ay))
    lines = [
        "# Timeline catalog report",
        "",
        f"Updated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}.",
        "",
        f"{have} of {total} songs have a Spotify ID and can be played. Songs without one are left out of the game.",
        "",
        "## Apple lists an earlier year",
        "",
        "Apple's earliest release of the matched recording is older than the year in `timeline/songs.js`. "
        "These are worth checking. Apple dates are often reissue dates, so a later Apple year is ignored.",
        "",
    ]
    lines += [f"- {t}, {a}: listed {y}, Apple {ay}" for t, a, y, ay in sorted(earlier, key=lambda x: x[2])] or ["None."]
    lines += ["", "## No Spotify ID found", ""]
    lines += [f"- {t}, {a} ({y}): {(cache.get(key_for(t, a)) or {}).get('status', 'not tried yet')}" for t, a, y, _ in misses] or ["None."]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------- Main ----------

def run(limit: int | None, max_minutes: float, retry_misses: bool, fetch=http_json, sleep=time.sleep, clock=time.monotonic,
        songs_path: Path = SONGS_JS, cache_path: Path = CACHE, report_path: Path = REPORT) -> dict:
    header, rows = read_catalog(songs_path)
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    itunes_t, odesli_t = Throttle(ITUNES_GAP, sleep, clock), Throttle(ODESLI_GAP, sleep, clock)
    started = clock()
    looked_up = found = 0

    for row in rows:
        title, artist, _year, spotify = row
        k = key_for(title, artist)
        if spotify:
            continue
        cached = cache.get(k)
        if cached and cached.get("spotify"):
            row[3] = cached["spotify"]
            continue
        if cached and not retry_misses:
            continue
        if limit is not None and looked_up >= limit:
            break
        if (clock() - started) / 60 > max_minutes:
            print(f"Stopping after {max_minutes} minutes; progress is saved.")
            break
        result = resolve_one(title, artist, fetch, itunes_t, odesli_t, sleep)
        result["checked"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        cache[k] = result
        looked_up += 1
        if result.get("spotify"):
            row[3] = result["spotify"]
            found += 1
        print(f"[{looked_up}] {result['status']:16} {title} / {artist}", flush=True)
        if looked_up % 25 == 0:
            write_catalog(header, rows, songs_path)
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(cache, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")

    write_catalog(header, rows, songs_path)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    write_report(rows, cache, report_path)
    have = sum(1 for r in rows if r[3])
    print(f"Looked up {looked_up}, found {found}. {have} of {len(rows)} songs now have a Spotify ID.")
    return {"looked_up": looked_up, "found": found, "have": have, "total": len(rows)}


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--limit", type=int, default=None, help="look up at most this many songs")
    p.add_argument("--max-minutes", type=float, default=300, help="stop and save after this many minutes")
    p.add_argument("--retry-misses", action="store_true", help="look up songs that failed before")
    a = p.parse_args(argv)
    run(a.limit, a.max_minutes, a.retry_misses)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
