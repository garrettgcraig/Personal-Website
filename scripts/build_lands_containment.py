#!/usr/bin/env python3
"""Precompute which public-lands units lie wholly inside other units.

The tracker on /wilderness auto-marks the containing units when a visitor marks a
smaller one. This script reads the three bundled boundary layers and writes
data/lands-containment.json, which the browser loads alongside them.

A unit A counts as inside the units that overlap it when
  * at least 96% of A lies within TOLERANCE_M of their union, and
  * at least 90% of A lies inside their union with no tolerance at all.
The bundled boundaries are simplified at 500-600 m (data/build_layers.R), so
neighboring layers rarely share an edge exactly. The buffered test absorbs that
slop, and the unbuffered test keeps the buffer from swallowing small units that
only sit next to a larger one (or in a hole cut out of it).

Only overlaps that reach into a unit's interior name a container: B is listed
when it holds most of A, or when A and B still share 1% of A's area after the
overlap is shrunk by CORE_M. A neighbor whose simplified edge spills a thin
sliver over A is not listed.

Wilderness is an overlay designation, so a wilderness is never treated as
containing a park or forest.

The output lists each unit's nearest containers only: when A lies inside both a
park and a forest that itself holds the park, A lists the park, and the browser
follows the park up to the forest. A unit with one nearest container is marked
automatically; with several, the visitor is asked which to mark.

Run from the repository root after refreshing any boundary file:

    pip install shapely pyproj
    python3 scripts/build_lands_containment.py
"""
import json
import sys
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely.geometry import shape
from shapely import transform
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parent.parent
LAYERS = [
    # (tracker layer type, file, key property) - must match LAYERS in lands-tracker.js
    ("wilderness", "data/wilderness.geojson", "name"),
    ("nps", "data/nps.geojson", "code"),
    ("national_forest", "data/national_forests.geojson", "name"),
]
OUT = ROOT / "data" / "lands-containment.json"

TOLERANCE_M = 1000      # boundary slop allowed around the containers
MAX_OUTSIDE = 0.04      # share of A that may fall outside the buffered containers
MAX_OUTSIDE_RAW = 0.10  # share of A that may fall outside the containers with no buffer
CORE_M = 500            # how far an overlap is shrunk to tell real overlap from edge slop
MIN_CORE_SHARE = 0.01   # share of A a shrunk overlap must keep for B to be listed
CAN_CONTAIN = {         # container layer types allowed for each layer type
    "wilderness": {"nps", "national_forest"},
    "nps": {"national_forest"},
    "national_forest": {"nps"},
}

to_albers = Transformer.from_crs("EPSG:4326", "EPSG:5070", always_xy=True).transform


def load_units():
    units = []
    for layer_type, path, key_prop in LAYERS:
        features = json.loads((ROOT / path).read_text())["features"]
        grouped = {}
        for f in features:
            key = str(f["properties"][key_prop])
            geom = transform(shape(f["geometry"]), lambda xy: np.column_stack(to_albers(xy[:, 0], xy[:, 1])))
            if not geom.is_empty:
                geom = geom.buffer(0)
            grouped.setdefault(key, []).append(geom)
        for key, geoms in grouped.items():
            geom = unary_union(geoms)
            units.append({"type": layer_type, "key": key, "geom": geom, "area": geom.area})
    return units


def direct_containers(units):
    tree = STRtree([u["geom"] for u in units])
    result = {}
    for i, a in enumerate(units):
        if a["area"] <= 0:
            continue
        overlapping, listed = [], set()
        for j in tree.query(a["geom"].buffer(TOLERANCE_M)):
            b = units[j]
            if j == i or b["type"] not in CAN_CONTAIN[a["type"]]:
                continue
            overlap = a["geom"].intersection(b["geom"])
            if overlap.area <= 0:
                continue
            overlapping.append(b["geom"])
            share = overlap.area / a["area"]
            core = overlap.buffer(-CORE_M).area / a["area"]
            if share >= 0.5 or core >= MIN_CORE_SHARE:
                listed.add((b["type"], b["key"]))
        if not listed:
            continue
        union = unary_union(overlapping)
        outside_raw = a["geom"].difference(union).area / a["area"]
        outside = a["geom"].difference(union.buffer(TOLERANCE_M)).area / a["area"]
        if outside_raw <= MAX_OUTSIDE_RAW and outside <= MAX_OUTSIDE:
            result[(a["type"], a["key"])] = listed
    return result


def closure(direct):
    full = {}
    for unit in direct:
        seen, stack = set(), list(direct[unit])
        while stack:
            c = stack.pop()
            if c in seen or c == unit:
                continue
            seen.add(c)
            stack.extend(direct.get(c, ()))
        full[unit] = seen
    return full


def nearest(direct):
    """Drop containers that are already reachable through another container."""
    full = closure(direct)
    return {
        unit: {c for c in cs if not any(c in full.get(other, ()) for other in cs if other != c)}
        for unit, cs in direct.items()
    }


def main():
    units = load_units()
    contained = nearest(direct_containers(units))
    out = {layer_type: {} for layer_type, _, _ in LAYERS}
    for (layer_type, key) in sorted(contained):
        out[layer_type][key] = sorted([t, k] for t, k in contained[(layer_type, key)])
    OUT.write_text(json.dumps({
        "about": "Nearest containers of units wholly inside other units, for auto-marking in the lands tracker. Generated by scripts/build_lands_containment.py.",
        "tolerance_m": TOLERANCE_M,
        "contained": out,
    }, indent=1, ensure_ascii=False) + "\n")
    counts = {t: len(v) for t, v in out.items()}
    print(f"Wrote {OUT.relative_to(ROOT)}: {counts}", file=sys.stderr)


if __name__ == "__main__":
    main()
