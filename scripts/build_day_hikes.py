#!/usr/bin/env python3
"""
build_day_hikes.py — Turn a Gaia GPS "all tracks" export into data/day-hikes.geojson
for day-hikes.html.

Multi-day trips (tracks on two or more consecutive days near each other), and
any date already covered by a published Trail Log entry, are left to the Trail Log. What remains is grouped into single-day hikes:

  * Driving and other fast stretches (> 9 km/h over five minutes) are cut out.
  * Pieces recorded the same day are joined into one hike when the next piece
    starts within 500 m of where the last one stopped (a paused recording).
  * Hikes under 3 km are dropped.
  * A trail walked more than once is kept once, with every date it was walked.
    Two hikes count as the same trail when at least 75% of each lies along the
    other, or when a shorter hike lies at least 90% along a longer one.
  * Hikes on different dates whose ends meet (one finishes within 300 m of
    where the other starts, neither is a loop, and they don't share trail)
    are marked as connected, e.g. a long trail walked in sections.

Place names use the most specific park or protected area around each hike's
high point (OpenStreetMap via Overpass), else the nearest locality from
Nominatim, plus the state. Lookups are cached in data/day-hikes-places.json,
so reruns don't query them again.

USAGE:
    python3 scripts/build_day_hikes.py ~/Downloads/all-tracks.gpx
"""

import json
import math
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "day-hikes.geojson"
PLACES = ROOT / "data" / "day-hikes-places.json"
NS = "{http://www.topografix.com/GPX/1/1}"

FAST_KMH = 9.0
JOIN_M = 500
JOIN_GAP_H = 3
MIN_KM = 3.0
CELL_M = 60


def hav(a, b):
    R = 6371000.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    x = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))


def length_m(pts):
    return sum(hav(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def gain_m(pts):
    eles = [p[2] for p in pts if p[2] is not None and -100 < p[2] < 6000]
    total, ref = 0.0, eles[0] if eles else 0
    for e in eles:
        if e - ref >= 10:
            total += e - ref
            ref = e
        elif ref - e >= 10:
            ref = e
    return total


def read_tracks(path):
    tracks = []
    for _, el in ET.iterparse(path, events=("end",)):
        if el.tag != NS + "trk":
            continue
        pts = []
        for p in el.iter(NS + "trkpt"):
            t = p.findtext(NS + "time")
            if not t:
                continue
            e = p.findtext(NS + "ele")
            pts.append((float(p.get("lat")), float(p.get("lon")), float(e) if e else None,
                        datetime.fromisoformat(t.replace("Z", "+00:00"))))
        el.clear()
        if len(pts) >= 2:
            tracks.append(pts)
    tracks.sort(key=lambda t: t[0][3])
    return tracks


def local_date(pts):
    # Longitude-based offset is close enough to pick the calendar day.
    lon = sum(p[1] for p in pts) / len(pts)
    return (pts[0][3] + timedelta(hours=round(lon / 15))).date()


def group_outings(tracks):
    """Same clustering the Trail Log backfill used: < 30 h and < 25 km apart."""
    groups = []
    for t in tracks:
        if groups:
            last = groups[-1][-1]
            gap_h = (t[0][3] - last[-1][3]).total_seconds() / 3600
            if gap_h < 30 and hav(last[-1], t[0]) < 25000:
                groups[-1].append(t)
                continue
        groups.append([t])
    return groups


def cut_fast(pts):
    """Split a track into walking-speed pieces."""
    fast = [False] * len(pts)
    for i in range(len(pts)):
        j = i
        while j < len(pts) - 1 and (pts[j][3] - pts[i][3]).total_seconds() < 300:
            j += 1
        dt = (pts[j][3] - pts[i][3]).total_seconds()
        if dt > 0 and hav(pts[i], pts[j]) / dt * 3.6 > FAST_KMH:
            for k in range(i, j + 1):
                fast[k] = True
    pieces, cur = [], []
    for p, f in zip(pts, fast):
        if f:
            if cur:
                pieces.append(cur)
            cur = []
        else:
            cur.append(p)
    if cur:
        pieces.append(cur)
    return [p for p in pieces if len(p) >= 20]


def split_hikes(pieces):
    """Join time-ordered pieces that pick up where the last left off."""
    pieces.sort(key=lambda p: p[0][3])
    hikes = []
    for p in pieces:
        if hikes:
            prev = hikes[-1]["segments"][-1]
            gap_h = (p[0][3] - prev[-1][3]).total_seconds() / 3600
            if hav(prev[-1], p[0]) <= JOIN_M and gap_h <= JOIN_GAP_H:
                hikes[-1]["segments"].append(p)
                continue
        hikes.append({"segments": [p]})
    return hikes


def resample(pts, step=20):
    out, acc = [pts[0]], 0.0
    for a, b in zip(pts, pts[1:]):
        acc += hav(a, b)
        if acc >= step:
            out.append(b)
            acc = 0.0
    return out


def cells(segments):
    s = set()
    for seg in segments:
        for p in resample(seg):
            lat_m = p[0] * 111320
            lon_m = p[1] * 111320 * math.cos(math.radians(p[0]))
            s.add((int(lat_m // CELL_M), int(lon_m // CELL_M)))
    return s


def overlap(a, b):
    """Share of a's cells that sit on or next to one of b's."""
    if not a:
        return 0.0
    hit = sum(1 for (x, y) in a if any((x + dx, y + dy) in b for dx in (-1, 0, 1) for dy in (-1, 0, 1)))
    return hit / len(a)


def rdp(pts, tol):
    """Ramer–Douglas–Peucker on (lat, lon) using a local metric projection."""
    if len(pts) < 3:
        return pts
    lat0 = math.radians(pts[0][0])
    xy = [(p[1] * 111320 * math.cos(lat0), p[0] * 111320) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = xy[i], xy[j]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy) or 1e-9
        best, idx = 0.0, None
        for k in range(i + 1, j):
            d = abs(dy * xy[k][0] - dx * xy[k][1] + x2 * y1 - y2 * x1) / norm
            if d > best:
                best, idx = d, k
        if idx is not None and best > tol:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [p for p, k in zip(pts, keep) if k]


def region(lat, lon):
    if lon > 160:
        return "New Zealand"
    if lat < 0 and lon < -30:
        return "South America"
    if lat < 5 and 20 < lon < 50:
        return "East Africa"
    if lon < -114:
        return "California & the West Coast"
    if lon < -100:
        return "Southwest & Rockies"
    if lon < -84 and lat > 39:
        return "Great Lakes & Midwest"
    return "Appalachians & the East"


def place_name(lat, lon, cache):
    key = "%.3f,%.3f" % (lat, lon)
    if key in cache:
        return cache[key]
    url = ("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=en"
           "&lat=%.5f&lon=%.5f" % (lat, lon))
    r = subprocess.run(["curl", "-s", "-m", "30", "-A", "garrettgcraig.com day-hikes builder", url],
                       capture_output=True, text=True)
    time.sleep(1.1)  # Nominatim's usage policy: at most one request a second.
    try:
        d = json.loads(r.stdout)
    except ValueError:
        return None
    a = d.get("address", {})
    local = (d.get("name") or a.get("leisure") or a.get("natural") or a.get("tourism")
             or a.get("hamlet") or a.get("village") or a.get("town") or a.get("city")
             or a.get("municipality") or a.get("county"))
    area = a.get("state") or a.get("region") or a.get("country")
    name = ", ".join(x for x in (local, area) if x) or None
    cache[key] = name
    return name


OVERPASS_FAILS = [0]


def protected_area(lat, lon, cache):
    """Most specific named park or protected area containing the point."""
    key = "area:%.3f,%.3f" % (lat, lon)
    if key in cache:
        return cache[key]
    if OVERPASS_FAILS[0] >= 3:
        return None  # Overpass is down; skip for this run and retry next time
    query = ('[out:json][timeout:25];is_in(%f,%f)->.a;(area.a[boundary~"protected_area|national_park"][name];'
             'area.a[leisure~"park|nature_reserve"][name];);out tags;' % (lat, lon))
    for host in ("overpass-api.de", "overpass.kumi.systems"):
        r = subprocess.run(["curl", "-s", "-m", "40", "-A", "garrettgcraig.com day-hikes builder",
                            "--data-urlencode", "data=" + query, "-m", "20", "https://%s/api/interpreter" % host],
                           capture_output=True, text=True)
        time.sleep(1.5)
        try:
            tags = [e["tags"] for e in json.loads(r.stdout)["elements"]]
            break
        except (ValueError, KeyError):
            continue
    else:
        OVERPASS_FAILS[0] += 1
        return None  # not cached, so the next run retries
    OVERPASS_FAILS[0] = 0

    def rank(t):
        # Smaller IUCN-style class = more specific (wilderness 1b, park 2, forest 6).
        try:
            cls = int("".join(ch for ch in t.get("protect_class", "") if ch.isdigit()) or 5)
        except ValueError:
            cls = 5
        return (0 if t.get("leisure") in ("park", "nature_reserve") and cls >= 5 else 1, cls)

    named = sorted((t for t in tags if t.get("name")), key=rank)
    cache[key] = named[0].get("name:en") or named[0]["name"] if named else ""
    return cache[key]


def trail_log_dates():
    """Every date covered by a published Trail Log entry (its date plus one day per '## Day' heading)."""
    covered = set()
    for md in (ROOT / "trail-log" / "entries").glob("[0-9]*.md"):
        text = md.read_text()
        start = datetime.strptime(text.split("date:", 1)[1].split()[0], "%Y-%m-%d").date()
        days = max(1, text.count("\n## Day "))
        covered.update(start + timedelta(days=i) for i in range(days))
    return covered


def main(gpx):
    covered = trail_log_dates()
    tracks = read_tracks(gpx)
    groups = group_outings(tracks)
    hikes = []
    for g in groups:
        if len({local_date(t) for t in g}) > 1:
            continue  # multi-day trip: belongs to the Trail Log
        if local_date(g[0]) in covered:
            continue  # already part of a Trail Log entry
        pieces = [piece for t in g for piece in cut_fast(t)]
        for h in split_hikes(pieces):
            pts = [p for seg in h["segments"] for p in seg]
            km = sum(length_m(s) for s in h["segments"]) / 1000
            if km < MIN_KM:
                continue
            h.update(km=km, gain=sum(gain_m(s) for s in h["segments"]), date=local_date(pts),
                     start=pts[0], end=pts[-1], high=max(pts, key=lambda p: p[2] or -1e9),
                     joined=len(h["segments"]) - 1)
            h["cells"] = cells(h["segments"])
            hikes.append(h)

    # Fold repeats into the longest walk of each trail.
    hikes.sort(key=lambda h: -h["km"])
    kept = []
    for h in hikes:
        for k in kept:
            a, b = overlap(h["cells"], k["cells"]), overlap(k["cells"], h["cells"])
            if min(a, b) >= 0.75 or a >= 0.9:
                k["repeats"].append(h["date"])
                break
        else:
            h["repeats"] = []
            kept.append(h)

    # Section-style connections between different dates.
    kept.sort(key=lambda h: h["date"])
    for i, h in enumerate(kept):
        h["id"] = "%s-%d" % (h["date"].isoformat(), sum(1 for x in kept[:i] if x["date"] == h["date"]) + 1)
        h["connects"] = []
    for a in kept:
        for b in kept:
            if a is b or a["date"] == b["date"]:
                continue
            if hav(a["start"], a["end"]) < 500 or hav(b["start"], b["end"]) < 500:
                continue
            if hav(a["end"], b["start"]) <= 300 and max(overlap(a["cells"], b["cells"]), overlap(b["cells"], a["cells"])) < 0.3:
                a["connects"].append(b["id"])
                b["connects"].append(a["id"])

    cache = json.loads(PLACES.read_text()) if PLACES.exists() else {}
    features = []
    for n, h in enumerate(kept, 1):
        name = place_name(h["high"][0], h["high"][1], cache)
        area = protected_area(h["high"][0], h["high"][1], cache)
        if area:
            state = name.split(", ")[-1] if name else ""
            name = area if not state or state in area else "%s, %s" % (area, state)
        if n % 25 == 0:
            PLACES.write_text(json.dumps(cache, indent=1, sort_keys=True))
            print("  %d of %d named" % (n, len(kept)))
        lines = [[[round(p[1], 5), round(p[0], 5)] for p in rdp(seg, 8)] for seg in h["segments"]]
        features.append({
            "type": "Feature",
            "geometry": {"type": "MultiLineString", "coordinates": lines},
            "properties": {
                "id": h["id"],
                "name": name or region(h["start"][0], h["start"][1]),
                "region": region(h["start"][0], h["start"][1]),
                "dates": sorted(d.isoformat() for d in [h["date"]] + h["repeats"]),
                "km": round(h["km"], 1),
                "gain_m": int(round(h["gain"], -1)),
                "joined": h["joined"],
                "connects": sorted(set(h["connects"])),
            },
        })
    PLACES.write_text(json.dumps(cache, indent=1, sort_keys=True))
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
    repeats = sum(len(h["repeats"]) for h in kept)
    print("%d day hikes (%d repeat walks folded in, %d same-day joins, %d connected pairs) -> %s"
          % (len(kept), repeats, sum(h["joined"] for h in kept),
             sum(len(h["connects"]) for h in kept) // 2, OUT.relative_to(ROOT)))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
