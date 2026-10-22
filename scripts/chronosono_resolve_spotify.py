#!/usr/bin/env python3
"""Fill in Spotify track IDs for the ChronoSono catalog without the Spotify API.

Songs in chronosono/songs.js without a Spotify ID are looked up in Wikidata, which records
Spotify track IDs (property P2207) and first release dates (P577) for many songs. A song is
accepted only when the title matches and one of its listed performers matches the artist.

The first IDs came from two public datasets (the Billboard year-end Hot 100 data in the
`billboard` R package, and the TidyTuesday 2020-01-21 Spotify songs data); see
scripts/chronosono_seed_ids.py. Results are cached in data/chronosono-catalog-cache.json, and a
report of misses and year disagreements goes to data/chronosono-catalog-report.md.

Usage:
  python scripts/chronosono_resolve_spotify.py [--limit N] [--retry-misses]
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
SONGS_JS = ROOT / "chronosono" / "songs.js"
CACHE = ROOT / "data" / "chronosono-catalog-cache.json"
REPORT = ROOT / "data" / "chronosono-catalog-report.md"

WIKIDATA_URL = "https://query.wikidata.org/sparql"
WIKIDATA_GAP = 2.0  # seconds between queries, to stay well inside Wikidata's limits
BATCH = 25  # songs per query
USER_AGENT = "ChronoSonoCatalog/1.0 (https://garrettgcraig.com/chronosono/; catalog maintenance)"
SPOTIFY_ID = re.compile(r"^[A-Za-z0-9]{22}$")


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


def load_cache(path: Path = CACHE) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def save_cache(cache: dict, path: Path = CACHE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")


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


def artist_matches(want: str, performers: list[str]) -> bool:
    w = normalize(primary_artist(want))
    w_no_the = re.sub(r"^the ", "", w)
    for p in performers:
        n = normalize(p)
        n_no_the = re.sub(r"^the ", "", n)
        if n == w or n_no_the == w_no_the or (len(w) > 3 and (w in n or n in w)):
            return True
    return False


def label_variants(title: str) -> list[str]:
    """Wikidata labels are matched exactly, so try the common capitalizations."""
    base = title.strip()
    no_paren = re.sub(r"\s*\([^)]*\)\s*$", "", base).strip()
    out = []
    for t in (base, no_paren):
        for v in (t, t.title(), t.lower(), t[:1].upper() + t[1:].lower(), t.upper()):
            if v and v not in out:
                out.append(v)
    return out


def year_of(date: str | None) -> int | None:
    m = re.match(r"^\+?(\d{4})", date or "")
    return int(m.group(1)) if m else None


def pick(candidates: list[dict], title: str, artist: str) -> dict | None:
    """candidates: [{label, spotify, performers: [...], year}] for one song's label variants."""
    want = normalize(title)
    good = [c for c in candidates
            if normalize(c["label"]) == want and SPOTIFY_ID.match(c["spotify"] or "") and artist_matches(artist, c["performers"])]
    if not good:
        return None
    # Prefer the entry with the earliest release date, which is usually the original single.
    good.sort(key=lambda c: c["year"] or 9999)
    return good[0]


# ---------- Wikidata ----------

def build_query(labels: list[str]) -> str:
    values = " ".join(json.dumps(l, ensure_ascii=False) + "@en" for l in labels)
    return f"""
SELECT ?label ?item ?spotify ?performerLabel ?date WHERE {{
  VALUES ?label {{ {values} }}
  ?item rdfs:label ?label ;
        wdt:P2207 ?spotify .
  OPTIONAL {{ ?item wdt:P175 ?performer . ?performer rdfs:label ?performerLabel . FILTER(LANG(?performerLabel) = "en") }}
  OPTIONAL {{ ?item wdt:P577 ?date }}
}}"""


def parse_results(data: dict) -> dict[str, list[dict]]:
    """Group SPARQL rows by label into candidate songs keyed by Wikidata item."""
    by_item: dict[str, dict] = {}
    for b in (data.get("results") or {}).get("bindings", []):
        item = b["item"]["value"]
        c = by_item.setdefault(item, {"label": b["label"]["value"], "spotify": b["spotify"]["value"], "performers": [], "year": None})
        if "performerLabel" in b and b["performerLabel"]["value"] not in c["performers"]:
            c["performers"].append(b["performerLabel"]["value"])
        y = year_of(b.get("date", {}).get("value"))
        if y and (c["year"] is None or y < c["year"]):
            c["year"] = y
    grouped: dict[str, list[dict]] = {}
    for c in by_item.values():
        grouped.setdefault(c["label"], []).append(c)
    return grouped


def http_sparql(query: str, timeout: int = 60) -> dict:
    body = urllib.parse.urlencode({"query": query}).encode()
    req = urllib.request.Request(WIKIDATA_URL, data=body, method="POST", headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded",
    })
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def query_with_retry(fetch, query: str, sleep=time.sleep) -> dict | None:
    for attempt in range(3):
        try:
            return fetch(query)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                retry = e.headers.get("Retry-After") if e.headers else None
                sleep(min(60, int(retry)) if retry and retry.isdigit() else 10 * (attempt + 1))
                continue
            print(f"Wikidata refused the query ({e.code}).", flush=True)
            return None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            print(f"Wikidata query failed ({e}); retrying.", flush=True)
            sleep(5 * (attempt + 1))
    return None


# ---------- Report ----------

def write_report(rows: list[list], cache: dict, path: Path = REPORT) -> None:
    have = sum(1 for r in rows if r[3])
    sources: dict[str, int] = {}
    for t, a, _, sp in rows:
        if sp:
            src = (cache.get(key_for(t, a)) or {}).get("source", "unknown")
            sources[src] = sources.get(src, 0) + 1
    differs = []
    for t, a, y, sp in rows:
        e = cache.get(key_for(t, a)) or {}
        other = e.get("wikidataYear") or e.get("chartYear")
        if sp and other and abs(other - y) >= 2:
            differs.append((t, a, y, other, "Wikidata" if e.get("wikidataYear") else "Billboard year-end chart"))
    misses = [(t, a, y) for t, a, y, sp in rows if not sp]
    lines = [
        "# ChronoSono catalog report",
        "",
        f"Updated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}.",
        "",
        f"{have} of {len(rows)} songs have a Spotify ID and can be played. Songs without one are left out of the game.",
        "",
        "Where the IDs came from: " + (", ".join(f"{k} {v}" for k, v in sorted(sources.items())) or "none yet") + ".",
        "",
        "## Years that disagree by two or more",
        "",
        "Another source dates these songs differently from `chronosono/songs.js`. Chart years often trail the "
        "release (a song can chart a year or two later), so check before changing anything.",
        "",
    ]
    lines += [f"- {t}, {a}: listed {y}, {src} {o}" for t, a, y, o, src in sorted(differs, key=lambda x: x[2])] or ["None."]
    lines += ["", f"## No Spotify ID yet ({len(misses)})", ""]
    lines += [f"- {t}, {a} ({y})" for t, a, y in misses] or ["None."]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------- Main ----------

def run(limit: int | None, retry_misses: bool, fetch=http_sparql, sleep=time.sleep,
        songs_path: Path = SONGS_JS, cache_path: Path = CACHE, report_path: Path = REPORT) -> dict:
    header, rows = read_catalog(songs_path)
    cache = load_cache(cache_path)
    todo = []
    for row in rows:
        title, artist, _, spotify = row
        entry = cache.get(key_for(title, artist))
        if spotify:
            continue
        if entry and entry.get("spotify"):
            row[3] = entry["spotify"]
            continue
        if entry and entry.get("status") == "no-wikidata-match" and not retry_misses:
            continue
        todo.append(row)
    if limit is not None:
        todo = todo[:limit]

    found = 0
    for i in range(0, len(todo), BATCH):
        batch = todo[i:i + BATCH]
        labels = sorted({v for t, *_ in batch for v in label_variants(t)})
        if i:
            sleep(WIKIDATA_GAP)
        data = query_with_retry(fetch, build_query(labels), sleep)
        if data is None:
            print("Stopping early; nothing more is marked as a miss.", flush=True)
            break
        grouped = parse_results(data)
        for row in batch:
            title, artist, year, _ = row
            cands = [c for v in label_variants(title) for c in grouped.get(v, [])]
            best = pick(cands, title, artist)
            k = key_for(title, artist)
            checked = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            if best:
                row[3] = best["spotify"]
                cache[k] = {"source": "wikidata", "spotify": best["spotify"], "wikidataYear": best["year"], "checked": checked}
                found += 1
                print(f"found    {title} / {artist}", flush=True)
            else:
                cache[k] = {"status": "no-wikidata-match", "checked": checked}
                print(f"no match {title} / {artist}", flush=True)

    write_catalog(header, rows, songs_path)
    save_cache(cache, cache_path)
    write_report(rows, cache, report_path)
    have = sum(1 for r in rows if r[3])
    print(f"Looked up {len(todo)}, found {found}. {have} of {len(rows)} songs now have a Spotify ID.")
    return {"looked_up": len(todo), "found": found, "have": have, "total": len(rows)}


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--limit", type=int, default=None, help="look up at most this many songs")
    p.add_argument("--retry-misses", action="store_true", help="look up songs that failed before")
    a = p.parse_args(argv)
    run(a.limit, a.retry_misses)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
