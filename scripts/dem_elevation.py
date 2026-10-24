#!/usr/bin/env python3
"""
dem_elevation.py — Replace GPS altitudes in Trail Log GPX files with USGS 3DEP
terrain elevations.

Phone and watch GPS altitude jitters by several meters from point to point, so
summing every rise roughly doubles a day's real climb. Terrain elevation from
the USGS Elevation Point Query Service is smooth and matches the ground.

Each track is sampled every 50 m; points in between are interpolated by
distance. Points outside USGS coverage keep their GPS value. Finished files
get a <desc> marker and are skipped on later runs; lookups are cached in
.cache/dem.json so an interrupted run picks up where it stopped.

USAGE:
    python3 scripts/dem_elevation.py trail-log/gpx/*.gpx
"""

import json
import math
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "dem.json"
MARK = "<desc>Elevations: USGS 3DEP terrain model</desc>"
STEP_M = 50
EPQS = "https://epqs.nationalmap.gov/v1/json?x=%.6f&y=%.6f&units=Meters&wkid=4326"
TRKPT = re.compile(r'<trkpt lat="([^"]+)" lon="([^"]+)">(?:<ele>[^<]*</ele>)?(.*?)</trkpt>')


def hav(a, b):
    R = 6371000.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    x = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))


def key(p):
    return "%.5f,%.5f" % p


def lookup(p):
    for _ in range(4):
        r = subprocess.run(["curl", "-s", "-m", "30", EPQS % (p[1], p[0])], capture_output=True, text=True)
        try:
            v = float(json.loads(r.stdout)["value"])
            return key(p), (v if v > -1000 else None)  # -1000000 means no coverage
        except (ValueError, KeyError, TypeError):
            continue
    return key(p), "retry"


def main(paths):
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    CACHE.parent.mkdir(exist_ok=True)
    for path in paths:
        text = Path(path).read_text()
        if MARK in text:
            continue
        segs = re.findall(r"<trkseg>(.*?)</trkseg>", text, re.S)
        parsed, wanted = [], []
        for seg in segs:
            pts = [(round(float(a), 5), round(float(b), 5), rest) for a, b, rest in TRKPT.findall(seg)]
            gps = [float(x) if x else None for x in re.findall(r"<trkpt [^>]*>(?:<ele>([^<]*)</ele>)?", seg)]
            dist, d, acc = [0.0], 0.0, 0.0
            samples = [0]
            for i in range(1, len(pts)):
                step = hav(pts[i - 1], pts[i])
                d += step
                acc += step
                dist.append(d)
                if acc >= STEP_M or i == len(pts) - 1:
                    samples.append(i)
                    acc = 0.0
            parsed.append((pts, gps, dist, samples))
            wanted += [key(pts[i][:2]) for i in samples]
        todo = sorted({k for k in wanted if k not in cache})
        if todo:
            with ThreadPoolExecutor(8) as ex:
                for k, v in ex.map(lambda k: lookup(tuple(map(float, k.split(",")))), todo):
                    if v != "retry":
                        cache[k] = v
            CACHE.write_text(json.dumps(cache))
        if any(k not in cache for k in wanted):
            print("%s: some lookups failed; rerun to finish" % path)
            continue

        out_segs = []
        for pts, gps, dist, samples in parsed:
            known = [(dist[i], cache[key(pts[i][:2])]) for i in samples if cache[key(pts[i][:2])] is not None]
            out = []
            j = 0
            for i, (lat, lon, rest) in enumerate(pts):
                ele = gps[i]
                if len(known) >= 2:
                    while j < len(known) - 2 and known[j + 1][0] < dist[i]:
                        j += 1
                    (d0, e0), (d1, e1) = known[j], known[j + 1]
                    t = 0.0 if d1 == d0 else min(1.0, max(0.0, (dist[i] - d0) / (d1 - d0)))
                    ele = e0 + (e1 - e0) * t
                ele_xml = "<ele>%.1f</ele>" % ele if ele is not None else ""
                out.append('<trkpt lat="%.6f" lon="%.6f">%s%s</trkpt>' % (lat, lon, ele_xml, rest))
            out_segs.append("<trkseg>" + "".join(out) + "</trkseg>")
        it = iter(out_segs)
        text = re.sub(r"<trkseg>.*?</trkseg>", lambda m: next(it), text, flags=re.S)
        text = re.sub(r"(<trk>\s*<name>.*?</name>)", lambda m: m.group(1) + MARK, text, count=1, flags=re.S)
        Path(path).write_text(text)
        print("%s: %d terrain samples" % (Path(path).name, len(wanted)))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
