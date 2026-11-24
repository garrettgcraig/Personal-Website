#!/usr/bin/env python3
"""Rebuild the tracker's national forest and NPS boundary files from full downloads.

The earlier files (made by data/build_layers.R) lost parts of multi-part forests
and collapsed 127 small NPS units to empty geometry. This script takes complete
downloads of both layers and writes simplified versions in place, keeping every
existing property (and therefore every visit key) unchanged.

Download the two layers first (any machine that can reach the servers):

  Forests: https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/MapServer/0/query
           ?where=1=1&outFields=FORESTNAME,REGION,GIS_ACRES&outSR=4326&f=geojson
           &geometryPrecision=5&maxAllowableOffset=0.002
  NPS:     https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2/query
           ?where=1=1&outFields=*&outSR=4326&f=geojson&geometryPrecision=5&maxAllowableOffset=0.002

Then, from the repository root:

    pip install shapely pyproj
    python3 scripts/rebuild_lands_boundaries.py FORESTS.geojson NPS.geojson
    python3 scripts/build_lands_containment.py
"""
import json
import sys
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely import transform
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parent.parent
SIMPLIFY_M = {"national_forest": 600, "nps": 300}  # meters, in an equal-area projection
# The forest layer carries tens of thousands of tiny parcels and inholding holes. Parts and holes
# smaller than this are dropped (they can't be clicked at any zoom the tracker uses), unless a unit
# is that small overall, in which case its largest part is kept.
MIN_PART_SQM = {"national_forest": 1_000_000, "nps": 20_000}
DECIMALS = 5
SQM_PER_ACRE = 4046.8564224

to_albers = Transformer.from_crs("EPSG:4326", "EPSG:5070", always_xy=True).transform
to_wgs = Transformer.from_crs("EPSG:5070", "EPSG:4326", always_xy=True).transform


def project(geom, fn):
    return transform(geom, lambda xy: np.column_stack(fn(xy[:, 0], xy[:, 1])))


def polygons_only(geom):
    """make_valid can return collections with stray lines or points; keep the area."""
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    parts = [g for g in getattr(geom, "geoms", []) if g.geom_type in ("Polygon", "MultiPolygon")]
    from shapely.ops import unary_union
    return unary_union(parts) if parts else geom


def drop_small(geom, min_area):
    parts = list(getattr(geom, "geoms", [geom]))
    kept = [Polygon(p.exterior, [r for r in p.interiors if Polygon(r).area >= min_area])
            for p in parts if p.area >= min_area]
    if not kept:
        biggest = max(parts, key=lambda p: p.area)
        kept = [Polygon(biggest.exterior)]
    return kept[0] if len(kept) == 1 else MultiPolygon(kept)


def simplify(geojson_geom, tolerance, min_area):
    """Returns (simplified WGS84 geometry, area in acres)."""
    albers = polygons_only(make_valid(project(shape(geojson_geom), to_albers)))
    area_acres = albers.area / SQM_PER_ACRE
    albers = drop_small(albers, min_area)
    small = albers.simplify(tolerance, preserve_topology=True)
    if small.is_empty or small.area < albers.area * 0.5:
        # Tiny units: a lighter touch keeps their outline recognizable.
        small = albers.simplify(min(tolerance, max(albers.length / 200, 10)), preserve_topology=True)
    out = polygons_only(make_valid(project(small, to_wgs)))
    out = transform(out, lambda xy: np.round(xy, DECIMALS))
    return polygons_only(make_valid(out)), area_acres


def rebuild(existing_path, download_path, layer, match):
    existing = json.loads(existing_path.read_text())
    download = json.loads(Path(download_path).read_text())["features"]
    out, unmatched = [], []
    for f in existing["features"]:
        src = match(f["properties"], download)
        if src is None:
            unmatched.append(f["properties"]["name"])
            out.append(f)
            continue
        geom, acres = simplify(src["geometry"], SIMPLIFY_M[layer], MIN_PART_SQM[layer])
        props = dict(f["properties"])
        if not props.get("acres"):
            props["acres"] = float(round(acres))
        out.append({"type": "Feature", "properties": props, "geometry": mapping(geom)})
    existing["features"] = out
    existing_path.write_text(json.dumps(existing, separators=(",", ":")) + "\n")
    size = existing_path.stat().st_size / 1e6
    print(f"{existing_path.relative_to(ROOT)}: {len(out)} features, {size:.2f} MB, unmatched: {unmatched or 'none'}", file=sys.stderr)


def match_forest(props, download):
    hits = [d for d in download if d["properties"].get("forestname") == props["name"]]
    return hits[0] if len(hits) == 1 else None


def match_nps(props, download):
    code = props["code"]
    same_code = [d for d in download if d["properties"].get("UNIT_CODE") == code]
    named = [d for d in same_code if d["properties"].get("UNIT_NAME") == props["name"]]
    if len(named) == 1:
        return named[0]
    return same_code[0] if len(same_code) == 1 else None


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    rebuild(ROOT / "data" / "national_forests.geojson", sys.argv[1], "national_forest", match_forest)
    rebuild(ROOT / "data" / "nps.geojson", sys.argv[2], "nps", match_nps)


if __name__ == "__main__":
    main()
