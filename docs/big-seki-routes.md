# Big SEKI route maintenance

The journal is edited in `trail-log/entries/2026-07-04-big-seki-loop.md`. Each day places its narrative, camp, and map together. Add Garrett's trip details there, then run `python scripts/build_trail_log.py`.

`data/big-seki-routes.geojson` holds 15 approximate daily itineraries on mapped trails, rather than a GPS recording. Camp coordinates represent areas; camp names follow the hiker's journal. No measured mileage or elevation is advertised.

Trail geometry was downloaded October 12, 2026 from the NPS SEKI Park Atlas service:
https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/SEKI_ParkAtlas2_4_HikingandBackpacking_MASTER/FeatureServer

- Layer 13 (NPS trails): `/13/query?where=1%3D1&outFields=*&outSR=4326&f=geojson&resultRecordCount=2000` (747 features).
- Layer 14 (USFS): same parameters, plus `geometry=-118.42,36.70,-118.28,36.85&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` (30 features). Only named Kearsarge Pass trails are used.

Save the responses as local GeoJSON files. To regenerate, install scipy in a development environment and run:

```sh
python scripts/build_seki_routes.py --park-trails /path/to/park.geojson --forest-trails /path/to/forest.geojson
python tests/trail-log.test.py
```

The builder connects trail vertices, densifies to at most 20 m, closes junction gaps of at most 18 m, snaps dated points to that network, and finds shortest paths between successive anchors. Anchors use <=100 m observation accuracy, <=350 m trail offset, and >=650 m spacing; small repeated excursions are removed. Overnight endpoints supplement gaps after the last sighting, including the Middle Fork, Forester Pass base, Kern Junction Meadow, and the Deadman Canyon area. Routes must be reviewed as geography, especially when camp or day boundaries change. Tests reject long joins and broken day continuity. Route geometry is static; readers never depend on a live routing API.

Daily maps initialize near the viewport, share cached data downloads, and keep the GPX maps on existing entries unchanged.
