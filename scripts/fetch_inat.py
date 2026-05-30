#!/usr/bin/env python3
"""
fetch_inat.py — Pull iNaturalist observations for a trip and split them into
per-day JSON files keyed to each day's GPX track time window.

For every observation whose `time_observed_at` falls within a track's time
range (plus a small padding), the observation is written to that day's JSON.
The Trail Log map loader (assets/js/trail-map.js) reads these files via the
`[[map:...|inat:data/<file>.json]]` directive and plots them as markers.

USAGE:
    python scripts/fetch_inat.py \
        --user hommedeterre \
        --out-prefix data/inat-nira \
        trail-log/gpx/nira-mission-pine-day1.gpx \
        trail-log/gpx/nira-mission-pine-day2.gpx \
        trail-log/gpx/nira-mission-pine-day3.gpx

    -> writes data/inat-nira-day1.json, -day2.json, -day3.json

DEPENDENCIES:
    pip install requests
"""

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import requests

NS = "http://www.topografix.com/GPX/1/1"
API = "https://api.inaturalist.org/v1/observations"


def q(tag):
    return "{%s}%s" % (NS, tag)


def gpx_window(path):
    """Return (min_epoch, max_epoch) over all trkpt <time> values in a GPX file."""
    root = ET.parse(path).getroot()
    times = []
    for p in root.iter(q("trkpt")):
        t = p.findtext(q("time"))
        if t:
            times.append(datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp())
    if not times:
        raise ValueError("No timestamped track points in %s" % path)
    return min(times), max(times)


def fetch_all(user, d1, d2):
    """Fetch every observation for `user` in [d1, d2] (paginated)."""
    obs, page = [], 1
    while True:
        r = requests.get(API, params={
            "user_login": user, "d1": d1, "d2": d2,
            "per_page": 200, "page": page,
            "order": "asc", "order_by": "observed_on",
        }, timeout=20)
        r.raise_for_status()
        res = r.json().get("results", [])
        if not res:
            break
        obs += res
        if len(res) < 200:
            break
        page += 1
    return obs


def obs_epoch(o):
    t = o.get("time_observed_at")
    if t:
        try:
            return datetime.fromisoformat(t).timestamp()
        except ValueError:
            return None
    return None


def main():
    ap = argparse.ArgumentParser(description="Split iNaturalist observations by GPX day window.")
    ap.add_argument("gpx", nargs="+", help="GPX files, one per day, in order")
    ap.add_argument("--user", required=True, help="iNaturalist username")
    ap.add_argument("--out-prefix", required=True, help="Output prefix, e.g. data/inat-nira")
    ap.add_argument("--pad-min", type=int, default=30, help="Padding minutes around each window")
    args = ap.parse_args()

    windows = []
    for i, path in enumerate(args.gpx, 1):
        lo, hi = gpx_window(path)
        windows.append((i, lo, hi))
        print("Day %d window: %s -> %s" % (
            i, datetime.fromtimestamp(lo, timezone.utc),
            datetime.fromtimestamp(hi, timezone.utc)))

    # Query iNat across the full span of all days.
    span_lo = min(w[1] for w in windows)
    span_hi = max(w[2] for w in windows)
    d1 = datetime.fromtimestamp(span_lo, timezone.utc).strftime("%Y-%m-%d")
    d2 = datetime.fromtimestamp(span_hi, timezone.utc).strftime("%Y-%m-%d")
    obs = fetch_all(args.user, d1, d2)
    print("fetched %d observations for %s (%s..%s)" % (len(obs), args.user, d1, d2))

    pad = args.pad_min * 60
    buckets = {w[0]: [] for w in windows}
    unassigned = 0
    for o in obs:
        geo = o.get("geojson") or {}
        c = geo.get("coordinates")
        e = obs_epoch(o)
        if not c or e is None:
            continue
        lng, lat = c[0], c[1]
        for day, lo, hi in windows:
            if lo - pad <= e <= hi + pad:
                tax = o.get("taxon") or {}
                photos = o.get("photos") or []
                photo = photos[0].get("url", "").replace("square", "small") if photos else None
                buckets[day].append({
                    "id": o.get("id"),
                    "name": tax.get("name"),
                    "common": tax.get("preferred_common_name"),
                    "iconic": tax.get("iconic_taxon_name"),
                    "lat": lat, "lng": lng,
                    "time": o.get("time_observed_at"),
                    "photo": photo,
                    "url": o.get("uri") or "https://www.inaturalist.org/observations/%s" % o.get("id"),
                })
                break
        else:
            unassigned += 1

    for day, items in buckets.items():
        out = "%s-day%d.json" % (args.out_prefix, day)
        with open(out, "w", encoding="utf-8") as fh:
            json.dump({"observations": items}, fh, indent=2, ensure_ascii=False)
        print("Day %d: %d observations -> %s" % (day, len(items), out))
    print("unassigned (outside all windows): %d" % unassigned)


if __name__ == "__main__":
    main()
