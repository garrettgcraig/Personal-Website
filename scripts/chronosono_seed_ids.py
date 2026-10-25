#!/usr/bin/env python3
"""One-time seeding of Spotify IDs for the ChronoSono catalog from two public datasets.

  1. Billboard year-end Hot 100 songs, 1960-2015, with Spotify track IDs, from the `billboard`
     R package (https://github.com/mikkelkrogsholm/billboard, data/spotify_track_data.rda).
     Convert it to CSV first, for example in R:
       load("spotify_track_data.rda"); write.csv(spotify_track_data, "billboard.csv")
  2. TidyTuesday 2020-01-21 Spotify songs (https://github.com/rfordatascience/tidytuesday,
     data/2020/2020-01-21/spotify_songs.csv).

Billboard rows are preferred, since they point at the charting single. A song is matched only
when both the normalized title and the lead artist agree.

Usage: python scripts/chronosono_seed_ids.py billboard.csv spotify_songs.csv
"""

from __future__ import annotations

import csv
import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("resolver", HERE / "chronosono_resolve_spotify.py")
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)


def key(title: str, artist: str) -> tuple[str, str]:
    return R.normalize(title), R.normalize(R.primary_artist(artist))


def main(billboard_csv: str, tidytuesday_csv: str) -> None:
    header, rows = R.read_catalog()
    cache = R.load_cache()
    bb: dict = {}
    with open(billboard_csv, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            bb.setdefault(key(r["track_name"], r["artist_name"]), []).append((int(float(r["year"])), r["track_id"]))
    tt: dict = {}
    with open(tidytuesday_csv, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            tt.setdefault(key(r["track_name"], r["track_artist"]), []).append((int(r["track_popularity"] or 0), r["track_id"]))
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    added = 0
    for row in rows:
        title, artist, _year, spotify = row[:4]
        if spotify:
            continue
        k = key(title, artist)
        if k in bb:
            chart_year, track = min(bb[k])
            row[3] = track
            cache[R.key_for(title, artist)] = {"source": "billboard", "spotify": track, "chartYear": chart_year, "checked": today}
            added += 1
        elif k in tt:
            _pop, track = max(tt[k])
            row[3] = track
            cache[R.key_for(title, artist)] = {"source": "tidytuesday", "spotify": track, "checked": today}
            added += 1
    R.write_catalog(header, rows)
    R.save_cache(cache)
    R.write_report(rows, cache)
    print(f"Seeded {added} IDs. {sum(1 for r in rows if r[3])} of {len(rows)} songs have one.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
